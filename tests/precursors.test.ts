import { describe, expect, test } from 'vitest';
import { analyzePrecursors } from '../src/analysis/precursors';
import { addDays } from '../src/analysis/eligibility';
import { series } from './fixtures/daily-builder';
import { analyzeWorkouts, workoutDays, workoutSet as set } from './fixtures/training-history';

const end = '2026-10-18';
const count = 33;
/** Sessions every 2 days; even sessions lift 10% more on both exercises. */
function history(intake: (high: boolean) => number) {
  const sessions = Array.from({ length: count }, (_, index) => {
    const load = index % 2 === 0 ? 110 : 100;
    return [set('Bench', { 'Weight (lb)': load, Reps: 5 }), set('Squat', { 'Weight (lb)': load + 50, Reps: 5 }), set('Plank', { Duration: 60 })];
  });
  const workouts = workoutDays(end, sessions, 2);
  const first = addDays(workouts[0].date, -1);
  const highDates = new Set(workouts.filter((_, index) => index % 2 === 0).map((day) => day.date));
  const days = series(first, Array.from({ length: count * 2 + 1 }, (_, index) => {
    const tomorrow = addDays(first, index + 1);
    return { intake: intake(highDates.has(tomorrow)), expenditure: 2500, steps: 8000 };
  }));
  return { ...analyzeWorkouts(workouts), days };
}

describe('what precedes best and worst sessions', () => {
  test('an association that is present shows up as a difference between the top and bottom thirds', () => {
    const { analysis, days } = history((high) => (high ? 3000 : 2000));
    const result = analyzePrecursors(analysis, days);
    expect(result.method).toBe('session-precursors-v1');
    // The first three sessions of each exercise have no baseline.
    expect(result.excluded.tooFewExercises).toBe(3);
    expect(result.days).toHaveLength(30);
    expect(result.groupSize).toBe(10);
    expect(result.days.filter((day) => day.group === 'middle')).toHaveLength(10);
    const top = result.days.find((day) => day.group === 'top')!;
    expect(top.scorePercent).toBeGreaterThan(5);
    expect(top.exercises.map((item) => item.name)).toEqual(['Bench', 'Squat']);
    const intake = result.measures.find((item) => item.measure === 'intake')!;
    expect(intake).toMatchObject({ sufficient: true, difference: 1000, top: { count: 10, mean: 3000, median: 3000 }, bottom: { count: 10, mean: 2000 } });
    expect(result.measures.find((item) => item.measure === 'balance')!.difference).toBe(1000);
    expect(result.measures.find((item) => item.measure === 'carbs')).toMatchObject({ sufficient: false, difference: null });
  });

  test('an absent association shows no difference', () => {
    const { analysis, days } = history(() => 2500);
    const result = analyzePrecursors(analysis, days);
    expect(result.measures.find((item) => item.measure === 'intake')!.difference).toBe(0);
    expect(result.measures.find((item) => item.measure === 'steps')!.difference).toBe(0);
  });

  test('too few sessions are insufficient; ineligible prior days are not counted', () => {
    const { analysis, days } = history((high) => (high ? 3000 : 2000));
    const short = analyzePrecursors({ ...analysis, exercises: analysis.exercises.map((exercise) => ({ ...exercise, sessions: exercise.sessions.slice(0, 15) })) }, days);
    expect(short.sufficient).toBe(false);
    expect(short.measures.every((item) => item.difference === null)).toBe(true);
    const gaps = analyzePrecursors(analysis, days.map((day) => ({ ...day, steps: null })));
    expect(gaps.measures.find((item) => item.measure === 'steps')).toMatchObject({ sufficient: false, top: { count: 0 } });
  });
});
