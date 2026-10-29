import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import { strToU8 } from 'fflate';
import App from '../src/App.vue';
import { dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';
import { foodCsv, foodRow } from './fixtures/food-builder';
import { MemoryGateway } from './fixtures/memory-gateway';
import { go } from './fixtures/navigation';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });

async function open(gateway: MemoryGateway, page = 'settings') {
  window.location.hash = `#${page}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  return app;
}
async function settle(app: VueWrapper, until: () => boolean) {
  for (let attempt = 0; attempt < 40 && !until(); attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 10)); await flushPromises(); }
}
async function chooseFiles(app: VueWrapper, files: Array<[string, Uint8Array]>) {
  const input = app.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: files.map(([name, bytes]) => new File([bytes as BlobPart], name)), configurable: true });
  await input.trigger('change');
  await settle(app, () => app.text().includes('Confirm import') || app.find('[role="alert"]').exists());
}
const button = (app: VueWrapper, label: string) => {
  const found = app.findAll('button').find((item) => item.text().includes(label));
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
const click = async (app: VueWrapper, label: string) => { await button(app, label).trigger('click'); await flushPromises(); };

// Workbook totals: Sep 1 = 300 kcal, Sep 2 = 2300 kcal (default). CSV detail: Sep 1 = 70 + 70 + 160 = 300 kcal.
const workbook = syntheticWorkbook([dailyRow('2026-09-01', { 'Calories (kcal)': 300 }), dailyRow('2026-09-02')]);
const agreeingCsv = foodCsv([
  foodRow('2026-09-01', '8:00 AM', 'Egg', { 'Calories (kcal)': 70 }),
  foodRow('2026-09-01', '8:00 AM', 'Egg', { 'Calories (kcal)': 70 }),
  foodRow('2026-09-01', '12:30 PM', 'Toast', { 'Calories (kcal)': 160 }),
  foodRow('2030-01-01', '9:00 AM', 'Planned oats', { 'Calories (kcal)': 300 }),
]);

test('workbook and food CSV import together; intake uses food detail where it exists and the workbook total elsewhere', async () => {
  const gateway = new MemoryGateway();
  const app = await open(gateway);
  await chooseFiles(app, [['export.xlsx', workbook], ['food.csv', agreeingCsv]]);
  const files = app.get('[aria-label="Selected files"]').text();
  expect(files).toContain('Workbook (.xlsx)');
  expect(files).toContain('Food CSV');
  const summary = app.get('[aria-label="Proposed changes"]').text();
  expect(summary).toMatch(/12\s*new daily records/);
  expect(summary).toMatch(/2\s*new food days/);
  expect(app.text()).toContain('agree within max(5 kcal, 1%)');
  expect(app.text()).toContain('1 day is after today');
  await click(app, 'Confirm import');
  expect(app.get('[role="status"]').text()).toContain('daily records 12 added, 0 corrected, 0 unchanged; food days 2 added');

  const nutrition = await open(gateway, 'nutrition/daily');
  const rows = nutrition.findAll('.daily-table tbody tr').map((row) => row.text());
  expect(rows.find((row) => row.includes('Sep 1, 2026'))).toContain('food entries (3)');
  expect(rows.find((row) => row.includes('Sep 2, 2026'))).toContain('workbook total');
  expect(rows.find((row) => row.includes('Jan 1, 2030'))).toContain('Planned');

  await go('nutrition/food');
  const day = nutrition.findAll('.food-day-toggle').find((item) => item.text().includes('Sep 1, 2026'))!;
  expect(day.text()).toContain('300 kcal');
  await day.trigger('click');
  await flushPromises();
  const entries = nutrition.get('.food-entries').findAll('tbody tr').map((row) => row.text());
  expect(entries).toHaveLength(3);
  expect(entries[0]).toBe(entries[1]);
  expect(entries[2]).toContain('Toast');
});

test('a calorie disagreement must be accepted before the import can be confirmed', async () => {
  const gateway = new MemoryGateway();
  const app = await open(gateway);
  const disagreeing = foodCsv([foodRow('2026-09-02', '8:00 AM', 'Smaller lunch', { 'Calories (kcal)': 1800 })]);
  await chooseFiles(app, [['export.xlsx', workbook], ['food.csv', disagreeing]]);
  const box = app.get('[aria-label="Calorie differences"]');
  expect(box.text()).toContain('Sep 2, 2026: detail 1,800 kcal vs workbook 2,300 kcal (-500)');
  expect(button(app, 'Confirm import').attributes('disabled')).toBeDefined();
  await box.get('input[type="checkbox"]').setValue(true);
  expect(button(app, 'Confirm import').attributes('disabled')).toBeUndefined();
  await click(app, 'Confirm import');
  expect(gateway.events[0].reconciliation).toEqual([{ date: '2026-09-02', detailCalories: 1800, workbookCalories: 2300, difference: -500 }]);
});

test('a later workbook-only import keeps saved CSV detail, and clearing a food day falls back to the workbook total', async () => {
  const gateway = new MemoryGateway();
  const app = await open(gateway);
  await chooseFiles(app, [['export.xlsx', workbook], ['food.csv', agreeingCsv]]);
  await click(app, 'Confirm import');

  const workbookWithFoodLog = syntheticWorkbook([dailyRow('2026-09-01', { 'Calories (kcal)': 300 })], [{ name: 'Food Log', rows: [
    ['Date', 'Time', 'Food Name', 'Serving Size', 'Serving Qty', 'Serving Weight (g)', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)'],
    ['2026-09-01', '8:00 AM', 'Workbook breakfast', 'serving', 1, 100, 300, 1, 2, 3]] }]);
  await chooseFiles(app, [['newer.xlsx', workbookWithFoodLog]]);
  expect(app.text()).toContain('1 date keeps its saved food CSV entries');
  await click(app, 'Cancel');

  await go('settings/data');
  await app.get('#correct-date').setValue('2026-09-01');
  await app.get('#correct-domain').setValue('food_entries');
  await click(app, 'Review clearing');
  expect(app.get('[aria-label="Confirm clearing"]').text()).toContain('Remove 3 food entries for Sep 1, 2026');
  await click(app, 'Clear this data');
  expect(gateway.activeFood.map((row) => row.date)).toEqual(['2030-01-01']);

  const nutrition = await open(gateway, 'nutrition/daily');
  expect(nutrition.findAll('.daily-table tbody tr').map((row) => row.text()).find((row) => row.includes('Sep 1, 2026'))).toContain('workbook total');
  nutrition.unmount();
  mounted.pop();
  // Both instances share the page URL; return the first one to Imports & Settings.
  await go('settings/data');

  await click(app, 'Undo this change');
  await click(app, 'Confirm undo');
  expect(gateway.activeFood.find((row) => row.date === '2026-09-01')?.entries).toHaveLength(3);
});

test('a CSV missing required workout columns is explained rather than imported', async () => {
  const gateway = new MemoryGateway();
  const app = await open(gateway);
  await chooseFiles(app, [['workouts.csv', strToU8('Date,Workout,Exercise,Set Type,Weight (lb),Reps\n2026-09-01,Push,Bench,Standard Set,135,8\n')]]);
  expect(app.get('[role="alert"]').text()).toContain('workouts.csv is not a recognized MacroFactor export');
  expect(gateway.calls).toHaveLength(0);
});
