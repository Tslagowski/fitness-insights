import { buildWorkbook, type FixtureSheet, type FixtureValue } from './workbook-builder';

/**
 * A synthetic workbook in MacroFactor's full data export layout (one sheet per measure, program
 * history for targets, partial logging flags, and profile/settings sheets that must never be read).
 * No personal data: every value is invented.
 */
export interface FullExportOptions {
  /** Dates (YYYY-MM-DD) with calories; each gets intake 2000 + index * 10 unless overridden. */
  calories: string[];
  weights?: Record<string, number | null>;
  trend?: string[];
  expenditure?: string[];
  steps?: Record<string, number>;
  /** Program updates: date (M/D/YYYY text) with calorie targets per weekday name (other macros fixed). */
  programs?: Array<{ date: string; calories: Record<string, number> }>;
  partial?: Record<string, 'Yes' | 'No'>;
  overrides?: Record<string, number>;
  extraSheets?: FixtureSheet[];
}
const us = (date: string) => { const [y, m, d] = date.split('-').map(Number); return `${m}/${d}/${y}`; };
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function fullExport(options: FullExportOptions): Uint8Array {
  const rows = (header: string[], body: FixtureValue[][]) => [header, ...body];
  const sheets: FixtureSheet[] = [
    { name: 'Calories & Macros', rows: rows(['Date', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)'],
      options.calories.map((date, index) => [{ date }, options.overrides?.[date] ?? 2000 + index * 10, 70, 250, 160])) },
    { name: 'Micronutrients', rows: rows(['Date', 'Alcohol (g)', 'Caffeine (mg)', 'Fiber (g)'], options.calories.map((date) => [{ date }, null, 95, 30])) },
    { name: 'Scale Weight', rows: rows(['Date', 'Weight (lb)', 'Fat Percent'], Object.entries(options.weights ?? {}).map(([date, weight]) => [{ date }, weight, null])) },
    { name: 'Body Metrics', rows: rows(['Date', 'Waist (in)'], [[{ date: options.calories[0] }, 40]]) },
    { name: 'Weight Trend', rows: rows(['Date', 'Trend Weight (lb)'], (options.trend ?? []).map((date, index) => [{ date }, 200 - index * 0.1])) },
    { name: 'Expenditure', rows: rows(['Date', 'Expenditure'], (options.expenditure ?? []).map((date) => [{ date }, 2500])) },
    { name: 'Steps', rows: rows(['Date', 'Steps'], Object.entries(options.steps ?? {}).map(([date, steps]) => [{ date }, steps])) },
    { name: 'Muscle Groups - Sets', rows: rows(['Date', 'Chest (sets)'], [[{ date: options.calories[0] }, 4]]) },
    { name: 'Exercises - 1-RM', rows: rows(['Date', 'Barbell Bench Press (lb)'], [[{ date: options.calories[0] }, 190]]) },
    { name: 'History', rows: rows(['Food Name'], [['Oats']]) },
    { name: 'Workouts', rows: [[null, 'Exercise', 'Notes', 'Set 1 Type']] },
    { name: 'Partial Logging', rows: rows(['Date', 'Partial Logging'], Object.entries(options.partial ?? {}).map(([date, value]) => [us(date), value])) },
    { name: 'User Profile', rows: rows(['Name', 'Email', 'Birthday'], [['Synthetic Person', 'synthetic@example.test', '1/1/1990']]) },
    { name: 'Nutrition Program Settings', rows: rows(['Program Update Date', 'Program Weekday', 'Calories (kcal)', 'Fat (g)', 'Protein (g)', 'Carbs (g)', 'Expenditure (kcal)'],
      (options.programs ?? []).flatMap((program) => weekdays.map((weekday) => [us(program.date), weekday, program.calories[weekday] ?? 2300, 60, 170, 260, 2600]))) },
    { name: 'Weight Goals', rows: rows(['Goal', 'Status'], [['Lose', 'Active']]) },
    ...(options.extraSheets ?? []),
  ];
  return buildWorkbook(sheets);
}
