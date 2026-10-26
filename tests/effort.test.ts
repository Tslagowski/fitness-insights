import { describe, expect, test } from 'vitest';
import { analyzeEffort, repBucket, rirBucket } from '../src/analysis/effort';
import { analyzeWorkouts, workoutDays, workoutSet as set } from './fixtures/training-history';

const end = '2026-10-12';

describe('training effort and rep ranges', () => {
  test('buckets follow logged reps and RIR; blanks are not recorded; timed and assisted sets keep their meaning', () => {
    expect([1, 5, 6, 10, 11, 15, 16, 30].map((reps) => repBucket(set('X', { Reps: reps })))).toEqual(['1-5', '1-5', '6-10', '6-10', '11-15', '11-15', '16+', '16+']);
    expect(repBucket(set('Plank', { Duration: 60 }))).toBe('Timed');
    expect(repBucket(set('Mystery', {}))).toBe('No reps');
    expect(repBucket(set('Assisted Pull-Up', { 'Weight (lb)': -60, Reps: 8 }))).toBe('6-10');
    expect([0, 1, 2, 3, 4, 5, 8].map((rir) => rirBucket(set('X', { RIR: rir })))).toEqual(['0', '1-2', '1-2', '3-4', '3-4', '5+', '5+']);
    expect(rirBucket(set('X', { Reps: 5 }))).toBe('Not recorded');
  });

  test('weekly counts, the RIR 0-2 share over recorded sets, coverage, and failure sets as logged', () => {
    const session = [
      set('Bench', { 'Set Type': 'Warm-Up Set', 'Weight (lb)': 45, Reps: 10, RIR: 5 }),
      set('Bench', { 'Weight (lb)': 100, Reps: 8, RIR: 2 }), set('Bench', { 'Weight (lb)': 100, Reps: 6, RIR: 0, 'Set Type': 'Failure Set' }),
      set('Row', { 'Weight (lb)': 90, Reps: 12, RIR: 3 }), set('Row', { 'Weight (lb)': 90, Reps: 12 }),
    ];
    const { analysis } = analyzeWorkouts(workoutDays(end, [session, session]));
    const result = analyzeEffort(analysis);
    expect(result.method).toBe('effort-v1');
    const week = result.weeks[0];
    expect(week).toMatchObject({ sets: 4, recorded: 3, hard: 2, failureSets: 1, covered: true });
    expect(week.reps).toMatchObject({ '1-5': 0, '6-10': 2, '11-15': 2 });
    expect(week.rir).toMatchObject({ 0: 1, '1-2': 1, '3-4': 1, 'Not recorded': 1 });
    expect(week.hardShare).toBeCloseTo(2 / 3, 10);
    expect(week.coverage).toBe(0.75);
    const row = result.exercises.find((exercise) => exercise.name === 'Row')!;
    expect(row).toMatchObject({ sets: 4, recorded: 2, hard: 0, hardShare: 0, coverage: 0.5, covered: false });
    expect(result.total.sets).toBe(8);
  });

  test('a scope keeps only weeks from its start; a week without recorded RIR has no share', () => {
    const { analysis } = analyzeWorkouts(workoutDays(end, [[set('Bench', { Reps: 5, 'Weight (lb)': 100 })], [set('Bench', { Reps: 5, 'Weight (lb)': 100, RIR: 1 })]]));
    const all = analyzeEffort(analysis);
    expect(all.weeks.map((week) => week.hardShare)).toEqual([null, 1]);
    expect(analyzeEffort(analysis, end).weeks).toHaveLength(1);
  });
});
