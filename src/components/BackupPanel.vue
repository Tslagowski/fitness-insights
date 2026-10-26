<script setup lang="ts">
import { computed, ref } from 'vue';
import { CapacityError, StaleRevisionError, type Gateway, type ImportedHistory, type Preferences } from '../gateway';
import { backupFileName, BackupError, backupTables, buildBackup, chunkRows, readBackup, type BackupTable, type ParsedBackup } from '../backup/backup';
import { capacityProblem, formatBytes } from '../backup/capacity';
import { newRequestId, reportingToday } from '../import/preview';

const props = defineProps<{ gateway: Gateway; history: ImportedHistory; preferences: Preferences; reloadHistory: () => Promise<boolean> }>();
const emit = defineEmits<{ preferencesRestored: [preferences: Preferences] }>();

const labels: Record<BackupTable, string> = {
  source_files: 'Original export files', data_revisions: 'Data versions', import_batches: 'Imports, corrections, and undos', import_batch_sources: 'Import file links',
  daily_records: 'Daily records (incl. superseded)', food_days: 'Food days (incl. superseded)', workout_days: 'Workout days (incl. superseded)', reports: 'Saved reports',
  exercise_aliases: 'Exercise display names', review_decisions: 'Weigh-in review decisions', completeness_marks: 'Incomplete-day marks', exercise_muscles: 'Exercise muscle mapping', owner_notes: 'Dated notes (all versions)',
};

// Download
const downloading = ref('');
const downloadProblem = ref('');
const downloadNotice = ref('');
async function download() {
  downloadProblem.value = '';
  downloadNotice.value = '';
  try {
    downloading.value = 'Collecting your saved history…';
    const data = await props.gateway.exportBackupData();
    const archives = new Map<string, Uint8Array>();
    for (const [index, row] of data.tables.source_files.entries()) {
      downloading.value = `Adding original export files (${index + 1} of ${data.tables.source_files.length})…`;
      archives.set(String(row.storage_path), await props.gateway.downloadArchive(String(row.storage_path)));
    }
    downloading.value = 'Building the backup file…';
    const bytes = await buildBackup(data, archives, { display_density: props.preferences.displayDensity, duration_unit: props.preferences.durationUnit,
      strength_band_percent: props.preferences.strengthBandPercent,
      stall_comparisons: props.preferences.stallComparisons, secondary_set_credit: props.preferences.secondarySetCredit }, new Date().toISOString());
    const name = backupFileName(reportingToday());
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    downloadNotice.value = `Backup ready: ${name} (${formatBytes(bytes.length)}). It holds your records, history, reports, settings, and original exports, and no passwords or keys. Keep it somewhere private.`;
  } catch {
    downloadProblem.value = 'The backup could not be created because your saved data could not be read completely (the service may be paused or offline). Nothing was changed. Try again once the app loads normally; a partial backup is never offered.';
  } finally { downloading.value = ''; }
}

// Restore
const parsed = ref<ParsedBackup | null>(null);
const fileName = ref('');
const current = ref<Record<BackupTable, number> | null>(null);
const expectedRevision = ref<number | null>(null);
const restoreProblem = ref('');
const restoreNotice = ref('');
const restoring = ref('');
const checking = ref(false);
async function choose(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  restoreProblem.value = '';
  restoreNotice.value = '';
  parsed.value = null;
  if (!file) return;
  checking.value = true;
  try {
    const backup = await readBackup(new Uint8Array(await file.arrayBuffer()));
    const [capacity, counts] = await Promise.all([props.gateway.capacity(), props.gateway.workspaceCounts()]);
    const archiveBytes = [...backup.archives.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    // Staging plus restored rows can briefly need about twice the table data.
    const problem = capacityProblem(capacity, { databaseBytes: backup.tableBytes * 2, archiveBytes });
    if (problem) { restoreProblem.value = problem; return; }
    fileName.value = file.name;
    current.value = counts;
    expectedRevision.value = props.history.revisionId;
    parsed.value = backup;
  } catch (error) {
    restoreProblem.value = error instanceof BackupError ? `${error.message} Nothing was changed.` : 'The backup could not be checked against your saved data (the service may be paused or offline). Nothing was changed.';
  } finally { checking.value = false; }
}
const createdAt = computed(() => (parsed.value ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(parsed.value.manifest.created_at)) : ''));

/** True when the saved history now matches the backup exactly (a restore that committed before its response was lost). */
async function alreadyRestored(backup: ParsedBackup): Promise<boolean> {
  try {
    const [counts, history] = await Promise.all([props.gateway.workspaceCounts(), props.gateway.loadHistory()]);
    return history.revisionId === backup.manifest.workspace_state.active_revision_id && backupTables.every((table) => counts[table] === backup.manifest.counts[table]);
  } catch { return false; }
}

