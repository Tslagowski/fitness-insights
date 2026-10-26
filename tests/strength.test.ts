import { describe, expect, test } from 'vitest';
import { analyzeStrength, nearestTrend } from '../src/analysis/strength';
import { strengthScore } from '../src/analysis/exercise';
import { addDays } from '../src/analysis/eligibility';
import { series, trendLine } from './fixtures/daily-builder';
import { analyzeWorkouts, workoutDays, workoutSet as set } from './fixtures/training-history';

const end = '2026-10-19';
const start = addDays(end, -83);

describe('strength vs body weight', () => {
  test('kept strength while losing weight raises score per lb; sessions match the same-date trend value', () => {
    const loads = Array.from({ length: 12 }, () => 100);
    const { analysis } = analyzeWorkouts(workoutDays(end, loads.map((load) => [set('Bench Press', { 'Weight (lb)': load, Reps: 8 })])));
    const days = series(start, trendLine(250, -1, 84).map((trend) => ({ trend })));
    const result = analyzeStrength(analysis, days);
    const bench = result.lifts[0];
    expect(result.method).toBe('strength-bodyweight-v1');
    expect(bench.points).toHaveLength(12);
    expect(bench.change.label).toBe('Kept');
    expect(bench.change.scoreChangePercent).toBeCloseTo(0, 10);
    expect(bench.change.relativeChangePercent!).toBeGreaterThan(0);
    const first = bench.points[0];
    expect(first.trendDate).toBe(first.date);
    expect(first.relative).toBeCloseTo(strengthScore(100, 8) / first.trend!, 10);
    expect(bench.change.trendAfter! - bench.change.trendBefore!).toBeCloseTo(-9, 1);
  });

  test('gained and lost use the ticket 09 band; fewer than six sessions is insufficient', () => {
    const rising = [100, 100, 100, 100, 110, 110, 110];
    const falling = [100, 100, 100, 95, 95, 95];
    const sessions = rising.map((load, index) => [set('Bench Press', { 'Weight (lb)': load, Reps: 5 }),
      ...(index >= 1 ? [set('Squat', { 'Weight (lb)': falling[index - 1], Reps: 5 })] : []),
      ...(index < 5 ? [set('Curl', { 'Weight (lb)': 30, Reps: 10 })] : [])]);
    const { analysis } = analyzeWorkouts(workoutDays(end, sessions));
    const result = analyzeStrength(analysis, series(start, trendLine(240, 0, 84).map((trend) => ({ trend }))));
    const byName = Object.fromEntries(result.lifts.map((lift) => [lift.name, lift.change]));
    expect(byName['Bench Press'].label).toBe('Gained');
    expect(byName.Squat.label).toBe('Lost');
    expect(byName.Squat.scoreChangePercent).toBeCloseTo(-5, 10);
    expect(byName.Curl.label).toBe('Insufficient data');
    expect(byName.Curl.reason).toContain('5 available');
  });

  test('nearest trend within 3 days, earlier on a tie; none in range leaves no relative value', () => {
    const trend = new Map([['2026-10-10', 200], ['2026-10-14', 210]]);
    expect(nearestTrend(trend, '2026-10-12')).toEqual({ date: '2026-10-10', value: 200 });
    expect(nearestTrend(trend, '2026-10-13')).toEqual({ date: '2026-10-14', value: 210 });
    expect(nearestTrend(trend, '2026-10-18')).toBeNull();
    const { analysis } = analyzeWorkouts(workoutDays(end, [[set('Bench Press', { 'Weight (lb)': 100, Reps: 5 })]]));
    const result = analyzeStrength(analysis, series(start, [{ trend: 250 }]));
    expect(result.lifts[0].points[0]).toMatchObject({ trend: null, relative: null });
    expect(result.unmatched).toBe(1);
  });

  test('assisted, bodyweight, timed, and mixed movements are excluded and listed; per-hand loads stay as logged', () => {
    const sessions = Array.from({ length: 6 }, () => [
      set('Assisted Pull-Up', { 'Weight (lb)': -60, Reps: 8 }), set('Push-Up', { Reps: 20 }), set('Plank', { Duration: 60 }),
      set('Dumbbell Press', { 'Weight (lb)': 50, Reps: 10, 'Exercise Base Weight (lb)': 0 }),
    ]);
    const { analysis } = analyzeWorkouts(workoutDays(end, sessions));
    const result = analyzeStrength(analysis, series(start, trendLine(240, 0, 84).map((trend) => ({ trend }))));
    expect(result.excluded.map((item) => [item.name, item.kind])).toEqual([['Assisted Pull-Up', 'assisted'], ['Plank', 'timed'], ['Push-Up', 'bodyweight']]);
    expect(result.lifts.map((lift) => lift.name)).toEqual(['Dumbbell Press']);
    expect(result.lifts[0].points[0].score).toBeCloseTo(strengthScore(50, 10), 10);
  });

  test('a window keeps only sessions inside it', () => {
    const { analysis } = analyzeWorkouts(workoutDays(end, Array.from({ length: 12 }, (_, index) => [set('Bench Press', { 'Weight (lb)': 100 + index * 5, Reps: 5 })])));
    const days = series(start, trendLine(240, 0, 84).map((trend) => ({ trend })));
    const result = analyzeStrength(analysis, days, { start: addDays(end, -41), end });
    expect(result.lifts[0].points).toHaveLength(6);
    expect(result.lifts[0].change.scoreBefore).toBeCloseTo(strengthScore(135, 5), 10);
  });
});
