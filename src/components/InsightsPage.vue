<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Gateway, ImportedHistory, Preferences, SavedFoodDay, SavedWorkoutDay } from '../gateway';
import type { EligibilityReport } from '../analysis/eligibility';
import { buildDailySeries } from '../analysis/daily';
import { latestNotes, type NoteVersion } from '../analysis/notes';
import PhasesPanel from './PhasesPanel.vue';
import ExpenditurePanel from './ExpenditurePanel.vue';
import WeekdayPanel from './WeekdayPanel.vue';
import FoodPatternsPanel from './FoodPatternsPanel.vue';
import ProteinPanel from './ProteinPanel.vue';
import StrengthPanel from './StrengthPanel.vue';
import MusclePanel from './MusclePanel.vue';
import EffortPanel from './EffortPanel.vue';
import PrecursorPanel from './PrecursorPanel.vue';
import NotesPanel from './NotesPanel.vue';
import ReviewsPanel from './ReviewsPanel.vue';
import { analyzeExercises } from '../analysis/exercise';
import { insightHeadlines, type InsightTopic } from '../analysis/insight-cards';

// Long-range analyses over all saved history. Each topic is a pure, versioned calculation over eligible
// data (ticket 06); nothing here calls an AI service or predicts, prescribes, or explains causes.
const props = defineProps<{ gateway: Gateway; history: ImportedHistory; report: EligibilityReport; preferences: Preferences; view?: string }>();

const groups: Array<{ label: string; topics: Array<{ id: InsightTopic; label: string }> }> = [
  { label: 'Weight & energy', topics: [{ id: 'phases', label: 'Weight phases' }, { id: 'expenditure', label: 'Expenditure per lb' }, { id: 'weekdays', label: 'Day of week' }] },
  { label: 'Nutrition', topics: [{ id: 'foods', label: 'Over-target days' }, { id: 'protein', label: 'Protein per lb' }] },
  { label: 'Training', topics: [{ id: 'strength', label: 'Strength vs weight' }, { id: 'muscles', label: 'Muscle balance' }, { id: 'effort', label: 'Effort and reps' }, { id: 'precursors', label: 'Best and worst sessions' }] },
  { label: 'Notes & reviews', topics: [{ id: 'notes', label: 'Notes' }, { id: 'reviews', label: 'Reviews' }] },
];
type Topic = InsightTopic;
const allTopics: Array<{ id: InsightTopic; label: string }> = groups.flatMap((group) => group.topics);
// The open topic lives in the URL (#insights/<topic>); no topic shows the card grid.
const topic = computed<Topic | null>(() => (allTopics.some((item) => item.id === props.view) ? props.view as Topic : null));
const topicLabel = computed(() => allTopics.find((item) => item.id === topic.value)?.label ?? '');

const workouts = ref<SavedWorkoutDay[] | null>(null);
const noteVersions = ref<NoteVersion[]>([]);
const notesProblem = ref('');
const notes = computed(() => latestNotes(noteVersions.value));
async function loadNotes() {
  notesProblem.value = '';
  try { noteVersions.value = await props.gateway.loadNotes(); }
  catch { notesProblem.value = 'Your notes could not be loaded. Check your connection and reload; nothing was changed.'; }
}
onMounted(loadNotes);
const problem = ref('');
const foodDays = ref<SavedFoodDay[] | null>(null);
const foodProblem = ref('');
let foodRevision: number | null | undefined;
async function loadFood() {
  if (foodRevision === props.history.revisionId && foodDays.value) return;
  foodProblem.value = '';
  try {
    foodDays.value = props.history.foodDays.length ? await props.gateway.loadFoodHistory() : [];
    foodRevision = props.history.revisionId;
  } catch { foodProblem.value = 'Your food entries could not be loaded. Check your connection and try again; nothing was changed.'; }
}
watch([() => topic.value, () => props.history.revisionId], () => { if (topic.value === 'foods') void loadFood(); }, { immediate: true });
async function load() {
  problem.value = '';
  try {
    workouts.value = props.history.workoutDays.length ? await props.gateway.loadWorkoutHistory() : [];
  } catch {
    workouts.value = null;
    problem.value = 'Your workout sets could not be loaded, so training measures are shown as unavailable. Check your connection and reload; nothing was changed.';
  }
}
onMounted(load);
watch(() => props.history.revisionId, (now, before) => { if (now !== before) void load(); });

const days = computed(() => buildDailySeries(props.history, props.report, workouts.value));
const headlines = computed(() => (topic.value ? null : insightHeadlines(days.value, exercises.value, notes.value, props.history.foodDays.length, props.preferences.stallComparisons)));
const exercises = computed(() => (workouts.value ? analyzeExercises(workouts.value, props.report, props.history.aliases,
  { bandPercent: props.preferences.strengthBandPercent, durationUnit: props.preferences.durationUnit }) : null));
</script>

<template>
  <template v-if="!topic">
    <p class="field-help insights-intro">Repeatable calculations over your eligible saved history: the same data always gives the same numbers. They describe patterns in this history only, not forecasts, advice, or causes.</p>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <section v-for="group in groups" :key="group.label" class="insight-group" :aria-label="group.label">
      <h2 class="insight-group-title">{{ group.label }}</h2>
      <div class="insight-grid">
        <a v-for="item in group.topics" :key="item.id" class="insight-card-link" :class="{ waiting: headlines && !headlines[item.id].ready }" :href="`#insights/${item.id}`">
          <span class="insight-card-title">{{ item.label }}</span>
          <span class="insight-card-value">{{ headlines?.[item.id].text }}</span>
          <span class="insight-card-go" aria-hidden="true">›</span>
        </a>
      </div>
    </section>
  </template>
  <template v-else>
    <a class="back-link" href="#insights"><span aria-hidden="true">‹</span> All insights</a>
    <h2 class="visually-hidden">{{ topicLabel }}</h2>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
  </template>
  <PhasesPanel v-if="topic === 'phases'" :days="days" :notes="notes" />
  <ExpenditurePanel v-else-if="topic === 'expenditure'" :days="days" />
  <WeekdayPanel v-else-if="topic === 'weekdays'" :days="days" />
  <FoodPatternsPanel v-else-if="topic === 'foods'" :days="days" :food-days="foodDays" :problem="foodProblem" />
  <ProteinPanel v-else-if="topic === 'protein'" :days="days" />
  <StrengthPanel v-else-if="topic === 'strength'" :days="days" :exercises="exercises" />
  <MusclePanel v-else-if="topic === 'muscles'" :gateway="gateway" :exercises="exercises" :preferences="preferences" />
  <EffortPanel v-else-if="topic === 'effort'" :exercises="exercises" />
  <PrecursorPanel v-else-if="topic === 'precursors'" :days="days" :exercises="exercises" />
  <NotesPanel v-else-if="topic === 'notes'" :gateway="gateway" :days="days" :versions="noteVersions" :problem="notesProblem" @saved="noteVersions = [...noteVersions, $event]" />
  <ReviewsPanel v-else-if="topic === 'reviews'" :gateway="gateway" :history="history" :report="report" :preferences="preferences" :days="days" :exercises="exercises" :notes="notes" :workouts-loaded="workouts !== null" />
</template>
