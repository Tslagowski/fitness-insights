<script setup lang="ts">
import MethodInfo from './MethodInfo.vue';
import { computed, onMounted, ref, watch } from 'vue';
import type { Gateway, ImportedHistory, Preferences, SavedWorkoutDay } from '../gateway';
import type { EligibilityReport } from '../analysis/eligibility';
import { generateReport, overviewTemplateVersion } from '../analysis/report';
import { formatCalendarDate } from '../import/preview';
import ReportView from './ReportView.vue';

const props = defineProps<{ gateway: Gateway; history: ImportedHistory; report: EligibilityReport; preferences: Preferences }>();
const emit = defineEmits<{ generated: [report: ReturnType<typeof generateReport>, complete: boolean] }>();

const workouts = ref<SavedWorkoutDay[] | null>(null);
const workoutsFailed = ref(false);
const ready = ref(false);
async function loadWorkouts() {
  workoutsFailed.value = false;
  if (!props.history.workoutDays.length) { workouts.value = []; ready.value = true; return; }
  try { workouts.value = await props.gateway.loadWorkoutHistory(); }
  catch { workouts.value = null; workoutsFailed.value = true; }
  ready.value = true;
}
onMounted(loadWorkouts);
watch(() => props.history.revisionId, (now, before) => { if (now !== before) { ready.value = false; void loadWorkouts(); } });

const written = computed(() => (ready.value ? generateReport(props.history, props.report, workouts.value, props.preferences) : null));
watch(written, (value) => { if (value) emit('generated', value, !workoutsFailed.value); }, { immediate: true });
</script>

<template>
  <section class="section-card written-overview" aria-labelledby="overview-heading">
    <div class="section-heading"><div><div class="eyebrow">DESCRIPTIVE, FROM YOUR SAVED DATA</div><h2 id="overview-heading">Written overview</h2></div>
      <MethodInfo :label="`Template ${overviewTemplateVersion}`" :note="history.revisionId ? `Data version ${history.revisionId}.` : undefined" /></div>
    <p v-if="!written" class="field-help" role="status">Preparing your overview…</p>
    <template v-else>
      <p class="field-help">The latest {{ written.inputs.periodDays }} completed days<template v-if="written.inputs.periodEnd"> through {{ formatCalendarDate(written.inputs.periodEnd) }}</template>, compared with the {{ written.inputs.periodDays }} days before. Each statement is filled in from the same calculations as the charts; open Evidence to see the dates, counts, and method. Nothing here is advice or an explanation of causes.</p>
      <div v-if="workoutsFailed" class="alert error" role="alert">Workout sets could not be loaded, so exercise progress is shown as unavailable. <button class="text-button" type="button" @click="loadWorkouts">Try again</button></div>
      <ReportView :report="written" />
      <slot :report="written" />
    </template>
  </section>
</template>
