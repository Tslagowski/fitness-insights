// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let source: PGlite;
let target: PGlite;
beforeAll(async () => { [source, target] = await Promise.all([createTestDatabase(), createTestDatabase()]); });
afterAll(async () => { await Promise.all([source.close(), target.close()]); });

let counter = 0;
const requestId = () => `b0000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const asOwner = <T>(database: PGlite, action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);
async function call<T = Record<string, unknown>>(database: PGlite, sql: string, parameters: unknown[] = []): Promise<T> {
  return (await database.query<{ result: T }>(`select ${sql} as result`, parameters)).rows[0].result;
}
const revision = async (database: PGlite) => (await database.query<{ id: number | null }>('select active_revision_id as id from public.workspace_state')).rows[0].id;
const sources = [
  { kind: 'workbook', sha256: 'a'.repeat(64), file_name: 'MacroFactor.xlsx', byte_size: 10, media_type: 'x' },
  { kind: 'food_csv', sha256: 'b'.repeat(64), file_name: 'food.csv', byte_size: 10, media_type: 'text/csv' },
  { kind: 'workout_csv', sha256: 'c'.repeat(64), file_name: 'workouts.csv', byte_size: 10, media_type: 'text/csv' },
];
const daily = (date: string, pounds: number) => [{ date, domain: 'scale_weight', fields: { 'Weight (lb)': pounds } }, { date, domain: 'nutrition_totals', fields: { 'Calories (kcal)': 2000 } }];
const entry = { Time: '8:00 AM', 'Food Name': 'Oats', 'Calories (kcal)': 1000 };
const set = { 'Workout Duration': 2912, Workout: 'Push A', Exercise: 'Dumbbell Press', 'Set Type': 'Standard Set', 'Weight (lb)': 60, Reps: 10 };

type Backup = { schema_version: number; tables: Record<string, Array<Record<string, unknown>>>; workspace_state: Record<string, number | null> };
/** Uploads every table in chunks of `size` rows, as the app does, optionally skipping one chunk. */
async function stage(database: PGlite, restoreId: string, backup: Backup, options: { size?: number; skip?: string } = {}) {
  for (const [table, rows] of Object.entries(backup.tables)) {
    const size = options.size ?? 2;
    for (let chunk = 0; chunk * size < Math.max(rows.length, 1); chunk += 1) {
      if (options.skip === `${table}:${chunk}`) continue;
      await call(database, 'public.stage_restore_chunk($1, $2, $3, $4)', [restoreId, table, chunk, JSON.stringify(rows.slice(chunk * size, (chunk + 1) * size))]);
    }
  }
}
const manifest = (backup: Backup) => JSON.stringify({ schema_version: 1, counts: Object.fromEntries(Object.entries(backup.tables).map(([table, rows]) => [table, rows.length])), workspace_state: backup.workspace_state });
const sortRows = (backup: Backup) => Object.fromEntries(Object.entries(backup.tables).map(([table, rows]) => [table, rows.map((row) => JSON.stringify(row)).sort()]));

test('a backup holds every table with no user ids, and restores into a clean installation with identical history', async () => {
  const exported = await asOwner(source, async () => {
    await call(source, 'public.commit_sources($1, $2, $3, $4, $5, false, false, $6)', [requestId(), null, JSON.stringify(sources),
      JSON.stringify([...daily('2026-09-01', 181), ...daily('2026-09-02', 181)]),
      JSON.stringify([{ date: '2026-09-01', source_kind: 'food_csv', entries: [entry, entry] }]), JSON.stringify([{ date: '2026-09-01', source_kind: 'workout_csv', sets: [set, set] }])]);
    await call(source, 'public.clear_day($1, $2, $3, $4)', [requestId(), await revision(source), '2026-09-02', 'scale_weight']);
    await source.query("insert into public.review_decisions (record_date, domain, field, value, decision) values ('2026-09-01', 'scale_weight', 'Weight (lb)', 181, 'exclude')");
    await source.query("insert into public.completeness_marks (mark_date, domain, status) values ('2026-09-01', 'nutrition', 'incomplete')");
    await source.query("insert into public.exercise_aliases (source_name, display_name) values ('Dumbbell Press', 'DB Press')");
    await call(source, 'public.save_report($1, $2, $3, $4, $5, $6, $7)', ['e'.repeat(64), await revision(source), '2026-10-20', '2026-09-02', 'overview-v1',
      JSON.stringify({ revisionId: await revision(source) }), JSON.stringify({ sections: [{ id: 'intake', findings: [{ text: 'Mean intake was 2,000 kcal' }] }] })]);
    return call<Backup>(source, 'public.export_backup()');
  });
  expect(exported.schema_version).toBe(1);
  expect(exported.tables.food_days[0].entries).toEqual([entry, entry]);
  expect(exported.tables.workout_days[0].sets).toEqual([set, set]);
  expect(exported.tables.daily_records.length).toBe(4);
  expect(JSON.stringify(exported)).not.toContain(ownerId);
  expect(exported.workspace_state).toEqual({ active_revision_id: 2, retained_from_revision_id: null });

  await asOwner(target, async () => {
    const restoreId = '90000000-0000-4000-8000-000000000001';
    await stage(target, restoreId, exported);
    expect(await call(target, 'public.apply_restore($1, $2, $3, true)', [restoreId, null, manifest(exported)])).toMatchObject({ dry_run: true, counts: { daily_records: 4, reports: 1 } });
    expect(await revision(target)).toBeNull();
    await call(target, 'public.apply_restore($1, $2, $3, false)', [restoreId, null, manifest(exported)]);
    const restored = await call<Backup>(target, 'public.export_backup()');
    expect(sortRows(restored)).toEqual(sortRows(exported));
    expect(restored.workspace_state).toEqual(exported.workspace_state);
    expect(await call(target, 'public.active_history()')).toEqual(await asOwner(source, () => call(source, 'public.active_history()')));
    expect(await call(target, 'public.review_state()')).toEqual(await asOwner(source, () => call(source, 'public.review_state()')));
    expect(await call(target, 'public.capacity_status()')).toMatchObject({ staging_bytes: 0 });
    // The restored installation keeps working: undo and new imports continue after the restored ids.
    await call(target, 'public.undo_last_change($1, $2, false)', [requestId(), 2]);
    expect((await target.query<{ fields: unknown }>("select fields from public.daily_records where retired_revision_id is null and record_date = '2026-09-02' and domain = 'scale_weight'")).rows).toEqual([{ fields: { 'Weight (lb)': 181 } }]);
    await call(target, 'public.commit_sources($1, $2, $3, $4, $5, false, false, $6)', [requestId(), await revision(target), JSON.stringify([sources[0]]), JSON.stringify(daily('2026-09-03', 180)), '[]', '[]']);
    expect(await revision(target)).toBe(4);
  });
});

test('an interrupted, stale, or malformed restore changes nothing; strangers cannot back up or restore', async () => {
  const backup = await asOwner(source, () => call<Backup>(source, 'public.export_backup()'));
  await asOwner(target, async () => {
    const before = await call<Backup>(target, 'public.export_backup()');
    const restoreId = '90000000-0000-4000-8000-000000000002';
    await stage(target, restoreId, backup, { skip: 'daily_records:1' });
    await expect(call(target, 'public.apply_restore($1, $2, $3, false)', [restoreId, await revision(target), manifest(backup)])).rejects.toThrow(/incomplete \(daily_records: 2 of 4 rows\)/);
    await stage(target, restoreId, backup);
    await expect(call(target, 'public.apply_restore($1, $2, $3, false)', [restoreId, 1, manifest(backup)])).rejects.toThrow(/changed after this restore was previewed/);
    await expect(call(target, 'public.apply_restore($1, $2, $3, false)', [restoreId, await revision(target), JSON.stringify({ schema_version: 2, counts: {} })])).rejects.toThrow(/not supported/);
    expect(sortRows(await call<Backup>(target, 'public.export_backup()'))).toEqual(sortRows(before));
    expect(await call(target, 'public.discard_restore($1)', [restoreId])).toMatchObject({ removed_chunks: expect.any(Number) });
    expect(await call(target, 'public.capacity_status()')).toMatchObject({ staging_bytes: 0 });
    // Capacity reports usage against the free limits.
    expect(await call(target, 'public.capacity_status()')).toMatchObject({ database_limit_bytes: 524288000, archive_limit_bytes: 1073741824, archive_bytes: 30 });
  });
  await asIdentity(target, 'authenticated', strangerId, async () => {
    await expect(call(target, 'public.export_backup()')).rejects.toThrow(/Only the workspace owner/);
    await expect(call(target, 'public.stage_restore_chunk($1, $2, $3, $4)', ['90000000-0000-4000-8000-000000000003', 'reports', 0, '[]'])).rejects.toThrow(/Only the workspace owner/);
    await expect(call(target, 'public.capacity_status()')).rejects.toThrow(/Only the workspace owner/);
    await expect(target.query('select * from public.restore_staging')).rejects.toThrow(/permission denied/);
  });
  await asIdentity(target, 'anon', '', async () => {
    await expect(call(target, 'public.export_backup()')).rejects.toThrow(/permission denied/);
    await expect(call(target, 'public.apply_restore($1, $2, $3, false)', ['90000000-0000-4000-8000-000000000004', null, '{}'])).rejects.toThrow(/permission denied/);
  });
});
