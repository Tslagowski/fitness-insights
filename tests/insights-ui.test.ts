import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { reportingToday } from '../src/import/preview';
import { MemoryGateway } from './fixtures/memory-gateway';
import { seededGateway } from './fixtures/insights-gateway';
import { go } from './fixtures/navigation';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });
const yesterday = addDays(reportingToday(), -1);

/** Opens Insights and taps the topic's card (default: Weight phases). */
async function open(gateway: MemoryGateway, topic = 'Weight phases') {
  window.location.hash = '#insights';
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  const card = app.findAll('.insight-card-link').find((link) => link.find('.insight-card-title').text() === topic);
  if (!card) throw new Error(`No card "${topic}"`);
  await go(card.attributes('href')!.slice(1));
  await flushPromises();
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
  // Ticket 33: the method sits behind an info control, not a pill on the card.
  expect(section.find('.method-info summary').attributes('aria-label')).toBe('About this calculation (Method strength-bodyweight-v1)');
  expect(section.find('.outline-pill').exists()).toBe(false);
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

test('best and worst sessions compare the day before each group with sample sizes and no causal wording', async () => {
  const app = await open(await seededGateway(), 'Best and worst sessions');
  await flushPromises();
  const section = app.find('[aria-labelledby="precursors-heading"]');
  expect(section.text()).toContain('Method session-precursors-v1');
  const tiles = section.findAll('.metric-tile');
  expect(tiles[0].find('.metric-value').text()).toBe('69');
  expect(tiles[0].text()).toContain('3 training days excluded');
  expect(tiles[1].find('.metric-value').text()).toBe('23');
  expect(section.find('[aria-label="Associations"]').text()).toMatch(/Intake the day before top-third sessions averaged [\d,]+ kcal vs [\d,]+ kcal before bottom-third sessions \([+−±][\d,]+ kcal; \d+ vs \d+ days\)/);
  expect(section.find('[aria-label="Prior-day measures"]').findAll('tbody tr')).toHaveLength(4);
  expect(section.text()).toContain('not tested for significance');
  expect(section.text()).not.toMatch(/\b(because|leads to|should|recommend|causes)\b/i);
  expect(section.find('[aria-label="Top and bottom sessions"]').findAll('tbody tr')).toHaveLength(46);
});

test('dated notes are added, edited with history, compared before and after, marked on the timeline, and removed', async () => {
  const gateway = await seededGateway();
  const app = await open(gateway, 'Notes');
  await flushPromises();
  const section = app.find('[aria-labelledby="notes-heading"]');
  expect(section.text()).toContain('No notes yet.');
  const date = addDays(yesterday, -60);
  await section.find('#note-text').setValue('Started a new program');
  await section.find('form').trigger('submit');
  expect(section.find('[role="alert"]').text()).toContain('Choose the date');
  await section.find('#note-start').setValue(date);
  await section.find('#note-category').setValue('Training');
  await section.find('form').trigger('submit');
  await flushPromises();
  expect(gateway.notes).toHaveLength(1);
  expect(section.find('[aria-label="Your notes"]').text()).toContain('Started a new program');
  const table = section.find('[aria-label="Before and after"]');
  expect(table.text()).toContain('Trend rate (lb/week)');
  expect(table.findAll('tbody tr')[1].text()).toMatch(/Mean intake.*\d,\d{3} \(28d\)/);
  expect(section.findAll('.note-marker')).toHaveLength(1);
  await section.findAll('.segmented button')[0].trigger('click');
  expect(section.text()).toContain('Each measure needs 11 eligible days');
  await section.findAll('.note-actions button')[0].trigger('click');
  await section.find('#note-text').setValue('Started a 4-day program');
  await section.find('form').trigger('submit');
  await flushPromises();
  expect(gateway.notes.map((note) => note.version)).toEqual([1, 2]);
  expect(section.find('.note-history').text()).toContain('History (2 versions)');
  gateway.failWrites = true;
  await section.findAll('.note-actions button')[1].trigger('click');
  await flushPromises();
  expect(section.find('[role="alert"]').text()).toContain('not saved');
  gateway.failWrites = false;
  await section.findAll('.note-actions button')[1].trigger('click');
  await flushPromises();
  expect(gateway.notes.at(-1)).toMatchObject({ version: 3, removed: true });
  expect(section.text()).toContain('No notes yet.');
});

test('long-range reviews render from existing results, state unavailable sections, and save as an immutable report', async () => {
  const gateway = await seededGateway();
  await gateway.saveNote({ id: 'n1', version: 1, startDate: addDays(yesterday, -100), endDate: addDays(yesterday, -100), text: 'Travel week', category: 'Travel', removed: false });
  const app = await open(gateway, 'Reviews');
  await flushPromises();
  const section = app.find('[aria-labelledby="reviews-heading"]');
  expect(section.text()).toContain('Template review-v1');
  expect(section.findAll('.report-section').map((item) => item.find('.report-section-title').text())).toEqual(['Weight', 'Nutrition', 'Activity and expenditure', 'Training', 'Your notes', 'About this review']);
  expect(section.text()).toMatch(/Mean intake was [\d,]+ kcal/);
  expect(section.text()).toContain('Muscle balance is unavailable');
  await section.findAll('.segmented button')[1].trigger('click');
  const options = section.find('#review-period').findAll('option');
  expect(options.length).toBeGreaterThanOrEqual(2);
  expect(section.text()).toMatch(/lowest monthly rate|Trend weight change is unavailable/);
  await section.find('.form-footer .primary-button').trigger('click');
  await vi.waitFor(() => expect(section.find('[role="status"]').text()).toContain('Saved as an immutable report'));
  const saved = await gateway.listReports();
  expect(saved[0].templateVersion).toBe('review-v1');
  await section.find('.form-footer .primary-button').trigger('click');
  await vi.waitFor(() => expect(section.find('[role="status"]').text()).toContain('already saved'));
  expect((await gateway.loadReport(saved[0].id))!.content.inputs.period!.kind).toBe('quarter');
});

test('the overview opens on glance tiles, with the written overview folded below', async () => {
  window.location.hash = '#overview';
  const app = mount(App, { props: { gateway: await seededGateway() }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  await flushPromises();
  const glance = app.find('[aria-labelledby="glance-heading"]');
  const tiles = glance.findAll('.glance-tile');
  expect(tiles.map((tile) => tile.find('.glance-label').text())).toEqual(['Trend weight', 'Intake', 'Protein per lb', 'Steps', 'Working sets']);
  expect(tiles[0].find('.glance-value').text()).toMatch(/^2\d\d\.\d lb$/);
  expect(tiles[0].find('.glance-detail').text()).toContain('+0.50 lb/wk');
  expect(tiles[4].find('.glance-value').text()).toBe('21');
  expect(tiles[4].attributes('href')).toBe('#training');
  expect(glance.findAll('.sparkline .spark-dot').length).toBe(5);
  const fold = app.find('details.fold');
  expect(fold.attributes('open')).toBeUndefined();
  expect(fold.find('#overview-heading').exists()).toBe(true);
  expect(app.find('.feature-grid').exists()).toBe(false);
});

test('insights open on a grid of topic cards with headline results, and a topic opens from its card', async () => {
  window.location.hash = '#insights';
  const app = mount(App, { props: { gateway: await seededGateway() }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  await flushPromises();
  expect(app.findAll('.insight-group-title').map((title) => title.text())).toEqual(['Weight & energy', 'Nutrition', 'Training', 'Notes & reviews']);
  const card = (title: string) => app.findAll('.insight-card-link').find((link) => link.find('.insight-card-title').text() === title)!;
  expect(card('Weight phases').text()).toContain('Gaining +0.50 lb/wk');
  expect(card('Protein per lb').text()).toMatch(/0\.\d\d g\/lb, last 12 weeks/);
  expect(card('Strength vs weight').text()).toContain('1 gained · 1 kept');
  expect(card('Muscle balance').text()).toContain('1 stalled lift');
  expect(card('Effort and reps').text()).toContain('80% of sets at RIR 0-2');
  expect(card('Notes').text()).toContain('Add your first dated note');
  expect(card('Day of week').text()).toMatch(/Saturdays \+[\d,]+ kcal vs target/);
  expect(card('Over-target days').attributes('href')).toBe('#insights/foods');
  await go('insights/protein');
  expect(app.find('[aria-labelledby="protein-heading"]').exists()).toBe(true);
  expect(app.find('.back-link').attributes('href')).toBe('#insights');
  expect(app.find('.insight-grid').exists()).toBe(false);
});
