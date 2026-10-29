<script setup lang="ts">
import { computed } from 'vue';
import { barPath, chartHeight as height, chartMargin as margin, compact, niceStep, plotHeight } from './chart-utils';
import { useChartWidth } from './use-chart-width';
import { useScrub } from './use-scrub';
import { useNarrow } from './use-narrow';
import { ref, watch } from 'vue';

/**
 * Small categorical chart (months, weekdays, weeks, buckets) on one value axis. Bars start at zero
 * (negative values extend down from it); lines join only adjacent categories that both have a value.
 * Every series in one chart shares a unit, so there is never a second axis. Missing values stay gaps.
 */
export interface CategorySeries { key: string; name: string; values: Array<number | null>; tone: string; dashed?: boolean }

const props = withDefaults(defineProps<{ labels: string[]; series: CategorySeries[]; kind?: 'bar' | 'line'; title: string; unit?: string; selected?: number | null; zero?: boolean; phoneLimit?: number }>(),
  { kind: 'bar', unit: '', selected: null, zero: true, phoneLimit: 26 });
const emit = defineEmits<{ select: [index: number] }>();
const { root, width } = useChartWidth();

// Ticket 36: on phones, long category charts show the latest columns first, with the full range one tap away.
const narrow = useNarrow();
const showAll = ref(false);
watch(() => props.labels.length, () => { showAll.value = false; });
const offset = computed(() => (narrow.value && !showAll.value && props.labels.length > props.phoneLimit ? props.labels.length - props.phoneLimit : 0));
const labels = computed(() => props.labels.slice(offset.value));
const series = computed(() => props.series.map((item) => ({ ...item, values: item.values.slice(offset.value) })));
const selected = computed(() => (props.selected === null || props.selected < offset.value ? null : props.selected - offset.value));
const pick = (index: number) => emit('select', index + offset.value);
const scrub = useScrub((x) => { const index = Math.floor((x - margin.left) / band.value); return index >= 0 && index < count.value ? index : null; }, pick);
const floating = computed(() => {
  if (selected.value === null) return null;
  const index = selected.value;
  const text = `${labels.value[index]}: ${series.value.map((item) => `${series.value.length > 1 ? `${item.name} ` : ''}${item.values[index] === null ? 'n/a' : `${Math.round(item.values[index]! * 100) / 100}${props.unit}`}`).join(' · ')}`;
  const left = Math.min(Math.max(x(index), 70), width.value - 70);
  return { text, left };
});

const count = computed(() => labels.value.length);
const band = computed(() => Math.max(width.value - margin.left - margin.right, 80) / Math.max(count.value, 1));
const x = (index: number) => margin.left + index * band.value + band.value / 2;
const scale = computed(() => {
  const values = series.value.flatMap((item) => item.values).filter((value): value is number => value !== null);
  if (!values.length) return null;
  let low = Math.min(...values, ...(props.zero ? [0] : []));
  let high = Math.max(...values, ...(props.zero ? [0] : []));
  if (low === high) { low -= 1; high += 1; }
  const step = niceStep(high - low);
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const y = (value: number) => margin.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Number(tick.toFixed(6)));
  return { y, ticks, step, base: y(Math.min(Math.max(0, min), max)) };
});
const barWidth = computed(() => Math.max(Math.min(24, (band.value - 4) / Math.max(series.value.length, 1) - 2), 2));
const bars = computed(() => (props.kind !== 'bar' || !scale.value ? [] : series.value.flatMap((item, seriesIndex) => item.values.flatMap((value, index) => {
  if (value === null) return [];
  const shift = (seriesIndex - (series.value.length - 1) / 2) * (barWidth.value + 2);
  const path = barPath(x(index) + shift, barWidth.value, scale.value!.base, scale.value!.y(value));
  return path ? [{ key: `${item.key}-${index}`, path, tone: item.tone }] : [];
}))));
const lines = computed(() => (props.kind !== 'line' || !scale.value ? [] : series.value.map((item) => {
  let path = '';
  item.values.forEach((value, index) => { if (value !== null) path += `${index > 0 && item.values[index - 1] !== null ? 'L' : 'M'}${x(index)},${scale.value!.y(value)}`; });
  return { ...item, path, dots: item.values.flatMap((value, index) => (value === null ? [] : [{ index, cx: x(index), cy: scale.value!.y(value) }])) };
})));
const labelEvery = computed(() => Math.max(1, Math.ceil(count.value / Math.max(Math.floor((width.value - margin.left) / 58), 1))));
/** Axis labels precise enough that neighboring ticks never read the same. */
function tickLabel(tick: number, step: number): string {
  if (step < 1) {
    const decimals = Math.min(3, (String(Number(step.toPrecision(6))).split('.')[1] ?? '').length);
    return `${tick < 0 ? '−' : ''}${Math.abs(tick).toFixed(decimals)}`;
  }
  return step < 100 && Math.abs(tick) >= 1000 ? Math.round(tick).toLocaleString('en-US') : compact(tick);
}
function onKey(event: KeyboardEvent) {
  const current = selected.value ?? count.value - 1;
  const next = event.key === 'ArrowLeft' ? current - 1 : event.key === 'ArrowRight' ? current + 1 : null;
  if (next === null || !count.value) return;
  event.preventDefault();
  pick(Math.min(Math.max(next, 0), count.value - 1));
}
</script>

