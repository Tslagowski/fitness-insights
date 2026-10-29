import { flushPromises } from '@vue/test-utils';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Opens a page view the way tapping a tab does (#page/view), then lets the app re-render. */
export async function go(route: string) {
  await tick(); // let any link navigation already in flight land first
  window.location.hash = `#${route}`;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await tick();
  await flushPromises();
}
