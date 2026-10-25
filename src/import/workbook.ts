import { readSpreadsheet, SpreadsheetReadError, type SpreadsheetCell, type SpreadsheetSheet } from './xlsx';
import { hasFoodHeaders, parseFoodRows, type FoodCell, type ParsedFood } from './food';
import { hasWorkoutHeaders, parseWorkoutRows, type ParsedWorkouts } from './workout';
import { FullExportError, isFullExport, parseFullExport } from './full-export';

/**
 * MacroFactor workbook import (ticket 02): daily measurements, expenditure, targets,
 * nutrition totals, and steps. Sheets are recognized by their header structure, never
 * by file or sheet name. Values keep their original column labels (which carry units),
 * and a blank cell stays missing (null); it never becomes zero.
 */

export const dailyDomains = ['scale_weight', 'trend_weight', 'expenditure', 'nutrition_totals', 'targets', 'steps'] as const;
export type DailyDomain = (typeof dailyDomains)[number];

export const domainLabels: Record<DailyDomain, string> = {
  scale_weight: 'Scale weight',
  trend_weight: 'Trend weight (source estimate)',
  expenditure: 'Expenditure (source estimate)',
  nutrition_totals: 'Nutrition totals (workbook)',
  targets: 'Targets',
  steps: 'Steps',
};

/** Required columns per domain. Nutrition totals also take any additional nutrient column. */
const domainColumns: Record<DailyDomain, readonly string[]> = {
  scale_weight: ['Weight (lb)'],
  trend_weight: ['Trend Weight (lb)'],
  expenditure: ['Expenditure'],
  nutrition_totals: ['Calories (kcal)', 'Protein (g)', 'Fat (g)', 'Carbs (g)'],
  targets: ['Target Calories (kcal)', 'Target Protein (g)', 'Target Fat (g)', 'Target Carbs (g)'],
  steps: ['Steps'],
};
const nutrientColumn = /\((?:g|mg|mcg|kcal)\)$/;

export type DailyValues = Record<string, number | null>;

export interface DailyRecord {
  date: string;
  domain: DailyDomain;
  values: DailyValues;
}

export interface ImportFinding {
  sheet: string;
  row: number;
  column: string;
  value: string;
  problem: string;
}

export type SheetDisposition = 'imported' | 'food-detail' | 'workout-detail' | 'archived' | 'private' | 'unrecognized';

export interface SheetSummary {
  name: string;
  disposition: SheetDisposition;
  dataRows: number;
}

export interface DomainCoverage {
  domain: DailyDomain;
  firstDate: string;
  lastDate: string;
  dates: number;
  /** Dates on which at least one value in this domain is present. */
  datesWithValues: number;
}

export interface WorkbookImport {
  /** Quick export (one daily sheet) or the full data export (one sheet per measure, ticket 27). */
  format: 'quick' | 'full';
  dailySheet: string;
  /** Full export: which sheet supplied each kind of value. */
  sources?: Array<{ sheet: string; role: string }>;
  /** Full export: how daily targets were derived from the program history. */
  targets?: { version: string; updates: number; firstUpdate: string | null; daysDerived: number } | null;
  /** Full export: days flagged as partial logging in MacroFactor, offered as incomplete-day suggestions. */
  partialLoggingDates?: string[];
  dates: string[];
  records: DailyRecord[];
  coverage: DomainCoverage[];
  findings: ImportFinding[];
  sheets: SheetSummary[];
  /** Columns present on the daily sheet that this version does not import. */
  ignoredColumns: string[];
  /** Detailed food entries from the Food Log sheet (fallback detail when no food CSV covers a date). */
  foodLog: ParsedFood | null;
  /** Workout sets from the Workout Log sheet (fallback detail when no workout CSV covers a date). */
  workoutLog: ParsedWorkouts | null;
}

export class WorkbookImportError extends Error {}

const requiredDailyHeaders = ['Date', ...Object.values(domainColumns).flat()];

