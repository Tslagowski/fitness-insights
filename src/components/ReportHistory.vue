<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { StaleRevisionError, type Gateway, type ImportedHistory, type SavedReport, type SavedReportSummary } from '../gateway';
import { compareReports, reportFingerprint, type WrittenReport } from '../analysis/report';
import { formatCalendarDate, plural } from '../import/preview';
import ReportView from './ReportView.vue';

// Saved reports are immutable snapshots: each stores the content and inputs it was generated from.
const props = defineProps<{ gateway: Gateway; history: ImportedHistory; current: WrittenReport | null; complete: boolean }>();

const reports = ref<SavedReportSummary[]>([]);
const listProblem = ref('');
const saveState = ref<'idle' | 'saving' | 'saved' | 'unchanged' | 'failed' | 'skipped'>('idle');
const currentFingerprint = ref('');
const opened = ref<SavedReport | null>(null);
const opening = ref('');
const openProblem = ref('');
const comparing = ref(false);

async function loadList() {
  listProblem.value = '';
  try { reports.value = await props.gateway.listReports(); }
  catch { listProblem.value = 'Saved reports could not be loaded. Check your connection and try again; nothing was changed.'; }
}
async function saveCurrent() {
  const report = props.current;
  if (!report || report.inputs.revisionId === null) return;
  if (!props.complete) { saveState.value = 'skipped'; return; }
  saveState.value = 'saving';
  try {
    const fingerprint = await reportFingerprint(report);
    currentFingerprint.value = fingerprint;
    const result = await props.gateway.saveReport(report, fingerprint);
    saveState.value = result.replayed ? 'unchanged' : 'saved';
    await loadList();
  } catch (error) {
    // A newer revision from another device: the page reloads its history and a fresh report follows.
    saveState.value = error instanceof StaleRevisionError ? 'idle' : 'failed';
  }
}
onMounted(loadList);
watch(() => [props.current, props.complete] as const, () => { void saveCurrent(); }, { immediate: true });

async function open(id: string) {
  opening.value = id;
  openProblem.value = '';
  comparing.value = false;
  try {
    opened.value = await props.gateway.loadReport(id);
    if (!opened.value) openProblem.value = 'That report is no longer retained.';
  } catch { openProblem.value = 'The report could not be loaded. Check your connection and try again.'; }
  finally { opening.value = ''; }
}
const comparison = computed(() => (opened.value && props.current ? compareReports(opened.value.content, props.current, props.history) : null));
const isCurrent = (item: SavedReportSummary) => item.fingerprint === currentFingerprint.value;
const savedAt = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const statusText = computed(() => ({
  idle: '', saving: 'Saving this overview as a report…', saved: 'This overview was saved as a new report.', unchanged: 'This overview matches a saved report; nothing new was saved.',
  failed: 'This overview could not be saved as a report. It is still shown above; it will be saved the next time the Overview opens.',
  skipped: 'This overview is not saved because part of it is unavailable (workout sets did not load).',
}[saveState.value]));
</script>

<template>
  <section class="section-card report-history" aria-labelledby="reports-heading">
    <div class="section-heading"><div><div class="eyebrow">IMMUTABLE SNAPSHOTS</div><h2 id="reports-heading">Saved reports</h2></div>
      <span class="outline-pill">{{ plural(reports.length, 'report') }}</span></div>
    <p class="field-help">Each time the overview's data, settings, review decisions, or methods change, it is saved as a new report with exactly the inputs it used. Saved reports are never rewritten; reports for the 12 most recent data versions are kept.</p>
    <p v-if="statusText" class="muted save-status" role="status">{{ statusText }}</p>
    <div v-if="listProblem" class="alert error" role="alert">{{ listProblem }} <button class="text-button" type="button" @click="loadList">Try again</button></div>
    <ul v-else-if="reports.length" class="plain-list report-list" aria-label="Saved reports">
      <li v-for="item in reports" :key="item.id" :class="{ 'is-open': opened?.id === item.id }">
        <span class="report-line"><strong>{{ savedAt(item.createdAt) }}</strong><template v-if="isCurrent(item)"> · current</template></span>
        <span>Data version {{ item.revisionId ?? '—' }}<template v-if="item.periodEnd"> · period ending {{ formatCalendarDate(item.periodEnd) }}</template> · {{ item.templateVersion }}</span>
        <button class="text-button" type="button" :disabled="opening === item.id" @click="open(item.id)">{{ opening === item.id ? 'Opening…' : 'Open' }}</button>
      </li>
    </ul>
    <p v-else class="field-help">No reports saved yet.</p>
    <div v-if="openProblem" class="alert error" role="alert">{{ openProblem }}</div>

    <article v-if="opened" class="opened-report" aria-label="Opened report">
      <div class="opened-heading">
        <h3>Report saved {{ savedAt(opened.createdAt) }}</h3>
        <button class="text-button" type="button" @click="opened = null">Close</button>
      </div>
      <p class="field-help">Data version {{ opened.content.inputs.revisionId ?? '—' }} · completed days through {{ opened.content.inputs.periodEnd ? formatCalendarDate(opened.content.inputs.periodEnd) : '—' }} · first generated {{ formatCalendarDate(opened.content.inputs.reportDate) }} · exercise band ±{{ opened.content.inputs.settings.strengthBandPercent }}% · durations read as {{ opened.content.inputs.settings.durationUnit }}.</p>
      <button v-if="current" class="primary-button compare-button" type="button" :aria-pressed="comparing" @click="comparing = !comparing">{{ comparing ? 'Show the saved report' : 'Compare with the current overview' }}</button>
      <div v-if="comparing && comparison" class="report-comparison" aria-label="Comparison with the current overview">
        <h4>What changed in the inputs</h4>
        <p class="field-help">Imports, corrections, settings, and review decisions. These are changes to what the report was calculated from, not changes in your behavior.</p>
        <ul v-if="comparison.inputChanges.length" class="plain-list"><li v-for="(line, index) in comparison.inputChanges" :key="index">{{ line }}</li></ul>
        <p v-else class="field-help">No input changes.</p>
        <h4>What changed in the findings</h4>
        <ul v-if="comparison.findingChanges.length" class="plain-list finding-changes">
          <li v-for="(change, index) in comparison.findingChanges" :key="index"><strong>{{ change.section }}</strong>
            <span>Saved: {{ change.before ?? '(not in the saved report)' }}</span><span>Current: {{ change.after ?? '(not in the current overview)' }}</span></li>
        </ul>
        <p v-else class="field-help">The findings are identical.</p>
      </div>
      <ReportView v-else :report="opened.content" heading-level="h4" />
    </article>
  </section>
</template>
