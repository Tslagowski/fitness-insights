<script setup lang="ts">
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';
import { computed, reactive, ref } from 'vue';
import type { Gateway, ImportedHistory, SavedWorkoutDay } from '../gateway';
import { formatDuration, groupSessions, supersetBaseName, workoutSourceLabels, type DurationUnit, type WorkoutSet } from '../import/workout';
import { formatCalendarDate, formatShortDate, formatValue, plural } from '../import/preview';

const props = defineProps<{
  gateway: Gateway;
  history: ImportedHistory;
  durationUnit: DurationUnit;
  today: string;
  reloadHistory: () => Promise<boolean>;
}>();

const pageSize = 20;
const shown = ref(pageSize);
const open = ref<string | null>(null);
const loading = ref(false);
const loaded = ref<SavedWorkoutDay | null>(null);
const problem = ref('');
const days = computed(() => [...props.history.workoutDays].sort((left, right) => right.date.localeCompare(left.date)));
const visible = computed(() => days.value.slice(0, shown.value));
const totalSets = computed(() => props.history.workoutDays.reduce((total, day) => total + day.sets, 0));
const sessions = computed(() => (loaded.value ? groupSessions(loaded.value.sets) : []));
const unitLabel = computed(() => (props.durationUnit === 'seconds' ? 'read as seconds' : 'read as minutes'));

// Exercise names and cosmetic aliases.
const filter = ref('');
const drafts = reactive<Record<string, string>>({});
const savingName = ref<string | null>(null);
const aliasMessage = ref('');
const aliasProblem = ref('');
const names = computed(() => {
  const query = filter.value.trim().toLowerCase();
  return props.history.exerciseNames.filter((item) => !query || item.name.toLowerCase().includes(query) || (props.history.aliases[item.name] ?? '').toLowerCase().includes(query));
});

async function toggle(date: string) {
  problem.value = '';
  if (open.value === date) { open.value = null; return; }
  open.value = date;
  loaded.value = null;
  loading.value = true;
  try {
    const day = await props.gateway.loadWorkoutDay(date);
    if (open.value === date) loaded.value = day;
  } catch {
    if (open.value === date) problem.value = 'The sets for this day could not be loaded. Check your connection and try again.';
  } finally {
    if (open.value === date) loading.value = false;
  }
}

function displayName(name: string): string { return props.history.aliases[name] ?? name; }
function number(set: WorkoutSet, label: string, digits = 1): string {
  return formatValue(typeof set[label] === 'number' ? (set[label] as number) : null, digits);
}
function load(set: WorkoutSet): string {
  const value = set['Weight (lb)'];
  if (typeof value !== 'number') return '—';
  return value < 0 ? `${formatValue(value)} (assistance)` : formatValue(value);
}
function duration(set: WorkoutSet): string {
  const value = set.Duration;
  return typeof value === 'number' ? `${formatValue(value)} (${formatDuration(value, props.durationUnit)})` : '—';
}
function draftFor(name: string): string { return drafts[name] ?? props.history.aliases[name] ?? ''; }

async function saveAlias(name: string, value: string | null) {
  if (savingName.value) return;
  savingName.value = name;
  aliasMessage.value = '';
  aliasProblem.value = '';
  try {
    await props.gateway.saveExerciseAlias(name, value && value.trim() && value.trim() !== name ? value.trim() : null);
    delete drafts[name];
    await props.reloadHistory();
    aliasMessage.value = value && value.trim() && value.trim() !== name ? `"${name}" now displays as "${value.trim()}". The logged name is unchanged.` : `"${name}" displays as logged again.`;
  } catch {
    aliasProblem.value = 'The display name was not saved. Check your connection and try again.';
  } finally {
    savingName.value = null;
  }
}

