import { describe, expect, test } from 'vitest';
import { emptyHistory, type FoodDaySummary, type ImportedHistory, type ImportSummary, type StoredDailyRecord } from '../src/gateway';
import { addDays, emptyReviewState, evaluateEligibility, type ReviewState } from '../src/analysis/eligibility';
import { analyzeIntake, anchorDate, customWindowProblem, populationSd, requiredDays } from '../src/analysis/intake';

const today = '2026-10-20';
function importAt(committedAt: string, overrides: Partial<ImportSummary> = {}): ImportSummary {
  return { id: committedAt, kind: 'import', committedAt, outcome: 'changed', revisionId: 1, added: 1, changed: 0, unchanged: 0, removed: 0,
    foodAdded: 0, foodChanged: 0, foodUnchanged: 0, foodKept: 0, workoutAdded: 0, workoutChanged: 0, workoutUnchanged: 0, workoutKept: 0,
    firstDate: null, lastDate: null, clearedDate: null, clearedDomain: null, undoesId: null, undone: false, fileNames: [], reconciliation: [], ...overrides };
}
type Day = { intake?: number | null; expenditure?: number | null; target?: number | null };
/** Daily workbook values for consecutive dates ending at `end`. */
function history(end: string, values: Day[], extra: Partial<ImportedHistory> = {}): ImportedHistory {
  const records: StoredDailyRecord[] = values.flatMap((day, index) => {
    const date = addDays(end, index - values.length + 1);
    const rows: StoredDailyRecord[] = [];
    if (day.intake !== null) rows.push({ date, domain: 'nutrition_totals', values: { 'Calories (kcal)': day.intake ?? 2300 }, sourceFileId: 'f', revisionId: 1 });
    if (day.expenditure !== null) rows.push({ date, domain: 'expenditure', values: { Expenditure: day.expenditure ?? 2500 }, sourceFileId: 'f', revisionId: 1 });
    if (day.target !== null) rows.push({ date, domain: 'targets', values: { 'Target Calories (kcal)': day.target ?? 2350 }, sourceFileId: 'f', revisionId: 1 });
    return rows;
  });
  return { ...emptyHistory, records, imports: [importAt('2026-10-20T15:00:00Z')], ...extra };
}
const analyze = (data: ImportedHistory, choice: Parameters<typeof analyzeIntake>[2] = { kind: 'days', length: 28 }, review: ReviewState = emptyReviewState) =>
  analyzeIntake(data, evaluateEligibility(data, review, today), choice);
const repeat = (count: number, day: Day = {}) => Array.from({ length: count }, () => ({ ...day }));

describe('coverage rules', () => {
  test('7 and 28 day gates take precedence; other lengths need 75% rounded up', () => {
    expect([7, 28, 14, 30, 10, 1].map(requiredDays)).toEqual([5, 21, 11, 23, 8, 1]);
  });

  test('the default window ends at the latest past day with imported intake, never today', () => {
    // Intake through today (in progress) and a pre-logged tomorrow: neither moves the anchor.
    const data = history('2026-10-21', repeat(60));
    expect(anchorDate(evaluateEligibility(data, emptyReviewState, today))).toBe('2026-10-19');
    const result = analyze(data);
    expect(result.current).toMatchObject({ start: '2026-09-22', end: '2026-10-19', length: 28, required: 21 });
    expect(result.previous).toMatchObject({ start: '2026-08-25', end: '2026-09-21' });
  });

  test('a past day not yet confirmed by a later import does not anchor the period', () => {
    const data = history('2026-10-19', repeat(40), { imports: [importAt('2026-10-15T15:00:00Z')] });
    expect(analyze(data, { kind: 'days', length: 7 }).current?.end).toBe('2026-10-14');
  });

  test('a period below the threshold is marked insufficient and comparisons are withheld', () => {
    // 28 current days but only 20 with intake; previous period fully covered.
    const values = [...repeat(28), ...repeat(8, { intake: null }), ...repeat(20)];
    const result = analyze(history('2026-10-19', values));
    expect(result.current?.intake.count).toBe(20);
    expect(result.current?.intakeCovered).toBe(false);
    expect(result.previous?.intakeCovered).toBe(true);
    expect(result.intakeShift).toBeNull();
    expect(result.balanceShift).toBeNull();
  });

  test('custom windows are validated and compare against the same length just before', () => {
    expect(customWindowProblem('2026-10-10', '2026-10-01', today)).toMatch(/on or before/);
    expect(customWindowProblem('2026-10-10', today, today)).toMatch(/in progress/);
    expect(customWindowProblem('2025-01-01', '2026-10-19', today)).toMatch(/at most 366/);
    const result = analyze(history('2026-10-19', repeat(40)), { kind: 'custom', start: '2026-10-06', end: '2026-10-19' });
    expect(result.current).toMatchObject({ length: 14, required: 11 });
    expect(result.previous).toMatchObject({ start: '2026-09-22', end: '2026-10-05' });
  });
});

