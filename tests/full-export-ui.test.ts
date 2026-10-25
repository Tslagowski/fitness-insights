import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';
import { fullExport } from './fixtures/full-export-builder';
import { MemoryGateway } from './fixtures/memory-gateway';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });
async function until(condition: () => boolean, what: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
  }
  throw new Error(`Timed out waiting for ${what}`);
}
async function openSettings(gateway: MemoryGateway) {
  window.location.hash = '#settings';
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  for (let attempt = 0; attempt < 8; attempt += 1) await flushPromises();
  return app;
}
async function choose(app: VueWrapper, bytes: Uint8Array) {
  const input = app.get('input[type="file"][multiple]');
  Object.defineProperty(input.element, 'files', { value: [new File([bytes as BlobPart], 'MacroFactor-20261022.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })], configurable: true });
  await input.trigger('change');
  await until(() => app.text().includes('Confirm import') || app.find('[role="alert"]').exists(), 'the preview');
}
const days = (start: string, count: number) => Array.from({ length: count }, (_, index) => addDays(start, index));

test('a full data export previews its sheets, targets, and partial-logging days, and saves marks only when accepted', async () => {
  const gateway = new MemoryGateway();
  const app = await openSettings(gateway);
  const calories = days('2026-09-01', 10);
  await choose(app, fullExport({ calories, weights: { '2026-09-01': 201 }, trend: calories, expenditure: calories, steps: { '2026-09-01': 8000 },
    programs: [{ date: '2026-09-01', calories: {} }], partial: { '2026-09-03': 'Yes', '2026-09-05': 'Yes', '2026-09-06': 'No' } }));
  const section = app.get('.full-export');
  expect(section.text()).toContain('Calories & Macros');
  expect(section.text()).toContain('Targets: 10 days derived from 1 program update');
  expect(section.get('[aria-label="Partial logging days"]').text()).toContain('Sep 3, 2026, Sep 5, 2026');
  expect(app.text()).toContain('Personal profile or settings: kept only in the private archive, never read');
  await section.get('input[type="checkbox"]').setValue(true);
  await app.findAll('button').find((button) => button.text() === 'Confirm import')!.trigger('click');
  await until(() => app.text().includes('Partial Logging day'), 'the incomplete marks');
  expect(app.text()).toContain('Marked 2 Partial Logging days as incomplete.');
  expect(gateway.review.completeness.map((mark) => mark.date).sort()).toEqual(['2026-09-03', '2026-09-05']);
  expect(gateway.active.filter((row) => row.domain === 'targets')).toHaveLength(10);
});

test('importing the full export over a quick-export history corrects only the dates and measures it lists', async () => {
  const gateway = new MemoryGateway();
  await gateway.commitSources({ requestId: 'quick', expectedRevisionId: null, acceptReconciliation: false, food: [], workouts: [],
    daily: (await import('../src/import/workbook')).parseWorkbook(syntheticWorkbook([dailyRow('2026-08-31'), dailyRow('2026-09-01')])).records,
    sources: [{ name: 'quick.xlsx', kind: 'workbook', sha256: 'a'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() }] });
  const app = await openSettings(gateway);
  await choose(app, fullExport({ calories: ['2026-09-01'], overrides: { '2026-09-01': 2400 } }));
  await app.findAll('button').find((button) => button.text() === 'Confirm import')!.trigger('click');
  await until(() => app.text().includes('Import confirmed'), 'the import');
  const value = (date: string, domain: string) => gateway.active.find((row) => row.date === date && row.domain === domain)?.values;
  expect(value('2026-09-01', 'nutrition_totals')).toMatchObject({ 'Calories (kcal)': 2400 });
  expect(value('2026-09-01', 'scale_weight')).toEqual({ 'Weight (lb)': 181 });
  expect(value('2026-08-31', 'nutrition_totals')).toMatchObject({ 'Calories (kcal)': 2300 });
  expect(gateway.review.completeness).toEqual([]);
});
