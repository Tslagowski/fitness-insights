<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ExerciseSummary, WeekSets } from '../analysis/exercise';
import { formatCalendarDate } from '../import/preview';
import { barPath, bandLayout, chartHeight as height, chartMargin as margin, compact, dateLabels, nextIndex, niceStep, plotHeight } from './chart-utils';
import { useChartWidth } from './use-chart-width';
import { useScrub } from './use-scrub';

const props = defineProps<{ exercise: ExerciseSummary | null; weeks: WeekSets[] }>();
const { root, width } = useChartWidth();

// Best score per scored session (latest 12): the compared groups carry color, older sessions are context in gray.
const scored = computed(() => (props.exercise?.sessions.filter((session) => session.best) ?? []).slice(-12));
const recentDates = computed(() => new Set(props.exercise?.comparison.recent.map((session) => `${session.date}|${session.workout}|${session.durationRaw}`) ?? []));
const previousDates = computed(() => new Set(props.exercise?.comparison.previous.map((session) => `${session.date}|${session.workout}|${session.durationRaw}`) ?? []));
const scoreLayout = computed(() => bandLayout(width.value, scored.value.length));
const scoreScale = computed(() => {
  const values = scored.value.map((session) => session.best!.score);
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = niceStep(Math.max(high - low, 10));
  const min = Math.max(0, Math.floor(low / step) * step - step);
  const max = Math.ceil(high / step) * step + (high === low ? step : 0);
  const y = (value: number) => margin.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Number(tick.toFixed(6)));
  return { y, ticks };
});
const points = computed(() => scored.value.map((session, index) => {
  const key = `${session.date}|${session.workout}|${session.durationRaw}`;
  return { session, x: scoreLayout.value.x(index), y: scoreScale.value!.y(session.best!.score), group: recentDates.value.has(key) ? 'recent' : previousDates.value.has(key) ? 'previous' : 'older' };
}));
const medianLines = computed(() => {
  const comparison = props.exercise?.comparison;
  if (!comparison || comparison.recentMedian === null || comparison.previousMedian === null || !scoreScale.value) return [];
  return (['previous', 'recent'] as const).map((group) => {
    const members = points.value.filter((point) => point.group === group);
    const value = group === 'recent' ? comparison.recentMedian! : comparison.previousMedian!;
    return { group, x1: members[0].x - scoreLayout.value.band / 2 + 2, x2: members.at(-1)!.x + scoreLayout.value.band / 2 - 2, y: scoreScale.value!.y(value) };
  });
});
const scoreLabels = computed(() => dateLabels(scored.value.map((session) => session.date), scoreLayout.value.x));
const picked = ref<number | null>(null);
const pickedPoint = computed(() => (picked.value === null ? points.value.at(-1) : points.value[picked.value]) ?? null);

// Weekly working sets (all exercises), latest 12 calendar weeks.
const shownWeeks = computed(() => props.weeks.slice(-12));
const weekLayout = computed(() => bandLayout(width.value, shownWeeks.value.length));
const weekScale = computed(() => {
  const largest = Math.max(...shownWeeks.value.map((week) => week.workingSets), 10);
  const step = niceStep(largest);
  const max = Math.ceil(largest / step) * step;
  return { y: (value: number) => margin.top + plotHeight - (value / max) * plotHeight, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) };
});
const weekBars = computed(() => shownWeeks.value.map((week, index) => ({ week, path: barPath(weekLayout.value.x(index), weekLayout.value.barWidth, weekScale.value.y(0), weekScale.value.y(week.workingSets)) })));
const weekLabels = computed(() => dateLabels(shownWeeks.value.map((week) => week.weekStart), weekLayout.value.x));

function onKey(event: KeyboardEvent) {
  if (!points.value.length) return;
  const next = nextIndex(event.key, picked.value ?? points.value.length - 1, points.value.length);
  if (next === null) return;
  event.preventDefault();
  picked.value = next;
}
const score = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
// Ticket 36: drag across the chart to move the selection.
const scrub = useScrub((x) => { const index = Math.floor((x - scoreLayout.value.left(0)) / scoreLayout.value.band); return index >= 0 && index < points.value.length ? index : null; }, (index) => { picked.value = index; });
</script>

