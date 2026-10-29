<script setup lang="ts">
import MethodInfo from './MethodInfo.vue';
import { computed, ref, watch } from 'vue';
import type { DailyValues } from '../analysis/daily';
import type { ExerciseAnalysis } from '../analysis/exercise';
import { addDays } from '../analysis/eligibility';
import { analyzePhases } from '../analysis/phases';
import { analyzeStrength, strengthMethodVersion, type StrengthLabel, type StrengthLift } from '../analysis/strength';
import { formatCalendarDate, formatShortDate, monthDay, plural } from '../import/preview';
import CategoryChart from './CategoryChart.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ days: DailyValues[]; exercises: ExerciseAnalysis | null }>();

// Windows: all history, the latest 12 weeks, and each ticket 16 weight phase.
const phases = computed(() => analyzePhases(props.days).phases);
const windows = computed(() => {
  const last = props.days.at(-1)?.date ?? null;
  return [
    { key: 'all', label: 'All history', start: null, end: null },
    ...(last ? [{ key: 'recent', label: 'Latest 12 weeks', start: addDays(last, -83), end: last }] : []),
    ...[...phases.value].reverse().map((phase) => ({ key: phase.start, label: `${phase.plateau ? 'Maintaining (plateau)' : phase.label} phase · ${monthDay(phase.start)} – ${monthDay(phase.end)}`, start: phase.start, end: phase.end })),
  ];
});
const windowKey = ref('all');
watch(windows, (list) => { if (!list.some((item) => item.key === windowKey.value)) windowKey.value = 'all'; });
const window = computed(() => windows.value.find((item) => item.key === windowKey.value) ?? windows.value[0]);
const analysis = computed(() => (props.exercises ? analyzeStrength(props.exercises, props.days, { start: window.value.start, end: window.value.end }) : null));
const scope = ref<'top' | 'all'>('top');
const topCount = 6;
const lifts = computed(() => (analysis.value ? (scope.value === 'top' ? analysis.value.lifts.slice(0, topCount) : analysis.value.lifts) : []));
const selectedName = ref<string | null>(null);
watch(lifts, (list) => { if (!list.some((lift) => lift.name === selectedName.value)) selectedName.value = list[0]?.name ?? null; }, { immediate: true });
const selected = computed(() => lifts.value.find((lift) => lift.name === selectedName.value) ?? null);

const icons: Record<StrengthLabel, string> = { Gained: '▲', Kept: '●', Lost: '▼', 'Insufficient data': '○' };
const percent = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(1)}%`);
const score = (value: number | null) => (value === null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 1 }));
const perLb = (value: number | null) => (value === null ? '—' : value.toFixed(3));
const lb = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)} lb`);
const trendChange = (lift: StrengthLift) => {
  const { trendBefore, trendAfter } = lift.change;
  if (trendBefore === null || trendAfter === null) return '—';
  const delta = trendAfter - trendBefore;
  return `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta).toFixed(1)} lb`;
};
const span = (lift: StrengthLift) => `${formatCalendarDate(lift.points[0].date)} – ${formatCalendarDate(lift.points.at(-1)!.date)}`;