const narrow = useNarrow();
const monthOf = (date: string) => { const [year, month] = date.split('-').map(Number); return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1))); };
/** On phones, a month heading precedes the first day of each month. */
const monthStart = (index: number) => narrow.value && (index === 0 || visible.value[index - 1].date.slice(0, 7) !== visible.value[index].date.slice(0, 7));
const dayLabel = (date: string) => (narrow.value ? formatShortDate(date) : formatCalendarDate(date, { weekday: true }));
function setRows(sets: WorkoutSet[]): DataRow[] {
  return sets.map((set, index) => {
    const reps = number(set, 'Reps');
    const weight = typeof set['Weight (lb)'] === 'number' ? (set['Weight (lb)'] as number) : null;
    const primary = weight !== null ? `${formatValue(weight)} lb${weight < 0 ? ' assistance' : ''} × ${reps}` : reps !== '—' ? `${reps} reps` : duration(set);
    const extras = [`RIR ${number(set, 'RIR')}`, typeof set.Duration === 'number' && primary !== duration(set) ? duration(set) : '',
      typeof set['Exercise Base Weight (lb)'] === 'number' ? `base ${number(set, 'Exercise Base Weight (lb)')} lb (not added)` : ''].filter(Boolean);
    return { key: String(index), heading: `Set ${index + 1}`, tag: set['Set Type'] && set['Set Type'] !== 'Standard Set' ? String(set['Set Type']) : undefined, primary, secondary: extras.join(' · ') };
  });
}
</script>

