import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { reportingToday } from '../src/import/preview';
import type { WorkoutDay, WorkoutSet } from '../src/import/workout';
import { MemoryGateway } from './fixtures/memory-gateway';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });
const yesterday = addDays(reportingToday(), -1);
const set = (exercise: string, values: WorkoutSet = {}): WorkoutSet => ({ 'Workout Duration': 2912, Workout: 'Push A', Exercise: exercise, 'Set Type': 'Standard Set', ...values });

/** Seven weekly sessions ending yesterday, plus a session logged today (in progress). */
function days(): WorkoutDay[] {
  const loads = [100, 100, 100, 105, 105, 110, 110];
  const history = loads.map((load, index): WorkoutDay => ({ date: addDays(yesterday, (index - 6) * 7), source: 'workout_csv', sets: [
    set('Bench Press', { 'Set Type': 'Warm-Up Set', 'Weight (lb)': 45, Reps: 10 }),
    set('Bench Press', { 'Weight (lb)': load, Reps: 8 }), set('Bench Press', { 'Weight (lb)': load, Reps: 7 }),
    set('Assisted Pull-Up', { 'Weight (lb)': -80 + index * 5, Reps: 8 }),
    set('Dumbbell Curl', { 'Weight (lb)': 30, Reps: 10 }),
  ] }));
  return [...history, { date: reportingToday(), source: 'workout_csv', sets: [set('Bench Press', { 'Weight (lb)': 200, Reps: 8 })] }];
}
async function seeded(band = 2.5) {
  const gateway = new MemoryGateway();
  gateway.clock = Date.now();
  gateway.strengthBandPercent = band;
  await gateway.commitSources({ requestId: 'seed', expectedRevisionId: null, acceptReconciliation: false, food: [], daily: [], workouts: days(),
    sources: [{ name: 'workouts.csv', kind: 'workout_csv', sha256: 'c'.repeat(64), byteSize: 1, mediaType: 'text/csv', bytes: new Uint8Array() }] });
  return gateway;
}
async function open(gateway: MemoryGateway, page = 'training') {
  window.location.hash = `#${page}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  return app;
}

test('the Training page labels a loaded exercise from six completed sessions and shows the evidence', async () => {
  const app = await open(await seeded());
  const progress = app.get('.exercise-progress');
  expect(progress.text()).toContain('Left out of comparisons: today (in progress)');
  const detail = app.get('[aria-label="Selected exercise"]').text();
  expect(detail).toContain('Bench Press');
  expect(detail).toContain('▲ Progressing');
  expect(detail).toContain('+10.0%');
  expect(app.get('[aria-label="Reps at comparable loads"]').text()).toContain('105 lb8 reps8 reps');
  const sessions = app.get('[aria-label="Sessions"]').text();
  expect(sessions).toContain('110 lb × 8');
  expect(sessions).toContain('Latest 3');
  expect(sessions).toContain('1,650 lb·reps');
  expect(sessions).not.toContain('200 lb');
  expect(app.findAll('.score-dot.recent')).toHaveLength(3);
  expect(app.findAll('.score-dot.previous')).toHaveLength(3);
});

test('assisted movements show assistance and reps, never a strength label', async () => {
  const app = await open(await seeded());
  await app.get('#exercise-select').setValue('Assisted Pull-Up');
  const detail = app.get('[aria-label="Selected exercise"]').text();
  expect(detail).toContain('– Not scored');
  expect(detail).toContain('Machine-assisted (negative weight)');
  expect(app.get('[aria-label="Sessions"]').text()).toContain('-50 lb × 8');
  expect(app.find('[aria-label="Sessions"]').text()).not.toContain('Score');
});

test('a wider band changes the label, and the band is saved as a preference', async () => {
  const gateway = await seeded(10);
  const app = await open(gateway);
  expect(app.get('[aria-label="Selected exercise"]').text()).toContain('● Stable');
  const settings = await open(gateway, 'settings');
  await settings.get('#strength-band').setValue('5');
  await settings.get('form').trigger('submit');
  await flushPromises();
  expect(gateway.strengthBandPercent).toBe(5);
});

test('a failed load says so and offers a retry without changing anything', async () => {
  const gateway = await seeded();
  gateway.failReads = true;
  const app = await open(gateway);
  expect(app.get('.exercise-progress [role="alert"]').text()).toContain('could not be loaded');
  gateway.failReads = false;
  await app.get('.exercise-progress [role="alert"] button').trigger('click');
  await flushPromises();
  expect(app.get('[aria-label="Selected exercise"]').text()).toContain('Bench Press');
});
