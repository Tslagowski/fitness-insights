import { test, expect, type Route } from '@playwright/test';

// Ticket 26: data lists on a phone are month-grouped rows with no horizontal scrolling.
const denverToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };

test('on a phone, daily history and analysis dates read as month-grouped rows that expand', async ({ browser }) => {
  const yesterday = shift(denverToday, -1);
  const records = Array.from({ length: 70 }, (_, index) => {
    const date = shift(yesterday, index - 69);
    const row = (domain: string, fields: Record<string, number>) => ({ date, domain, fields, source_file_id: 'f', revision_id: 1 });
    return [row('nutrition_totals', { 'Calories (kcal)': 2200 + (index % 5) * 100, 'Protein (g)': 160, 'Fat (g)': 70, 'Carbs (g)': 250 }), row('expenditure', { Expenditure: 2500 }),
      row('targets', { 'Target Calories (kcal)': 2400 }), row('scale_weight', { 'Weight (lb)': 201 - 0.1 * index }), row('trend_weight', { 'Trend Weight (lb)': 200 - 0.1 * index }), row('steps', { Steps: 8000 + index })];
  }).flat();
  const serve = async (route: Route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    if (name === 'is_app_owner') return route.fulfill({ json: true });
    if (name === 'preferences') return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds', strength_band_percent: 2.5 } });
    if (name === 'active_history') return route.fulfill({ json: { revision_id: 1, records, food_days: [], workout_days: [], exercise_names: [], aliases: {}, undo_target_id: 'i1',
      imports: [{ id: 'i1', kind: 'import', committed_at: new Date().toISOString(), outcome: 'changed', revision_id: 1, added: records.length, changed: 0, unchanged: 0, removed: 0, undone: false, file_names: ['export.xlsx'] }] } });
    if (name === 'review_state') return route.fulfill({ json: { decisions: [], completeness: [] } });
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
  await page.goto('./#nutrition/daily');

  const history = page.locator('section', { has: page.getByRole('heading', { name: 'Daily records' }) });
  await expect(history.locator('.data-row')).toHaveCount(14);
  await expect(history.locator('.month-heading').first()).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
  await expect(history.locator('.data-row').first()).toContainText(/kcal/);
  // Ticket 38: the Day view lists only recorded values and draws intake against target.
  await expect(history.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await history.locator('.row-secondary').allTextContents()).not.toContainEqual(expect.stringContaining('—'));
  await expect(history.locator('.row-meter').first()).toBeVisible();
  await history.getByRole('button', { name: 'Weight' }).click();
  await expect(history.locator('.data-row').first()).toContainText(/\d+\.\d lb/);
  await history.locator('.data-row').first().click();
  await expect(history.locator('.row-details').first()).toContainText('Steps');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await history.screenshot({ path: 'test-results/mobile-daily-rows.png' });
  await history.getByRole('button', { name: 'Show 14 more days' }).click();
  await expect(history.locator('.data-row')).toHaveCount(28);

  await page.getByRole('navigation', { name: 'Nutrition views' }).getByRole('link', { name: 'Summary' }).click();
  const intake = page.locator('section.intake-balance').first();
  await intake.getByText('Dates behind these numbers').click();
  const dateList = intake.locator('.data-rows');
  await expect(dateList.locator('.data-row')).toHaveCount(28);
  await dateList.locator('.data-row').nth(2).click();
  await expect(intake.getByLabel('Selected day')).toContainText(/kcal/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dateList.screenshot({ path: 'test-results/mobile-intake-rows.png' });
  await context.close();
});
