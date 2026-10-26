import { describe, expect, test } from 'vitest';
import { compareAroundNote, latestNotes, notesInRange, type NoteVersion } from '../src/analysis/notes';
import { series, trendLine } from './fixtures/daily-builder';

const version = (id: string, number: number, values: Partial<NoteVersion> = {}): NoteVersion =>
  ({ id, version: number, startDate: '2026-03-01', endDate: '2026-03-01', text: `v${number}`, category: null, removed: false, updatedAt: `2026-03-0${number}T00:00:00Z`, ...values });

describe('dated notes', () => {
  test('the latest version wins, removed notes disappear, and notes sort by date', () => {
    const notes = latestNotes([version('a', 1), version('a', 2, { text: 'edited' }), version('b', 1, { startDate: '2026-02-01', endDate: '2026-02-03' }),
      version('c', 1), version('c', 2, { removed: true })]);
    expect(notes.map((note) => [note.id, note.text])).toEqual([['b', 'v1'], ['a', 'edited']]);
    expect(notesInRange(notes, '2026-02-03', '2026-02-28').map((note) => note.id)).toEqual(['b']);
  });

  test('before and after use equal windows and coverage gates; a range is summarized as during', () => {
    const days = series('2026-01-01', [...trendLine(250, -1, 59), ...trendLine(241.6, 0, 60)].map((trend, index) => ({ trend, intake: index < 59 ? 2000 : 2600, steps: index % 2 ? 9000 : null })));
    const single = compareAroundNote(days, version('a', 1), 28);
    expect(single.method).toBe('note-compare-v1');
    expect([single.before.start, single.before.end, single.after.start, single.after.end]).toEqual(['2026-02-01', '2026-02-28', '2026-03-01', '2026-03-28']);
    expect(single.before.rate!).toBeCloseTo(-1, 6);
    expect(single.after.rate!).toBeCloseTo(0, 6);
    expect(single.before.intake.mean).toBe(2000);
    expect(single.after.intake.mean).toBe(2600);
    expect(single.after.steps.covered).toBe(false);
    expect(single.during).toBeNull();
    const ranged = compareAroundNote(days, version('b', 1, { startDate: '2026-03-01', endDate: '2026-03-07' }), 14);
    expect([ranged.during!.start, ranged.during!.end, ranged.after.start]).toEqual(['2026-03-01', '2026-03-07', '2026-03-08']);
    const late = compareAroundNote(days, version('c', 1, { startDate: '2026-04-25', endDate: '2026-04-25' }), 28);
    expect(late.afterIncomplete).toBe(true);
    expect(late.after.intake.covered).toBe(false);
  });
});
