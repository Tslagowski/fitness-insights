import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  defaultPreferences, StaleRevisionError, type DisplayDensity, type Gateway, type ImportCommitRequest,
  type ImportCommitResult, type ImportedHistory, type Preferences,
} from './gateway';
import type { DailyDomain, DailyValues } from './import/workbook';

const archiveBucket = 'source-archives';

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
    async loadHistory(): Promise<ImportedHistory> {
      const { data, error } = await client.rpc('active_history');
      if (error) throw error;
      if (!data) throw new Error('Saved history is unavailable for this account.');
      return decodeHistory(data);
    },
    async commitImport(request: ImportCommitRequest): Promise<ImportCommitResult> {
      // Content-addressed and immutable: re-uploading the same file is harmless.
      const { error: uploadError } = await client.storage.from(archiveBucket).upload(
        `workbooks/${request.file.sha256}.xlsx`,
        new Blob([request.file.bytes as BlobPart], { type: request.file.mediaType }),
        { contentType: request.file.mediaType, upsert: false },
      );
      if (uploadError && !isAlreadyStored(uploadError)) throw uploadError;
      const { data, error } = await client.rpc('commit_import', {
        p_request_id: request.requestId,
        p_expected_revision_id: request.expectedRevisionId,
        p_source: { sha256: request.file.sha256, file_name: request.file.name, byte_size: request.file.byteSize, media_type: request.file.mediaType },
        p_records: request.records.map((record) => ({ date: record.date, domain: record.domain, fields: record.values })),
      });
      if (error) {
        if (error.code === 'FI409') throw new StaleRevisionError(error.message);
        throw error;
      }
      const result = data as Record<string, unknown>;
      return {
        outcome: result.outcome === 'changed' ? 'changed' : 'unchanged',
        replayed: result.replayed === true,
        revisionId: typeof result.revision_id === 'number' ? result.revision_id : null,
        added: Number(result.added), changed: Number(result.changed), unchanged: Number(result.unchanged),
      };
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

function isAlreadyStored(error: { message?: string; status?: number; statusCode?: string }): boolean {
  return error.status === 409 || error.statusCode === '409' || /already exists/i.test(error.message ?? '');
}

function decodeHistory(value: unknown): ImportedHistory {
  const history = value as { revision_id: number | null; records: Array<Record<string, unknown>>; imports: Array<Record<string, unknown>> };
  return {
    revisionId: history.revision_id ?? null,
    records: history.records.map((record) => ({
      date: String(record.date),
      domain: record.domain as DailyDomain,
      values: record.fields as DailyValues,
      sourceFileId: String(record.source_file_id),
      revisionId: Number(record.revision_id),
    })),
    imports: history.imports.map((item) => ({
      id: String(item.id),
      committedAt: String(item.committed_at),
      outcome: item.outcome === 'changed' ? 'changed' : 'unchanged',
      revisionId: typeof item.revision_id === 'number' ? item.revision_id : null,
      added: Number(item.added), changed: Number(item.changed), unchanged: Number(item.unchanged),
      firstDate: (item.first_date as string | null) ?? null,
      lastDate: (item.last_date as string | null) ?? null,
      fileName: String(item.file_name),
      byteSize: Number(item.byte_size),
    })),
  };
}
