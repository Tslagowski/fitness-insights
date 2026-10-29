<script setup lang="ts">
import MethodInfo from './MethodInfo.vue';
import { computed, onMounted, ref } from 'vue';
import type { Gateway, MuscleMapping, Preferences } from '../gateway';
import type { ExerciseAnalysis } from '../analysis/exercise';
import { analyzeMuscles, meanWeeklySets, muscleGroups, muscleMethodVersion, pullMuscles, pushMuscles, lowerMuscles, upperMuscles, trunkMuscles, type StalledLift } from '../analysis/muscles';
import { formatCalendarDate, formatShortDate, monthDay, plural } from '../import/preview';
import CategoryChart from './CategoryChart.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ gateway: Gateway; exercises: ExerciseAnalysis | null; preferences: Preferences }>();

const mapping = ref<Record<string, MuscleMapping> | null>(null);
const problem = ref('');
const saving = ref('');
async function load() {
  problem.value = '';
  try { mapping.value = await props.gateway.loadExerciseMuscles(); }
  catch { problem.value = 'Your muscle mapping could not be loaded. Check your connection and reload; nothing was changed.'; }
}
onMounted(load);

const analysis = computed(() => (props.exercises && mapping.value ? analyzeMuscles(props.exercises, mapping.value,
  { secondaryCredit: props.preferences.secondarySetCredit, stallComparisons: props.preferences.stallComparisons }) : null));
const scope = ref<'4' | '12' | 'all'>('12');
const weeks = computed(() => {
  const list = analysis.value?.weeks ?? [];
  return scope.value === 'all' ? list : list.slice(-Number(scope.value) - (list.at(-1)?.partial ? 1 : 0));
});
const complete = computed(() => weeks.value.filter((week) => !week.partial));
const totals = computed(() => complete.value.reduce((total, week) => ({ push: total.push + week.push, pull: total.pull + week.pull, upper: total.upper + week.upper,
  lower: total.lower + week.lower, mapped: total.mapped + week.mappedSets, all: total.all + week.workingSets }), { push: 0, pull: 0, upper: 0, lower: 0, mapped: 0, all: 0 }));
const ratioText = (left: number, right: number) => (left > 0 && right > 0 ? `${(left / right).toFixed(2)} : 1` : '—');
const sets = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const means = computed(() => meanWeeklySets(weeks.value));
const labels = computed(() => weeks.value.map((week) => monthDay(week.weekStart)));
const pushPullSeries = computed(() => [
  { key: 'push', name: 'Push sets', tone: 'teal', values: weeks.value.map((week) => (week.partial ? null : week.push)) },
  { key: 'pull', name: 'Pull sets', tone: 'orange', values: weeks.value.map((week) => (week.partial ? null : week.pull)) },
]);
const upperLowerSeries = computed(() => [
  { key: 'upper', name: 'Upper sets', tone: 'blue', values: weeks.value.map((week) => (week.partial ? null : week.upper)) },
  { key: 'lower', name: 'Lower sets', tone: 'violet', values: weeks.value.map((week) => (week.partial ? null : week.lower)) },
]);
const chosenWeek = ref<number | null>(null);
const weekText = computed(() => {
  const week = chosenWeek.value === null ? null : weeks.value[chosenWeek.value];
  if (!week) return '';
  if (week.partial) return `Week of ${formatCalendarDate(week.weekStart)}: partial week (not yet confirmed by an import), not charted.`;
  return `Week of ${formatCalendarDate(week.weekStart)}: push ${sets(week.push)}, pull ${sets(week.pull)} (${ratioText(week.push, week.pull)}); upper ${sets(week.upper)}, lower ${sets(week.lower)} (${ratioText(week.upper, week.lower)}); ${sets(week.mappedSets)} of ${sets(week.workingSets)} working sets mapped.`;
});
const narrow = useNarrow();
const muscleRows = computed<DataRow[]>(() => means.value.map((row) => ({ key: row.muscle, heading: row.muscle, primary: `${sets(row.mean)} sets/week`,
  secondary: pushMuscles.includes(row.muscle) ? 'Push · upper' : pullMuscles.includes(row.muscle) ? 'Pull · upper' : upperMuscles.includes(row.muscle) ? 'Upper' : lowerMuscles.includes(row.muscle) ? 'Lower' : 'Trunk' })));
