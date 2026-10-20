import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const base = environment.VITE_BASE_PATH || '/';
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) {
    throw new Error('VITE_BASE_PATH must be a root-relative path ending with a slash.');
  }
  const publicKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (publicKey && !publicKey.startsWith('sb_publishable_')) {
    throw new Error('Only a Supabase publishable key may be included in the frontend.');
  }
  return {
    plugins: [vue()],
    base,
    server: {
      // Development only: allow Tailscale MagicDNS and Bonjour (.local) names so the
      // dev server can be opened from a phone. Raw IP addresses are always allowed.
      allowedHosts: ['.ts.net', '.local'],
      // Opt-in polling for setups where file-change events are not delivered.
      watch: environment.VITE_WATCH_POLLING === '1' ? { usePolling: true, interval: 300 } : undefined,
    },
  };
});
