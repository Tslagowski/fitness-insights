/**
 * Ticket 36: drag a finger across a chart to move its selection. Touch and pen drags are captured by the
 * chart so the column under the finger is selected continuously; mouse hover keeps its existing behavior.
 * Charts set `touch-action: pan-y`, so vertical swipes still scroll the page.
 */
export function useScrub(indexAt: (x: number) => number | null, select: (index: number) => void) {
  let active = false;
  const pick = (event: PointerEvent) => {
    const box = (event.currentTarget as Element).getBoundingClientRect();
    const index = indexAt(event.clientX - box.left);
    if (index !== null) select(index);
  };
  return {
    onPointerdown(event: PointerEvent) {
      if (event.pointerType === 'mouse') return;
      active = true;
      try { (event.currentTarget as Element).setPointerCapture(event.pointerId); } catch { /* synthetic or already-released pointer */ }
      pick(event);
    },
    onPointermove(event: PointerEvent) { if (active) pick(event); },
    onPointerup() { active = false; },
    onPointercancel() { active = false; },
  };
}
