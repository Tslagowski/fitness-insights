// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let database: PGlite;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database.close(); });

type WorkoutSet = Record<string, string | number>;
const workbook = { kind: 'workbook', sha256: 'a'.repeat(64), file_name: 'MacroFactor.xlsx', byte_size: 10, media_type: 'x' };
const workoutCsv = (sha = 'c') => ({ kind: 'workout_csv', sha256: sha.repeat(64), file_name: 'workouts.csv', byte_size: 10, media_type: 'text/csv' });
const set = (exercise: string, values: WorkoutSet = {}): WorkoutSet => ({ 'Workout Duration': 2912, Workout: 'Push A', Exercise: exercise, 'Set Type': 'Standard Set', ...values });
const day = (date: string, source: string, sets: WorkoutSet[]) => ({ date, source_kind: source, sets });

let counter = 0;
const requestId = () => `w0000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`.replace('w', 'a');
const asOwner = <T>(action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);
async function call<T = Record<string, unknown>>(sql: string, parameters: unknown[]): Promise<T> {
  return (await database.query<{ result: T }>(`select ${sql} as result`, parameters)).rows[0].result;
}
const revision = async () => (await database.query<{ id: number | null }>('select active_revision_id as id from public.workspace_state')).rows[0].id;
async function commit(sources: unknown[], workouts: unknown[], options: { dryRun?: boolean; daily?: unknown[]; expected?: number | null } = {}) {
  const expected = options.expected === undefined ? await revision() : options.expected;
  return call('public.commit_sources($1, $2, $3, $4, $5, false, $6, $7)', [options.dryRun ? null : requestId(), expected,
    JSON.stringify(sources), JSON.stringify(options.daily ?? []), '[]', options.dryRun ?? false, JSON.stringify(workouts)]);
}
async function activeWorkouts() {
  const { rows } = await database.query<{ day: string; source_kind: string; sets: WorkoutSet[] }>(
    "select to_char(workout_date, 'YYYY-MM-DD') as day, source_kind, sets from public.workout_days where retired_revision_id is null order by workout_date");
  return Object.fromEntries(rows.map((row) => [row.day, { source: row.source_kind, sets: row.sets }]));
}

test('a workout-only import saves sets exactly as logged, with repeats, and reimporting changes nothing', async () => {
  await asOwner(async () => {
    const sets = [
      set('Dumbbell Curl', { 'Weight (lb)': 30, Reps: 12, RIR: 2 }), set('Dumbbell Curl', { 'Weight (lb)': 30, Reps: 12, RIR: 2 }),
      set('Machine-Assisted Pull-Up', { 'Weight (lb)': -100, Reps: 6, 'Set Type': 'Failure Set', RIR: 0 }),
      set('Hack Squat', { 'Exercise Base Weight (lb)': 100, 'Weight (lb)': 90, Reps: 10 }),
      set('Side Plank', { Duration: 60 }),
    ];
    const preview = await commit([workoutCsv()], [day('2026-09-01', 'workout_csv', sets), day('2026-09-02', 'workout_csv', [set('Row', { 'Weight (lb)': 100, Reps: 8 })])], { dryRun: true });
    expect(preview).toMatchObject({ workout_added: 2, workout_changed: 0, added: 0, food_added: 0 });
    expect(await revision()).toBeNull();

    const result = await commit([workoutCsv()], [day('2026-09-01', 'workout_csv', sets), day('2026-09-02', 'workout_csv', [set('Row', { 'Weight (lb)': 100, Reps: 8 })])]);
    expect(result).toMatchObject({ outcome: 'changed', workout_added: 2 });
    const saved = await activeWorkouts();
    expect(saved['2026-09-01'].sets).toEqual(sets);
    expect(saved['2026-09-01'].sets[3]['Weight (lb)']).toBe(90);

    const again = await commit([workoutCsv()], [day('2026-09-01', 'workout_csv', sets)]);
    expect(again).toMatchObject({ outcome: 'unchanged', workout_unchanged: 1 });
    expect(Object.keys(await activeWorkouts())).toEqual(['2026-09-01', '2026-09-02']);
  });
});

test('workbook Workout Log detail fills dates without CSV detail but never replaces CSV detail', async () => {
  await asOwner(async () => {
    const result = await commit([workbook], [day('2026-09-01', 'workbook_workout_log', [set('Workbook bench')]), day('2026-09-03', 'workbook_workout_log', [set('Workbook squat')])]);
    expect(result).toMatchObject({ workout_kept: 1, workout_added: 1 });
    const saved = await activeWorkouts();
    expect(saved['2026-09-01'].sets[0].Exercise).toBe('Dumbbell Curl');
    expect(saved['2026-09-03']).toMatchObject({ source: 'workbook_workout_log' });
    const corrected = await commit([workoutCsv('d')], [day('2026-09-03', 'workout_csv', [set('CSV squat')])]);
    expect(corrected).toMatchObject({ workout_changed: 1 });
    expect((await activeWorkouts())['2026-09-03']).toMatchObject({ source: 'workout_csv' });
  });
});

