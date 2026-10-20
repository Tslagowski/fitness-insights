import { describe, expect, test } from 'vitest';
import { emptyHistory, type ImportedHistory, type ImportSummary, type StoredDailyRecord } from '../src/gateway';
import { addDays, evaluateEligibility, importCutoffs, weightFlags, type ReviewDecision } from '../src/analysis/eligibility';
import type { DailyDomain } from '../src/import/workbook';

function history(weights: Record<string, number | null>, extra: Partial<ImportedHistory> = {}): ImportedHistory {
  const records: StoredDailyRecord[] = Object.entries(weights).flatMap(([date, value]): StoredDailyRecord[] => [
    { date, domain: 'scale_weight' as DailyDomain, values: { 'Weight (lb)': value }, sourceFileId: 'f', revisionId: 1 },
    { date, domain: 'trend_weight' as DailyDomain, values: { 'Trend Weight (lb)': 199 }, sourceFileId: 'f', revisionId: 1 },
    { date, domain: 'nutrition_totals' as DailyDomain, values: { 'Calories (kcal)': 2400 }, sourceFileId: 'f', revisionId: 1 },
  ]);
  return { ...emptyHistory, records, imports: [importAt('2026-09-14T15:00:00Z')], ...extra };
}
function importAt(committedAt: string, overrides: Partial<ImportSummary> = {}): ImportSummary {
  return { id: committedAt, kind: 'import', committedAt, outcome: 'changed', revisionId: 1, added: 1, changed: 0, unchanged: 0, removed: 0,
    foodAdded: 0, foodChanged: 0, foodUnchanged: 0, foodKept: 0, workoutAdded: 0, workoutChanged: 0, workoutUnchanged: 0, workoutKept: 0,
    firstDate: null, lastDate: null, clearedDate: null, clearedDomain: null, undoesId: null, undone: false, fileNames: [], reconciliation: [], ...overrides };
}
const decision = (date: string, value: number, choice: ReviewDecision['decision'], decidedAt = '2026-09-15T00:00:00Z'): ReviewDecision =>
  ({ date, domain: 'scale_weight', field: 'Weight (lb)', value, decision: choice, decidedAt });

// The owner-confirmed error: 297.8 lb on Sep 13 after a stable ~200 lb week.
const septemberWeights = { '2026-09-08': 200.4, '2026-09-09': 199.8, '2026-09-10': 199.2, '2026-09-11': 199.6, '2026-09-12': 198.8, '2026-09-13': 297.8 };

describe('weight review flags', () => {
  test('flag the confirmed 297.8 lb error against the median of the prior week', () => {
    const flags = weightFlags(history(septemberWeights), []);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ date: '2026-09-13', value: 297.8, baselineMedian: 199.6, status: 'pending' });
    expect(flags[0].baselineDates).toEqual(['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']);
    expect(flags[0].difference).toBeCloseTo(0.492, 3);
  });

  test('do not invent a flag without at least three accepted weigh-ins in the seven prior days', () => {
    expect(weightFlags(history({ '2026-09-11': 200, '2026-09-12': 199, '2026-09-13': 297.8 }), [])).toEqual([]);
    expect(weightFlags(history({ '2026-09-01': 200, '2026-09-02': 200, '2026-09-03': 200, '2026-09-13': 297.8 }), [])).toEqual([]);
    expect(weightFlags(history({ '2026-09-10': 200, '2026-09-11': null, '2026-09-12': 199, '2026-09-13': 297.8 }), [])).toEqual([]);
  });

  test('exactly 10% is not flagged; just over is', () => {
    const base = { '2026-09-10': 200, '2026-09-11': 200, '2026-09-12': 200 };
    expect(weightFlags(history({ ...base, '2026-09-13': 220 }), [])).toEqual([]);
    expect(weightFlags(history({ ...base, '2026-09-13': 220.2 }), [])).toHaveLength(1);
    expect(weightFlags(history({ ...base, '2026-09-13': 179.8 }), [])).toHaveLength(1);
  });

  test('pending and excluded values never become a baseline; kept values do', () => {
    const weights = { '2026-09-10': 200, '2026-09-11': 200, '2026-09-12': 200, '2026-09-13': 300, '2026-09-14': 300, '2026-09-15': 300, '2026-09-16': 300 };
    expect(weightFlags(history(weights), []).map((flag) => flag.date)).toEqual(['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']);
    const kept = weightFlags(history(weights), [decision('2026-09-13', 300, 'keep')]);
    expect(kept.map((flag) => [flag.date, flag.status])).toEqual([['2026-09-13', 'kept'], ['2026-09-14', 'pending'], ['2026-09-15', 'pending'], ['2026-09-16', 'pending']]);
  });

  test('a decision applies only to the exact value it was made for, and the latest decision wins', () => {
    expect(weightFlags(history(septemberWeights), [decision('2026-09-13', 297.8, 'exclude')])[0].status).toBe('excluded');
    expect(weightFlags(history({ ...septemberWeights, '2026-09-13': 297.6 }), [decision('2026-09-13', 297.8, 'exclude')])[0].status).toBe('pending');
    expect(weightFlags(history(septemberWeights), [decision('2026-09-13', 297.8, 'exclude'), decision('2026-09-13', 297.8, 'pending', '2026-09-16T00:00:00Z')])[0].status).toBe('pending');
  });
});

