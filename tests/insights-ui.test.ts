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
  expect(selected).toMatch(/Mean intake\s*2,128 kcal \(\d+ days\)/);
  expect(selected).toContain('Working sets per week');
  expect(section.findAll('.phase-band')).toHaveLength(3);
  expect(section.text()).toContain('How phases are found');
});
