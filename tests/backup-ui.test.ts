import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { MemoryGateway } from './fixtures/memory-gateway';
import { seededGateway, yesterday } from './fixtures/seeded-history';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; vi.restoreAllMocks(); });
const settle = async () => { for (let attempt = 0; attempt < 8; attempt += 1) await flushPromises(); };
/** Waits for work that uses real timers (hashing, ZIP) until the condition holds. */
async function until(condition: () => boolean, what: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const idle = (app: VueWrapper) => !app.text().includes('Building the backup') && !app.text().includes('Collecting your saved') && !app.text().includes('Checking the backup') && !/Uploading|Storing original|Replacing your saved/.test(app.text());
async function open(gateway: MemoryGateway, page = 'settings') {
  window.location.hash = `#${page}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await settle();
  return app;
}
async function downloadBackup(app: VueWrapper): Promise<Uint8Array> {
  let captured: Blob | null = null;
  URL.createObjectURL = vi.fn((blob: Blob) => { captured = blob; return 'blob:backup'; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await app.findAll('.backup-panel button').find((button) => button.text() === 'Download backup')!.trigger('click');
  await until(() => idle(app) && app.text().includes('Download backup'), 'the download');
  if (!captured) throw new Error(app.get('.backup-panel').text().slice(0, 500));
  return new Uint8Array(await (captured as unknown as Blob).arrayBuffer());
}
async function chooseFile(app: VueWrapper, bytes: Uint8Array, name = 'fitness-insights-backup.zip') {
  const input = app.get('input[aria-label="Choose a backup file"]');
  Object.defineProperty(input.element, 'files', { value: [{ name, arrayBuffer: async () => bytes.slice().buffer }], configurable: true });
  await input.trigger('change');
  await until(() => idle(app), 'the backup check');
}

test('a backup downloaded from one installation restores into a clean one with the same history, exclusions, and reports', async () => {
  const original = await seededGateway();
  await original.saveReviewDecision({ date: addDays(yesterday(), -3), domain: 'scale_weight', field: 'Weight (lb)', value: 201 - 0.1 * 52, decision: 'exclude' });
  await original.saveExerciseAlias('Bench Press', 'Flat Bench');
  (await open(original, 'overview')).unmount();
  mounted.pop();
  expect(original.reports).toHaveLength(1);
  const app = await open(original);
  const bytes = await downloadBackup(app);
  if (!app.find('.backup-panel [role="status"]').exists()) throw new Error(app.get('.backup-panel').text().slice(0, 700));
  expect(app.get('.backup-panel [role="status"]').text()).toMatch(/Backup ready: fitness-insights-backup-\d{4}-\d{2}-\d{2}\.zip/);

  const fresh = new MemoryGateway();
  fresh.clock = Date.now();
  const restoreApp = await open(fresh);
  await chooseFile(restoreApp, bytes);
  const preview = restoreApp.get('[aria-label="Restore preview"]').text();
  expect(preview).toContain('All checksums match.');
  expect(preview).toMatch(/Daily records \(incl\. superseded\)0336/);
  await restoreApp.findAll('button').find((button) => button.text() === 'Replace with this backup')!.trigger('click');
  await until(() => idle(restoreApp), 'the restore');
  expect(restoreApp.get('.backup-panel [role="status"]').text()).toContain('Restored from fitness-insights-backup.zip: 336 daily records, 0 food days, 7 workout days, and 1 saved reports.');
  const [before, after] = [await original.loadHistory(), await fresh.loadHistory()];
  expect(after.records).toEqual(before.records);
  expect(after.review).toEqual(before.review);
  expect(after.aliases).toEqual({ 'Bench Press': 'Flat Bench' });
  expect(fresh.reports.map((report) => report.fingerprint)).toEqual(original.reports.map((report) => report.fingerprint));
  expect([...fresh.archives.keys()].sort()).toEqual([...original.archives.keys()].sort());
});

test('a damaged file, a full database, an interrupted upload, or a stale preview leaves current data unchanged', async () => {
  const original = await seededGateway();
  const bytes = await downloadBackup(await open(original));
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());

  const target = await seededGateway();
  await target.otherDeviceImport([{ date: yesterday(), domain: 'steps', values: { Steps: 123 } }]);
  const app = await open(target);
  const damaged = bytes.slice();
  damaged[damaged.length - 40] ^= 0xff;
  await chooseFile(app, damaged);
  expect(app.get('.restore-block [role="alert"]').text()).toMatch(/Nothing was changed\.$/);

  target.capacityStatus = { ...target.capacityStatus, databaseBytes: 480_000_000 };
  await chooseFile(app, bytes);
  expect(app.get('.restore-block [role="alert"]').text()).toContain('the app stops at 90%');
  target.capacityStatus = { ...target.capacityStatus, databaseBytes: 40_000_000 };

  await chooseFile(app, bytes);
  target.failWrites = true;
  await app.findAll('button').find((button) => button.text() === 'Replace with this backup')!.trigger('click');
  await until(() => idle(app), 'the restore');
  expect(app.get('.restore-block [role="alert"]').text()).toContain('Nothing was replaced, and your saved history is unchanged.');
  expect(target.staging.size).toBe(0);
  target.failWrites = false;

  await target.otherDeviceImport([{ date: yesterday(), domain: 'steps', values: { Steps: 456 } }]);
  await app.findAll('button').find((button) => button.text() === 'Replace with this backup')!.trigger('click');
  await until(() => idle(app), 'the restore');
  expect(app.get('.restore-block [role="alert"]').text()).toContain('changed on another device after this preview, so nothing was replaced');
  expect(target.active.find((row) => row.domain === 'steps' && row.date === yesterday())?.values).toEqual({ Steps: 456 });
});

test('if the service cannot be read, the download says so and offers no partial backup', async () => {
  const gateway = await seededGateway();
  const app = await open(gateway);
  gateway.failArchiveDownload = true;
  URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL;
  await app.findAll('.backup-panel button').find((button) => button.text() === 'Download backup')!.trigger('click');
  await until(() => app.find('.backup-panel [role="alert"]').exists(), 'the failure');
  expect(app.get('.backup-panel [role="alert"]').text()).toContain('a partial backup is never offered');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
