import { test, expect, type Page } from '@playwright/test';
import { denverToday, insightsPage, shift } from './insights-mock';

// Tickets 16-25 on a 390px phone: each topic renders without horizontal scrolling.
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function choose(page: Page, topic: string) {
  await page.locator('.insight-card-link', { has: page.locator('.insight-card-title', { hasText: new RegExp(`^${topic}$`) }) }).click();
}

test('weight phases on a phone: timeline, phase rows, and evidence', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Weight phases');
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

test('strength vs body weight on a phone: lift rows, charts, and windows', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Strength vs weight');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Strength vs body weight' }) });
  await expect(section.locator('.data-row')).toHaveCount(2);
  await expect(section.locator('.data-row', { hasText: 'Bench Press' })).toContainText('Gained');
  await section.locator('.data-row', { hasText: 'Bench Press' }).click();
  await expect(section.locator('.row-details')).toContainText('Score per lb');
  await expect(section.getByLabel('Selected lift').locator('.category-line')).toHaveCount(3);
  await section.locator('#strength-window').selectOption({ index: 1 });
  await expect(section.locator('.data-row').first()).toBeVisible();
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-strength.png' });
  await context.close();
});

test('muscle balance on a phone: ratios, muscle rows, stalled lifts, and the mapping editor', async ({ browser }) => {
  const { context, page } = await insightsPage(browser, { exercise_muscles: [
    { exercise_name: 'Bench Press', primary_muscle: 'Chest', secondary_muscles: ['Triceps'] },
    { exercise_name: 'Cable Row', primary_muscle: 'Upper Back', secondary_muscles: [] },
    { exercise_name: 'Back Squat', primary_muscle: 'Quads', secondary_muscles: [] },
  ] });
  await choose(page, 'Muscle balance');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Muscle-group balance' }) });
  await expect(section.locator('.metric-tile').first()).toContainText('2.00 : 1');
  await expect(section.getByRole('list', { name: 'Sets per muscle' })).toContainText('Chest');
  await expect(section.getByRole('list', { name: 'Stalled lifts' })).toContainText('Back Squat');
  await section.getByText(/Exercise muscle mapping \(3 of 5 mapped\)/).click();
  await expect(section.locator('#muscle-plank')).toHaveValue('');
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-muscles.png' });
  await context.close();
});

test('training effort on a phone: tiles, distributions, and exercise rows', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Effort and reps');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Training effort' }) });
  await expect(section.locator('.metric-tile').first()).toContainText('80%');
  await expect(section.locator('.category-bar').first()).toBeVisible();
  await expect(section.locator('.data-row')).toHaveCount(5);
  await section.locator('.data-row', { hasText: 'Bench Press' }).click();
  await expect(section.locator('.row-details')).toContainText('RIR 1-2');
  await section.getByRole('button', { name: '4 weeks' }).click();
  await expect(section.locator('.metric-tile').nth(2)).toContainText('6');
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-effort.png' });
  await context.close();
});

test('best and worst sessions on a phone: findings, measures, and session rows', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Best and worst sessions');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Before your best and worst sessions' }) });
  await expect(section.getByRole('list', { name: 'Associations' })).toContainText('the day before top-third sessions');
  await expect(section.getByRole('list', { name: 'Prior-day measures' }).locator('.data-row')).toHaveCount(4);
  await section.getByText(/Top and bottom sessions \(46\)/).click();
  const sessions = section.getByRole('list', { name: 'Top and bottom sessions' });
  await expect(sessions.locator('.data-row')).toHaveCount(20);
  await sessions.locator('.data-row').first().click();
  await expect(sessions.locator('.row-details')).toContainText('Bench Press');
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-precursors.png' });
  await context.close();
});

const noteDate = shift(denverToday, -60);
test('dated notes on a phone: form, note list, before/after rows, and the timeline marker', async ({ browser }) => {
  const { context, page } = await insightsPage(browser, { owner_notes: [
    { note_id: 'n1', version: 1, start_date: noteDate, end_date: noteDate, body: 'Started a new program', category: 'Training', removed: false, created_at: '2026-10-01T00:00:00Z' },
    { note_id: 'n1', version: 2, start_date: noteDate, end_date: noteDate, body: 'Started a 4-day program', category: 'Training', removed: false, created_at: '2026-10-02T00:00:00Z' },
  ] });
  await choose(page, 'Notes');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Dated notes' }) });
  await expect(section.getByRole('list', { name: 'Your notes' })).toContainText('Started a 4-day program');
  await expect(section.getByText('History (2 versions)')).toBeVisible();
  await expect(section.getByRole('list', { name: 'Before and after' }).locator('.data-row')).toHaveCount(7);
  await expect(section.locator('.note-marker')).toHaveCount(1);
  await expect(section.locator('.phase-band')).toHaveCount(2);
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-notes.png' });
  await context.close();
});

test('long-range reviews on a phone: period choice and written sections', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Reviews');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Long-range reviews' }) });
  await expect(section.locator('.report-section')).toHaveCount(6);
  await section.getByRole('button', { name: 'Year' }).click();
  await expect(section.locator('#review-period option').first()).toBeAttached();
  await expect(section.getByRole('region', { name: 'Weight' })).toContainText('trend weight');
  expect(await fits(page)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-reviews.png' });
  await context.close();
});

test('insight cards on a phone: grouped headlines open topics and come back', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await expect(page.locator('.insight-card-link')).toHaveCount(11);
  await expect(page.locator('.insight-card-link', { hasText: 'Weight phases' })).toContainText('lb/wk');
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-insight-cards.png', fullPage: true });
  await choose(page, 'Protein per lb');
  await expect(page).toHaveURL(/#insights\/protein$/);
  await page.getByRole('link', { name: 'All insights' }).click();
  await expect(page.locator('.insight-card-link')).toHaveCount(11);
  await context.close();
});

test('charts on a phone: a finger drag scrubs the selection, labels stay readable, long ranges start recent', async ({ browser }) => {
  const { context, page } = await insightsPage(browser);
  await choose(page, 'Best and worst sessions');
  const chart = page.locator('figure.category-chart').first();
  await expect(chart.getByRole('button', { name: /^Show all \d+$/ })).toBeVisible();
  const svg = chart.locator('svg');
  const box = (await svg.boundingBox())!;
  const drag = async (fraction: number, type: string) => svg.dispatchEvent(type, { pointerType: 'touch', pointerId: 7, isPrimary: true, bubbles: true,
    clientX: box.x + box.width * fraction, clientY: box.y + box.height / 2 });
  await drag(0.2, 'pointerdown');
  await drag(0.5, 'pointermove');
  await drag(0.9, 'pointermove');
  await drag(0.9, 'pointerup');
  await expect(chart.locator('.chart-float')).toContainText('%');
  const label = await chart.locator('.chart-float').textContent();
  await drag(0.3, 'pointerdown');
  await drag(0.3, 'pointerup');
  expect(await chart.locator('.chart-float').textContent()).not.toBe(label);
  const fontSize = await chart.locator('.x-labels text').first().evaluate((node) => getComputedStyle(node).fontSize);
  expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(12);
  await chart.getByRole('button', { name: /^Show all \d+$/ }).click();
  await expect(chart.getByRole('button', { name: 'Show the latest 26' })).toBeVisible();
  expect(await fits(page)).toBe(true);
  await chart.screenshot({ path: 'test-results/mobile-chart-scrub.png' });
  await context.close();
});
