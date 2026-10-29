<script setup lang="ts">
import { computed } from 'vue';

// A tiny trend line for a tile: no axes, gaps never bridged, last point marked. Decorative; the tile's text carries the values.
const props = withDefaults(defineProps<{ values: Array<number | null>; width?: number; height?: number }>(), { width: 120, height: 32 });
const path = computed(() => {
  const present = props.values.filter((value): value is number => value !== null);
  if (present.length < 2) return { d: '', last: null as null | { x: number; y: number } };
  const low = Math.min(...present);
  const high = Math.max(...present);
  const span = high - low || 1;
  const step = props.width / Math.max(props.values.length - 1, 1);
  const y = (value: number) => 3 + (props.height - 6) * (1 - (value - low) / span);
  let d = '';
  let last: { x: number; y: number } | null = null;
  props.values.forEach((value, index) => {
    if (value === null) return;
    const point = { x: index * step, y: y(value) };
    d += `${index > 0 && props.values[index - 1] !== null ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    last = point;
  });
  return { d, last };
});
</script>

<template>
  <svg class="sparkline" :viewBox="`-3 0 ${width + 6} ${height}`" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path v-if="path.d" :d="path.d" />
    <path v-if="path.last" class="spark-dot" :d="`M${path.last.x},${path.last.y}l0,0`" />
  </svg>
</template>
