/**
 * Ticket 27: MacroFactor's full data export, which keeps each measure on its own sheet.
 *
 * Sheets are recognized by their headers, never by name. The per-measure sheets become the same
 * daily records as the quick export (same column labels, blank stays missing). A domain gets a
 * record only for dates its own sheet lists, so dates absent from a sheet are never touched.
 * Targets are derived from the nutrition program history; profile and settings sheets are never read.
 */
import type { SpreadsheetCell, SpreadsheetSheet } from './xlsx';
import type { DailyDomain, DailyRecord, DailyValues, ImportFinding, SheetDisposition } from './workbook';

export const targetDerivationVersion = 'program-weekday-v1';

interface MeasureSheet { domain: DailyDomain; columns: string[]; optional?: string[] }

/** Each daily domain comes from the sheet whose header row is exactly Date plus these columns (in any order). */
const measureSheets: MeasureSheet[] = [
  { domain: 'nutrition_totals', columns: ['Calories (kcal)', 'Protein (g)', 'Fat (g)', 'Carbs (g)'] },
  { domain: 'scale_weight', columns: ['Weight (lb)'], optional: ['Fat Percent'] },
  { domain: 'trend_weight', columns: ['Trend Weight (lb)'] },
  { domain: 'expenditure', columns: ['Expenditure'] },
  { domain: 'steps', columns: ['Steps'] },
];
/** The quick export's nutrition totals also carry these; the full export keeps them on the micronutrient sheet. */
const carriedNutrients = ['Alcohol (g)', 'Fiber (g)'];
const programHeaders = ['Program Update Date', 'Program Weekday', 'Calories (kcal)', 'Fat (g)', 'Protein (g)', 'Carbs (g)'];
const targetColumns: Record<string, string> = { 'Calories (kcal)': 'Target Calories (kcal)', 'Protein (g)': 'Target Protein (g)', 'Fat (g)': 'Target Fat (g)', 'Carbs (g)': 'Target Carbs (g)' };
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Sheets that hold personal profile or app settings: kept in the private archive, never parsed. */
const privateFirstHeaders = new Set(['Name']);

export class FullExportError extends Error {}

export interface FullExportResult {
  records: DailyRecord[];
  findings: ImportFinding[];
  /** Sheet name per role, for the preview. */
  sources: Array<{ sheet: string; role: string }>;
  dispositions: Map<SpreadsheetSheet, SheetDisposition>;
  targets: { version: string; updates: number; firstUpdate: string | null; daysDerived: number } | null;
  /** Dates the owner flagged as partial logging in MacroFactor (offered as incomplete-day suggestions). */
  partialLoggingDates: string[];
}

const headerRow = (sheet: SpreadsheetSheet) => (sheet.rows[0] ?? []).map((cell) => (cell.kind === 'text' ? cell.value.trim() : ''));

/** True when the workbook looks like the full export (separate calorie and weight sheets). */
export function isFullExport(sheets: SpreadsheetSheet[]): boolean {
  const matches = measureSheets.filter((measure) => sheets.some((sheet) => matchesMeasure(sheet, measure)));
  return matches.some((measure) => measure.domain === 'nutrition_totals') && matches.length >= 3;
}

function matchesMeasure(sheet: SpreadsheetSheet, measure: MeasureSheet): boolean {
  const headers = headerRow(sheet).filter(Boolean);
  if (headers[0] !== 'Date') return false;
  const rest = headers.slice(1);
  return measure.columns.every((column) => rest.includes(column)) && rest.every((column) => measure.columns.includes(column) || (measure.optional ?? []).includes(column));
}

/** A calendar date from a date cell, an ISO string, or MacroFactor's M/D/YYYY text. */
export function exportDate(cell: SpreadsheetCell | undefined): string | null {
  if (!cell || cell.kind === 'empty') return null;
  let year: number; let month: number; let day: number;
  const text = cell.kind === 'date' ? cell.value : cell.kind === 'text' ? cell.value.trim() : '';
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); }
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) { month = Number(match[1]); day = Number(match[2]); year = Number(match[3]); }
  else return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return check.toISOString().slice(0, 10);
}

