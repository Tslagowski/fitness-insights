// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let database: PGlite;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database.close(); });
const asOwner = <T>(action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);
const noteId = 'd0000000-0000-4000-8000-000000000001';
const insert = (version: number, body: string, extra = '') =>
  database.query(`insert into public.owner_notes (note_id, version, start_date, end_date, body, category${extra ? ', removed' : ''}) values ($1, $2, '2026-09-01', '2026-09-07', $3, 'Travel'${extra ? `, ${extra}` : ''})`, [noteId, version, body]);

test('notes are append-only, versioned, checked, and owner-only', async () => {
  await asOwner(async () => {
    await insert(1, 'Trip to Denver');
    await insert(2, 'Trip to Denver and Boulder');
    await expect(insert(2, 'duplicate version')).rejects.toThrow();
    await expect(insert(3, '   ')).rejects.toThrow();
    await expect(database.query("insert into public.owner_notes (note_id, version, start_date, end_date, body) values ($1, 1, '2026-09-07', '2026-09-01', 'x')", ['d0000000-0000-4000-8000-000000000002'])).rejects.toThrow();
    await expect(database.query("insert into public.owner_notes (note_id, version, start_date, end_date, body, category) values ($1, 1, '2026-09-01', '2026-09-01', 'x', 'Party')", ['d0000000-0000-4000-8000-000000000003'])).rejects.toThrow();
    await expect(database.query("update public.owner_notes set body = 'rewritten'")).rejects.toThrow(/permission denied/);
    await expect(database.query('delete from public.owner_notes')).rejects.toThrow(/permission denied/);
    await insert(3, 'Trip to Denver and Boulder', 'true');
    expect((await database.query('select version, removed from public.owner_notes order by version')).rows).toEqual([
      { version: 1, removed: false }, { version: 2, removed: false }, { version: 3, removed: true }]);
  });
  await asIdentity(database, 'authenticated', strangerId, async () => {
    expect((await database.query('select * from public.owner_notes')).rows).toEqual([]);
    await expect(database.query("insert into public.owner_notes (note_id, version, start_date, end_date, body) values ($1, 9, '2026-09-01', '2026-09-01', 'mine')", [noteId])).rejects.toThrow();
  });
  await asIdentity(database, 'anon', '', async () => {
    await expect(database.query('select * from public.owner_notes')).rejects.toThrow(/permission denied/);
  });
});

test('backups include every note version; a backup made before notes existed restores none', async () => {
  const backup = await asOwner(async () => (await database.query<{ result: { tables: Record<string, unknown[]>; workspace_state: unknown } }>('select public.export_backup() as result')).rows[0].result);
  expect(backup.tables.owner_notes).toHaveLength(3);
  const restoreId = 'c0000000-0000-4000-8000-000000000009';
  const older = Object.fromEntries(Object.entries(backup.tables).filter(([table]) => table !== 'owner_notes'));
  await asOwner(async () => {
    for (const [table, rows] of Object.entries(older)) await database.query('select public.stage_restore_chunk($1, $2, 0, $3)', [restoreId, table, JSON.stringify(rows)]);
    const counts = Object.fromEntries(Object.entries(older).map(([table, rows]) => [table, (rows as unknown[]).length]));
    await database.query('select public.apply_restore($1, null, $2, false)', [restoreId, JSON.stringify({ schema_version: 1, counts, workspace_state: backup.workspace_state })]);
    expect((await database.query('select * from public.owner_notes')).rows).toEqual([]);
  });
  const full = 'c0000000-0000-4000-8000-000000000010';
  await asOwner(async () => {
    for (const [table, rows] of Object.entries(backup.tables)) await database.query('select public.stage_restore_chunk($1, $2, 0, $3)', [full, table, JSON.stringify(rows)]);
    const counts = Object.fromEntries(Object.entries(backup.tables).map(([table, rows]) => [table, rows.length]));
    await database.query('select public.apply_restore($1, null, $2, false)', [full, JSON.stringify({ schema_version: 1, counts, workspace_state: backup.workspace_state })]);
    expect((await database.query('select count(*)::int as count from public.owner_notes')).rows).toEqual([{ count: 3 }]);
  });
});
