import type { DailyDomain, DailyRecord } from './import/workbook';

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
  /** The active shared revision with its daily records and recent imports. */
  loadHistory(): Promise<ImportedHistory>;
  /** Archives the raw file privately, then atomically commits the previewed records. Safe to retry with the same request id. */
  commitImport(request: ImportCommitRequest): Promise<ImportCommitResult>;
  /** Removes one domain's saved record for one date. Safe to retry with the same request id. */
  clearDay(request: ClearDayRequest): Promise<ChangeResult>;
  /** Describes what Undo would restore, without changing anything. */
  previewUndo(expectedRevisionId: number | null): Promise<UndoPreview>;
  /** Reverts the latest import or correction that has not been undone. Safe to retry with the same request id. */
  undoLastChange(request: { requestId: string; expectedRevisionId: number | null }): Promise<ChangeResult>;
}

export interface ClearDayRequest {
  requestId: string;
  expectedRevisionId: number | null;
  date: string;
  domain: DailyDomain;
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

export type ChangeKind = 'workbook' | 'clear' | 'undo';

export interface StoredDailyRecord extends DailyRecord {
  sourceFileId: string;
  revisionId: number;
}

export interface ImportSummary {
  id: string;
  kind: ChangeKind;
  removed: number;
  clearedDate: string | null;
  clearedDomain: DailyDomain | null;
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
  /** Null for corrections and undos, which have no source file. */
  fileName: string | null;
  byteSize: number | null;
}

export interface ImportedHistory {
  revisionId: number | null;
  records: StoredDailyRecord[];
  imports: ImportSummary[];
  /** The change Undo would revert next, if any. */
  undoTargetId: string | null;
}

export interface ImportCommitRequest {
  requestId: string;
  expectedRevisionId: number | null;
  file: { name: string; sha256: string; byteSize: number; mediaType: string; bytes: Uint8Array };
  records: DailyRecord[];
}

export interface ImportCommitResult {
  outcome: 'changed' | 'unchanged';
  replayed: boolean;
  revisionId: number | null;
  added: number;
  changed: number;
  unchanged: number;
}

/** The shared history changed after the preview was prepared (for example, on another device). */
export class StaleRevisionError extends Error {}

/** The requested record or change no longer exists (for example, already cleared or nothing left to undo). */
export class NothingToChangeError extends Error {}

export const emptyHistory: ImportedHistory = { revisionId: null, records: [], imports: [], undoTargetId: null };

export const defaultPreferences: Preferences = {
  displayDensity: 'comfortable',
  timezone: 'America/Denver',
  weekStartsOn: 1,
};