async function restore() {
  const backup = parsed.value;
  if (!backup || restoring.value) return;
  restoreProblem.value = '';
  const restoreId = newRequestId();
  let staged = false;
  try {
    let index = 0;
    for (const row of backup.tables.source_files) {
      restoring.value = `Storing original export files (${++index} of ${backup.tables.source_files.length})…`;
      await props.gateway.uploadArchive(String(row.storage_path), backup.archives.get(String(row.storage_path))!, String(row.media_type));
    }
    staged = true;
    const chunks = backupTables.flatMap((table) => chunkRows(backup.tables[table]).map((rows, chunk) => ({ table, chunk, rows })));
    for (const [position, item] of chunks.entries()) {
      restoring.value = `Uploading the backup (${position + 1} of ${chunks.length})…`;
      await props.gateway.stageRestoreChunk(restoreId, item.table, item.chunk, item.rows);
    }
    restoring.value = 'Replacing your saved history…';
    try {
      await props.gateway.applyRestore(restoreId, expectedRevision.value, backup.manifest, false);
    } catch (error) {
      // If the response was lost after the restore committed, the saved history already matches the backup.
      if (error instanceof StaleRevisionError || error instanceof CapacityError || !(await alreadyRestored(backup))) throw error;
    }
    let preferenceNote = '';
    try {
      const identity = await props.gateway.getIdentity();
      if (identity) {
        const saved = await props.gateway.savePreferences(identity.id, { displayDensity: backup.manifest.preferences.display_density === 'compact' ? 'compact' : 'comfortable',
          durationUnit: backup.manifest.preferences.duration_unit === 'minutes' ? 'minutes' : 'seconds', strengthBandPercent: Number(backup.manifest.preferences.strength_band_percent) || 2.5,
          stallComparisons: Number(backup.manifest.preferences.stall_comparisons) || 3, secondarySetCredit: Number(backup.manifest.preferences.secondary_set_credit) === 0.5 ? 0.5 : 0 });
        emit('preferencesRestored', saved);
      }
    } catch { preferenceNote = ' Your display preferences could not be restored; set them again below.'; }
    restoreNotice.value = `Restored from ${fileName.value}: ${backup.manifest.counts.daily_records.toLocaleString('en-US')} daily records, ${backup.manifest.counts.food_days.toLocaleString('en-US')} food days, ${backup.manifest.counts.workout_days.toLocaleString('en-US')} workout days, and ${backup.manifest.counts.reports.toLocaleString('en-US')} saved reports.${preferenceNote}`;
    parsed.value = null;
    await props.reloadHistory();
  } catch (error) {
    if (staged) { try { await props.gateway.discardRestore(restoreId); } catch { /* staging expires after a day */ } }
    restoreProblem.value = error instanceof StaleRevisionError
      ? 'Your saved history changed on another device after this preview, so nothing was replaced. Choose the backup again to review the latest state.'
      : error instanceof CapacityError ? `${error.message}`
      : `Nothing was replaced, and your saved history is unchanged. ${error instanceof Error && /incomplete/.test(error.message) ? error.message : 'The connection or the service failed during the restore; try again when the app loads normally.'}`;
    if (error instanceof StaleRevisionError) parsed.value = null;
  } finally { restoring.value = ''; }
}
</script>

<template>
  <section class="section-card backup-panel" aria-labelledby="backup-heading">
    <div class="section-heading"><div><div class="eyebrow">PORTABLE, PRIVATE</div><h2 id="backup-heading">Backup and restore</h2></div>
      <span class="outline-pill">Format 1 · ZIP</span></div>
    <p class="field-help">A backup is one ZIP file with every saved record (including superseded history), imports, review decisions, display names, saved reports, settings, and the original MacroFactor exports, each checked by a SHA-256 checksum. It contains no passwords, keys, or account ids, so it can be restored into a new installation set up for you.</p>
    <div v-if="downloadProblem" class="alert error" role="alert">{{ downloadProblem }}</div>
    <div v-if="downloadNotice" class="alert success" role="status">{{ downloadNotice }}</div>
    <button class="primary-button" type="button" :disabled="!!downloading || !!restoring" @click="download">{{ downloading || 'Download backup' }}</button>

    <div class="restore-block">
      <h3>Restore from a backup</h3>
      <p class="field-help">Restoring replaces all saved history here with the backup's. The file is fully checked first, and nothing changes until you confirm. Download a backup of the current data first if you might need it.</p>
      <div v-if="restoreProblem" class="alert error" role="alert">{{ restoreProblem }}</div>
      <div v-if="restoreNotice" class="alert success" role="status">{{ restoreNotice }}</div>
      <label class="file-picker"><span class="field-label">Backup file</span>
        <input type="file" accept=".zip,application/zip" :disabled="checking || !!restoring" aria-label="Choose a backup file" @change="choose" /></label>
      <p v-if="checking" class="field-help" role="status">Checking the backup…</p>
      <div v-if="parsed && current" class="restore-preview" role="group" aria-label="Restore preview">
        <p class="field-help"><strong>{{ fileName }}</strong>, created {{ createdAt }}. All checksums match.</p>
        <div class="table-scroll" role="region" aria-label="Current and backup contents" tabindex="0">
          <table class="period-table">
            <caption class="visually-hidden">Saved history now and in the backup</caption>
            <thead><tr><th scope="col">Contents</th><th scope="col">Now</th><th scope="col">In backup</th></tr></thead>
            <tbody><tr v-for="table in backupTables" :key="table"><th scope="row">{{ labels[table] }}</th><td>{{ current[table].toLocaleString('en-US') }}</td><td>{{ parsed.manifest.counts[table].toLocaleString('en-US') }}</td></tr></tbody>
          </table>
        </div>
        <p v-if="restoring" class="field-help" role="status">{{ restoring }}</p>
        <div class="form-footer"><button class="text-button" type="button" :disabled="!!restoring" @click="parsed = null">Cancel</button>
          <button class="primary-button" type="button" :disabled="!!restoring" @click="restore">Replace with this backup</button></div>
      </div>
    </div>
  </section>
</template>