function evidence(lift: StrengthLift) {
  const change = lift.change;
  if (change.label === 'Insufficient data') return [{ label: 'Status', value: change.reason }, { label: 'Scored sessions', value: String(lift.points.length) }];
  return [
    { label: 'Score (median)', value: `${score(change.scoreBefore)} → ${score(change.scoreAfter)} (${percent(change.scoreChangePercent)})` },
    { label: 'Score per lb', value: `${perLb(change.relativeBefore)} → ${perLb(change.relativeAfter)} (${percent(change.relativeChangePercent)})` },
    { label: 'Trend weight (median)', value: `${lb(change.trendBefore)} → ${lb(change.trendAfter)} (${trendChange(lift)})` },
    { label: 'First 3 sessions', value: change.first.map((point) => formatShortDate(point.date)).join(', ') },
    { label: 'Last 3 sessions', value: change.last.map((point) => formatShortDate(point.date)).join(', ') },
    { label: 'Scored sessions', value: `${lift.points.length} (${span(lift)})` },
  ];
}
const narrow = useNarrow();
const rows = computed<DataRow[]>(() => lifts.value.map((lift) => ({
  key: lift.name, heading: lift.name, tag: `${icons[lift.change.label]} ${lift.change.label}`,
  primary: lift.change.label === 'Insufficient data' ? `${lift.points.length} of 6 sessions` : `Score ${percent(lift.change.scoreChangePercent)} · per lb ${percent(lift.change.relativeChangePercent)}`,
  secondary: lift.change.label === 'Insufficient data' ? 'Not enough scored sessions in this window' : `Trend weight ${trendChange(lift)} · ${plural(lift.points.length, 'session')}`,
  details: evidence(lift),
})));
const labels = computed(() => selected.value?.points.map((point) => monthDay(point.date)) ?? []);
const scoreSeries = computed(() => [{ key: 'score', name: 'Best-session score', tone: 'teal', values: selected.value?.points.map((point) => point.score) ?? [] }]);
const trendSeries = computed(() => [{ key: 'trend', name: 'Trend weight', tone: 'blue', values: selected.value?.points.map((point) => point.trend) ?? [] }]);
const relativeSeries = computed(() => [{ key: 'relative', name: 'Score per lb', tone: 'teal', values: selected.value?.points.map((point) => point.relative) ?? [] }]);
const chosenSession = ref<number | null>(null);
watch(selectedName, () => { chosenSession.value = null; });
const sessionText = computed(() => {
  const point = chosenSession.value === null ? null : selected.value?.points[chosenSession.value];
  if (!point) return '';
  const trend = point.trend === null ? 'no trend weight within 3 days' : `trend ${lb(point.trend)}${point.trendDate !== point.date ? ` (from ${formatCalendarDate(point.trendDate!)})` : ''}`;
  return `${formatCalendarDate(point.date, { weekday: true })}: best set ${point.load} lb × ${point.reps}, score ${score(point.score)}, ${trend}, ${point.relative === null ? 'no score per lb' : `${perLb(point.relative)} per lb`}`;
});
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="strength-heading">
    <div class="section-heading"><div><div class="eyebrow">ESTIMATED STRENGTH AND TREND WEIGHT</div><h2 id="strength-heading">Strength vs body weight</h2></div>
      <MethodInfo :label="`Method ${strengthMethodVersion}`" /></div>
    <p v-if="!exercises" class="field-help">Workout sets are not loaded, so strength cannot be compared yet.</p>
    <template v-else-if="analysis">
      <div class="insight-controls">
        <label class="field-label" for="strength-window">Window</label>
        <select id="strength-window" v-model="windowKey"><option v-for="item in windows" :key="item.key" :value="item.key">{{ item.label }}</option></select>
        <div class="segmented" role="group" aria-label="Lifts shown">
          <button type="button" :aria-pressed="scope === 'top'" @click="scope = 'top'">Most trained</button>
          <button type="button" :aria-pressed="scope === 'all'" @click="scope = 'all'">All scored lifts</button>
        </div>
      </div>
      <p class="field-help">Compares the median best-session score of the first three and the last three scored sessions in the window. Score per lb divides each session's score by MacroFactor's trend weight that day (or the nearest within {{ analysis.settings.toleranceDays }} days). Loads are as logged; body weight is never added.</p>
      <p v-if="!lifts.length" class="field-help">No positive-load sessions with a qualifying set in this window.</p>
      <template v-else>
        <DataRows v-if="narrow" :rows="rows" label="Lifts" :group-by-month="false" :selected="selectedName" @select="selectedName = $event" />
        <div v-else class="table-scroll" role="region" aria-label="Lifts" tabindex="0">
          <table class="period-table">
            <thead><tr><th scope="col">Lift</th><th scope="col">Strength</th><th scope="col">Score</th><th scope="col">Score per lb</th><th scope="col">Trend weight</th><th scope="col">Sessions</th></tr></thead>
            <tbody>
              <tr v-for="lift in lifts" :key="lift.name" :class="{ 'is-selected': lift.name === selectedName }">
                <th scope="row"><button class="text-button" type="button" :aria-pressed="lift.name === selectedName" @click="selectedName = lift.name">{{ lift.name }}</button></th>
                <td>{{ icons[lift.change.label] }} {{ lift.change.label }}</td>
                <td>{{ lift.change.label === 'Insufficient data' ? '—' : `${score(lift.change.scoreBefore)} → ${score(lift.change.scoreAfter)} (${percent(lift.change.scoreChangePercent)})` }}</td>
                <td>{{ lift.change.label === 'Insufficient data' ? '—' : `${perLb(lift.change.relativeBefore)} → ${perLb(lift.change.relativeAfter)} (${percent(lift.change.relativeChangePercent)})` }}</td>
                <td>{{ lift.change.label === 'Insufficient data' ? '—' : `${lb(lift.change.trendBefore)} → ${lb(lift.change.trendAfter)}` }}</td>
                <td>{{ lift.points.length }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="selected" class="selected-day" aria-label="Selected lift">
          <h3>{{ selected.name }}</h3>
          <p class="field-help">{{ selected.change.reason }}</p>
          <CategoryChart kind="line" :zero="false" :labels="labels" :series="scoreSeries" :selected="chosenSession" title="Best-session estimated-strength score" @select="chosenSession = $event" />
          <CategoryChart kind="line" :zero="false" :labels="labels" :series="trendSeries" :selected="chosenSession" title="Trend weight on the session date (lb)" unit=" lb" @select="chosenSession = $event" />
          <CategoryChart kind="line" :zero="false" :labels="labels" :series="relativeSeries" :selected="chosenSession" title="Score per lb of trend weight" @select="chosenSession = $event" />
          <p v-if="sessionText" class="field-help" aria-live="polite">{{ sessionText }}</p>
        </div>
      </template>
      <p v-if="analysis.unmatched" class="field-help">{{ plural(analysis.unmatched, 'scored session') }} had no eligible trend weight within {{ analysis.settings.toleranceDays }} days, so {{ analysis.unmatched === 1 ? 'it has' : 'they have' }} a score but no score per lb.</p>
      <details v-if="analysis.excluded.length" class="preview-section">
        <summary>Not compared ({{ analysis.excluded.length }})</summary>
        <ul class="plain-list"><li v-for="item in analysis.excluded" :key="item.name"><strong>{{ item.name }}</strong> <span>{{ item.reason }}</span></li></ul>
      </details>
    </template>
    <details class="preview-section">
      <summary>How this is calculated</summary>
      <ul class="plain-list formulas">
        <li><strong>Session score</strong><span>The best qualifying set's load × (1 + reps ÷ 30): positive logged load, 1-10 reps, Standard or Failure sets (the same rule as Exercise progress). An estimate, not a measured maximum.</span></li>
        <li><strong>Score per lb</strong><span>Session score ÷ trend weight on the session date, or the nearest eligible trend value within 3 days (earlier date on a tie). Never interpolated.</span></li>
        <li><strong>Gained, Kept, Lost</strong><span>Median score of the last 3 scored sessions in the window vs the first 3, using your progress band (±{{ analysis?.settings.bandPercent ?? 2.5 }}%). Six scored sessions are needed.</span></li>
        <li><strong>Windows</strong><span>All history, the latest 12 weeks, or a weight phase from the Weight phases analysis.</span></li>
      </ul>
    </details>
  </section>
</template>
