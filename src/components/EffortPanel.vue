<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ExerciseAnalysis } from '../analysis/exercise';
import { addDays } from '../analysis/eligibility';
import { analyzeEffort, combine, effortMethodVersion, repBuckets, rirBuckets, type EffortCounts } from '../analysis/effort';
import { formatCalendarDate, monthDay, plural } from '../import/preview';
import CategoryChart from './CategoryChart.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ exercises: ExerciseAnalysis | null }>();
const scope = ref<'4' | '12' | 'all'>('12');
const from = computed(() => {
  const weeks = props.exercises?.weekly ?? [];
  if (scope.value === 'all' || !weeks.length) return null;
  const complete = weeks.filter((week) => !week.partial);
  const anchor = complete.at(-1)?.weekStart ?? weeks.at(-1)!.weekStart;
  return addDays(anchor, -7 * (Number(scope.value) - 1));
});
const analysis = computed(() => (props.exercises ? analyzeEffort(props.exercises, from.value) : null));
const complete = computed(() => combine(analysis.value?.weeks.filter((week) => !week.partial) ?? []));
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const share = (counts: EffortCounts) => (counts.recorded ? `${percent(counts.hardShare)} at RIR 0-2` : 'No RIR recorded');
const labels = computed(() => analysis.value?.weeks.map((week) => monthDay(week.weekStart)) ?? []);
const shareSeries = computed(() => [{ key: 'hard', name: 'Share at RIR 0-2', tone: 'teal',
  values: analysis.value?.weeks.map((week) => (week.partial || !week.covered ? null : Math.round(week.hardShare! * 1000) / 10)) ?? [] }]);
