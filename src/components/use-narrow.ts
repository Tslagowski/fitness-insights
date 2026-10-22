import { onBeforeUnmount, onMounted, ref } from 'vue';

/** Phone-width layout (matches the 760px CSS breakpoint). False where media queries are unavailable. */
export const narrowQuery = '(max-width: 760px)';
export function useNarrow() {
  const narrow = ref(false);
  let media: MediaQueryList | null = null;
  const update = () => { narrow.value = !!media?.matches; };
  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    media = window.matchMedia(narrowQuery);
    update();
    media.addEventListener?.('change', update);
  });
  onBeforeUnmount(() => media?.removeEventListener?.('change', update));
  return narrow;
}
