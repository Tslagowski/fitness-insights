import { test, expect, type Route } from '@playwright/test';

// Transport fixtures only; the calculations are covered in intake.test.ts and intake-ui.test.ts.
const denverToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };

test('on a phone, the owner reads intake and modeled balance and opens one day', async ({ browser }) => {
  const yesterday = shift(denverToday, -1);
  const records = Array.from({ length: 56 }, (_, index) => {
    const date = shift(yesterday, index - 55);
    const calories = index >= 28 && index % 7 === 5 ? 3500 : index >= 28 ? 2200 : 2300;
    return [
      { date, domain: 'nutrition_totals', fields: { 'Calories (kcal)': calories }, source_file_id: 'f', revision_id: 1 },
      { date, domain: 'expenditure', fields: { Expenditure: 2500 }, source_file_id: 'f', revision_id: 1 },
      { date, domain: 'targets', fields: { 'Target Calories (kcal)': 2400 }, source_file_id: 'f', revision_id: 1 },
      ...(index % 3 === 1 ? [] : [{ date, domain: 'scale_weight', fields: { 'Weight (lb)': 201 - 0.1 * index }, source_file_id: 'f', revision_id: 1 }]),
      { date, domain: 'trend_weight', fields: { 'Trend Weight (lb)': 200 - 0.1 * index }, source_file_id: 'f', revision_id: 1 },
      { date, domain: 'steps', fields: { Steps: 7000 + (index % 5) * 800 }, source_file_id: 'f', revision_id: 1 },
    ];
  }).flat();
  const imports = [{ id: 'i1', kind: 'import', committed_at: new Date().toISOString(), outcome: 'changed', revision_id: 1, added: records.length, changed: 0, unchanged: 0, removed: 0, undone: false, file_names: ['export.xlsx'] }];
  const serve = async (route: Route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    if (name === 'is_app_owner') return route.fulfill({ json: true });
    if (name === 'preferences') return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds' } });
    if (name === 'active_history') return route.fulfill({ json: { revision_id: 1, records, food_days: [], workout_days: [], exercise_names: [], aliases: {}, imports, undo_target_id: 'i1' } });
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
  await page.goto('./#nutrition');

  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Intake and modeled energy balance' }) });
  const picker = page.locator('section.period-card');
  await expect(section.getByLabel('Intake metrics')).toContainText('2,386 kcal');
  await expect(section.getByLabel('Modeled balance metrics')).toContainText('−3,200 kcal');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-intake-28.png' });

  // Tap the second-to-last column (a 3,500 kcal day) in the intake chart.
  const chart = section.getByRole('group', { name: /Daily intake chart/ });
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  const band = (box.width - 44 - 8) / 28;
  await chart.click({ position: { x: 44 + band * 26.5, y: 100 } });
  await expect(section.getByLabel('Selected day')).toContainText('3,500 − 2,500 = +1,000 kcal (surplus)');

  await picker.getByRole('button', { name: '7 days' }).click();
  await expect(picker.locator('#period-line')).toContainText('(7 days)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await section.locator('.intake-charts').screenshot({ path: 'test-results/mobile-intake-charts-7.png' });

  // Weight and activity share the same period; scale gaps stay gaps.
  await picker.getByRole('button', { name: '28 days' }).click();
  const weight = page.locator('section', { has: page.getByRole('heading', { name: 'Weight and activity' }) });
  await expect(weight.getByLabel('Weight and activity metrics')).toContainText('−0.70 lb/week');
  await expect(weight.getByLabel('Weight and activity metrics')).toContainText('Insufficient coverage');
  await expect(weight.locator('.scale-dot')).toHaveCount(18);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await weight.screenshot({ path: 'test-results/mobile-weight-activity.png' });
  await context.close();
});
