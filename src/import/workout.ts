/**
 * Workout sets (ticket 05) from a MacroFactor workout CSV or the workbook's Workout Log sheet.
 * Each date becomes one "workout day": every set in original source order, keeping legitimately
 * identical sets. Values keep their original labels and units exactly as logged: loads are per hand
 * for dumbbells, reps per side for unilateral movements, negative weight is machine assistance, and
 * "Exercise Base Weight (lb)" is metadata that is never added to the logged load. A blank value is
 * absent (not recorded), never zero.
 */
import type { FoodCell } from './food';

export type WorkoutSource = 'workout_csv' | 'workbook_workout_log';
export type WorkoutSet = Record<string, string | number>;

export interface WorkoutDay {
  date: string;
  source: WorkoutSource;
  sets: WorkoutSet[];
}

export interface WorkoutFinding {
  source: string;
  row: number;
  column: string;
  value: string;
  problem: string;
}

export interface ParsedWorkouts {
  days: WorkoutDay[];
  setCount: number;
  findings: WorkoutFinding[];
  ignoredColumns: string[];
}

export const requiredWorkoutHeaders = ['Date', 'Workout Duration', 'Workout', 'Exercise', 'Set Type', 'Weight (lb)', 'Reps'];
const textColumns = new Set(['Workout', 'Exercise', 'Set Type']);
const numericColumns = new Set(['Workout Duration', 'Exercise Base Weight (lb)', 'Weight (lb)', 'Reps', 'RIR', 'Duration', 'Distance short (Yd)', 'Distance long (Mi)']);

export const workoutSourceLabels: Record<WorkoutSource, string> = {
  workout_csv: 'Workout CSV',
  workbook_workout_log: 'Workbook Workout Log',
};

export function hasWorkoutHeaders(headers: string[]): boolean {
  return requiredWorkoutHeaders.every((header) => headers.includes(header));
}

export function parseWorkoutRows(headers: string[], rows: FoodCell[][], source: WorkoutSource, sourceName: string): ParsedWorkouts {
  const findings: WorkoutFinding[] = [];
  const byDate = new Map<string, WorkoutSet[]>();
  const dateColumn = headers.indexOf('Date');
  const kept = headers.map((header, index) => ({ header, index })).filter(({ header }) => textColumns.has(header) || numericColumns.has(header));
  const ignoredColumns = headers.filter((header) => header && header !== 'Date' && !textColumns.has(header) && !numericColumns.has(header));
  let setCount = 0;

  rows.forEach((row, offset) => {
    const rowNumber = offset + 2;
    if (row.every((cell) => cell === null || cell === '')) return;
    const date = calendarDate(row[dateColumn]);
    if (!date) {
      findings.push({ source: sourceName, row: rowNumber, column: 'Date', value: String(row[dateColumn] ?? '(blank)'), problem: 'Not a valid calendar date; this set was not imported.' });
      return;
    }
    const set: WorkoutSet = {};
    for (const { header, index } of kept) {
      const cell = row[index];
      if (cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')) continue;
      if (textColumns.has(header)) { set[header] = String(cell); continue; }
      const text = typeof cell === 'number' ? '' : cell.trim();
      const value = typeof cell === 'number' ? cell : Number(text);
      if (Number.isFinite(value) && (typeof cell === 'number' || /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(text))) set[header] = value;
      else findings.push({ source: sourceName, row: rowNumber, column: header, value: String(cell), problem: 'Expected a number; kept as not recorded, not zero.' });
    }
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(set);
    setCount += 1;
  });

  const days = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, sets]) => ({ date, source, sets }));
  return { days, setCount, findings, ignoredColumns };
}

/** Combines sources from one import: the workout CSV wins on any date it represents; the workbook fills the rest. */
export function combineWorkoutSources(csvDays: WorkoutDay[], workbookDays: WorkoutDay[]): { days: WorkoutDay[]; overriddenWorkbookDates: string[] } {
  const csvDates = new Set(csvDays.map((day) => day.date));
  return {
    days: [...csvDays, ...workbookDays.filter((day) => !csvDates.has(day.date))].sort((left, right) => left.date.localeCompare(right.date)),
    overriddenWorkbookDates: workbookDays.filter((day) => csvDates.has(day.date)).map((day) => day.date),
  };
}

export interface WorkoutSession {
  /** Workout name as logged. */
  workout: string | null;
  /** Raw "Workout Duration" value as logged (unit unverified); repeated on every set, never summed. */
  durationRaw: number | null;
  exercises: Array<{ name: string; sets: WorkoutSet[] }>;
  setCount: number;
}

/**
 * Groups a day's sets into sessions by the documented tuple (date, workout name, workout duration).
 * The export has no session identifier, so two identical same-day sessions cannot be told apart and
 * are shown as one. Exercise and set order follow the source.
 */
export function groupSessions(sets: WorkoutSet[]): WorkoutSession[] {
  const sessions = new Map<string, WorkoutSession>();
  for (const set of sets) {
    const workout = typeof set.Workout === 'string' ? set.Workout : null;
    const durationRaw = typeof set['Workout Duration'] === 'number' ? set['Workout Duration'] : null;
    const key = JSON.stringify([workout, durationRaw]);
    if (!sessions.has(key)) sessions.set(key, { workout, durationRaw, exercises: [], setCount: 0 });
    const session = sessions.get(key)!;
    const name = typeof set.Exercise === 'string' ? set.Exercise : '(unnamed exercise)';
    let exercise = session.exercises.find((item) => item.name === name);
    if (!exercise) { exercise = { name, sets: [] }; session.exercises.push(exercise); }
    exercise.sets.push(set);
    session.setCount += 1;
  }
  return [...sessions.values()];
}

export type DurationUnit = 'seconds' | 'minutes';

/** Formats a raw duration under the owner's (provisional) unit interpretation. */
export function formatDuration(raw: number | null | undefined, unit: DurationUnit): string {
  if (raw === null || raw === undefined) return '—';
  const totalSeconds = Math.round(unit === 'seconds' ? raw : raw * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
  return `${seconds} s`;
}

/** A superset label suffix like " ∈ SS1" that MacroFactor appends to exercise names. */
const supersetSuffix = /\s*∈\s*SS\d+$/;
export function supersetBaseName(name: string): string | null {
  return supersetSuffix.test(name) ? name.replace(supersetSuffix, '') : null;
}

function calendarDate(cell: FoodCell | undefined): string | null {
  const candidate = typeof cell === 'string' ? cell.trim() : null;
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const [year, month, day] = candidate.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? candidate : null;
}
