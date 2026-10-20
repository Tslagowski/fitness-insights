import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import App from '../src/App.vue';
import type { Gateway } from '../src/gateway';
import { dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';
import { MemoryGateway } from './fixtures/memory-gateway';


const mounted: VueWrapper[] = [];
const commits = (gateway: MemoryGateway) => gateway.calls.filter((call) => call.method === 'commitImport');
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); window.location.hash = ''; });

async function openApp(gateway: Gateway, page = 'settings') {
  window.location.hash = `#${page}`;
  const app = mount(App, { props: { gateway }, attachTo: document.body });
  mounted.push(app);
  await flushPromises();
  return app;
}

async function chooseFile(app: VueWrapper, bytes: Uint8Array, name = 'MacroFactor-export.xlsx') {
  const input = app.get('input[type="file"]');
  const file = new File([bytes as BlobPart], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
  for (let attempt = 0; attempt < 20 && !app.text().includes('Confirm import') && !app.find('[role="alert"]').exists(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
  }
}

const button = (app: VueWrapper, label: string) => app.findAll('button').find((item) => item.text().includes(label))!;
const workbook = syntheticWorkbook([dailyRow('2026-09-01'), dailyRow('2026-09-02', { 'Weight (lb)': null })]);

test('the owner previews a workbook, confirms it, and another device sees the saved daily history', async () => {
  const gateway = new MemoryGateway();
  const phone = await openApp(gateway);
  expect(phone.text()).toContain('Nothing imported yet');
  await chooseFile(phone, workbook);
  expect(phone.text()).toContain('MacroFactor-export.xlsx');
  expect(phone.get('[aria-label="Proposed changes"]').text()).toMatch(/12\s*new daily records/);
  expect(phone.text()).toContain('Scale weight');
  expect(phone.text()).toContain('Sep 1, 2026 – Sep 2, 2026');
  expect(commits(gateway)).toHaveLength(0);

  await button(phone, 'Confirm import').trigger('click');
  await flushPromises();
  expect(phone.get('[role="status"]').text()).toContain('Import confirmed: 12 added');
  expect(gateway.active[0].sourceFileId).toMatch(/^[0-9a-f]{64}$/);
  expect(commits(gateway)[0].expectedRevisionId).toBeNull();
  expect(phone.text()).toContain('through Sep 2, 2026');

  const computer = await openApp(gateway, 'nutrition');
  expect(computer.text()).toContain('2 dates, Sep 1, 2026 – Sep 2, 2026');
  const rows = computer.findAll('.daily-table tbody tr').map((row) => row.text());
  expect(rows[0]).toContain('Sep 2, 2026');
  expect(rows[0]).toContain('—');
  expect(rows[1]).toContain('181');
});

test('an unsupported file is rejected with guidance and nothing is sent', async () => {
  const gateway = new MemoryGateway();
  const app = await openApp(gateway);
  await chooseFile(app, new TextEncoder().encode('Date,Weight\n2026-09-01,181'), 'notes.xlsx');
  expect(app.get('[role="alert"]').text()).toContain('not an Excel workbook');
  expect(app.text()).not.toContain('Confirm import');
  expect(commits(gateway)).toHaveLength(0);
});

test('a failed commit keeps the previous history, and retrying reuses the same request so it cannot duplicate', async () => {
  const gateway = new MemoryGateway();
  const app = await openApp(gateway);
  await chooseFile(app, workbook);
  gateway.failWrites = true;
  await button(app, 'Confirm import').trigger('click');
  await flushPromises();
  expect(app.get('[role="alert"]').text()).toContain('previous history is unchanged');
  expect(gateway.active).toHaveLength(0);
  gateway.failWrites = false;
  await button(app, 'Confirm import').trigger('click');
  await flushPromises();
  expect(commits(gateway)).toHaveLength(2);
  expect(commits(gateway)[0].requestId).toBe(commits(gateway)[1].requestId);
  expect(gateway.active).toHaveLength(12);
  expect(app.get('[role="status"]').text()).toContain('Import confirmed');
});

test('a stale preview cannot overwrite another device\'s import and is refreshed for review', async () => {
  const gateway = new MemoryGateway();
  const phone = await openApp(gateway);
  await chooseFile(phone, workbook);
  // Another device imports a correction while the phone's preview is open.
  await gateway.otherDeviceImport([{ date: '2026-09-01', domain: 'steps', values: { Steps: 12000 } }]);
  await button(phone, 'Confirm import').trigger('click');
  await flushPromises();
  expect(phone.get('[role="alert"]').text()).toContain('Nothing was overwritten');
  expect(gateway.active.find((row) => row.domain === 'steps')?.values).toEqual({ Steps: 12000 });
  const summary = phone.get('[aria-label="Proposed changes"]').text();
  expect(summary).toMatch(/11\s*new daily records/);
  expect(summary).toMatch(/1\s*corrections to saved records/);
  expect(phone.text()).toContain('Corrections (1)');
});

test('reimporting identical records reports no changes and creates no new version', async () => {
  const gateway = new MemoryGateway();
  const app = await openApp(gateway);
  await chooseFile(app, workbook);
  await button(app, 'Confirm import').trigger('click');
  await flushPromises();
  await chooseFile(app, workbook, 'same-data-again.xlsx');
  expect(app.text()).toContain('Everything in this workbook matches your saved history');
  await button(app, 'Confirm import').trigger('click');
  await flushPromises();
  expect(app.get('[role="status"]').text()).toContain('No changes');
  expect(gateway.revisionId).toBe(1);
  expect(gateway.active).toHaveLength(12);
});
