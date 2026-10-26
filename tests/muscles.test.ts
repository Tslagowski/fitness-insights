import { describe, expect, test } from 'vitest';
import { analyzeMuscles, meanWeeklySets, stallChecks } from '../src/analysis/muscles';
import { analyzeWorkouts, workoutDays, workoutSet as set } from './fixtures/training-history';

const end = '2026-10-19';
const mapping = {
  'Bench Press': { primary: 'Chest', secondary: ['Triceps', 'Front Delts'] },
  Row: { primary: 'Upper Back', secondary: ['Biceps'] },
  Squat: { primary: 'Quads', secondary: ['Glutes'] },
};

describe('muscle-group balance', () => {
  const sessions = Array.from({ length: 4 }, () => [
    set('Bench Press', { 'Set Type': 'Warm-Up Set', 'Weight (lb)': 45, Reps: 10 }),
    set('Bench Press', { 'Weight (lb)': 100, Reps: 8 }), set('Bench Press', { 'Weight (lb)': 100, Reps: 8 }), set('Bench Press', { 'Weight (lb)': 100, Reps: 8 }),
    set('Row', { 'Weight (lb)': 90, Reps: 10 }), set('Row', { 'Weight (lb)': 90, Reps: 10 }),
    set('Squat', { 'Weight (lb)': 150, Reps: 5 }), set('Squat', { 'Weight (lb)': 150, Reps: 5 }),
    set('Plank', { Duration: 60 }),
  ]);

  test('primary muscles get one set each; secondary credit follows the setting; warm-ups and unmapped sets are not credited', () => {
    const { analysis } = analyzeWorkouts(workoutDays(end, sessions));
    const none = analyzeMuscles(analysis, mapping, { secondaryCredit: 0, stallComparisons: 3 });
    const week = none.weeks.at(-1)!;
    expect(week.muscles).toEqual({ Chest: 3, 'Upper Back': 2, Quads: 2 });
    expect(week).toMatchObject({ workingSets: 8, mappedSets: 7, unmappedSets: 1, push: 3, pull: 2, upper: 5, lower: 2, pushPull: 1.5, upperLower: 2.5 });
    expect(none.unmapped).toEqual([{ name: 'Plank', workingSets: 4, lastDate: end }]);
    const half = analyzeMuscles(analysis, mapping, { secondaryCredit: 0.5, stallComparisons: 3 }).weeks.at(-1)!;
    expect(half.muscles).toEqual({ Chest: 3, Triceps: 1.5, 'Front Delts': 1.5, 'Upper Back': 2, Biceps: 1, Quads: 2, Glutes: 1 });
    expect(half.push).toBe(6);
    expect(half.pull).toBe(3);
    expect(none.method).toBe('muscle-balance-v1');
  });

  test('weeks without sets stay zero, ratios need both sides, and means use complete weeks only', () => {
    const { analysis } = analyzeWorkouts(workoutDays(end, [[set('Bench Press', { 'Weight (lb)': 100, Reps: 8 })], [set('Bench Press', { 'Weight (lb)': 100, Reps: 8 })]], 14));
    const result = analyzeMuscles(analysis, mapping, { secondaryCredit: 0, stallComparisons: 3 });
    expect(result.weeks.map((week) => week.workingSets)).toEqual([1, 0, 1]);
    expect(result.weeks[0].pushPull).toBeNull();
    // The current week is partial (not yet confirmed), so only the two complete weeks count.
    expect(result.weeks.at(-1)!.partial).toBe(true);
    expect(meanWeeklySets(result.weeks)).toEqual([{ muscle: 'Chest', mean: 0.5, weeks: 2 }]);
  });

  test('a lift is stalled only when each of the last N rolling comparisons is Stable or Declining', () => {
    const flat = Array.from({ length: 9 }, () => [set('Squat', { 'Weight (lb)': 150, Reps: 5 }), set('Bench Press', { 'Weight (lb)': 100, Reps: 5 })]);
    // Bench rises in the last two sessions, so its latest comparison is Progressing and it is not stalled.
    flat[7][1] = set('Bench Press', { 'Weight (lb)': 120, Reps: 5 });
    flat[8][1] = set('Bench Press', { 'Weight (lb)': 120, Reps: 5 });
    const { analysis } = analyzeWorkouts(workoutDays(end, [...flat, [set('Curl', { 'Weight (lb)': 30, Reps: 8 })]]));
    const result = analyzeMuscles(analysis, mapping, { secondaryCredit: 0, stallComparisons: 3 });
    expect(result.stalled.map((lift) => lift.name)).toEqual(['Squat']);
    expect(result.stalled[0].checks.map((check) => check.label)).toEqual(['Stable', 'Stable', 'Stable']);
    expect(result.stalled[0].checks[1].recent.at(-1)!.date < result.stalled[0].checks[0].recent.at(-1)!.date).toBe(true);
    expect(result.tooFewForStall).toBe(1);
    const squat = analysis.exercises.find((exercise) => exercise.name === 'Squat')!;
    expect(stallChecks(squat.sessions, 5, 2.5)).toBeNull();
    expect(stallChecks(squat.sessions, 4, 2.5)).toHaveLength(4);
  });
});
