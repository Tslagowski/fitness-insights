// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let database: PGlite;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database.close(); });

let counter = 0;
const requestId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const asOwner = <T>(action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);
async function call<T = Record<string, unknown>>(sql: string, parameters: unknown[]): Promise<T> {
  return (await database.query<{ result: T }>(`select ${sql} as result`, parameters)).rows[0].result;
}
const revision = async () => (await database.query<{ id: number | null }>('select active_revision_id as id from public.workspace_state')).rows[0].id;
const workbook = (index: number) => ({ kind: 'workbook', sha256: index.toString(16).padStart(64, '0'), file_name: `export-${index}.xlsx`, byte_size: 10, media_type: 'x' });
/** One changing import per call: the weight on Sep 1 changes every time; Sep 2 stays the same. */
async function importWeight(index: number) {
  const daily = [
    { date: '2026-09-01', domain: 'scale_weight', fields: { 'Weight (lb)': 180 + index } },
    { date: '2026-09-02', domain: 'steps', fields: { Steps: 8000 } },
  ];
  return call('public.commit_sources($1, $2, $3, $4, $5, false, false, $6)', [requestId(), await revision(), JSON.stringify([workbook(index)]), JSON.stringify(daily), '[]', '[]']);
}
const fingerprint = (key: string) => key.padStart(64, '0');
async function saveReport(character: string, expected?: number | null) {
  const revisionId = expected === undefined ? await revision() : expected;
  return call<{ id: string; replayed: boolean }>('public.save_report($1, $2, $3, $4, $5, $6, $7)', [fingerprint(character), revisionId, '2026-10-20', '2026-10-19', 'overview-v1',
    JSON.stringify({ revisionId, templateVersion: 'overview-v1' }), JSON.stringify({ sections: [{ id: 'intake', findings: [{ text: `report ${character}` }] }] })]);
}

test('reports are saved once per fingerprint for the active revision, readable only by the owner, and never edited', async () => {
  await asOwner(async () => {
    await importWeight(1);
    const saved = await saveReport('a');
    expect(saved.replayed).toBe(false);
    expect((await saveReport('a')).replayed).toBe(true);
    await expect(saveReport('b', 999)).rejects.toThrow(/changed after this report was prepared/);
    expect((await database.query('select count(*)::int as count from public.reports')).rows).toEqual([{ count: 1 }]);
    await expect(database.query("update public.reports set content = '{}'")).rejects.toThrow(/permission denied/);
    await expect(database.query('delete from public.reports')).rejects.toThrow(/permission denied/);
    await expect(database.query("insert into public.reports (fingerprint, report_date, template_version, inputs, content) values ($1, '2026-10-20', 'x', '{}', '{}')", [fingerprint('c')])).rejects.toThrow(/permission denied/);
  });
  await asIdentity(database, 'authenticated', strangerId, async () => {
    expect((await database.query('select * from public.reports')).rows).toEqual([]);
    await expect(saveReport('d', 1)).rejects.toThrow(/Only the workspace owner/);
  });
  await asIdentity(database, 'anon', '', async () => {
    await expect(database.query('select * from public.reports')).rejects.toThrow(/permission denied/);
    await expect(call('public.prune_history($1, true, 12)', [1])).rejects.toThrow(/permission denied/);
  });
});

test('retention keeps the latest 12 versions and their reports, keeps active data, and undo stops at the retained window', async () => {
  await asOwner(async () => {
    for (let index = 2; index <= 14; index += 1) {
      await importWeight(index);
      await saveReport((1000 + index).toString(16));
    }
    const active = await revision();
    expect(active).toBe(14);
    const preview = await call<Record<string, number>>('public.prune_history($1, true, 12)', [active]);
    expect(preview).toMatchObject({ revisions: 14, keep_from_revision_id: 3, daily_records: 1, reports: 2 });
    await expect(call('public.prune_history($1, true, 11)', [active])).rejects.toThrow(/At least 12/);
    await expect(call('public.prune_history($1, false, 12)', [active! - 1])).rejects.toThrow(/changed after this preview/);
    const before = (await database.query("select record_date::text, domain, fields from public.daily_records where retired_revision_id is null order by 1, 2")).rows;
    const applied = await call<Record<string, number>>('public.prune_history($1, false, 12)', [active]);
    expect(applied).toMatchObject({ retained_from_revision_id: 3, daily_records: 1, reports: 2 });
    expect((await database.query("select record_date::text, domain, fields from public.daily_records where retired_revision_id is null order by 1, 2")).rows).toEqual(before);
    expect((await database.query<{ revision_id: number }>('select min(revision_id) as revision_id from public.reports')).rows[0].revision_id).toBe(3);
    // Every retained version can still be rebuilt: undo walks back through all 12 changes, then refuses.
    let undone = 0;
    for (;;) {
      try { await call('public.undo_last_change($1, $2, false)', [requestId(), await revision()]); undone += 1; }
      catch (error) { expect(String(error)).toMatch(/older than the retained versions/); break; }
    }
    expect(undone).toBe(12);
    const weight = (await database.query<{ fields: Record<string, number> }>("select fields from public.daily_records where retired_revision_id is null and domain = 'scale_weight'")).rows;
    expect(weight).toEqual([{ fields: { 'Weight (lb)': 182 } }]);
    // A second prune with nothing older is a no-op and never lowers the retained boundary.
    const again = await call<Record<string, number>>('public.prune_history($1, false, 12)', [await revision()]);
    expect(again.retained_from_revision_id).toBeGreaterThanOrEqual(3);
  });
});
