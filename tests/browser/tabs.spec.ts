import { test, expect } from '@playwright/test';
import { insightsPage } from './insights-mock';

// Tickets 31 and 39: long pages split into tabs that live in the URL.
test('page tabs keep the chosen view in the URL across reload and back', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await page.getByRole('link', { name: 'Nutrition' }).click();
  const tabs = page.getByRole('navigation', { name: 'Nutrition views' });
  await expect(tabs.getByRole('link', { name: 'Summary' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('section.intake-balance').first()).toBeVisible();
  await tabs.getByRole('link', { name: 'Daily' }).click();
  await expect(page).toHaveURL(/#nutrition\/daily$/);
  await expect(page.getByRole('heading', { name: 'Daily records' })).toBeVisible();
  await expect(page.locator('section.intake-balance')).toHaveCount(0);
  await page.reload();
  await expect(tabs.getByRole('link', { name: 'Daily' })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(tabs.getByRole('link', { name: 'Summary' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Settings' }).click();
  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  await sections.getByRole('link', { name: 'Data & backups' }).click();
  await expect(page.getByRole('heading', { name: 'Backup and restore' })).toBeVisible();
  await sections.getByRole('link', { name: 'Preferences' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-tabs.png' });
  await context.close();
});
