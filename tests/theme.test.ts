import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import App from '../src/App.vue';
import { MemoryGateway } from './fixtures/memory-gateway';
import { readTheme } from '../src/theme';

afterEach(() => { window.location.hash = ''; localStorage.clear(); delete document.documentElement.dataset.theme; });

test('appearance follows the system by default and can be set to light or dark on this device', async () => {
  window.location.hash = '#settings/preferences';
  const app = mount(App, { props: { gateway: new MemoryGateway() }, attachTo: document.body });
  await flushPromises();
  const select = app.get('#theme');
  expect((select.element as HTMLSelectElement).value).toBe('system');
  expect(document.documentElement.dataset.theme).toBeUndefined();
  await select.setValue('dark');
  await select.trigger('change');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(readTheme()).toBe('dark');
  await select.setValue('system');
  await select.trigger('change');
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(localStorage.getItem('fitness-insights-theme')).toBeNull();
  app.unmount();
});

test('every color role has a dark value, applied for the system setting and for an explicit choice', () => {
  const css = readFileSync('src/style.css', 'utf8');
  const roles = [...css.match(/:root \{[^}]*\}/)![0].matchAll(/(--[a-z0-9-]+):/g)].map((match) => match[1]).filter((role) => !/^--(radius|space|text-number|text-small)/.test(role));
  expect(roles.length).toBeGreaterThan(15);
  const dark = css.slice(css.indexOf(':root[data-theme=dark] {'));
  for (const role of roles) expect(dark).toContain(`${role}:`);
  expect(css).toContain('@media (prefers-color-scheme: dark)');
  expect(css).toContain(':root:not([data-theme=light])');
});
