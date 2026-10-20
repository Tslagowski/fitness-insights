<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NothingToChangeError, StaleRevisionError, type Gateway, type ImportedHistory } from '../gateway';
import { dailyDomains, domainLabels, type DailyDomain } from '../import/workbook';
import { formatCalendarDate, formatValue, newRequestId } from '../import/preview';

const props = defineProps<{ gateway: Gateway; history: ImportedHistory; reloadHistory: () => Promise<boolean> }>();

const dates = computed(() => [...new Set(props.history.records.map((record) => record.date))].sort().reverse());
const selectedDate = ref('');
const selectedDomain = ref<DailyDomain | ''>('');
const confirming = ref(false);
const saving = ref(false);
const requestId = ref('');
const problem = ref('');
const outcome = ref('');

const domainsOnDate = computed(() => dailyDomains.filter((domain) => props.history.records.some((record) => record.date === selectedDate.value && record.domain === domain)));
const record = computed(() => props.history.records.find((item) => item.date === selectedDate.value && item.domain === selectedDomain.value) ?? null);
const recordedValues = computed(() => Object.entries(record.value?.values ?? {}).filter(([, value]) => value !== null));
const blankCount = computed(() => Object.values(record.value?.values ?? {}).filter((value) => value === null).length);

watch(selectedDate, () => { selectedDomain.value = ''; reset(); });
watch(selectedDomain, reset);
watch(() => props.history.revisionId, () => { if (!saving.value) confirming.value = false; });

function reset() { confirming.value = false; problem.value = ''; }

function review() {
  if (!record.value) return;
  outcome.value = '';
  problem.value = '';
  requestId.value = newRequestId();
  confirming.value = true;
}

async function clear() {
  if (!record.value || saving.value || !selectedDomain.value) return;
  saving.value = true;
  problem.value = '';
  const label = `${domainLabels[selectedDomain.value]} on ${formatCalendarDate(selectedDate.value)}`;
  try {
    await props.gateway.clearDay({ requestId: requestId.value, expectedRevisionId: props.history.revisionId, date: selectedDate.value, domain: selectedDomain.value });
    confirming.value = false;
    outcome.value = `Cleared ${label}. Other domains and dates are unchanged. You can undo this below.`;
    selectedDomain.value = '';
    await props.reloadHistory();
  } catch (error) {
    if (error instanceof StaleRevisionError || error instanceof NothingToChangeError) {
      confirming.value = false;
      problem.value = 'Your saved history changed (possibly on another device) before this was confirmed. Nothing was cleared. Review the current values and try again.';
      await props.reloadHistory();
    } else {
      problem.value = 'Nothing was cleared. Check your connection and press Clear again; retrying cannot clear twice.';
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="section-card" aria-labelledby="correct-heading">
    <div class="section-heading"><div><div class="eyebrow">FIX A MISTAKE</div><h2 id="correct-heading">Correct a day</h2></div>
      <span class="outline-pill">One domain at a time</span></div>
    <p class="field-help">Clear one kind of saved data for one date, such as a bad weigh-in. Everything else on that day and every other date stays as it is. Re-importing a workbook that contains the date adds it back.</p>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <div v-if="outcome" class="alert success" role="status">{{ outcome }}</div>
    <div class="correct-fields">
      <div><label class="field-label" for="correct-date">Date</label>
        <select id="correct-date" v-model="selectedDate" :disabled="saving">
          <option value="" disabled>Choose a date</option>
          <option v-for="date in dates" :key="date" :value="date">{{ formatCalendarDate(date, { weekday: true }) }}</option>
        </select></div>
      <div><label class="field-label" for="correct-domain">Data</label>
        <select id="correct-domain" v-model="selectedDomain" :disabled="!selectedDate || saving">
          <option value="" disabled>Choose what to clear</option>
          <option v-for="domain in domainsOnDate" :key="domain" :value="domain">{{ domainLabels[domain] }}</option>
        </select></div>
    </div>
    <div v-if="record" class="correct-current">
      <h3>Currently saved</h3>
      <ul class="plain-list" v-if="recordedValues.length"><li v-for="[label, value] in recordedValues.slice(0, 8)" :key="label"><span>{{ label }}: <strong>{{ formatValue(value) }}</strong></span></li></ul>
      <p class="muted"><template v-if="recordedValues.length > 8">And {{ recordedValues.length - 8 }} more values. </template><template v-if="blankCount">{{ blankCount }} blank (not recorded).</template></p>
      <div v-if="!confirming" class="form-footer"><span class="muted">You'll confirm on the next step.</span>
        <button class="primary-button" type="button" @click="review">Review clearing</button></div>
      <div v-else class="confirm-box" role="group" aria-label="Confirm clearing">
        <p>Remove <strong>{{ domainLabels[record.domain] }}</strong> for <strong>{{ formatCalendarDate(record.date) }}</strong> ({{ recordedValues.length }} recorded {{ recordedValues.length === 1 ? 'value' : 'values' }})? The day's other data stays. This creates a new version you can undo.</p>
        <div class="form-footer"><button class="text-button" type="button" @click="reset" :disabled="saving">Cancel</button>
          <button class="primary-button" type="button" @click="clear" :disabled="saving">{{ saving ? 'Clearing...' : 'Clear this data' }}</button></div>
      </div>
    </div>
  </section>
</template>
