/**
 * Ticket 08: scale weight, MacroFactor's trend weight, and steps for a period and the period before it.
 *
 * Scale points and source trend values are kept separate: the trend is MacroFactor's estimate as
 * exported, never reconstructed from scale weigh-ins. Missing days stay missing. Each measure keeps its
 * own coverage, so missing nutrition or workouts never hide a valid weight or steps series.
 */
import type { ImportedHistory } from '../gateway';
import { weightField, type Eligibility, type EligibilityReport } from './eligibility';
import { anchorDate, datesBetween, mean, measurementAnchor, requiredDays, resolvePeriod, slopePerDay, type WindowChoice } from './periods';

export const trendsMethodVersion = 'weight-activity-v1';
export const trendWeightField = 'Trend Weight (lb)';
export const stepsField = 'Steps';

export interface TrendDay {
  date: string;
  scale: number | null;
  scaleStatus: Eligibility;
  trend: number | null;
  trendStatus: Eligibility;
  steps: number | null;
  stepsStatus: Eligibility;
  /** MacroFactor's estimates on this date may reflect a questioned weigh-in. */
  estimateWarning: string | null;
}

export interface Measure { count: number; mean: number | null; first: { date: string; value: number } | null; last: { date: string; value: number } | null; covered: boolean }

export interface TrendPeriod {
  start: string;
  end: string;
  length: number;
  required: number;
  days: TrendDay[];
  scale: Measure;
  trend: Measure & {
    /** 7 × least-squares slope of eligible trend values against elapsed calendar days (lb/week); only when covered. */
    weeklyRate: number | null;
  };
  steps: Measure;
  warningDates: string[];
}

export interface TrendShift { scaleMean: number | null; weeklyRate: number | null; stepsMean: number | null }

export interface TrendAnalysis {
  method: typeof trendsMethodVersion;
  anchor: string | null;
  current: TrendPeriod | null;
  previous: TrendPeriod | null;
  shift: TrendShift;
}

const number = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function buildDays(history: ImportedHistory, report: EligibilityReport, start: string, end: string): TrendDay[] {
  const statusByDate = new Map(report.days.map((day) => [day.date, day]));
  const values = new Map<string, Record<string, number | null>>();
  for (const record of history.records) {
    if (record.domain === 'scale_weight' || record.domain === 'trend_weight' || record.domain === 'steps') values.set(`${record.date}|${record.domain}`, record.values);
  }
  return datesBetween(start, end).map((date) => {
    const status = statusByDate.get(date);
    const missing: Eligibility = { eligible: false, reason: date > report.today ? 'future' : date === report.today ? 'in-progress' : 'not-recorded' };
    return {
      date,
      scale: number(values.get(`${date}|scale_weight`)?.[weightField]),
      scaleStatus: status?.weight ?? missing,
      trend: number(values.get(`${date}|trend_weight`)?.[trendWeightField]),
      trendStatus: status?.trendWeight ?? missing,
      steps: number(values.get(`${date}|steps`)?.[stepsField]),
      stepsStatus: status?.steps ?? missing,
      estimateWarning: status?.estimateWarning ?? null,
    };
  });
}

function measure(points: Array<{ date: string; value: number }>, required: number): Measure {
  return { count: points.length, mean: mean(points.map((point) => point.value)), first: points[0] ?? null, last: points.at(-1) ?? null, covered: points.length >= required };
}

export function summarizeTrends(days: TrendDay[], start: string, end: string, length: number): TrendPeriod {
  const required = requiredDays(length);
  const pick = (value: (day: TrendDay) => number | null, status: (day: TrendDay) => Eligibility) =>
    days.flatMap((day) => (status(day).eligible && value(day) !== null ? [{ date: day.date, value: value(day)! }] : []));
  const trendPoints = pick((day) => day.trend, (day) => day.trendStatus);
  const trend = measure(trendPoints, required);
  const slope = slopePerDay(trendPoints);
  return {
    start, end, length, required, days,
    scale: measure(pick((day) => day.scale, (day) => day.scaleStatus), required),
    trend: { ...trend, weeklyRate: trend.covered && slope !== null ? slope * 7 : null },
    steps: measure(pick((day) => day.steps, (day) => day.stepsStatus), required),
    warningDates: days.filter((day) => day.estimateWarning && (day.trend !== null)).map((day) => day.date),
  };
}

const gated = (current: Measure, previous: Measure, left: number | null, right: number | null) =>
  current.covered && previous.covered && left !== null && right !== null ? left - right : null;

export function analyzeTrends(history: ImportedHistory, report: EligibilityReport, choice: WindowChoice): TrendAnalysis {
  const anchor = anchorDate(report) ?? measurementAnchor(report);
  const bounds = resolvePeriod(choice, anchor, report.today);
  if (!bounds) return { method: trendsMethodVersion, anchor, current: null, previous: null, shift: { scaleMean: null, weeklyRate: null, stepsMean: null } };
  const current = summarizeTrends(buildDays(history, report, bounds.start, bounds.end), bounds.start, bounds.end, bounds.length);
  const previous = summarizeTrends(buildDays(history, report, bounds.previousStart, bounds.previousEnd), bounds.previousStart, bounds.previousEnd, bounds.length);
  return {
    method: trendsMethodVersion, anchor, current, previous,
    shift: {
      scaleMean: gated(current.scale, previous.scale, current.scale.mean, previous.scale.mean),
      weeklyRate: gated(current.trend, previous.trend, current.trend.weeklyRate, previous.trend.weeklyRate),
      stepsMean: gated(current.steps, previous.steps, current.steps.mean, previous.steps.mean),
    },
  };
}
