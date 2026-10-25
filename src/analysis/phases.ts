/**
 * Ticket 16: weight phases and plateaus from MacroFactor's trend-weight rate.
 *
 * Rule (weight-phases-v1, every parameter a versioned setting shown in the UI):
 * 1. Each date with an eligible trend value gets a rolling rate: 7 × the least-squares slope of the
 *    eligible trend values in the trailing `windowDays` calendar days, when at least `minimumPoints`
 *    are present. Otherwise the date has no rate; nothing is interpolated.
 * 2. Each rate is labeled by fixed bands (lb/week): Losing ≤ −0.5 < Slowing ≤ −0.15 < Maintaining
 *    < +0.15 ≤ Gaining.
 * 3. Consecutive calendar dates with the same label form a run; a date without a rate ends the run.
 * 4. A run shorter than `minimumDays` that sits directly between two runs with the same label (no
 *    gap on either side) takes that label, repeated until nothing changes. Merged neighbors join.
 * 5. Runs of at least `minimumDays` are phases; shorter ones are listed as too short to label.
 * A Maintaining phase is a plateau: a stretch where the rate stayed in the maintenance band. That is
 * a description of the trend line, not a metabolic diagnosis.
 */
import { requiredDays, slopePerDay, daysBetween } from './periods';
import { addDays } from './eligibility';
import { meanOf, present, type DailyValues } from './daily';

export const phasesMethodVersion = 'weight-phases-v1';
export type PhaseLabel = 'Losing' | 'Slowing' | 'Maintaining' | 'Gaining';
export const phaseLabels: PhaseLabel[] = ['Losing', 'Slowing', 'Maintaining', 'Gaining'];

export interface PhaseSettings { windowDays: number; minimumPoints: number; minimumDays: number; losingAtOrBelow: number; slowingAtOrBelow: number; gainingAtOrAbove: number }
export const phaseSettings: PhaseSettings = { windowDays: 14, minimumPoints: 10, minimumDays: 14, losingAtOrBelow: -0.5, slowingAtOrBelow: -0.15, gainingAtOrAbove: 0.15 };

export function labelRate(rate: number, settings: PhaseSettings = phaseSettings): PhaseLabel {
  const rounded = Math.round(rate * 1e6) / 1e6;
  if (rounded <= settings.losingAtOrBelow) return 'Losing';
  if (rounded <= settings.slowingAtOrBelow) return 'Slowing';
  if (rounded >= settings.gainingAtOrAbove) return 'Gaining';
  return 'Maintaining';
}

export interface MeasureSummary { count: number; mean: number | null; covered: boolean }
export interface Phase {
  start: string;
  end: string;
  length: number;
  label: PhaseLabel;
  plateau: boolean;
  /** 7 × least-squares slope of the phase's own trend values (lb/week). */
  rate: number | null;
  startTrend: number | null;
  endTrend: number | null;
  required: number;
  intake: MeasureSummary;
  balance: MeasureSummary;
  targetDifference: MeasureSummary;
  steps: MeasureSummary;
  protein: MeasureSummary;
  /** Working sets per 7 days over confirmed workout dates; covered when the confirmed dates meet the gate. */
  weeklySets: MeasureSummary;
  warning: boolean;
}
export interface ShortRun { start: string; end: string; length: number; label: PhaseLabel }
export interface RateDay { date: string; trend: number | null; rate: number | null; label: PhaseLabel | null }
export interface PhaseAnalysis {
  method: typeof phasesMethodVersion;
  settings: PhaseSettings;
  days: RateDay[];
  phases: Phase[];
  shortRuns: ShortRun[];
  /** Dates with a trend value but too few points in the window for a rate. */
  unrated: number;
}

interface Run { start: string; end: string; label: PhaseLabel }

export function rollingRates(days: DailyValues[], settings: PhaseSettings = phaseSettings): RateDay[] {
  const points = days.flatMap((day) => (day.trend === null ? [] : [{ date: day.date, value: day.trend }]));
  let first = 0;
  const rateByDate = new Map<string, number>();
  points.forEach((point, index) => {
    const from = addDays(point.date, -(settings.windowDays - 1));
    while (points[first].date < from) first += 1;
    const window = points.slice(first, index + 1);
    const slope = window.length >= settings.minimumPoints ? slopePerDay(window) : null;
    if (slope !== null) rateByDate.set(point.date, slope * 7);
  });
  return days.map((day) => {
    const rate = rateByDate.get(day.date) ?? null;
    return { date: day.date, trend: day.trend, rate, label: rate === null ? null : labelRate(rate, settings) };
  });
}

