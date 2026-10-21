<script setup lang="ts">
import { computed } from 'vue';
import type { IntakeDay } from '../analysis/intake';
import { formatCalendarDate } from '../import/preview';
import { barPath, bandLayout, chartHeight as height, chartMargin as margin, compact, dateLabels, linePath, nextIndex, niceStep, plotHeight } from './chart-utils';
import { useChartWidth } from './use-chart-width';

// Charts read the same rows as the headline metrics, so a bar and a number can never disagree.
const props = defineProps<{ days: IntakeDay[]; selected: string | null }>();
const emit = defineEmits<{ select: [date: string] }>();

const { root, width } = useChartWidth();
const layout = computed(() => bandLayout(width.value, props.days.length));
const showDots = computed(() => layout.value.band >= 10);
const xLabels = computed(() => dateLabels(props.days.map((day) => day.date), layout.value.x));
const selectedIndex = computed(() => props.days.findIndex((day) => day.date === props.selected));

// Chart 1: intake columns, MacroFactor's expenditure estimate as a line, and the target as a step line.
const intakeScale = computed(() => {
  const values = props.days.flatMap((day) => [day.intake, day.expenditure, day.target]).filter((value): value is number => value !== null);
  const largest = Math.max(...values, 1000);
  const step = niceStep(largest);
  const max = Math.ceil(largest / step) * step;
  const y = (value: number) => margin.top + plotHeight - (Math.max(value, 0) / max) * plotHeight;
  return { y, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) };
});
const intakeBars = computed(() => props.days.map((day, index) => day.intake === null ? null : ({
  date: day.date, included: day.intakeIncluded, path: barPath(layout.value.x(index), layout.value.barWidth, intakeScale.value.y(0), intakeScale.value.y(day.intake)),
})).filter((item): item is NonNullable<typeof item> => !!item && !!item.path));
const expenditureValues = computed(() => props.days.map((day) => (day.expenditureStatus.eligible ? day.expenditure : null)));
const expenditurePath = computed(() => linePath(expenditureValues.value, layout.value.x, intakeScale.value.y));
const targetPath = computed(() => {
  let path = '';
  props.days.forEach((day, index) => {
    if (day.target === null) return;
    const y = intakeScale.value.y(day.target);
    const left = layout.value.left(index);
    path += `${index > 0 && props.days[index - 1].target !== null ? 'L' : 'M'}${left},${y}H${left + layout.value.band}`;
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
  return { y, ticks: [-max, 0, max] };
});
const balanceBars = computed(() => props.days.map((day, index) => day.balance === null || day.balance === 0 ? null : ({
  date: day.date, surplus: day.balance > 0, path: barPath(layout.value.x(index), layout.value.barWidth, balanceScale.value.y(0), balanceScale.value.y(day.balance)),
})).filter((item): item is NonNullable<typeof item> => !!item && !!item.path));
const matchedCount = computed(() => props.days.filter((day) => day.matched).length);

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
        <rect v-if="selectedIndex >= 0" class="crosshair" :x="layout.left(selectedIndex)" :y="margin.top" :width="layout.band" :height="plotHeight" />
        <path v-for="item in intakeBars" :key="item.date" :d="item.path" :class="['intake-bar', { 'left-out': !item.included }]" />
        <path class="target-line" :d="targetPath" />
        <path class="expenditure-line" :d="expenditurePath" />
        <template v-if="showDots"><circle v-for="(value, index) in expenditureValues" v-show="value !== null" :key="index" class="expenditure-dot" :cx="layout.x(index)" :cy="value === null ? 0 : intakeScale.y(value)" r="4" /></template>
        <g class="x-labels"><text v-for="label in xLabels" :key="label.index" :x="label.x" :y="height - 8" :text-anchor="label.anchor">{{ label.label }}</text></g>
        <rect v-for="(day, index) in days" :key="day.date" class="hit" :x="layout.left(index)" :y="0" :width="layout.band" :height="margin.top + plotHeight"
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
        <rect v-if="selectedIndex >= 0" class="crosshair" :x="layout.left(selectedIndex)" :y="margin.top" :width="layout.band" :height="plotHeight" />
        <path v-for="item in balanceBars" :key="item.date" :d="item.path" :class="item.surplus ? 'surplus-bar' : 'deficit-bar'" />
        <g class="x-labels"><text v-for="label in xLabels" :key="label.index" :x="label.x" :y="height - 8" :text-anchor="label.anchor">{{ label.label }}</text></g>
        <rect v-for="(day, index) in days" :key="day.date" class="hit" :x="layout.left(index)" :y="0" :width="layout.band" :height="margin.top + plotHeight"
          @pointerenter="emit('select', day.date)" @click="emit('select', day.date)"><title>{{ formatCalendarDate(day.date) }}</title></rect>
      </svg>
    </figure>
  </div>
</template>
