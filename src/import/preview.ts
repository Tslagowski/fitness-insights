import type { ImportedHistory, ImportSummary } from '../gateway';
import { dailyDomains, domainLabels, type DailyDomain, type DailyRecord, type DailyValues } from './workbook';

export interface RecordChange {
  date: string;
  domain: DailyDomain;
  before: DailyValues;
  after: DailyValues;
}

export interface ProposedChanges {
  added: number;
  changed: number;
  unchanged: number;
  corrections: RecordChange[];
  /** Saved dates that this import does not represent; they stay exactly as they are. */
  keptDates: number;
}

/** Compares a parsed import with the active shared history, using the same rule as the database commit. */
export function proposeChanges(records: DailyRecord[], history: ImportedHistory): ProposedChanges {
  const active = new Map(history.records.map((record) => [`${record.date}|${record.domain}`, record.values]));
  const importedDates = new Set(records.map((record) => record.date));
  const keptDates = new Set(history.records.map((record) => record.date).filter((date) => !importedDates.has(date))).size;
  const result: ProposedChanges = { added: 0, changed: 0, unchanged: 0, corrections: [], keptDates };
  for (const record of records) {
    const existing = active.get(`${record.date}|${record.domain}`);
    if (!existing) result.added += 1;
    else if (sameValues(existing, record.values)) result.unchanged += 1;
    else {
      result.changed += 1;
      result.corrections.push({ date: record.date, domain: record.domain, before: existing, after: record.values });
    }
  }
  return result;
}

export function sameValues(left: DailyValues, right: DailyValues): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!(key in left) || !(key in right) || left[key] !== right[key]) return false;
  }
  return true;
}

export interface DomainFreshness {
  domain: DailyDomain;
  /** Latest represented date in saved history, even if its values are blank. */
  lastRepresentedDate: string | null;
  /** Latest date with at least one recorded value. */
  lastValueDate: string | null;
  dates: number;
}

export function domainFreshness(history: ImportedHistory): DomainFreshness[] {
  return dailyDomains.map((domain) => {
    const records = history.records.filter((record) => record.domain === domain);
    const dates = records.map((record) => record.date).sort();
    const withValues = records.filter((record) => Object.values(record.values).some((value) => value !== null)).map((record) => record.date).sort();
    return { domain, lastRepresentedDate: dates.at(-1) ?? null, lastValueDate: withValues.at(-1) ?? null, dates: dates.length };
  });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Imports need a secure (https) connection to fingerprint the file.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The reporting calendar's current date (America/Denver), independent of the device's time zone. */
export function reportingToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Formats a stored calendar date for display without converting it through local time. */
export function formatCalendarDate(date: string, options: { weekday?: boolean } = {}): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', ...(options.weekday ? { weekday: 'short' } : {}),
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatValue(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits });
}

/** One-line, plain-language description of a change-log entry. */
export function describeChange(change: ImportSummary, all: ImportSummary[]): string {
  if (change.kind === 'clear') {
    return `Cleared ${change.clearedDomain ? domainLabels[change.clearedDomain] : 'a record'} on ${change.clearedDate ? formatCalendarDate(change.clearedDate) : 'a day'}`;
  }
  if (change.kind === 'undo') {
    const target = all.find((item) => item.id === change.undoesId);
    const what = target ? describeChange(target, all).replace(/^Imported/, 'the import of').replace(/^Cleared/, 'clearing') : 'an earlier change';
    return `Undid ${what.replace(/:.*$/, '')}`;
  }
  const name = change.fileName ?? 'workbook';
  if (change.outcome === 'unchanged') return `Imported ${name}: no changes`;
  return `Imported ${name}: ${change.added} added, ${change.changed} corrected, ${change.unchanged} unchanged`;
}

export function describeCounts(counts: { added: number; changed: number; removed: number }): string {
  const parts = [
    counts.added ? `${counts.added} restored` : '',
    counts.changed ? `${counts.changed} reverted to earlier values` : '',
    counts.removed ? `${counts.removed} removed` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no record changes';
}
