import { describe, expect, test } from 'vitest';
import { analyzeWeekdays, minimumWeekdayCount } from '../src/analysis/weekdays';
import { buildDailySeries, weekdayIndex } from '../src/analysis/daily';
import { series } from './fixtures/daily-builder';

// 2026-01-05 is a Monday.
const weeks = (count: number, saturdayExtra = 500) => series('2026-01-05', Array.from({ length: count * 7 }, (_, index) => {
  const saturday = index % 7 === 5;
  return { intake: 2000 + (saturday ? saturdayExtra : 0), target: 2100, expenditure: 2300, steps: saturday ? 4000 : 9000, scale: saturday ? 201 : 200, trend: 200 };
}));

describe('weekday patterns', () => {
  test('weekday indices follow the calendar date (Monday = 0) with no time-zone shift', () => {
    expect(weekdayIndex('2026-01-05')).toBe(0);
    expect(weekdayIndex('2026-01-10')).toBe(5);
    expect(weekdayIndex('2026-03-08')).toBe(6);
    expect(weekdayIndex('2026-11-01')).toBe(6);
    expect(buildDailySeries).toBeTypeOf('function');
  });

  test('per-weekday means, residuals, shares, and a pattern-only finding', () => {
    const result = analyzeWeekdays(weeks(12));
    const saturday = result.rows[5];
    expect(saturday).toMatchObject({ name: 'Saturday', days: 12 });
    expect(saturday.targetDifference).toEqual({ count: 12, mean: 400, sufficient: true });
    expect(saturday.residual.mean).toBe(1);
    expect(result.rows[0].residual.mean).toBe(0);
    expect(saturday.aboveTargetShare).toBe(1);
    expect(saturday.surplusShare).toBe(1);
    expect(result.rows[0].targetDifference.mean).toBe(-100);
    expect(result.weekend.steps.mean).toBe(6500);
    expect(result.weekdays.steps.mean).toBe(9000);
    expect(result.findings[0]).toBe('Saturdays averaged +400 kcal vs target over 12 Saturdays; Mondays averaged −100 kcal over 12.');
    expect(result.findings[1]).toContain('Saturdays account for 100% of the above-target calories');
    expect(result.findings.join(' ')).not.toMatch(/because|should|cause|try/i);
  });

  test('weekdays below the minimum count are insufficient and never ranked', () => {
    const result = analyzeWeekdays(weeks(minimumWeekdayCount - 1));
    expect(result.rows.every((row) => !row.targetDifference.sufficient)).toBe(true);
    expect(result.findings.some((finding) => finding.includes('vs target') || finding.includes('account for'))).toBe(false);
    const missing = weeks(4).map((day) => (day.weekday === 6 ? { ...day, intake: null, targetDifference: null, balance: null } : day));
    const sparse = analyzeWeekdays(missing);
    expect(sparse.rows[6].intake).toMatchObject({ count: 0, sufficient: false, mean: null });
    expect(sparse.rows[6].days).toBe(4);
  });
});
