import { test, expect, type Route } from '@playwright/test';

// Transport fixtures only; the review log rules are exercised against PostgreSQL in review-database.test.ts.
test('on a phone, the owner reviews the flagged weigh-in and marks a day incomplete', async ({ browser }) => {
  const weights: Record<string, number> = { '2026-09-08': 200.4, '2026-09-09': 199.8, '2026-09-10': 199.2, '2026-09-11': 199.6, '2026-09-12': 198.8, '2026-09-13': 297.8 };
  const records = Object.entries(weights).flatMap(([date, weight]) => [
    { date, domain: 'scale_weight', fields: { 'Weight (lb)': weight }, source_file_id: 'f', revision_id: 1 },
    { date, domain: 'trend_weight', fields: { 'Trend Weight (lb)': 199.5 }, source_file_id: 'f', revision_id: 1 },
    { date, domain: 'nutrition_totals', fields: { 'Calories (kcal)': 2400 }, source_file_id: 'f', revision_id: 1 },
  ]);
  const imports = [{ id: 'i1', kind: 'import', committed_at: '2026-09-15T15:00:00Z', outcome: 'changed', revision_id: 1, added: records.length, changed: 0, unchanged: 0, removed: 0, undone: false, file_names: ['export.xlsx'] }];
  const decisions: Array<Record<string, unknown>> = [];
  const completeness: Array<Record<string, unknown>> = [];
  const inserts: string[] = [];
  const serve = async (route: Route) => {
    const request = route.request();
    const name = new URL(request.url()).pathname.split('/').pop()!;
    if (name === 'is_app_owner') return route.fulfill({ json: true });
    if (name === 'preferences') return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds' } });
    if (name === 'active_history') return route.fulfill({ json: { revision_id: 1, records, food_days: [], workout_days: [], exercise_names: [], aliases: {}, imports, undo_target_id: 'i1' } });
    if (name === 'review_state') return route.fulfill({ json: { decisions, completeness } });
    if (name === 'review_decisions' || name === 'completeness_marks') {
      inserts.push(name);
      const body = request.postDataJSON();
      const stamp = new Date(Date.now() + inserts.length * 1000).toISOString();
      if (name === 'review_decisions') decisions.push({ date: body.record_date, domain: body.domain, field: body.field, value: body.value, decision: body.decision, decided_at: stamp });
      else completeness.push({ date: body.mark_date, domain: body.domain, status: body.status, decided_at: stamp });
      return route.fulfill({ status: 201, json: [] });
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

  await expect(page.getByLabel('Completed-day cutoffs')).toContainText('complete through Sep 14, 2026');
  await expect(page.getByLabel('Flagged weigh-ins')).toContainText('297.8 lb');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('section', { has: page.getByRole('heading', { name: 'Review queue' }) }).screenshot({ path: 'test-results/mobile-review-queue.png' });

  await page.getByRole('button', { name: 'Exclude' }).click();
  await expect(page.getByRole('status').first()).toContainText('Excluded 297.8 lb on Sep 13, 2026');
  await expect(page.getByLabel('Flagged weigh-ins')).toContainText('Excluded (still saved, left out of calculations)');

  await page.getByLabel('Day', { exact: true }).selectOption('2026-09-11');
  await page.getByRole('button', { name: 'Mark incomplete' }).click();
  await expect(page.getByLabel('Days marked incomplete')).toContainText('Fri, Sep 11, 2026');
  expect(inserts).toEqual(['review_decisions', 'completeness_marks']);
  expect(decisions[0]).toMatchObject({ date: '2026-09-13', value: 297.8, decision: 'exclude', field: 'Weight (lb)' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('section', { has: page.getByRole('heading', { name: 'Data status' }) }).screenshot({ path: 'test-results/mobile-data-status.png' });
  await context.close();
});
