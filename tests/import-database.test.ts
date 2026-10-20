// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let database: PGlite;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database.close(); });

const domains = ['scale_weight', 'trend_weight', 'expenditure', 'nutrition_totals', 'targets', 'steps'];
const source = (sha: string) => ({ sha256: sha.repeat(64).slice(0, 64), file_name: 'MacroFactor.xlsx', byte_size: 1234, media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

function day(date: string, overrides: Record<string, Record<string, number | null>> = {}) {
  const defaults: Record<string, Record<string, number | null>> = {
    scale_weight: { 'Weight (lb)': 181 }, trend_weight: { 'Trend Weight (lb)': 180.5 }, expenditure: { Expenditure: 2500 },
    nutrition_totals: { 'Calories (kcal)': 2300, 'Protein (g)': 160, 'Fat (g)': 70, 'Carbs (g)': 250, 'Alcohol (g)': null },
    targets: { 'Target Calories (kcal)': 2350 }, steps: { Steps: 8000 },
  };
  return domains.map((domain) => ({ date, domain, fields: overrides[domain] ?? defaults[domain] }));
}

async function commit(requestId: string, expected: number | null, sha: string, records: unknown[]) {
  const { rows } = await database.query<{ result: Record<string, unknown> }>(
    'select public.commit_import($1, $2, $3, $4) as result', [requestId, expected, JSON.stringify(source(sha)), JSON.stringify(records)]);
  return rows[0].result;
}
const asOwner = <T>(action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);
async function activeRecords() {
  return (await database.query<{ record_date: string; domain: string; fields: Record<string, number | null> }>(
    "select to_char(record_date, 'YYYY-MM-DD') as record_date, domain, fields from public.daily_records where retired_revision_id is null order by record_date, domain")).rows;
}
const requests = {
  first: 'a0000000-0000-4000-8000-000000000001', retry: 'a0000000-0000-4000-8000-000000000002',
  correction: 'a0000000-0000-4000-8000-000000000003', stale: 'a0000000-0000-4000-8000-000000000004',
  invalid: 'a0000000-0000-4000-8000-000000000005',
};

describe('workbook imports', () => {
  test('the first confirmed import creates one revision, and a retried request does not commit twice', async () => {
    await asOwner(async () => {
      const first = await commit(requests.first, null, 'a', [...day('2026-09-01'), ...day('2026-09-02')]);
      expect(first).toMatchObject({ outcome: 'changed', replayed: false, revision_id: 1, added: 12, changed: 0, unchanged: 0 });
      const retried = await commit(requests.first, null, 'a', [...day('2026-09-01'), ...day('2026-09-02')]);
      expect(retried).toMatchObject({ outcome: 'changed', replayed: true, revision_id: 1, batch_id: first.batch_id });
      expect(await activeRecords()).toHaveLength(12);
      expect((await database.query('select * from public.import_batches')).rows).toHaveLength(1);
      expect((await database.query('select * from public.data_revisions')).rows).toHaveLength(1);
    });
  });

  test('reimporting the same effective records creates no revision and no duplicates', async () => {
    await asOwner(async () => {
      const result = await commit(requests.retry, 1, 'b', [...day('2026-09-02'), ...day('2026-09-01')]);
      expect(result).toMatchObject({ outcome: 'unchanged', revision_id: 1, added: 0, changed: 0, unchanged: 12 });
      expect(await activeRecords()).toHaveLength(12);
      expect((await database.query('select * from public.data_revisions')).rows).toHaveLength(1);
    });
  });

  test('a newer import corrects only represented dates and domains, preserves absent dates, and keeps the prior version', async () => {
    await asOwner(async () => {
      const result = await commit(requests.correction, 1, 'c', [
        ...day('2026-09-02', { scale_weight: { 'Weight (lb)': null } }),
        ...day('2026-09-03'),
      ]);
      expect(result).toMatchObject({ outcome: 'changed', revision_id: 2, added: 6, changed: 1, unchanged: 5 });
      const active = await activeRecords();
      expect(active).toHaveLength(18);
      expect(active.find((row) => row.record_date === '2026-09-02' && row.domain === 'scale_weight')?.fields).toEqual({ 'Weight (lb)': null });
      expect(active.find((row) => row.record_date === '2026-09-01' && row.domain === 'scale_weight')?.fields).toEqual({ 'Weight (lb)': 181 });
      const retired = await database.query("select fields, introduced_revision_id, retired_revision_id from public.daily_records where retired_revision_id is not null");
      expect(retired.rows).toEqual([{ fields: { 'Weight (lb)': 181 }, introduced_revision_id: 1, retired_revision_id: 2 }]);
    });
  });

  test('a preview prepared against an older revision cannot overwrite newer history', async () => {
    await asOwner(async () => {
      await expect(commit(requests.stale, 1, 'd', day('2026-09-01', { steps: { Steps: 1 } }))).rejects.toMatchObject({ code: 'FI409' });
      expect((await activeRecords()).find((row) => row.record_date === '2026-09-01' && row.domain === 'steps')?.fields).toEqual({ Steps: 8000 });
      expect((await database.query('select * from public.import_batches where request_id = $1', [requests.stale])).rows).toEqual([]);
    });
  });

  test('an invalid payload is rejected as a whole and leaves the active revision usable', async () => {
    await asOwner(async () => {
      await expect(commit(requests.invalid, 2, 'e', [...day('2026-09-04'), { date: '2026-09-04', domain: 'mood', fields: {} }])).rejects.toThrow(/unsupported/);
      await expect(commit(requests.invalid, 2, 'e', day('2026-09-04', { steps: { Steps: '9000' as unknown as number } }))).rejects.toThrow(/unsupported/);
      await expect(commit(requests.invalid, 2, 'e', [...day('2026-09-04'), ...day('2026-09-04')])).rejects.toThrow(/repeats a date/);
      expect(await activeRecords()).toHaveLength(18);
      expect((await database.query<{ active_revision_id: number }>('select active_revision_id from public.workspace_state')).rows[0].active_revision_id).toBe(2);
      const history = (await database.query<{ history: { revision_id: number; records: unknown[]; imports: unknown[] } }>('select public.active_history() as history')).rows[0].history;
      expect(history.revision_id).toBe(2);
      expect(history.records).toHaveLength(18);
      expect(history.imports).toHaveLength(3);
    });
  });

  test('records, archives metadata, and revisions are private to the owner and only writable through the commit', async () => {
    const tables = ['daily_records', 'import_batches', 'source_files', 'data_revisions', 'workspace_state'];
    await asIdentity(database, 'authenticated', strangerId, async () => {
      for (const table of tables) expect((await database.query(`select * from public.${table}`)).rows).toEqual([]);
      await expect(commit('b0000000-0000-4000-8000-000000000001', 2, 'f', day('2026-09-05'))).rejects.toMatchObject({ code: '42501' });
      expect((await database.query<{ history: unknown }>('select public.active_history() as history')).rows[0].history).toBeNull();
    });
    await asIdentity(database, 'authenticated', ownerId, async () => {
      expect((await database.query('select * from public.daily_records')).rows).toEqual([]);
      await expect(commit('b0000000-0000-4000-8000-000000000002', 2, 'f', day('2026-09-05'))).rejects.toMatchObject({ code: '42501' });
    }, 'email');
    await asIdentity(database, 'anon', '', async () => {
      await expect(database.query('select * from public.daily_records')).rejects.toThrow(/permission denied/);
      await expect(commit('b0000000-0000-4000-8000-000000000003', 2, 'f', day('2026-09-05'))).rejects.toThrow(/permission denied/);
    });
    await asOwner(async () => {
      await expect(database.query("insert into public.daily_records (record_date, domain, fields, source_file_id, introduced_revision_id) select '2026-09-09', 'steps', '{}', id, 1 from public.source_files limit 1")).rejects.toThrow(/permission denied/);
      await expect(database.query('update public.workspace_state set active_revision_id = 1')).rejects.toThrow(/permission denied/);
      await expect(database.query('delete from public.daily_records')).rejects.toThrow(/permission denied/);
    });
    expect((await database.query('select count(*)::int as count from public.daily_records')).rows).toEqual([{ count: 19 }]);
  });
});
