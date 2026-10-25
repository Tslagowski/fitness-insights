import { describe, expect, test } from 'vitest';
import { analyzeProtein } from '../src/analysis/protein';
import { series } from './fixtures/daily-builder';

describe('protein relative to body weight', () => {
  test('grams per lb of trend weight, sources kept apart, target met and missed days', () => {
    // 2026-01-05 is a Monday. Two full weeks; weekends at 140 g, weekdays 180 g; target 160 g; trend 200 lb.
    const days = series('2026-01-05', Array.from({ length: 14 }, (_, index) => ({
      protein: index % 7 >= 5 ? 140 : 180, trend: 200, targetProtein: 160, intake: 2000, intakeSource: index < 7 ? 'detail' as const : 'workbook' as const })));
    const result = analyzeProtein(days);
    expect(result.matched).toBe(14);
    expect(result.sources).toEqual({ detail: 7, workbook: 7 });
    expect(result.meanRatio).toBeCloseTo((10 * 0.9 + 4 * 0.7) / 14, 10);
    expect(result.medianRatio).toBe(0.9);
    expect(result.distribution).toEqual([{ from: 0.7, to: 0.8, count: 4 }, { from: 0.8, to: 0.9, count: 0 }, { from: 0.9, to: 1, count: 10 }]);
    expect(result.target).toEqual({ compared: 14, met: 10, share: 10 / 14 });
    expect(result.missed.map((day) => day.date)).toEqual(['2026-01-18', '2026-01-17', '2026-01-11', '2026-01-10']);
    expect(result.missed[0]).toMatchObject({ protein: 140, target: 160 });
    expect(result.weeks).toEqual([
      { weekStart: '2026-01-05', matched: 7, mean: (5 * 0.9 + 2 * 0.7) / 7, covered: true, partial: false },
      { weekStart: '2026-01-12', matched: 7, mean: (5 * 0.9 + 2 * 0.7) / 7, covered: true, partial: false },
    ]);
  });

  test('missing trend weight or target leaves the ratio or comparison out; weeks below 5 days are not covered', () => {
    const days = series('2026-01-07', [
      { protein: 150, trend: null, targetProtein: 160 }, { protein: 170, trend: 200, targetProtein: null }, { protein: null, trend: 200, targetProtein: 160 },
      { protein: 160, trend: 200, targetProtein: 160 },
    ]);
    const result = analyzeProtein(days);
    expect(result.days).toHaveLength(3);
    expect(result.matched).toBe(2);
    expect(result.target).toEqual({ compared: 2, met: 1, share: 0.5 });
    expect(result.days.find((day) => day.date === '2026-01-10')!.met).toBe(true);
    expect(result.weeks[0]).toMatchObject({ weekStart: '2026-01-05', matched: 2, covered: false, partial: true });
  });
});
