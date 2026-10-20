<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { IntakeDay } from '../analysis/intake';
import { formatCalendarDate } from '../import/preview';

// Charts read the same rows as the headline metrics, so a bar and a number can never disagree.
const props = defineProps<{ days: IntakeDay[]; selected: string | null }>();
const emit = defineEmits<{ select: [date: string] }>();

const root = ref<HTMLElement | null>(null);
const width = ref(640);
let observer: ResizeObserver | null = null;
onMounted(() => {
  const measure = () => { const measured = root.value?.clientWidth ?? 0; if (measured > 0) width.value = measured; };
  measure();
  if (typeof ResizeObserver !== 'undefined' && root.value) { observer = new ResizeObserver(measure); observer.observe(root.value); }
});
onBeforeUnmount(() => observer?.disconnect());

const margin = { left: 44, right: 8, top: 12, bottom: 26 };
const plotHeight = 170;
const height = plotHeight + margin.top + margin.bottom;
const plotWidth = computed(() => Math.max(width.value - margin.left - margin.right, 80));
const band = computed(() => plotWidth.value / Math.max(props.days.length, 1));
const barWidth = computed(() => Math.max(Math.min(24, band.value - 2), 1));
const x = (index: number) => margin.left + index * band.value + band.value / 2;
const showDots = computed(() => band.value >= 10);

function niceStep(max: number): number {
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 2.5, 5, 10].map((step) => step * magnitude).find((step) => step >= raw) ?? raw;
}
function compact(value: number): string {
  const sign = value < 0 ? '−' : '';
  const magnitude = Math.abs(value);
  return magnitude >= 1000 ? `${sign}${(magnitude / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K` : `${sign}${magnitude}`;
}
/** A bar with a 4px rounded data end and a square baseline end. */
function bar(center: number, from: number, to: number): string {
  const half = barWidth.value / 2;
  const left = center - half;
  const right = center + half;
  const length = Math.abs(to - from);
  const radius = Math.min(4, half, length);
  if (length < 0.5) return '';
  if (to < from) return `M${left},${from}V${to + radius}Q${left},${to} ${left + radius},${to}H${right - radius}Q${right},${to} ${right},${to + radius}V${from}Z`;
  return `M${left},${from}V${to - radius}Q${left},${to} ${left + radius},${to}H${right - radius}Q${right},${to} ${right},${to - radius}V${from}Z`;
}
/** Line segments only between consecutive days that both have a value: gaps are never bridged. */
function segments(values: Array<number | null>, y: (value: number) => number): string {
  let path = '';
  values.forEach((value, index) => {
    if (value === null) return;
    path += `${index > 0 && values[index - 1] !== null ? 'L' : 'M'}${x(index)},${y(value)}`;
  });
  return path;
}

