import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import { dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';
import { MemoryGateway } from './fixtures/memory-gateway';
import { go } from './fixtures/navigation';
import { parseWorkbook } from '../src/import/workbook';

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });

async function openSettings(gateway: MemoryGateway, view = 'data') {
  window.location.hash = `#settings/${view}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  return app;
}
async function settle(app: VueWrapper, until: () => boolean) {
  for (let attempt = 0; attempt < 30 && !until(); attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 10)); await flushPromises(); }
}
async function chooseFile(app: VueWrapper, bytes: Uint8Array, name: string) {
  const input = app.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [new File([bytes as BlobPart], name)], configurable: true });
  await input.trigger('change');
  await settle(app, () => app.text().includes('Confirm import') || app.find('[role="alert"]').exists());
}
const click = async (app: VueWrapper, label: string) => {
  const button = app.findAll('button').find((item) => item.text().includes(label));
  if (!button) throw new Error(`No button "${label}" in: ${app.text()}`);
  await button.trigger('click');
  await flushPromises();
};
const firstWorkbook = syntheticWorkbook([dailyRow('2026-09-01'), dailyRow('2026-09-02')]);

async function seeded() {
  const gateway = new MemoryGateway();
  await gateway.commitSources({ requestId: 'seed', expectedRevisionId: null, acceptReconciliation: false, food: [], workouts: [], daily: parseWorkbook(firstWorkbook).records,
    sources: [{ name: 'first.xlsx', kind: 'workbook', sha256: 'a'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() }] });
  return gateway;
}

test('an overlapping workbook previews its single correction and says which saved dates are kept', async () => {
  const gateway = await seeded();
  const app = await openSettings(gateway, 'import');
  await chooseFile(app, syntheticWorkbook([dailyRow('2026-09-02', { 'Weight (lb)': 297.8 }), dailyRow('2026-09-03')]), 'newer.xlsx');
  const summary = app.get('[aria-label="Proposed changes"]').text();
  expect(summary).toMatch(/6\s*new daily records/);
  expect(summary).toMatch(/1\s*correction to saved daily records/);
  expect(summary).toMatch(/5\s*already saved/);
  expect(app.text()).toContain('Sep 2, 2026 · Scale weight');
  expect(app.text()).toContain('Weight (lb): 181 → now Weight (lb): 297.8');
  expect(app.text()).toContain('1 saved date is not in these files and will stay exactly as it is.');
  await click(app, 'Confirm import');
  await go('settings/data');
  expect(app.text()).toContain('Imported newer.xlsx: 6 added, 1 corrected, 5 unchanged');
});

test('clearing one domain on one day keeps the rest, and undo restores it exactly', async () => {
  const gateway = await seeded();
  const app = await openSettings(gateway);
  await app.get('#correct-date').setValue('2026-09-02');
  await app.get('#correct-domain').setValue('scale_weight');
  expect(app.text()).toContain('Weight (lb): 181');
  await click(app, 'Review clearing');
  expect(app.get('[aria-label="Confirm clearing"]').text()).toContain('Remove Scale weight for Sep 2, 2026 (1 recorded value)');
  expect(gateway.calls.some((call) => call.method === 'clearDay')).toBe(false);
  await click(app, 'Clear this data');
  expect(app.get('[role="status"]').text()).toContain('Cleared Scale weight on Sep 2, 2026');
  expect(gateway.active.some((row) => row.date === '2026-09-02' && row.domain === 'scale_weight')).toBe(false);
  expect(gateway.active.filter((row) => row.date === '2026-09-02')).toHaveLength(5);
  expect(gateway.active.filter((row) => row.date === '2026-09-01')).toHaveLength(6);

  const log = () => app.get('[aria-label="Change log"]').text();
  expect(log()).toContain('Cleared Scale weight on Sep 2, 2026');
  await click(app, 'Undo this change');
  expect(app.get('[aria-label="Confirm undo"]').text()).toContain('1 restored');
  await click(app, 'Confirm undo');
  expect(app.text()).toContain('Undone: 1 restored');
  expect(gateway.active.find((row) => row.date === '2026-09-02' && row.domain === 'scale_weight')?.values).toEqual({ 'Weight (lb)': 181 });
  expect(log()).toContain('Undid clearing Scale weight on Sep 2, 2026');
  expect(app.find('.change-log li.undone').text()).toContain('Cleared Scale weight');
});

test('undo steps back through imports until there is nothing left to undo', async () => {
  const gateway = await seeded();
  const app = await openSettings(gateway);
  await click(app, 'Undo this change');
  expect(app.get('[aria-label="Confirm undo"]').text()).toContain('12 removed');
  await click(app, 'Confirm undo');
  expect(gateway.active).toHaveLength(0);
  expect(app.text()).toContain('There is nothing to undo.');
  await go('settings/import');
  expect(app.text()).toContain('Nothing imported yet.');
});

test('a change from another device makes a pending undo or clear refresh instead of overwriting', async () => {
  const gateway = await seeded();
  const app = await openSettings(gateway);
  await click(app, 'Undo this change');
  await gateway.otherDeviceImport([{ date: '2026-09-05', domain: 'steps', values: { Steps: 4000 } }]);
  await click(app, 'Confirm undo');
  expect(app.get('[role="alert"]').text()).toContain('nothing was undone');
  expect(gateway.active).toHaveLength(13);
  expect(app.text()).toContain('Imported other-device.xlsx');

  await app.get('#correct-date').setValue('2026-09-01');
  await app.get('#correct-domain').setValue('steps');
  await click(app, 'Review clearing');
  await gateway.otherDeviceImport([{ date: '2026-09-06', domain: 'steps', values: { Steps: 5000 } }]);
  await click(app, 'Clear this data');
  expect(app.get('#correct-heading').element.closest('section')!.textContent).toContain('Nothing was cleared');
  expect(gateway.active.some((row) => row.date === '2026-09-01' && row.domain === 'steps')).toBe(true);
});

test('a failed clear can be retried without clearing twice', async () => {
  const gateway = await seeded();
  const app = await openSettings(gateway);
  await app.get('#correct-date').setValue('2026-09-01');
  await app.get('#correct-domain').setValue('steps');
  await click(app, 'Review clearing');
  gateway.failWrites = true;
  await click(app, 'Clear this data');
  expect(app.text()).toContain('Nothing was cleared. Check your connection');
  gateway.failWrites = false;
  await click(app, 'Clear this data');
  const clears = gateway.calls.filter((call) => call.method === 'clearDay');
  expect(clears).toHaveLength(2);
  expect(clears[0].requestId).toBe(clears[1].requestId);
  expect(gateway.events.filter((event) => event.kind === 'clear')).toHaveLength(1);
});