const describe = (cell: SpreadsheetCell | undefined) => (!cell || cell.kind === 'empty' ? '(blank)' : String(cell.value));
const addDay = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };
const weekdayOf = (date: string) => { const [y, m, d] = date.split('-').map(Number); return weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };

function readMeasure(sheet: SpreadsheetSheet, domain: DailyDomain, columns: string[], findings: ImportFinding[]): Map<string, DailyValues> {
  const headers = headerRow(sheet);
  const byDate = new Map<string, DailyValues>();
  const seen = new Map<string, number>();
  sheet.rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    if (row.every((cell) => cell.kind === 'empty')) return;
    const date = exportDate(row[headers.indexOf('Date')]);
    if (!date) {
      findings.push({ sheet: sheet.name, row: rowNumber, column: 'Date', value: describe(row[headers.indexOf('Date')]), problem: 'Not a valid calendar date; this row was not imported.' });
      return;
    }
    if (seen.has(date)) throw new FullExportError(`The date ${date} appears twice on "${sheet.name}" (rows ${seen.get(date)} and ${rowNumber}). The export is ambiguous, so nothing was imported.`);
    seen.set(date, rowNumber);
    const values: DailyValues = {};
    for (const column of columns) {
      const index = headers.indexOf(column);
      if (index < 0) continue;
      const cell = row[index];
      if (!cell || cell.kind === 'empty') values[column] = null;
      else if (cell.kind === 'number') values[column] = cell.value;
      else { values[column] = null; findings.push({ sheet: sheet.name, row: rowNumber, column, value: describe(cell), problem: `Expected a number for ${domain.replace('_', ' ')}; kept as unavailable, not zero.` }); }
    }
    byDate.set(date, values);
  });
  return byDate;
}

/**
 * Daily targets from the program history: for each date, the latest Program Update Date on or before it,
 * using that update's row for the date's weekday. Dates before the first update get no target.
 */
export function deriveTargets(sheet: SpreadsheetSheet, lastDate: string, findings: ImportFinding[]) {
  const headers = headerRow(sheet);
  const updates = new Map<string, Map<string, DailyValues>>();
  sheet.rows.slice(1).forEach((row, offset) => {
    if (row.every((cell) => cell.kind === 'empty')) return;
    const date = exportDate(row[headers.indexOf('Program Update Date')]);
    const weekdayCell = row[headers.indexOf('Program Weekday')];
    const weekday = weekdayCell?.kind === 'text' ? weekdayCell.value.trim() : '';
    if (!date || !weekdays.includes(weekday)) {
      findings.push({ sheet: sheet.name, row: offset + 2, column: 'Program Update Date', value: `${describe(row[headers.indexOf('Program Update Date')])} ${weekday}`, problem: 'Not a valid program date and weekday; this target row was not used.' });
      return;
    }
    const values: DailyValues = {};
    for (const [source, target] of Object.entries(targetColumns)) {
      const cell = row[headers.indexOf(source)];
      values[target] = cell?.kind === 'number' ? cell.value : null;
    }
    if (!updates.has(date)) updates.set(date, new Map());
    updates.get(date)!.set(weekday, values);
  });
  const ordered = [...updates.keys()].sort();
  const targets = new Map<string, DailyValues>();
  if (!ordered.length) return { targets, updates: 0, firstUpdate: null };
  let index = 0;
  for (let date = ordered[0]; date <= lastDate; date = addDay(date, 1)) {
    while (index + 1 < ordered.length && ordered[index + 1] <= date) index += 1;
    const values = updates.get(ordered[index])!.get(weekdayOf(date));
    if (values) targets.set(date, values);
  }
  return { targets, updates: ordered.length, firstUpdate: ordered[0] };
}

