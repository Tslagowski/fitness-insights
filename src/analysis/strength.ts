/**
 * Ticket 21: estimated strength compared with body weight (strength-bodyweight-v1).
 *
 * Uses ticket 09's estimated-strength score (load × (1 + reps ÷ 30)) over its qualifying sets only:
 * positive logged load, 1-10 reps, Standard or Failure sets. Loads stay as logged (per hand where that is
 * how the exercise is logged); body weight is never added. Assisted, bodyweight, timed, and mixed
 * movements are excluded and listed.
 *
 * Relative strength is the session's best score ÷ MacroFactor's trend weight on the session date, or the
 * nearest eligible trend value within `toleranceDays` (the earlier date wins a tie). No trend value in
 * range leaves the session without a relative value; nothing is interpolated.
 *
 * A window (all history, a ticket 16 phase, or the latest weeks) compares the median of the first three
 * scored sessions in the window with the median of the last three, so it needs six. The strength label
 * uses the owner's ticket 09 band: above +band Gained, below −band Lost, otherwise Kept.
 */
import type { DailyValues } from './daily';
import { medianOf } from './daily';
import { addDays } from './eligibility';
import { sessionsPerGroup, type ExerciseAnalysis, type MovementKind } from './exercise';

export const strengthMethodVersion = 'strength-bodyweight-v1';
export const trendToleranceDays = 3;
/** Relative-strength medians need at least this many of the three sessions matched to a trend value. */
export const minimumMatched = 2;

export type StrengthLabel = 'Gained' | 'Kept' | 'Lost' | 'Insufficient data';

export interface StrengthPoint {
  date: string;
  load: number;
  reps: number;
  score: number;
  trend: number | null;
  trendDate: string | null;
  relative: number | null;
}

export interface WindowChange {
  label: StrengthLabel;
  reason: string;
  first: StrengthPoint[];
  last: StrengthPoint[];
  scoreBefore: number | null;
  scoreAfter: number | null;
  scoreChangePercent: number | null;
  relativeBefore: number | null;
  relativeAfter: number | null;
  relativeChangePercent: number | null;
  trendBefore: number | null;
  trendAfter: number | null;
}

export interface StrengthLift { name: string; points: StrengthPoint[]; change: WindowChange }
export interface ExcludedLift { name: string; kind: MovementKind; reason: string }
export interface StrengthWindow { start: string | null; end: string | null }

export interface StrengthAnalysis {
  method: typeof strengthMethodVersion;
  settings: { bandPercent: number; toleranceDays: number; sessions: number };
  window: StrengthWindow;
  lifts: StrengthLift[];
  excluded: ExcludedLift[];
  /** Scored sessions in the window without a trend value within the tolerance. */
  unmatched: number;
}

const exclusionReasons: Record<Exclude<MovementKind, 'loaded'>, string> = {
  assisted: 'Machine-assisted (negative logged weight): no positive-load score.',
  bodyweight: 'Bodyweight or zero load: no positive-load score, and body weight is never added.',
  timed: 'Timed: no strength score.',
  mixed: 'Mixes positive-load sets with assisted or timed sets.',
};

/** The eligible trend value on the date, else the nearest within the tolerance (earlier first on a tie). */
export function nearestTrend(trendByDate: Map<string, number>, date: string, toleranceDays = trendToleranceDays): { date: string; value: number } | null {
  for (let offset = 0; offset <= toleranceDays; offset += 1) {
    for (const candidate of offset ? [addDays(date, -offset), addDays(date, offset)] : [date]) {
      const value = trendByDate.get(candidate);
      if (value !== undefined) return { date: candidate, value };
    }
  }
  return null;
}

const percentChange = (before: number | null, after: number | null) => (before !== null && after !== null && before > 0 ? (after / before - 1) * 100 : null);

export function compareWindow(points: StrengthPoint[], bandPercent: number): WindowChange {
  const needed = sessionsPerGroup * 2;
  const empty = { first: [], last: [], scoreBefore: null, scoreAfter: null, scoreChangePercent: null, relativeBefore: null, relativeAfter: null, relativeChangePercent: null, trendBefore: null, trendAfter: null };
  if (points.length < needed) return { label: 'Insufficient data', reason: `Needs ${needed} scored sessions in this window; ${points.length} available.`, ...empty };
  const first = points.slice(0, sessionsPerGroup);
  const last = points.slice(-sessionsPerGroup);
  const relative = (group: StrengthPoint[]) => {
    const values = group.flatMap((point) => (point.relative === null ? [] : [point.relative]));
    return values.length >= minimumMatched ? medianOf(values) : null;
  };
  const trend = (group: StrengthPoint[]) => medianOf(group.flatMap((point) => (point.trend === null ? [] : [point.trend])));
  const scoreBefore = medianOf(first.map((point) => point.score));
  const scoreAfter = medianOf(last.map((point) => point.score));
  const scoreChangePercent = percentChange(scoreBefore, scoreAfter);
  const relativeBefore = relative(first);
  const relativeAfter = relative(last);
  const rounded = scoreChangePercent === null ? null : Math.round(scoreChangePercent * 1e6) / 1e6;
  const label: StrengthLabel = rounded === null ? 'Insufficient data' : rounded > bandPercent ? 'Gained' : rounded < -bandPercent ? 'Lost' : 'Kept';
  return {
    label, reason: `Median best score of the last ${sessionsPerGroup} sessions in the window vs the first ${sessionsPerGroup}; above +${bandPercent}% is Gained, below −${bandPercent}% Lost, otherwise Kept.`,
    first, last, scoreBefore, scoreAfter, scoreChangePercent, relativeBefore, relativeAfter,
    relativeChangePercent: percentChange(relativeBefore, relativeAfter), trendBefore: trend(first), trendAfter: trend(last),
  };
}

export function analyzeStrength(exercises: ExerciseAnalysis, days: DailyValues[], window: StrengthWindow = { start: null, end: null }, bandPercent = exercises.settings.bandPercent): StrengthAnalysis {
  const trendByDate = new Map(days.flatMap((day) => (day.trend === null ? [] : [[day.date, day.trend] as [string, number]])));
  const inside = (date: string) => (window.start === null || date >= window.start) && (window.end === null || date <= window.end);
  const lifts: StrengthLift[] = [];
  const excluded: ExcludedLift[] = [];
  let unmatched = 0;
  for (const exercise of exercises.exercises) {
    if (exercise.kind !== 'loaded') {
      if (exercise.sessions.some((session) => inside(session.date))) excluded.push({ name: exercise.name, kind: exercise.kind, reason: exclusionReasons[exercise.kind] });
      continue;
    }
    const points = exercise.sessions.filter((session) => session.best && inside(session.date)).map((session): StrengthPoint => {
      const match = nearestTrend(trendByDate, session.date);
      if (!match) unmatched += 1;
      const { load, reps, score } = session.best!;
      return { date: session.date, load, reps, score, trend: match?.value ?? null, trendDate: match?.date ?? null, relative: match ? score / match.value : null };
    });
    if (points.length) lifts.push({ name: exercise.name, points, change: compareWindow(points, bandPercent) });
  }
  lifts.sort((left, right) => right.points.length - left.points.length || left.name.localeCompare(right.name));
  excluded.sort((left, right) => left.name.localeCompare(right.name));
  return { method: strengthMethodVersion, settings: { bandPercent, toleranceDays: trendToleranceDays, sessions: sessionsPerGroup }, window, lifts, excluded, unmatched };
}
