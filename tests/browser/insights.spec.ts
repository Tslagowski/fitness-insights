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

test('expenditure per pound on a phone: chart, reference, and month rows', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Expenditure per lb');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Expenditure per pound' }) });
  await expect(section.locator('.category-line')).toHaveCount(2);
  await expect(section.locator('.data-row').first()).toContainText(/kcal\/lb|days/);
  await expect(section.getByText('Reference', { exact: true }).first()).toBeVisible();
  await section.getByRole('button', { name: 'Phases' }).click();
  await expect(section.locator('.data-row')).toHaveCount(3);
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-expenditure.png' });
  await context.close();
});

test('day-of-week patterns on a phone: findings, weekday rows, and scopes', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Day of week');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Day-of-week patterns' }) });
  await expect(section.locator('.data-row')).toHaveCount(7);
  await expect(section.getByRole('list', { name: 'Patterns', exact: true })).toContainText('Saturdays averaged');
  await section.locator('.data-row').nth(5).click();
  await expect(section.locator('.row-details')).toContainText('Share of above-target kcal');
  await section.getByRole('button', { name: 'All history' }).click();
  await expect(section.getByRole('list', { name: 'Patterns', exact: true })).toContainText('over 24 Saturdays');
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-weekdays.png' });
  await context.close();
});

test('over-target days on a phone: class counts, food rows, and time of day', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Over-target days');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Over-target days' }) });
  await expect(section.locator('.metric-tile').first()).toContainText('Over target');
  await expect(section.locator('.data-row').first()).toContainText('Pizza');
  await section.locator('.data-row').first().click();
  await expect(section.locator('.row-details')).toContainText('Over − within per day');
  await expect(section.locator('.category-bar').first()).toBeVisible();
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-foods.png' });
  await context.close();
});

test('protein per lb on a phone: tiles, weekly chart, and missed-day rows', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Protein per lb');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Protein per pound' }) });
  await expect(section.locator('.metric-tile').nth(1)).toContainText('60 of 84 days');
  await expect(section.locator('.category-line')).toHaveCount(1);
  await expect(section.locator('.data-row')).toHaveCount(20);
  await expect(section.locator('.data-row').first()).toContainText('of 160 g');
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-protein.png' });
  await context.close();
});