describe('completed-day eligibility', () => {
  test('today is in progress, future is planned, and the cutoff follows the latest import, not the clock', () => {
    const data = history({ '2026-09-12': 199, '2026-09-13': 199, '2026-09-14': 199, '2026-09-15': 199, '2026-09-16': 199 });
    // Imported on Sep 14 (Mountain time); now it is Sep 16.
    const report = evaluateEligibility(data, { decisions: [], completeness: [] }, '2026-09-16');
    expect(report.cutoffs.daily).toBe('2026-09-13');
    const status = Object.fromEntries(report.days.map((day) => [day.date, day.weight]));
    expect(status['2026-09-13']).toEqual({ eligible: true });
    expect(status['2026-09-14']).toEqual({ eligible: false, reason: 'after-import-cutoff' });
    expect(status['2026-09-15']).toEqual({ eligible: false, reason: 'after-import-cutoff' });
    expect(status['2026-09-16']).toEqual({ eligible: false, reason: 'in-progress' });
    expect(evaluateEligibility(history({ '2026-09-20': 199 }), { decisions: [], completeness: [] }, '2026-09-16').days[0].weight).toEqual({ eligible: false, reason: 'future' });
  });

  test('a later import confirms earlier pre-logged days; an undone import does not count', () => {
    const data = history({ '2026-09-14': 199, '2026-09-15': 199 }, { imports: [importAt('2026-09-16T18:00:00Z'), importAt('2026-09-14T15:00:00Z')] });
    expect(importCutoffs(data, '2026-09-20').cutoffs.daily).toBe('2026-09-15');
    const undone = { ...data, imports: [importAt('2026-09-16T18:00:00Z', { undone: true }), importAt('2026-09-14T15:00:00Z')] };
    expect(importCutoffs(undone, '2026-09-20').cutoffs.daily).toBe('2026-09-13');
    // An import made late in the evening in Denver (after midnight UTC) still counts as that Denver day.
    expect(importCutoffs(history({}, { imports: [importAt('2026-09-17T04:30:00Z')] }), '2026-09-20').cutoffs.daily).toBe('2026-09-15');
  });

  test('a pending or excluded weigh-in is omitted while the day\'s intake stays eligible, and estimates are labeled', () => {
    const data = history(septemberWeights, { imports: [importAt('2026-09-15T15:00:00Z')] });
    const pending = evaluateEligibility(data, { decisions: [], completeness: [] }, '2026-09-20');
    const day = pending.days.find((item) => item.date === '2026-09-13')!;
    expect(day.weight).toEqual({ eligible: false, reason: 'pending-review' });
    expect(day.intake).toEqual({ eligible: true });
    expect(day.estimateWarning).toContain('from 2026-09-13 onward');
    expect(pending.days.find((item) => item.date === '2026-09-12')!.estimateWarning).toBeNull();
    const excluded = evaluateEligibility(data, { decisions: [decision('2026-09-13', 297.8, 'exclude')], completeness: [] }, '2026-09-20');
    expect(excluded.days.find((item) => item.date === '2026-09-13')!.weight).toEqual({ eligible: false, reason: 'excluded' });
    expect(excluded.days.find((item) => item.date === '2026-09-13')!.estimateWarning).not.toBeNull();
    const kept = evaluateEligibility(data, { decisions: [decision('2026-09-13', 297.8, 'keep')], completeness: [] }, '2026-09-20');
    expect(kept.days.find((item) => item.date === '2026-09-13')!.weight).toEqual({ eligible: true });
    expect(kept.days.find((item) => item.date === '2026-09-13')!.estimateWarning).toBeNull();
  });

  test('incomplete marks exclude only intake, persist until changed, and high or low intake is never removed automatically', () => {
    const data = history({ '2026-09-10': 199, '2026-09-11': 199 }, { imports: [importAt('2026-09-15T15:00:00Z')] });
    data.records.find((record) => record.date === '2026-09-10' && record.domain === 'nutrition_totals')!.values['Calories (kcal)'] = 6500;
    data.records.find((record) => record.date === '2026-09-11' && record.domain === 'nutrition_totals')!.values['Calories (kcal)'] = 600;
    const marks = [{ date: '2026-09-11', domain: 'nutrition' as const, status: 'incomplete' as const, decidedAt: '2026-09-16T00:00:00Z' }];
    const report = evaluateEligibility(data, { decisions: [], completeness: marks }, '2026-09-20');
    const byDate = Object.fromEntries(report.days.map((day) => [day.date, day]));
    expect(byDate['2026-09-10'].intake).toEqual({ eligible: true });
    expect(byDate['2026-09-11'].intake).toEqual({ eligible: false, reason: 'incomplete' });
    expect(byDate['2026-09-11'].weight).toEqual({ eligible: true });
    expect(report.incompleteDates).toEqual(['2026-09-11']);
    const reverted = evaluateEligibility(data, { decisions: [], completeness: [...marks, { ...marks[0], status: 'complete', decidedAt: '2026-09-17T00:00:00Z' }] }, '2026-09-20');
    expect(reverted.days.find((day) => day.date === '2026-09-11')!.intake).toEqual({ eligible: true });
  });

  test('food detail uses the food import cutoff; workouts use the workout import cutoff', () => {
    const data: ImportedHistory = { ...emptyHistory,
      foodDays: [{ date: '2026-09-14', source: 'food_csv', entries: 3, calories: 2000, protein: 1, fat: 1, carbs: 1, missingCalories: 0, revisionId: 1 }],
      workoutDays: [{ date: '2026-09-14', source: 'workout_csv', sets: 10, exercises: 3, workouts: ['Push'], durations: [3000], revisionId: 1 }],
      imports: [importAt('2026-09-15T15:00:00Z', { added: 0, foodAdded: 1 }), importAt('2026-09-14T15:00:00Z', { added: 0, workoutAdded: 1 })] };
    const day = evaluateEligibility(data, { decisions: [], completeness: [] }, '2026-09-20').days[0];
    expect(day.intake).toEqual({ eligible: true });
    expect(day.intakeSource).toBe('detail');
    expect(day.workouts).toEqual({ eligible: false, reason: 'after-import-cutoff' });
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
