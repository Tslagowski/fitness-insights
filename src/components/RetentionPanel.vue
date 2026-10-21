<script setup lang="ts">
import { ref } from 'vue';
import { StaleRevisionError, type Gateway, type ImportedHistory, type RetentionSummary } from '../gateway';
import { plural } from '../import/preview';

// Owner-reviewed cleanup: always preview first; nothing is removed automatically.
const props = defineProps<{ gateway: Gateway; history: ImportedHistory; reloadHistory: () => Promise<boolean> }>();

const preview = ref<RetentionSummary | null>(null);
const busy = ref<'' | 'checking' | 'removing'>('');
const problem = ref('');
const notice = ref('');
const removable = (summary: RetentionSummary) => summary.dailyRecords + summary.foodDays + summary.workoutDays + summary.reports;

async function check() {
  busy.value = 'checking';
  problem.value = '';
  notice.value = '';
  try { preview.value = await props.gateway.retention(props.history.revisionId, false); }
  catch { problem.value = 'Retention could not be checked. Check your connection and try again; nothing was changed.'; }
  finally { busy.value = ''; }
}
async function apply() {
  if (!preview.value) return;
  busy.value = 'removing';
  problem.value = '';
  try {
    const result = await props.gateway.retention(props.history.revisionId, true);
    notice.value = `Removed ${plural(result.dailyRecords + result.foodDays + result.workoutDays, 'superseded record')} and ${plural(result.reports, 'older report')}. Your current data and the latest ${result.keep} versions are unchanged.`;
    preview.value = null;
    await props.reloadHistory();
  } catch (error) {
    problem.value = error instanceof StaleRevisionError
      ? 'Your saved history changed (possibly on another device), so nothing was removed. Check again to review the latest state.'
      : 'Nothing was removed. Check your connection and try again.';
    preview.value = null;
  } finally { busy.value = ''; }
}
</script>

<template>
  <section class="section-card" aria-labelledby="retention-heading">
    <div class="section-heading"><div><div class="eyebrow">KEEPS THE FREE TIER COMFORTABLE</div><h2 id="retention-heading">Version retention</h2></div>
      <span class="outline-pill">Latest 12 versions kept</span></div>
    <p class="field-help">Every import, correction, and undo creates a data version. The latest 12 versions, their saved reports, all current records, import history, and the original export files are always kept. Older superseded records can be removed after you review them; Undo then stops at the oldest kept version. Nothing is removed automatically. Download a backup first if you may want to go further back.</p>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <div v-if="notice" class="alert success" role="status">{{ notice }}</div>
    <div v-if="preview" class="retention-preview" role="group" aria-label="Retention preview">
      <p v-if="!removable(preview)" class="field-help">{{ preview.keepFromRevisionId === null ? `There are ${plural(preview.revisions, 'version')}; nothing is older than the 12 kept.` : 'Nothing older than the kept versions remains.' }}</p>
      <template v-else>
        <p class="field-help">{{ plural(preview.revisions, 'version') }} saved. Keeping versions {{ preview.keepFromRevisionId }} and later would remove:</p>
        <ul class="plain-list">
          <li>{{ plural(preview.dailyRecords, 'superseded daily record') }}</li>
          <li>{{ plural(preview.foodDays, 'superseded food day') }}</li>
          <li>{{ plural(preview.workoutDays, 'superseded workout day') }}</li>
          <li>{{ plural(preview.reports, 'report') }} for older versions</li>
        </ul>
        <div class="form-footer"><button class="text-button" type="button" @click="preview = null">Cancel</button>
          <button class="primary-button" type="button" :disabled="busy !== ''" @click="apply">{{ busy === 'removing' ? 'Removing…' : 'Remove older versions' }}</button></div>
      </template>
    </div>
    <button v-else class="primary-button" type="button" :disabled="busy !== '' || history.revisionId === null" @click="check">{{ busy === 'checking' ? 'Checking…' : 'Review older versions' }}</button>
  </section>
</template>
