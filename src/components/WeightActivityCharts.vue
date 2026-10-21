<script setup lang="ts">
import { computed } from 'vue';
import type { TrendDay } from '../analysis/trends';
import { formatCalendarDate } from '../import/preview';
import { barPath, bandLayout, chartHeight as height, chartMargin as margin, compact, dateLabels, linePath, nextIndex, niceStep, plotHeight } from './chart-utils';
import { useChartWidth } from './use-chart-width';

const props = defineProps<{ days: TrendDay[]; selected: string | null }>();
const emit = defineEmits<{ select: [date: string] }>();

const { root, width } = useChartWidth();
const layout = computed(() => bandLayout(width.value, props.days.length));
const xLabels = computed(() => dateLabels(props.days.map((day) => day.date), layout.value.x));
const selectedIndex = computed(() => props.days.findIndex((day) => day.date === props.selected));

// Weight: raw scale points and MacroFactor's trend line on one pound axis, never merged or filled in.
const weightScale = computed(() => {
  const values = props.days.flatMap((day) => [day.scale, day.trend]).filter((value): value is number => value !== null);
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = niceStep(Math.max(high - low, 2));
  const min = Math.floor(low / step) * step - (high === low ? step : 0);
  const max = Math.ceil(high / step) * step + (high === low ? step : 0);
  const y = (value: number) => margin.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Number(tick.toFixed(6)));
  return { y, ticks };
});
const trendPath = computed(() => weightScale.value ? linePath(props.days.map((day) => (day.trendStatus.eligible ? day.trend : null)), layout.value.x, weightScale.value.y) : '');
const scalePoints = computed(() => weightScale.value ? props.days.flatMap((day, index) => day.scale === null ? []
  : [{ date: day.date, x: layout.value.x(index), y: weightScale.value!.y(day.scale), included: day.scaleStatus.eligible }]) : []);

// Steps: one column per observed day.
const stepsScale = computed(() => {
  const values = props.days.flatMap((day) => (day.steps === null ? [] : [day.steps]));
  const largest = Math.max(...values, 1000);
  const step = niceStep(largest);
  const max = Math.ceil(largest / step) * step;
  const y = (value: number) => margin.top + plotHeight - (Math.max(value, 0) / max) * plotHeight;
  return { y, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step), any: values.length > 0 };
});
const stepBars = computed(() => props.days.map((day, index) => day.steps === null ? null : ({
  date: day.date, included: day.stepsStatus.eligible, path: barPath(layout.value.x(index), layout.value.barWidth, stepsScale.value.y(0), stepsScale.value.y(day.steps)),
})).filter((item): item is NonNullable<typeof item> => !!item && !!item.path));

function onKey(event: KeyboardEvent) {
  if (!props.days.length) return;
  const next = nextIndex(event.key, selectedIndex.value < 0 ? props.days.length - 1 : selectedIndex.value, props.days.length);
  if (next === null) return;
  event.preventDefault();
  emit('select', props.days[next].date);
}
</script>

<template>
  <div ref="root" class="intake-charts">
    <figure class="chart-figure">
      <figcaption><h3>Scale weight and trend weight (lb)</h3>
        <ul class="chart-legend" aria-label="Legend">
          <li><i class="key key-dot scale"></i>Scale weigh-in (counted)</li>
          <li><i class="key key-dot left-out-ring"></i>Weigh-in left out</li>
          <li><i class="key key-line trend"></i>Trend weight (MacroFactor estimate)</li>
        </ul></figcaption>
      <p v-if="!weightScale" class="field-help">No weigh-ins or trend values in this period.</p>
      <svg v-else :width="width" :height="height" role="group" tabindex="0" aria-label="Weight chart. Use the left and right arrow keys to choose a day; its values appear below." aria-describedby="selected-trend-day" @keydown="onKey">
        <g class="grid">
          <g v-for="tick in weightScale.ticks" :key="tick"><line :x1="margin.left" :x2="width - margin.right" :y1="weightScale.y(tick)" :y2="weightScale.y(tick)" />
            <text :x="margin.left - 6" :y="weightScale.y(tick) + 3" text-anchor="end">{{ compact(tick) }}</text></g>
        </g>
        <rect v-if="selectedIndex >= 0" class="crosshair" :x="layout.left(selectedIndex)" :y="margin.top" :width="layout.band" :height="plotHeight" />
        <path class="trend-line" :d="trendPath" />
        <circle v-for="point in scalePoints" :key="point.date" :class="point.included ? 'scale-dot' : 'scale-dot left-out'" :cx="point.x" :cy="point.y" r="4" />
        <g class="x-labels"><text v-for="label in xLabels" :key="label.index" :x="label.x" :y="height - 8" :text-anchor="label.anchor">{{ label.label }}</text></g>
        <rect v-for="(day, index) in days" :key="day.date" class="hit" :x="layout.left(index)" :y="0" :width="layout.band" :height="margin.top + plotHeight"
          @pointerenter="emit('select', day.date)" @click="emit('select', day.date)"><title>{{ formatCalendarDate(day.date) }}</title></rect>
      </svg>
    </figure>

    <figure class="chart-figure">
      <figcaption><h3>Daily steps</h3></figcaption>
      <p v-if="!stepsScale.any" class="field-help">No steps recorded in this period.</p>
      <svg v-else :width="width" :height="height" role="group" tabindex="0" aria-label="Steps chart. Use the left and right arrow keys to choose a day; its values appear below." aria-describedby="selected-trend-day" @keydown="onKey">
        <g class="grid">
          <g v-for="tick in stepsScale.ticks" :key="tick"><line :x1="margin.left" :x2="width - margin.right" :y1="stepsScale.y(tick)" :y2="stepsScale.y(tick)" />
            <text :x="margin.left - 6" :y="stepsScale.y(tick) + 3" text-anchor="end">{{ compact(tick) }}</text></g>
        </g>
        <rect v-if="selectedIndex >= 0" class="crosshair" :x="layout.left(selectedIndex)" :y="margin.top" :width="layout.band" :height="plotHeight" />
        <path v-for="item in stepBars" :key="item.date" :d="item.path" :class="['steps-bar', { 'left-out': !item.included }]" />
        <g class="x-labels"><text v-for="label in xLabels" :key="label.index" :x="label.x" :y="height - 8" :text-anchor="label.anchor">{{ label.label }}</text></g>
        <rect v-for="(day, index) in days" :key="day.date" class="hit" :x="layout.left(index)" :y="0" :width="layout.band" :height="margin.top + plotHeight"
          @pointerenter="emit('select', day.date)" @click="emit('select', day.date)"><title>{{ formatCalendarDate(day.date) }}</title></rect>
      </svg>
    </figure>
  </div>
</template>
