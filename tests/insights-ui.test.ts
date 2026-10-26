import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { reportingToday } from '../src/import/preview';
import { MemoryGateway } from './fixtures/memory-gateway';
import { insightsSeed } from './fixtures/insights-seed';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });
const yesterday = addDays(reportingToday(), -1);

export async function seededGateway() {
  const gateway = new MemoryGateway();
  gateway.clock = Date.now();
  const seed = insightsSeed(yesterday);
  await gateway.commitSources({ requestId: 'seed', expectedRevisionId: null, acceptReconciliation: true, daily: seed.daily, food: seed.food, workouts: seed.workouts,
    sources: [{ name: 'export.xlsx', kind: 'workbook', sha256: 'a'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() }] });
  return gateway;
}
async function open(gateway: MemoryGateway, topic?: string) {
  window.location.hash = '#insights';
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  if (topic) { await app.findAll('.topic-picker button').find((button) => button.text() === topic)!.trigger('click'); await flushPromises(); }
  return app;
}

test('weight phases split the history by trend rate and open each phase’s evidence', async () => {
  const app = await open(await seededGateway());
  const section = app.find('[aria-labelledby="phases-heading"]');
  expect(section.text()).toContain('Method weight-phases-v1');
  const rows = section.findAll('tbody tr');
  expect(rows.map((row) => row.find('th').text())).toEqual(['Gaining', 'Maintaining (plateau)', 'Losing']);
  expect(rows[2].text()).toContain('−0.97 lb/week');
  await rows[2].find('button').trigger('click');
  const selected = section.find('[aria-label="Selected phase"]').text();
  expect(selected).toContain('Losing');
  expect(selected).toMatch(/Mean intake\s*2,1\d\d kcal \(\d+ days\)/);
  expect(selected).toContain('Working sets per week');
  expect(section.findAll('.phase-band')).toHaveLength(3);
  expect(section.text()).toContain('How phases are found');
});

test('expenditure per pound compares each month with a constant kcal-per-lb reference', async () => {
  const app = await open(await seededGateway(), 'Expenditure per lb');
  const section = app.find('[aria-labelledby="expenditure-heading"]');
  expect(section.text()).toContain('Method expenditure-per-lb-v1');
  expect(section.text()).toContain('not a measured metabolic rate');
  const rows = section.findAll('tbody tr');
  expect(rows.length).toBeGreaterThanOrEqual(6);
  expect(section.find('tbody').text()).toContain('(reference)');
  expect(section.find('tbody').text()).toMatch(/1[01]\.\d\d kcal\/lb/);
  const select = section.find('#expenditure-reference');
  const options = select.findAll('option');
  await select.setValue(options.at(-1)!.element.value);
  expect(rows.length).toBeGreaterThan(0);
  expect(section.find('tbody tr').text()).toContain('(reference)');
  await section.findAll('.segmented button')[1].trigger('click');
  expect(section.find('thead').text()).toContain('Phase');
  expect(section.text()).toContain('Expenditure and steps (association)');
});

test('day-of-week patterns show per-weekday means, shares, and weekend vs weekdays', async () => {
  const app = await open(await seededGateway(), 'Day of week');
  const section = app.find('[aria-labelledby="weekday-heading"]');
  expect(section.text()).toContain('Method weekday-patterns-v1');
  expect(section.find('.findings').text()).toMatch(/Saturdays averaged \+[\d,]+ kcal vs target over 12 Saturdays/);
  const saturday = section.findAll('tbody tr')[5];
  expect(saturday.text()).toContain('Saturday');
  expect(saturday.text()).toContain('+1.0 lb');
  expect(saturday.text()).toContain('4,000');
  await section.findAll('.segmented button')[0].trigger('click');
  expect(section.find('.findings').text()).toContain('over 4 Saturdays');
  expect(section.find('.findings').text()).toContain('Weekend days averaged');
  await section.findAll('.segmented button')[2].trigger('click');
  expect(section.find('.findings').text()).toContain('over 24 Saturdays');
  expect(section.text()).toContain('Weekend vs weekdays');
});

test('over-target days rank foods and times of day from food detail', async () => {
  const app = await open(await seededGateway(), 'Over-target days');
  await flushPromises();
  const section = app.find('[aria-labelledby="foods-heading"]');
  expect(section.text()).toContain('Method food-patterns-v1');
  const tiles = section.findAll('.metric-tile');
  expect(tiles[0].text()).toContain('Over target');
  expect(Number(tiles[0].find('.metric-value').text())).toBeGreaterThan(0);
  expect(section.text()).toMatch(/Not included: [\d,]+ workbook-total days without food detail/);
  expect(section.find('tbody tr').text()).toContain('Pizza');
  await section.findAll('.segmented button')[1].trigger('click');
  expect(section.find('tbody').text()).toContain('Egg');
  expect(section.text()).toMatch(/\d+% of timed calories at 8 PM or later/);
  expect(section.text()).toContain('1 entry without a time');
  expect(section.text()).not.toMatch(/\b(swap|instead|avoid|should)\b/i);
});

