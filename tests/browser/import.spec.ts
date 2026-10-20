import { test, expect, type Route } from '@playwright/test';
import { dailyRow, syntheticWorkbook } from '../fixtures/workbook-builder';
import { foodCsv, foodRow } from '../fixtures/food-builder';

// Transport fixtures only: no real Supabase project is contacted. The commit rules are
// exercised against PostgreSQL in import-database.test.ts and food-database.test.ts.
test('a phone owner imports a workbook and food CSV together and browses the food log', async ({ browser }) => {
  let revisionId: number | null = null;
  let records: Array<{ date: string; domain: string; fields: Record<string, number | null> }> = [];
  let foodDays: Array<{ date: string; source_kind: string; entries: Array<Record<string, string | number>> }> = [];
  const uploads: string[] = [];
  const commits: Array<Record<string, unknown>> = [];
  const serve = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/rpc/is_app_owner')) return route.fulfill({ json: true });
    if (url.pathname.endsWith('/preferences')) return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1 } });
    if (url.pathname.endsWith('/rpc/active_history')) {
      return route.fulfill({ json: { revision_id: revisionId, imports: [], undo_target_id: null,
        records: records.map((record) => ({ ...record, source_file_id: 'file', revision_id: revisionId })),
        food_days: foodDays.map((day) => ({ date: day.date, source_kind: day.source_kind, entries: day.entries.length, revision_id: revisionId, missing_calories: 0,
          calories: day.entries.reduce((total, entry) => total + Number(entry['Calories (kcal)'] ?? 0), 0), protein: 9, fat: 3, carbs: 6 })) } });
    }
    if (url.pathname.endsWith('/rpc/food_day_entries')) {
      const day = foodDays.find((item) => item.date === request.postDataJSON().p_date);
      return route.fulfill({ json: day ? { date: day.date, source_kind: day.source_kind, entries: day.entries, revision_id: revisionId } : null });
    }
    if (url.pathname.includes('/storage/v1/object/source-archives/')) {
      uploads.push(url.pathname);
      return route.fulfill({ json: { Key: url.pathname } });
    }
    if (url.pathname.endsWith('/rpc/commit_sources')) {
      const body = request.postDataJSON();
      if (body.p_dry_run) {
        return route.fulfill({ json: { revision_id: revisionId, added: body.p_daily.length, changed: 0, unchanged: 0, food_added: body.p_food.length,
          food_changed: 0, food_unchanged: 0, food_kept: 0, kept_dates: [], changed_food_dates: [], conflicts: [] } });
      }
      commits.push(body);
      records = body.p_daily;
      foodDays = body.p_food;
      revisionId = 1;
      return route.fulfill({ json: { outcome: 'changed', replayed: false, revision_id: 1, added: records.length, changed: 0, unchanged: 0,
        food_added: foodDays.length, food_changed: 0, food_unchanged: 0, food_kept: 0, conflicts: [] } });
    }
    return route.fulfill({ json: {} });
  };

  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173/fitness-insights/', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp: expiresAt, sub: 'owner' })).replace(/=/g, '');
    localStorage.setItem('sb-test-project-auth-token', JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: 'test-refresh', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer',
      user: { id: 'owner', aud: 'authenticated', role: 'authenticated', user_metadata: { user_name: 'Trevis' }, app_metadata: { provider: 'github' } },
    }));
  });
  await context.route('https://test-project.supabase.co/**', serve);
  const page = await context.newPage();
  await page.goto('./#settings');
  await expect(page.getByText('Nothing imported yet.')).toBeVisible();

  const workbook = syntheticWorkbook([dailyRow('2026-09-01', { 'Calories (kcal)': 300 }), dailyRow('2026-09-02', { 'Weight (lb)': null }), dailyRow('2026-09-03')]);
  const csv = foodCsv([
    foodRow('2026-09-01', '8:00 AM', 'Egg', { 'Calories (kcal)': 70 }), foodRow('2026-09-01', '8:00 AM', 'Egg', { 'Calories (kcal)': 70 }),
    foodRow('2026-09-01', '12:30 PM', 'Toast with a long descriptive name, buttered', { 'Calories (kcal)': 160 }),
  ]);
  await page.getByLabel('MacroFactor export files').setInputFiles([
    { name: 'MacroFactor.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(workbook) },
    { name: 'MacroFactor-food.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) },
  ]);
  await expect(page.getByLabel('Proposed changes')).toContainText('18');
  await expect(page.getByLabel('Proposed changes')).toContainText('1new food day');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.import-preview').screenshot({ path: 'test-results/mobile-import-preview.png' });

  await page.getByRole('button', { name: 'Confirm import' }).click();
  await expect(page.getByRole('status')).toContainText('Import confirmed: daily records 18 added');
  expect(uploads.map((path) => path.replace(/[0-9a-f]{64}/, 'SHA'))).toEqual(['/storage/v1/object/source-archives/workbooks/SHA.xlsx', '/storage/v1/object/source-archives/food-csv/SHA.csv']);
  expect(commits).toHaveLength(1);
  expect(commits[0].p_accept_reconciliation).toBe(false);
  expect((commits[0].p_food as Array<{ entries: unknown[] }>)[0].entries).toHaveLength(3);

  await page.getByRole('link', { name: 'Nutrition' }).click();
  await expect(page.getByText('3 dates, Sep 1, 2026 – Sep 3, 2026')).toBeVisible();
  await page.getByRole('button', { name: /Tue, Sep 1, 2026/ }).click();
  await expect(page.getByRole('region', { name: 'Entries for Sep 1, 2026' })).toContainText('Toast with a long descriptive name');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('section', { has: page.getByRole('heading', { name: 'Food log' }) }).screenshot({ path: 'test-results/mobile-food-log.png' });
  await context.close();
});
