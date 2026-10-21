import { onBeforeUnmount, onMounted, ref } from 'vue';

/** Measures the chart container so SVG text stays at true pixel size (640px fallback where layout is unavailable). */
export function useChartWidth() {
  const root = ref<HTMLElement | null>(null);
  const width = ref(640);
  let observer: ResizeObserver | null = null;
  onMounted(() => {
    const measure = () => { const measured = root.value?.clientWidth ?? 0; if (measured > 0) width.value = measured; };
    measure();
    if (typeof ResizeObserver !== 'undefined' && root.value) { observer = new ResizeObserver(measure); observer.observe(root.value); }
  });
  onBeforeUnmount(() => observer?.disconnect());
  return { root, width };
}
