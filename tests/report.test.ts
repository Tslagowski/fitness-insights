import { describe, expect, test } from 'vitest';
import { defaultPreferences, emptyHistory, type ImportedHistory, type ImportSummary, type SavedWorkoutDay, type StoredDailyRecord } from '../src/gateway';
import { addDays, emptyReviewState, evaluateEligibility } from '../src/analysis/eligibility';
import { canonicalJson, generateReport, type WrittenReport } from '../src/analysis/report';
import type { WorkoutSet } from '../src/import/workout';

const today = '2026-10-20';
function importAt(committedAt: string, overrides: Partial<ImportSummary> = {}): ImportSummary {
  return { id: committedAt, kind: 'import', committedAt, outcome: 'changed', revisionId: 1, added: 1, changed: 0, unchanged: 0, removed: 0,
    foodAdded: 0, foodChanged: 0, foodUnchanged: 0, foodKept: 0, workoutAdded: 1, workoutChanged: 0, workoutUnchanged: 0, workoutKept: 0,
    firstDate: null, lastDate: null, clearedDate: null, clearedDomain: null, undoesId: null, undone: false, fileNames: ['export.xlsx'], reconciliation: [], ...overrides };
}
/** 56 days ending Oct 19: steady previous period, then a current period with four 3,500 kcal days. */
function fullHistory(days = 56): ImportedHistory {
  const records: StoredDailyRecord[] = Array.from({ length: days }, (_, index) => {
    const date = addDays('2026-10-19', index - days + 1);
    const current = index >= days - 28;
    const calories = current ? (index % 7 === 5 ? 3500 : 2200) : 2300;
    const row = (domain: StoredDailyRecord['domain'], values: Record<string, number>): StoredDailyRecord => ({ date, domain, values, sourceFileId: 'f', revisionId: 1 });
    return [row('nutrition_totals', { 'Calories (kcal)': calories }), row('expenditure', { Expenditure: 2500 }), row('targets', { 'Target Calories (kcal)': 2400 }),
      row('scale_weight', { 'Weight (lb)': 201 - 0.1 * index }), row('trend_weight', { 'Trend Weight (lb)': 200 - 0.1 * index }), row('steps', { Steps: current ? 9000 : 7000 })];
  }).flat();
  return { ...emptyHistory, revisionId: 4, records, imports: [importAt('2026-10-20T15:00:00Z', { revisionId: 4, firstDate: '2026-08-25', lastDate: '2026-10-19' })] };
}
const set = (exercise: string, values: WorkoutSet): WorkoutSet => ({ 'Workout Duration': 2912, Workout: 'Push A', Exercise: exercise, 'Set Type': 'Standard Set', ...values });
const workouts: SavedWorkoutDay[] = [100, 100, 100, 105, 105, 110, 110].map((load, index) => ({ date: addDays('2026-10-19', (index - 6) * 7), source: 'workout_csv', revisionId: 1,
  sets: [set('Bench Press', { 'Weight (lb)': load, Reps: 8 }), set('Row', { 'Weight (lb)': 120, Reps: 8 })] }));
function generate(history: ImportedHistory, sets: SavedWorkoutDay[] | null = workouts): WrittenReport {
  const withWorkouts = { ...history, workoutDays: (sets ?? workouts).map((day) => ({ date: day.date, source: day.source, sets: day.sets.length, exercises: 2, workouts: ['Push A'], durations: [2912], revisionId: 1 })) };
  return generateReport(withWorkouts, evaluateEligibility(withWorkouts, emptyReviewState, today), sets, defaultPreferences);
}
const texts = (report: WrittenReport) => report.sections.flatMap((section) => section.findings.map((finding) => finding.text)).join('\n');
const finding = (report: WrittenReport, id: string) => report.sections.flatMap((section) => section.findings).find((item) => item.id === id)!;