test('workout days can be cleared and undone, and undo steps back through workout imports', async () => {
  await asOwner(async () => {
    const before = await activeWorkouts();
    await call('public.clear_day($1, $2, $3, $4)', [requestId(), await revision(), '2026-09-02', 'workout_sets']);
    expect(Object.keys(await activeWorkouts())).toEqual(['2026-09-01', '2026-09-03']);
    await call('public.undo_last_change($1, $2, false)', [requestId(), await revision()]);
    expect(await activeWorkouts()).toEqual(before);
    for (let step = 0; step < 3; step += 1) await call('public.undo_last_change($1, $2, false)', [requestId(), await revision()]);
    expect(await activeWorkouts()).toEqual({});
  });
});

test('invalid workout payloads are rejected whole', async () => {
  await asOwner(async () => {
    const current = await revision();
    await expect(commit([workbook], [day('2026-09-05', 'workout_csv', [set('x')])])).rejects.toMatchObject({ code: '22023' });
    await expect(commit([workoutCsv()], [day('2026-09-05', 'workout_csv', [{ Exercise: { nested: true } } as unknown as WorkoutSet])])).rejects.toThrow(/unsupported/);
    await expect(commit([workoutCsv(), workoutCsv('e')], [])).rejects.toMatchObject({ code: '22023' });
    expect(await revision()).toBe(current);
  });
});

test('aliases and the duration unit are owner settings; workout data is private', async () => {
  await asOwner(async () => {
    await commit([workoutCsv()], [day('2026-09-09', 'workout_csv', [set('Hack Squat ∈ SS1')])]);
    await database.query('insert into public.exercise_aliases (source_name, display_name) values ($1, $2)', ['Hack Squat ∈ SS1', 'Hack Squat']);
    await database.query("insert into public.preferences (user_id, duration_unit) values ($1, 'minutes')", [ownerId]);
    await expect(database.query("update public.preferences set duration_unit = 'hours'")).rejects.toThrow();
    const history = await call<{ aliases: Record<string, string>; workout_days: Array<Record<string, unknown>> }>('public.active_history()', []);
    expect(history.aliases).toEqual({ 'Hack Squat ∈ SS1': 'Hack Squat' });
    expect((history as unknown as { exercise_names: unknown[] }).exercise_names).toEqual([{ name: 'Hack Squat ∈ SS1', sets: 1, days: 1 }]);
    expect(history.workout_days).toEqual([expect.objectContaining({ date: '2026-09-09', sets: 1, exercises: 1, workouts: ['Push A'], durations: [2912] })]);
    expect(await call('public.workout_day_sets($1)', ['2026-09-09'])).toMatchObject({ source_kind: 'workout_csv', sets: [{ Exercise: 'Hack Squat ∈ SS1' }] });
  });
  await asIdentity(database, 'authenticated', strangerId, async () => {
    expect((await database.query('select * from public.workout_days')).rows).toEqual([]);
    expect((await database.query('select * from public.exercise_aliases')).rows).toEqual([]);
    await expect(database.query("insert into public.exercise_aliases (source_name, display_name) values ('Row', 'Mine')")).rejects.toThrow();
    expect((await database.query("update public.exercise_aliases set display_name = 'x' returning *")).rows).toEqual([]);
    expect(await call('public.workout_day_sets($1)', ['2026-09-09'])).toBeNull();
  });
  await asIdentity(database, 'anon', '', async () => {
    await expect(database.query('select * from public.workout_days')).rejects.toThrow(/permission denied/);
    await expect(database.query('select * from public.exercise_aliases')).rejects.toThrow(/permission denied/);
    await expect(call('public.workout_day_sets($1)', ['2026-09-09'])).rejects.toThrow(/permission denied/);
  });
  await asOwner(async () => {
    expect((await database.query('select display_name from public.exercise_aliases')).rows).toEqual([{ display_name: 'Hack Squat' }]);
    await expect(database.query('delete from public.workout_days')).rejects.toThrow(/permission denied/);
  });
});

test('exercise analysis reads every active workout day in one owner-only call; the label band is a bounded setting', async () => {
  await asOwner(async () => {
    const days = await call<Array<{ date: string; sets: WorkoutSet[] }>>('public.active_workout_sets()', []);
    expect(days.length).toBeGreaterThan(0);
    expect(days.map((item) => item.date)).toEqual([...days.map((item) => item.date)].sort());
    const active = await activeWorkouts();
    expect(Object.fromEntries(days.map((item) => [item.date, item.sets]))).toEqual(Object.fromEntries(Object.entries(active).map(([date, value]) => [date, value.sets])));
    expect((await database.query<{ band: string }>('select strength_band_percent::text as band from public.preferences')).rows).toEqual([{ band: '2.5' }]);
    await database.query('update public.preferences set strength_band_percent = 5');
    await expect(database.query('update public.preferences set strength_band_percent = 0')).rejects.toThrow();
    await expect(database.query('update public.preferences set strength_band_percent = 25')).rejects.toThrow();
  });
  await asIdentity(database, 'authenticated', strangerId, async () => {
    expect(await call('public.active_workout_sets()', [])).toEqual([]);
  });
  await asIdentity(database, 'anon', '', async () => {
    await expect(call('public.active_workout_sets()', [])).rejects.toThrow(/permission denied/);
  });
});
