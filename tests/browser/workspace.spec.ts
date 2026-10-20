import { test, expect, type BrowserContext, type Route } from '@playwright/test';

// These transport fixtures never connect to a real Supabase project.
// Database access rules are independently exercised against PostgreSQL in access.test.ts.
async function authenticate(context: BrowserContext) {
  await context.addInitScript(() => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp: expiresAt, sub: 'owner' })).replace(/=/g, '');
    localStorage.setItem('sb-test-project-auth-token', JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`,
      refresh_token: 'test-refresh', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer',
      user: { id: 'owner', aud: 'authenticated', role: 'authenticated', user_metadata: { user_name: 'Trevis' }, app_metadata: { provider: 'github' } },
    }));
  });
}

test('the GitHub sign-in redirects back to the repository base path', async ({ page }) => {
  await page.route('https://test-project.supabase.co/**', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: 'OAuth transport intercepted for test' });
  });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  const requestPromise = page.waitForRequest((request) => request.url().includes('/auth/v1/authorize'));
  await page.getByRole('button', { name: 'Continue with GitHub' }).click();
  const request = await requestPromise;
  const url = new URL(request.url());
  expect(url.searchParams.get('provider')).toBe('github');
  expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:4173/fitness-insights/');
  expect(url.searchParams.get('code_challenge')).toBeTruthy();
});

test('a mobile owner saves density and a separate browser restores it', async ({ browser }) => {
  let density = 'comfortable';
  const serve = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/rpc/is_app_owner')) {
      await route.fulfill({ json: true });
    } else if (url.pathname.endsWith('/preferences')) {
      if (route.request().method() === 'POST') density = route.request().postDataJSON().display_density;
      await route.fulfill({ json: { display_density: density, timezone: 'America/Denver', week_starts_on: 1 } });
    } else {
      await route.fulfill({ json: {} });
    }
  };
  const phone = await browser.newContext({ baseURL: 'http://127.0.0.1:4173/fitness-insights/', viewport: { width: 390, height: 844 } });
  await phone.route('https://test-project.supabase.co/**', serve);
  await authenticate(phone);
  const mobile = await phone.newPage();
  await mobile.goto('./#settings');
  await expect(mobile.getByLabel('Display density')).toBeVisible();
  await mobile.getByLabel('Display density').selectOption('compact');
  await mobile.getByRole('button', { name: 'Save preference' }).click();
  await expect(mobile.getByRole('status')).toContainText('Preference saved');
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mobile.screenshot({ path: 'test-results/mobile-settings.png', fullPage: true });
  await phone.close();

  const computer = await browser.newContext({ baseURL: 'http://127.0.0.1:4173/fitness-insights/', viewport: { width: 1440, height: 1000 } });
  await computer.route('https://test-project.supabase.co/**', serve);
  await authenticate(computer);
  const desktop = await computer.newPage();
  await desktop.goto('./#settings');
  await expect(desktop.getByLabel('Display density')).toHaveValue('compact');
  await desktop.reload();
  await expect(desktop.getByLabel('Display density')).toHaveValue('compact');
  await desktop.getByRole('link', { name: 'Overview', exact: false }).first().click();
  await expect(desktop.getByText('Your account is connected.', { exact: false })).toBeVisible();
  await desktop.screenshot({ path: 'test-results/desktop-overview.png', fullPage: true });
  await computer.close();
});

test('the workspace offers no private controls to a non-owner', async ({ context, page }) => {
  await authenticate(context);
  await context.route('https://test-project.supabase.co/**', async (route) => { await route.fulfill({ json: false }); });
  await page.goto('./#settings');
  await expect(page.getByText('This account does not have access.')).toBeVisible();
  await expect(page.getByLabel('Display density')).toHaveCount(0);
});
