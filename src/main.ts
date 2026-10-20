import { createApp } from 'vue';
import App from './App.vue';
import { createGateway } from './supabase-gateway';
import type { Gateway } from './gateway';
import './style.css';

let gateway: Gateway | null = null;
let configurationProblem = '';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
try {
  if (!url || !key) throw new Error('Connect your Supabase project to enable sign-in and saved preferences.');
  if (!key.startsWith('sb_publishable_')) throw new Error('Use a Supabase publishable key for this app.');
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) {
    throw new Error('The Supabase project URL must use HTTPS.');
  }
  const redirectUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  gateway = createGateway(url, key, redirectUrl);
} catch (error) {
  configurationProblem = error instanceof Error ? error.message : 'Check your workspace configuration.';
}
createApp(App, { gateway, configurationProblem }).mount('#app');
