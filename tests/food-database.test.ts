// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let database: PGlite;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database.close(); });

type Entry = Record<string, string | number>;
const workbook = { kind: 'workbook', sha256: 'a'.repeat(64), file_name: 'MacroFactor.xlsx', byte_size: 10, media_type: 'x' };
const csv = (sha = 'b') => ({ kind: 'food_csv', sha256: sha.repeat(64), file_name: 'food.csv', byte_size: 10, media_type: 'text/csv' });
const entry = (name: string, calories?: number): Entry => ({ Time: '8:00 AM', 'Food Name': name, 'Serving Size': 'serving', ...(calories === undefined ? {} : { 'Calories (kcal)': calories }) });
const foodDay = (date: string, source: string, entries: Entry[]) => ({ date, source_kind: source, entries });
const totals = (date: string, calories: number) => ({ date, domain: 'nutrition_totals', fields: { 'Calories (kcal)': calories } });
const weight = (date: string, pounds: number) => ({ date, domain: 'scale_weight', fields: { 'Weight (lb)': pounds } });

let counter = 0;
const requestId = () => `f0000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const asOwner = <T>(action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);
async function call<T = Record<string, unknown>>(sql: string, parameters: unknown[]): Promise<T> {
  return (await database.query<{ result: T }>(`select ${sql} as result`, parameters)).rows[0].result;
}
const revision = async () => (await database.query<{ id: number | null }>('select active_revision_id as id from public.workspace_state')).rows[0].id;
function commit(sources: unknown[], daily: unknown[], food: unknown[], options: { accept?: boolean; dryRun?: boolean; expected?: number | null; id?: string } = {}) {
  return (options.expected === undefined ? revision() : Promise.resolve(options.expected)).then((expected) => call('public.commit_sources($1, $2, $3, $4, $5, $6, $7)', [
    options.dryRun ? null : options.id ?? requestId(), expected,
    JSON.stringify(sources), JSON.stringify(daily), JSON.stringify(food), options.accept ?? false, options.dryRun ?? false]));
}
async function activeFood() {
  const { rows } = await database.query<{ day: string; source_kind: string; entries: Entry[] }>(
    "select to_char(food_date, 'YYYY-MM-DD') as day, source_kind, entries from public.food_days where retired_revision_id is null order by food_date");
  return Object.fromEntries(rows.map((row) => [row.day, { source: row.source_kind, entries: row.entries }]));
}
async function activeDaily() {
  return (await database.query("select record_date from public.daily_records where retired_revision_id is null")).rows.length;
}

test('a workbook plus food CSV import previews without writing, then commits daily records and food days together', async () => {
  await asOwner(async () => {
    const sources = [workbook, csv()];
    const daily = [weight('2026-09-01', 181), totals('2026-09-01', 300), weight('2026-09-02', 180), totals('2026-09-02', 140)];
    const food = [
      foodDay('2026-09-01', 'food_csv', [entry('Egg', 70), entry('Egg', 70), entry('Toast', 160)]),
      foodDay('2026-09-02', 'food_csv', [entry('Apple', 95), entry('Mystery')]),
    ];
    const preview = await commit(sources, daily, food, { dryRun: true });
    expect(preview).toMatchObject({ added: 4, food_added: 2, food_changed: 0, conflicts: [{ date: '2026-09-02', detail_calories: 95, workbook_calories: 140 }] });
    expect(await revision()).toBeNull();

    await expect(commit(sources, daily, food)).rejects.toMatchObject({ code: 'FI422' });
    expect(await activeFood()).toEqual({});

    const result = await commit(sources, daily, food, { accept: true });
    expect(result).toMatchObject({ kind: 'import', outcome: 'changed', revision_id: 1, added: 4, food_added: 2 });
    const saved = await activeFood();
    expect(saved['2026-09-01'].entries).toHaveLength(3);
    expect(saved['2026-09-01'].entries[0]).toEqual(saved['2026-09-01'].entries[1]);
    expect(saved['2026-09-02'].entries[1]).not.toHaveProperty('Calories (kcal)');
    const batch = (await database.query<{ reconciliation: unknown[]; sources: number }>(
      'select reconciliation, (select count(*)::int from public.import_batch_sources where batch_id = b.id) as sources from public.import_batches b')).rows[0];
    expect(batch.reconciliation).toHaveLength(1);
    expect(batch.sources).toBe(2);
  });
});

test('reimporting the same food is unchanged, and a food-only import never touches daily records or absent dates', async () => {
  await asOwner(async () => {
    const same = await commit([csv()], [], [foodDay('2026-09-01', 'food_csv', [entry('Egg', 70), entry('Egg', 70), entry('Toast', 160)])]);
    expect(same).toMatchObject({ outcome: 'unchanged', food_unchanged: 1, revision_id: 1 });

    const corrected = await commit([csv('c')], [], [foodDay('2026-09-02', 'food_csv', [entry('Apple', 95), entry('Yogurt', 45)])]);
    expect(corrected).toMatchObject({ outcome: 'changed', food_changed: 1, food_added: 0, added: 0, conflicts: [] });
    expect(await activeDaily()).toBe(4);
    const saved = await activeFood();
    expect(Object.keys(saved)).toEqual(['2026-09-01', '2026-09-02']);
    expect(saved['2026-09-02'].entries.map((item) => item['Food Name'])).toEqual(['Apple', 'Yogurt']);
  });
});

test('workbook Food Log detail fills dates without CSV detail but never replaces CSV detail', async () => {
  await asOwner(async () => {
    const result = await commit([workbook], [totals('2026-09-03', 500)], [
      foodDay('2026-09-01', 'workbook_food_log', [entry('Workbook egg', 70)]),
      foodDay('2026-09-03', 'workbook_food_log', [entry('Workbook lunch', 498)]),
    ]);
    expect(result).toMatchObject({ outcome: 'changed', food_kept: 1, food_added: 1, conflicts: [] });
    const saved = await activeFood();
    expect(saved['2026-09-01']).toMatchObject({ source: 'food_csv' });
    expect(saved['2026-09-01'].entries[0]['Food Name']).toBe('Egg');
    expect(saved['2026-09-03']).toMatchObject({ source: 'workbook_food_log' });

    const csvLater = await commit([csv('d')], [], [foodDay('2026-09-03', 'food_csv', [entry('CSV lunch', 502)])]);
    expect(csvLater).toMatchObject({ food_changed: 1, conflicts: [] });
    expect((await activeFood())['2026-09-03']).toMatchObject({ source: 'food_csv' });
  });
});

test('food days can be cleared and undone, and undoing a combined import restores both kinds of records', async () => {
  await asOwner(async () => {
    const before = await activeFood();
    const current = await revision();
    await call('public.clear_day($1, $2, $3, $4)', [requestId(), current, '2026-09-02', 'food_entries']);
    expect(Object.keys(await activeFood())).toEqual(['2026-09-01', '2026-09-03']);
    expect(await activeDaily()).toBe(5);
    await call('public.undo_last_change($1, $2, false)', [requestId(), await revision()]);
    expect(await activeFood()).toEqual(before);

    // Step back through the CSV-after-workbook, workbook, correction, and first imports.
    for (let step = 0; step < 4; step += 1) await call('public.undo_last_change($1, $2, false)', [requestId(), await revision()]);
    expect(await activeFood()).toEqual({});
    expect(await activeDaily()).toBe(0);
  });
});

test('invalid combinations are rejected whole', async () => {
  await asOwner(async () => {
    const current = await revision();
    await expect(commit([workbook], [], [foodDay('2026-09-05', 'food_csv', [entry('x', 1)])])).rejects.toMatchObject({ code: '22023' });
    await expect(commit([csv()], [weight('2026-09-05', 1)], [])).rejects.toMatchObject({ code: '22023' });
    await expect(commit([csv()], [], [foodDay('2026-09-05', 'food_csv', [{ nested: { a: 1 } } as unknown as Entry])])).rejects.toThrow(/unsupported/);
    await expect(commit([csv(), csv('e')], [], [])).rejects.toMatchObject({ code: '22023' });
    await expect(commit([csv()], [], [foodDay('2026-09-05', 'food_csv', []), foodDay('2026-09-05', 'food_csv', [])])).rejects.toThrow(/repeats a date/);
    expect(await revision()).toBe(current);
  });
});

test('food detail is private to the owner and only writable through the commit', async () => {
  await asOwner(async () => { await commit([csv()], [], [foodDay('2026-09-09', 'food_csv', [entry('Owner food', 10)])]); });
  const current = await asOwner(revision);
  await asIdentity(database, 'authenticated', strangerId, async () => {
    expect((await database.query('select * from public.food_days')).rows).toEqual([]);
    expect((await database.query('select * from public.import_batch_sources')).rows).toEqual([]);
    expect(await call('public.food_day_entries($1)', ['2026-09-09'])).toBeNull();
    await expect(commit([csv('f')], [], [foodDay('2026-09-10', 'food_csv', [entry('x', 1)])], { expected: current })).rejects.toMatchObject({ code: '42501' });
  });
  await asIdentity(database, 'anon', '', async () => {
    await expect(database.query('select * from public.food_days')).rejects.toThrow(/permission denied/);
    await expect(call('public.food_day_entries($1)', ['2026-09-09'])).rejects.toThrow(/permission denied/);
  });
  await asOwner(async () => {
    expect(await call<{ entries: Entry[] }>('public.food_day_entries($1)', ['2026-09-09'])).toMatchObject({ source_kind: 'food_csv', entries: [{ 'Food Name': 'Owner food' }] });
    await expect(database.query('delete from public.food_days')).rejects.toThrow(/permission denied/);
    const history = await call<{ food_days: Array<{ date: string; calories: number; missing_calories: number }> }>('public.active_history()', []);
    expect(history.food_days).toEqual([expect.objectContaining({ date: '2026-09-09', calories: 10, missing_calories: 0, entries: 1, source_kind: 'food_csv' })]);
  });
});

test('food-level analysis reads every active food day in one owner-only call', async () => {
  await asOwner(async () => {
    const days = await call<Array<{ date: string; entries: Entry[] }>>('public.active_food_entries()', []);
    const active = await activeFood();
    expect(days.length).toBe(Object.keys(active).length);
    expect(days.map((item) => item.date)).toEqual([...days.map((item) => item.date)].sort());
    expect(Object.fromEntries(days.map((item) => [item.date, item.entries]))).toEqual(Object.fromEntries(Object.entries(active).map(([date, value]) => [date, value.entries])));
  });
  await asIdentity(database, 'authenticated', strangerId, async () => {
    expect(await call('public.active_food_entries()', [])).toEqual([]);
  });
  await asIdentity(database, 'anon', '', async () => {
    await expect(call('public.active_food_entries()', [])).rejects.toThrow(/permission denied/);
  });
});
