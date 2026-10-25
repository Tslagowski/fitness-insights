import { describe, expect, test } from 'vitest';
import { analyzePhases, labelRate, mergeRuns, phaseSettings } from '../src/analysis/phases';
import { buildDailySeries } from '../src/analysis/daily';
import { emptyHistory, type ImportedHistory, type StoredDailyRecord } from '../src/gateway';
import { addDays, emptyReviewState, evaluateEligibility } from '../src/analysis/eligibility';
import { series, trendLine } from './fixtures/daily-builder';

const start = '2026-01-05';

describe('weight phases', () => {
  test('loss, plateau, and regain become three phases with their own rates and summaries', () => {
    const trend = [...trendLine(250, -1, 42), ...trendLine(244, 0, 42), ...trendLine(244, 0.5, 42)];
    const days = series(start, trend.map((value, index) => ({ trend: value, intake: index < 49 ? 2000 : 2600, expenditure: 2800, steps: 9000, protein: 180,
      target: 2100, workoutsConfirmed: true, workingSets: index % 7 === 0 ? 20 : 0 })));
    const result = analyzePhases(days);
    expect(result.phases.map((phase) => [phase.label, phase.start, phase.end])).toEqual([
      ['Losing', '2026-01-14', '2026-02-22'], ['Maintaining', '2026-02-27', '2026-04-03'], ['Gaining', '2026-04-04', '2026-05-10']]);
    expect(result.shortRuns).toEqual([{ start: '2026-02-23', end: '2026-02-26', label: 'Slowing', length: 4 }]);
    const losing = result.phases.find((phase) => phase.label === 'Losing')!;
    // The rolling window lags, so the phase runs a few flat days past the turn; its own rate stays near −1 lb/week.
    expect(losing.rate!).toBeLessThan(-0.85);
    expect(losing.intake).toMatchObject({ mean: 2000, covered: true });
    expect(losing.balance.mean).toBe(-800);
    expect(losing.targetDifference.mean).toBe(-100);
    // 5 sessions of 20 sets over 40 confirmed days = 17.5 per 7 days.
    expect(losing.weeklySets.mean).toBeCloseTo(17.5, 10);
    const plateau = result.phases.find((phase) => phase.label === 'Maintaining')!;
    expect(plateau.plateau).toBe(true);
    expect(Math.abs(plateau.rate!)).toBeLessThan(0.15);
    expect(plateau.length).toBeGreaterThanOrEqual(phaseSettings.minimumDays);
    expect(result.phases.at(-1)!.label).toBe('Gaining');
    // The first 9 trend dates cannot have a 14-day rate.
    expect(result.unrated).toBe(phaseSettings.minimumPoints - 1);
    expect(result.days[0].rate).toBeNull();
  });

  test('a gap in trend data splits a phase instead of being interpolated', () => {
    const trend: Array<number | null> = trendLine(250, -1, 70);
    for (let index = 30; index < 45; index += 1) trend[index] = null;
    const result = analyzePhases(series(start, trend.map((value) => ({ trend: value }))));
    const losing = result.phases.filter((phase) => phase.label === 'Losing');
    expect(losing).toHaveLength(2);
    expect(losing[0].end).toBe(addDays(start, 29));
    // After the gap the window needs 10 points again before a rate exists.
    expect(losing[1].start).toBe(addDays(start, 45 + phaseSettings.minimumPoints - 1));
    expect(result.days.slice(30, 45).every((day) => day.rate === null && day.trend === null)).toBe(true);
  });

  test('bands are inclusive at their documented boundaries', () => {
    expect(labelRate(-0.5)).toBe('Losing');
    expect(labelRate(-0.4999)).toBe('Slowing');
    expect(labelRate(-0.15)).toBe('Slowing');
    expect(labelRate(-0.1499)).toBe('Maintaining');
    expect(labelRate(0.1499)).toBe('Maintaining');
    expect(labelRate(0.15)).toBe('Gaining');
    expect(labelRate(-0.15 - 1e-12)).toBe('Slowing');
  });

  test('short runs between matching neighbors are absorbed; other short runs are listed, not labeled', () => {
    const run = (startDate: string, length: number, label: 'Losing' | 'Slowing' | 'Maintaining' | 'Gaining') => ({ start: startDate, end: addDays(startDate, length - 1), label });
    const merged = mergeRuns([run('2026-01-01', 20, 'Losing'), run('2026-01-21', 3, 'Slowing'), run('2026-01-24', 20, 'Losing'), run('2026-02-13', 5, 'Gaining')], 14);
    expect(merged).toEqual([run('2026-01-01', 43, 'Losing'), run('2026-02-13', 5, 'Gaining')]);
    const days = series(start, [...trendLine(250, -1, 40), ...trendLine(244.3, 1, 8)].map((trend) => ({ trend })));
    const result = analyzePhases(days);
    expect(result.shortRuns.length).toBeGreaterThan(0);
    expect(result.phases.every((phase) => phase.length >= 14)).toBe(true);
  });

  test('measures keep their own coverage and only eligible values reach the series', () => {
    const records: StoredDailyRecord[] = Array.from({ length: 30 }, (_, index) => ({ date: addDays('2026-09-01', index), domain: 'trend_weight' as const,
      values: { 'Trend Weight (lb)': 230 - index * 0.1 }, sourceFileId: 'f', revisionId: 1 }));
    records.push({ date: '2026-09-02', domain: 'nutrition_totals', values: { 'Calories (kcal)': 2100, 'Protein (g)': 170 }, sourceFileId: 'f', revisionId: 1 });
    const history: ImportedHistory = { ...emptyHistory, records, imports: [{ id: 'i', kind: 'import', committedAt: '2026-10-05T12:00:00Z', outcome: 'changed', revisionId: 1, added: 1, changed: 0,
      unchanged: 0, removed: 0, foodAdded: 0, foodChanged: 0, foodUnchanged: 0, foodKept: 0, workoutAdded: 0, workoutChanged: 0, workoutUnchanged: 0, workoutKept: 0,
      firstDate: null, lastDate: null, clearedDate: null, clearedDomain: null, undoesId: null, undone: false, fileNames: [], reconciliation: [] }] };
    const report = evaluateEligibility(history, { ...emptyReviewState, completeness: [{ date: '2026-09-02', domain: 'nutrition', status: 'incomplete', decidedAt: '2026-10-01T00:00:00Z' }] }, '2026-10-10');
    const days = buildDailySeries(history, report);
    expect(days).toHaveLength(30);
    expect(days[1]).toMatchObject({ date: '2026-09-02', intake: null, protein: null, trend: 229.9 });
    const phase = analyzePhases(days).phases[0];
    expect(phase.label).toBe('Losing');
    expect(phase.intake).toEqual({ count: 0, mean: null, covered: false });
    expect(phase.weeklySets.covered).toBe(false);
  });
});