function runs(rated: RateDay[]): Run[] {
  const result: Run[] = [];
  for (const day of rated) {
    const last = result.at(-1);
    if (!day.label) continue;
    if (last && last.label === day.label && addDays(last.end, 1) === day.date) last.end = day.date;
    else result.push({ start: day.date, end: day.date, label: day.label });
  }
  return result;
}

const lengthOf = (run: Run) => daysBetween(run.start, run.end);
const touching = (left: Run, right: Run) => addDays(left.end, 1) === right.start;

export function mergeRuns(input: Run[], minimumDays: number): Run[] {
  let list = input.map((run) => ({ ...run }));
  for (let changed = true; changed;) {
    changed = false;
    for (let index = 1; index < list.length - 1; index += 1) {
      const [before, run, after] = [list[index - 1], list[index], list[index + 1]];
      if (lengthOf(run) < minimumDays && before.label === after.label && touching(before, run) && touching(run, after)) {
        list.splice(index - 1, 3, { start: before.start, end: after.end, label: before.label });
        changed = true;
        break;
      }
    }
  }
  // Join neighbors that ended up with the same label.
  list = list.reduce<Run[]>((joined, run) => {
    const last = joined.at(-1);
    if (last && last.label === run.label && touching(last, run)) last.end = run.end;
    else joined.push({ ...run });
    return joined;
  }, []);
  return list;
}

function summary(values: number[], required: number): MeasureSummary {
  return { count: values.length, mean: meanOf(values), covered: values.length >= required };
}

export function summarizeRange(days: DailyValues[], start: string, end: string) {
  const inside = days.filter((day) => day.date >= start && day.date <= end);
  const length = daysBetween(start, end);
  const required = requiredDays(length);
  const trendPoints = inside.flatMap((day) => (day.trend === null ? [] : [{ date: day.date, value: day.trend }]));
  const slope = slopePerDay(trendPoints);
  const confirmed = inside.filter((day) => day.workingSets !== null);
  const sets = confirmed.reduce((sum, day) => sum + day.workingSets!, 0);
  return {
    length, required,
    rate: slope === null ? null : slope * 7,
    startTrend: trendPoints[0]?.value ?? null,
    endTrend: trendPoints.at(-1)?.value ?? null,
    trendCount: trendPoints.length,
    intake: summary(present(inside, (day) => day.intake), required),
    balance: summary(present(inside, (day) => day.balance), required),
    targetDifference: summary(present(inside, (day) => day.targetDifference), required),
    steps: summary(present(inside, (day) => day.steps), required),
    protein: summary(present(inside, (day) => day.protein), required),
    weeklySets: { count: confirmed.length, mean: confirmed.length ? (sets / confirmed.length) * 7 : null, covered: confirmed.length >= required },
    scale: summary(present(inside, (day) => day.scale), required),
    trend: summary(trendPoints.map((point) => point.value), required),
    warning: inside.some((day) => day.estimateWarning && day.trend !== null),
  };
}

export function analyzePhases(days: DailyValues[], settings: PhaseSettings = phaseSettings): PhaseAnalysis {
  const rated = rollingRates(days, settings);
  const merged = mergeRuns(runs(rated), settings.minimumDays);
  const phases: Phase[] = [];
  const shortRuns: ShortRun[] = [];
  for (const run of merged) {
    const length = lengthOf(run);
    if (length < settings.minimumDays) { shortRuns.push({ ...run, length }); continue; }
    const stats = summarizeRange(days, run.start, run.end);
    phases.push({
      start: run.start, end: run.end, length, label: run.label, plateau: run.label === 'Maintaining',
      rate: stats.rate, startTrend: stats.startTrend, endTrend: stats.endTrend, required: stats.required,
      intake: stats.intake, balance: stats.balance, targetDifference: stats.targetDifference, steps: stats.steps,
      protein: stats.protein, weeklySets: stats.weeklySets, warning: stats.warning,
    });
  }
  return { method: phasesMethodVersion, settings, days: rated, phases, shortRuns, unrated: rated.filter((day) => day.trend !== null && day.rate === null).length };
}
