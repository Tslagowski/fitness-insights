<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DailyValues } from '../analysis/daily';
import type { ExerciseAnalysis } from '../analysis/exercise';
import { analyzePrecursors, minimumExercises, minimumGroup, precursorMethodVersion, type PriorMeasure, type ScoredDay } from '../analysis/precursors';
import { formatCalendarDate, formatShortDate, monthDay, plural } from '../import/preview';
import CategoryChart from './CategoryChart.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ days: DailyValues[]; exercises: ExerciseAnalysis | null }>();
const analysis = computed(() => (props.exercises ? analyzePrecursors(props.exercises, props.days) : null));
const names: Record<PriorMeasure, string> = { intake: 'Intake', carbs: 'Carbohydrate', balance: 'Modeled balance', steps: 'Steps' };
const units: Record<PriorMeasure, string> = { intake: ' kcal', carbs: ' g', balance: ' kcal', steps: '' };
const value = (measure: PriorMeasure, number: number | null) => (number === null ? '—' : `${Math.round(number) < 0 ? '−' : ''}${Math.abs(Math.round(number)).toLocaleString('en-US')}${units[measure]}`);
const signed = (measure: PriorMeasure, number: number | null) => (number === null ? '—'
  : `${number > 0 ? '+' : number < 0 ? '−' : '±'}${Math.abs(Math.round(number)).toLocaleString('en-US')}${units[measure]}`);
const percent = (number: number) => `${number > 0 ? '+' : number < 0 ? '−' : '±'}${Math.abs(number).toFixed(1)}%`;
const findings = computed(() => (analysis.value?.measures ?? []).filter((item) => item.sufficient).map((item) =>
  `${names[item.measure]} the day before top-third sessions averaged ${value(item.measure, item.top.mean)} vs ${value(item.measure, item.bottom.mean)} before bottom-third sessions (${signed(item.measure, item.difference)}; ${item.top.count} vs ${item.bottom.count} days).`));
