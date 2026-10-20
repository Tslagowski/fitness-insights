// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let database: PGlite;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database.close(); });

const domains = ['scale_weight', 'trend_weight', 'expenditure', 'nutrition_totals', 'targets', 'steps'];
type Fields = Record<string, number | null>;
function day(date: string, overrides: Record<string, Fields> = {}) {
  const defaults: Record<string, Fields> = {
    scale_weight: { 'Weight (lb)': 181 }, trend_weight: { 'Trend Weight (lb)': 180.5 }, expenditure: { Expenditure: 2500 },
    nutrition_totals: { 'Calories (kcal)': 2300 }, targets: { 'Target Calories (kcal)': 2350 }, steps: { Steps: 8000 },
  };
  return domains.map((domain) => ({ date, domain, fields: overrides[domain] ?? defaults[domain] }));
}
let requestCounter = 0;
const requestId = () => `c0000000-0000-4000-8000-${String(++requestCounter).padStart(12, '0')}`;
const asOwner = <T>(action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);

async function call<T = Record<string, unknown>>(sql: string, parameters: unknown[]): Promise<T> {
  return (await database.query<{ result: T }>(`select ${sql} as result`, parameters)).rows[0].result;
}
const importRecords = (expected: number | null, sha: string, records: unknown[]) =>
  call('public.commit_import($1, $2, $3, $4)', [requestId(), expected, JSON.stringify({ sha256: sha.repeat(64), file_name: `${sha}.xlsx`, byte_size: 10, media_type: 'x' }), JSON.stringify(records)]);
const clearDay = (expected: number | null, date: string, domain: string, id = requestId()) => call('public.clear_day($1, $2, $3, $4)', [id, expected, date, domain]);
const undo = (expected: number | null, id = requestId()) => call('public.undo_last_change($1, $2, false)', [id, expected]);
const previewUndo = (expected: number | null) => call('public.undo_last_change(null, $1, true)', [expected]);
async function active() {
  const { rows } = await database.query<{ key: string; fields: Fields }>(
    "select to_char(record_date, 'YYYY-MM-DD') || '|' || domain as key, fields from public.daily_records where retired_revision_id is null order by 1");
  return Object.fromEntries(rows.map((row) => [row.key, row.fields]));
}
async function activeRevision() {
  return (await database.query<{ id: number | null }>('select active_revision_id as id from public.workspace_state')).rows[0].id;
}

test('clearing removes one domain on one day; undo steps back through changes and restores exact records', async () => {
  await asOwner(async () => {
    await importRecords(null, 'a', [...day('2026-09-01'), ...day('2026-09-02')]); // revision 1
    const afterFirst = await active();
    await importRecords(1, 'b', [...day('2026-09-02', { scale_weight: { 'Weight (lb)': 297.8 } }), ...day('2026-09-03')]); // revision 2
    const afterSecond = await active();

    const cleared = await clearDay(2, '2026-09-01', 'steps'); // revision 3
    expect(cleared).toMatchObject({ kind: 'clear', outcome: 'changed', revision_id: 3, removed: 1 });
    const afterClear = await active();
    expect(afterClear['2026-09-01|steps']).toBeUndefined();
    expect(Object.keys(afterClear)).toHaveLength(17);
    expect(afterClear['2026-09-01|scale_weight']).toEqual({ 'Weight (lb)': 181 });

    // Preview writes nothing and names what it would restore.
    const preview = await previewUndo(3);
    expect(preview).toMatchObject({ target_kind: 'clear', restores_revision_id: 2, added: 1, changed: 0, removed: 0 });
    expect(await activeRevision()).toBe(3);

    const undoClearId = requestId();
    expect(await undo(3, undoClearId)).toMatchObject({ kind: 'undo', revision_id: 4, added: 1, changed: 0, removed: 0 });
    expect(await undo(3, undoClearId)).toMatchObject({ replayed: true, revision_id: 4 });
    expect(await active()).toEqual(afterSecond);

    // Undo again reverts the second import: the corrected weight and the added day.
    expect(await previewUndo(4)).toMatchObject({ target_kind: 'workbook', restores_revision_id: 1, added: 0, changed: 1, removed: 6 });
    await undo(4); // revision 5
    expect(await active()).toEqual(afterFirst);

    // And again reverts the first import, back to an empty history.
    expect(await undo(5)).toMatchObject({ revision_id: 6, removed: 12 });
    expect(await active()).toEqual({});
    await expect(undo(6)).rejects.toMatchObject({ code: 'P0002' });

    // Nothing was deleted: every earlier version can still be reconstructed.
    const atRevision2 = await database.query<{ count: number }>(
      'select count(*)::int as count from public.daily_records where introduced_revision_id <= 2 and (retired_revision_id is null or retired_revision_id > 2)');
    expect(atRevision2.rows[0].count).toBe(18);

    const history = await call<{ undo_target_id: string | null; imports: Array<{ kind: string; undone: boolean }> }>('public.active_history()', []);
    expect(history.undo_target_id).toBeNull();
    expect(history.imports.map((item) => [item.kind, item.undone])).toEqual([
      ['undo', false], ['undo', false], ['undo', false], ['clear', true], ['workbook', true], ['workbook', true],
    ]);
  });
});

test('a new import after undo works normally and becomes the next undo target', async () => {
  await asOwner(async () => {
    const revision = await activeRevision();
    const result = await importRecords(revision, 'c', day('2026-09-04'));
    expect(result).toMatchObject({ outcome: 'changed', added: 6 });
    const history = await call<{ undo_target_id: string; imports: Array<{ id: string; kind: string }> }>('public.active_history()', []);
    expect(history.undo_target_id).toBe(history.imports[0].id);
    expect(history.imports[0].kind).toBe('workbook');
  });
});

test('stale previews, missing records, and invalid requests change nothing', async () => {
  await asOwner(async () => {
    const revision = await activeRevision();
    await expect(clearDay(revision! - 1, '2026-09-04', 'steps')).rejects.toMatchObject({ code: 'FI409' });
    await expect(undo(revision! - 1)).rejects.toMatchObject({ code: 'FI409' });
    await expect(clearDay(revision, '2026-09-04', 'not_a_domain')).rejects.toMatchObject({ code: 'P0002' });
    await expect(clearDay(revision, '2020-01-01', 'steps')).rejects.toMatchObject({ code: 'P0002' });
    await expect(call('public.clear_day(null, $1, $2, $3)', [revision, '2026-09-04', 'steps'])).rejects.toMatchObject({ code: '22023' });
    expect(await activeRevision()).toBe(revision);
    expect(Object.keys(await active())).toHaveLength(6);
  });
});

test('only the GitHub owner can clear or undo', async () => {
  const revision = await asOwner(activeRevision);
  for (const [role, user, provider] of [['authenticated', strangerId, 'github'], ['authenticated', ownerId, 'email']] as const) {
    await asIdentity(database, role, user, async () => {
      await expect(clearDay(revision, '2026-09-04', 'steps')).rejects.toMatchObject({ code: '42501' });
      await expect(undo(revision)).rejects.toMatchObject({ code: '42501' });
      await expect(previewUndo(revision)).rejects.toMatchObject({ code: '42501' });
    }, provider);
  }
  await asIdentity(database, 'anon', '', async () => {
    await expect(clearDay(revision, '2026-09-04', 'steps')).rejects.toThrow(/permission denied/);
    await expect(undo(revision)).rejects.toThrow(/permission denied/);
  });
  await asOwner(async () => { expect(Object.keys(await active())).toHaveLength(6); });
});
