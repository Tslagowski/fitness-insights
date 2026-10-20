import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';

export const ownerId = '11111111-1111-4111-8111-111111111111';
export const strangerId = '22222222-2222-4222-8222-222222222222';

/**
 * An embedded PostgreSQL database with representative Supabase roles and auth claims,
 * running the real migrations. Storage (Supabase-only) is not part of this database.
 * Application tables are reassigned to an ordinary role without superuser or
 * BYPASSRLS so row-level security behaves as it does for Supabase's table owner.
 */
export async function createTestDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role table_owner nosuperuser nobypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${ownerId}'), ('${strangerId}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated, table_owner;
    grant execute on all functions in schema auth to anon, authenticated, table_owner;
    grant usage on schema public to table_owner;
  `);
  // Every migration except the Supabase-only Storage setup, in filename order, as the workflow applies them.
  const migrations = (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql') && !name.includes('storage')).sort();
  for (const name of migrations) await database.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  await database.exec(`
    do $$
    declare item record;
    begin
      for item in select tablename from pg_tables where schemaname = 'public' and tablename <> 'preferences' loop
        execute format('alter table public.%I owner to table_owner', item.tablename);
      end loop;
      for item in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.prosecdef and p.proname <> 'is_app_owner' loop
        execute format('alter function %s owner to table_owner', item.signature);
      end loop;
    end $$;
    grant create on schema public to table_owner;
    -- On Supabase one role (postgres) owns every function; mirror that ability here.
    grant execute on all functions in schema public to table_owner;
    insert into private.app_owner (user_id) values ('${ownerId}');
  `);
  return database;
}

export async function asIdentity<T>(database: PGlite, role: string, userId: string, action: () => Promise<T>, provider = 'github'): Promise<T> {
  await database.exec(`set role ${role}`);
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await database.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ app_metadata: { provider } })]);
  try { return await action(); } finally { await database.exec('reset role'); }
}