const percent = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(1)}%`);
const checkText = (lift: StalledLift) => lift.checks.map((check) => `${check.label} (${percent(check.changePercent)})`).join(', ');
const stalledRows = computed<DataRow[]>(() => (analysis.value?.stalled ?? []).map((lift) => ({ key: lift.name, heading: lift.name, primary: `Latest ${percent(lift.checks[0].changePercent)}`,
  secondary: `${lift.checks.length} of ${lift.checks.length} comparisons Stable or Declining · last session ${formatShortDate(lift.lastDate)}`, tag: lift.checks[0].label,
  details: lift.checks.map((check, index) => ({ label: index === 0 ? 'Latest comparison' : `${plural(index, 'session')} earlier`,
    value: `${percent(check.changePercent)} · ${check.previous.map((session) => monthDay(session.date)).join(', ')} → ${check.recent.map((session) => monthDay(session.date)).join(', ')}` })) })));

// Mapping editor: every exercise in the analysis, unmapped first.
const names = computed(() => {
  const all = props.exercises?.exercises.map((exercise) => exercise.name) ?? [];
  return [...all].sort((left, right) => Number(!!mapping.value?.[left]) - Number(!!mapping.value?.[right]) || left.localeCompare(right));
});
const mappedCount = computed(() => names.value.filter((name) => mapping.value?.[name]).length);
async function save(name: string, next: MuscleMapping | null) {
  if (!mapping.value) return;
  const before = mapping.value[name] ?? null;
  saving.value = name;
  problem.value = '';
  const updated = { ...mapping.value };
  if (next) updated[name] = next; else delete updated[name];
  mapping.value = updated;
  try { await props.gateway.saveExerciseMuscles(name, next); }
  catch {
    const reverted = { ...mapping.value };
    if (before) reverted[name] = before; else delete reverted[name];
    mapping.value = reverted;
    problem.value = `The mapping for ${name} was not saved. Check your connection and try again.`;
  } finally { saving.value = ''; }
}
function setPrimary(name: string, primary: string) {
  const current = mapping.value?.[name];
  void save(name, primary ? { primary, secondary: (current?.secondary ?? []).filter((muscle) => muscle !== primary) } : null);
}
function toggleSecondary(name: string, muscle: string, on: boolean) {
  const current = mapping.value?.[name];
  if (!current) return;
  const secondary = on ? [...current.secondary, muscle].filter((item, index, list) => list.indexOf(item) === index) : current.secondary.filter((item) => item !== muscle);
  void save(name, { primary: current.primary, secondary: muscleGroups.filter((item) => secondary.includes(item)) });
}
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="muscles-heading">
    <div class="section-heading"><div><div class="eyebrow">FROM YOUR OWN EXERCISE MAPPING</div><h2 id="muscles-heading">Muscle-group balance</h2></div>
      <MethodInfo :label="`Method ${muscleMethodVersion}`" /></div>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <p v-if="!exercises" class="field-help">Workout sets are not loaded, so muscle balance cannot be shown yet.</p>
    <template v-else-if="analysis">
      <div class="insight-controls">
        <div class="segmented" role="group" aria-label="Scope">
          <button type="button" :aria-pressed="scope === '4'" @click="scope = '4'">4 weeks</button>
          <button type="button" :aria-pressed="scope === '12'" @click="scope = '12'">12 weeks</button>
          <button type="button" :aria-pressed="scope === 'all'" @click="scope = 'all'">All history</button>
        </div>
      </div>
      <p v-if="!mappedCount" class="field-help">No exercise is mapped to a muscle yet. Map your exercises below; sets from unmapped exercises are listed, never guessed.</p>
      <template v-else>
        <div class="metric-grid" aria-label="Balance metrics">
          <article class="metric-tile"><h4>Push : pull</h4><p class="metric-value">{{ ratioText(totals.push, totals.pull) }}</p><p class="metric-detail">{{ sets(totals.push) }} push / {{ sets(totals.pull) }} pull sets · {{ plural(complete.length, 'complete week') }}</p></article>
          <article class="metric-tile"><h4>Upper : lower</h4><p class="metric-value">{{ ratioText(totals.upper, totals.lower) }}</p><p class="metric-detail">{{ sets(totals.upper) }} upper / {{ sets(totals.lower) }} lower sets</p></article>
          <article class="metric-tile"><h4>Sets mapped</h4><p class="metric-value">{{ totals.all ? `${Math.round((totals.mapped / totals.all) * 100)}%` : '—' }}</p><p class="metric-detail">{{ sets(totals.mapped) }} of {{ sets(totals.all) }} working sets</p></article>
        </div>
        <p class="field-help">Each working set counts once for its exercise's primary muscle{{ preferences.secondarySetCredit ? `, and ${preferences.secondarySetCredit} for each secondary muscle` : '; secondary muscles get no credit' }} (change this in Settings). Ratios describe your logged sets; no target range is implied. Partial weeks are not charted.</p>
        <CategoryChart :labels="labels" :series="pushPullSeries" :selected="chosenWeek" title="Push and pull sets per week" unit=" sets" @select="chosenWeek = $event" />
        <CategoryChart :labels="labels" :series="upperLowerSeries" :selected="chosenWeek" title="Upper and lower sets per week" unit=" sets" @select="chosenWeek = $event" />
        <p v-if="weekText" class="field-help" aria-live="polite">{{ weekText }}</p>
        <h3 class="subheading">Mean sets per week by muscle</h3>
        <p v-if="!means.length" class="field-help">No complete week in this scope.</p>
        <DataRows v-else-if="narrow" :rows="muscleRows" label="Sets per muscle" :group-by-month="false" />
        <div v-else class="table-scroll" role="region" aria-label="Sets per muscle" tabindex="0">
          <table class="period-table"><thead><tr><th scope="col">Muscle</th><th scope="col">Sets per week</th><th scope="col">Region</th></tr></thead>
            <tbody><tr v-for="row in muscleRows" :key="row.key"><th scope="row">{{ row.heading }}</th><td>{{ row.primary.replace(' sets/week', '') }}</td><td>{{ row.secondary }}</td></tr></tbody></table>
        </div>
      </template>
      <h3 class="subheading">Stalled lifts ({{ analysis.stalled.length }})</h3>
      <p class="field-help">A lift is listed when its progress label was Stable or Declining in each of the last {{ preferences.stallComparisons }} rolling comparisons (latest three sessions vs the three before, then the same ending one session earlier, and so on; band ±{{ analysis.settings.bandPercent }}%). {{ analysis.tooFewForStall ? `${plural(analysis.tooFewForStall, 'positive-load lift')} ${analysis.tooFewForStall === 1 ? 'has' : 'have'} too few scored sessions to check.` : '' }}</p>
      <p v-if="!analysis.stalled.length" class="field-help">No lift meets that rule.</p>
      <DataRows v-else-if="narrow" :rows="stalledRows" label="Stalled lifts" :group-by-month="false" />
      <div v-else class="table-scroll" role="region" aria-label="Stalled lifts" tabindex="0">
        <table class="period-table"><thead><tr><th scope="col">Lift</th><th scope="col">Comparisons (newest first)</th><th scope="col">Latest evidence</th></tr></thead>
          <tbody><tr v-for="row in stalledRows" :key="row.key"><th scope="row">{{ row.heading }}</th><td>{{ checkText(analysis.stalled.find((lift) => lift.name === row.key)!) }}</td><td>{{ row.details?.[0].value }}</td></tr></tbody></table>
      </div>
      <details class="preview-section" :open="!mappedCount">
        <summary>Exercise muscle mapping ({{ mappedCount }} of {{ names.length }} mapped)</summary>
        <p class="field-help">Choose the main muscle each exercise trains, and any secondary muscles. Mappings use the exercise's display name, are saved to your account, and are included in backups.</p>
        <p v-if="analysis.unmapped.length" class="field-help">Unmapped in all history: {{ analysis.unmapped.map((item) => `${item.name} (${plural(item.workingSets, 'set')})`).join(', ') }}.</p>
        <ul class="plain-list mapping-list" aria-label="Exercise muscle mapping">
          <li v-for="name in names" :key="name" class="mapping-row">
            <label :for="`muscle-${slug(name)}`" class="mapping-name">{{ name }}</label>
            <select :id="`muscle-${slug(name)}`" :value="mapping?.[name]?.primary ?? ''" :disabled="saving === name" @change="setPrimary(name, ($event.target as HTMLSelectElement).value)">
              <option value="">Not mapped</option>
              <option v-for="muscle in muscleGroups" :key="muscle" :value="muscle">{{ muscle }}</option>
            </select>
            <details v-if="mapping?.[name]" class="secondary-muscles">
              <summary>Secondary: {{ mapping[name].secondary.length ? mapping[name].secondary.join(', ') : 'none' }}</summary>
              <div class="checkbox-grid">
                <label v-for="muscle in muscleGroups.filter((item) => item !== mapping?.[name]?.primary)" :key="muscle">
                  <input type="checkbox" :checked="mapping[name].secondary.includes(muscle)" :disabled="saving === name" @change="toggleSecondary(name, muscle, ($event.target as HTMLInputElement).checked)" /> {{ muscle }}
                </label>
              </div>
            </details>
          </li>
        </ul>
      </details>
    </template>
    <details class="preview-section">
      <summary>How this is calculated</summary>
      <ul class="plain-list formulas">
        <li><strong>Working sets</strong><span>Every non-warm-up set on days confirmed by a workout import, grouped by Monday-start week.</span></li>
        <li><strong>Regions</strong><span>Push: {{ pushMuscles.join(', ') }}. Pull: {{ pullMuscles.join(', ') }}. Upper: push, pull, Neck, Serratus. Lower: {{ lowerMuscles.join(', ') }}. Trunk (neither): {{ trunkMuscles.join(', ') }}.</span></li>
        <li><strong>Why not MacroFactor's muscle sheet</strong><span>The workbook's "Muscle Groups - Sets" sheet gives fractional daily totals, but not which exercise credits which muscle, so its accounting cannot be checked set by set. Your own mapping is used instead.</span></li>
      </ul>
    </details>
  </section>
</template>
