import { test, expect, type Route } from '@playwright/test';

// Transport fixtures only; the clear/undo rules are exercised against PostgreSQL in corrections-database.test.ts.
test('on a phone, the owner clears one day of weight and undoes it', async ({ browser }) => {
  const day = (date: string) => [
    ['scale_weight', { 'Weight (lb)': 181 }], ['trend_weight', { 'Trend Weight (lb)': 180.5 }], ['expenditure', { Expenditure: 2500 }],
    ['nutrition_totals', { 'Calories (kcal)': 2300 }], ['targets', { 'Target Calories (kcal)': 2350 }], ['steps', { Steps: 8000 }],
  ].map(([domain, fields]) => ({ date, domain, fields, source_file_id: 'file', revision_id: 1 }));
  let revision = 1;
  let records = [...day('2026-09-01'), ...day('2026-09-02')];
  const original = records;
  const imports: Array<Record<string, unknown>> = [{ id: 'import-1', kind: 'workbook', committed_at: '2026-10-20T15:00:00Z', outcome: 'changed', revision_id: 1, added: 12, changed: 0, unchanged: 0, removed: 0, first_date: '2026-09-01', last_date: '2026-09-02', undone: false, file_name: 'MacroFactor.xlsx', byte_size: 2048 }];
  let undoTarget: string | null = 'import-1';
  const requests: Array<{ name: string; body: Record<string, unknown> }> = [];

  const serve = async (route: Route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop()!;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() ?? {} : {};
    if (name === 'is_app_owner') return route.fulfill({ json: true });
    if (name === 'preferences') return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1 } });
    if (name === 'active_history') return route.fulfill({ json: { revision_id: revision, records, imports, undo_target_id: undoTarget } });
    requests.push({ name, body });
    if (name === 'clear_day') {
      records = records.filter((record) => !(record.date === body.p_date && record.domain === body.p_domain));
      revision = 2;
      imports.unshift({ id: 'clear-1', kind: 'clear', committed_at: '2026-10-20T15:05:00Z', outcome: 'changed', revision_id: 2, added: 0, changed: 0, unchanged: 0, removed: 1, first_date: body.p_date, last_date: body.p_date, cleared_date: body.p_date, cleared_domain: body.p_domain, undone: false, file_name: null, byte_size: null });
      undoTarget = 'clear-1';
      return route.fulfill({ json: { batch_id: 'clear-1', kind: 'clear', outcome: 'changed', replayed: false, revision_id: 2, removed: 1 } });
    }
    if (name === 'undo_last_change' && body.p_dry_run) {
      return route.fulfill({ json: { target_batch_id: 'clear-1', target_kind: 'clear', target_committed_at: '2026-10-20T15:05:00Z', restores_revision_id: 1, added: 1, changed: 0, removed: 0, first_date: '2026-09-02', last_date: '2026-09-02' } });
    }
    if (name === 'undo_last_change') {
      records = original;
      revision = 3;
      imports[0].undone = true;
      imports.unshift({ id: 'undo-1', kind: 'undo', committed_at: '2026-10-20T15:06:00Z', outcome: 'changed', revision_id: 3, added: 1, changed: 0, unchanged: 0, removed: 0, first_date: '2026-09-02', last_date: '2026-09-02', undoes_batch_id: 'clear-1', undone: false, file_name: null, byte_size: null });
      undoTarget = 'import-1';
      return route.fulfill({ json: { batch_id: 'undo-1', kind: 'undo', outcome: 'changed', replayed: false, revision_id: 3, added: 1, changed: 0, removed: 0 } });
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

  await page.getByLabel('Date', { exact: true }).selectOption('2026-09-02');
  await page.getByLabel('Data', { exact: true }).selectOption('scale_weight');
  await page.getByRole('button', { name: 'Review clearing' }).click();
  await expect(page.getByRole('group', { name: 'Confirm clearing' })).toContainText('Remove Scale weight for Sep 2, 2026');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('group', { name: 'Confirm clearing' }).screenshot({ path: 'test-results/mobile-clear-confirm.png' });
  await page.getByRole('button', { name: 'Clear this data' }).click();
  await expect(page.getByText('Cleared Scale weight on Sep 2, 2026. Other domains')).toBeVisible();
  expect(requests[0]).toMatchObject({ name: 'clear_day', body: { p_expected_revision_id: 1, p_date: '2026-09-02', p_domain: 'scale_weight' } });

  await page.getByRole('button', { name: 'Undo this change' }).click();
  await expect(page.getByRole('group', { name: 'Confirm undo' })).toContainText('1 restored');
  await page.getByRole('button', { name: 'Confirm undo' }).click();
  await expect(page.getByText('Undone: 1 restored')).toBeVisible();
  await expect(page.getByLabel('Change log')).toContainText('Undid clearing Scale weight on Sep 2, 2026');
  expect(requests.map((request) => [request.name, request.body.p_dry_run])).toEqual([['clear_day', undefined], ['undo_last_change', true], ['undo_last_change', false]]);
  expect(requests[2].body.p_expected_revision_id).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('section', { has: page.getByRole('heading', { name: 'Change history' }) }).screenshot({ path: 'test-results/mobile-change-history.png' });
  await context.close();
});
