import { test, expect, type Route } from '@playwright/test';

// Transport fixtures only; report rules are covered in report*.test.ts and report-database.test.ts.
const denverToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };

test('on a phone, the owner reads the written overview, which is saved and can be reopened', async ({ browser }) => {
  const yesterday = shift(denverToday, -1);
  const records = Array.from({ length: 56 }, (_, index) => {
    const date = shift(yesterday, index - 55);
    const row = (domain: string, fields: Record<string, number>) => ({ date, domain, fields, source_file_id: 'f', revision_id: 1 });
    return [row('nutrition_totals', { 'Calories (kcal)': index >= 28 ? (index % 7 === 5 ? 3500 : 2200) : 2300 }), row('expenditure', { Expenditure: 2500 }),
      row('targets', { 'Target Calories (kcal)': 2400 }), row('trend_weight', { 'Trend Weight (lb)': 200 - 0.1 * index }), row('steps', { Steps: 8000 })];
  }).flat();
  const saved: Array<Record<string, unknown>> = [];
  const serve = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name = url.pathname.split('/').pop()!;
    if (name === 'is_app_owner') return route.fulfill({ json: true });
    if (name === 'preferences') return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds', strength_band_percent: 2.5 } });
    if (name === 'active_history') return route.fulfill({ json: { revision_id: 1, records, food_days: [], workout_days: [], exercise_names: [], aliases: {}, undo_target_id: 'i1',
      imports: [{ id: 'i1', kind: 'import', committed_at: new Date().toISOString(), outcome: 'changed', revision_id: 1, added: records.length, changed: 0, unchanged: 0, removed: 0, undone: false, first_date: records[0].date, last_date: yesterday, file_names: ['export.xlsx'] }] } });
    if (name === 'review_state') return route.fulfill({ json: { decisions: [], completeness: [] } });
    if (name === 'save_report') {
      const body = request.postDataJSON();
      const existing = saved.find((item) => item.fingerprint === body.p_fingerprint);
      if (existing) return route.fulfill({ json: { id: existing.id, created_at: existing.created_at, replayed: true } });
      const row = { id: `r${saved.length + 1}`, created_at: new Date().toISOString(), revision_id: body.p_expected_revision_id, report_date: body.p_report_date, period_end: body.p_period_end,
        template_version: body.p_template_version, fingerprint: body.p_fingerprint, content: body.p_content };
      saved.unshift(row);
      return route.fulfill({ json: { id: row.id, created_at: row.created_at, replayed: false } });
    }
    if (name === 'reports') {
      const id = url.searchParams.get('id');
      if (id) return route.fulfill({ json: saved.find((item) => `eq.${item.id}` === id) ?? null });
      return route.fulfill({ json: saved.map(({ content: _content, ...summary }) => summary) });
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
  await page.goto('./#overview');

  const glance = page.locator('section.glance');
  await expect(glance.locator('.glance-tile').nth(1)).toContainText('2,386 kcal');
  await expect(glance.locator('.glance-tile').first()).toContainText('lb/wk');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await glance.screenshot({ path: 'test-results/mobile-glance.png' });
  await page.locator('details.fold > summary').click();
  const overview = page.locator('section.written-overview');
  await expect(overview).toContainText('Mean intake was 2,386 kcal and median 2,200 kcal');
  await expect(overview).toContainText('Scale weight average: insufficient coverage');
  await overview.locator('.finding-evidence summary').first().click();
  await expect(overview.locator('.finding-evidence').first()).toContainText('intake-balance-v1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await overview.screenshot({ path: 'test-results/mobile-written-overview.png' });

  const history = page.locator('section.report-history');
  await expect(history).toContainText('This overview was saved as a new report.');
  await history.getByRole('button', { name: 'Open' }).click();
  await expect(history.getByLabel('Opened report')).toContainText('Mean intake was 2,386 kcal');
  await history.getByRole('button', { name: 'Compare with the current overview' }).click();
  await expect(history.getByLabel('Comparison with the current overview')).toContainText('No input changes.');
  await expect(history.getByLabel('Comparison with the current overview')).toContainText('The findings are identical.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await history.screenshot({ path: 'test-results/mobile-saved-reports.png' });
  await context.close();
});
