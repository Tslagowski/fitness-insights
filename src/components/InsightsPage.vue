<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Gateway, ImportedHistory, Preferences, SavedFoodDay, SavedWorkoutDay } from '../gateway';
import type { EligibilityReport } from '../analysis/eligibility';
import { buildDailySeries } from '../analysis/daily';
import type { OwnerNote } from '../analysis/notes';
import PhasesPanel from './PhasesPanel.vue';
import ExpenditurePanel from './ExpenditurePanel.vue';
import WeekdayPanel from './WeekdayPanel.vue';
import FoodPatternsPanel from './FoodPatternsPanel.vue';

// Long-range analyses over all saved history. Each topic is a pure, versioned calculation over eligible
// data (ticket 06); nothing here calls an AI service or predicts, prescribes, or explains causes.
const props = defineProps<{ gateway: Gateway; history: ImportedHistory; report: EligibilityReport; preferences: Preferences }>();

const topics = [
  { id: 'phases', label: 'Weight phases' },
  { id: 'expenditure', label: 'Expenditure per lb' },
  { id: 'weekdays', label: 'Day of week' },
  { id: 'foods', label: 'Over-target days' },
] as const;
type Topic = (typeof topics)[number]['id'];
const topic = ref<Topic>('phases');

const workouts = ref<SavedWorkoutDay[] | null>(null);
const notes = ref<OwnerNote[]>([]);
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
watch([() => topic.value, () => props.history.revisionId], () => { if (topic.value === 'foods') void loadFood(); });
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
</script>

<template>
  <section class="section-card topic-card" aria-labelledby="insights-topics-heading">
    <div class="eyebrow">LONG-RANGE ANALYSIS</div>
    <h2 id="insights-topics-heading" class="visually-hidden">Choose an analysis</h2>
    <div class="topic-picker" role="group" aria-label="Analysis topic">
      <button v-for="item in topics" :key="item.id" type="button" :aria-pressed="topic === item.id" @click="topic = item.id">{{ item.label }}</button>
    </div>
    <p class="field-help">Every result here is a repeatable calculation over your eligible saved history: the same data always gives the same numbers. Results describe patterns in this history only; they are not forecasts, advice, or explanations of causes.</p>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
  </section>
  <PhasesPanel v-if="topic === 'phases'" :days="days" :notes="notes" />
  <ExpenditurePanel v-else-if="topic === 'expenditure'" :days="days" />
  <WeekdayPanel v-else-if="topic === 'weekdays'" :days="days" />
  <FoodPatternsPanel v-else-if="topic === 'foods'" :days="days" :food-days="foodDays" :problem="foodProblem" />
</template>
