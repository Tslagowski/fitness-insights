<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  ReconciliationRequiredError, StaleRevisionError, type Gateway, type ImportedHistory, type SourceFile, type SourcesPreview, type SourcesResult,
} from '../gateway';
import { domainLabels, type SheetDisposition } from '../import/workbook';
import { foodSourceLabels } from '../import/food';
import { ImportPlanError, planImport, type ImportPlan, type SourceKind } from '../import/sources';
import {
  domainFreshness, formatCalendarDate, formatValue, newRequestId, plural, proposeChanges, reportingToday, sha256Hex, type ProposedChanges,
} from '../import/preview';
import DailyTable from './DailyTable.vue';

const props = defineProps<{
  gateway: Gateway;
  history: ImportedHistory;
  historyState: 'loading' | 'ready' | 'error';
  reloadHistory: () => Promise<boolean>;
}>();

interface Preview {
  plan: ImportPlan;
  sources: SourceFile[];
  requestId: string;
  baseRevisionId: number | null;
  daily: ProposedChanges;
  server: SourcesPreview;
}

const maximumFileBytes = 20 * 1024 * 1024;
const phase = ref<'idle' | 'reading' | 'preview' | 'committing'>('idle');
const preview = ref<Preview | null>(null);
const accepted = ref(false);
const problem = ref('');
const outcome = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const today = computed(() => reportingToday());
const freshness = computed(() => domainFreshness(props.history));
const lastImport = computed(() => props.history.imports.find((item) => item.kind === 'workbook' || item.kind === 'import') ?? null);
const foodFreshness = computed(() => {
  const days = props.history.foodDays;
  const past = days.filter((day) => day.date <= today.value);
  return { days: days.length, planned: days.length - past.length, lastDate: past.at(-1)?.date ?? null };
});
const keptDates = computed(() => {
  if (!preview.value) return 0;
  const imported = new Set([...(preview.value.plan.daily?.dates ?? []), ...(preview.value.plan.food?.days.map((day) => day.date) ?? [])]);
  const saved = new Set([...props.history.records.map((record) => record.date), ...props.history.foodDays.map((day) => day.date)]);
  return [...saved].filter((date) => !imported.has(date)).length;
});
const foodSummary = computed(() => {
  const food = preview.value?.plan.food;
  if (!food) return null;
  const dates = food.days.map((day) => day.date);
  return {
    first: dates[0], last: dates[dates.length - 1], days: dates.length,
    csvDays: food.days.filter((day) => day.source === 'food_csv').length,
    workbookDays: food.days.filter((day) => day.source === 'workbook_food_log').length,
    planned: food.days.filter((day) => day.date > today.value),
  };
});
const needsAcceptance = computed(() => (preview.value?.server.conflicts.length ?? 0) > 0);

const kindLabels: Record<SourceKind, string> = { workbook: 'Workbook (.xlsx)', food_csv: 'Food CSV' };
const dispositionText: Record<SheetDisposition, string> = {
  imported: 'Imported: daily history',
  'food-detail': 'Food entries: used for dates without a food CSV',
  'later-workouts': 'Not imported yet: workout sets (workout import)',
  archived: 'Archived with the raw file; not analyzed',
  unrecognized: 'Unrecognized; archived with the raw file only',
};

watch(() => props.history.revisionId, () => {
  // The shared history moved while a preview was open: rebuild the comparison against the latest version.
  if (preview.value && phase.value === 'preview' && preview.value.baseRevisionId !== props.history.revisionId) void refreshPreview(preview.value.plan, preview.value.sources);
});

async function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;
  problem.value = '';
  outcome.value = '';
  preview.value = null;
  accepted.value = false;
  phase.value = 'reading';
  try {
    if (files.some((file) => file.size > maximumFileBytes)) throw new ImportPlanError('A file is larger than 20 MB. Export a smaller date range and try again. Nothing was changed.');
    const selected = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    const plan = planImport(selected);
    const sources = await Promise.all(plan.sources.map(async (source) => ({
      name: source.name, kind: source.kind, byteSize: source.byteSize, mediaType: source.mediaType, bytes: source.bytes, sha256: await sha256Hex(source.bytes),
    })));
    await refreshPreview(plan, sources);
  } catch (error) {
    phase.value = 'idle';
    problem.value = error instanceof ImportPlanError || (error instanceof Error && error.message.includes('secure'))
      ? error.message
      : 'These files could not be compared with your saved history. Check your connection and try again. Nothing was changed.';
  } finally {
    input.value = '';
  }
}

