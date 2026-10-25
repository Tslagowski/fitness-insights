import { describe, expect, test } from 'vitest';
import { parseWorkbook, WorkbookImportError } from '../src/import/workbook';
import { planImport } from '../src/import/sources';
import { addDays } from '../src/analysis/eligibility';
import { fullExport } from './fixtures/full-export-builder';
import { buildWorkbook } from './fixtures/workbook-builder';

const days = (start: string, count: number) => Array.from({ length: count }, (_, index) => addDays(start, index));

describe('full data export', () => {
  test('is recognized by its sheets and combined into daily records with per-measure coverage', () => {
    const calories = days('2026-09-01', 10);
    const result = parseWorkbook(fullExport({
      calories, weights: { '2026-09-01': 201.2, '2026-09-03': null, '2026-09-04': 200.6 }, trend: calories.slice(0, 8), expenditure: calories.slice(0, 8),
      steps: { '2026-08-30': 4000, '2026-09-01': 8000 },
    }));
    expect(result.format).toBe('full');
    expect(result.coverage.map((item) => [item.domain, item.dates, item.datesWithValues])).toEqual([
      ['scale_weight', 3, 2], ['trend_weight', 8, 8], ['expenditure', 8, 8], ['nutrition_totals', 10, 10], ['steps', 2, 2]]);
    const day = (date: string) => Object.fromEntries(result.records.filter((record) => record.date === date).map((record) => [record.domain, record.values]));
    expect(day('2026-09-01')).toEqual({
      scale_weight: { 'Weight (lb)': 201.2 }, trend_weight: { 'Trend Weight (lb)': 200 }, expenditure: { Expenditure: 2500 },
      nutrition_totals: { 'Calories (kcal)': 2000, 'Protein (g)': 160, 'Fat (g)': 70, 'Carbs (g)': 250, 'Alcohol (g)': null, 'Fiber (g)': 30 }, steps: { Steps: 8000 },
    });
    // A blank weigh-in stays missing; a date absent from a sheet gets no record for that measure.
    expect(day('2026-09-03').scale_weight).toEqual({ 'Weight (lb)': null });
    expect(day('2026-09-02').scale_weight).toBeUndefined();
    expect(day('2026-08-30')).toEqual({ steps: { Steps: 4000 } });
    expect(result.findings).toEqual([]);
  });

  test('targets come from the latest program update on or before each day, by weekday', () => {
    const calories = days('2026-09-28', 14); // Monday Sep 28 .. Sunday Oct 11
    const result = parseWorkbook(fullExport({ calories, programs: [
      { date: '2026-09-30', calories: { Saturday: 2600, Sunday: 2600, Monday: 2200 } },
      { date: '2026-10-07', calories: { Wednesday: 2100, Saturday: 2500 } },
    ] }));
    const target = (date: string) => result.records.find((record) => record.date === date && record.domain === 'targets')?.values['Target Calories (kcal)'];
    expect(target('2026-09-29')).toBeUndefined();
    expect(target('2026-09-30')).toBe(2300);
    expect(target('2026-10-03')).toBe(2600);
    expect(target('2026-10-05')).toBe(2200);
    expect(target('2026-10-07')).toBe(2100);
    expect(target('2026-10-10')).toBe(2500);
    expect(target('2026-10-11')).toBe(2300);
    expect(result.records.find((record) => record.date === '2026-10-07' && record.domain === 'targets')?.values).toEqual({
      'Target Calories (kcal)': 2100, 'Target Protein (g)': 170, 'Target Fat (g)': 60, 'Target Carbs (g)': 260 });
    expect(result.targets).toEqual({ version: 'program-weekday-v1', updates: 2, firstUpdate: '2026-09-30', daysDerived: 12 });
  });

  test('partial logging days are offered, profile and settings sheets are never read, summaries are archived', () => {
    const result = parseWorkbook(fullExport({ calories: days('2026-09-01', 5), partial: { '2026-09-02': 'Yes', '2026-09-03': 'No', '2026-09-04': 'Yes' } }));
    expect(result.partialLoggingDates).toEqual(['2026-09-02', '2026-09-04']);
    const disposition = Object.fromEntries(result.sheets.map((sheet) => [sheet.name, sheet.disposition]));
    expect(disposition).toMatchObject({ 'User Profile': 'private', 'Calories & Macros': 'imported', 'Partial Logging': 'imported', 'Muscle Groups - Sets': 'archived', 'Exercises - 1-RM': 'archived', 'Body Metrics': 'archived', Workouts: 'archived' });
    expect(JSON.stringify(result.records)).not.toMatch(/synthetic@example|Synthetic Person|1990/);
    expect(result.foodLog).toBeNull();
    expect(result.workoutLog).toBeNull();
  });

  test('ambiguous or unrecognized workbooks still fail clearly and import nothing', () => {
    const dup = fullExport({ calories: ['2026-09-01', '2026-09-01'] });
    expect(() => parseWorkbook(dup)).toThrow(/appears twice on "Calories & Macros"/);
    expect(() => parseWorkbook(buildWorkbook([{ name: 'Other', rows: [['Date', 'Something']] }]))).toThrow(WorkbookImportError);
    expect(() => planImport([{ name: 'x.xlsx', bytes: fullExport({ calories: ['2026-09-01'], extraSheets: [{ name: 'Calories copy', rows: [['Date', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)']] }] }) }]))
      .toThrow(/More than one sheet looks like the nutrition totals sheet/);
  });
});
