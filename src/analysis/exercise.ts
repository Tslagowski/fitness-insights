/**
 * Ticket 09: exercise performance and workload from saved workout sets.
 *
 * Logged values are used exactly as recorded: loads are per hand where that is how the exercise is
 * logged, reps are per side for unilateral movements, negative weight is machine assistance, and
 * "Exercise Base Weight (lb)" is never added. No RIR correction. Only completed days confirmed by an
 * import (ticket 06 eligibility) count; today and future days never enter a comparison.
 */
import type { SavedWorkoutDay } from '../gateway';
import type { DurationUnit, WorkoutSet } from '../import/workout';
import { addDays, median, type EligibilityReport } from './eligibility';

export const exerciseMethodVersion = 'exercise-v1';
export const qualifyingSetTypes = ['Standard Set', 'Failure Set'];
export const warmUpSetType = 'Warm-Up Set';
export const minimumReps = 1;
export const maximumReps = 10;
export const sessionsPerGroup = 3;

export type MovementKind = 'loaded' | 'assisted' | 'bodyweight' | 'timed' | 'mixed';
export type ProgressLabel = 'Progressing' | 'Stable' | 'Declining' | 'Insufficient data' | 'Not scored';

export const movementLabels: Record<MovementKind, string> = {
  loaded: 'Positive logged load',
  assisted: 'Machine-assisted (negative weight)',
  bodyweight: 'Bodyweight or zero load',
  timed: 'Timed',
  mixed: 'Mixed load types',
};

export interface BestSet { load: number; reps: number; score: number; setType: string }

export interface ExerciseSession {
  date: string;
  workout: string | null;
  /** Raw "Workout Duration" (unit unverified); part of the session grouping key only. */
  durationRaw: number | null;
  loggedNames: string[];
  sets: WorkoutSet[];
  /** Highest-scoring qualifying set, or null when the session has none. */
  best: BestSet | null;
  /** Sets that are not warm-ups, including valid sets with a blank load. */
  workingSets: number;
  /** Σ load × reps over non-warm-up sets with a nonnegative logged load and reps; null when none qualify. */
  loggedLoadVolume: number | null;
  /** Assisted: the least assistance used (closest to zero) and the most reps at it. */
  leastAssistance: { load: number; reps: number | null } | null;
  /** Bodyweight or zero-load: most reps in one set and total reps. */
  bodyweightReps: { max: number; total: number } | null;
  /** Timed: longest raw Duration value. */
  longestDuration: number | null;
}

export interface Comparison {
  label: ProgressLabel;
  reason: string;
  recent: ExerciseSession[];
  previous: ExerciseSession[];
  recentMedian: number | null;
  previousMedian: number | null;
  /** (recent median / previous median − 1) × 100, only for a positive previous median. */
  changePercent: number | null;
}

export interface RepsAtLoad { load: number; previousBest: number; recentBest: number }

export interface ExerciseSummary {
  name: string;
  loggedNames: string[];
  kind: MovementKind;
  sessions: ExerciseSession[];
  scoredSessions: number;
  comparison: Comparison;
  repsAtLoads: RepsAtLoad[];
  lastDate: string;
}

export interface WeekSets { weekStart: string; workingSets: number; partial: boolean }

export interface ExerciseAnalysis {
  method: typeof exerciseMethodVersion;
  settings: { bandPercent: number; durationUnit: DurationUnit };
  cutoff: string | null;
  exercises: ExerciseSummary[];
  weekly: WeekSets[];
  /** Workout dates left out of completed comparisons, by reason. */
  leftOut: { today: number; future: number; unconfirmed: number };
}

export const strengthScore = (load: number, reps: number) => load * (1 + reps / 30);

const numeric = (set: WorkoutSet, field: string) => (typeof set[field] === 'number' && Number.isFinite(set[field] as number) ? (set[field] as number) : null);
const setType = (set: WorkoutSet) => (typeof set['Set Type'] === 'string' ? (set['Set Type'] as string) : '');
const isWarmUp = (set: WorkoutSet) => setType(set) === warmUpSetType;

type SetKind = 'loaded' | 'assisted' | 'bodyweight' | 'timed' | null;
export function setKind(set: WorkoutSet): SetKind {
  const load = numeric(set, 'Weight (lb)');
  const reps = numeric(set, 'Reps');
  if (load !== null && load < 0) return 'assisted';
  if (load !== null && load > 0) return 'loaded';
  if (reps !== null) return 'bodyweight';
  if (numeric(set, 'Duration') !== null) return 'timed';
  return null;
}

