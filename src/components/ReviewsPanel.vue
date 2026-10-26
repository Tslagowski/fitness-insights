<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { CapacityError, StaleRevisionError, type Gateway, type ImportedHistory, type MuscleMapping, type Preferences } from '../gateway';
import type { EligibilityReport } from '../analysis/eligibility';
import type { DailyValues } from '../analysis/daily';
import type { ExerciseAnalysis } from '../analysis/exercise';
import type { OwnerNote } from '../analysis/notes';
import { reportFingerprint } from '../analysis/report';
import { generateReview, reviewPeriods, reviewTemplateVersion, type ReviewKind } from '../analysis/review';
import ReportView from './ReportView.vue';

const props = defineProps<{ gateway: Gateway; history: ImportedHistory; report: EligibilityReport; preferences: Preferences; days: DailyValues[]; exercises: ExerciseAnalysis | null; notes: OwnerNote[]; workoutsLoaded: boolean }>();

const muscles = ref<Record<string, MuscleMapping> | null>(null);
onMounted(async () => { try { muscles.value = await props.gateway.loadExerciseMuscles(); } catch { muscles.value = null; } });

const kind = ref<ReviewKind>('month');
const periods = computed(() => (props.days.length ? reviewPeriods(kind.value, props.days[0].date, props.days.at(-1)!.date) : []));
const periodKey = ref('');
watch(periods, (list) => {
  if (list.some((period) => period.start === periodKey.value)) return;
  periodKey.value = (list.find((period) => !period.partial) ?? list[0])?.start ?? '';
}, { immediate: true });
const period = computed(() => periods.value.find((item) => item.start === periodKey.value) ?? null);
const review = computed(() => (period.value ? generateReview({ history: props.history, report: props.report, preferences: props.preferences, days: props.days,
  exercises: props.exercises, notes: props.notes, muscles: muscles.value }, period.value) : null));

const state = ref<'idle' | 'saving' | 'saved' | 'unchanged' | 'failed' | 'stale' | 'full'>('idle');
watch(review, () => { state.value = 'idle'; });
async function save() {
  if (!review.value || review.value.inputs.revisionId === null) return;
  state.value = 'saving';
  try {
    const result = await props.gateway.saveReport(review.value, await reportFingerprint(review.value));
    state.value = result.replayed ? 'unchanged' : 'saved';
  } catch (error) {
    state.value = error instanceof StaleRevisionError ? 'stale' : error instanceof CapacityError ? 'full' : 'failed';
  }
}
const statusText = computed(() => ({
  idle: '', saving: 'Saving…', saved: 'Saved as an immutable report. Find it under Saved reports on the Overview.', unchanged: 'This exact review is already saved; nothing new was saved.',
  failed: 'The review was not saved. Check your connection and try again.', stale: 'Your saved history changed on another device. Reload the page and save again.',
  full: 'Not saved: the free database is nearly full. Free space in Imports & Settings (Version retention).',
}[state.value]));
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="reviews-heading">
    <div class="section-heading"><div><div class="eyebrow">MONTH, QUARTER, AND YEAR IN REVIEW</div><h2 id="reviews-heading">Long-range reviews</h2></div>
      <span class="outline-pill">Template {{ reviewTemplateVersion }}</span></div>
    <p class="field-help">Each review is written from the same calculations as the other analyses, over one calendar period. Anything without enough eligible data says so instead of showing a number.</p>
    <p v-if="!periods.length" class="field-help">No completed days yet.</p>
    <template v-else>
      <div class="insight-controls">
        <div class="segmented" role="group" aria-label="Review length">
          <button type="button" :aria-pressed="kind === 'month'" @click="kind = 'month'">Month</button>
          <button type="button" :aria-pressed="kind === 'quarter'" @click="kind = 'quarter'">Quarter</button>
          <button type="button" :aria-pressed="kind === 'year'" @click="kind = 'year'">Year</button>
        </div>
        <label class="field-label" for="review-period">Period</label>
        <select id="review-period" v-model="periodKey"><option v-for="item in periods" :key="item.start" :value="item.start">{{ item.label }}{{ item.partial ? ' (in progress)' : '' }}</option></select>
      </div>
      <p v-if="!workoutsLoaded" class="field-help">Workout sets did not load, so training findings are unavailable in this review.</p>
      <ReportView v-if="review" :report="review" />
      <div class="form-footer"><span class="muted" role="status">{{ statusText }}</span>
        <button class="primary-button" type="button" :disabled="state === 'saving' || !review || review.inputs.revisionId === null" @click="save">Save this review</button></div>
    </template>
  </section>
</template>