<template>
  <div ref="root" class="intake-charts">
    <figure v-if="exercise && scored.length" class="chart-figure">
      <figcaption><h3>Best estimated-strength score per session</h3>
        <ul class="chart-legend" aria-label="Legend">
          <li><i class="key key-dot recent"></i>Latest 3 sessions</li>
          <li><i class="key key-dot previous"></i>3 sessions before</li>
          <li><i class="key key-dot older"></i>Earlier sessions</li>
          <li><i class="key key-line median"></i>Group median</li>
        </ul></figcaption>
      <svg v-if="scoreScale" :width="width" :height="height" role="group" tabindex="0" aria-label="Score chart. Use the left and right arrow keys to choose a session; its best set appears below." aria-describedby="picked-session" @keydown="onKey" @pointerdown="scrub.onPointerdown" @pointermove="scrub.onPointermove" @pointerup="scrub.onPointerup" @pointercancel="scrub.onPointercancel">
        <g class="grid">
          <g v-for="tick in scoreScale.ticks" :key="tick"><line :x1="margin.left" :x2="width - margin.right" :y1="scoreScale.y(tick)" :y2="scoreScale.y(tick)" />
            <text :x="margin.left - 6" :y="scoreScale.y(tick) + 3" text-anchor="end">{{ compact(tick) }}</text></g>
        </g>
        <line v-for="line in medianLines" :key="line.group" :class="['median-line', line.group]" :x1="line.x1" :x2="line.x2" :y1="line.y" :y2="line.y" />
        <circle v-for="(point, index) in points" :key="index" :class="['score-dot', point.group, { picked: pickedPoint === point }]" :cx="point.x" :cy="point.y" r="5" />
        <g class="x-labels"><text v-for="label in scoreLabels" :key="label.index" :x="label.x" :y="height - 8" :text-anchor="label.anchor">{{ label.label }}</text></g>
        <rect v-for="(point, index) in points" :key="`hit${index}`" class="hit" :x="scoreLayout.left(index)" :y="0" :width="scoreLayout.band" :height="margin.top + plotHeight"
          @pointerenter="picked = index" @click="picked = index"><title>{{ formatCalendarDate(point.session.date) }}</title></rect>
      </svg>
      <p v-if="pickedPoint" id="picked-session" class="field-help picked-session" aria-live="polite">
        {{ formatCalendarDate(pickedPoint.session.date, { weekday: true }) }}{{ pickedPoint.session.workout ? ` · ${pickedPoint.session.workout}` : '' }}:
        best set {{ pickedPoint.session.best!.load }} lb × {{ pickedPoint.session.best!.reps }} ({{ pickedPoint.session.best!.setType }}) →
        {{ pickedPoint.session.best!.load }} × (1 + {{ pickedPoint.session.best!.reps }} ÷ 30) = {{ score(pickedPoint.session.best!.score) }}
      </p>
    </figure>

    <figure v-if="shownWeeks.length" class="chart-figure">
      <figcaption><h3>Working sets per week (all exercises)</h3>
        <ul class="chart-legend" aria-label="Legend">
          <li><i class="key key-bar weekly"></i>Completed week</li>
          <li><i class="key key-bar left-out"></i>Week not yet complete</li>
        </ul></figcaption>
      <svg :width="width" :height="height" role="img" :aria-label="`Working sets per week for the latest ${shownWeeks.length} weeks; values are listed in the table below.`">
        <g class="grid">
          <g v-for="tick in weekScale.ticks" :key="tick"><line :x1="margin.left" :x2="width - margin.right" :y1="weekScale.y(tick)" :y2="weekScale.y(tick)" />
            <text :x="margin.left - 6" :y="weekScale.y(tick) + 3" text-anchor="end">{{ compact(tick) }}</text></g>
        </g>
        <path v-for="item in weekBars" :key="item.week.weekStart" :d="item.path" :class="['weekly-bar', { 'left-out': item.week.partial }]" />
        <g class="x-labels"><text v-for="label in weekLabels" :key="label.index" :x="label.x" :y="height - 8" :text-anchor="label.anchor">{{ label.label }}</text></g>
      </svg>
    </figure>
  </div>
</template>
