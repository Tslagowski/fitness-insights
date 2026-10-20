// @vitest-environment node
import { beforeAll, afterAll, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const database = new PGlite();
const ownerId = '11111111-1111-4111-8111-111111111111';
const strangerId = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  await database.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${ownerId}'), ('${strangerId}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on all functions in schema auth to anon, authenticated;
  `);
  await database.exec(await readFile('supabase/migrations/202609150001_owner_preferences.sql', 'utf8'));
  await database.exec(`insert into private.app_owner (user_id) values ('${ownerId}')`);
});
afterAll(async () => { await database.close(); });

async function asIdentity(role: string, userId: string, action: () => Promise<void>, provider = 'github') {
  await database.exec(`set role ${role}`);
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await database.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ app_metadata: { provider } })]);
  try { await action(); } finally { await database.exec('reset role'); }
}

test('only the configured GitHub owner can store and retrieve a preference', async () => {
  await asIdentity('authenticated', ownerId, async () => {
    await database.query('insert into public.preferences (user_id, display_density) values ($1, $2)', [ownerId, 'compact']);
    const { rows } = await database.query<{ display_density: string }>('select display_density from public.preferences');
    expect(rows).toEqual([{ display_density: 'compact' }]);
  });
  await asIdentity('authenticated', strangerId, async () => {
    expect((await database.query('select * from public.preferences')).rows).toEqual([]);
    await expect(database.query('insert into public.preferences (user_id) values ($1)', [strangerId])).rejects.toThrow();
    await expect(database.query('insert into public.preferences (user_id) values ($1)', [ownerId])).rejects.toThrow();
    expect((await database.query("update public.preferences set display_density = 'comfortable' returning *")).rows).toEqual([]);
    await expect(database.exec(`update private.app_owner set user_id = '${strangerId}'`)).rejects.toThrow();
  });
  await asIdentity('anon', '', async () => {
    await expect(database.query('select * from public.preferences')).rejects.toThrow();
    await expect(database.query('insert into public.preferences (user_id) values ($1)', [ownerId])).rejects.toThrow();
  });
  await asIdentity('authenticated', ownerId, async () => {
    expect((await database.query('select * from public.preferences')).rows).toEqual([]);
  }, 'email');
  await asIdentity('authenticated', ownerId, async () => {
    expect((await database.query<{ display_density: string }>('select display_density from public.preferences')).rows[0].display_density).toBe('compact');
    await expect(database.exec("update public.preferences set display_density = 'invalid'")).rejects.toThrow();
  });
});