async function refreshPreview(plan: ImportPlan, sources: SourceFile[]) {
  const baseRevisionId = props.history.revisionId;
  const server = await props.gateway.previewSources({ expectedRevisionId: baseRevisionId, sources, daily: plan.daily?.records ?? [], food: plan.food?.days ?? [] });
  preview.value = { plan, sources, requestId: newRequestId(), baseRevisionId, daily: proposeChanges(plan.daily?.records ?? [], props.history), server };
  accepted.value = false;
  phase.value = 'preview';
}

function cancel() {
  preview.value = null;
  problem.value = '';
  phase.value = 'idle';
}

async function confirm() {
  if (!preview.value || phase.value === 'committing' || (needsAcceptance.value && !accepted.value)) return;
  const current = preview.value;
  phase.value = 'committing';
  problem.value = '';
  try {
    const result = await props.gateway.commitSources({
      requestId: current.requestId, expectedRevisionId: current.baseRevisionId, sources: current.sources,
      daily: current.plan.daily?.records ?? [], food: current.plan.food?.days ?? [], acceptReconciliation: accepted.value,
    });
    preview.value = null;
    phase.value = 'idle';
    outcome.value = describeResult(result);
    if (!(await props.reloadHistory())) outcome.value += ' Refresh the page to see the updated history.';
  } catch (error) {
    phase.value = 'preview';
    if (error instanceof StaleRevisionError || error instanceof ReconciliationRequiredError) {
      problem.value = 'Your saved history changed after this preview was prepared, possibly on another device. Nothing was overwritten. The preview below has been refreshed; review it and confirm again.';
      if (await props.reloadHistory()) {
        try { await refreshPreview(current.plan, current.sources); } catch { /* keep the message; the user can re-select the files */ }
      }
    } else {
      problem.value = 'The import was not saved, and your previous history is unchanged. Check your connection (or resume a paused Supabase project) and press Confirm import again. Retrying cannot create a duplicate.';
    }
  }
}

