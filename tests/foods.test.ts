import { describe, expect, test } from 'vitest';
import { analyzeFoods, classify, hourOf } from '../src/analysis/foods';
import type { SavedFoodDay } from '../src/gateway';
import { series } from './fixtures/daily-builder';

const entry = (time: string | null, name: string, kcal: number | null) => ({ ...(time === null ? {} : { Time: time }), 'Food Name': name, ...(kcal === null ? {} : { 'Calories (kcal)': kcal }) });
const day = (date: string, entries: Array<Record<string, string | number>>): SavedFoodDay => ({ date, source: 'food_csv', entries, revisionId: 1 });

describe('food patterns on over-target days', () => {
  test('logged times parse to hours; unreadable times are null', () => {
    expect(hourOf('7:30 AM')).toBe(7);
    expect(hourOf('12:05 AM')).toBe(0);
    expect(hourOf('12:30 PM')).toBe(12);
    expect(hourOf('9:15 PM')).toBe(21);
    expect(hourOf('21:05')).toBe(21);
    expect(hourOf('')).toBeNull();
    expect(hourOf('13:00 PM')).toBeNull();
    expect(hourOf(undefined)).toBeNull();
    expect(classify(101)).toBe('over');
    expect(classify(100)).toBe('within');
    expect(classify(-100)).toBe('within');
    expect(classify(-101)).toBe('under');
  });

  test('classes days, ranks foods by total and by over-vs-within difference, and counts repeats as logged', () => {
    // Jan 1-2 within target (2,000 vs 2,000), Jan 3-4 over (+700), Jan 5 workbook only, Jan 6 detail with no target.
    const days = series('2026-01-01', [
      { intake: 2000, target: 2000, intakeSource: 'detail' }, { intake: 2000, target: 2000, intakeSource: 'detail' },
      { intake: 2700, target: 2000, intakeSource: 'detail' }, { intake: 2700, target: 2000, intakeSource: 'detail' },
      { intake: 2500, target: 2000, intakeSource: 'workbook' }, { intake: 2100, intakeSource: 'detail' },
    ]);
    const base = [entry('7:30 AM', 'Egg', 70), entry('7:30 AM', 'Egg', 70), entry('12:30 PM', 'Chicken bowl', 900), entry('6:30 PM', 'Salmon', 960)];
    const food = [
      day('2026-01-01', base), day('2026-01-02', base),
      day('2026-01-03', [...base, entry('9:15 PM', 'Pizza', 600), entry(null, 'Cookie', 100)]),
      day('2026-01-04', [...base, entry('9:45 PM', 'Pizza', 600), entry('10:00 PM', 'Cookie', 100), entry('8:00 AM', 'Mystery', null)]),
      day('2026-01-06', base),
    ];
    const result = analyzeFoods(days, food);
    expect(result.counts).toEqual({ over: 2, within: 2, under: 0 });
    expect(result.excluded).toEqual({ workbookOnly: 1, noTarget: 1, missingCalories: 1 });
    expect(result.dates.over).toEqual(['2026-01-03', '2026-01-04']);
    expect(result.foods[0]).toMatchObject({ name: 'Salmon', totalKcal: 3840 });
    const egg = result.foods.find((row) => row.name === 'Egg')!;
    expect(egg.entries).toBe(8);
    expect(egg.difference).toBe(0);
    const pizza = result.foods.find((row) => row.name === 'Pizza')!;
    expect(pizza.byClass.over).toEqual({ kcal: 1200, entries: 2, perDay: 600 });
    expect(pizza.byClass.within.perDay).toBe(0);
    expect(pizza.difference).toBe(600);
    const byDifference = [...result.foods].sort((left, right) => (right.difference ?? 0) - (left.difference ?? 0));
    expect(byDifference.map((row) => row.name).slice(0, 2)).toEqual(['Pizza', 'Cookie']);
    const over = result.timing.over;
    expect(over.untimed).toEqual({ entries: 1, kcal: 100 });
    expect(over.buckets.find((bucket) => bucket.key === 'late')!.kcal).toBe(1300);
    expect(over.afterCutoffShare).toBeCloseTo(1300 / (over.kcal - 100), 10);
    expect(result.timing.within.afterCutoffShare).toBe(0);
    expect(result.timing.under.days).toBe(0);
    expect(result.timing.under.afterCutoffShare).toBeNull();
  });
});
