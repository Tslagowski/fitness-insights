<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Gateway } from '../gateway';
import type { CompletenessStatus, EligibilityReport } from '../analysis/eligibility';
import { formatCalendarDate } from '../import/preview';

const props = defineProps<{ gateway: Gateway; report: EligibilityReport; reloadHistory: () => Promise<boolean> }>();

const selected = ref('');
const saving = ref(false);
const problem = ref('');
const notice = ref('');
// Only past days with intake can be marked; today and planned days are already left out.
const candidates = computed(() => props.report.days.filter((day) => day.date < props.report.today && day.intakeSource && !props.report.incompleteDates.includes(day.date)).map((day) => day.date).reverse());

async function mark(date: string, status: CompletenessStatus) {
  if (!date || saving.value) return;
  saving.value = true;
  problem.value = '';
  notice.value = '';
  try {
    await props.gateway.saveCompleteness({ date, domain: 'nutrition', status });
    await props.reloadHistory();
    notice.value = status === 'incomplete'
      ? `${formatCalendarDate(date)} is marked incomplete: its intake is left out of nutrition calculations; weight, steps, and workouts still count.`
      : `${formatCalendarDate(date)} counts as a complete nutrition day again.`;
    selected.value = '';
  } catch {
    problem.value = 'The change was not saved. Check your connection and try again.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="section-card" aria-labelledby="complete-heading">
    <div class="section-heading"><div><div class="eyebrow">WHEN LOGGING WAS PARTIAL</div><h2 id="complete-heading">Incomplete nutrition days</h2></div>
      <span class="outline-pill">{{ report.incompleteDates.length }} marked</span></div>
    <p class="field-help">Mark a day whose food logging you know is incomplete. Its intake is left out of nutrition calculations; nothing is deleted. A low-calorie day is never assumed incomplete, and a high-calorie day is never removed automatically.</p>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <div v-if="notice" class="alert success" role="status">{{ notice }}</div>
    <div class="correct-fields">
      <div><label class="field-label" for="incomplete-date">Day</label>
        <select id="incomplete-date" v-model="selected" :disabled="saving">
          <option value="" disabled>Choose a day</option>
          <option v-for="date in candidates" :key="date" :value="date">{{ formatCalendarDate(date, { weekday: true }) }}</option>
        </select></div>
      <div class="complete-action"><button class="primary-button" type="button" :disabled="!selected || saving" @click="mark(selected, 'incomplete')">Mark incomplete</button></div>
    </div>
    <ul v-if="report.incompleteDates.length" class="plain-list marked-days" aria-label="Days marked incomplete">
      <li v-for="date in [...report.incompleteDates].reverse()" :key="date" class="marked-day"><span>{{ formatCalendarDate(date, { weekday: true }) }}</span>
        <button class="text-button" type="button" :disabled="saving" @click="mark(date, 'complete')">Mark complete again</button></li>
    </ul>
  </section>
</template>
