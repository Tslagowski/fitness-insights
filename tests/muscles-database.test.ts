// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let database: PGlite;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database.close(); });
const asOwner = <T>(action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);
const call = async <T = Record<string, unknown>>(sql: string, parameters: unknown[] = []) => (await database.query<{ result: T }>(`select ${sql} as result`, parameters)).rows[0].result;

test('the exercise-to-muscle mapping is owner-only and checked against the muscle list', async () => {
  await asOwner(async () => {
    await database.query("insert into public.exercise_muscles (exercise_name, primary_muscle, secondary_muscles) values ('Bench Press', 'Chest', '{Triceps,Front Delts}')");
    await expect(database.query("insert into public.exercise_muscles (exercise_name, primary_muscle) values ('Row', 'Wings')")).rejects.toThrow();
    await expect(database.query("insert into public.exercise_muscles (exercise_name, primary_muscle, secondary_muscles) values ('Row', 'Lats', '{Lats}')")).rejects.toThrow();
    await expect(database.query("insert into public.exercise_muscles (exercise_name, primary_muscle, secondary_muscles) values ('Row', 'Lats', '{Gills}')")).rejects.toThrow();
    await database.query("update public.exercise_muscles set secondary_muscles = '{Triceps}' where exercise_name = 'Bench Press'");
  });
  await asIdentity(database, 'authenticated', strangerId, async () => {
    expect((await database.query('select * from public.exercise_muscles')).rows).toEqual([]);
    await expect(database.query("insert into public.exercise_muscles (exercise_name, primary_muscle) values ('Row', 'Lats')")).rejects.toThrow();
    expect((await database.query("update public.exercise_muscles set primary_muscle = 'Lats' returning *")).rows).toEqual([]);
  });
  await asIdentity(database, 'anon', '', async () => {
    await expect(database.query('select * from public.exercise_muscles')).rejects.toThrow(/permission denied/);
  });
  await asOwner(async () => {
    expect((await database.query('select primary_muscle, secondary_muscles from public.exercise_muscles')).rows).toEqual([{ primary_muscle: 'Chest', secondary_muscles: ['Triceps'] }]);
  });
});

test('stall comparisons and secondary credit are bounded owner settings', async () => {
  await asOwner(async () => {
    await database.query('insert into public.preferences (user_id, stall_comparisons, secondary_set_credit) values ($1, 4, 0.5)', [ownerId]);
    await expect(database.query('update public.preferences set stall_comparisons = 1')).rejects.toThrow();
    await expect(database.query('update public.preferences set secondary_set_credit = 0.3')).rejects.toThrow();
    expect((await database.query('select stall_comparisons, secondary_set_credit from public.preferences')).rows).toEqual([{ stall_comparisons: 4, secondary_set_credit: '0.5' }]);
  });
});

test('backups include the mapping, and an older backup without it restores with an empty mapping', async () => {
  const backup = await asOwner(() => call<{ tables: Record<string, Array<Record<string, unknown>>>; workspace_state: Record<string, unknown> }>('public.export_backup()'));
  expect(backup.tables.exercise_muscles).toEqual([expect.objectContaining({ exercise_name: 'Bench Press', primary_muscle: 'Chest' })]);
  const restoreId = 'c0000000-0000-4000-8000-000000000001';
  const older = Object.fromEntries(Object.entries(backup.tables).filter(([table]) => table !== 'exercise_muscles'));
  await asOwner(async () => {
    for (const [table, rows] of Object.entries(older)) await call('public.stage_restore_chunk($1, $2, 0, $3)', [restoreId, table, JSON.stringify(rows)]);
    const counts = Object.fromEntries(Object.entries(older).map(([table, rows]) => [table, rows.length]));
    const result = await call<{ counts: Record<string, number> }>('public.apply_restore($1, $2, $3, false)', [restoreId, null,
      JSON.stringify({ schema_version: 1, counts, workspace_state: backup.workspace_state })]);
    expect(result.counts.exercise_muscles).toBe(0);
    expect((await database.query('select * from public.exercise_muscles')).rows).toEqual([]);
  });
});
