import { describe, expect, test } from 'vitest';
import { generateReview, reviewPeriods } from '../src/analysis/review';
import { buildDailySeries } from '../src/analysis/daily';
import { analyzeExercises } from '../src/analysis/exercise';
import { reportFingerprint } from '../src/analysis/report';
import { addDays } from '../src/analysis/eligibility';
import { reportingToday } from '../src/import/preview';
import { defaultPreferences } from '../src/gateway';
import { seededGateway } from './fixtures/insights-gateway';

describe('long-range reviews', () => {
  test('calendar periods cover the history; the period with the last day is partial', () => {
    expect(reviewPeriods('month', '2026-01-15', '2026-03-10').map((period) => [period.label, period.start, period.end, period.partial])).toEqual([
      ['March 2026', '2026-03-01', '2026-03-31', true], ['February 2026', '2026-02-01', '2026-02-28', false], ['January 2026', '2026-01-01', '2026-01-31', false]]);
    expect(reviewPeriods('quarter', '2025-11-20', '2026-04-01').map((period) => period.label)).toEqual(['Q2 2026', 'Q1 2026', 'Q4 2025']);
    expect(reviewPeriods('year', '2025-11-20', '2026-04-01').map((period) => [period.label, period.end])).toEqual([['2026', '2026-12-31'], ['2025', '2025-12-31']]);
  });

  test('a review reuses the analyses, states unavailable sections, includes notes, and fingerprints reproducibly', async () => {
    const gateway = await seededGateway();
    const history = await gateway.loadHistory();
    const { evaluateEligibility } = await import('../src/analysis/eligibility');
    const report = evaluateEligibility(history, history.review, reportingToday());
    const workouts = await gateway.loadWorkoutHistory();
    const days = buildDailySeries(history, report, workouts);
    const exercises = analyzeExercises(workouts, report, {}, { bandPercent: 2.5, durationUnit: 'seconds' });
    const quarter = reviewPeriods('quarter', days[0].date, days.at(-1)!.date).find((period) => !period.partial)!;
    const noteDate = addDays(quarter.start, 40);
    const note = { id: 'n1', version: 1, startDate: noteDate, endDate: noteDate, text: 'New program', category: 'Training' as const, updatedAt: 'x' };
    const context = { history, report, preferences: defaultPreferences, days, exercises, notes: [note], muscles: null };
    const review = generateReview(context, quarter);
    expect(review.inputs).toMatchObject({ templateVersion: 'review-v1', period: { label: quarter.label, partial: false }, notes: [{ id: 'n1', text: 'New program' }] });
    const titles = review.sections.map((section) => section.title);
    expect(titles).toEqual(['Weight', 'Nutrition', 'Activity and expenditure', 'Training', 'Your notes', 'About this review']);
    const text = review.sections.flatMap((section) => section.findings.map((finding) => finding.text)).join('\n');
    expect(text).toMatch(/MacroFactor's trend weight moved from [\d.]+ lb to [\d.]+ lb/);
    expect(text).toContain('Muscle balance is unavailable: no exercise is mapped');
    expect(text).toContain('“New program” (Training). 28 days before vs after');
    expect(text).not.toMatch(/\b(should|recommend|because|will)\b/i);
    expect(await reportFingerprint(review)).toBe(await reportFingerprint(generateReview(context, quarter)));
    const without = generateReview({ ...context, exercises: null }, quarter);
    expect(without.sections[3].findings[0]).toMatchObject({ kind: 'unavailable', text: 'Training results are unavailable because workout sets did not load.' });
  });
});
