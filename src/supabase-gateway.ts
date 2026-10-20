import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { defaultPreferences, type DisplayDensity, type Gateway, type Preferences } from './gateway';

function decodePreferences(value: unknown): Preferences {
  const record = value as Record<string, unknown> | null;
  if (!record || !['compact', 'comfortable'].includes(String(record.display_density)) ||
      record.timezone !== 'America/Denver' || record.week_starts_on !== 1) {
    throw new Error('Unsupported saved preference values.');
  }
  return { displayDensity: record.display_density as DisplayDensity, timezone: 'America/Denver', weekStartsOn: 1 };
}

export function createGateway(url: string, publishableKey: string, redirectUrl: string): Gateway {
  const client = createClient(url, publishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return supabaseGateway(client, redirectUrl);
}

export function supabaseGateway(client: SupabaseClient, redirectUrl: string): Gateway {
  return {
    async getIdentity() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) return null;
      const user = data.session.user;
      return { id: user.id, name: String(user.user_metadata.user_name || user.user_metadata.name || 'owner') };
    },
    async isOwner() {
      const { data, error } = await client.rpc('is_app_owner');
      if (error) throw error;
      return data === true;
    },
    async loadPreferences(userId) {
      const { data, error } = await client.from('preferences')
        .select('display_density,timezone,week_starts_on').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data ? decodePreferences(data) : { ...defaultPreferences };
    },
    async savePreferences(userId, density) {
      const { data, error } = await client.from('preferences')
        .upsert({ user_id: userId, display_density: density }, { onConflict: 'user_id' })
        .select('display_density,timezone,week_starts_on').single();
      if (error) throw error;
      return decodePreferences(data);
    },
    async signIn() {
      const { error } = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: redirectUrl } });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
    onIdentityChange(listener) {
      const pending = new Set<ReturnType<typeof setTimeout>>();
      const { data } = client.auth.onAuthStateChange(() => {
        // Auth callbacks run under an auth lock. Defer any subsequent auth calls.
        const timer = setTimeout(() => { pending.delete(timer); listener(); }, 0);
        pending.add(timer);
      });
      return () => { data.subscription.unsubscribe(); pending.forEach(clearTimeout); };
    },
  };
}
