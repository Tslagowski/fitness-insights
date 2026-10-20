// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asIdentity, createTestDatabase, ownerId, strangerId } from './fixtures/database';

let database: PGlite;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database.close(); });

const asOwner = <T>(action: () => Promise<T>) => asIdentity(database, 'authenticated', ownerId, action);
const reviewState = async () => (await database.query<{ state: { decisions: Array<Record<string, unknown>>; completeness: Array<Record<string, unknown>> } | null }>('select public.review_state() as state')).rows[0].state;

test('the owner records review decisions and completeness marks as an append-only log', async () => {
  await asOwner(async () => {
    await database.query("insert into public.review_decisions (record_date, domain, field, value, decision) values ('2026-09-13', 'scale_weight', 'Weight (lb)', 297.8, 'exclude')");
    await database.query("insert into public.review_decisions (record_date, domain, field, value, decision) values ('2026-09-13', 'scale_weight', 'Weight (lb)', 297.8, 'pending')");
    await database.query("insert into public.completeness_marks (mark_date, domain, status) values ('2026-09-11', 'nutrition', 'incomplete')");
    const state = (await reviewState())!;
    expect(state.decisions.map((item) => [item.date, item.value, item.decision])).toEqual([['2026-09-13', 297.8, 'exclude'], ['2026-09-13', 297.8, 'pending']]);
    expect(state.completeness).toEqual([expect.objectContaining({ date: '2026-09-11', domain: 'nutrition', status: 'incomplete' })]);
    await expect(database.query("update public.review_decisions set decision = 'keep'")).rejects.toThrow(/permission denied/);
    await expect(database.query('delete from public.completeness_marks')).rejects.toThrow(/permission denied/);
    await expect(database.query("insert into public.review_decisions (record_date, domain, field, value, decision) values ('2026-09-13', 'steps', 'Steps', 1, 'keep')")).rejects.toThrow();
    await expect(database.query("insert into public.completeness_marks (mark_date, domain, status) values ('2026-09-11', 'nutrition', 'maybe')")).rejects.toThrow();
  });
});

test('decisions and marks survive importing and undoing data', async () => {
  await asOwner(async () => {
    const sources = JSON.stringify([{ kind: 'workbook', sha256: 'a'.repeat(64), file_name: 'w.xlsx', byte_size: 1, media_type: 'x' }]);
    const daily = JSON.stringify([{ date: '2026-09-13', domain: 'scale_weight', fields: { 'Weight (lb)': 297.8 } }]);
    await database.query("select public.commit_sources('d0000000-0000-4000-8000-000000000001', null, $1, $2, '[]', false, false, '[]')", [sources, daily]);
    await database.query("select public.undo_last_change('d0000000-0000-4000-8000-000000000002', 1, false)");
    const state = (await reviewState())!;
    expect(state.decisions).toHaveLength(2);
    expect(state.completeness).toHaveLength(1);
  });
});

test('review state is private to the owner', async () => {
  await asIdentity(database, 'authenticated', strangerId, async () => {
    expect(await reviewState()).toBeNull();
    expect((await database.query('select * from public.review_decisions')).rows).toEqual([]);
    await expect(database.query("insert into public.completeness_marks (mark_date, domain, status) values ('2026-09-12', 'nutrition', 'incomplete')")).rejects.toThrow();
  });
  await asIdentity(database, 'authenticated', ownerId, async () => {
    expect(await reviewState()).toBeNull();
  }, 'email');
  await asIdentity(database, 'anon', '', async () => {
    await expect(database.query('select * from public.review_decisions')).rejects.toThrow(/permission denied/);
    await expect(reviewState()).rejects.toThrow(/permission denied/);
  });
});