describe('intake distribution', () => {
  test('mean, median, population SD and target difference use eligible days only and keep high-intake days', () => {
    const week = [2000, 2200, 2400, 2600, 4800, 2100, 2300];
    const data = history('2026-10-19', [...repeat(7, { intake: 2000 }), ...week.map((intake) => ({ intake, target: 2300 }))]);
    const result = analyze(data, { kind: 'days', length: 7 });
    const intake = result.current!.intake;
    expect(intake.count).toBe(7);
    expect(intake.mean).toBeCloseTo(18400 / 7, 9);
    expect(intake.median).toBe(2300);
    expect(intake.sd).toBeCloseTo(populationSd(week), 9);
    expect(populationSd([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(result.current!.target.meanDifference).toBeCloseTo(18400 / 7 - 2300, 9);
    expect(result.intakeShift?.mean).toBeCloseTo(18400 / 7 - 2000, 9);
    expect(result.intakeShift?.median).toBe(300);
  });

  test('a day marked incomplete is left out of intake and balance but stays visible with its reason', () => {
    const data = history('2026-10-19', repeat(14));
    const review: ReviewState = { decisions: [], completeness: [{ date: '2026-10-18', domain: 'nutrition', status: 'incomplete', decidedAt: '2026-10-20T00:00:00Z' }] };
    const result = analyze(data, { kind: 'days', length: 7 }, review);
    const day = result.current!.days.find((item) => item.date === '2026-10-18')!;
    expect(day).toMatchObject({ intake: 2300, intakeIncluded: false, matched: false, balance: null, intakeStatus: { eligible: false, reason: 'incomplete' } });
    expect(result.current!.intake.count).toBe(6);
    expect(result.current!.balance.count).toBe(6);
  });

  test('food entries are the source when present and are attributed separately', () => {
    const food: FoodDaySummary = { date: '2026-10-19', source: 'food_csv', entries: 4, calories: 3100, protein: 1, fat: 1, carbs: 1, missingCalories: 0, revisionId: 1 };
    const data = history('2026-10-19', repeat(14), { foodDays: [food], imports: [importAt('2026-10-20T15:00:00Z', { foodAdded: 4 })] });
    const result = analyze(data, { kind: 'days', length: 7 });
    expect(result.current!.days.at(-1)).toMatchObject({ intake: 3100, intakeSource: 'detail', balance: 600 });
    expect(result.current!.intake.sources).toEqual({ detail: 1, workbook: 6 });
  });
});

describe('modeled balance', () => {
  test('gross surplus, gross deficit, net, frequency and ratio follow the specification', () => {
    const week: Day[] = [
      { intake: 2000, expenditure: 2500 }, { intake: 3000, expenditure: 2500 }, { intake: 2500, expenditure: 2500 },
      { intake: 2200, expenditure: 2400 }, { intake: 2900, expenditure: 2400 }, { intake: 2400, expenditure: null }, { intake: 2100, expenditure: 2500 },
    ];
    const result = analyze(history('2026-10-19', [...repeat(7), ...week]), { kind: 'days', length: 7 });
    const balance = result.current!.balance;
    expect(balance).toMatchObject({ count: 6, grossSurplus: 1000, grossDeficit: 1100, net: -100, surplusDays: 2, deficitDays: 3 });
    expect(balance.surplusFrequency).toBeCloseTo(2 / 6, 12);
    expect(balance.ratio).toBeCloseTo(1000 / 1100, 12);
    // Chart rows and metrics are the same data.
    expect(result.current!.days.reduce((sum, day) => sum + (day.balance ?? 0), 0)).toBe(balance.net);
    // Six matched days pass the 5-of-7 gate; the previous week (all 2300 vs 2500) does too.
    expect(result.balanceShift).toMatchObject({ net: -100 - -1400, grossSurplus: 1000, grossDeficit: 1100 - 1400 });
  });

  test('no deficit means an unavailable ratio, and ratios above 100% are not capped', () => {
    const surplusOnly = analyze(history('2026-10-19', repeat(14, { intake: 2700, expenditure: 2500 })), { kind: 'days', length: 7 });
    expect(surplusOnly.current!.balance).toMatchObject({ grossDeficit: 0, ratio: null, surplusFrequency: 1 });
    const mostlySurplus = analyze(history('2026-10-19', [...repeat(6, { intake: 3000, expenditure: 2500 }), { intake: 2400, expenditure: 2500 }]), { kind: 'days', length: 7 });
    expect(mostlySurplus.current!.balance.ratio).toBe(30);
  });

  test('balance needs matched days: intake without an expenditure estimate is not matched', () => {
    const values = repeat(14, { expenditure: null });
    values[13] = { expenditure: 2500 };
    const result = analyze(history('2026-10-19', values), { kind: 'days', length: 7 });
    expect(result.current!.intakeCovered).toBe(true);
    expect(result.current!.balanceCovered).toBe(false);
    expect(result.current!.balance.count).toBe(1);
  });

  test('no imported intake means no period at all', () => {
    expect(analyze({ ...emptyHistory }).current).toBeNull();
  });
});
