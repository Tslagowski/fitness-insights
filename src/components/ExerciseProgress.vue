<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Gateway, ImportedHistory, Preferences, SavedWorkoutDay } from '../gateway';
import type { EligibilityReport } from '../analysis/eligibility';
import { analyzeExercises, exerciseMethodVersion, maximumReps, minimumReps, movementLabels, sessionsPerGroup, type ExerciseSession, type ProgressLabel } from '../analysis/exercise';
import { formatDuration } from '../import/workout';
import { formatCalendarDate, formatShortDate, plural } from '../import/preview';
import ExerciseCharts from './ExerciseCharts.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ gateway: Gateway; history: ImportedHistory; report: EligibilityReport; preferences: Preferences }>();

const days = ref<SavedWorkoutDay[] | null>(null);
const loading = ref(false);
const problem = ref('');
async function load() {
  loading.value = true;
  problem.value = '';
  try { days.value = await props.gateway.loadWorkoutHistory(); }
  catch { problem.value = 'Your workout sets could not be loaded for analysis. Check your connection and try again; nothing was changed.'; }
  finally { loading.value = false; }
}
onMounted(load);
watch(() => props.history.revisionId, (now, before) => { if (now !== before) void load(); });

const analysis = computed(() => days.value ? analyzeExercises(days.value, props.report, props.history.aliases,
  { bandPercent: props.preferences.strengthBandPercent, durationUnit: props.preferences.durationUnit }) : null);
const selectedName = ref('');
watch(analysis, (result) => {
  if (!result || result.exercises.some((exercise) => exercise.name === selectedName.value)) return;
  selectedName.value = (result.exercises.find((exercise) => exercise.comparison.recent.length) ?? result.exercises[0])?.name ?? '';
}, { immediate: true });
const exercise = computed(() => analysis.value?.exercises.find((item) => item.name === selectedName.value) ?? null);
const recentExercises = computed(() => analysis.value?.exercises.slice(0, 10) ?? []);
const sortedNames = computed(() => [...(analysis.value?.exercises ?? [])].sort((left, right) => left.name.localeCompare(right.name)));
const shownSessions = computed(() => [...(exercise.value?.sessions ?? [])].slice(-12).reverse());
const sessionKey = (session: ExerciseSession) => `${session.date}|${session.workout}|${session.durationRaw}`;
const groupOf = (session: ExerciseSession) => {
  const key = sessionKey(session);
  if (exercise.value?.comparison.recent.some((item) => sessionKey(item) === key)) return 'Latest 3';
  if (exercise.value?.comparison.previous.some((item) => sessionKey(item) === key)) return '3 before';
  return '';
};

