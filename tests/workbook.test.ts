import { describe, expect, test } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseWorkbook, WorkbookImportError } from '../src/import/workbook';
import { serialToCalendarDate } from '../src/import/xlsx';
import { buildWorkbook, dailyHeaders, dailyRow, syntheticWorkbook } from './fixtures/workbook-builder';

const foodSheet = { name: 'Food Log', rows: [['Date', 'Time', 'Food Name', 'Serving Size', 'Serving Qty', 'Serving Weight (g)', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)'], ['2026-09-01', '8:00 AM', 'Oats', 'cup', 1, 80, 300, 5, 54, 10]] };
const workoutSheet = { name: 'Workout Log', rows: [['Date', 'Workout', 'Exercise', 'Set Type', 'Weight (lb)', 'Reps'], ['2026-09-01', 'Push', 'Bench Press', 'Standard Set', 135, 8]] };

describe('workbook detection', () => {
  test('recognizes the daily sheet by its columns, not its name, and classifies the other sheets', () => {
    const bytes = buildWorkbook([
      { name: 'Renamed Summary', rows: [dailyHeaders, dailyRow('2026-09-01'), dailyRow('2026-09-02')] },
      foodSheet,
      workoutSheet,
      { name: 'Muscle Groups - Sets', rows: [['Date', 'Chest (sets)'], [{ date: '2026-09-01' }, 3]] },
      { name: 'Active Program', rows: [['Program: Example'], ['Block 1']] },
      { name: 'Notes', rows: [['Anything'], ['else']] },
    ]);
    const result = parseWorkbook(bytes);
    expect(result.dailySheet).toBe('Renamed Summary');
    expect(result.sheets.map((sheet) => [sheet.name, sheet.disposition])).toEqual([
      ['Renamed Summary', 'imported'], ['Food Log', 'food-detail'], ['Workout Log', 'later-workouts'],
      ['Muscle Groups - Sets', 'archived'], ['Active Program', 'archived'], ['Notes', 'unrecognized'],
    ]);
  });

  test('rejects files that are not workbooks, or workbooks without the daily summary, with actionable errors', () => {
    expect(() => parseWorkbook(strToU8('Date,Weight\n2026-09-01,180'))).toThrow(/not an Excel workbook/);
    expect(() => parseWorkbook(zipSync({ 'hello.txt': strToU8('hi') }))).toThrow(/not an Excel workbook/);
    expect(() => parseWorkbook(buildWorkbook([foodSheet]))).toThrow(/does not look like a MacroFactor workbook/);
    const missingSteps = buildWorkbook([{ name: 'Quick Export', rows: [dailyHeaders.filter((header) => header !== 'Steps'), ['x']] }]);
    expect(() => parseWorkbook(missingSteps)).toThrow(/missing required columns: Steps/);
  });

  test('rejects an ambiguous export with a repeated date instead of guessing', () => {
    expect(() => parseWorkbook(syntheticWorkbook([dailyRow('2026-09-01'), dailyRow('2026-09-01', { Steps: 10 })])))
      .toThrow(WorkbookImportError);
  });
});

describe('daily values', () => {
  test('splits each day into domains, keeping original labels, units, and missing values', () => {
    const result = parseWorkbook(syntheticWorkbook([
      dailyRow('2026-09-02', { 'Weight (lb)': null, Steps: 0 }),
      dailyRow('2026-09-01'),
    ]));
    expect(result.dates).toEqual(['2026-09-01', '2026-09-02']);
    expect(result.records).toHaveLength(12);
    const day2 = result.records.filter((record) => record.date === '2026-09-02');
    expect(day2.find((record) => record.domain === 'scale_weight')?.values).toEqual({ 'Weight (lb)': null });
    expect(day2.find((record) => record.domain === 'steps')?.values).toEqual({ Steps: 0 });
    expect(day2.find((record) => record.domain === 'trend_weight')?.values).toEqual({ 'Trend Weight (lb)': 180.5 });
    expect(day2.find((record) => record.domain === 'nutrition_totals')?.values).toEqual({
      'Calories (kcal)': 2300, 'Protein (g)': 160, 'Fat (g)': 70, 'Carbs (g)': 250, 'Alcohol (g)': null, 'Fiber (g)': 30,
    });
    const weightCoverage = result.coverage.find((coverage) => coverage.domain === 'scale_weight');
    expect(weightCoverage).toEqual({ domain: 'scale_weight', firstDate: '2026-09-01', lastDate: '2026-09-02', dates: 2, datesWithValues: 1 });
  });

  test('keeps an invalid value unavailable with a finding rather than coercing it to zero', () => {
    const result = parseWorkbook(syntheticWorkbook([dailyRow('2026-09-01', { 'Calories (kcal)': 'lots', Expenditure: { raw: '<c r="{ref}" t="e"><v>#VALUE!</v></c>' } })]));
    const nutrition = result.records.find((record) => record.domain === 'nutrition_totals');
    expect(nutrition?.values['Calories (kcal)']).toBeNull();
    expect(result.records.find((record) => record.domain === 'expenditure')?.values).toEqual({ Expenditure: null });
    expect(result.findings.map((finding) => [finding.row, finding.column, finding.value])).toEqual([
      [2, 'Expenditure', '#VALUE!'], [2, 'Calories (kcal)', 'lots'],
    ]);
  });

  test('accepts text dates, skips invalid dates with a finding, and ignores blank rows', () => {
    const result = parseWorkbook(syntheticWorkbook([
      dailyRow('2026-09-01', { Date: '2026-09-01' }),
      dailyRow('x', { Date: '2026-02-30' }),
      [],
      dailyRow('2026-09-03'),
    ]));
    expect(result.dates).toEqual(['2026-09-01', '2026-09-03']);
    expect(result.findings).toEqual([expect.objectContaining({ row: 3, column: 'Date', value: '2026-02-30' })]);
  });

  test('converts date cells by calendar arithmetic for both Excel date systems', () => {
    expect(serialToCalendarDate(46285)).toBe('2026-09-20');
    expect(serialToCalendarDate(46285.99)).toBe('2026-09-20');
    expect(serialToCalendarDate(1)).toBe('1900-01-01');
    expect(serialToCalendarDate(61)).toBe('1900-03-01');
    const result = parseWorkbook(buildWorkbook([{ name: 'Daily', rows: [dailyHeaders, dailyRow('2026-03-08')] }], { date1904: true }));
    expect(result.dates).toEqual(['2026-03-08']);
  });

  test('reports daily-sheet columns that this version does not import', () => {
    const result = parseWorkbook(buildWorkbook([{ name: 'Quick Export', rows: [[...dailyHeaders, 'Mood'], [...dailyRow('2026-09-01'), 'good']] }]));
    expect(result.ignoredColumns).toEqual(['Mood']);
  });
});