export function parseFullExport(sheets: SpreadsheetSheet[]): FullExportResult {
  const findings: ImportFinding[] = [];
  const dispositions = new Map<SpreadsheetSheet, SheetDisposition>();
  const sources: FullExportResult['sources'] = [];
  const byDomain = new Map<DailyDomain, Map<string, DailyValues>>();
  for (const measure of measureSheets) {
    const candidates = sheets.filter((sheet) => matchesMeasure(sheet, measure));
    if (candidates.length > 1) throw new FullExportError(`More than one sheet looks like the ${measure.domain.replace('_', ' ')} sheet (${candidates.map((sheet) => `"${sheet.name}"`).join(', ')}). Nothing was changed.`);
    if (!candidates.length) continue;
    const sheet = candidates[0];
    dispositions.set(sheet, 'imported');
    sources.push({ sheet: sheet.name, role: measure.domain });
    // Optional columns (Fat Percent) are archived only, so values match the quick export exactly.
    byDomain.set(measure.domain, readMeasure(sheet, measure.domain, measure.columns, findings));
  }
  // Alcohol and fiber join nutrition totals on matching dates, as in the quick export.
  const micro = sheets.find((sheet) => headerRow(sheet)[0] === 'Date' && carriedNutrients.some((column) => headerRow(sheet).includes(column)) && !dispositions.has(sheet));
  const nutrition = byDomain.get('nutrition_totals');
  if (micro && nutrition) {
    dispositions.set(micro, 'imported');
    sources.push({ sheet: micro.name, role: 'alcohol and fiber (other micronutrients archived)' });
    const extra = readMeasure(micro, 'nutrition_totals', carriedNutrients, findings);
    for (const [date, values] of nutrition) { const more = extra.get(date); if (more) Object.assign(values, more); }
  }
  const allDates = [...byDomain.values()].flatMap((map) => [...map.keys()]).sort();
  if (!allDates.length) throw new FullExportError('The export has no daily rows to import. Nothing was changed.');

  let targets: FullExportResult['targets'] = null;
  const program = sheets.find((sheet) => programHeaders.every((header) => headerRow(sheet).includes(header)));
  if (program) {
    dispositions.set(program, 'imported');
    sources.push({ sheet: program.name, role: 'targets (derived by update date and weekday)' });
    const derived = deriveTargets(program, allDates.at(-1)!, findings);
    byDomain.set('targets', derived.targets);
    targets = { version: targetDerivationVersion, updates: derived.updates, firstUpdate: derived.firstUpdate, daysDerived: derived.targets.size };
  }

  let partialLoggingDates: string[] = [];
  const partial = sheets.find((sheet) => { const headers = headerRow(sheet); return headers[0] === 'Date' && headers[1] === 'Partial Logging'; });
  if (partial) {
    dispositions.set(partial, 'imported');
    sources.push({ sheet: partial.name, role: 'partial-logging suggestions' });
    partialLoggingDates = partial.rows.slice(1).filter((row) => row[1]?.kind === 'text' && row[1].value.trim().toLowerCase() === 'yes')
      .map((row) => exportDate(row[0])).filter((date): date is string => !!date).sort();
  }
  for (const sheet of sheets) {
    if (dispositions.has(sheet)) continue;
    dispositions.set(sheet, privateFirstHeaders.has(headerRow(sheet)[0]) || headerRow(sheet)[0]?.startsWith('Program:') ? 'private' : 'archived');
  }
  const order: DailyDomain[] = ['scale_weight', 'trend_weight', 'expenditure', 'nutrition_totals', 'targets', 'steps'];
  const records: DailyRecord[] = [];
  for (const domain of order) for (const [date, values] of byDomain.get(domain) ?? []) records.push({ date, domain, values });
  records.sort((left, right) => left.date.localeCompare(right.date) || order.indexOf(left.domain) - order.indexOf(right.domain));
  return { records, findings, sources, dispositions, targets, partialLoggingDates };
}
