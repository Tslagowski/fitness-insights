<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Gateway } from '../gateway';
import { weightBaselineDays, weightField, type EligibilityReport, type ReviewChoice, type WeightFlag } from '../analysis/eligibility';
import { formatCalendarDate, formatValue } from '../import/preview';

const props = defineProps<{ gateway: Gateway; report: EligibilityReport; reloadHistory: () => Promise<boolean> }>();

const saving = ref<string | null>(null);
const problem = ref('');
const notice = ref('');
const pending = computed(() => props.report.flags.filter((flag) => flag.status === 'pending'));
const decided = computed(() => props.report.flags.filter((flag) => flag.status !== 'pending'));
const statusText = { kept: 'Kept (used in calculations)', excluded: 'Excluded (still saved, left out of calculations)', pending: 'Pending' } as const;

async function decide(flag: WeightFlag, decision: ReviewChoice) {
  if (saving.value) return;
  saving.value = flag.date;
  problem.value = '';
  notice.value = '';
  try {
    await props.gateway.saveReviewDecision({ date: flag.date, domain: 'scale_weight', field: weightField, value: flag.value, decision });
    await props.reloadHistory();
    const label = `${formatValue(flag.value)} lb on ${formatCalendarDate(flag.date)}`;
    notice.value = decision === 'keep' ? `Kept ${label}.` : decision === 'exclude' ? `Excluded ${label}. It stays saved and can be restored.` : `${label} is back in the review queue.`;
  } catch {
    problem.value = 'Your decision was not saved. Check your connection and try again.';
  } finally {
    saving.value = null;
  }
}
const percent = (difference: number) => `${difference > 0 ? '+' : ''}${formatValue(difference * 100, 1)}%`;
</script>

<template>
  <section class="section-card" aria-labelledby="review-heading">
    <div class="section-heading"><div><div class="eyebrow">CHECK BEFORE COUNTING</div><h2 id="review-heading">Review queue</h2></div>
      <span class="outline-pill">{{ pending.length }} pending</span></div>
    <p class="field-help">A weigh-in is flagged when it is more than 10% from the median of at least three earlier weigh-ins in the previous {{ weightBaselineDays }} days. Flagged values stay saved and are left out of weight calculations until you decide. Food, steps, and workouts on the same day are unaffected. Your decision applies to that exact value; if a later import changes it, it is checked again.</p>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <div v-if="notice" class="alert success" role="status">{{ notice }}</div>
    <p v-if="!report.flags.length" class="muted">No weigh-ins need review.</p>
    <ul class="review-list" aria-label="Flagged weigh-ins">
      <li v-for="flag in [...pending, ...decided]" :key="flag.date" :class="flag.status">
        <div class="review-value"><strong>{{ formatValue(flag.value) }} lb</strong><span>{{ formatCalendarDate(flag.date, { weekday: true }) }}</span></div>
        <p class="review-reason">{{ percent(flag.difference) }} vs the median of {{ formatValue(flag.baselineMedian) }} lb ({{ flag.baselineDates.length }} weigh-ins, {{ formatCalendarDate(flag.baselineDates[0]) }} – {{ formatCalendarDate(flag.baselineDates[flag.baselineDates.length - 1]) }}).
          <template v-if="flag.status !== 'kept'"> MacroFactor's trend weight and expenditure from this date on may reflect it; excluding it here does not change those estimates.</template></p>
        <p v-if="flag.status !== 'pending'" class="muted">{{ statusText[flag.status] }}</p>
        <div class="review-actions">
          <button v-if="flag.status !== 'kept'" class="primary-button" type="button" :disabled="saving !== null" @click="decide(flag, 'keep')">Keep</button>
          <button v-if="flag.status !== 'excluded'" class="primary-button secondary" type="button" :disabled="saving !== null" @click="decide(flag, 'exclude')">Exclude</button>
          <button v-if="flag.status !== 'pending'" class="text-button" type="button" :disabled="saving !== null" @click="decide(flag, 'pending')">Review again</button>
        </div>
      </li>
    </ul>
  </section>
</template>