/** Qualifying estimated-strength set: positive logged load, 1-10 reps, Standard or Failure set. */
export function qualifies(set: WorkoutSet): boolean {
  const load = numeric(set, 'Weight (lb)');
  const reps = numeric(set, 'Reps');
  return load !== null && load > 0 && reps !== null && reps >= minimumReps && reps <= maximumReps && qualifyingSetTypes.includes(setType(set));
}

export function movementKind(sets: WorkoutSet[]): MovementKind {
  const kinds = new Set(sets.filter((set) => !isWarmUp(set)).map(setKind).filter((kind) => kind !== null));
  if (kinds.has('loaded') && (kinds.has('assisted') || kinds.has('timed'))) return 'mixed';
  if (kinds.has('loaded')) return 'loaded';
  if (kinds.has('assisted')) return 'assisted';
  if (kinds.has('bodyweight')) return 'bodyweight';
  if (kinds.has('timed')) return 'timed';
  return 'bodyweight';
}

type RawSession = Pick<ExerciseSession, 'date' | 'workout' | 'durationRaw' | 'loggedNames' | 'sets'>;

function describeSession(base: RawSession): ExerciseSession {
  const working = base.sets.filter((set) => !isWarmUp(set));
  let best: BestSet | null = null;
  for (const set of base.sets) {
    if (!qualifies(set)) continue;
    const load = numeric(set, 'Weight (lb)')!;
    const reps = numeric(set, 'Reps')!;
    const score = strengthScore(load, reps);
    if (!best || score > best.score) best = { load, reps, score, setType: setType(set) };
  }
  const volumeSets = working.filter((set) => { const load = numeric(set, 'Weight (lb)'); return load !== null && load >= 0 && numeric(set, 'Reps') !== null; });
  const assisted = working.filter((set) => setKind(set) === 'assisted');
  const leastLoad = assisted.length ? Math.max(...assisted.map((set) => numeric(set, 'Weight (lb)')!)) : null;
  const atLeast = assisted.filter((set) => numeric(set, 'Weight (lb)') === leastLoad).map((set) => numeric(set, 'Reps')).filter((reps): reps is number => reps !== null);
  const bodyweight = working.filter((set) => setKind(set) === 'bodyweight').map((set) => numeric(set, 'Reps')!);
  const durations = working.map((set) => numeric(set, 'Duration')).filter((value): value is number => value !== null);
  return {
    ...base, best,
    workingSets: working.length,
    loggedLoadVolume: volumeSets.length ? volumeSets.reduce((sum, set) => sum + numeric(set, 'Weight (lb)')! * numeric(set, 'Reps')!, 0) : null,
    leastAssistance: leastLoad === null ? null : { load: leastLoad, reps: atLeast.length ? Math.max(...atLeast) : null },
    bodyweightReps: bodyweight.length ? { max: Math.max(...bodyweight), total: bodyweight.reduce((sum, reps) => sum + reps, 0) } : null,
    longestDuration: durations.length ? Math.max(...durations) : null,
  };
}

function compare(kind: MovementKind, sessions: ExerciseSession[], bandPercent: number): Comparison {
  const empty = { recent: [], previous: [], recentMedian: null, previousMedian: null, changePercent: null };
  if (kind !== 'loaded') {
    const reason = kind === 'mixed' ? 'Mixes positive-load sets with assisted or timed sets, so no single strength label is shown; see each session.'
      : kind === 'assisted' ? 'Assisted movements are shown through assistance and reps, not a positive-load strength score.'
      : kind === 'timed' ? 'Timed movements are shown through duration, not a strength score.'
      : 'Bodyweight and zero-load sets are shown through reps, not a strength score.';
    return { label: 'Not scored', reason, ...empty };
  }
  const scored = sessions.filter((session) => session.best);
  if (scored.length < sessionsPerGroup * 2) {
    return { label: 'Insufficient data', reason: `Needs ${sessionsPerGroup * 2} completed sessions with a qualifying set; ${scored.length} available.`, ...empty };
  }
  const recent = scored.slice(-sessionsPerGroup);
  const previous = scored.slice(-sessionsPerGroup * 2, -sessionsPerGroup);
  const recentMedian = median(recent.map((session) => session.best!.score));
  const previousMedian = median(previous.map((session) => session.best!.score));
  const changePercent = previousMedian > 0 ? (recentMedian / previousMedian - 1) * 100 : null;
  // Compare at a fixed precision so a change of exactly ±band lands in Stable despite floating-point noise.
  const rounded = changePercent === null ? null : Math.round(changePercent * 1e6) / 1e6;
  const label: ProgressLabel = rounded === null ? 'Insufficient data' : rounded > bandPercent ? 'Progressing' : rounded < -bandPercent ? 'Declining' : 'Stable';
  const reason = `Median best score of the latest ${sessionsPerGroup} sessions vs the ${sessionsPerGroup} before; above +${bandPercent}% is Progressing, below −${bandPercent}% Declining, otherwise Stable.`;
  return { label, reason, recent, previous, recentMedian, previousMedian, changePercent };
}

