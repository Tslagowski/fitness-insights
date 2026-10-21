import { describe, expect, test } from 'vitest';
import { emptyHistory, type ImportSummary, type SavedWorkoutDay } from '../src/gateway';
import { addDays, emptyReviewState, evaluateEligibility } from '../src/analysis/eligibility';
import { analyzeExercises, movementKind, qualifies, strengthScore, weekStart } from '../src/analysis/exercise';
import type { WorkoutSet } from '../src/import/workout';

const today = '2026-10-20';
const set = (exercise: string, values: WorkoutSet = {}): WorkoutSet => ({ 'Workout Duration': 2912, Workout: 'Push A', Exercise: exercise, 'Set Type': 'Standard Set', ...values });
function importAt(committedAt: string): ImportSummary {
  return { id: committedAt, kind: 'import', committedAt, outcome: 'changed', revisionId: 1, added: 0, changed: 0, unchanged: 0, removed: 0,
    foodAdded: 0, foodChanged: 0, foodUnchanged: 0, foodKept: 0, workoutAdded: 1, workoutChanged: 0, workoutUnchanged: 0, workoutKept: 0,
    firstDate: null, lastDate: null, clearedDate: null, clearedDomain: null, undoesId: null, undone: false, fileNames: [], reconciliation: [] };
}
function analyze(days: SavedWorkoutDay[], options: { aliases?: Record<string, string>; band?: number; importedAt?: string } = {}) {
  const history = { ...emptyHistory, imports: [importAt(options.importedAt ?? '2026-10-20T15:00:00Z')],
    workoutDays: days.map((day) => ({ date: day.date, source: day.source, sets: day.sets.length, exercises: 1, workouts: [], durations: [], revisionId: 1 })) };
  return analyzeExercises(days, evaluateEligibility(history, emptyReviewState, today), options.aliases ?? {}, { bandPercent: options.band ?? 2.5, durationUnit: 'seconds' });
}
/** One session per week ending at `end`, each built from the given sets. */
const weekly = (end: string, sessions: WorkoutSet[][]) => sessions.map((sets, index): SavedWorkoutDay =>
  ({ date: addDays(end, (index - sessions.length + 1) * 7), source: 'workout_csv', sets, revisionId: 1 }));

describe('estimated-strength progression', () => {
  test('best qualifying set per session, then median of the latest three vs the three before', () => {
    const loads = [100, 100, 105, 105, 110, 110];
    const result = analyze(weekly('2026-10-19', loads.map((load) => [
      set('Bench Press', { 'Set Type': 'Warm-Up Set', 'Weight (lb)': 200, Reps: 3 }),
      set('Bench Press', { 'Weight (lb)': load, Reps: 8 }), set('Bench Press', { 'Weight (lb)': load - 10, Reps: 10 }),
      set('Bench Press', { 'Weight (lb)': load + 20, Reps: 12 }),
    ])));
    const bench = result.exercises[0];
    expect(bench.kind).toBe('loaded');
    expect(bench.sessions[0].best).toEqual({ load: 100, reps: 8, score: strengthScore(100, 8), setType: 'Standard Set' });
    expect(bench.comparison.previousMedian).toBeCloseTo(strengthScore(100, 8), 10);
    expect(bench.comparison.recentMedian).toBeCloseTo(strengthScore(110, 8), 10);
    expect(bench.comparison.changePercent).toBeCloseTo(10, 10);
    expect(bench.comparison.label).toBe('Progressing');
  });

  test('the band is inclusive for Stable, configurable, and below −band is Declining', () => {
    const sessionsWith = (recentLoad: number) => weekly('2026-10-19', [100, 100, 100, recentLoad, recentLoad, recentLoad].map((load) => [set('Row', { 'Weight (lb)': load, Reps: 5 })]));
    expect(analyze(sessionsWith(102.5)).exercises[0].comparison).toMatchObject({ label: 'Stable' });
    expect(analyze(sessionsWith(102.5)).exercises[0].comparison.changePercent).toBeCloseTo(2.5, 10);
    expect(analyze(sessionsWith(102.6)).exercises[0].comparison.label).toBe('Progressing');
    expect(analyze(sessionsWith(97)).exercises[0].comparison.label).toBe('Declining');
    expect(analyze(sessionsWith(97), { band: 5 }).exercises[0].comparison.label).toBe('Stable');
  });

  test('fewer than six qualifying sessions is Insufficient data, with raw history still listed', () => {
    const result = analyze(weekly('2026-10-19', [1, 2, 3, 4, 5].map(() => [set('Curl', { 'Weight (lb)': 30, Reps: 10 })])));
    expect(result.exercises[0].comparison).toMatchObject({ label: 'Insufficient data', recent: [] });
    expect(result.exercises[0].comparison.reason).toContain('5 available');
    expect(result.exercises[0].sessions).toHaveLength(5);
  });

  test('per-hand loads and per-side reps are used as logged; base weight is never added; RIR is ignored', () => {
    const result = analyze(weekly('2026-10-19', [[set('Hack Squat', { 'Exercise Base Weight (lb)': 100, 'Weight (lb)': 90, Reps: 10, RIR: 0 })]]));
    expect(result.exercises[0].sessions[0].best).toMatchObject({ load: 90, reps: 10 });
    expect(result.exercises[0].sessions[0].loggedLoadVolume).toBe(900);
  });

  test('qualifying sets need positive load, 1-10 reps, and a Standard or Failure set type', () => {
    expect(qualifies(set('X', { 'Weight (lb)': 50, Reps: 10, 'Set Type': 'Failure Set' }))).toBe(true);
    expect(qualifies(set('X', { 'Weight (lb)': 50, Reps: 11 }))).toBe(false);
    expect(qualifies(set('X', { 'Weight (lb)': 50, Reps: 0 }))).toBe(false);
    expect(qualifies(set('X', { 'Weight (lb)': 0, Reps: 5 }))).toBe(false);
    expect(qualifies(set('X', { 'Weight (lb)': 50, Reps: 5, 'Set Type': 'Warm-Up Set' }))).toBe(false);
    expect(qualifies(set('X', { 'Weight (lb)': -40, Reps: 5 }))).toBe(false);
  });

  test('reps at comparable loads compare the best reps at loads used in both groups', () => {
    const sessions = [8, 8, 9, 9, 10, 10].map((reps) => [set('Press', { 'Weight (lb)': 50, Reps: reps }), set('Press', { 'Weight (lb)': 45, Reps: reps + 2 })]);
    expect(analyze(weekly('2026-10-19', sessions)).exercises[0].repsAtLoads).toEqual([{ load: 50, previousBest: 9, recentBest: 10 }, { load: 45, previousBest: 11, recentBest: 12 }]);
  });
});

