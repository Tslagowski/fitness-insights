import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { formatCalendarDate, reportingToday } from '../src/import/preview';
import { parseWorkbook } from '../src/import/workbook';
import { dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';
import { MemoryGateway } from './fixtures/memory-gateway';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });

const yesterday = addDays(reportingToday(), -1);
/** 56 days ending yesterday: a steady previous 28 days, then a current 28 days with a few big days. */
async function seeded(rows = Array.from({ length: 56 }, (_, index) => {
  const date = addDays(yesterday, index - 55);
  const current = index >= 28;
  const calories = current ? (index % 7 === 5 ? 3500 : 2200) : 2300;
  return dailyRow(date, { 'Calories (kcal)': calories, Expenditure: 2500, 'Target Calories (kcal)': 2400 });
})) {
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

test('the 28-day view ends yesterday and compares against the previous 28 days', async () => {
  const app = await open(await seeded());
  const section = app.get('.intake-balance');
  expect(app.get('#period-line').text()).toContain(`${formatCalendarDate(addDays(yesterday, -27))} – ${formatCalendarDate(yesterday)} (28 days)`);
  expect(section.text()).toContain(`Ends at the latest past day with imported intake (${formatCalendarDate(yesterday)})`);
  // Four 3,500 kcal days and 24 at 2,200: kept in the distribution, not trimmed.
  expect(tile(app, 'Mean intake')).toContain('2,386 kcal');
  expect(tile(app, 'Mean intake')).toContain('+86 kcal vs previous period (2,300 kcal)');
  expect(tile(app, 'Median intake')).toContain('2,200 kcal');
  expect(tile(app, 'Median intake')).toContain('−100 kcal vs previous period');
  expect(tile(app, 'Mean difference from target')).toContain('−14 kcal');
  expect(tile(app, 'Net modeled balance')).toContain('−3,200 kcal');
  expect(tile(app, 'Modeled surplus days')).toContain('14%');
  expect(tile(app, 'Modeled surplus days')).toContain('4 of 28 matched days');
  expect(tile(app, 'Surplus ÷ deficit')).toContain('56%');
  expect(section.text()).toContain('not measured fat or weight change');
  expect(section.text()).toContain('workbook daily totals on 28 days');
});

test('selecting a day shows its values, status, and the balance formula', async () => {
  const app = await open(await seeded());
  expect(app.get('#selected-day').text()).toContain(formatCalendarDate(yesterday, { weekday: true }));
  const big = addDays(yesterday, -1); // index 54 → 54 % 7 === 5
  await app.findAll('.period-table tbody tr').find((row) => row.text().includes(formatCalendarDate(big, { weekday: true })))!.get('button').trigger('click');
  const panel = app.get('#selected-day').text();
  expect(panel).toContain('3,500 kcal · workbook total · Counted');
  expect(panel).toContain('3,500 − 2,500 = +1,000 kcal (surplus)');
  expect(panel).toContain('3,500 − 2,400 = +1,100 kcal');
});

test('below the threshold the headline is replaced by Insufficient coverage, while charts and dates stay available', async () => {
  const rows = Array.from({ length: 14 }, (_, index) => dailyRow(addDays(yesterday, index - 13), index >= 7 && index % 2 ? { 'Calories (kcal)': null } : {}));
  const app = await open(await seeded(rows));
  await app.findAll('.segmented button').find((button) => button.text() === '7 days')!.trigger('click');
  expect(tile(app, 'Mean intake')).toContain('Insufficient coverage');
  expect(tile(app, 'Mean intake')).toContain('4 of 5 required eligible days');
  expect(app.get('[aria-label="Coverage"]').text()).toContain('4 of 7 days with counted intake · Insufficient coverage');
  expect(app.get('.intake-balance').text()).not.toContain('vs previous period');
  expect(app.findAll('.intake-bar')).toHaveLength(4);
  expect(app.get('.intake-balance').findAll('.period-table tbody tr')).toHaveLength(7);
  expect(app.get('.intake-balance .period-table').text()).toContain('Not recorded');
});

test('custom periods use 75% coverage and explain invalid ranges', async () => {
  const app = await open(await seeded());
  await app.findAll('.segmented button').find((button) => button.text() === 'Custom')!.trigger('click');
  await app.get('#custom-start').setValue(addDays(yesterday, -9));
  await app.get('#custom-end').setValue(yesterday);
  expect(app.get('#period-line').text()).toContain('(10 days)');
  expect(app.text()).toContain('Headline values need 8 of 10 days in each period (75% of the period, rounded up)');
  await app.get('#custom-end').setValue(reportingToday());
  expect(app.get('[role="alert"]').text()).toContain('must end before today');
});

test('a period with no deficit shows the ratio as unavailable', async () => {
  const rows = Array.from({ length: 14 }, (_, index) => dailyRow(addDays(yesterday, index - 13), { 'Calories (kcal)': 2700 }));
  const app = await open(await seeded(rows));
  await app.findAll('.segmented button').find((button) => button.text() === '7 days')!.trigger('click');
  expect(tile(app, 'Surplus ÷ deficit')).toContain('Unavailable');
  expect(tile(app, 'Surplus ÷ deficit')).toContain('No modeled deficit');
  expect(app.findAll('.surplus-bar')).toHaveLength(7);
  expect(app.findAll('.deficit-bar')).toHaveLength(0);
});