test('protein per lb shows the ratio, target consistency, weekly series, and missed days', async () => {
  const app = await open(await seededGateway(), 'Protein per lb');
  const section = app.find('[aria-labelledby="protein-heading"]');
  expect(section.text()).toContain('Method protein-per-lb-v1');
  const tiles = section.findAll('.metric-tile');
  expect(tiles[0].text()).toMatch(/0\.\d\d g\/lb/);
  // Weekends (140 g) miss the 160 g target; weekdays (170 g) meet it: 60 of 84 days.
  expect(tiles[1].text()).toContain('60 of 84 days');
  expect(section.find('h3.subheading').text()).toContain('(24)');
  expect(section.find('tbody tr').text()).toMatch(/14\d g160 g−\d+ g/);
  expect(section.text()).toContain('no other amount is recommended');
});

test('strength vs body weight labels lifts by window and lists excluded movements', async () => {
  const app = await open(await seededGateway(), 'Strength vs weight');
  await flushPromises();
  const section = app.find('[aria-labelledby="strength-heading"]');
  expect(section.text()).toContain('Method strength-bodyweight-v1');
  const rows = section.findAll('tbody tr');
  expect(rows.map((row) => row.find('th').text())).toEqual(['Back Squat', 'Bench Press']);
  expect(rows[1].text()).toContain('Gained');
  expect(rows[0].text()).toContain('Kept');
  expect(section.find('[aria-label="Selected lift"]').findAll('.category-line')).toHaveLength(3);
  await rows[1].find('button').trigger('click');
  expect(section.find('[aria-label="Selected lift"] h3').text()).toBe('Bench Press');
  const excluded = section.findAll('details').find((item) => item.text().includes('Not compared'))!;
  expect(excluded.text()).toContain('Assisted Pull-Up');
  expect(excluded.text()).toContain('Plank');
  const select = section.find('#strength-window');
  const phase = select.findAll('option').find((option) => option.text().startsWith('Losing'))!;
  await select.setValue(phase.element.value);
  expect(section.find('tbody').text()).toMatch(/Bench Press/);
  expect(section.text()).not.toMatch(/\b(should|recommend|because)\b/i);
});

test('muscle balance maps exercises, credits sets, shows ratios, and lists stalled lifts', async () => {
  const gateway = await seededGateway();
  const app = await open(gateway, 'Muscle balance');
  await flushPromises();
  const section = app.find('[aria-labelledby="muscles-heading"]');
  expect(section.text()).toContain('Method muscle-balance-v1');
  expect(section.text()).toContain('No exercise is mapped');
  expect(section.text()).toContain('Exercise muscle mapping (0 of 5 mapped)');
  await section.find('#muscle-bench-press').setValue('Chest');
  await section.find('#muscle-cable-row').setValue('Upper Back');
  await section.find('#muscle-back-squat').setValue('Quads');
  await flushPromises();
  expect(gateway.muscles['Bench Press']).toEqual({ primary: 'Chest', secondary: [] });
  const tiles = section.findAll('.metric-tile');
  // Per full week: 6 bench, 3 row, 6 squat working sets (3 sessions).
  expect(tiles[0].text()).toContain('2.00 : 1');
  expect(tiles[1].text()).toContain('1.50 : 1');
  expect(tiles[2].text()).toMatch(/71%/);
  expect(section.find('[aria-label="Sets per muscle"]').text()).toContain('Chest');
  expect(section.text()).toContain('Unmapped in all history: Assisted Pull-Up');
  const secondary = section.findAll('.mapping-row').find((row) => row.find('.mapping-name').text() === 'Bench Press')!.find('.secondary-muscles');
  await secondary.findAll('input[type=checkbox]').find((box) => box.element.parentElement!.textContent!.includes('Triceps'))!.setValue(true);
  await flushPromises();
  expect(gateway.muscles['Bench Press'].secondary).toEqual(['Triceps']);
  expect(section.find('[aria-label="Stalled lifts"]').text()).toContain('Back Squat');
  gateway.failWrites = true;
  await section.find('#muscle-cable-row').setValue('');
  await flushPromises();
  expect(section.find('[role="alert"]').text()).toContain('Cable Row was not saved');
  expect((section.find('#muscle-cable-row').element as HTMLSelectElement).value).toBe('Upper Back');
});

test('training effort shows rep ranges, RIR groups, coverage, and per-exercise counts', async () => {
  const app = await open(await seededGateway(), 'Effort and reps');
  await flushPromises();
  const section = app.find('[aria-labelledby="effort-heading"]');
  expect(section.text()).toContain('Method effort-v1');
  const tiles = section.findAll('.metric-tile');
  // Per session: 7 working sets, 5 with RIR (Bench 2 and 1, Squat 3, Row 0, Assisted 2): 4 of 5 at RIR 0-2.
  expect(tiles[0].text()).toContain('80%');
  expect(tiles[1].text()).toContain('71%');
  expect(tiles[2].find('.metric-value').text()).toBe('18');
  const bench = section.findAll('tbody tr').find((row) => row.find('th').text() === 'Bench Press')!;
  expect(bench.text()).toContain('100%');
  expect(section.findAll('tbody tr').find((row) => row.find('th').text() === 'Plank')!.text()).toContain('0%');
  expect(section.text()).not.toMatch(/\b(should|recommend|optimal)\b/i);
});
