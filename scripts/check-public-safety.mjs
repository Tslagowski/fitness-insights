#!/usr/bin/env node
// Ticket 14: the public repository and the static build must contain no personal exports and no
// privileged credentials. Run after `npm run build`: node scripts/check-public-safety.mjs
// Fails (exit 1) and lists every problem it finds.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const problems = [];

// 1. Tracked files: no spreadsheets, CSVs, or archives (synthetic fixtures are generated in code), no env files.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const file of tracked) {
  if (/\.(xlsx|xls|csv|zip)$/i.test(file)) problems.push(`Tracked data file: ${file} (personal exports must never be committed)`);
  if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.example')) problems.push(`Tracked environment file: ${file}`);
}

// 2. Secret patterns in tracked text files and in the built site.
const patterns = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'JWT (possible service-role key)'],
  [/service_role["']?\s*[:=]\s*["'][^"']{20,}/i, 'service-role key assignment'],
  [/sbp_[a-f0-9]{30,}/, 'Supabase personal access token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
];
function scan(path, label) {
  const stat = statSync(path);
  if (stat.size > 5_000_000) return;
  const text = readFileSync(path, 'utf8');
  for (const [pattern, name] of patterns) if (pattern.test(text)) problems.push(`${name} in ${label}`);
}
for (const file of tracked) {
  if (/\.(png|jpg|jpeg|gif|ico|woff2?|lockb)$/i.test(file) || !existsSync(file)) continue;
  scan(file, file);
}
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else {
      if (/\.(xlsx|xls|csv|zip)$/i.test(entry.name)) problems.push(`Data file in build: ${path}`);
      if (/\.(js|css|html|json|txt|map)$/i.test(entry.name)) scan(path, path);
    }
  }
}
if (existsSync('dist')) walk('dist');
else problems.push('dist/ not found: run npm run build first');

if (problems.length) {
  console.error(`Public safety check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Public safety check passed: ${tracked.length} tracked files and the build contain no personal exports or privileged credentials.`);
