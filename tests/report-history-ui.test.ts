import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { formatCalendarDate } from '../src/import/preview';
import { MemoryGateway } from './fixtures/memory-gateway';
import { seededGateway, yesterday } from './fixtures/seeded-history';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });
async function open(gateway: MemoryGateway, page = 'overview') {
  window.location.hash = `#${page}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  for (let attempt = 0; attempt < 5; attempt += 1) await flushPromises();
  return app;
}
const click = async (app: VueWrapper, label: string, scope = '') => {
  const found = app.findAll(`${scope} button`).find((item) => item.text() === label);
  if (!found) throw new Error(`No button "${label}"`);
  await found.trigger('click');
  for (let attempt = 0; attempt < 5; attempt += 1) await flushPromises();
};

test('opening the Overview saves the report once; revisiting does not duplicate it', async () => {
  const gateway = await seededGateway();
  const app = await open(gateway);
  expect(gateway.reports).toHaveLength(1);
  expect(app.get('.report-history').text()).toContain('This overview was saved as a new report.');
  expect(gateway.reports[0]).toMatchObject({ revisionId: 1, templateVersion: 'overview-v1', periodEnd: yesterday() });
  app.unmount();
  mounted.pop();
  const again = await open(gateway);
  expect(gateway.reports).toHaveLength(1);
  expect(again.get('.report-history').text()).toContain('matches a saved report; nothing new was saved');
  expect(again.get('[aria-label="Saved reports"]').text()).toContain('· current');
});

test('a correction creates a distinct report; the old one is unchanged and the comparison separates inputs from findings', async () => {
  const gateway = await seededGateway();
  (await open(gateway)).unmount();
  mounted.pop();
  const corrected = addDays(yesterday(), -2);
  await gateway.otherDeviceImport([{ date: corrected, domain: 'nutrition_totals', values: { 'Calories (kcal)': 4200, 'Protein (g)': 160, 'Fat (g)': 70, 'Carbs (g)': 250 } }]);
  const app = await open(gateway);
  expect(gateway.reports).toHaveLength(2);
  const original = gateway.reports[0];
  expect(JSON.stringify(original.content)).toContain('Mean intake was 2,386 kcal');
  const items = app.findAll('[aria-label="Saved reports"] li');
  expect(items).toHaveLength(2);
  await items[1].get('button').trigger('click');
  for (let attempt = 0; attempt < 5; attempt += 1) await flushPromises();
  expect(app.get('[aria-label="Opened report"]').text()).toContain('Mean intake was 2,386 kcal');
  await click(app, 'Compare with the current overview', '[aria-label="Opened report"]');
  const comparison = app.get('[aria-label="Comparison with the current overview"]').text();
  expect(comparison).toContain('Saved data changed from version 1 to 2:');
  expect(comparison).toContain(`(${formatCalendarDate(corrected)} – ${formatCalendarDate(corrected)})`);
  expect(comparison).toContain('These are changes to what the report was calculated from, not changes in your behavior.');
  expect(comparison).toContain('Saved: Mean intake was 2,386 kcal');
  expect(comparison).toContain('Current: Mean intake was 2,457 kcal');
});

test('a settings change produces a new report and the comparison names it', async () => {
  const gateway = await seededGateway();
  (await open(gateway)).unmount();
  mounted.pop();
  gateway.strengthBandPercent = 15;
  const app = await open(gateway);
  expect(gateway.reports).toHaveLength(2);
  await app.findAll('[aria-label="Saved reports"] li')[1].get('button').trigger('click');
  for (let attempt = 0; attempt < 5; attempt += 1) await flushPromises();
  await click(app, 'Compare with the current overview', '[aria-label="Opened report"]');
  const comparison = app.get('[aria-label="Comparison with the current overview"]').text();
  expect(comparison).toContain('Exercise label band changed from ±2.5% to ±15%.');
  expect(comparison).toContain('Current: Of 1 exercise with six comparable sessions (median best score of the latest 3 vs the 3 before, band ±15%): Stable: Bench Press (+10.0%).');
});

test('a failed save is reported honestly and the overview stays visible', async () => {
  const gateway = await seededGateway();
  gateway.failWrites = true;
  const app = await open(gateway);
  expect(gateway.reports).toHaveLength(0);
  expect(app.get('.report-history').text()).toContain('could not be saved as a report');
  expect(app.get('.written-overview').text()).toContain('Mean intake was 2,386 kcal');
});

test('retention is previewed first and removes only versions older than the latest 12', async () => {
  const gateway = await seededGateway();
  for (let index = 0; index < 13; index += 1) {
    await gateway.otherDeviceImport([{ date: yesterday(), domain: 'steps', values: { Steps: 10000 + index } }]);
  }
  const app = await open(gateway, 'settings');
  await click(app, 'Review older versions');
  const preview = app.get('[aria-label="Retention preview"]').text();
  expect(preview).toContain('14 versions saved. Keeping versions 3 and later would remove:');
  expect(preview).toContain('1 superseded daily record');
  const active = gateway.active.map((row) => JSON.stringify(row.values)).sort();
  await click(app, 'Remove older versions');
  expect(app.get('[role="status"]').text()).toContain('Removed 1 superseded record');
  expect(gateway.active.map((row) => JSON.stringify(row.values)).sort()).toEqual(active);
  expect(gateway.retainedFrom).toBe(3);
});
