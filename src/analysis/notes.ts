/**
 * Ticket 25: owner notes on dates (for example a new program or travel).
 * Notes are private, owner-only, and versioned: an edit or removal appends a new version; the latest wins.
 *
 * Before/after comparison (note-compare-v1): equal-length windows of `length` days. Before is the
 * `length` days ending the day before the note starts. After is the `length` days starting on the note's
 * date for a single-day note, or starting the day after a date range ends (the range itself is summarized
 * as During). Each measure uses eligible days only and the standard coverage gate (75% of the window).
 */
import { addDays } from './eligibility';
import type { DailyValues } from './daily';
import { summarizeRange } from './phases';

export const noteCategories = ['Training', 'Nutrition', 'Travel', 'Health', 'Life', 'Other'] as const;
export type NoteCategory = (typeof noteCategories)[number];
export const noteCompareMethodVersion = 'note-compare-v1';
export const noteWindowLengths = [14, 28, 56] as const;

export interface OwnerNote {
  id: string;
  startDate: string;
  /** Same as startDate for a single-day note. */
  endDate: string;
  text: string;
  category: NoteCategory | null;
  version: number;
  updatedAt: string;
}

/** One stored version of a note (removed = the note was deleted in this version). */
export interface NoteVersion extends OwnerNote { removed: boolean }

/** The latest version of each note that has not been removed, ordered by date. */
export function latestNotes(versions: NoteVersion[]): OwnerNote[] {
  const latest = new Map<string, NoteVersion>();
  for (const version of versions) {
    const current = latest.get(version.id);
    if (!current || version.version > current.version) latest.set(version.id, version);
  }
  return [...latest.values()].filter((note) => !note.removed)
    .map(({ removed: _removed, ...note }) => note)
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id));
}

export const notesInRange = (notes: OwnerNote[], start: string, end: string) => notes.filter((note) => note.startDate <= end && note.endDate >= start);

export type RangeSummary = ReturnType<typeof summarizeRange> & { start: string; end: string };
export interface NoteComparison {
  method: typeof noteCompareMethodVersion;
  length: number;
  before: RangeSummary;
  during: RangeSummary | null;
  after: RangeSummary;
  /** The after window extends past the last completed day. */
  afterIncomplete: boolean;
}

export function compareAroundNote(days: DailyValues[], note: OwnerNote, length: number): NoteComparison {
  const range = (start: string, end: string): RangeSummary => ({ ...summarizeRange(days, start, end), start, end });
  const ranged = note.endDate !== note.startDate;
  const afterStart = ranged ? addDays(note.endDate, 1) : note.startDate;
  const afterEnd = addDays(afterStart, length - 1);
  const last = days.at(-1)?.date ?? note.startDate;
  return {
    method: noteCompareMethodVersion, length,
    before: range(addDays(note.startDate, -length), addDays(note.startDate, -1)),
    during: ranged ? range(note.startDate, note.endDate) : null,
    after: range(afterStart, afterEnd),
    afterIncomplete: afterEnd > last,
  };
}
