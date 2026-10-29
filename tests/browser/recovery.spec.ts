import { test, expect, type BrowserContext, type Route } from '@playwright/test';

// Transport fixtures only; capacity enforcement is covered in capacity-database.test.ts.
async function signedIn(browser: import('@playwright/test').Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173/fitness-insights/', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp: expiresAt, sub: 'owner' })).replace(/=/g, '');
    localStorage.setItem('sb-test-project-auth-token', JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: 'test-refresh', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer',
      user: { id: 'owner', aud: 'authenticated', role: 'authenticated', user_metadata: { user_name: 'Trevis' }, app_metadata: { provider: 'github' } },
    }));
  });
  return context;
}

test('on a phone, Settings shows storage usage against the free limits and the recovery steps', async ({ browser }) => {
  const context = await signedIn(browser);
  await context.route('https://test-project.supabase.co/**', async (route: Route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    if (name === 'is_app_owner') return route.fulfill({ json: true });
    if (name === 'preferences') return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds', strength_band_percent: 2.5 } });
    if (name === 'active_history') return route.fulfill({ json: { revision_id: 3, records: [], food_days: [], workout_days: [], exercise_names: [], aliases: {}, imports: [], undo_target_id: null } });
    if (name === 'review_state') return route.fulfill({ json: { decisions: [], completeness: [] } });
    if (name === 'capacity_status') return route.fulfill({ json: { database_bytes: 480000000, database_limit_bytes: 524288000, archive_bytes: 12000000, archive_limit_bytes: 1073741824,
      hard_stop_fraction: 0.95, staging_bytes: 0, staging_uploads: 0, oldest_staging_at: null } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  await page.goto('./#settings/data');
  const panel = page.locator('section.service-status');
  await expect(panel.getByRole('meter', { name: 'Database usage' })).toHaveAttribute('aria-valuetext', '92% used, Nearly full: new imports are paused');
  await expect(panel).toContainText('✓ Plenty of room · 1% used');
  await panel.getByText('Recovery steps').click();
  await expect(panel).toContainText('choose Restore/Resume');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: 'test-results/mobile-service-status.png' });
  await context.close();
});

test('when the free service is paused, the app explains how to resume and changes nothing', async ({ browser }) => {
  const context = await signedIn(browser);
  await context.route('https://test-project.supabase.co/**', (route: Route) => route.fulfill({ status: 503, json: { message: 'Project paused' } }));
  const page = await context.newPage();
  await page.goto('./#overview');
  await expect(page.getByRole('heading', { name: 'Your workspace is temporarily unavailable.' })).toBeVisible();
  await expect(page.locator('main')).toContainText('open the Supabase dashboard, resume the project, wait a few minutes, and try again');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});
