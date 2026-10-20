<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { StaleRevisionError, type Gateway, type ImportCommitResult, type ImportedHistory } from '../gateway';
import { domainLabels, parseWorkbook, WorkbookImportError, type SheetDisposition, type WorkbookImport } from '../import/workbook';
import {
  domainFreshness, formatCalendarDate, formatValue, newRequestId, proposeChanges, reportingToday, sha256Hex, type ProposedChanges,
} from '../import/preview';
import DailyTable from './DailyTable.vue';

const props = defineProps<{
  gateway: Gateway;
  history: ImportedHistory;
  historyState: 'loading' | 'ready' | 'error';
  reloadHistory: () => Promise<boolean>;
}>();

interface Preview {
  parsed: WorkbookImport;
  file: { name: string; sha256: string; byteSize: number; mediaType: string; bytes: Uint8Array };
  requestId: string;
  baseRevisionId: number | null;
  changes: ProposedChanges;
}

const maximumFileBytes = 20 * 1024 * 1024;
const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const phase = ref<'idle' | 'reading' | 'preview' | 'committing'>('idle');
const preview = ref<Preview | null>(null);
const problem = ref('');
const outcome = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const today = computed(() => reportingToday());
const freshness = computed(() => domainFreshness(props.history));
const lastImport = computed(() => props.history.imports[0] ?? null);

const dispositionText: Record<SheetDisposition, string> = {
  imported: 'Imported now: daily history',
  'later-food': 'Not imported yet: food entries (detailed food import)',
  'later-workouts': 'Not imported yet: workout sets (workout import)',
  archived: 'Archived with the raw file; not analyzed',
  unrecognized: 'Unrecognized; archived with the raw file only',
};

watch(() => props.history.revisionId, () => {
  // If the shared history moved while a preview is open (for example after a refresh), recompute it.
  if (preview.value && phase.value === 'preview' && preview.value.baseRevisionId !== props.history.revisionId) {
    preview.value = { ...preview.value, requestId: newRequestId(), baseRevisionId: props.history.revisionId, changes: proposeChanges(preview.value.parsed.records, props.history) };
  }
});

async function selectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  problem.value = '';
  outcome.value = '';
  preview.value = null;
  phase.value = 'reading';
  try {
    if (file.size > maximumFileBytes) throw new WorkbookImportError('This file is larger than 20 MB. Export a smaller date range and try again.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseWorkbook(bytes);
    const sha256 = await sha256Hex(bytes);
    preview.value = {
      parsed,
      file: { name: file.name, sha256, byteSize: file.size, mediaType: xlsxType, bytes },
      requestId: newRequestId(),
      baseRevisionId: props.history.revisionId,
      changes: proposeChanges(parsed.records, props.history),
    };
    phase.value = 'preview';
  } catch (error) {
    phase.value = 'idle';
    problem.value = error instanceof WorkbookImportError || (error instanceof Error && error.message.includes('secure'))
      ? error.message
      : 'This file could not be read. Nothing was changed.';
  } finally {
    input.value = '';
  }
}

function cancel() {
  preview.value = null;
  problem.value = '';
  phase.value = 'idle';
}

async function confirm() {
  if (!preview.value || phase.value === 'committing') return;
  const current = preview.value;
  phase.value = 'committing';
  problem.value = '';
  try {
    const result = await props.gateway.commitImport({
      requestId: current.requestId,
      expectedRevisionId: current.baseRevisionId,
      file: current.file,
      records: current.parsed.records,
    });
    preview.value = null;
    phase.value = 'idle';
    outcome.value = describeResult(result);
    if (!(await props.reloadHistory())) outcome.value += ' Refresh the page to see the updated history.';
  } catch (error) {
    phase.value = 'preview';
    if (error instanceof StaleRevisionError) {
      problem.value = 'Your saved history changed after this preview was prepared, possibly on another device. Nothing was overwritten. The preview below has been refreshed; review it and confirm again.';
      await props.reloadHistory();
    } else {
      problem.value = 'The import was not saved, and your previous history is unchanged. Check your connection (or resume a paused Supabase project) and press Confirm import again. Retrying cannot create a duplicate.';
    }
  }
}

