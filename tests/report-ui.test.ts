import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { MemoryGateway } from './fixtures/memory-gateway';
import { seededGateway } from './fixtures/seeded-history';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });

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
