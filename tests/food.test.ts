import { describe, expect, test } from 'vitest';
import { strToU8 } from 'fflate';
import { parseCsv } from '../src/import/csv';
import { calorieTolerance, foodDayTotals } from '../src/import/food';
import { planImport } from '../src/import/sources';
import { buildWorkbook, dailyHeaders, dailyRow } from './fixtures/workbook-builder';
import { foodCsv, foodHeaders, foodRow } from './fixtures/food-builder';

describe('CSV reading', () => {
  test('handles a BOM, quoted commas, doubled quotes, embedded line breaks, CRLF, and empty fields', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""",\r\n"line\nbreak",2,3\n';
    expect(parseCsv(text)).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', ''], ['line\nbreak', '2', '3']]);
    expect(() => parseCsv('a,"unterminated\n')).toThrow(/quoted field/);
  });
});

describe('food records', () => {
  test('keeps source order, legitimately identical rows, units, times, and missing nutrients', () => {
    const plan = planImport([{ name: 'anything.csv', bytes: foodCsv([
      foodRow('2026-09-02', '7:00 AM', 'Coffee', { 'Calories (kcal)': 5, 'Caffeine (mg)': 95 }),
      foodRow('2026-09-01', '8:15 AM', 'Egg, "large"', { 'Calories (kcal)': 70 }),
      foodRow('2026-09-01', '8:15 AM', 'Egg, "large"', { 'Calories (kcal)': 70 }),
      foodRow('2026-09-01', '1:00 PM', 'Salad', { 'Calories (kcal)': '', 'Protein (g)': 3 }),
    ]) }]);
    expect(plan.sources.map((source) => source.kind)).toEqual(['food_csv']);
    expect(plan.daily).toBeNull();
    const [first, second] = plan.food!.days;
    expect(first.date).toBe('2026-09-01');
    expect(first.entries).toHaveLength(3);
    expect(first.entries[0]).toEqual(first.entries[1]);
    expect(first.entries[0]).toMatchObject({ Time: '8:15 AM', 'Food Name': 'Egg, "large"', 'Calories (kcal)': 70 });
    expect(first.entries[2]).not.toHaveProperty('Calories (kcal)');
    expect(first.entries[2]['Protein (g)']).toBe(3);
    expect(second.entries[0]['Caffeine (mg)']).toBe(95);
    expect(foodDayTotals(first.entries)).toMatchObject({ calories: 140, protein: 9, entries: 3, entriesMissingCalories: 1 });
  });

  test('reports invalid numbers and dates instead of guessing', () => {
    const plan = planImport([{ name: 'food.csv', bytes: foodCsv([
      foodRow('2026-09-01', '8:00 AM', 'Toast', { 'Calories (kcal)': 'lots' }),
      foodRow('09/01/2026', '9:00 AM', 'Tea', {}),
    ]) }]);
    expect(plan.food!.days[0].entries[0]).not.toHaveProperty('Calories (kcal)');
    expect(plan.food!.findings.map((finding) => [finding.row, finding.column])).toEqual([[2, 'Calories (kcal)'], [3, 'Date']]);
  });

  test('a food CSV wins over the workbook Food Log on dates it covers; the workbook fills the rest', () => {
    const foodLog = { name: 'Food Log', rows: [foodHeaders,
      foodRow('2026-09-01', '8:00 AM', 'Workbook oats', { 'Calories (kcal)': 300 }),
      foodRow('2026-09-02', '8:00 AM', 'Workbook eggs', { 'Calories (kcal)': 140 })] };
    const workbook = buildWorkbook([{ name: 'Quick Export', rows: [dailyHeaders, dailyRow('2026-09-01'), dailyRow('2026-09-02')] }, foodLog]);
    const csv = foodCsv([foodRow('2026-09-02', '9:00 AM', 'CSV eggs', { 'Calories (kcal)': 150 })]);
    const plan = planImport([{ name: 'export.xlsx', bytes: workbook }, { name: 'export.csv', bytes: csv }]);
    expect(plan.sources.map((source) => source.kind)).toEqual(['workbook', 'food_csv']);
    expect(plan.daily!.records).toHaveLength(12);
    expect(plan.food!.days.map((day) => [day.date, day.source, day.entries[0]['Food Name']])).toEqual([
      ['2026-09-01', 'workbook_food_log', 'Workbook oats'], ['2026-09-02', 'food_csv', 'CSV eggs'],
    ]);
    expect(plan.food!.overriddenWorkbookDates).toEqual(['2026-09-02']);
  });

  test('rejects workout CSVs, unknown files, and duplicate sources with guidance', () => {
    const workout = strToU8('Date,Workout,Exercise,Set Type,Weight (lb),Reps\n2026-09-01,Push,Bench,Standard Set,135,8\n');
    expect(() => planImport([{ name: 'w.csv', bytes: workout }])).toThrow(/workout CSV/);
    expect(() => planImport([{ name: 'x.csv', bytes: strToU8('a,b\n1,2\n') }])).toThrow(/not a recognized MacroFactor export/);
    const csv = foodCsv([foodRow('2026-09-01', '8:00 AM', 'Tea', {})]);
    expect(() => planImport([{ name: 'a.csv', bytes: csv }, { name: 'b.csv', bytes: csv }])).toThrow(/More than one food CSV/);
    expect(() => planImport([])).toThrow(/at least one file/);
  });

  test('applies the max(5 kcal, 1%) reconciliation tolerance', () => {
    expect(calorieTolerance(300)).toBe(5);
    expect(calorieTolerance(2500)).toBe(25);
  });
});