export function parseWorkbook(bytes: Uint8Array): WorkbookImport {
  let sheets: SpreadsheetSheet[];
  try {
    sheets = readSpreadsheet(bytes).sheets;
  } catch (error) {
    if (error instanceof SpreadsheetReadError) throw new WorkbookImportError(error.message);
    throw new WorkbookImportError('This workbook could not be read.');
  }

  const dailyCandidates = sheets.filter((sheet) => hasHeaders(sheet, requiredDailyHeaders));
  if (dailyCandidates.length === 0 && isFullExport(sheets)) return fullExportImport(sheets);
  if (dailyCandidates.length === 0) {
    const closest = sheets.find((sheet) => headerRow(sheet).includes('Date') && headerRow(sheet).includes('Expenditure'));
    if (closest) {
      const missing = requiredDailyHeaders.filter((header) => !headerRow(closest).includes(header));
      throw new WorkbookImportError(`The daily sheet "${closest.name}" is missing required columns: ${missing.join(', ')}. Export the workbook again from MacroFactor.`);
    }
    throw new WorkbookImportError('This does not look like a MacroFactor workbook export: no daily summary sheet with Date, Expenditure, weight, nutrition, target, and step columns was found. Nothing was changed.');
  }
  if (dailyCandidates.length > 1) {
    throw new WorkbookImportError(`More than one sheet looks like the daily summary (${dailyCandidates.map((sheet) => `"${sheet.name}"`).join(', ')}). Nothing was changed.`);
  }

  const dailySheet = dailyCandidates[0];
  const headers = headerRow(dailySheet);
  const assigned = new Set(['Date', ...Object.values(domainColumns).flat()]);
  const extraNutrients = headers.filter((header) => header && !assigned.has(header) && nutrientColumn.test(header));
  const ignoredColumns = headers.filter((header) => header && !assigned.has(header) && !nutrientColumn.test(header));
  const columnsByDomain: Record<DailyDomain, string[]> = {
    ...Object.fromEntries(dailyDomains.map((domain) => [domain, [...domainColumns[domain]]])) as Record<DailyDomain, string[]>,
  };
  columnsByDomain.nutrition_totals.push(...extraNutrients);

  const findings: ImportFinding[] = [];
  const records: DailyRecord[] = [];
  const seenDates = new Map<string, number>();
  const dateColumn = headers.indexOf('Date');

  dailySheet.rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    if (row.every((cell) => cell.kind === 'empty')) return;
    const date = calendarDate(row[dateColumn]);
    if (!date) {
      findings.push({ sheet: dailySheet.name, row: rowNumber, column: 'Date', value: describe(row[dateColumn]), problem: 'Not a valid calendar date; this row was not imported.' });
      return;
    }
    const earlierRow = seenDates.get(date);
    if (earlierRow) {
      throw new WorkbookImportError(`The date ${date} appears twice on "${dailySheet.name}" (rows ${earlierRow} and ${rowNumber}). The export is ambiguous, so nothing was imported.`);
    }
    seenDates.set(date, rowNumber);
    for (const domain of dailyDomains) {
      const values: DailyValues = {};
      for (const column of columnsByDomain[domain]) {
        const cell = row[headers.indexOf(column)];
        if (!cell || cell.kind === 'empty') values[column] = null;
        else if (cell.kind === 'number') values[column] = cell.value;
        else {
          values[column] = null;
          findings.push({ sheet: dailySheet.name, row: rowNumber, column, value: describe(cell), problem: 'Expected a number; kept as unavailable, not zero.' });
        }
      }
      records.push({ date, domain, values });
    }
  });

  if (records.length === 0) throw new WorkbookImportError(`"${dailySheet.name}" has no daily rows to import. Nothing was changed.`);

  const dates = [...seenDates.keys()].sort();
  const coverage = dailyDomains.map((domain): DomainCoverage => {
    const domainRecords = records.filter((record) => record.domain === domain);
    const domainDates = domainRecords.map((record) => record.date).sort();
    return {
      domain,
      firstDate: domainDates[0],
      lastDate: domainDates[domainDates.length - 1],
      dates: domainDates.length,
      datesWithValues: domainRecords.filter((record) => Object.values(record.values).some((value) => value !== null)).length,
    };
  });

  return {
    format: 'quick',
    dailySheet: dailySheet.name,
    dates,
    records: records.sort((left, right) => left.date.localeCompare(right.date) || dailyDomains.indexOf(left.domain) - dailyDomains.indexOf(right.domain)),
    coverage,
    findings,
    sheets: sheets.map((sheet) => ({ name: sheet.name, disposition: dispositionOf(sheet, dailySheet), dataRows: dataRowCount(sheet) })),
    ignoredColumns,
    foodLog: readFoodLog(sheets),
    workoutLog: readWorkoutLog(sheets),
  };
}