describe('movement semantics', () => {
  test('assisted, bodyweight, and timed movements get no strength score but show their own measures', () => {
    const result = analyze(weekly('2026-10-19', [1, 2, 3, 4, 5, 6].map((index) => [
      set('Assisted Pull-Up', { 'Weight (lb)': -100 + index * 5, Reps: 6 }), set('Assisted Pull-Up', { 'Weight (lb)': -110, Reps: 8 }),
      set('Push-Up', { Reps: 20 + index }), set('Plank', { Duration: 60 + index }),
    ])));
    const byName = Object.fromEntries(result.exercises.map((exercise) => [exercise.name, exercise]));
    expect(byName['Assisted Pull-Up']).toMatchObject({ kind: 'assisted', comparison: { label: 'Not scored' } });
    expect(byName['Assisted Pull-Up'].sessions.at(-1)!.leastAssistance).toEqual({ load: -70, reps: 6 });
    expect(byName['Assisted Pull-Up'].sessions.at(-1)!.loggedLoadVolume).toBeNull();
    expect(byName['Push-Up']).toMatchObject({ kind: 'bodyweight', comparison: { label: 'Not scored' } });
    expect(byName['Push-Up'].sessions.at(-1)!.bodyweightReps).toEqual({ max: 26, total: 26 });
    expect(byName.Plank).toMatchObject({ kind: 'timed' });
    expect(byName.Plank.sessions.at(-1)!.longestDuration).toBe(66);
  });

  test('a movement mixing loaded and assisted sets is not forced into one label', () => {
    expect(movementKind([set('Dip', { 'Weight (lb)': 25, Reps: 8 }), set('Dip', { 'Weight (lb)': -30, Reps: 8 })])).toBe('mixed');
    const result = analyze(weekly('2026-10-19', [25, 25, 25, -30, 25, 25, 25].map((load) => [set('Dip', { 'Weight (lb)': load, Reps: 8 })])));
    expect(result.exercises[0].comparison.label).toBe('Not scored');
    expect(result.exercises[0].comparison.reason).toContain('Mixes');
  });
});

describe('sessions, aliases, and workload', () => {
  test('aliases group logged names explicitly and keep the logged names traceable', () => {
    const days = weekly('2026-10-19', [[set('Hack Squat ∈ SS1', { 'Weight (lb)': 90, Reps: 8 })], [set('Hack Squat', { 'Weight (lb)': 95, Reps: 8 })]]);
    const separate = analyze(days);
    expect(separate.exercises.map((exercise) => exercise.name).sort()).toEqual(['Hack Squat', 'Hack Squat ∈ SS1']);
    const grouped = analyze(days, { aliases: { 'Hack Squat ∈ SS1': 'Hack Squat' } });
    expect(grouped.exercises).toHaveLength(1);
    expect(grouped.exercises[0].loggedNames).toEqual(['Hack Squat', 'Hack Squat ∈ SS1']);
  });

  test('weekly working sets exclude warm-ups but keep blank-load sets; today, future, and unconfirmed days are left out', () => {
    const days: SavedWorkoutDay[] = [
      { date: '2026-10-12', source: 'workout_csv', revisionId: 1, sets: [set('Row', { 'Set Type': 'Warm-Up Set', 'Weight (lb)': 50, Reps: 10 }), set('Row', { 'Weight (lb)': 100, Reps: 8 }), set('Row', { Reps: 8 })] },
      { date: '2026-10-19', source: 'workout_csv', revisionId: 1, sets: [set('Row', { 'Weight (lb)': 100, Reps: 8 })] },
      { date: today, source: 'workout_csv', revisionId: 1, sets: [set('Row', { 'Weight (lb)': 100, Reps: 8 })] },
      { date: '2026-10-22', source: 'workout_csv', revisionId: 1, sets: [set('Row', { 'Weight (lb)': 100, Reps: 8 })] },
    ];
    const result = analyze(days, { importedAt: '2026-10-19T15:00:00Z' });
    expect(result.weekly).toEqual([{ weekStart: '2026-10-12', workingSets: 2, partial: false }]);
    expect(result.leftOut).toEqual({ today: 1, future: 1, unconfirmed: 1 });
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
  });

  test('two sessions of the same exercise on one day stay separate when workout name or duration differ', () => {
    const days: SavedWorkoutDay[] = [{ date: '2026-10-15', source: 'workout_csv', revisionId: 1, sets: [
      set('Curl', { 'Weight (lb)': 30, Reps: 10 }), set('Curl', { 'Weight (lb)': 35, Reps: 8, Workout: 'Pull B', 'Workout Duration': 1800 })] }];
    expect(analyze(days).exercises[0].sessions).toHaveLength(2);
  });
});
