<script setup lang="ts">
import { computed, ref } from 'vue';
import type { OwnerNote } from '../analysis/notes';
import { formatCalendarDate } from '../import/preview';
import { chartHeight as height, chartMargin as margin, compact, dateLabels, linePath, niceStep, plotHeight } from './chart-utils';
import { useChartWidth } from './use-chart-width';

/**
 * Long-range time chart: one value line on one axis (gaps never bridged), optional shaded date bands
 * (phases), and owner-note markers. Selecting a band (click, tap, or arrow keys) emits its key; hovering
 * shows the date and value under the pointer.
 */
export interface TimelineBand { key: string; start: string; end: string; tone: string; label: string }
export interface TimelinePoint { date: string; value: number | null }

const props = withDefaults(defineProps<{ points: TimelinePoint[]; bands?: TimelineBand[]; notes?: OwnerNote[]; selected?: string | null; title: string; valueLabel: string; unit?: string; digits?: number }>(),
  { bands: () => [], notes: () => [], selected: null, unit: 'lb', digits: 1 });
const emit = defineEmits<{ select: [key: string] }>();

const { root, width } = useChartWidth();
const count = computed(() => props.points.length);
const index = computed(() => new Map(props.points.map((point, position) => [point.date, position])));
const plotWidth = computed(() => Math.max(width.value - margin.left - margin.right, 80));
const step = computed(() => plotWidth.value / Math.max(count.value, 1));
const x = (position: number) => margin.left + position * step.value + step.value / 2;
const scale = computed(() => {
  const values = props.points.flatMap((point) => (point.value === null ? [] : [point.value]));
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const tick = niceStep(Math.max(high - low, 2));
  const min = Math.floor(low / tick) * tick;
  const max = Math.max(Math.ceil(high / tick) * tick, min + tick);
  const y = (value: number) => margin.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const ticks: number[] = [];
  for (let value = min; value <= max + tick / 2; value += tick) ticks.push(Number(value.toFixed(6)));
  return { y, ticks };
});
const path = computed(() => (scale.value ? linePath(props.points.map((point) => point.value), x, scale.value.y) : ''));
const bandRects = computed(() => props.bands.flatMap((band) => {
  const from = index.value.get(band.start);
  const to = index.value.get(band.end);
  if (from === undefined || to === undefined) return [];
  return [{ ...band, x: margin.left + from * step.value, width: Math.max((to - from + 1) * step.value, 2) }];
}));
const tones = computed(() => [...new Map(props.bands.map((band) => [band.tone, band.label.replace(/ \(plateau\)$/, '')])).entries()]);
const markers = computed(() => props.notes.flatMap((note) => {
  const position = index.value.get(note.startDate);
  return position === undefined ? [] : [{ id: note.id, x: x(position), title: `${formatCalendarDate(note.startDate)}: ${note.text}` }];
}));
const labels = computed(() => dateLabels(props.points.map((point) => point.date), x));

const hover = ref<number | null>(null);
let touching = false;
function onDown(event: PointerEvent) {
  if (event.pointerType === 'mouse') return;
  touching = true;
  try { (event.currentTarget as Element).setPointerCapture(event.pointerId); } catch { /* synthetic or already-released pointer */ }
  onMove(event);
}
// Touch keeps the last scrubbed date visible after lifting the finger; a mouse clears it on leave.
function onLeave(event: PointerEvent) { if (event.pointerType === 'mouse') hover.value = null; touching = false; }
function onMove(event: PointerEvent) {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect();
  const position = Math.floor((event.clientX - box.left - margin.left) / step.value);
  hover.value = position >= 0 && position < count.value ? position : null;
}
const hovered = computed(() => (hover.value === null ? null : props.points[hover.value]));
const format = (value: number | null) => (value === null ? 'not recorded' : `${value.toLocaleString('en-US', { minimumFractionDigits: props.digits, maximumFractionDigits: props.digits })} ${props.unit}`);

function onKey(event: KeyboardEvent) {
  if (!props.bands.length) return;
  const current = props.bands.findIndex((band) => band.key === props.selected);
  const next = event.key === 'ArrowLeft' ? current - 1 : event.key === 'ArrowRight' ? current + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? props.bands.length - 1 : null;
  if (next === null) return;
  event.preventDefault();
  emit('select', props.bands[Math.min(Math.max(next, 0), props.bands.length - 1)].key);
}
</script>

<template>
  <figure ref="root" class="chart-figure timeline-chart">
    <figcaption><h3>{{ title }}</h3>
      <ul class="chart-legend" aria-label="Legend">
        <li><i class="key key-line trend"></i>{{ valueLabel }}</li>
        <li v-for="[tone, label] in tones" :key="tone"><i :class="['key', 'key-bar', `band-${tone}`]"></i>{{ label }}</li>
        <li v-if="markers.length"><i class="key key-line note-key"></i>Your note</li>
      </ul></figcaption>
    <p v-if="!scale" class="field-help">No values to chart yet.</p>
    <svg v-else :width="width" :height="height" role="group" tabindex="0" :aria-label="`${title}. ${bands.length ? 'Use the left and right arrow keys to choose a phase; its details appear below.' : ''}`"
      @keydown="onKey" @pointerdown="onDown" @pointermove="onMove" @pointerleave="onLeave" @pointerup="touching = false">
      <g class="grid">
        <g v-for="tick in scale.ticks" :key="tick"><line :x1="margin.left" :x2="width - margin.right" :y1="scale.y(tick)" :y2="scale.y(tick)" />
          <text :x="margin.left - 6" :y="scale.y(tick) + 3" text-anchor="end">{{ compact(tick) }}</text></g>
      </g>
      <rect v-for="band in bandRects" :key="band.key" :class="['phase-band', `band-${band.tone}`, { 'is-selected': band.key === selected }]" :x="band.x" :y="margin.top" :width="band.width" :height="plotHeight"
        @click="emit('select', band.key)"><title>{{ band.label }}: {{ formatCalendarDate(band.start) }} – {{ formatCalendarDate(band.end) }}</title></rect>
      <rect v-for="band in bandRects" :key="`${band.key}-strip`" :class="['phase-strip', `band-${band.tone}`]" :x="band.x" :y="margin.top + plotHeight - 4" :width="band.width" height="4" />
      <path class="trend-line" :d="path" />
      <g v-for="marker in markers" :key="marker.id" class="note-marker"><line :x1="marker.x" :x2="marker.x" :y1="margin.top" :y2="margin.top + plotHeight" /><title>{{ marker.title }}</title></g>
      <line v-if="hover !== null" class="hover-line" :x1="x(hover)" :x2="x(hover)" :y1="margin.top" :y2="margin.top + plotHeight" />
      <g class="x-labels"><text v-for="label in labels" :key="label.index" :x="label.x" :y="height - 8" :text-anchor="label.anchor">{{ label.label }}</text></g>
    </svg>
    <p v-if="hovered" class="chart-tooltip" aria-hidden="true">{{ formatCalendarDate(hovered.date) }} · {{ format(hovered.value) }}</p>
  </figure>
</template>
