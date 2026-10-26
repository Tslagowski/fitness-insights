/**
 * Ticket 22: muscle-group balance and stalled lifts (muscle-balance-v1).
 *
 * Working sets (every non-warm-up set, as in ticket 09's weekly count) from eligible, import-confirmed
 * workout days are credited through the owner's exercise-to-muscle mapping: one set to the primary
 * muscle, and the owner's chosen credit (0 or 0.5) to each secondary muscle. Exercises without a
 * mapping are listed with their sets and are never guessed. Weeks start on Monday.
 *
 * Regions follow a fixed table (below). Push/pull and upper/lower ratios use the credited sets of each
 * side in a week and are shown only when both sides have sets; no recommended range is asserted.
 *
 * A lift is stalled when ticket 09's progress label was Stable or Declining in each of the last N
 * rolling comparisons: the latest comparison, then the one ending one scored session earlier, and so on.
 */
import { compare, sessionsPerGroup, weekStart, type Comparison, type ExerciseAnalysis, type ExerciseSession } from './exercise';
import type { MuscleMapping } from '../gateway';

export const muscleMethodVersion = 'muscle-balance-v1';
export const muscleGroups = ['Chest', 'Front Delts', 'Side Delts', 'Rear Delts', 'Triceps', 'Biceps', 'Forearms', 'Upper Back', 'Lats', 'Upper Traps',
  'Neck', 'Serratus', 'Abs', 'Obliques', 'Lower Back', 'Glutes', 'Quads', 'Hamstrings', 'Adductors', 'Abductors', 'Calves', 'Tibialis'] as const;
export type MuscleGroup = (typeof muscleGroups)[number];

export const pushMuscles: readonly string[] = ['Chest', 'Front Delts', 'Side Delts', 'Triceps'];
export const pullMuscles: readonly string[] = ['Upper Back', 'Lats', 'Rear Delts', 'Biceps', 'Upper Traps', 'Forearms'];
export const upperMuscles: readonly string[] = [...pushMuscles, ...pullMuscles, 'Neck', 'Serratus'];
export const lowerMuscles: readonly string[] = ['Quads', 'Glutes', 'Hamstrings', 'Adductors', 'Abductors', 'Calves', 'Tibialis'];
/** Abs, Obliques, and Lower Back are trunk muscles: in neither upper nor lower, push nor pull. */
export const trunkMuscles: readonly string[] = ['Abs', 'Obliques', 'Lower Back'];

export interface MuscleWeek {
  weekStart: string;
  partial: boolean;
  /** Credited sets per muscle (only muscles with sets). */
  muscles: Record<string, number>;
  workingSets: number;
  mappedSets: number;
  unmappedSets: number;
  push: number;
  pull: number;
  upper: number;
  lower: number;
  pushPull: number | null;
  upperLower: number | null;
}

export interface UnmappedExercise { name: string; workingSets: number; lastDate: string }

export interface StallCheck { label: Comparison['label']; changePercent: number | null; recent: ExerciseSession[]; previous: ExerciseSession[] }
export interface StalledLift { name: string; checks: StallCheck[]; lastDate: string }

export interface MuscleAnalysis {
  method: typeof muscleMethodVersion;
  settings: { secondaryCredit: number; stallComparisons: number; bandPercent: number };
  weeks: MuscleWeek[];
  unmapped: UnmappedExercise[];
  stalled: StalledLift[];
  /** Positive-load lifts with too few scored sessions for N comparisons. */
  tooFewForStall: number;
}

const ratio = (left: number, right: number) => (left > 0 && right > 0 ? left / right : null);
const sum = (record: Record<string, number>, muscles: readonly string[]) => muscles.reduce((total, muscle) => total + (record[muscle] ?? 0), 0);

export function stallChecks(sessions: ExerciseSession[], comparisons: number, bandPercent: number): StallCheck[] | null {
  const scored = sessions.filter((session) => session.best);
  if (scored.length < sessionsPerGroup * 2 + comparisons - 1) return null;
  return Array.from({ length: comparisons }, (_, offset) => {
    const result = compare('loaded', scored.slice(0, scored.length - offset), bandPercent);
    return { label: result.label, changePercent: result.changePercent, recent: result.recent, previous: result.previous };
  });
}

export function analyzeMuscles(exercises: ExerciseAnalysis, mapping: Record<string, MuscleMapping>, settings: { secondaryCredit: number; stallComparisons: number }): MuscleAnalysis {
  const weeks = new Map<string, MuscleWeek>();
  for (const week of exercises.weekly) {
    weeks.set(week.weekStart, { weekStart: week.weekStart, partial: week.partial, muscles: {}, workingSets: 0, mappedSets: 0, unmappedSets: 0, push: 0, pull: 0, upper: 0, lower: 0, pushPull: null, upperLower: null });
  }
  const unmapped = new Map<string, UnmappedExercise>();
  for (const exercise of exercises.exercises) {
    const map = mapping[exercise.name];
    for (const session of exercise.sessions) {
      if (!session.workingSets) continue;
      const week = weeks.get(weekStart(session.date));
      if (!week) continue;
      week.workingSets += session.workingSets;
      if (!map) {
        week.unmappedSets += session.workingSets;
        const entry = unmapped.get(exercise.name) ?? { name: exercise.name, workingSets: 0, lastDate: session.date };
        entry.workingSets += session.workingSets;
        if (session.date > entry.lastDate) entry.lastDate = session.date;
        unmapped.set(exercise.name, entry);
        continue;
      }
      week.mappedSets += session.workingSets;
      week.muscles[map.primary] = (week.muscles[map.primary] ?? 0) + session.workingSets;
      if (settings.secondaryCredit > 0) for (const muscle of map.secondary) week.muscles[muscle] = (week.muscles[muscle] ?? 0) + session.workingSets * settings.secondaryCredit;
    }
  }
  for (const week of weeks.values()) {
    week.push = sum(week.muscles, pushMuscles);
    week.pull = sum(week.muscles, pullMuscles);
    week.upper = sum(week.muscles, upperMuscles);
    week.lower = sum(week.muscles, lowerMuscles);
    week.pushPull = ratio(week.push, week.pull);
    week.upperLower = ratio(week.upper, week.lower);
  }
  const bandPercent = exercises.settings.bandPercent;
  const stalled: StalledLift[] = [];
  let tooFewForStall = 0;
  for (const exercise of exercises.exercises) {
    if (exercise.kind !== 'loaded') continue;
    const checks = stallChecks(exercise.sessions, settings.stallComparisons, bandPercent);
    if (!checks) { tooFewForStall += 1; continue; }
    if (checks.every((check) => check.label === 'Stable' || check.label === 'Declining')) stalled.push({ name: exercise.name, checks, lastDate: exercise.lastDate });
  }
  return {
    method: muscleMethodVersion, settings: { ...settings, bandPercent },
    weeks: [...weeks.values()],
    unmapped: [...unmapped.values()].sort((left, right) => right.workingSets - left.workingSets || left.name.localeCompare(right.name)),
    stalled, tooFewForStall,
  };
}

/** Mean credited sets per muscle over the complete weeks given. */
export function meanWeeklySets(weeks: MuscleWeek[]): Array<{ muscle: string; mean: number; weeks: number }> {
  const complete = weeks.filter((week) => !week.partial);
  if (!complete.length) return [];
  return muscleGroups.map((muscle) => ({ muscle, mean: complete.reduce((total, week) => total + (week.muscles[muscle] ?? 0), 0) / complete.length, weeks: complete.length }))
    .filter((row) => row.mean > 0).sort((left, right) => right.mean - left.mean);
}