<template>
  <figure ref="root" class="chart-figure category-chart">
    <figcaption><h3>{{ title }}</h3>
      <ul v-if="series.length > 1" class="chart-legend" aria-label="Legend">
        <li v-for="item in series" :key="item.key"><i :class="['key', kind === 'bar' ? 'key-bar' : 'key-line', `tone-${item.tone}`, { dashed: item.dashed }]"></i>{{ item.name }}</li>
      </ul></figcaption>
    <p v-if="!scale" class="field-help">No values to chart.</p>
    <div v-else class="chart-plot">
    <svg :width="width" :height="height" role="group" tabindex="0" :aria-label="`${title}. Use the left and right arrow keys to choose a column; its values appear in the table.`" @keydown="onKey"
      @pointerdown="scrub.onPointerdown" @pointermove="scrub.onPointermove" @pointerup="scrub.onPointerup" @pointercancel="scrub.onPointercancel">
      <g class="grid">
        <g v-for="tick in scale.ticks" :key="tick"><line :x1="margin.left" :x2="width - margin.right" :y1="scale.y(tick)" :y2="scale.y(tick)" />
          <text :x="margin.left - 6" :y="scale.y(tick) + 3" text-anchor="end">{{ tickLabel(tick, scale.step) }}</text></g>
      </g>
      <rect v-if="selected !== null && selected >= 0" class="crosshair" :x="margin.left + selected * band" :y="margin.top" :width="band" :height="plotHeight" />
      <line v-if="zero" class="zero-line" :x1="margin.left" :x2="width - margin.right" :y1="scale.base" :y2="scale.base" />
      <path v-for="bar in bars" :key="bar.key" :d="bar.path" :class="['category-bar', `tone-${bar.tone}`]" />
      <g v-for="line in lines" :key="line.key">
        <path :d="line.path" :class="['category-line', `tone-${line.tone}`, { dashed: line.dashed }]" />
        <circle v-for="dot in line.dots" :key="dot.index" :cx="dot.cx" :cy="dot.cy" r="4" :class="['category-dot', `tone-${line.tone}`]" />
      </g>
      <g class="x-labels"><text v-for="(label, index) in labels" v-show="index % labelEvery === 0" :key="index" :x="x(index)" :y="height - 8" text-anchor="middle">{{ label }}</text></g>
      <rect v-for="(label, index) in labels" :key="`hit-${index}`" class="hit" :x="margin.left + index * band" :y="0" :width="band" :height="margin.top + plotHeight"
        @pointerenter="pick(index)" @click="pick(index)"><title>{{ label }}: {{ series.map((item) => `${item.name} ${item.values[index] === null ? 'not available' : `${Math.round(item.values[index]! * 100) / 100}${unit}`}`).join('; ') }}</title></rect>
    </svg>
    <p v-if="floating" class="chart-float" aria-hidden="true" :style="{ left: `${floating.left}px` }">{{ floating.text }}</p>
    </div>
    <button v-if="offset || showAll" type="button" class="text-button chart-range" @click="showAll = !showAll">{{ showAll ? `Show the latest ${phoneLimit}` : `Show all ${props.labels.length}` }}</button>
  </figure>
</template>
