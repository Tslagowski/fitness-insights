/**
 * Detailed food records (ticket 04) from a MacroFactor food CSV or the workbook's Food Log sheet.
 * Each date becomes one "food day": the entries in original source order, keeping legitimately
 * repeated identical rows. Each entry keeps the original column labels (units included); a blank
 * value is simply absent, which means "not recorded" and is never zero.
 */

export type FoodSource = 'food_csv' | 'workbook_food_log';
export type FoodEntry = Record<string, string | number>;

export interface FoodDay {
  date: string;
  source: FoodSource;
  entries: FoodEntry[];
}

export interface FoodFinding {
  source: string;
  row: number;
  column: string;
  value: string;
  problem: string;
}

export interface ParsedFood {
  days: FoodDay[];
  entryCount: number;
  findings: FoodFinding[];
  /** Columns in the source that are not part of the food schema; kept out of saved records. */
  ignoredColumns: string[];
}

export const requiredFoodHeaders = ['Date', 'Time', 'Food Name', 'Serving Size', 'Serving Qty', 'Serving Weight (g)', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)'];
const textColumns = new Set(['Time', 'Food Name', 'Serving Size']);
const numericColumn = /\((?:g|mg|mcg|kcal)\)$|^Serving Qty$/;

export const foodSourceLabels: Record<FoodSource, string> = {
  food_csv: 'Food CSV',
  workbook_food_log: 'Workbook Food Log',
};

/** Cells as delivered by either reader: CSV text, or typed spreadsheet values. */
export type FoodCell = string | number | null;

export function hasFoodHeaders(headers: string[]): boolean {
  return requiredFoodHeaders.every((header) => headers.includes(header));
}

export function parseFoodRows(headers: string[], rows: FoodCell[][], source: FoodSource, sourceName: string): ParsedFood {
  const findings: FoodFinding[] = [];
  const byDate = new Map<string, FoodEntry[]>();
  const dateColumn = headers.indexOf('Date');
  const kept = headers.map((header, index) => ({ header, index })).filter(({ header }) => header !== 'Date' && (textColumns.has(header) || numericColumn.test(header)));
  const ignoredColumns = headers.filter((header) => header && header !== 'Date' && !textColumns.has(header) && !numericColumn.test(header));
  let entryCount = 0;

  rows.forEach((row, offset) => {
    const rowNumber = offset + 2;
    if (row.every((cell) => cell === null || cell === '')) return;
    const date = calendarDate(row[dateColumn]);
    if (!date) {
      findings.push({ source: sourceName, row: rowNumber, column: 'Date', value: String(row[dateColumn] ?? '(blank)'), problem: 'Not a valid calendar date; this row was not imported.' });
      return;
    }
    const entry: FoodEntry = {};
    for (const { header, index } of kept) {
      const cell = row[index];
      if (cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')) continue;
      if (textColumns.has(header)) { entry[header] = String(cell); continue; }
      const value = typeof cell === 'number' ? cell : Number(cell.trim());
      if (Number.isFinite(value) && (typeof cell === 'number' || /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(cell.trim()))) entry[header] = value;
      else findings.push({ source: sourceName, row: rowNumber, column: header, value: String(cell), problem: 'Expected a number; kept as not recorded, not zero.' });
    }
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(entry);
    entryCount += 1;
  });

  const days = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, entries]) => ({ date, source, entries }));
  return { days, entryCount, findings, ignoredColumns };
}

/** Combines sources from one import: the food CSV wins on any date it represents; the workbook fills the rest. */
export function combineFoodSources(csvDays: FoodDay[], workbookDays: FoodDay[]): { days: FoodDay[]; overriddenWorkbookDates: string[] } {
  const csvDates = new Set(csvDays.map((day) => day.date));
  const overriddenWorkbookDates = workbookDays.filter((day) => csvDates.has(day.date)).map((day) => day.date);
  const days = [...csvDays, ...workbookDays.filter((day) => !csvDates.has(day.date))].sort((left, right) => left.date.localeCompare(right.date));
  return { days, overriddenWorkbookDates };
}

export interface FoodTotals {
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  entries: number;
  /** Entries without a recorded calorie value (the calorie sum covers only the others). */
  entriesMissingCalories: number;
}

export function foodDayTotals(entries: FoodEntry[]): FoodTotals {
  const sum = (label: string) => {
    const values = entries.map((entry) => entry[label]).filter((value): value is number => typeof value === 'number');
    return values.length ? Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100 : null;
  };
  return {
    calories: sum('Calories (kcal)'), protein: sum('Protein (g)'), fat: sum('Fat (g)'), carbs: sum('Carbs (g)'),
    entries: entries.length,
    entriesMissingCalories: entries.filter((entry) => typeof entry['Calories (kcal)'] !== 'number').length,
  };
}

/** The specification's tolerance: differences above max(5 kcal, 1% of the workbook total) need acceptance. */
export function calorieTolerance(workbookCalories: number): number {
  return Math.max(5, Math.abs(workbookCalories) * 0.01);
}

function calendarDate(cell: FoodCell | undefined): string | null {
  const candidate = typeof cell === 'string' ? cell.trim() : null;
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const [year, month, day] = candidate.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? candidate : null;
}