const repSeries = computed(() => [{ key: 'reps', name: 'Sets', tone: 'blue', values: repBuckets.map((bucket) => complete.value.reps[bucket]) }]);
const rirSeries = computed(() => [{ key: 'rir', name: 'Sets', tone: 'violet', values: rirBuckets.map((bucket) => complete.value.rir[bucket]) }]);
const chosenWeek = ref<number | null>(null);
const weekText = computed(() => {
  const week = chosenWeek.value === null ? null : analysis.value?.weeks[chosenWeek.value];
  if (!week) return '';
  const base = `Week of ${formatCalendarDate(week.weekStart)}: ${plural(week.sets, 'working set')}, ${week.recorded} with RIR (${percent(week.coverage)})`;
  if (week.partial) return `${base}; partial week, not charted.`;
  return week.covered ? `${base}; ${share(week)}; ${plural(week.failureSets, 'failure set')}.` : `${base}; below the 75% RIR coverage needed to chart.`;
});
const repLine = (counts: EffortCounts) => repBuckets.filter((bucket) => counts.reps[bucket]).map((bucket) => `${bucket}: ${counts.reps[bucket]}`).join(' · ');
const rirLine = (counts: EffortCounts) => rirBuckets.filter((bucket) => counts.rir[bucket]).map((bucket) => `${bucket === 'Not recorded' ? 'no RIR' : `RIR ${bucket}`}: ${counts.rir[bucket]}`).join(' · ');
const narrow = useNarrow();
const rows = computed<DataRow[]>(() => (analysis.value?.exercises ?? []).map((exercise) => ({
  key: exercise.name, heading: exercise.name, primary: share(exercise), secondary: `${plural(exercise.sets, 'set')} · ${repLine(exercise)}`,
  details: [{ label: 'Rep ranges', value: repLine(exercise) }, { label: 'RIR', value: rirLine(exercise) }, { label: 'Failure sets (as logged)', value: String(exercise.failureSets) },
    { label: 'RIR recorded', value: `${exercise.recorded} of ${exercise.sets} (${percent(exercise.coverage)})` }],
})));
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="effort-heading">
    <div class="section-heading"><div><div class="eyebrow">REP RANGES AND REPS IN RESERVE, AS LOGGED</div><h2 id="effort-heading">Training effort</h2></div>
      <span class="outline-pill">Method {{ effortMethodVersion }}</span></div>
    <p v-if="!exercises" class="field-help">Workout sets are not loaded, so effort cannot be shown yet.</p>
    <p v-else-if="!analysis?.total.sets" class="field-help">No confirmed working sets yet.</p>
    <template v-else>
      <div class="insight-controls">
        <div class="segmented" role="group" aria-label="Scope">
          <button type="button" :aria-pressed="scope === '4'" @click="scope = '4'">4 weeks</button>
          <button type="button" :aria-pressed="scope === '12'" @click="scope = '12'">12 weeks</button>
          <button type="button" :aria-pressed="scope === 'all'" @click="scope = 'all'">All history</button>
        </div>
      </div>
      <div class="metric-grid" aria-label="Effort metrics">
        <article class="metric-tile"><h4>Sets at RIR 0-2</h4><p class="metric-value">{{ percent(complete.hardShare) }}</p><p class="metric-detail">{{ complete.hard }} of {{ plural(complete.recorded, 'set') }} with RIR recorded</p></article>
        <article class="metric-tile"><h4>RIR recorded</h4><p class="metric-value">{{ percent(complete.coverage) }}</p><p class="metric-detail">{{ complete.recorded }} of {{ plural(complete.sets, 'working set') }}; blanks are not assumed</p></article>
        <article class="metric-tile"><h4>Failure sets</h4><p class="metric-value">{{ complete.failureSets }}</p><p class="metric-detail">logged as Failure Set type</p></article>
      </div>
      <p class="field-help">Complete weeks only. These describe how your sets were logged; no rep range or effort level is recommended.</p>
      <p v-if="shareSeries[0].values.every((value) => value === null)" class="field-help">No complete week has an RIR on at least 75% of its working sets, so the weekly share is not charted.</p>
      <CategoryChart v-else kind="line" :labels="labels" :series="shareSeries" :selected="chosenWeek" title="Share of sets at RIR 0-2 per week (%)" unit="%" @select="chosenWeek = $event" />
      <p v-if="weekText" class="field-help" aria-live="polite">{{ weekText }}</p>
      <CategoryChart :labels="[...repBuckets]" :series="repSeries" title="Working sets by rep range" unit=" sets" />
      <CategoryChart :labels="rirBuckets.map((bucket) => (bucket === 'Not recorded' ? 'None' : bucket))" :series="rirSeries" title="Working sets by reps in reserve (None = not recorded)" unit=" sets" />
      <h3 class="subheading">By exercise ({{ analysis.exercises.length }})</h3>
      <DataRows v-if="narrow" :rows="rows" label="Effort by exercise" :group-by-month="false" :page-size="15" unit="exercises" />
      <div v-else class="table-scroll" role="region" aria-label="Effort by exercise" tabindex="0">
        <table class="period-table">
          <thead><tr><th scope="col">Exercise</th><th scope="col">Sets</th><th v-for="bucket in repBuckets" :key="bucket" scope="col">{{ bucket }}</th><th scope="col">RIR 0-2</th><th scope="col">RIR recorded</th><th scope="col">Failure</th></tr></thead>
          <tbody><tr v-for="exercise in analysis.exercises" :key="exercise.name"><th scope="row">{{ exercise.name }}</th><td>{{ exercise.sets }}</td>
            <td v-for="bucket in repBuckets" :key="bucket">{{ exercise.reps[bucket] || '—' }}</td><td>{{ percent(exercise.hardShare) }}</td><td>{{ percent(exercise.coverage) }}</td><td>{{ exercise.failureSets }}</td></tr></tbody>
        </table>
      </div>
    </template>
    <details class="preview-section">
      <summary>How this is calculated</summary>
      <ul class="plain-list formulas">
        <li><strong>Working sets</strong><span>Every set that is not a warm-up, on days confirmed by a workout import.</span></li>
        <li><strong>Rep ranges</strong><span>1-5, 6-10, 11-15, 16+ by logged reps (per side for unilateral movements); a set with a duration and no reps is Timed. Assisted sets count by their reps.</span></li>
        <li><strong>RIR</strong><span>0, 1-2, 3-4, 5+ as logged; a blank RIR is Not recorded and never assumed. Failure sets are counted by their logged set type.</span></li>
        <li><strong>Weekly share</strong><span>Sets at RIR 0-2 ÷ sets with a recorded RIR, charted only when at least 75% of the week's working sets have an RIR.</span></li>
      </ul>
    </details>
  </section>
</template>
