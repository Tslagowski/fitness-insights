import type { DailyDomain, DailyRecord } from './import/workbook';
import type { FoodDay, FoodEntry, FoodSource } from './import/food';
import type { SourceKind } from './import/sources';
import type { DurationUnit, WorkoutDay, WorkoutSet, WorkoutSource } from './import/workout';
import { emptyReviewState, type CompletenessStatus, type ReviewChoice, type ReviewState } from './analysis/eligibility';
import type { WrittenReport } from './analysis/report';
import type { BackupData, BackupManifest, BackupTable } from './backup/backup';
import type { CapacityStatus } from './backup/capacity';

export type DisplayDensity = 'comfortable' | 'compact';

export interface Identity {
  id: string;
  name: string;
}

export interface Preferences {
  displayDensity: DisplayDensity;
  timezone: 'America/Denver';
  weekStartsOn: 1;
  /** Provisional interpretation of exported duration values (unverified against the source app). */
  durationUnit: DurationUnit;
  /** Exercise progress label band in percent: above +band Progressing, below -band Declining (accepted default 2.5). */
  strengthBandPercent: number;
}

export type PreferenceChanges = Partial<Pick<Preferences, 'displayDensity' | 'durationUnit' | 'strengthBandPercent'>>;

export interface Gateway {
  getIdentity(): Promise<Identity | null>;
  isOwner(): Promise<boolean>;
  loadPreferences(userId: string): Promise<Preferences>;
  savePreferences(userId: string, changes: PreferenceChanges): Promise<Preferences>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  onIdentityChange(listener: () => void): () => void;
  /** The active shared revision with its daily records, food day summaries, and recent changes. */
  loadHistory(): Promise<ImportedHistory>;
  /** The saved entries of one food day, or null if none. */
  loadFoodDay(date: string): Promise<SavedFoodDay | null>;
  /** The saved sets of one workout day, or null if none. */
  loadWorkoutDay(date: string): Promise<SavedWorkoutDay | null>;
  /** Every active workout day with its sets, oldest first (for exercise analysis). */
  loadWorkoutHistory(): Promise<SavedWorkoutDay[]>;
  /** Saves a generated report for the active revision; the same fingerprint is saved only once. */
  saveReport(report: WrittenReport, fingerprint: string): Promise<{ id: string; createdAt: string; replayed: boolean }>;
  /** Saved reports, newest first (metadata only). */
  listReports(): Promise<SavedReportSummary[]>;
  /** One saved report with its stored inputs and content, or null if it no longer exists. */
  loadReport(id: string): Promise<SavedReport | null>;
  /** What retention would remove (dry run), or removes it when apply is true. */
  retention(expectedRevisionId: number | null, apply: boolean): Promise<RetentionSummary>;
  /** Database and archive usage against the free-tier limits. */
  capacity(): Promise<CapacityStatus>;
  /** Row counts per backed-up table. */
  workspaceCounts(): Promise<Record<BackupTable, number>>;
  /** Every backed-up table row, the active and retained revisions, with no user ids. */
  exportBackupData(): Promise<BackupData>;
  /** One original export from the private archive. */
  downloadArchive(path: string): Promise<Uint8Array>;
  /** Stores an original export at its content-addressed path; an existing identical file is fine. */
  uploadArchive(path: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  /** Uploads one chunk of a restore to private staging (retrying a chunk replaces it). */
  stageRestoreChunk(restoreId: string, table: BackupTable, chunk: number, rows: Array<Record<string, unknown>>): Promise<void>;
  /** Validates staged rows against the manifest and, unless dryRun, replaces all saved history atomically. */
  applyRestore(restoreId: string, expectedRevisionId: number | null, manifest: BackupManifest, dryRun: boolean): Promise<Record<BackupTable, number>>;
  /** Removes a restore's staged chunks. */
  discardRestore(restoreId: string): Promise<void>;
  /** Owner-reviewed cleanup of restore uploads that were never applied (older than ten minutes). */
  discardStaleRestores(): Promise<{ removedUploads: number }>;
  /** Sets (or, with null, removes) the cosmetic display name for a logged exercise name. Raw records are unchanged. */
  saveExerciseAlias(sourceName: string, displayName: string | null): Promise<void>;
  /** Records the owner's decision about one specific saved value (latest decision wins). */
  saveReviewDecision(decision: { date: string; domain: 'scale_weight'; field: string; value: number; decision: ReviewChoice }): Promise<void>;
  /** Marks a date's nutrition logging incomplete (or complete again). */
  saveCompleteness(mark: { date: string; domain: 'nutrition'; status: CompletenessStatus }): Promise<void>;
  /** Compares an import with saved history on the server (food detail and reconciliation) without changing anything. */
  previewSources(request: SourcesRequest): Promise<SourcesPreview>;
  /** Archives the raw files privately, then atomically commits the import. Safe to retry with the same request id. */
  commitSources(request: SourcesCommitRequest): Promise<SourcesResult>;
  /** Removes one domain's saved record (or a day's food entries) for one date. Safe to retry with the same request id. */
  clearDay(request: ClearDayRequest): Promise<ChangeResult>;
  /** Describes what Undo would restore, without changing anything. */
  previewUndo(expectedRevisionId: number | null): Promise<UndoPreview>;
  /** Reverts the latest import or correction that has not been undone. Safe to retry with the same request id. */
  undoLastChange(request: { requestId: string; expectedRevisionId: number | null }): Promise<ChangeResult>;
}

export type ClearableDomain = DailyDomain | 'food_entries' | 'workout_sets';

export interface ClearDayRequest {
  requestId: string;
  expectedRevisionId: number | null;
  date: string;
  domain: ClearableDomain;
}

export interface ChangeResult {
  outcome: 'changed' | 'unchanged';
  replayed: boolean;
  revisionId: number | null;
  added: number;
  changed: number;
  removed: number;
}

export interface UndoPreview {
  targetId: string;
  targetKind: ChangeKind;
  targetCommittedAt: string;
  restoresRevisionId: number | null;
  added: number;
  changed: number;
  removed: number;
  firstDate: string | null;
  lastDate: string | null;
}

export type ChangeKind = 'workbook' | 'import' | 'clear' | 'undo';

export interface SourceFile {
  name: string;
  kind: SourceKind;
  sha256: string;
  byteSize: number;
  mediaType: string;
  bytes: Uint8Array;
}

export interface SourcesRequest {
  expectedRevisionId: number | null;
  sources: SourceFile[];
  daily: DailyRecord[];
  food: FoodDay[];
  workouts: WorkoutDay[];
}

export interface SourcesCommitRequest extends SourcesRequest {
  requestId: string;
  /** The owner accepted the food detail as the intake source on the dates listed as conflicts. */
  acceptReconciliation: boolean;
}

export interface CalorieConflict {
  date: string;
  detailCalories: number;
  workbookCalories: number;
  difference: number;
}

export interface FoodCounts {
  foodAdded: number;
  foodChanged: number;
  foodUnchanged: number;
  /** Workbook Food Log days not applied because saved food CSV detail has precedence. */
  foodKept: number;
  workoutAdded: number;
  workoutChanged: number;
  workoutUnchanged: number;
  /** Workbook Workout Log days not applied because saved workout CSV detail has precedence. */
  workoutKept: number;
}

export interface SourcesPreview extends FoodCounts {
  revisionId: number | null;
  added: number;
  changed: number;
  unchanged: number;
  keptDates: string[];
  changedFoodDates: string[];
  keptWorkoutDates: string[];
  changedWorkoutDates: string[];
  conflicts: CalorieConflict[];
}

export interface SourcesResult extends FoodCounts {
  outcome: 'changed' | 'unchanged';
  replayed: boolean;
  revisionId: number | null;
  added: number;
  changed: number;
  unchanged: number;
  conflicts: CalorieConflict[];
}

export interface StoredDailyRecord extends DailyRecord {
  sourceFileId: string;
  revisionId: number;
}

export interface FoodDaySummary {
  date: string;
  source: FoodSource;
  entries: number;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  /** Entries without a recorded calorie value. */
  missingCalories: number;
  revisionId: number;
}

export interface SavedFoodDay {
  date: string;
  source: FoodSource;
  entries: FoodEntry[];
  revisionId: number;
}

export interface WorkoutDaySummary {
  date: string;
  source: WorkoutSource;
  sets: number;
  exercises: number;
  /** Distinct workout names logged that day. */
  workouts: string[];
  /** Distinct raw "Workout Duration" values (unit unverified). */
  durations: number[];
  revisionId: number;
}

export interface SavedWorkoutDay {
  date: string;
  source: WorkoutSource;
  sets: WorkoutSet[];
  revisionId: number;
}

export interface ExerciseName {
  name: string;
  sets: number;
  days: number;
}

export interface ImportSummary extends FoodCounts {
  id: string;
  kind: ChangeKind;
  removed: number;
  clearedDate: string | null;
  clearedDomain: ClearableDomain | null;
  undoesId: string | null;
  /** True when a later Undo reverted this change. */
  undone: boolean;
  committedAt: string;
  outcome: 'changed' | 'unchanged';
  revisionId: number | null;
  added: number;
  changed: number;
  unchanged: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Names of the source files (empty for corrections and undos). */
  fileNames: string[];
  reconciliation: CalorieConflict[];
}

export interface ImportedHistory {
  revisionId: number | null;
  records: StoredDailyRecord[];
  foodDays: FoodDaySummary[];
  workoutDays: WorkoutDaySummary[];
  /** Every logged exercise name with its set and day counts. */
  exerciseNames: ExerciseName[];
  /** Logged exercise name -> owner-chosen display name. */
  aliases: Record<string, string>;
  imports: ImportSummary[];
  /** The change Undo would revert next, if any. */
  undoTargetId: string | null;
  /** The owner's review decisions and completeness marks (not part of import revisions). */
  review: ReviewState;
}

/** The shared history changed after the preview was prepared (for example, on another device). */
export interface SavedReportSummary {
  id: string;
  createdAt: string;
  revisionId: number | null;
  reportDate: string;
  periodEnd: string | null;
  templateVersion: string;
  fingerprint: string;
}

export interface SavedReport extends SavedReportSummary { content: WrittenReport }

export interface RetentionSummary {
  dryRun: boolean;
  revisions: number;
  keep: number;
  /** Oldest revision kept (null when there are not yet more versions than are retained). */
  keepFromRevisionId: number | null;
  retainedFromRevisionId: number | null;
  dailyRecords: number;
  foodDays: number;
  workoutDays: number;
  reports: number;
}

export class StaleRevisionError extends Error {}
/** Undo would need a version older than the retained window. */
export class RetentionLimitError extends Error {}
/** The database refused new data because the free-tier limit is nearly reached; nothing was saved. */
export class CapacityError extends Error {}

/** The requested record or change no longer exists (for example, already cleared or nothing left to undo). */
export class NothingToChangeError extends Error {}

/** Food detail and workbook totals disagree beyond the tolerance and the owner has not accepted the source winner. */
export class ReconciliationRequiredError extends Error {}

export const emptyHistory: ImportedHistory = { revisionId: null, records: [], foodDays: [], workoutDays: [], exerciseNames: [], aliases: {}, imports: [], undoTargetId: null, review: emptyReviewState };

export const defaultPreferences: Preferences = {
  displayDensity: 'comfortable',
  timezone: 'America/Denver',
  weekStartsOn: 1,
  durationUnit: 'seconds',
  strengthBandPercent: 2.5,
};
