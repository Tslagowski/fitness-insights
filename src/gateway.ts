import type { DailyDomain, DailyRecord } from './import/workbook';
import type { FoodDay, FoodEntry, FoodSource } from './import/food';
import type { SourceKind } from './import/sources';

export type DisplayDensity = 'comfortable' | 'compact';

export interface Identity {
  id: string;
  name: string;
}

export interface Preferences {
  displayDensity: DisplayDensity;
  timezone: 'America/Denver';
  weekStartsOn: 1;
}

export interface Gateway {
  getIdentity(): Promise<Identity | null>;
  isOwner(): Promise<boolean>;
  loadPreferences(userId: string): Promise<Preferences>;
  savePreferences(userId: string, density: DisplayDensity): Promise<Preferences>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  onIdentityChange(listener: () => void): () => void;
  /** The active shared revision with its daily records, food day summaries, and recent changes. */
  loadHistory(): Promise<ImportedHistory>;
  /** The saved entries of one food day, or null if none. */
  loadFoodDay(date: string): Promise<SavedFoodDay | null>;
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

export type ClearableDomain = DailyDomain | 'food_entries';

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
}

export interface SourcesPreview extends FoodCounts {
  revisionId: number | null;
  added: number;
  changed: number;
  unchanged: number;
  keptDates: string[];
  changedFoodDates: string[];
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
  imports: ImportSummary[];
  /** The change Undo would revert next, if any. */
  undoTargetId: string | null;
}

/** The shared history changed after the preview was prepared (for example, on another device). */
export class StaleRevisionError extends Error {}

/** The requested record or change no longer exists (for example, already cleared or nothing left to undo). */
export class NothingToChangeError extends Error {}

/** Food detail and workbook totals disagree beyond the tolerance and the owner has not accepted the source winner. */
export class ReconciliationRequiredError extends Error {}

export const emptyHistory: ImportedHistory = { revisionId: null, records: [], foodDays: [], imports: [], undoTargetId: null };

export const defaultPreferences: Preferences = {
  displayDensity: 'comfortable',
  timezone: 'America/Denver',
  weekStartsOn: 1,
};
