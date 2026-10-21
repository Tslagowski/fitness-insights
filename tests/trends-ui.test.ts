import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { formatCalendarDate, reportingToday } from '../src/import/preview';
import { parseWorkbook } from '../src/import/workbook';
import { dailyRow, syntheticWorkbook, type FixtureValue } from './fixtures/workbook-builder';
import { MemoryGateway } from './fixtures/memory-gateway';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });
const yesterday = addDays(reportingToday(), -1);

async function seeded(rows: FixtureValue[][]) {
  const gateway = new MemoryGateway();
  await gateway.commitSources({ requestId: 'seed', expectedRevisionId: null, acceptReconciliation: false, food: [], workouts: [],
    daily: parseWorkbook(syntheticWorkbook(rows)).records, sources: [{ name: 'export.xlsx', kind: 'workbook', sha256: 'a'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() }] });
  return gateway;
}
async function open(gateway: MemoryGateway) {
  window.location.hash = '#nutrition';
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  return app;
}
const tile = (app: VueWrapper, label: string) => app.findAll('.metric-tile').find((item) => item.find('h4').text() === label)!.text();

/** 56 days ending yesterday: trend falls 0.1 lb/day throughout; steps rise from 7,000 to 9,000 in the current 28 days. */
const rows = Array.from({ length: 56 }, (_, index) => dailyRow(addDays(yesterday, index - 55), {
  'Weight (lb)': 201 - 0.1 * index, 'Trend Weight (lb)': 200 - 0.1 * index, Steps: index >= 28 ? 9000 : 7000,
}));

test('weight and steps show separate series, a weekly trend rate, and comparisons', async () => {
  const app = await open(await seeded(rows));
  expect(tile(app, 'Trend weight rate')).toContain('−0.70 lb/week');
  expect(tile(app, 'Trend weight rate')).toContain('±0.00 lb/week vs previous period');
  expect(tile(app, 'Average scale weight')).toContain('−2.8 lb vs previous period');
  expect(tile(app, 'Average daily steps')).toContain('9,000');
  expect(tile(app, 'Average daily steps')).toContain('+2,000 vs previous period (7,000)');
  expect(app.findAll('.scale-dot')).toHaveLength(28);
  expect(app.find('.trend-line').attributes('d')).toMatch(/^M/);
  expect(app.findAll('.steps-bar')).toHaveLength(28);
});

test('an excluded weigh-in is shown hollow and left out; the trend keeps its warning', async () => {
  const spiked = rows.map((row, index) => (index === 54 ? dailyRow(addDays(yesterday, -1), { 'Weight (lb)': 297.8, 'Trend Weight (lb)': 200 - 5.4, Steps: 9000 }) : row));
  const gateway = await seeded(spiked);
  await gateway.saveReviewDecision({ date: addDays(yesterday, -1), domain: 'scale_weight', field: 'Weight (lb)', value: 297.8, decision: 'exclude' });
  const app = await open(gateway);
  expect(app.findAll('.scale-dot.left-out')).toHaveLength(1);
  expect(app.text()).toContain(`Left out of weight calculations: 297.8 lb on ${formatCalendarDate(addDays(yesterday, -1))} (excluded by you)`);
  expect(app.get('.warning-note').text()).toContain("MacroFactor's trend weight on 2 days in this period");
  expect(tile(app, 'Average scale weight')).toContain('27 weigh-ins counted');
  expect(tile(app, 'Trend weight rate')).toContain('†');
});

test('steps still report when there is no nutrition or weight, and the selected day explains its values', async () => {
  const stepsOnly = Array.from({ length: 14 }, (_, index) => dailyRow(addDays(yesterday, index - 13), {
    'Calories (kcal)': null, 'Protein (g)': null, 'Fat (g)': null, 'Carbs (g)': null, 'Weight (lb)': null, 'Trend Weight (lb)': null, Expenditure: null, Steps: 6000 + index * 100 }));
  const app = await open(await seeded(stepsOnly));
  await app.findAll('.segmented button').find((button) => button.text() === '7 days')!.trigger('click');
  expect(app.get('#period-line').text()).toContain(`${formatCalendarDate(addDays(yesterday, -6))} – ${formatCalendarDate(yesterday)}`);
  expect(tile(app, 'Average daily steps')).toContain('7,000');
  expect(tile(app, 'Average scale weight')).toContain('Insufficient coverage');
  expect(app.get('#selected-trend-day').text()).toContain('Steps7,300 · Counted');
  expect(app.get('#selected-trend-day').text()).toContain('Scale weight— · Not recorded');
});