<template>
  <section class="section-card" aria-labelledby="training-heading">
    <div class="section-heading"><div><div class="eyebrow">WHAT YOU LOGGED</div><h2 id="training-heading">Training log</h2></div>
      <span class="outline-pill">{{ plural(history.workoutDays.length, 'day') }} · {{ plural(totalSets, 'set') }}</span></div>
    <ul class="plain-list training-notes">
      <li><span>Sets appear exactly as logged and in order, including identical repeats. Loads are as logged (dumbbells per hand) and reps as logged (per side for one-sided movements); nothing is doubled.</span></li>
      <li><span>Negative weight is machine assistance. A machine's base weight is shown separately and never added to the load. Blank values mean not recorded.</span></li>
      <li><span>Sessions are grouped by date, workout name, and workout duration because the export has no session ID, so two identical sessions on one day appear as one.</span></li>
      <li><span>Durations show the raw exported value with a {{ durationUnit }} reading, which is provisional until checked against MacroFactor (change it in Imports &amp; Settings).</span></li>
    </ul>

    <ul class="food-days">
      <template v-for="(day, index) in visible" :key="day.date">
      <li v-if="monthStart(index)" class="month-heading" aria-hidden="true">{{ monthOf(day.date) }}</li>
      <li>
        <button type="button" class="food-day-toggle" :aria-expanded="open === day.date" @click="toggle(day.date)">
          <span class="food-day-date">{{ dayLabel(day.date) }}<span v-if="day.date === today" class="row-status">In progress</span></span>
          <span class="food-day-totals">{{ day.workouts.join(' · ') || 'Workout' }}</span>
          <span class="muted">{{ plural(day.sets, 'set') }} · {{ plural(day.exercises, 'exercise') }} · {{ day.durations.map((raw) => formatDuration(raw, durationUnit)).join(' / ') || 'no duration' }} · {{ workoutSourceLabels[day.source] }}</span>
        </button>
        <div v-if="open === day.date" class="food-entries">
          <p v-if="loading" class="muted" role="status">Loading sets...</p>
          <p v-else-if="problem" class="alert error" role="alert">{{ problem }}</p>
          <template v-else-if="loaded">
            <div v-for="(session, sessionIndex) in sessions" :key="sessionIndex" class="workout-session">
              <h3>{{ session.workout ?? 'Workout' }}</h3>
              <p class="muted">Duration {{ formatDuration(session.durationRaw, durationUnit) }} ({{ unitLabel }}, unverified; raw {{ session.durationRaw ?? '—' }}) · {{ plural(session.setCount, 'set') }}</p>
              <div v-for="exercise in session.exercises" :key="exercise.name" class="workout-exercise">
                <h4>{{ displayName(exercise.name) }}<span v-if="displayName(exercise.name) !== exercise.name" class="muted"> · logged as “{{ exercise.name }}”</span></h4>
                <DataRows v-if="narrow" :rows="setRows(exercise.sets)" :label="`${displayName(exercise.name)} sets`" :group-by-month="false" />
                <div v-else class="table-scroll" role="region" :aria-label="`${displayName(exercise.name)} sets`" tabindex="0">
                  <table class="daily-table">
                    <thead><tr><th scope="col">Set</th><th scope="col" class="food-name">Type</th><th scope="col">Weight (lb)</th><th scope="col">Reps</th><th scope="col">RIR</th><th scope="col">Duration</th><th scope="col">Base weight (lb, not added)</th></tr></thead>
                    <tbody><tr v-for="(set, index) in exercise.sets" :key="index">
                      <th scope="row">{{ index + 1 }}</th><td class="food-name">{{ set['Set Type'] ?? '—' }}</td><td>{{ load(set) }}</td><td>{{ number(set, 'Reps') }}</td>
                      <td>{{ number(set, 'RIR') }}</td><td>{{ duration(set) }}</td><td>{{ number(set, 'Exercise Base Weight (lb)') }}</td>
                    </tr></tbody>
                  </table>
                </div>
              </div>
            </div>
          </template>
        </div>
      </li>
      </template>
    </ul>
    <button v-if="shown < days.length" class="text-button" type="button" @click="shown += pageSize">Show {{ Math.min(pageSize, days.length - shown) }} more days</button>
  </section>

  <section class="section-card" aria-labelledby="names-heading">
    <div class="section-heading"><div><div class="eyebrow">KEEP NAMES TIDY</div><h2 id="names-heading">Exercise names</h2></div>
      <span class="outline-pill">{{ plural(history.exerciseNames.length, 'name') }}</span></div>
    <p class="field-help">Every logged name stays a separate exercise. Give a name a display alias to group a rename or a superset label with another name; the logged records are never changed, and you can remove an alias at any time.</p>
    <div v-if="aliasProblem" class="alert error" role="alert">{{ aliasProblem }}</div>
    <div v-if="aliasMessage" class="alert success" role="status">{{ aliasMessage }}</div>
    <label class="field-label" for="name-filter">Find a name</label>
    <input id="name-filter" v-model="filter" class="text-input" type="search" placeholder="Search exercise names" />
    <ul class="alias-list">
      <li v-for="item in names" :key="item.name">
        <div class="alias-name"><strong>{{ item.name }}</strong><span class="muted">{{ plural(item.sets, 'set') }} on {{ plural(item.days, 'day') }}<template v-if="history.aliases[item.name]"> · shown as “{{ history.aliases[item.name] }}”</template></span></div>
        <div class="alias-edit">
          <input class="text-input" :aria-label="`Display name for ${item.name}`" :value="draftFor(item.name)" placeholder="Display as logged" @input="drafts[item.name] = ($event.target as HTMLInputElement).value" />
          <button class="text-button" type="button" :disabled="savingName !== null || draftFor(item.name) === (history.aliases[item.name] ?? '')" @click="saveAlias(item.name, draftFor(item.name))">Save</button>
          <button v-if="supersetBaseName(item.name) && !history.aliases[item.name]" class="text-button" type="button" :disabled="savingName !== null" @click="saveAlias(item.name, supersetBaseName(item.name))">Use “{{ supersetBaseName(item.name) }}”</button>
          <button v-if="history.aliases[item.name]" class="text-button" type="button" :disabled="savingName !== null" @click="saveAlias(item.name, null)">Remove alias</button>
        </div>
      </li>
    </ul>
  </section>
</template>
