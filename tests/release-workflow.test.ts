import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import { addDays } from '../src/analysis/eligibility';
import { reportingToday } from '../src/import/preview';
import { dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';
import { MemoryGateway } from './fixtures/memory-gateway';

// Ticket 14: the owner's weekly workflow end to end through the UI, with two "devices" sharing one backend.
const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; vi.restoreAllMocks(); });
const yesterday = addDays(reportingToday(), -1);
async function until(condition: () => boolean, what: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
  }
  throw new Error(`Timed out waiting for ${what}`);
}
async function device(gateway: MemoryGateway, page: string) {
  window.location.hash = `#${page}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await until(() => !app.text().includes('Opening your workspace'), 'the workspace');
  for (let attempt = 0; attempt < 8; attempt += 1) await flushPromises();
  return app;
}
const button = (app: VueWrapper, label: string) => {
  const found = app.findAll('button').find((item) => item.text() === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
/** 56 days ending yesterday; `override` changes one day's calories. */
function workbook(override?: { date: string; calories: number }) {
  return syntheticWorkbook(Array.from({ length: 56 }, (_, index) => {
    const date = addDays(yesterday, index - 55);
    return dailyRow(date, { 'Calories (kcal)': override?.date === date ? override.calories : index >= 28 && index % 7 === 5 ? 3500 : 2200, Expenditure: 2500,
      'Weight (lb)': 201 - 0.1 * index, 'Trend Weight (lb)': 200 - 0.1 * index, Steps: 8000 });
  }));
}
/** Both simulated devices share one window URL, so bring the phone back to Settings before using it. */
async function backToSettings() {
  window.location.hash = '#settings';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  for (let attempt = 0; attempt < 8; attempt += 1) await flushPromises();
}
async function importOnPhone(phone: VueWrapper, bytes: Uint8Array) {
  await backToSettings();
  const input = phone.get('input[type="file"][multiple]');
  Object.defineProperty(input.element, 'files', { value: [new File([bytes as BlobPart], 'MacroFactor.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })], configurable: true });
  await input.trigger('change');
  await until(() => phone.text().includes('Confirm import'), 'the import preview');
  await button(phone, 'Confirm import').trigger('click');
  await until(() => phone.text().includes('Import confirmed'), 'the import');
}
const intakeTile = (app: VueWrapper) => app.findAll('.metric-tile').find((tile) => tile.find('h4').text() === 'Mean intake')!.text();

test('import on a phone, read on another device, correct, undo, keep reports, and back up and restore', async () => {
  const gateway = new MemoryGateway();
  gateway.clock = Date.now();

  const phone = await device(gateway, 'settings');
  await importOnPhone(phone, workbook());
  expect(gateway.revisionId).toBe(1);

  // Another device sees the import after opening (refresh).
  const computer = await device(gateway, 'nutrition');
  expect(intakeTile(computer)).toContain('2,386 kcal');
  computer.unmount();
  mounted.splice(mounted.indexOf(computer), 1);
  const overview = await device(gateway, 'overview');
  await until(() => gateway.reports.length === 1, 'the first report');
  overview.unmount();
  mounted.splice(mounted.indexOf(overview), 1);

  // A corrected re-import on the phone changes one day only.
  const corrected = addDays(yesterday, -3);
  await importOnPhone(phone, workbook({ date: corrected, calories: 4300 }));
  expect(phone.text()).toContain('Import confirmed: daily records 0 added, 1 corrected');
  const afterCorrection = await device(gateway, 'nutrition');
  expect(intakeTile(afterCorrection)).toContain('2,461 kcal');
  afterCorrection.unmount();
  mounted.splice(mounted.indexOf(afterCorrection), 1);
  const secondOverview = await device(gateway, 'overview');
  await until(() => gateway.reports.length === 2, 'the second report');
  expect(JSON.stringify(gateway.reports[0].content)).toContain('Mean intake was 2,386 kcal');
  secondOverview.unmount();
  mounted.splice(mounted.indexOf(secondOverview), 1);

  // Undo the correction from Change history.
  await backToSettings();
  await button(phone, 'Undo this change').trigger('click');
  await until(() => phone.text().includes('Confirm undo'), 'the undo preview');
  await button(phone, 'Confirm undo').trigger('click');
  await until(() => phone.text().includes('Undone:'), 'the undo');
  expect(gateway.active.find((row) => row.date === corrected && row.domain === 'nutrition_totals')?.values['Calories (kcal)']).toBe(2200);

  // Back up, then restore into a fresh installation.
  let captured: Blob | null = null;
  URL.createObjectURL = vi.fn((blob: Blob) => { captured = blob; return 'blob:backup'; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await button(phone, 'Download backup').trigger('click');
  await until(() => captured !== null && phone.text().includes('Backup ready'), 'the backup');
  const bytes = new Uint8Array(await (captured as unknown as Blob).arrayBuffer());

  const fresh = new MemoryGateway();
  fresh.clock = Date.now();
  const restored = await device(fresh, 'settings');
  const input = restored.get('input[aria-label="Choose a backup file"]');
  Object.defineProperty(input.element, 'files', { value: [{ name: 'backup.zip', arrayBuffer: async () => bytes.slice().buffer }], configurable: true });
  await input.trigger('change');
  await until(() => restored.text().includes('All checksums match.'), 'the restore preview');
  await button(restored, 'Replace with this backup').trigger('click');
  await until(() => restored.text().includes('Restored from backup.zip'), 'the restore');
  expect((await fresh.loadHistory()).records).toEqual((await gateway.loadHistory()).records);
  expect(fresh.reports.map((report) => report.fingerprint)).toEqual(gateway.reports.map((report) => report.fingerprint));
  expect((await fresh.loadHistory()).imports.map((item) => item.kind)).toEqual((await gateway.loadHistory()).imports.map((item) => item.kind));
});