function repsAtLoads(comparison: Comparison): RepsAtLoad[] {
  const bestReps = (sessions: ExerciseSession[]) => {
    const byLoad = new Map<number, number>();
    // Any working set with a positive logged load and reps (not only 1-10 reps), so rep progression stays visible.
    const working = sessions.flatMap((session) => session.sets).filter((set) => !isWarmUp(set) && (numeric(set, 'Weight (lb)') ?? 0) > 0 && (numeric(set, 'Reps') ?? 0) >= 1);
    for (const set of working) {
      const load = numeric(set, 'Weight (lb)')!;
      byLoad.set(load, Math.max(byLoad.get(load) ?? 0, numeric(set, 'Reps')!));
    }
    return byLoad;
  };
  const recent = bestReps(comparison.recent);
  const previous = bestReps(comparison.previous);
  return [...recent.keys()].filter((load) => previous.has(load)).sort((left, right) => right - left)
    .map((load) => ({ load, previousBest: previous.get(load)!, recentBest: recent.get(load)! }));
}

/** Monday of the calendar week containing the date (integer day arithmetic; no timezone conversion). */
export function weekStart(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function analyzeExercises(days: SavedWorkoutDay[], report: EligibilityReport, aliases: Record<string, string>, settings: { bandPercent: number; durationUnit: DurationUnit }): ExerciseAnalysis {
  const statusByDate = new Map(report.days.map((day) => [day.date, day]));
  const leftOut = { today: 0, future: 0, unconfirmed: 0 };
  const sessions = new Map<string, RawSession[]>();
  const weekly = new Map<string, number>();
  for (const day of [...days].sort((left, right) => left.date.localeCompare(right.date))) {
    const status = statusByDate.get(day.date)?.workouts ?? { eligible: false as const, reason: day.date > report.today ? 'future' as const : day.date === report.today ? 'in-progress' as const : 'after-import-cutoff' as const };
    if (!status.eligible) {
      if (status.reason === 'in-progress') leftOut.today += 1;
      else if (status.reason === 'future') leftOut.future += 1;
      else leftOut.unconfirmed += 1;
      continue;
    }
    const week = weekStart(day.date);
    const byKey = new Map<string, RawSession>();
    for (const set of day.sets) {
      if (!isWarmUp(set)) weekly.set(week, (weekly.get(week) ?? 0) + 1);
      const logged = typeof set.Exercise === 'string' ? set.Exercise : '(unnamed exercise)';
      const name = aliases[logged] ?? logged;
      const workout = typeof set.Workout === 'string' ? set.Workout : null;
      const durationRaw = numeric(set, 'Workout Duration');
      const key = JSON.stringify([workout, durationRaw, name]);
      let session = byKey.get(key);
      if (!session) {
        session = { date: day.date, workout, durationRaw, loggedNames: [], sets: [] };
        byKey.set(key, session);
        if (!sessions.has(name)) sessions.set(name, []);
        sessions.get(name)!.push(session);
      }
      if (!session.loggedNames.includes(logged)) session.loggedNames.push(logged);
      session.sets.push(set);
    }
  }
  const exercises = [...sessions.entries()].map(([name, raw]): ExerciseSummary => {
    const described = raw.map(describeSession);
    const kind = movementKind(described.flatMap((session) => session.sets));
    const comparison = compare(kind, described, settings.bandPercent);
    return {
      name, kind, sessions: described, comparison,
      loggedNames: [...new Set(described.flatMap((session) => session.loggedNames))].sort(),
      scoredSessions: described.filter((session) => session.best).length,
      repsAtLoads: comparison.recent.length ? repsAtLoads(comparison) : [],
      lastDate: described.at(-1)!.date,
    };
  }).sort((left, right) => right.lastDate.localeCompare(left.lastDate) || left.name.localeCompare(right.name));

  const cutoff = report.cutoffs.workouts;
  const weeks = [...weekly.keys()].sort();
  const allWeeks: WeekSets[] = [];
  if (weeks.length) {
    for (let week = weeks[0]; week <= weeks.at(-1)!; week = addDays(week, 7)) {
      allWeeks.push({ weekStart: week, workingSets: weekly.get(week) ?? 0, partial: !cutoff || addDays(week, 6) > cutoff });
    }
  }
  return { method: exerciseMethodVersion, settings, cutoff, exercises, weekly: allWeeks, leftOut };
}
