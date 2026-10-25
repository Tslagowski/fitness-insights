import type { ClearableDomain, FoodDaySummary, ImportedHistory, ImportSummary } from '../gateway';
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

/** "1 day", "2 days": count plus the right noun form. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}

export function formatValue(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits });
}

export const clearableLabels: Record<ClearableDomain, string> = { ...domainLabels, food_entries: 'Food entries', workout_sets: 'Workout sets' };

/** One-line, plain-language description of a change-log entry. */
export function describeChange(change: ImportSummary, all: ImportSummary[]): string {
  if (change.kind === 'clear') {
    return `Cleared ${change.clearedDomain ? clearableLabels[change.clearedDomain] : 'a record'} on ${change.clearedDate ? formatCalendarDate(change.clearedDate) : 'a day'}`;
  }
  if (change.kind === 'undo') {
    const target = all.find((item) => item.id === change.undoesId);
    const what = target ? describeChange(target, all).replace(/^Imported/, 'the import of').replace(/^Cleared/, 'clearing') : 'an earlier change';
    return `Undid ${what.replace(/:.*$/, '')}`;
  }
  const name = change.fileNames.length ? change.fileNames.join(' + ') : 'files';
  if (change.outcome === 'unchanged') return `Imported ${name}: no changes`;
  const parts: string[] = [];
  if (change.added + change.changed + change.unchanged > 0) parts.push(`${change.added} added, ${change.changed} corrected, ${change.unchanged} unchanged`);
  if (change.foodAdded + change.foodChanged + change.foodUnchanged + change.foodKept > 0) {
    parts.push(`food days ${change.foodAdded} added, ${change.foodChanged} replaced, ${change.foodUnchanged} unchanged${change.foodKept ? `, ${change.foodKept} kept from the food CSV` : ''}`);
  }
  if (change.workoutAdded + change.workoutChanged + change.workoutUnchanged + change.workoutKept > 0) {
    parts.push(`workout days ${change.workoutAdded} added, ${change.workoutChanged} replaced, ${change.workoutUnchanged} unchanged${change.workoutKept ? `, ${change.workoutKept} kept from the workout CSV` : ''}`);
  }
  return `Imported ${name}: ${parts.join('; ')}`;
}

export interface DailyIntake {
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  /** 'detail' = sum of food entries; 'workbook' = workbook daily total (no detail for the date). Never both added together. */
  source: 'detail' | 'workbook' | null;
  entries: number | null;
}

/** Intake for one date: the food-detail sum when detail exists, otherwise the workbook total, labeled by source. */
export function dailyIntake(foodDay: FoodDaySummary | undefined, workbookTotals: DailyValues | undefined): DailyIntake {
  if (foodDay) return { calories: foodDay.calories, protein: foodDay.protein, fat: foodDay.fat, carbs: foodDay.carbs, source: 'detail', entries: foodDay.entries };
  if (workbookTotals) {
    return { calories: workbookTotals['Calories (kcal)'] ?? null, protein: workbookTotals['Protein (g)'] ?? null, fat: workbookTotals['Fat (g)'] ?? null,
      carbs: workbookTotals['Carbs (g)'] ?? null, source: 'workbook', entries: null };
  }
  return { calories: null, protein: null, fat: null, carbs: null, source: null, entries: null };
}

export function describeCounts(counts: { added: number; changed: number; removed: number }): string {
  const parts = [
    counts.added ? `${counts.added} restored` : '',
    counts.changed ? `${counts.changed} reverted to earlier values` : '',
    counts.removed ? `${counts.removed} removed` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no record changes';
}

/** "Mon 19": weekday and day of month, for rows that sit under a month heading. */
export function formatShortDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(year, month - 1, day)))} ${day}`;
}

/** "May 18": a calendar date without the year, for compact date ranges. */
export const monthDay = (date: string) => formatCalendarDate(date).replace(/, \d{4}$/, '');