describe('written overview', () => {
  test('findings state the same values as the calculations, with windows, counts, and methods', () => {
    const report = generate(fullHistory());
    expect(finding(report, 'intake-center').text).toBe('Mean intake was 2,386 kcal and median 2,200 kcal over 28 counted days (Sep 22, 2026 – Oct 19, 2026). Compared with Aug 25, 2026 – Sep 21, 2026, the mean changed +86 kcal and the median −100 kcal.');
    expect(finding(report, 'intake-center').evidence).toMatchObject({ method: 'intake-balance-v1', window: { start: '2026-09-22', end: '2026-10-19' }, counts: { counted: 28, required: 21 } });
    expect(finding(report, 'intake-tail').text).toContain('they remain included. This describes the data and does not establish a cause.');
    expect(finding(report, 'intake-tail').evidence.dates).toHaveLength(3);
    expect(finding(report, 'balance-net')).toMatchObject({ kind: 'source-estimate' });
    expect(finding(report, 'balance-net').text).toContain('not measured fat or weight change');
    expect(finding(report, 'weight-trend')).toMatchObject({ kind: 'source-estimate' });
    expect(finding(report, 'weight-trend').text).toContain('−0.70 lb/week');
    expect(finding(report, 'steps-mean').text).toBe('Steps averaged 9,000 per day over 28 days with steps. That is +2,000 vs the previous 28 days.');
    expect(finding(report, 'exercise-labels').text).toContain('Progressing: Bench Press (+10.0%)');
    expect(finding(report, 'exercise-labels').text).toContain('Stable: Row (±0.0%)');
    expect(report.inputs).toMatchObject({ revisionId: 4, reportDate: today, periodEnd: '2026-10-19', templateVersion: 'overview-v1', settings: { strengthBandPercent: 2.5, durationUnit: 'seconds' } });
  });

  test('sparse data yields explicit unavailable sections, never invented findings, and each domain reports on its own', () => {
    const sparse = fullHistory(10);
    const report = generate(sparse, []);
    expect(finding(report, 'intake-unavailable').text).toContain('insufficient coverage');
    expect(finding(report, 'weight-trend-unavailable').kind).toBe('unavailable');
    expect(finding(report, 'exercise-unavailable').text).toContain('no exercise has six completed sessions');
    expect(report.sections.map((section) => section.id)).toEqual(['intake', 'balance', 'weight', 'activity', 'exercise', 'data']);
    // Steps alone (no intake): the steps section still reports.
    const stepsOnly = { ...fullHistory(), records: fullHistory().records.filter((record) => record.domain === 'steps') };
    const stepsReport = generate(stepsOnly);
    expect(finding(stepsReport, 'intake-unavailable').kind).toBe('unavailable');
    expect(finding(stepsReport, 'steps-mean').kind).toBe('observation');
    expect(generate(fullHistory(), null).sections.find((section) => section.id === 'exercise')!.findings[0].text).toContain('could not be loaded');
  });

  test('no prescriptions, forecasts, or causal claims appear in any template', () => {
    for (const report of [generate(fullHistory()), generate(fullHistory(10), [])]) {
      expect(texts(report)).not.toMatch(/\b(should|try|recommend|need to|caused by|because you|will (lose|gain)|predict)\b/i);
    }
  });

  test('import changes are reported separately; a correction to older dates is not called a recent change', () => {
    const history = fullHistory();
    history.imports = [importAt('2026-10-20T16:00:00Z', { id: 'fix', revisionId: 5, firstDate: '2026-06-01', lastDate: '2026-06-03', changed: 2, added: 0 }), ...history.imports];
    const data = generate(history).sections.find((section) => section.id === 'data')!;
    expect(data.title).toBe('Data changes (not behavior)');
    expect(data.findings[0].text).toContain('a correction to older records, not a recent change');
    expect(data.findings[1].text).not.toContain('correction to older records');
  });

  test('equal inputs produce the same canonical form regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null }] })).toBe(canonicalJson({ a: [{ c: null, d: 2 }], b: 1 }));
    expect(canonicalJson(generate(fullHistory()))).toBe(canonicalJson(generate(fullHistory())));
  });
});