const icons: Record<ProgressLabel, string> = { Progressing: '▲', Stable: '●', Declining: '▼', 'Insufficient data': '○', 'Not scored': '–' };
const percent = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
const score = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const lb = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} lb`;
const span = (sessions: ExerciseSession[]) => (sessions.length ? `${formatCalendarDate(sessions[0].date)} – ${formatCalendarDate(sessions.at(-1)!.date)}` : '');
const duration = (raw: number | null) => (raw === null ? '—' : `${raw} (${formatDuration(raw, props.preferences.durationUnit)})`);
const showLoad = computed(() => exercise.value && ['loaded', 'mixed', 'bodyweight'].includes(exercise.value.kind));
const showAssist = computed(() => exercise.value && ['assisted', 'mixed'].includes(exercise.value.kind));
const showReps = computed(() => exercise.value && ['bodyweight', 'mixed'].includes(exercise.value.kind));
const showTime = computed(() => exercise.value && ['timed', 'mixed'].includes(exercise.value.kind));
const leftOutText = computed(() => {
  const counts = analysis.value?.leftOut;
  if (!counts) return '';
  return [counts.today ? 'today (in progress)' : '', counts.future ? plural(counts.future, 'planned future day') : '', counts.unconfirmed ? plural(counts.unconfirmed, 'day not yet confirmed by a later import') : ''].filter(Boolean).join(', ');
});

const narrow = useNarrow();
const exerciseRows = computed<DataRow[]>(() => recentExercises.value.map((item) => ({
  key: item.name, heading: item.name, primary: `${icons[item.comparison.label]} ${item.comparison.label}`,
  secondary: `last ${formatCalendarDate(item.lastDate)}${item.comparison.changePercent === null ? '' : ` · ${percent(item.comparison.changePercent)}`}`,
})));
const sessionRows = computed<DataRow[]>(() => shownSessions.value.map((session) => {
  const parts: string[] = [];
  if (showLoad.value) parts.push(session.best ? `score ${score(session.best.score)}` : 'no qualifying set');
  if (showAssist.value && session.leastAssistance) parts.push(`least assistance ${lb(session.leastAssistance.load)} × ${session.leastAssistance.reps ?? '—'}`);
  if (showReps.value && session.bodyweightReps) parts.push(`reps ${session.bodyweightReps.max} max / ${session.bodyweightReps.total} total`);
  if (showTime.value) parts.push(`longest ${duration(session.longestDuration)}`);
  parts.push(plural(session.workingSets, 'working set'));
  if (showLoad.value && session.loggedLoadVolume !== null) parts.push(`${session.loggedLoadVolume.toLocaleString('en-US')} lb·reps`);
  if (session.workout) parts.push(session.workout);
  const primary = showLoad.value && session.best ? `${lb(session.best.load)} × ${session.best.reps}`
    : session.leastAssistance ? `${lb(session.leastAssistance.load)} × ${session.leastAssistance.reps ?? '—'}`
    : session.bodyweightReps ? `${session.bodyweightReps.max} reps` : session.longestDuration !== null ? formatDuration(session.longestDuration, props.preferences.durationUnit) : '—';
  return { key: sessionKey(session), date: session.date, heading: formatShortDate(session.date), tag: groupOf(session) || undefined, primary, secondary: parts.join(' · ') };
}));
</script>

<template>
  <section class="section-card intake-balance exercise-progress" aria-labelledby="exercise-heading">
    <div class="section-heading"><div><div class="eyebrow">COMPLETED SESSIONS ONLY</div><h2 id="exercise-heading">Exercise progress</h2></div>
      <span class="outline-pill">Method {{ exerciseMethodVersion }} · label band ±{{ preferences.strengthBandPercent }}%</span></div>
    <div v-if="problem" class="alert error" role="alert">{{ problem }} <button class="text-button" type="button" @click="load">Try again</button></div>
    <p v-else-if="loading && !days" class="field-help" role="status">Loading your workout sets…</p>
    <template v-else-if="analysis">
      <p v-if="!analysis.exercises.length" class="field-help">No completed workout sessions are confirmed by an import yet.</p>
      <template v-else>
        <p class="field-help">{{ plural(analysis.exercises.length, 'exercise') }} with completed sessions{{ analysis.cutoff ? ` through ${formatCalendarDate(analysis.cutoff)}` : '' }}.
          <template v-if="leftOutText">Left out of comparisons: {{ leftOutText }}.</template> Loads and reps are used exactly as logged (per hand, per side); base, machine, and body weight are never added.</p>

        <DataRows v-if="narrow" :rows="exerciseRows" label="Recently trained exercises" :group-by-month="false" :selected="selectedName" @select="selectedName = $event" />
        <div v-else class="table-scroll" role="region" aria-label="Recently trained exercises" tabindex="0">
          <table class="period-table exercise-table">
            <caption class="visually-hidden">Recently trained exercises and their progress labels</caption>
            <thead><tr><th scope="col">Exercise</th><th scope="col">Last session</th><th scope="col">Label</th><th scope="col">Change</th></tr></thead>
            <tbody>
              <tr v-for="item in recentExercises" :key="item.name" :class="{ 'is-selected': item.name === selectedName }">
                <th scope="row"><button class="text-button" type="button" :aria-pressed="item.name === selectedName" @click="selectedName = item.name">{{ item.name }}</button></th>
                <td>{{ formatCalendarDate(item.lastDate) }}</td>
                <td class="source-cell"><span class="label-chip">{{ icons[item.comparison.label] }} {{ item.comparison.label }}</span></td>
                <td>{{ item.comparison.changePercent === null ? '—' : percent(item.comparison.changePercent) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="exercise-picker"><label class="field-label" for="exercise-select">Exercise</label>
          <select id="exercise-select" v-model="selectedName">
            <option v-for="item in sortedNames" :key="item.name" :value="item.name">{{ item.name }} ({{ plural(item.sessions.length, 'session') }})</option>
          </select></div>

        <article v-if="exercise" class="exercise-detail" aria-label="Selected exercise">
          <h3>{{ exercise.name }}</h3>
          <p class="field-help">{{ movementLabels[exercise.kind] }} · {{ plural(exercise.sessions.length, 'completed session') }}<template v-if="exercise.kind === 'loaded'">, {{ exercise.scoredSessions }} with a qualifying set</template>.
            <template v-if="exercise.loggedNames.length > 1 || exercise.loggedNames[0] !== exercise.name"> Logged as: {{ exercise.loggedNames.join(', ') }} (grouped by your display name).</template></p>
          <div class="metric-grid" aria-label="Progress result">
            <article class="metric-tile" :class="{ insufficient: exercise.comparison.label === 'Insufficient data' }">
              <h4>Progress label</h4><p class="metric-value">{{ icons[exercise.comparison.label] }} {{ exercise.comparison.label }}</p>
              <p class="metric-detail">{{ exercise.comparison.reason }}</p>
            </article>
            <article v-if="exercise.comparison.changePercent !== null" class="metric-tile">
              <h4>Change in median best score</h4><p class="metric-value">{{ percent(exercise.comparison.changePercent) }}</p>
              <p class="metric-detail">{{ score(exercise.comparison.previousMedian!) }} ({{ span(exercise.comparison.previous) }}) → {{ score(exercise.comparison.recentMedian!) }} ({{ span(exercise.comparison.recent) }})</p>
            </article>
          </div>

          <div v-if="exercise.repsAtLoads.length" class="table-scroll" role="region" aria-label="Reps at comparable loads" tabindex="0">
            <table class="period-table">
              <caption>Reps at loads used in both groups (best working set)</caption>
              <thead><tr><th scope="col">Load (as logged)</th><th scope="col">3 sessions before</th><th scope="col">Latest 3</th></tr></thead>
              <tbody><tr v-for="row in exercise.repsAtLoads" :key="row.load"><th scope="row">{{ lb(row.load) }}</th><td>{{ row.previousBest }} reps</td><td>{{ row.recentBest }} reps</td></tr></tbody>
            </table>
          </div>

          <template v-if="narrow"><h4 class="rows-title">Latest {{ shownSessions.length }} sessions</h4><DataRows :rows="sessionRows" label="Sessions" /></template>
          <div v-else class="table-scroll" role="region" aria-label="Sessions" tabindex="0">
            <table class="period-table">
              <caption>Latest {{ shownSessions.length }} sessions (newest first)</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Group</th>
                <template v-if="showLoad"><th scope="col">Best qualifying set</th><th scope="col">Score</th></template>
                <th v-if="showAssist" scope="col">Least assistance</th><th v-if="showReps" scope="col">Max / total reps</th><th v-if="showTime" scope="col">Longest duration</th>
                <th scope="col">Working sets</th><th v-if="showLoad" scope="col">Logged-load volume</th></tr></thead>
              <tbody>
                <tr v-for="session in shownSessions" :key="sessionKey(session)">
                  <th scope="row">{{ formatCalendarDate(session.date, { weekday: true }) }}<span v-if="session.workout" class="row-status">{{ session.workout }}</span></th>
                  <td class="source-cell">{{ groupOf(session) }}</td>
                  <template v-if="showLoad"><td>{{ session.best ? `${lb(session.best.load)} × ${session.best.reps}` : 'none' }}</td><td>{{ session.best ? score(session.best.score) : '—' }}</td></template>
                  <td v-if="showAssist">{{ session.leastAssistance ? `${lb(session.leastAssistance.load)} × ${session.leastAssistance.reps ?? '—'}` : '—' }}</td>
                  <td v-if="showReps">{{ session.bodyweightReps ? `${session.bodyweightReps.max} / ${session.bodyweightReps.total}` : '—' }}</td>
                  <td v-if="showTime">{{ duration(session.longestDuration) }}</td>
                  <td>{{ session.workingSets }}</td><td v-if="showLoad">{{ session.loggedLoadVolume === null ? '—' : `${session.loggedLoadVolume.toLocaleString('en-US')} lb·reps` }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <ExerciseCharts :exercise="exercise" :weeks="analysis.weekly" />
        <details class="preview-section">
          <summary>Working sets per week (table)</summary>
          <ul class="plain-list"><li v-for="week in [...analysis.weekly].reverse().slice(0, 12)" :key="week.weekStart">
            <strong>Week of {{ formatCalendarDate(week.weekStart) }}: {{ plural(week.workingSets, 'working set') }}</strong><span v-if="week.partial">Not yet complete: includes days after the latest confirmed workout import.</span></li></ul>
        </details>
        <details class="preview-section">
          <summary>How exercise progress is calculated</summary>
          <ul class="plain-list formulas">
            <li><strong>Estimated-strength score</strong><span>Logged load × (1 + reps ÷ 30). A transparent estimate, not a measured maximum. Uses the load as logged (per hand for dumbbells); no RIR correction.</span></li>
            <li><strong>Qualifying sets</strong><span>Positive logged load, {{ minimumReps }}–{{ maximumReps }} reps, Standard or Failure set. Warm-ups never qualify.</span></li>
            <li><strong>Label</strong><span>Best qualifying set per session; median of the latest {{ sessionsPerGroup }} sessions vs the {{ sessionsPerGroup }} before. Change = (recent ÷ previous − 1) × 100. Above +{{ preferences.strengthBandPercent }}% Progressing, below −{{ preferences.strengthBandPercent }}% Declining, otherwise Stable (change the band in Imports &amp; Settings). Fewer than {{ sessionsPerGroup * 2 }} sessions: Insufficient data. This is a display heuristic, not statistical significance.</span></li>
            <li><strong>Not scored</strong><span>Assisted (negative weight), bodyweight or zero-load, and timed movements show assistance, reps, or duration instead. Movements mixing loaded with assisted or timed sets are not given one label.</span></li>
            <li><strong>Working sets</strong><span>Every set except warm-ups, including valid sets with a blank load, on completed days. Weeks start Monday.</span></li>
            <li><strong>Logged-load volume</strong><span>Σ load × reps over non-warm-up sets with a nonnegative logged load and reps. Not total mechanical work, never compared across exercises, and never MacroFactor's muscle-group volume.</span></li>
            <li><strong>Sessions</strong><span>Grouped by date, workout name, and workout duration; the export has no session ID, so two identical same-day sessions appear as one. Durations are raw values read as {{ preferences.durationUnit }} (provisional, changeable in Imports &amp; Settings).</span></li>
          </ul>
        </details>
      </template>
    </template>
  </section>
</template>
