import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { reportingToday } from '../src/import/preview';
import { parseWorkbook } from '../src/import/workbook';
import type { WorkoutDay, WorkoutSet } from '../src/import/workout';
import { dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';
import { MemoryGateway } from './fixtures/memory-gateway';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });
const yesterday = addDays(reportingToday(), -1);
const set = (exercise: string, values: WorkoutSet): WorkoutSet => ({ 'Workout Duration': 2912, Workout: 'Push A', Exercise: exercise, 'Set Type': 'Standard Set', ...values });

export async function seededGateway() {
  const gateway = new MemoryGateway();
  gateway.clock = Date.now();
  const rows = Array.from({ length: 56 }, (_, index) => dailyRow(addDays(yesterday, index - 55), {
    'Calories (kcal)': index >= 28 ? (index % 7 === 5 ? 3500 : 2200) : 2300, Expenditure: 2500, 'Target Calories (kcal)': 2400,
    'Weight (lb)': 201 - 0.1 * index, 'Trend Weight (lb)': 200 - 0.1 * index, Steps: index >= 28 ? 9000 : 7000 }));
  const workouts: WorkoutDay[] = [100, 100, 100, 105, 105, 110, 110].map((load, index) => ({ date: addDays(yesterday, (index - 6) * 7), source: 'workout_csv', sets: [set('Bench Press', { 'Weight (lb)': load, Reps: 8 })] }));
  await gateway.commitSources({ requestId: 'seed', expectedRevisionId: null, acceptReconciliation: false, food: [], workouts,
    daily: parseWorkbook(syntheticWorkbook(rows)).records, sources: [
      { name: 'export.xlsx', kind: 'workbook', sha256: 'a'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() },
      { name: 'workouts.csv', kind: 'workout_csv', sha256: 'c'.repeat(64), byteSize: 1, mediaType: 'text/csv', bytes: new Uint8Array() }] });
  return gateway;
}
async function open(gateway: MemoryGateway) {
  window.location.hash = '#overview';
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  return app;
}

test('the Overview reads a written overview whose statements link to their evidence and pages', async () => {
  const app = await open(await seededGateway());
  const overview = app.get('.written-overview');
  expect(overview.text()).toContain('Mean intake was 2,386 kcal and median 2,200 kcal over 28 counted days');
  expect(overview.text()).toContain("MacroFactor's trend weight changed at −0.70 lb/week");
  expect(overview.text()).toContain('Progressing: Bench Press (+10.0%)');
  expect(overview.text()).toContain('Data changes (not behavior)');
  expect(overview.findAll('.finding-source-estimate').length).toBeGreaterThanOrEqual(2);
  expect(overview.find('.finding-evidence').text()).toContain('intake-balance-v1');
  expect(overview.findAll('a.report-link').map((link) => link.attributes('href'))).toContain('#training');
});

test('if workout sets cannot load, exercise progress is marked unavailable and the rest still reports', async () => {
  const gateway = await seededGateway();
  gateway.failReads = true;
  const app = await open(gateway);
  expect(app.get('.written-overview [role="alert"]').text()).toContain('Workout sets could not be loaded');
  expect(app.get('.written-overview').text()).toContain('Exercise progress: unavailable because workout sets could not be loaded.');
  expect(app.get('.written-overview').text()).toContain('Mean intake was 2,386 kcal');
  gateway.failReads = false;
  await app.get('.written-overview [role="alert"] button').trigger('click');
  await flushPromises();
  expect(app.get('.written-overview').text()).toContain('Progressing: Bench Press');
});
