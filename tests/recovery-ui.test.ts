import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';
import { MemoryGateway } from './fixtures/memory-gateway';
import { seededGateway, yesterday } from './fixtures/seeded-history';

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
async function open(gateway: MemoryGateway, page = 'settings/data') {
  window.location.hash = `#${page}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  for (let attempt = 0; attempt < 8; attempt += 1) await flushPromises();
  return app;
}
/** Selects a synthetic workbook in the import panel and waits for its preview. */
async function previewImport(app: VueWrapper, steps: number) {
  const bytes = syntheticWorkbook([dailyRow(yesterday(), { Steps: steps })]);
  const input = app.get('.section-card input[type="file"][multiple]');
  Object.defineProperty(input.element, 'files', { value: [new File([bytes as BlobPart], 'export.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })], configurable: true });
  await input.trigger('change');
  await until(() => app.text().includes('Confirm import') || app.find('[role="alert"]').exists(), 'the import preview');
}
const confirmImport = async (app: VueWrapper) => {
  await app.findAll('button').find((button) => button.text() === 'Confirm import')!.trigger('click');
  await until(() => !app.text().includes('Saving'), 'the import');
  for (let attempt = 0; attempt < 8; attempt += 1) await flushPromises();
};

test('usage is shown against the free limits with a level label, and the recovery steps are available', async () => {
  const gateway = await seededGateway();
  gateway.capacityStatus = { ...gateway.capacityStatus, databaseBytes: 400_000_000 };
  const app = await open(gateway);
  const panel = app.get('.service-status');
  expect(panel.get('[aria-label="Database usage"]').attributes('aria-valuetext')).toBe('76% used, Getting full');
  expect(panel.text()).toContain('381.5 MB of 500 MB');
  expect(panel.text()).toContain('! Getting full · 76% used');
  expect(panel.text()).toContain('✓ Plenty of room');
  expect(panel.text()).toContain('the database itself refuses new data at 95%');
  expect(panel.get('.recovery-guide').text()).toContain('choose Restore/Resume');
  expect(panel.get('.recovery-guide').text()).toContain('a retry never saves twice');
});

test('an import that would cross 90% is stopped before saving, with guidance; existing data is unchanged', async () => {
  const gateway = await seededGateway();
  gateway.capacityStatus = { ...gateway.capacityStatus, databaseBytes: 480_000_000 };
  const before = gateway.active.length;
  const app = await open(gateway, 'settings/import');
  await previewImport(app, 12345);
  await confirmImport(app);
  expect(app.get('[role="alert"]').text()).toContain('the app stops at 90%). Nothing was changed.');
  expect(gateway.calls.filter((call) => call.method === 'commitSources' && call.requestId !== 'seed')).toEqual([]);
  expect(gateway.active.length).toBe(before);
});

test("if the database's own hard stop refuses an import, the app says so and a later retry saves once", async () => {
  const gateway = await seededGateway();
  gateway.databaseFull = true;
  const app = await open(gateway, 'settings/import');
  await previewImport(app, 23456);
  await confirmImport(app);
  expect(app.get('[role="alert"]').text()).toContain('nearly full, so nothing new was saved. Your existing data is unchanged.');
  expect(gateway.active.find((row) => row.domain === 'steps' && row.date === yesterday())?.values.Steps).toBe(9000);
  gateway.databaseFull = false;
  await confirmImport(app);
  expect(app.find('[role="status"]').text()).toContain('Import confirmed');
  expect(gateway.active.filter((row) => row.domain === 'steps' && row.date === yesterday()).map((row) => row.values.Steps)).toEqual([23456]);
  const commits = gateway.calls.filter((call) => call.method === 'commitSources' && call.requestId !== 'seed');
  expect(commits).toHaveLength(2);
  expect(new Set(commits.map((call) => call.requestId)).size).toBe(1);
});

test('unfinished restore uploads can be reviewed and removed without touching saved history', async () => {
  const gateway = await seededGateway();
  gateway.capacityStatus = { ...gateway.capacityStatus, stagingUploads: 2, stagingBytes: 2_500_000, oldestStagingAt: '2026-10-19T15:00:00Z' };
  const records = gateway.active.length;
  const app = await open(gateway);
  expect(app.get('[aria-label="Unfinished restore uploads"]').text()).toContain('2 unfinished restore uploads (2.4 MB)');
  await app.findAll('button').find((button) => button.text() === 'Remove unfinished uploads')!.trigger('click');
  await until(() => app.text().includes('Removed 2 unfinished restore uploads'), 'the cleanup');
  expect(app.find('[aria-label="Unfinished restore uploads"]').exists()).toBe(false);
  expect(gateway.active.length).toBe(records);
});

test('when the service is unreachable, the status panel and the backup say so honestly', async () => {
  const gateway = await seededGateway();
  const app = await open(gateway);
  gateway.failReads = true;
  await app.findAll('.service-status button').find((button) => button.text() === 'Check again')!.trigger('click');
  await until(() => app.find('.service-status [role="alert"]').exists(), 'the unreachable message');
  expect(app.get('.service-status [role="alert"]').text()).toContain('Your saved data is not affected.');
  await app.findAll('.backup-panel button').find((button) => button.text() === 'Download backup')!.trigger('click');
  await until(() => app.find('.backup-panel [role="alert"]').exists(), 'the backup failure');
  expect(app.get('.backup-panel [role="alert"]').text()).toContain('a partial backup is never offered');
});

test('a full database is reported when saving a report, and the overview still shows', async () => {
  const gateway = await seededGateway();
  gateway.databaseFull = true;
  const app = await open(gateway, 'overview');
  await until(() => app.text().includes('nearly full'), 'the report message');
  expect(app.get('.report-history').text()).toContain('not saved as a report because the free database is nearly full');
  expect(app.get('.written-overview').text()).toContain('Mean intake was 2,386 kcal');
});
