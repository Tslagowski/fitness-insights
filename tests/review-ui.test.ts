import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { parseWorkbook } from '../src/import/workbook';
import { dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';
import { MemoryGateway } from './fixtures/memory-gateway';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });

const weights: Record<string, number> = { '2026-09-08': 200.4, '2026-09-09': 199.8, '2026-09-10': 199.2, '2026-09-11': 199.6, '2026-09-12': 198.8, '2026-09-13': 297.8 };
async function seeded(overrides: Record<string, number> = {}) {
  const gateway = new MemoryGateway();
  const rows = Object.entries({ ...weights, ...overrides }).map(([date, weight]) => dailyRow(date, { 'Weight (lb)': weight }));
  await gateway.commitSources({ requestId: 'seed', expectedRevisionId: null, acceptReconciliation: false, food: [], workouts: [],
    daily: parseWorkbook(syntheticWorkbook(rows)).records, sources: [{ name: 'export.xlsx', kind: 'workbook', sha256: 'a'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() }] });
  return gateway;
}
async function open(gateway: MemoryGateway, page: string) {
  window.location.hash = `#${page}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  return app;
}
const click = async (app: VueWrapper, label: string) => {
  const found = app.findAll('button').find((item) => item.text() === label || item.text().includes(label));
  if (!found) throw new Error(`No button "${label}"`);
  await found.trigger('click');
  await flushPromises();
};

test('the Overview shows completed-day cutoffs and flags the 297.8 lb weigh-in for review', async () => {
  const app = await open(await seeded(), 'overview');
  expect(app.get('[aria-label="Completed-day cutoffs"]').text()).toMatch(/Weight, estimates, targets, stepscomplete through/);
  expect(app.get('[aria-label="Completed-day cutoffs"]').text()).toContain('Food entriesnot imported yet');
  expect(app.text()).toContain('1 weigh-in waiting for review');
  const item = app.get('[aria-label="Flagged weigh-ins"] li');
  expect(item.text()).toContain('297.8 lb');
  expect(item.text()).toContain('+49.2% vs the median of 199.6 lb (5 weigh-ins, Sep 8, 2026 – Sep 12, 2026)');
});

test('excluding keeps the value saved, labels it and the affected estimates, and can be reversed', async () => {
  const gateway = await seeded();
  const app = await open(gateway, 'overview');
  await click(app, 'Exclude');
  expect(app.get('[role="status"]').text()).toContain('Excluded 297.8 lb on Sep 13, 2026. It stays saved');
  expect(gateway.review.decisions).toEqual([expect.objectContaining({ date: '2026-09-13', value: 297.8, decision: 'exclude' })]);
  expect(gateway.active.find((row) => row.date === '2026-09-13' && row.domain === 'scale_weight')?.values).toEqual({ 'Weight (lb)': 297.8 });

  const nutrition = await open(gateway, 'nutrition/daily');
  const row = nutrition.findAll('.daily-table tbody tr').map((item) => item.text()).find((text) => text.includes('Sep 13, 2026'))!;
  expect(row).toContain('297.8 (excluded)');
  expect(row).toContain('180.5 †');
  expect(nutrition.text()).toContain('† MacroFactor\'s trend weight and expenditure on these dates may reflect a questioned weigh-in');
  nutrition.unmount();
  mounted.pop();

  window.location.hash = '#overview';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flushPromises();
  await click(app, 'Review again');
  expect(app.text()).toContain('1 weigh-in waiting for review');
});

test('a decision applies to the exact value; a corrected reimport is checked again', async () => {
  const gateway = await seeded();
  await gateway.saveReviewDecision({ date: '2026-09-13', domain: 'scale_weight', field: 'Weight (lb)', value: 297.8, decision: 'exclude' });
  await gateway.otherDeviceImport([{ date: '2026-09-13', domain: 'scale_weight', values: { 'Weight (lb)': 279.8 } }]);
  const app = await open(gateway, 'overview');
  expect(app.text()).toContain('1 weigh-in waiting for review');
  expect(app.get('[aria-label="Flagged weigh-ins"] li').text()).toContain('279.8 lb');
  // A real correction resolves the flag entirely.
  await gateway.otherDeviceImport([{ date: '2026-09-13', domain: 'scale_weight', values: { 'Weight (lb)': 197.8 } }]);
  const corrected = await open(gateway, 'overview');
  expect(corrected.text()).toContain('No weigh-ins need review.');
});

test('marking a day incomplete leaves out only its intake and can be undone; a failed save changes nothing', async () => {
  const gateway = await seeded();
  const app = await open(gateway, 'overview');
  await app.get('#incomplete-date').setValue('2026-09-11');
  await click(app, 'Mark incomplete');
  expect(app.get('[aria-label="Days marked incomplete"]').text()).toContain('Fri, Sep 11, 2026');
  expect(app.text()).toContain('1 day marked with incomplete nutrition logging');

  const nutrition = await open(gateway, 'nutrition/daily');
  const row = nutrition.findAll('.daily-table tbody tr').map((item) => item.text()).find((text) => text.includes('Sep 11, 2026'))!;
  expect(row).toContain('workbook total · marked incomplete');
  expect(row).toContain('199.6');
  expect(row).not.toContain('excluded');
  nutrition.unmount();
  mounted.pop();
  window.location.hash = '#overview';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flushPromises();

  gateway.failWrites = true;
  await click(app, 'Mark complete again');
  expect(app.find('[role="alert"]').text()).toContain('not saved');
  expect(gateway.review.completeness).toHaveLength(1);
  gateway.failWrites = false;
  await click(app, 'Mark complete again');
  expect(app.find('[aria-label="Days marked incomplete"]').exists()).toBe(false);
});
