import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import App from '../src/App.vue';
import { defaultPreferences, type Gateway, type Identity, type DisplayDensity } from '../src/gateway';

class MemoryGateway implements Gateway {
  identity: Identity | null = { id: 'owner', name: 'Trevis' };
  owner = true;
  density: DisplayDensity = 'comfortable';
  failSave = false;
  listener = () => {};
  async getIdentity() { return this.identity; }
  async isOwner() { return this.owner; }
  async loadPreferences() { return { ...defaultPreferences, displayDensity: this.density }; }
  async savePreferences(_userId: string, density: DisplayDensity) {
    if (this.failSave) throw new Error('Network unavailable');
    this.density = density;
    return this.loadPreferences();
  }
  async signIn() {}
  async signOut() { this.identity = null; this.listener(); }
  onIdentityChange(listener: () => void) { this.listener = listener; return () => { this.listener = () => {}; }; }
}

test('the owner saves density and sees the saved choice on a fresh app instance', async () => {
  const gateway = new MemoryGateway();
  const firstDevice = mount(App, { props: { gateway } });
  await flushPromises();
  await firstDevice.get('a[href="#settings"]').trigger('click');
  await firstDevice.get('select[aria-label="Display density"]').setValue('compact');
  await firstDevice.get('form').trigger('submit');
  await flushPromises();
  expect(firstDevice.text()).toContain('Preference saved');
  firstDevice.unmount();

  const secondDevice = mount(App, { props: { gateway } });
  await flushPromises();
  await secondDevice.get('a[href="#settings"]').trigger('click');
  expect((secondDevice.get('select').element as HTMLSelectElement).value).toBe('compact');
  expect(secondDevice.text()).toContain('America/Denver');
  secondDevice.unmount();
});

test('an unauthorized account cannot open preferences', async () => {
  const gateway = new MemoryGateway();
  gateway.owner = false;
  const app = mount(App, { props: { gateway } });
  await flushPromises();
  await app.get('a[href="#settings"]').trigger('click');
  expect(app.text()).toContain('This account does not have access');
  expect(app.find('select').exists()).toBe(false);
  app.unmount();
});

test('a failed save keeps the last confirmed preference and supports retry', async () => {
  const gateway = new MemoryGateway();
  gateway.failSave = true;
  const app = mount(App, { props: { gateway } });
  await flushPromises();
  await app.get('a[href="#settings"]').trigger('click');
  await app.get('select').setValue('compact');
  await app.get('form').trigger('submit');
  await flushPromises();
  expect(app.get('[role="alert"]').text()).toContain('not saved');
  expect(app.get('.app-layout').attributes('data-density')).toBe('comfortable');
  expect(app.find('[role="status"]').exists()).toBe(false);
  gateway.failSave = false;
  await app.get('form').trigger('submit');
  await flushPromises();
  expect(app.get('.app-layout').attributes('data-density')).toBe('compact');
  app.unmount();
});

test('an in-flight preference load cannot reveal data after sign-out', async () => {
  const gateway = new MemoryGateway();
  let resolveLoad!: (value: typeof defaultPreferences) => void;
  gateway.loadPreferences = () => new Promise((resolve) => { resolveLoad = resolve; });
  const app = mount(App, { props: { gateway } });
  await flushPromises();
  const signOut = app.findAll('button').find((button) => button.text() === 'Sign out');
  await signOut!.trigger('click');
  resolveLoad({ ...defaultPreferences, displayDensity: 'compact' });
  await flushPromises();
  expect(app.text()).toContain('Continue with GitHub');
  expect(app.find('select').exists()).toBe(false);
  expect(app.get('.app-layout').attributes('data-density')).toBe('comfortable');
  app.unmount();
});

test('an unconfigured installation offers setup information without a fake sign-in', async () => {
  const app = mount(App, { props: { gateway: null } });
  await flushPromises();
  expect(app.text()).toContain('Workspace setup needed');
  expect(app.text()).not.toContain('Continue with GitHub');
  app.unmount();
});

test('failed sign-out keeps a recovery action and prevents a new sign-in', async () => {
  const gateway = new MemoryGateway();
  gateway.signOut = async () => { throw new Error('Logout unavailable'); };
  const app = mount(App, { props: { gateway } });
  await flushPromises();
  await app.findAll('button').find((button) => button.text() === 'Sign out')!.trigger('click');
  await flushPromises();
  expect(app.text()).toContain('Sign-out could not be completed');
  const signIn = app.findAll('button').find((button) => button.text().includes('Continue with GitHub'));
  expect(signIn!.attributes('disabled')).toBeDefined();
  expect(app.findAll('button').some((button) => button.text() === 'Sign out')).toBe(true);
  gateway.listener();
  await flushPromises();
  expect(app.find('select').exists()).toBe(false);
  expect(app.text()).toContain('Sign-out could not be completed');
  gateway.signOut = async () => { gateway.identity = null; gateway.listener(); };
  await app.findAll('button').find((button) => button.text() === 'Sign out')!.trigger('click');
  await flushPromises();
  expect(app.find('[role="alert"]').exists()).toBe(false);
  expect(app.findAll('button').find((button) => button.text().includes('Continue with GitHub'))!.attributes('disabled')).toBeUndefined();
  app.unmount();
});
