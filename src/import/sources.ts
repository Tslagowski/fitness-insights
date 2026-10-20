import { CsvParseError, decodeText, parseCsv } from './csv';
import { combineFoodSources, hasFoodHeaders, parseFoodRows, type FoodDay, type FoodFinding } from './food';
import { parseWorkbook, WorkbookImportError, type WorkbookImport } from './workbook';

/**
 * Turns the files chosen for one import into a single plan. Files are recognized by content and
 * headers, never by name. One import may combine a workbook and a food CSV.
 */

export type SourceKind = 'workbook' | 'food_csv';

export interface SelectedFile {
  name: string;
  bytes: Uint8Array;
}

export interface PlannedSource {
  name: string;
  kind: SourceKind;
  byteSize: number;
  mediaType: string;
  bytes: Uint8Array;
}

export interface ImportPlan {
  sources: PlannedSource[];
  /** Daily summary records from the workbook, if one was selected. */
  daily: WorkbookImport | null;
  /** Food days after applying in-import precedence (CSV over workbook Food Log), if any food detail was selected. */
  food: {
    days: FoodDay[];
    entries: number;
    csvEntries: number;
    workbookEntries: number;
    overriddenWorkbookDates: string[];
    findings: FoodFinding[];
    ignoredColumns: string[];
  } | null;
}

export class ImportPlanError extends Error {}

const workoutHeaders = ['Date', 'Workout', 'Exercise', 'Set Type', 'Weight (lb)', 'Reps'];
export const mediaTypes: Record<SourceKind, string> = {
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  food_csv: 'text/csv',
};

export function planImport(files: SelectedFile[]): ImportPlan {
  if (!files.length) throw new ImportPlanError('Choose at least one file.');
  const sources: PlannedSource[] = [];
  let daily: WorkbookImport | null = null;
  let workbookFood: ReturnType<typeof parseFoodRows> | null = null;
  let csvFood: ReturnType<typeof parseFoodRows> | null = null;

  for (const file of files) {
    const isZip = file.bytes.length > 3 && file.bytes[0] === 0x50 && file.bytes[1] === 0x4b;
    if (isZip) {
      if (daily) throw new ImportPlanError('More than one workbook was selected. Choose one workbook per import. Nothing was changed.');
      try {
        daily = parseWorkbook(file.bytes);
      } catch (error) {
        throw new ImportPlanError(`${file.name}: ${error instanceof WorkbookImportError ? error.message : 'This workbook could not be read.'}`);
      }
      workbookFood = daily.foodLog;
      sources.push({ name: file.name, kind: 'workbook', byteSize: file.bytes.length, mediaType: mediaTypes.workbook, bytes: file.bytes });
      continue;
    }
    let rows: string[][];
    try {
      rows = parseCsv(decodeText(file.bytes));
    } catch (error) {
      throw new ImportPlanError(`${file.name}: ${error instanceof CsvParseError ? error.message : 'This file could not be read.'} Nothing was changed.`);
    }
    const headers = (rows[0] ?? []).map((header) => header.trim());
    if (hasFoodHeaders(headers)) {
      if (csvFood) throw new ImportPlanError('More than one food CSV was selected. Choose one food CSV per import. Nothing was changed.');
      csvFood = parseFoodRows(headers, rows.slice(1), 'food_csv', file.name);
      sources.push({ name: file.name, kind: 'food_csv', byteSize: file.bytes.length, mediaType: mediaTypes.food_csv, bytes: file.bytes });
    } else if (workoutHeaders.every((header) => headers.includes(header))) {
      throw new ImportPlanError(`${file.name} is a workout CSV. Workout imports arrive in a later update; remove it and import the other files. Nothing was changed.`);
    } else {
      throw new ImportPlanError(`${file.name} is not a recognized MacroFactor export (expected the .xlsx workbook or the food CSV). Nothing was changed.`);
    }
  }

  let food: ImportPlan['food'] = null;
  if (csvFood || (workbookFood && workbookFood.entryCount)) {
    const combined = combineFoodSources(csvFood?.days ?? [], workbookFood?.days ?? []);
    food = {
      days: combined.days,
      entries: combined.days.reduce((total, day) => total + day.entries.length, 0),
      csvEntries: csvFood?.entryCount ?? 0,
      workbookEntries: workbookFood?.entryCount ?? 0,
      overriddenWorkbookDates: combined.overriddenWorkbookDates,
      findings: [...(csvFood?.findings ?? []), ...(workbookFood?.findings ?? [])],
      ignoredColumns: [...new Set([...(csvFood?.ignoredColumns ?? []), ...(workbookFood?.ignoredColumns ?? [])])],
    };
  }
  if (!daily && !food) throw new ImportPlanError('The selected files contain no daily or food records. Nothing was changed.');
  return { sources, daily, food };
}