const xLabels = computed(() => {
  const count = props.days.length;
  if (!count) return [];
  const picks = count <= 2 ? [...Array(count).keys()] : [0, Math.floor((count - 1) / 2), count - 1];
  return picks.map((index) => ({ index, x: x(index), label: formatCalendarDate(props.days[index].date).replace(/, \d{4}$/, ''),
    anchor: index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle' }));
});
const selectedIndex = computed(() => props.days.findIndex((day) => day.date === props.selected));

// Chart 1: intake columns, MacroFactor's expenditure estimate as a line, and the target as a step line.
const intakeScale = computed(() => {
  const values = props.days.flatMap((day) => [day.intake, day.expenditure, day.target]).filter((value): value is number => value !== null);
  const step = niceStep(Math.max(...values, 1000));
  const max = Math.ceil(Math.max(...values, 1000) / step) * step;
  const y = (value: number) => margin.top + plotHeight - (Math.max(value, 0) / max) * plotHeight;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step);
  return { y, ticks };
});
const intakeBars = computed(() => props.days.map((day, index) => day.intake === null ? null : ({
  date: day.date, included: day.intakeIncluded, path: bar(x(index), intakeScale.value.y(0), intakeScale.value.y(day.intake)),
})).filter((item): item is NonNullable<typeof item> => !!item && !!item.path));
const expenditureValues = computed(() => props.days.map((day) => (day.expenditureStatus.eligible ? day.expenditure : null)));
const expenditurePath = computed(() => segments(expenditureValues.value, intakeScale.value.y));
const targetPath = computed(() => {
  let path = '';
  props.days.forEach((day, index) => {
    if (day.target === null) return;
    const y = intakeScale.value.y(day.target);
    const left = margin.left + index * band.value;
    path += `${index > 0 && props.days[index - 1].target !== null ? 'L' : 'M'}${left},${y}H${left + band.value}`;
  });
  return path;
});

// Chart 2: modeled balance per matched day, diverging around zero.
const balanceScale = computed(() => {
  const magnitudes = props.days.flatMap((day) => (day.balance === null ? [] : [Math.abs(day.balance)]));
  const largest = Math.max(...magnitudes, 250);
  const step = niceStep(largest);
  const max = Math.ceil(largest / step) * step;
  const y = (value: number) => margin.top + plotHeight / 2 - (value / max) * (plotHeight / 2);
  const ticks = [-max, 0, max];
  return { y, ticks };
});
const balanceBars = computed(() => props.days.map((day, index) => day.balance === null || day.balance === 0 ? null : ({
  date: day.date, surplus: day.balance > 0, path: bar(x(index), balanceScale.value.y(0), balanceScale.value.y(day.balance)),
})).filter((item): item is NonNullable<typeof item> => !!item && !!item.path));
const matchedCount = computed(() => props.days.filter((day) => day.matched).length);

function onKey(event: KeyboardEvent) {
  if (!props.days.length) return;
  const current = selectedIndex.value < 0 ? props.days.length - 1 : selectedIndex.value;
  const next = event.key === 'ArrowLeft' ? current - 1 : event.key === 'ArrowRight' ? current + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? props.days.length - 1 : null;
  if (next === null) return;
  event.preventDefault();
  emit('select', props.days[Math.min(Math.max(next, 0), props.days.length - 1)].date);
}
</script>

<template>
  <div ref="root" class="intake-charts">
    <figure class="chart-figure">
      <figcaption><h3>Daily intake, expenditure estimate, and target</h3>
        <ul class="chart-legend" aria-label="Legend">
          <li><i class="key key-bar intake"></i>Intake (counted)</li>
          <li><i class="key key-bar left-out"></i>Intake left out</li>
          <li><i class="key key-line expenditure"></i>Expenditure (MacroFactor estimate)</li>
          <li><i class="key key-line target"></i>Target</li>
        </ul></figcaption>
      <svg :width="width" :height="height" role="group" tabindex="0" aria-label="Daily intake chart. Use the left and right arrow keys to choose a day; its values appear below." aria-describedby="selected-day" @keydown="onKey">
        <g class="grid">
          <g v-for="tick in intakeScale.ticks" :key="tick"><line :x1="margin.left" :x2="width - margin.right" :y1="intakeScale.y(tick)" :y2="intakeScale.y(tick)" />
            <text :x="margin.left - 6" :y="intakeScale.y(tick) + 3" text-anchor="end">{{ compact(tick) }}</text></g>
        </g>
        <rect v-if="selectedIndex >= 0" class="crosshair" :x="margin.left + selectedIndex * band" :y="margin.top" :width="band" :height="plotHeight" />
        <path v-for="item in intakeBars" :key="item.date" :d="item.path" :class="['intake-bar', { 'left-out': !item.included }]" />
        <path class="target-line" :d="targetPath" />
        <path class="expenditure-line" :d="expenditurePath" />
        <template v-if="showDots"><circle v-for="(value, index) in expenditureValues" v-show="value !== null" :key="index" class="expenditure-dot" :cx="x(index)" :cy="value === null ? 0 : intakeScale.y(value)" r="4" /></template>
        <g class="x-labels"><text v-for="label in xLabels" :key="label.index" :x="label.x" :y="height - 8" :text-anchor="label.anchor">{{ label.label }}</text></g>
        <rect v-for="(day, index) in days" :key="day.date" class="hit" :x="margin.left + index * band" :y="0" :width="band" :height="margin.top + plotHeight"
          @pointerenter="emit('select', day.date)" @click="emit('select', day.date)"><title>{{ formatCalendarDate(day.date) }}</title></rect>
      </svg>
    </figure>

    <figure class="chart-figure">
      <figcaption><h3>Daily modeled balance (intake − expenditure estimate)</h3>
        <ul class="chart-legend" aria-label="Legend">
          <li><i class="key key-bar surplus"></i>Modeled surplus (above zero)</li>
          <li><i class="key key-bar deficit"></i>Modeled deficit (below zero)</li>
        </ul></figcaption>
      <p v-if="!matchedCount" class="field-help">No days in this period have both counted intake and an expenditure estimate, so there is no modeled balance to chart.</p>
      <svg v-else :width="width" :height="height" role="group" tabindex="0" aria-label="Daily modeled balance chart. Use the left and right arrow keys to choose a day; its values appear below." aria-describedby="selected-day" @keydown="onKey">
        <g class="grid">
          <g v-for="tick in balanceScale.ticks" :key="tick"><line :class="{ zero: tick === 0 }" :x1="margin.left" :x2="width - margin.right" :y1="balanceScale.y(tick)" :y2="balanceScale.y(tick)" />
            <text :x="margin.left - 6" :y="balanceScale.y(tick) + 3" text-anchor="end">{{ tick > 0 ? '+' : '' }}{{ compact(tick) }}</text></g>
        </g>
        <rect v-if="selectedIndex >= 0" class="crosshair" :x="margin.left + selectedIndex * band" :y="margin.top" :width="band" :height="plotHeight" />
        <path v-for="item in balanceBars" :key="item.date" :d="item.path" :class="item.surplus ? 'surplus-bar' : 'deficit-bar'" />
        <g class="x-labels"><text v-for="label in xLabels" :key="label.index" :x="label.x" :y="height - 8" :text-anchor="label.anchor">{{ label.label }}</text></g>
        <rect v-for="(day, index) in days" :key="day.date" class="hit" :x="margin.left + index * band" :y="0" :width="band" :height="margin.top + plotHeight"
          @pointerenter="emit('select', day.date)" @click="emit('select', day.date)"><title>{{ formatCalendarDate(day.date) }}</title></rect>
      </svg>
    </figure>
  </div>
</template>