function describeResult(result: SourcesResult): string {
  if (result.outcome === 'unchanged') return 'No changes: these files match your saved history, so no new version was created.';
  const parts: string[] = [];
  if (result.added + result.changed + result.unchanged) parts.push(`daily records ${result.added} added, ${result.changed} corrected, ${result.unchanged} unchanged`);
  if (result.foodAdded + result.foodChanged + result.foodUnchanged + result.foodKept) parts.push(`food days ${result.foodAdded} added, ${result.foodChanged} replaced, ${result.foodUnchanged} unchanged`);
  return `Import confirmed: ${parts.join('; ')} (version ${result.revisionId}).`;
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

function chooseFiles() { fileInput.value?.click(); }
</script>

<template>
  <section class="section-card import-card" aria-labelledby="import-heading">
    <div class="section-heading"><div><div class="eyebrow">BRING IN YOUR HISTORY</div><h2 id="import-heading">Import MacroFactor exports</h2></div>
      <span class="outline-pill">Workbook and food CSV</span></div>
    <p class="field-help">Choose the .xlsx workbook, the food CSV, or both at once. You'll review every date and change before anything is saved. The raw files are kept privately with your account.</p>

    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <div v-if="outcome" class="alert success" role="status">{{ outcome }}</div>

    <div v-if="phase === 'idle' || phase === 'reading'" class="file-picker">
      <input ref="fileInput" id="import-files" class="visually-hidden" type="file" multiple
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        aria-label="MacroFactor export files" @change="selectFiles" :disabled="phase === 'reading' || historyState !== 'ready'" />
      <button class="primary-button" type="button" @click="chooseFiles" :disabled="phase === 'reading' || historyState !== 'ready'">
        {{ phase === 'reading' ? 'Reading and comparing...' : 'Choose files' }} <span aria-hidden="true">&uarr;</span></button>
      <span v-if="historyState === 'loading'" class="muted">Loading your saved history first...</span>
      <span v-else-if="historyState === 'error'" class="muted">Imports are paused until your saved history loads.</span>
    </div>

    <div v-if="preview && (phase === 'preview' || phase === 'committing')" class="import-preview">
      <ul class="plain-list preview-files" aria-label="Selected files">
        <li v-for="source in preview.sources" :key="source.sha256"><strong>{{ source.name }}</strong><span>{{ kindLabels[source.kind] }} · {{ formatBytes(source.byteSize) }}</span></li>
      </ul>

      <div class="change-summary" aria-label="Proposed changes">
        <div v-if="preview.plan.daily"><span class="change-count">{{ preview.server.added }}</span><span>new daily {{ preview.server.added === 1 ? 'record' : 'records' }}</span></div>
        <div v-if="preview.plan.daily"><span class="change-count">{{ preview.server.changed }}</span><span>{{ preview.server.changed === 1 ? 'correction' : 'corrections' }} to saved daily records</span></div>
        <div v-if="preview.plan.food"><span class="change-count">{{ preview.server.foodAdded }}</span><span>new food {{ preview.server.foodAdded === 1 ? 'day' : 'days' }}</span></div>
        <div v-if="preview.plan.food"><span class="change-count">{{ preview.server.foodChanged }}</span><span>food {{ preview.server.foodChanged === 1 ? 'day' : 'days' }} replaced with newer entries</span></div>
        <div><span class="change-count">{{ preview.server.unchanged + preview.server.foodUnchanged }}</span><span>already saved, unchanged</span></div>
      </div>
      <p v-if="keptDates" class="field-help">{{ keptDates }} saved {{ keptDates === 1 ? 'date is' : 'dates are' }} not in these files and will stay exactly as {{ keptDates === 1 ? 'it is' : 'they are' }}.</p>
      <p v-if="preview.server.foodKept" class="field-help">{{ preview.server.foodKept }} {{ preview.server.foodKept === 1 ? 'date keeps its' : 'dates keep their' }} saved food CSV entries; the workbook's Food Log never replaces CSV detail.</p>
      <p v-if="preview.server.added + preview.server.changed + preview.server.foodAdded + preview.server.foodChanged === 0" class="field-help">Everything in these files matches your saved history. Confirming records the upload but creates no new version.</p>

      <div v-if="needsAcceptance" class="confirm-box" role="group" aria-label="Calorie differences">
        <p><strong>Food detail and workbook totals disagree on {{ preview.server.conflicts.length }} {{ preview.server.conflicts.length === 1 ? 'date' : 'dates' }}</strong> by more than max(5 kcal, 1%).
          Daily intake will use the food detail; the workbook total is kept as evidence and never added to it.</p>
        <ul class="plain-list"><li v-for="conflict in preview.server.conflicts.slice(0, 20)" :key="conflict.date">
          <span>{{ formatCalendarDate(conflict.date) }}: detail {{ formatValue(conflict.detailCalories, 0) }} kcal vs workbook {{ formatValue(conflict.workbookCalories, 0) }} kcal ({{ conflict.difference > 0 ? '+' : '' }}{{ formatValue(conflict.difference, 0) }})</span></li></ul>
        <p v-if="preview.server.conflicts.length > 20" class="muted">And {{ preview.server.conflicts.length - 20 }} more.</p>
        <label class="check-label"><input type="checkbox" v-model="accepted" :disabled="phase === 'committing'" /> Use the food detail as the intake source for these dates</label>
      </div>
      <p v-else-if="preview.plan.food && (preview.plan.daily || history.records.length)" class="field-help">Food detail and workbook calorie totals agree within max(5 kcal, 1%) on every affected date.</p>

      <details v-if="preview.daily.corrections.length" class="preview-section" open>
        <summary>Daily corrections ({{ preview.daily.corrections.length }})</summary>
        <ul class="plain-list">
          <li v-for="change in preview.daily.corrections.slice(0, 30)" :key="`${change.date}-${change.domain}`">
            <strong>{{ formatCalendarDate(change.date) }} · {{ domainLabels[change.domain] }}</strong>
            <span>was {{ describeValues(change.before, change.after) }} → now {{ describeValues(change.after, change.before) }}</span>
          </li>
        </ul>
        <p v-if="preview.daily.corrections.length > 30" class="muted">And {{ preview.daily.corrections.length - 30 }} more.</p>
      </details>

      <details v-if="foodSummary && preview.plan.food" class="preview-section" open>
        <summary>Food entries ({{ plural(preview.plan.food.entries, 'entry', 'entries') }} on {{ plural(foodSummary.days, 'day') }})</summary>
        <p class="field-help">{{ formatCalendarDate(foodSummary.first) }} – {{ formatCalendarDate(foodSummary.last) }} · {{ plural(foodSummary.csvDays, 'day') }} from the {{ foodSourceLabels.food_csv }}<template v-if="foodSummary.workbookDays">, {{ foodSummary.workbookDays }} from the {{ foodSourceLabels.workbook_food_log }}</template>.
          Entries are kept exactly as exported, in order, including identical repeats.</p>
        <p v-if="preview.plan.food.overriddenWorkbookDates.length" class="muted">The food CSV replaces the workbook Food Log on {{ preview.plan.food.overriddenWorkbookDates.length }} {{ preview.plan.food.overriddenWorkbookDates.length === 1 ? 'date' : 'dates' }} it covers.</p>
        <p v-if="foodSummary.planned.length" class="muted">{{ foodSummary.planned.length }} {{ foodSummary.planned.length === 1 ? 'day is' : 'days are' }} after today ({{ formatCalendarDate(foodSummary.planned[0].date) }} onward): saved as planned entries and not counted as eaten.</p>
        <p v-if="preview.server.changedFoodDates.length" class="muted">Replaced food days: {{ preview.server.changedFoodDates.slice(0, 10).map((date) => formatCalendarDate(date)).join(', ') }}<template v-if="preview.server.changedFoodDates.length > 10"> and {{ preview.server.changedFoodDates.length - 10 }} more</template>.</p>
      </details>

      <details v-if="preview.plan.daily" class="preview-section">
        <summary>Daily date coverage by domain</summary>
        <table class="coverage-table"><thead><tr><th scope="col">Domain</th><th scope="col">Dates</th><th scope="col">With values</th><th scope="col">Range</th></tr></thead>
          <tbody><tr v-for="coverage in preview.plan.daily.coverage" :key="coverage.domain"><th scope="row">{{ domainLabels[coverage.domain] }}</th><td>{{ coverage.dates }}</td><td>{{ coverage.datesWithValues }}</td>
            <td>{{ formatCalendarDate(coverage.firstDate) }} – {{ formatCalendarDate(coverage.lastDate) }}</td></tr></tbody></table>
        <p class="muted">Blank cells are kept as missing, never as zero.</p>
      </details>

      <details v-if="(preview.plan.daily?.findings.length ?? 0) + (preview.plan.food?.findings.length ?? 0)" class="preview-section" open>
        <summary>Values needing attention ({{ (preview.plan.daily?.findings.length ?? 0) + (preview.plan.food?.findings.length ?? 0) }})</summary>
        <ul class="plain-list">
          <li v-for="finding in preview.plan.daily?.findings ?? []" :key="`d-${finding.row}-${finding.column}`"><strong>{{ finding.sheet }} row {{ finding.row }} · {{ finding.column }}: {{ finding.value }}</strong><span>{{ finding.problem }}</span></li>
          <li v-for="finding in (preview.plan.food?.findings ?? []).slice(0, 50)" :key="`f-${finding.source}-${finding.row}-${finding.column}`"><strong>{{ finding.source }} row {{ finding.row }} · {{ finding.column }}: {{ finding.value }}</strong><span>{{ finding.problem }}</span></li>
        </ul>
      </details>

      <details v-if="preview.plan.daily" class="preview-section">
        <summary>Sheets in the workbook ({{ preview.plan.daily.sheets.length }})</summary>
        <ul class="plain-list"><li v-for="sheet in preview.plan.daily.sheets" :key="sheet.name"><strong>{{ sheet.name }}</strong><span>{{ dispositionText[sheet.disposition] }} · {{ sheet.dataRows }} rows</span></li></ul>
        <p v-if="preview.plan.daily.ignoredColumns.length" class="muted">Daily-sheet columns not imported: {{ preview.plan.daily.ignoredColumns.join(', ') }}.</p>
      </details>

      <details v-if="preview.plan.daily" class="preview-section">
        <summary>Daily values to be saved ({{ preview.plan.daily.dates.length }} dates)</summary>
        <DailyTable :records="preview.plan.daily.records" :food-days="[]" :today="today" caption="Daily values in this workbook" />
      </details>

      <div class="form-footer">
        <button class="text-button" type="button" @click="cancel" :disabled="phase === 'committing'">Cancel</button>
        <button class="primary-button" type="button" @click="confirm" :disabled="phase === 'committing' || (needsAcceptance && !accepted)">{{ phase === 'committing' ? 'Saving...' : 'Confirm import' }}</button>
      </div>
    </div>

    <div v-if="historyState === 'ready'" class="freshness">
      <h3>Saved history</h3>
      <p v-if="!history.records.length && !history.foodDays.length" class="field-help">Nothing imported yet.</p>
      <template v-else>
        <dl class="calendar-details">
          <div v-for="item in freshness" :key="item.domain"><dt>{{ domainLabels[item.domain] }}</dt>
            <dd>{{ item.lastValueDate ? `through ${formatCalendarDate(item.lastValueDate)}` : 'no values yet' }} · {{ item.dates }} dates</dd></div>
          <div><dt>Food entries</dt>
            <dd>{{ foodFreshness.lastDate ? `through ${formatCalendarDate(foodFreshness.lastDate)}` : 'none yet' }} · {{ plural(foodFreshness.days, 'day') }}<template v-if="foodFreshness.planned"> ({{ foodFreshness.planned }} planned)</template></dd></div>
        </dl>
        <p v-if="lastImport" class="muted">Last import {{ formatTimestamp(lastImport.committedAt) }} ({{ lastImport.fileNames.join(' + ') }}). Version {{ history.revisionId }}.</p>
      </template>
    </div>
  </section>
</template>
