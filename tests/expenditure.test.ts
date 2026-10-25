import { describe, expect, test } from 'vitest';
import { monthlyGroups, phaseGroups, stepsAssociation, withReference } from '../src/analysis/expenditure';
import { analyzePhases } from '../src/analysis/phases';
import { series, trendLine } from './fixtures/daily-builder';

describe('expenditure per pound', () => {
  test('a constant kcal-per-lb ratio implies exactly the actual change', () => {
    const trend = trendLine(250, -1, 90);
    const days = series('2026-01-01', trend.map((value) => ({ trend: value, expenditure: value * 12 })));
    const { reference, groups } = withReference(monthlyGroups(days), null);
    expect(reference!.key).toBe('2026-01');
    expect(groups.map((group) => group.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    for (const group of groups) {
      expect(group.kcalPerLb).toBeCloseTo(12, 10);
      expect(group.difference).toBeCloseTo(0, 8);
    }
    expect(groups[2].expenditureChange).toBeLessThan(0);
    expect(groups[2].impliedChange).toBeCloseTo(groups[2].expenditureChange!, 8);
  });

  test('expenditure falling faster than weight shows a negative gap from the implied value', () => {
    const days = series('2026-01-01', trendLine(250, -1, 59).map((value, index) => ({ trend: value, expenditure: index < 31 ? 3000 : 2700 })));
    const { groups } = withReference(monthlyGroups(days), '2026-01');
    const january = groups[0];
    const february = groups[1];
    expect(january.difference).toBeCloseTo(0, 8);
    expect(february.expenditureChange).toBe(-300);
    expect(february.implied).toBeCloseTo((3000 / january.meanTrend!) * february.meanTrend!, 8);
    expect(february.difference!).toBeLessThan(-200);
  });

  test('months below coverage are not compared; warnings carry to affected months', () => {
    const values = trendLine(250, -1, 59).map((value, index) => ({ trend: value, expenditure: 3000, estimateWarning: index === 40 }));
    for (let index = 0; index < 15; index += 1) values[index] = { trend: null as unknown as number, expenditure: 3000, estimateWarning: false };
    const { reference, groups } = withReference(monthlyGroups(series('2026-01-01', values)), '2026-01');
    expect(groups[0]).toMatchObject({ matched: 16, required: 24, covered: false, difference: null });
    // January is not covered, so February becomes the reference.
    expect(reference!.key).toBe('2026-02');
    expect(groups[1].warning).toBe(true);
    expect(groups[0].warning).toBe(false);
  });

  test('phase groups reuse ticket 16 phases; the steps association needs three covered months', () => {
    const trend = [...trendLine(250, -1, 60), ...trendLine(241.43, 0, 60)];
    const days = series('2026-01-01', trend.map((value, index) => ({ trend: value, expenditure: 2400 + Math.floor(index / 30) * 100, steps: 6000 + Math.floor(index / 30) * 1000 })));
    const phases = analyzePhases(days).phases;
    const byPhase = phaseGroups(days, phases);
    expect(byPhase).toHaveLength(phases.length);
    expect(byPhase[0].start).toBe(phases[0].start);
    const association = stepsAssociation(monthlyGroups(days));
    expect(association.months).toBe(4);
    expect(association.kcalPer1000Steps).toBeCloseTo(100, 0);
    expect(stepsAssociation(monthlyGroups(days.slice(0, 59))).kcalPer1000Steps).toBeNull();
  });
});
