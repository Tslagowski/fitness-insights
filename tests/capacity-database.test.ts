// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let database: PGlite;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database.close(); });

let counter = 0;
const requestId = () => `c0000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const asOwner = <T>(action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);
async function call<T = Record<string, unknown>>(sql: string, parameters: unknown[] = []): Promise<T> {
  return (await database.query<{ result: T }>(`select ${sql} as result`, parameters)).rows[0].result;
}
const revision = async () => (await database.query<{ id: number | null }>('select active_revision_id as id from public.workspace_state')).rows[0].id;
const workbook = (index: number) => ({ kind: 'workbook', sha256: index.toString(16).padStart(64, '0'), file_name: `export-${index}.xlsx`, byte_size: 10, media_type: 'x' });
async function importSteps(index: number, id = requestId()) {
  return call('public.commit_sources($1, $2, $3, $4, $5, false, false, $6)', [id, await revision(), JSON.stringify([workbook(index)]),
    JSON.stringify([{ date: '2026-09-01', domain: 'steps', fields: { Steps: 8000 + index } }]), '[]', '[]']);
}
const steps = async () => (await database.query<{ fields: Record<string, number> }>("select fields from public.daily_records where retired_revision_id is null and domain = 'steps'")).rows;
const setLimit = (bytes: number) => database.query('update private.capacity_limits set database_limit_bytes = $1', [bytes]);

test('above the hard stop the database refuses new history but never blocks recovering space; usage is reported', async () => {
  await asOwner(async () => {
    for (let index = 1; index <= 14; index += 1) await importSteps(index);
    const status = await call<Record<string, number>>('public.capacity_status()');
    expect(status).toMatchObject({ database_limit_bytes: 524288000, archive_limit_bytes: 1073741824, hard_stop_fraction: 0.95, staging_uploads: 0 });
    expect(status.database_bytes).toBeGreaterThan(0);
  });
  await setLimit(1);
  await asOwner(async () => {
    const lostResponseId = requestId();
    // A request refused for capacity never commits, so retrying it later is safe.
    await expect(importSteps(15, lostResponseId)).rejects.toThrow(/nearly full, so nothing new was saved/);
    expect(await steps()).toEqual([{ fields: { Steps: 8014 } }]);
    await expect(call('public.save_report($1, $2, $3, $4, $5, $6, $7)', ['a'.repeat(64), await revision(), '2026-10-20', null, 'overview-v1',
      JSON.stringify({ revisionId: await revision() }), '{}'])).rejects.toThrow(/nearly full/);
    await expect(call('public.stage_restore_chunk($1, $2, $3, $4)', ['90000000-0000-4000-8000-000000000001', 'reports', 0, '[]'])).rejects.toThrow(/nearly full/);
    // Freeing space is always allowed.
    expect(await call('public.prune_history($1, false, 12)', [await revision()])).toMatchObject({ daily_records: 1 });
  });
  await setLimit(524288000);
  await asOwner(async () => {
    // After space is recovered, retrying the same request id saves once; repeating it replays.
    const id = requestId();
    expect(await importSteps(15, id)).toMatchObject({ outcome: 'changed', replayed: false });
    expect(await importSteps(15, id)).toMatchObject({ replayed: true });
    expect(await steps()).toEqual([{ fields: { Steps: 8015 } }]);
  });
});

test('only restore uploads older than ten minutes can be cleaned up, and only by the owner', async () => {
  await asOwner(async () => {
    await call('public.stage_restore_chunk($1, $2, $3, $4)', ['90000000-0000-4000-8000-000000000002', 'reports', 0, '[]']);
    await call('public.stage_restore_chunk($1, $2, $3, $4)', ['90000000-0000-4000-8000-000000000003', 'reports', 0, '[]']);
  });
  await database.query("update public.restore_staging set created_at = now() - interval '2 hours' where restore_id = '90000000-0000-4000-8000-000000000002'");
  await asOwner(async () => {
    await expect(call("public.discard_stale_restores(interval '1 minute')")).rejects.toThrow(/older than 10 minutes/);
    expect(await call('public.capacity_status()')).toMatchObject({ staging_uploads: 2 });
    expect(await call('public.discard_stale_restores()')).toEqual({ removed_uploads: 1, removed_chunks: 1 });
    expect(await call('public.capacity_status()')).toMatchObject({ staging_uploads: 1 });
    expect(await steps()).toEqual([{ fields: { Steps: 8015 } }]);
  });
  await asIdentity(database, 'authenticated', strangerId, async () => {
    await expect(call('public.discard_stale_restores()')).rejects.toThrow(/Only the workspace owner/);
  });
  await asIdentity(database, 'anon', '', async () => {
    await expect(call('public.discard_stale_restores()')).rejects.toThrow(/permission denied/);
    await expect(database.query('select * from private.capacity_limits')).rejects.toThrow(/permission denied/);
  });
});