function describeResult(result: ImportCommitResult): string {
  if (result.outcome === 'unchanged') return 'No changes: this workbook matches your saved history, so no new version was created.';
  const parts = [`${result.added} added`, `${result.changed} corrected`, `${result.unchanged} unchanged`];
  return `Import confirmed: ${parts.join(', ')} daily records (version ${result.revisionId}).`;
}

function describeValues(values: Record<string, number | null>, compare: Record<string, number | null>): string {
  const keys = Object.keys({ ...values, ...compare }).filter((key) => values[key] !== compare[key]);
  return keys.slice(0, 3).map((key) => `${key}: ${formatValue(values[key])}`).join('; ') + (keys.length > 3 ? ` (+${keys.length - 3} more)` : '');
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function chooseFile() { fileInput.value?.click(); }
</script>

<template>
  <section class="section-card import-card" aria-labelledby="import-heading">
    <div class="section-heading"><div><div class="eyebrow">BRING IN YOUR HISTORY</div><h2 id="import-heading">Import a MacroFactor workbook</h2></div>
      <span class="outline-pill">Daily history</span></div>
    <p class="field-help">Choose the .xlsx export. You'll review every date and change before anything is saved. The raw file is kept privately with your account.</p>

    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <div v-if="outcome" class="alert success" role="status">{{ outcome }}</div>

    <div v-if="phase === 'idle' || phase === 'reading'" class="file-picker">
      <input ref="fileInput" id="workbook-file" class="visually-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="MacroFactor workbook file" @change="selectFile" :disabled="phase === 'reading' || historyState !== 'ready'" />
      <button class="primary-button" type="button" @click="chooseFile" :disabled="phase === 'reading' || historyState !== 'ready'">
        {{ phase === 'reading' ? 'Reading workbook...' : 'Choose workbook' }} <span aria-hidden="true">&uarr;</span></button>
      <span v-if="historyState === 'loading'" class="muted">Loading your saved history first...</span>
      <span v-else-if="historyState === 'error'" class="muted">Imports are paused until your saved history loads.</span>
    </div>

    <div v-if="preview && (phase === 'preview' || phase === 'committing')" class="import-preview">
      <div class="preview-file"><strong>{{ preview.file.name }}</strong><span>{{ formatBytes(preview.file.byteSize) }} · daily sheet "{{ preview.parsed.dailySheet }}" · {{ preview.parsed.dates.length }} dates,
        {{ formatCalendarDate(preview.parsed.dates[0]) }} – {{ formatCalendarDate(preview.parsed.dates[preview.parsed.dates.length - 1]) }}</span></div>

      <div class="change-summary" aria-label="Proposed changes">
        <div><span class="change-count">{{ preview.changes.added }}</span><span>new daily records</span></div>
        <div><span class="change-count">{{ preview.changes.changed }}</span><span>corrections to saved records</span></div>
        <div><span class="change-count">{{ preview.changes.unchanged }}</span><span>already saved, unchanged</span></div>
      </div>
      <p v-if="preview.changes.added + preview.changes.changed === 0" class="field-help">Everything in this workbook matches your saved history. Confirming records the upload but creates no new version.</p>

      <details v-if="preview.changes.corrections.length" class="preview-section" open>
        <summary>Corrections ({{ preview.changes.corrections.length }})</summary>
        <ul class="plain-list">
          <li v-for="change in preview.changes.corrections.slice(0, 30)" :key="`${change.date}-${change.domain}`">
            <strong>{{ formatCalendarDate(change.date) }} · {{ domainLabels[change.domain] }}</strong>
            <span>was {{ describeValues(change.before, change.after) }} → now {{ describeValues(change.after, change.before) }}</span>
          </li>
        </ul>
        <p v-if="preview.changes.corrections.length > 30" class="muted">And {{ preview.changes.corrections.length - 30 }} more.</p>
      </details>

      <details class="preview-section" open>
        <summary>Date coverage by domain</summary>
        <table class="coverage-table"><thead><tr><th scope="col">Domain</th><th scope="col">Dates</th><th scope="col">With values</th><th scope="col">Range</th></tr></thead>
          <tbody><tr v-for="coverage in preview.parsed.coverage" :key="coverage.domain"><th scope="row">{{ domainLabels[coverage.domain] }}</th><td>{{ coverage.dates }}</td><td>{{ coverage.datesWithValues }}</td>
            <td>{{ formatCalendarDate(coverage.firstDate) }} – {{ formatCalendarDate(coverage.lastDate) }}</td></tr></tbody></table>
        <p class="muted">Blank cells are kept as missing, never as zero. Nutrition totals are provisional workbook totals until detailed food imports are available.</p>
      </details>

      <details v-if="preview.parsed.findings.length" class="preview-section" open>
        <summary>Values needing attention ({{ preview.parsed.findings.length }})</summary>
        <ul class="plain-list"><li v-for="finding in preview.parsed.findings" :key="`${finding.row}-${finding.column}`"><strong>Row {{ finding.row }} · {{ finding.column }}: {{ finding.value }}</strong><span>{{ finding.problem }}</span></li></ul>
      </details>

      <details class="preview-section">
        <summary>Sheets in this file ({{ preview.parsed.sheets.length }})</summary>
        <ul class="plain-list"><li v-for="sheet in preview.parsed.sheets" :key="sheet.name"><strong>{{ sheet.name }}</strong><span>{{ dispositionText[sheet.disposition] }} · {{ sheet.dataRows }} rows</span></li></ul>
        <p v-if="preview.parsed.ignoredColumns.length" class="muted">Daily-sheet columns not imported: {{ preview.parsed.ignoredColumns.join(', ') }}.</p>
      </details>

      <details class="preview-section">
        <summary>Daily values to be saved ({{ preview.parsed.dates.length }} dates)</summary>
        <DailyTable :records="preview.parsed.records" :today="today" caption="Daily values in this workbook" />
      </details>

      <div class="form-footer">
        <button class="text-button" type="button" @click="cancel" :disabled="phase === 'committing'">Cancel</button>
        <button class="primary-button" type="button" @click="confirm" :disabled="phase === 'committing'">{{ phase === 'committing' ? 'Saving...' : 'Confirm import' }}</button>
      </div>
    </div>

    <div v-if="historyState === 'ready'" class="freshness">
      <h3>Saved history</h3>
      <p v-if="!history.records.length" class="field-help">Nothing imported yet.</p>
      <template v-else>
        <dl class="calendar-details">
          <div v-for="item in freshness" :key="item.domain"><dt>{{ domainLabels[item.domain] }}</dt>
            <dd>{{ item.lastValueDate ? `through ${formatCalendarDate(item.lastValueDate)}` : 'no values yet' }} · {{ item.dates }} dates</dd></div>
        </dl>
        <p v-if="lastImport" class="muted">Last import {{ formatTimestamp(lastImport.committedAt) }} ({{ lastImport.fileName }}). Version {{ history.revisionId }}.</p>
        <details class="preview-section"><summary>Import log ({{ history.imports.length }})</summary>
          <ul class="plain-list"><li v-for="item in history.imports" :key="item.id"><strong>{{ formatTimestamp(item.committedAt) }} · {{ item.fileName }}</strong>
            <span>{{ item.outcome === 'changed' ? `${item.added} added, ${item.changed} corrected, ${item.unchanged} unchanged` : 'No changes' }}<template v-if="item.firstDate"> · {{ formatCalendarDate(item.firstDate) }} – {{ formatCalendarDate(item.lastDate!) }}</template></span></li></ul>
        </details>
      </template>
    </div>
  </section>
</template>