const groupLabel: Record<ScoredDay['group'], string> = { top: 'Top third', middle: 'Middle', bottom: 'Bottom third' };
const labels = computed(() => analysis.value?.days.map((day) => monthDay(day.date)) ?? []);
const series = computed(() => [{ key: 'score', name: 'Session score', tone: 'teal', values: analysis.value?.days.map((day) => Math.round(day.scorePercent * 10) / 10) ?? [] }]);
const chosen = ref<number | null>(null);
const chosenText = computed(() => {
  const day = chosen.value === null ? null : analysis.value?.days[chosen.value];
  return day ? `${formatCalendarDate(day.date, { weekday: true })}: ${percent(day.scorePercent)} (${groupLabel[day.group]}) from ${day.exercises.map((item) => `${item.name} ${percent((item.relative - 1) * 100)}`).join(', ')}` : '';
});
const narrow = useNarrow();
const measureRows = computed<DataRow[]>(() => (analysis.value?.measures ?? []).map((item) => ({
  key: item.measure, heading: names[item.measure], primary: item.sufficient ? signed(item.measure, item.difference) : 'Insufficient data',
  secondary: `Top ${value(item.measure, item.top.mean)} (${item.top.count}d) · bottom ${value(item.measure, item.bottom.mean)} (${item.bottom.count}d)`,
  details: [{ label: 'Top third median', value: value(item.measure, item.top.median) }, { label: 'Bottom third median', value: value(item.measure, item.bottom.median) }],
})));
const evidence = computed(() => [...(analysis.value?.days ?? [])].filter((day) => day.group !== 'middle').sort((left, right) => right.scorePercent - left.scorePercent));
const rows = computed<DataRow[]>(() => evidence.value.map((day) => ({
  key: day.date, heading: `${formatShortDate(day.date).split(' ')[0]} ${monthDay(day.date)}`, tag: groupLabel[day.group], primary: percent(day.scorePercent),
  secondary: `Day before: ${value('intake', day.prior.intake)} · ${value('steps', day.prior.steps)} steps`,
  details: [...day.exercises.map((item) => ({ label: item.name, value: `${item.best.toFixed(1)} vs median ${item.baseline.toFixed(1)} (${percent((item.relative - 1) * 100)})` })),
    ...(['carbs', 'balance'] as PriorMeasure[]).map((measure) => ({ label: `${names[measure]} the day before`, value: value(measure, day.prior[measure]) }))],
})));
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="precursors-heading">
    <div class="section-heading"><div><div class="eyebrow">ASSOCIATIONS IN YOUR HISTORY, NOT CAUSES</div><h2 id="precursors-heading">Before your best and worst sessions</h2></div>
      <span class="outline-pill">Method {{ precursorMethodVersion }}</span></div>
    <p v-if="!exercises" class="field-help">Workout sets are not loaded, so sessions cannot be compared yet.</p>
    <template v-else-if="analysis">
      <div class="metric-grid" aria-label="Session counts">
        <article class="metric-tile"><h4>Scored sessions</h4><p class="metric-value">{{ analysis.days.length }}</p><p class="metric-detail">{{ analysis.excluded.tooFewExercises }} training days excluded (fewer than {{ minimumExercises }} comparable exercises)</p></article>
        <article class="metric-tile"><h4>Each group</h4><p class="metric-value">{{ analysis.groupSize }}</p><p class="metric-detail">sessions in the top and in the bottom third</p></article>
      </div>
      <p v-if="!analysis.sufficient" class="field-help">Insufficient data: each third needs at least {{ minimumGroup }} sessions ({{ minimumGroup * 3 }} scored sessions in all); {{ analysis.days.length }} available.</p>
      <template v-else>
        <ul class="plain-list findings" aria-label="Associations">
          <li v-for="text in findings" :key="text">{{ text }}</li>
          <li v-if="!findings.length">No measure has at least {{ minimumGroup }} eligible prior days in both groups.</li>
        </ul>
        <p class="field-help">These are differences between groups of sessions in this history, with their sample sizes. They are not tested for significance and do not show that the day before caused the session.</p>
        <DataRows v-if="narrow" :rows="measureRows" label="Prior-day measures" :group-by-month="false" />
        <div v-else class="table-scroll" role="region" aria-label="Prior-day measures" tabindex="0">
          <table class="period-table">
            <thead><tr><th scope="col">Day before</th><th scope="col">Top third</th><th scope="col">Bottom third</th><th scope="col">Difference</th></tr></thead>
            <tbody><tr v-for="item in analysis.measures" :key="item.measure"><th scope="row">{{ names[item.measure] }}</th>
              <td>{{ value(item.measure, item.top.mean) }} <span class="muted">(median {{ value(item.measure, item.top.median) }}, {{ item.top.count }}d)</span></td>
              <td>{{ value(item.measure, item.bottom.mean) }} <span class="muted">(median {{ value(item.measure, item.bottom.median) }}, {{ item.bottom.count }}d)</span></td>
              <td>{{ item.sufficient ? signed(item.measure, item.difference) : 'Insufficient data' }}</td></tr></tbody>
          </table>
        </div>
      </template>
      <CategoryChart v-if="analysis.days.length" :labels="labels" :series="series" :selected="chosen" title="Session score vs each exercise's previous 3-session median (%)" unit="%" @select="chosen = $event" />
      <p v-if="chosenText" class="field-help" aria-live="polite">{{ chosenText }}</p>
      <details v-if="evidence.length" class="preview-section">
        <summary>Top and bottom sessions ({{ evidence.length }})</summary>
        <DataRows v-if="narrow" :rows="rows" label="Top and bottom sessions" :group-by-month="false" :page-size="20" unit="sessions" />
        <div v-else class="table-scroll" role="region" aria-label="Top and bottom sessions" tabindex="0">
          <table class="period-table">
            <thead><tr><th scope="col">Session</th><th scope="col">Group</th><th scope="col">Score</th><th scope="col">Intake before</th><th scope="col">Carbs before</th><th scope="col">Balance before</th><th scope="col">Steps before</th><th scope="col">Exercises</th></tr></thead>
            <tbody><tr v-for="day in evidence" :key="day.date"><th scope="row">{{ formatCalendarDate(day.date, { weekday: true }) }}</th><td>{{ groupLabel[day.group] }}</td><td>{{ percent(day.scorePercent) }}</td>
              <td>{{ value('intake', day.prior.intake) }}</td><td>{{ value('carbs', day.prior.carbs) }}</td><td>{{ signed('balance', day.prior.balance) }}</td><td>{{ value('steps', day.prior.steps) }}</td>
              <td>{{ day.exercises.map((item) => `${item.name} ${percent((item.relative - 1) * 100)}`).join(', ') }}</td></tr></tbody>
          </table>
        </div>
      </details>
    </template>
    <details class="preview-section">
      <summary>How this is calculated</summary>
      <ul class="plain-list formulas">
        <li><strong>Exercise comparison</strong><span>Each session's best estimated-strength score ÷ the median best score of that exercise's three previous scored sessions (positive load, 1-10 reps, Standard or Failure sets).</span></li>
        <li><strong>Session score</strong><span>The mean of those ratios across the day's exercises, as a % change. A day needs {{ minimumExercises }} comparable exercises.</span></li>
        <li><strong>Groups</strong><span>Sessions are ranked by score; the top and bottom thirds each hold ⌊n ÷ 3⌋ sessions, and the middle is left out. Each group needs {{ minimumGroup }} sessions.</span></li>
        <li><strong>Day before</strong><span>The previous calendar day's eligible intake, carbohydrate, modeled balance (intake − MacroFactor expenditure), and steps. A measure needs {{ minimumGroup }} eligible days in both groups.</span></li>
      </ul>
    </details>
  </section>
</template>
