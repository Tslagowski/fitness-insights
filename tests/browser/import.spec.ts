import { test, expect, type Route } from '@playwright/test';
import { dailyRow, syntheticWorkbook } from '../fixtures/workbook-builder';

// Transport fixtures only: no real Supabase project is contacted. The commit rules are
// exercised against PostgreSQL in import-database.test.ts.
test('a phone owner imports a workbook through the archive upload and atomic commit', async ({ browser }) => {
  let revisionId: number | null = null;
  let records: Array<{ date: string; domain: string; fields: Record<string, number | null> }> = [];
  const uploads: string[] = [];
  const commits: Array<Record<string, unknown>> = [];
  const serve = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/rpc/is_app_owner')) return route.fulfill({ json: true });
    if (url.pathname.endsWith('/preferences')) return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1 } });
    if (url.pathname.endsWith('/rpc/active_history')) {
      return route.fulfill({ json: { revision_id: revisionId, imports: [], records: records.map((record) => ({ ...record, source_file_id: 'file', revision_id: revisionId })) } });
    }
    if (url.pathname.includes('/storage/v1/object/source-archives/')) {
      uploads.push(url.pathname);
      return route.fulfill({ json: { Key: url.pathname } });
    }
    if (url.pathname.endsWith('/rpc/commit_import')) {
      const body = request.postDataJSON();
      commits.push(body);
      if (body.p_expected_revision_id !== revisionId) return route.fulfill({ status: 400, json: { code: 'FI409', message: 'stale' } });
      records = body.p_records;
      revisionId = 1;
      return route.fulfill({ json: { outcome: 'changed', replayed: false, revision_id: 1, added: records.length, changed: 0, unchanged: 0 } });
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

  const bytes = syntheticWorkbook([dailyRow('2026-09-01'), dailyRow('2026-09-02', { 'Weight (lb)': null }), dailyRow('2026-09-03')]);
  await page.getByLabel('MacroFactor workbook file').setInputFiles({ name: 'MacroFactor.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
  await expect(page.getByLabel('Proposed changes')).toContainText('18');
  await page.getByText('Daily values to be saved (3 dates)').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-import-preview.png', fullPage: true });

  await page.getByRole('button', { name: 'Confirm import' }).click();
  await expect(page.getByRole('status')).toContainText('Import confirmed: 18 added');
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatch(/\/source-archives\/workbooks\/[0-9a-f]{64}\.xlsx$/);
  expect(commits).toHaveLength(1);
  expect(commits[0].p_expected_revision_id).toBeNull();
  expect((commits[0].p_records as unknown[]).length).toBe(18);

  await page.getByRole('link', { name: 'Nutrition' }).click();
  await expect(page.getByText('3 dates, Sep 1, 2026 – Sep 3, 2026')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-daily-history.png', fullPage: true });
  await context.close();
});
