import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { setRow, workoutCsv } from './fixtures/workout-builder';
import { MemoryGateway } from './fixtures/memory-gateway';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });

async function open(gateway: MemoryGateway, page: string) {
  window.location.hash = `#${page}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  return app;
}
async function settle(app: VueWrapper, until: () => boolean) {
  for (let attempt = 0; attempt < 40 && !until(); attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 10)); await flushPromises(); }
}
const click = async (app: VueWrapper, label: string) => {
  const found = app.findAll('button').find((item) => item.text().includes(label));
  if (!found) throw new Error(`No button "${label}"`);
  await found.trigger('click');
  await flushPromises();
};
async function goTo(page: string) {
  window.location.hash = `#${page}`;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flushPromises();
}

const csv = workoutCsv([
  setRow('2026-09-01', 'Dumbbell Curl', { 'Weight (lb)': 30, Reps: 12 }),
  setRow('2026-09-01', 'Dumbbell Curl', { 'Weight (lb)': 30, Reps: 12 }),
  setRow('2026-09-01', 'Machine-Assisted Pull-Up ∈ SS1', { 'Weight (lb)': -100, Reps: 6, 'Set Type': 'Failure Set', RIR: 0 }),
  setRow('2026-09-01', 'Hack Squat', { 'Exercise Base Weight (lb)': 100, 'Weight (lb)': 90, Reps: 10 }),
  setRow('2026-09-01', 'Side Plank', { 'Weight (lb)': '', Reps: '', RIR: '', Duration: 60 }),
  setRow('2026-09-02', 'Row', { 'Weight (lb)': 100, Reps: 8 }),
]);

async function importWorkouts(gateway: MemoryGateway) {
  const app = await open(gateway, 'settings');
  const input = app.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [new File([csv as BlobPart], 'workouts.csv')], configurable: true });
  await input.trigger('change');
  await settle(app, () => app.text().includes('Confirm import') || app.find('[role="alert"]').exists());
  return app;
}

test('a workout CSV import previews, saves, and shows sessions and sets exactly as logged', async () => {
  const gateway = new MemoryGateway();
  const app = await importWorkouts(gateway);
  expect(app.get('[aria-label="Selected files"]').text()).toContain('Workout CSV');
  expect(app.get('[aria-label="Proposed changes"]').text()).toMatch(/2\s*new workout days/);
  expect(app.text()).toContain('Workout sets (6 sets on 2 days)');
  expect(app.text()).toContain('machine base weight is never added');
  await click(app, 'Confirm import');
  expect(app.get('[role="status"]').text()).toContain('workout days 2 added');
  expect(gateway.active).toHaveLength(0);

  await goTo('training/log');
  expect(app.text()).toContain('Training log');
  const day = app.findAll('.food-day-toggle').find((item) => item.text().includes('Sep 1, 2026'))!;
  expect(day.text()).toContain('5 sets · 4 exercises · 48 min 32 s');
  await day.trigger('click');
  await flushPromises();
  const session = app.get('.workout-session');
  expect(session.text()).toContain('Duration 48 min 32 s (read as seconds, unverified; raw 2912) · 5 sets');
  const curls = app.get('[aria-label="Dumbbell Curl sets"]').findAll('tbody tr');
  expect(curls).toHaveLength(2);
  expect(curls[0].text()).toContain('30');
  expect(app.get('[aria-label="Machine-Assisted Pull-Up ∈ SS1 sets"]').text()).toContain('-100 (assistance)');
  const hack = app.get('[aria-label="Hack Squat sets"]').get('tbody tr').findAll('td').map((cell) => cell.text());
  expect(hack).toEqual(['Standard Set', '90', '10', '2', '—', '100']);
  expect(app.get('[aria-label="Side Plank sets"]').text()).toContain('60 (1 min)');
});

test('the duration unit is a saved, visibly provisional setting', async () => {
  const gateway = new MemoryGateway();
  const app = await importWorkouts(gateway);
  await click(app, 'Confirm import');
  await goTo('settings/preferences');
  await app.get('#duration-unit').setValue('minutes');
  await app.findAll('form').at(-1)!.trigger('submit');
  await flushPromises();
  expect(gateway.durationUnit).toBe('minutes');
  await goTo('training/log');
  await app.findAll('.food-day-toggle').find((item) => item.text().includes('Sep 1, 2026'))!.trigger('click');
  await flushPromises();
  expect(app.get('.workout-session').text()).toContain('Duration 48 h 32 min (read as minutes, unverified; raw 2912)');
});

test('an explicit alias changes only the display name and can be removed', async () => {
  const gateway = new MemoryGateway();
  const app = await importWorkouts(gateway);
  await click(app, 'Confirm import');
  await goTo('training/log');
  await click(app, 'Use “Machine-Assisted Pull-Up”');
  expect(gateway.aliases).toEqual({ 'Machine-Assisted Pull-Up ∈ SS1': 'Machine-Assisted Pull-Up' });
  expect(app.get('[role="status"]').text()).toContain('The logged name is unchanged');
  await app.findAll('.food-day-toggle').find((item) => item.text().includes('Sep 1, 2026'))!.trigger('click');
  await flushPromises();
  expect(app.text()).toContain('Machine-Assisted Pull-Up · logged as “Machine-Assisted Pull-Up ∈ SS1”');
  expect(gateway.activeWorkouts[0].sets[2].Exercise).toBe('Machine-Assisted Pull-Up ∈ SS1');
  await click(app, 'Remove alias');
  expect(gateway.aliases).toEqual({});
});

test('a day of workout sets can be cleared and the clear undone', async () => {
  const gateway = new MemoryGateway();
  const app = await importWorkouts(gateway);
  await click(app, 'Confirm import');
  await goTo('settings/data');
  await app.get('#correct-date').setValue('2026-09-02');
  await app.get('#correct-domain').setValue('workout_sets');
  await click(app, 'Review clearing');
  expect(app.get('[aria-label="Confirm clearing"]').text()).toContain('Remove 1 workout set for Sep 2, 2026');
  await click(app, 'Clear this data');
  expect(gateway.activeWorkouts.map((row) => row.date)).toEqual(['2026-09-01']);
  expect(app.get('[aria-label="Change log"]').text()).toContain('Cleared Workout sets on Sep 2, 2026');
  await click(app, 'Undo this change');
  await click(app, 'Confirm undo');
  expect(gateway.activeWorkouts.map((row) => row.date).sort()).toEqual(['2026-09-01', '2026-09-02']);
});
