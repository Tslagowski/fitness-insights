import { test, expect, type Page } from '@playwright/test';
import { insightsPage } from './insights-mock';

// Tickets 16-25 on a 390px phone: each topic renders without horizontal scrolling.
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function choose(page: Page, topic: string) {
  await page.getByRole('group', { name: 'Analysis topic' }).getByRole('button', { name: topic, exact: true }).click();
}

test('weight phases on a phone: timeline, phase rows, and evidence', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Weight phases' }) });
  await expect(section.locator('.phase-band')).toHaveCount(3);
  await expect(section.locator('.data-row')).toHaveCount(3);
  await section.locator('.data-row').last().click();
  await expect(section.getByLabel('Selected phase')).toContainText('Losing');
  await expect(section.locator('.row-details')).toContainText('Mean intake');
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-phases.png' });
  await context.close();
});
