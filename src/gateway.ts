import type { DailyRecord } from './import/workbook';

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
}

export interface StoredDailyRecord extends DailyRecord {
  sourceFileId: string;
  revisionId: number;
}

export interface ImportSummary {
  id: string;
  committedAt: string;
  outcome: 'changed' | 'unchanged';
  revisionId: number | null;
  added: number;
  changed: number;
  unchanged: number;
  firstDate: string | null;
  lastDate: string | null;
  fileName: string;
  byteSize: number;
}

export interface ImportedHistory {
  revisionId: number | null;
  records: StoredDailyRecord[];
  imports: ImportSummary[];
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

export const emptyHistory: ImportedHistory = { revisionId: null, records: [], imports: [] };

export const defaultPreferences: Preferences = {
  displayDensity: 'comfortable',
  timezone: 'America/Denver',
  weekStartsOn: 1,
};
