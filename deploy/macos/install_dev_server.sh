#!/bin/bash
# Install (or remove) the Vite dev server as an always-running launchd service,
# so the app stays reachable from your iPhone without an open Terminal window.
#
#   deploy/macos/install_dev_server.sh             install / update (port 5173)
#   deploy/macos/install_dev_server.sh uninstall   remove it
#   POLLING=1 deploy/macos/install_dev_server.sh   use polling file watching
#                                                  (if edits don't show up live)
#
# Reach it from your iPhone over Tailscale (free private network, no open ports):
# install Tailscale on this Mac and the iPhone, sign in to the same account, then
# open the phone link this script prints and use Share > Add to Home Screen.
#
# This is a development workflow only. Production hosting remains GitHub Pages
# plus Supabase Free.
set -euo pipefail

LABEL="com.fitness-insights.dev"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DOMAIN="gui/$(id -u)"
PORT="${PORT:-5173}"
LOG="$REPO/.logs/dev-server.log"

if [[ "${1:-}" == "uninstall" ]]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL."
  exit 0
fi

cd "$REPO"

# launchd does not load nvm or shell profiles, so pin an absolute Node 24 path.
NODE=""
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  set +u; source "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null; set -u
  NODE="$(nvm which 24 2>/dev/null || true)"
fi
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  NODE="$(command -v node || true)"
fi
if [[ -z "$NODE" ]] || [[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" != "24" ]]; then
  echo "Node 24 not found. Run: nvm install 24   then rerun this script." >&2
  exit 1
fi
NODE_BIN="$(dirname "$NODE")"
echo "Using Node $("$NODE" -v) at $NODE"

if [[ ! -f node_modules/vite/bin/vite.js || package-lock.json -nt node_modules/.package-lock.json ]]; then
  echo "Installing dependencies (npm ci)..."
  PATH="$NODE_BIN:$PATH" "$NODE_BIN/npm" ci
fi

if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  echo "Created .env.local from .env.example (setup screen until Supabase is configured)."
fi

# Stop our own service first, then make sure nothing else holds the port.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
sleep 1
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use (an 'npm run dev' Terminal window?). Stop it with Ctrl+C and rerun." >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  exit 1
fi

POLLING_VALUE="${POLLING:-0}"
mkdir -p "$(dirname "$LOG")" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/node_modules/vite/bin/vite.js</string>
    <string>--host</string><string>0.0.0.0</string>
    <string>--port</string><string>$PORT</string>
    <string>--strictPort</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>VITE_WATCH_POLLING</key><string>$POLLING_VALUE</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "$DOMAIN" "$PLIST"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then break; fi
  sleep 1
done
if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "Dev server is running (restarts automatically; starts at login)."
else
  echo "Dev server did not respond yet; check: tail -50 $LOG" >&2
fi
echo
echo "On this Mac:  http://localhost:$PORT/"

TS="$(command -v tailscale || true)"
[[ -z "$TS" && -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]] && \
  TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
TS_IP=""
TS_HOST=""
if [[ -n "$TS" ]]; then
  TS_IP="$("$TS" ip -4 2>/dev/null | head -1 || true)"
  TS_HOST="$("$TS" status --json 2>/dev/null | "$NODE" -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{}})' \
    2>/dev/null || true)"
fi
if [[ -n "$TS_IP" ]]; then
  echo "On your phone (Tailscale on): http://$TS_IP:$PORT/"
  [[ -n "$TS_HOST" ]] && echo "                          or: http://$TS_HOST:$PORT/"
else
  echo "Same Wi-Fi only: http://$(scutil --get LocalHostName).local:$PORT/"
  echo "For anywhere access, install Tailscale on this Mac and your iPhone, then rerun this script."
fi
echo
echo "Logs:      tail -f $LOG"
echo "Remove:    deploy/macos/install_dev_server.sh uninstall"
echo "Keep the Mac awake while plugged in (System Settings > Battery > Options) for remote access."
