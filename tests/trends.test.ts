import { describe, expect, test } from 'vitest';
import { emptyHistory, type ImportedHistory, type ImportSummary, type StoredDailyRecord } from '../src/gateway';
import { addDays, emptyReviewState, evaluateEligibility, type ReviewState } from '../src/analysis/eligibility';
import { slopePerDay } from '../src/analysis/periods';
import { analyzeTrends } from '../src/analysis/trends';
import type { DailyDomain } from '../src/import/workbook';

const today = '2026-10-20';
function importAt(committedAt: string): ImportSummary {
  return { id: committedAt, kind: 'import', committedAt, outcome: 'changed', revisionId: 1, added: 1, changed: 0, unchanged: 0, removed: 0,
    foodAdded: 0, foodChanged: 0, foodUnchanged: 0, foodKept: 0, workoutAdded: 0, workoutChanged: 0, workoutUnchanged: 0, workoutKept: 0,
    firstDate: null, lastDate: null, clearedDate: null, clearedDomain: null, undoesId: null, undone: false, fileNames: [], reconciliation: [] };
}
type Day = { scale?: number | null; trend?: number | null; steps?: number | null; intake?: number | null };
function history(end: string, values: Day[]): ImportedHistory {
  const records: StoredDailyRecord[] = values.flatMap((day, index) => {
    const date = addDays(end, index - values.length + 1);
    const row = (domain: DailyDomain, field: string, value: number | null | undefined, fallback: number): StoredDailyRecord[] =>
      value === null ? [] : [{ date, domain, values: { [field]: value ?? fallback }, sourceFileId: 'f', revisionId: 1 }];
    return [...row('scale_weight', 'Weight (lb)', day.scale, 200), ...row('trend_weight', 'Trend Weight (lb)', day.trend, 199.5),
      ...row('steps', 'Steps', day.steps, 8000), ...row('nutrition_totals', 'Calories (kcal)', day.intake, 2300)];
  });
  return { ...emptyHistory, records, imports: [importAt('2026-10-20T15:00:00Z')] };
}
const analyze = (data: ImportedHistory, length: 7 | 28 = 7, review: ReviewState = emptyReviewState) => analyzeTrends(data, evaluateEligibility(data, review, today), { kind: 'days', length });

describe('weight and steps', () => {
  test('the weekly trend rate is 7 × the least-squares slope over elapsed calendar days, skipping missing days', () => {
    // Trend falls 0.2 lb/day with two days missing: the slope still uses true calendar spacing.
    const week: Day[] = [0, 1, 2, 3, 4, 5, 6].map((offset) => ({ trend: [2, 4].includes(offset) ? null : 200 - 0.2 * offset }));
    const result = analyze(history('2026-10-19', [...week, ...week]));
    expect(result.current!.trend.count).toBe(5);
    expect(result.current!.trend.weeklyRate).toBeCloseTo(-1.4, 10);
    expect(slopePerDay([{ date: '2026-10-01', value: 1 }, { date: '2026-10-11', value: 3 }])).toBeCloseTo(0.2, 12);
    expect(slopePerDay([{ date: '2026-10-01', value: 1 }])).toBeNull();
  });

  test('scale points and trend values stay separate; an excluded weigh-in leaves the trend untouched and warned', () => {
    const steady = [200.4, 199.8, 199.2, 199.6, 198.8, 297.8, 199.0].map((scale) => ({ scale, trend: 199.5 }));
    const data = history('2026-10-19', [...repeat(7), ...steady]);
    const review: ReviewState = { decisions: [{ date: '2026-10-18', domain: 'scale_weight', field: 'Weight (lb)', value: 297.8, decision: 'exclude', decidedAt: '2026-10-20T00:00:00Z' }], completeness: [] };
    const result = analyze(data, 7, review);
    expect(result.current!.scale.count).toBe(6);
    expect(result.current!.scale.mean).toBeCloseTo((200.4 + 199.8 + 199.2 + 199.6 + 198.8 + 199.0) / 6, 10);
    expect(result.current!.trend.count).toBe(7);
    expect(result.current!.warningDates).toEqual(['2026-10-18', '2026-10-19']);
    expect(result.current!.days.find((day) => day.date === '2026-10-18')).toMatchObject({ scale: 297.8, scaleStatus: { eligible: false, reason: 'excluded' } });
  });

  test('steps keep their own coverage and are not erased by missing nutrition', () => {
    const data = history('2026-10-19', repeat(14, { intake: null, scale: null, trend: null, steps: 9000 }));
    const result = analyze(data);
    expect(result.anchor).toBe('2026-10-19');
    expect(result.current!.steps).toMatchObject({ count: 7, mean: 9000, covered: true });
    expect(result.current!.scale.covered).toBe(false);
    expect(result.shift).toEqual({ scaleMean: null, weeklyRate: null, stepsMean: 0 });
  });

  test('a period below the threshold withholds the comparison and missing days are not filled', () => {
    const sparse = repeat(7, { steps: null });
    sparse[0] = { steps: 7000 };
    const result = analyze(history('2026-10-19', [...repeat(7, { steps: 10000 }), ...sparse]));
    expect(result.current!.steps).toMatchObject({ count: 1, covered: false });
    expect(result.shift.stepsMean).toBeNull();
    expect(result.current!.days.filter((day) => day.steps === null)).toHaveLength(6);
  });

  test('a corrected value is reflected in the active result', () => {
    const data = history('2026-10-19', repeat(14, { steps: 8000 }));
    data.records.find((record) => record.domain === 'steps' && record.date === '2026-10-19')!.values.Steps = 15000;
    expect(analyze(data).current!.steps.mean).toBe(9000);
  });
});

function repeat(count: number, day: Day = {}) { return Array.from({ length: count }, () => ({ ...day })); }
