/**
 * Ticket 23: training effort and rep ranges (effort-v1).
 *
 * Every working set (not a warm-up) on eligible, import-confirmed workout days is counted once in a rep
 * range and once in a reps-in-reserve (RIR) group, exactly as logged:
 * - Reps: 1-5, 6-10, 11-15, 16+; a set with a Duration and no reps is Timed; any other set without reps
 *   is No reps. Assisted sets (negative logged weight) are counted by their logged reps; no load is
 *   implied. Reps are per side for unilateral movements, as logged.
 * - RIR: 0, 1-2, 3-4, 5+, or Not recorded. A blank RIR is never assumed.
 * - Failure Set types are counted as logged, separately from RIR.
 * The weekly share of sets at RIR 0-2 is over sets with a recorded RIR; a week is charted only when at
 * least 75% of its working sets have one (the same coverage rule as the other analyses). Descriptive only.
 */
import type { WorkoutSet } from '../import/workout';
import { warmUpSetType, weekStart, type ExerciseAnalysis } from './exercise';

export const effortMethodVersion = 'effort-v1';
export const repBuckets = ['1-5', '6-10', '11-15', '16+', 'Timed', 'No reps'] as const;
export const rirBuckets = ['0', '1-2', '3-4', '5+', 'Not recorded'] as const;
export type RepBucket = (typeof repBuckets)[number];
export type RirBucket = (typeof rirBuckets)[number];
export const rirCoverage = 0.75;

export interface EffortCounts {
  sets: number;
  reps: Record<RepBucket, number>;
  rir: Record<RirBucket, number>;
  failureSets: number;
  /** Sets with a recorded RIR. */
  recorded: number;
  /** Sets at RIR 0-2 among those recorded. */
  hard: number;
  /** hard ÷ recorded, or null when no RIR is recorded. */
  hardShare: number | null;
  /** recorded ÷ sets. */
  coverage: number | null;
  covered: boolean;
}
export interface EffortWeek extends EffortCounts { weekStart: string; partial: boolean }
export interface EffortExercise extends EffortCounts { name: string }
export interface EffortAnalysis { method: typeof effortMethodVersion; weeks: EffortWeek[]; exercises: EffortExercise[]; total: EffortCounts }

const numeric = (set: WorkoutSet, field: string) => (typeof set[field] === 'number' && Number.isFinite(set[field] as number) ? (set[field] as number) : null);

export function repBucket(set: WorkoutSet): RepBucket {
  const reps = numeric(set, 'Reps');
  if (reps === null || reps < 1) return numeric(set, 'Duration') !== null ? 'Timed' : 'No reps';
  return reps <= 5 ? '1-5' : reps <= 10 ? '6-10' : reps <= 15 ? '11-15' : '16+';
}

export function rirBucket(set: WorkoutSet): RirBucket {
  const rir = numeric(set, 'RIR');
  if (rir === null || rir < 0) return 'Not recorded';
  return rir < 1 ? '0' : rir <= 2 ? '1-2' : rir <= 4 ? '3-4' : '5+';
}

function emptyCounts(): EffortCounts {
  return { sets: 0, reps: Object.fromEntries(repBuckets.map((bucket) => [bucket, 0])) as Record<RepBucket, number>,
    rir: Object.fromEntries(rirBuckets.map((bucket) => [bucket, 0])) as Record<RirBucket, number>, failureSets: 0, recorded: 0, hard: 0, hardShare: null, coverage: null, covered: false };
}
function add(counts: EffortCounts, set: WorkoutSet) {
  counts.sets += 1;
  counts.reps[repBucket(set)] += 1;
  const rir = rirBucket(set);
  counts.rir[rir] += 1;
  if (rir !== 'Not recorded') counts.recorded += 1;
  if (rir === '0' || rir === '1-2') counts.hard += 1;
  if (set['Set Type'] === 'Failure Set') counts.failureSets += 1;
}
function finish<T extends EffortCounts>(counts: T): T {
  counts.hardShare = counts.recorded ? counts.hard / counts.recorded : null;
  counts.coverage = counts.sets ? counts.recorded / counts.sets : null;
  counts.covered = counts.coverage !== null && Math.round(counts.coverage * 1e6) / 1e6 >= rirCoverage;
  return counts;
}

/** Sums counts (for a scope of weeks). */
export function combine(list: EffortCounts[]): EffortCounts {
  const total = emptyCounts();
  for (const counts of list) {
    total.sets += counts.sets;
    total.failureSets += counts.failureSets;
    total.recorded += counts.recorded;
    total.hard += counts.hard;
    for (const bucket of repBuckets) total.reps[bucket] += counts.reps[bucket];
    for (const bucket of rirBuckets) total.rir[bucket] += counts.rir[bucket];
  }
  return finish(total);
}

export function analyzeEffort(exercises: ExerciseAnalysis, from: string | null = null): EffortAnalysis {
  const weeks = new Map(exercises.weekly.filter((week) => from === null || week.weekStart >= weekStart(from))
    .map((week): [string, EffortWeek] => [week.weekStart, { ...emptyCounts(), weekStart: week.weekStart, partial: week.partial }]));
  const byExercise: EffortExercise[] = [];
  for (const exercise of exercises.exercises) {
    const counts: EffortExercise = { ...emptyCounts(), name: exercise.name };
    for (const session of exercise.sessions) {
      const week = weeks.get(weekStart(session.date));
      if (!week) continue;
      for (const set of session.sets) {
        if (set['Set Type'] === warmUpSetType) continue;
        add(week, set);
        add(counts, set);
      }
    }
    if (counts.sets) byExercise.push(finish(counts));
  }
  const weekList = [...weeks.values()].map(finish);
  byExercise.sort((left, right) => right.sets - left.sets || left.name.localeCompare(right.name));
  return { method: effortMethodVersion, weeks: weekList, exercises: byExercise, total: combine(weekList) };
}
