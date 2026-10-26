/**
 * Ticket 12: a portable, self-contained backup file.
 *
 * A ZIP containing manifest.json, one JSON file per table (every retained row, including superseded
 * history, import provenance, review decisions, aliases, and saved reports), and the original export
 * files under archives/. The manifest records the format version, row counts, the active and retained
 * revisions, display preferences, and a SHA-256 for every file. No credentials, keys, or user ids are
 * included, so the file can be restored into any installation configured for its owner.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const backupFormat = 'fitness-insights-backup';
export const backupFormatVersion = 1;
export const backupTables = ['source_files', 'data_revisions', 'import_batches', 'import_batch_sources', 'daily_records', 'food_days', 'workout_days',
  'reports', 'exercise_aliases', 'review_decisions', 'completeness_marks', 'exercise_muscles', 'owner_notes'] as const;
/** Tables added after format 1 was first written; a backup made before them restores them empty. */
export const optionalBackupTables: readonly BackupTable[] = ['exercise_muscles', 'owner_notes'];
export type BackupTable = (typeof backupTables)[number];
export type TableRows = Record<BackupTable, Array<Record<string, unknown>>>;

export interface BackupData {
  schemaVersion: number;
  tables: TableRows;
  workspaceState: { active_revision_id: number | null; retained_from_revision_id: number | null };
}

export interface BackupPreferences { display_density: string; duration_unit: string; strength_band_percent: number; stall_comparisons?: number; secondary_set_credit?: number }

export interface BackupManifest {
  format: typeof backupFormat;
  format_version: number;
  schema_version: number;
  created_at: string;
  counts: Record<BackupTable, number>;
  workspace_state: BackupData['workspaceState'];
  preferences: BackupPreferences;
  /** SHA-256 and size of every other file in the ZIP. */
  files: Record<string, { sha256: string; bytes: number }>;
}

export interface ParsedBackup {
  manifest: BackupManifest;
  tables: TableRows;
  /** Original exports by storage path (for example workbooks/<sha256>.xlsx). */
  archives: Map<string, Uint8Array>;
  /** Approximate size of the table data once stored. */
  tableBytes: number;
}

export class BackupError extends Error {}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function backupFileName(date: string): string { return `fitness-insights-backup-${date}.zip`; }

export async function buildBackup(data: BackupData, archives: Map<string, Uint8Array>, preferences: BackupPreferences, createdAt: string): Promise<Uint8Array> {
  const contents: Record<string, Uint8Array> = {};
  for (const table of backupTables) contents[`tables/${table}.json`] = strToU8(JSON.stringify(data.tables[table] ?? []));
  for (const row of data.tables.source_files) {
    const path = String(row.storage_path);
    const bytes = archives.get(path);
    if (!bytes) throw new BackupError(`The original export ${String(row.file_name)} could not be included.`);
    contents[`archives/${path}`] = bytes;
  }
  const files: BackupManifest['files'] = {};
  for (const [name, bytes] of Object.entries(contents)) files[name] = { sha256: await sha256(bytes), bytes: bytes.length };
  const manifest: BackupManifest = {
    format: backupFormat, format_version: backupFormatVersion, schema_version: data.schemaVersion, created_at: createdAt,
    counts: Object.fromEntries(backupTables.map((table) => [table, (data.tables[table] ?? []).length])) as Record<BackupTable, number>,
    workspace_state: data.workspaceState, preferences, files,
  };
  // Already-compressed workbooks are stored; JSON and CSV are deflated.
  const zipInput: Record<string, [Uint8Array, { level: 0 | 6 }]> = { 'manifest.json': [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }] };
  for (const [name, bytes] of Object.entries(contents)) zipInput[name] = [bytes, { level: name.endsWith('.xlsx') ? 0 : 6 }];
  return zipSync(zipInput);
}

/** Opens and fully verifies a backup before anything is uploaded. Throws BackupError with an owner-readable reason. */
export async function readBackup(bytes: Uint8Array): Promise<ParsedBackup> {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new BackupError('This file is not a Fitness Insights backup (it is not a readable ZIP file).'); }
  if (!files['manifest.json']) throw new BackupError('This file is not a Fitness Insights backup (manifest.json is missing).');
  let manifest: BackupManifest;
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])); } catch { throw new BackupError('The backup manifest is damaged.'); }
  if (manifest.format !== backupFormat) throw new BackupError('This file is not a Fitness Insights backup.');
  if (manifest.format_version !== backupFormatVersion || manifest.schema_version !== 1) {
    throw new BackupError(`This backup uses format ${manifest.format_version}, which this version of the app cannot restore.`);
  }
  for (const [name, expected] of Object.entries(manifest.files ?? {})) {
    const content = files[name];
    if (!content) throw new BackupError(`The backup is incomplete: ${name} is missing.`);
    if (content.length !== expected.bytes || (await sha256(content)) !== expected.sha256) throw new BackupError(`The backup is damaged: ${name} does not match its checksum.`);
  }
  const unexpected = Object.keys(files).filter((name) => name !== 'manifest.json' && !(name in manifest.files));
  if (unexpected.length) throw new BackupError(`The backup contains unexpected files (${unexpected.slice(0, 3).join(', ')}).`);

  const tables = {} as TableRows;
  let tableBytes = 0;
  for (const table of backupTables) {
    const name = `tables/${table}.json`;
    if (!files[name] && optionalBackupTables.includes(table) && manifest.counts?.[table] === undefined) {
      tables[table] = [];
      manifest.counts = { ...manifest.counts, [table]: 0 };
      continue;
    }
    if (!files[name]) throw new BackupError(`The backup is incomplete: ${name} is missing.`);
    let rows: unknown;
    try { rows = JSON.parse(strFromU8(files[name])); } catch { throw new BackupError(`The backup is damaged: ${name} is not valid.`); }
    if (!Array.isArray(rows) || rows.length !== manifest.counts?.[table]) throw new BackupError(`The backup is inconsistent: ${table} does not have the expected ${manifest.counts?.[table] ?? 0} rows.`);
    tables[table] = rows as Array<Record<string, unknown>>;
    tableBytes += files[name].length;
  }
  const archives = new Map<string, Uint8Array>();
  for (const row of tables.source_files) {
    const path = String(row.storage_path);
    const content = files[`archives/${path}`];
    if (!content) throw new BackupError(`The backup is incomplete: the original export ${String(row.file_name)} is missing.`);
    if ((await sha256(content)) !== row.sha256) throw new BackupError(`The backup is damaged: ${String(row.file_name)} does not match its recorded fingerprint.`);
    archives.set(path, content);
  }
  return { manifest, tables, archives, tableBytes };
}

/** Splits rows into upload chunks bounded by row count and approximate JSON size. */
export function chunkRows<T>(rows: T[], maxRows = 500, maxBytes = 1_000_000): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const row of rows) {
    const rowSize = JSON.stringify(row).length;
    if (current.length && (current.length >= maxRows || size + rowSize > maxBytes)) { chunks.push(current); current = []; size = 0; }
    current.push(row);
    size += rowSize;
  }
  if (current.length || !chunks.length) chunks.push(current);
  return chunks;
}