function fullExportImport(sheets: SpreadsheetSheet[]): WorkbookImport {
  let result: ReturnType<typeof parseFullExport>;
  try { result = parseFullExport(sheets); } catch (error) {
    throw new WorkbookImportError(error instanceof FullExportError ? error.message : 'This full data export could not be read. Nothing was changed.');
  }
  const dates = [...new Set(result.records.map((record) => record.date))].sort();
  const coverage = dailyDomains.flatMap((domain): DomainCoverage[] => {
    const domainRecords = result.records.filter((record) => record.domain === domain);
    if (!domainRecords.length) return [];
    return [{ domain, firstDate: domainRecords[0].date, lastDate: domainRecords.at(-1)!.date, dates: domainRecords.length,
      datesWithValues: domainRecords.filter((record) => Object.values(record.values).some((value) => value !== null)).length }];
  });
  return {
    format: 'full',
    dailySheet: result.sources.map((source) => source.sheet).join(', '),
    sources: result.sources,
    targets: result.targets,
    partialLoggingDates: result.partialLoggingDates,
    dates,
    records: result.records,
    coverage,
    findings: result.findings,
    sheets: sheets.map((sheet) => ({ name: sheet.name, disposition: result.dispositions.get(sheet) ?? 'archived', dataRows: dataRowCount(sheet) })),
    ignoredColumns: [],
    foodLog: readFoodLog(sheets),
    workoutLog: readWorkoutLog(sheets),
  };
}

function readWorkoutLog(sheets: SpreadsheetSheet[]): ParsedWorkouts | null {
  const candidates = sheets.filter((sheet) => hasWorkoutHeaders(headerRow(sheet)));
  if (candidates.length > 1) {
    throw new WorkbookImportError(`More than one sheet looks like a workout log (${candidates.map((sheet) => `"${sheet.name}"`).join(', ')}). Nothing was changed.`);
  }
  const sheet = candidates[0];
  return sheet ? parseWorkoutRows(headerRow(sheet), sheet.rows.slice(1).map((row) => row.map(toCell)), 'workbook_workout_log', sheet.name) : null;
}

function toCell(cell: SpreadsheetCell | undefined): FoodCell {
  if (!cell || cell.kind === 'empty') return null;
  if (cell.kind === 'number') return cell.value;
  return String(cell.value);
}

function readFoodLog(sheets: SpreadsheetSheet[]): ParsedFood | null {
  const candidates = sheets.filter((sheet) => hasFoodHeaders(headerRow(sheet)));
  if (candidates.length > 1) {
    throw new WorkbookImportError(`More than one sheet looks like a food log (${candidates.map((sheet) => `"${sheet.name}"`).join(', ')}). Nothing was changed.`);
  }
  const sheet = candidates[0];
  if (!sheet) return null;
  return parseFoodRows(headerRow(sheet), sheet.rows.slice(1).map((row) => row.map(toCell)), 'workbook_food_log', sheet.name);
}

function dispositionOf(sheet: SpreadsheetSheet, dailySheet: SpreadsheetSheet): SheetDisposition {
  if (sheet === dailySheet) return 'imported';
  if (hasFoodHeaders(headerRow(sheet))) return 'food-detail';
  if (hasWorkoutHeaders(headerRow(sheet))) return 'workout-detail';
  const headers = headerRow(sheet);
  if (headers[0] === 'Date' && headers.slice(1).some((header) => / \((?:sets|lb)\)$/.test(header))) return 'archived';
  if (headers[0]?.startsWith('Program:')) return 'archived';
  return 'unrecognized';
}

function headerRow(sheet: SpreadsheetSheet): string[] {
  return (sheet.rows[0] ?? []).map((cell) => (cell.kind === 'text' ? cell.value.trim() : ''));
}

function hasHeaders(sheet: SpreadsheetSheet, required: readonly string[]): boolean {
  const headers = headerRow(sheet);
  return required.every((header) => headers.includes(header));
}

function dataRowCount(sheet: SpreadsheetSheet): number {
  return sheet.rows.slice(1).filter((row) => row.some((cell) => cell.kind !== 'empty')).length;
}

function calendarDate(cell: SpreadsheetCell | undefined): string | null {
  if (!cell) return null;
  const candidate = cell.kind === 'date' ? cell.value : cell.kind === 'text' ? cell.value.trim() : null;
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const [year, month, day] = candidate.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? candidate : null;
}

function describe(cell: SpreadsheetCell | undefined): string {
  if (!cell || cell.kind === 'empty') return '(blank)';
  return String(cell.value);
}
