/**
 * Shared calendar periods and coverage gates for the analysis tickets (07, 08, 10).
 * Dates are calendar strings (America/Denver reporting days) handled with integer day arithmetic only,
 * so no viewing device's timezone can shift them.
 */
import { addDays, type EligibilityReport } from './eligibility';

export const maximumWindowDays = 366;

export type WindowChoice = { kind: 'days'; length: 7 | 28 } | { kind: 'custom'; start: string; end: string };

export interface PeriodBounds { start: string; end: string; length: number; previousStart: string; previousEnd: string }

/** Eligible days a period needs before headline values and comparisons are shown. */
export function requiredDays(length: number): number {
  if (length === 7) return 5;
  if (length === 28) return 21;
  return Math.ceil(0.75 * length);
}

export function daysBetween(start: string, end: string): number {
  const toUtc = (date: string) => { const [year, month, day] = date.split('-').map(Number); return Date.UTC(year, month - 1, day); };
  return Math.round((toUtc(end) - toUtc(start)) / 86_400_000) + 1;
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function populationSd(values: number[]): number {
  const center = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length);
}

/** Validates a custom window; returns a message for the owner or null when it is usable. */
export function customWindowProblem(start: string, end: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return 'Choose both a start and an end date.';
  if (start > end) return 'The start date must be on or before the end date.';
  if (end >= today) return 'Custom periods must end before today; today is still in progress.';
  if (daysBetween(start, end) > maximumWindowDays) return `Custom periods can be at most ${maximumWindowDays} days.`;
  return null;
}

const timingReasons = new Set(['future', 'in-progress', 'after-import-cutoff']);

/** Default end date: the latest past day with intake whose import has been confirmed (never today or later). */
export function anchorDate(report: EligibilityReport): string | null {
  const candidates = report.days.filter((day) => day.date < report.today && day.intakeSource
    && (day.intake.eligible || !timingReasons.has(day.intake.reason)));
  return candidates.at(-1)?.date ?? null;
}

/** Fallback when no intake has been imported: the latest confirmed past day with weight, trend weight, or steps. */
export function measurementAnchor(report: EligibilityReport): string | null {
  const confirmed = (status: { eligible: boolean; reason?: string }) => status.eligible || (status.reason !== undefined && !timingReasons.has(status.reason) && status.reason !== 'not-recorded');
  return report.days.filter((day) => day.date < report.today && [day.weight, day.trendWeight, day.steps].some(confirmed)).at(-1)?.date ?? null;
}

/** The selected period and the equally long period immediately before it, or null when none applies. */
export function resolvePeriod(choice: WindowChoice, anchor: string | null, today: string): PeriodBounds | null {
  let start: string;
  let end: string;
  if (choice.kind === 'custom') {
    if (customWindowProblem(choice.start, choice.end, today)) return null;
    ({ start, end } = choice);
  } else {
    if (!anchor) return null;
    end = anchor;
    start = addDays(anchor, -(choice.length - 1));
  }
  const length = daysBetween(start, end);
  const previousEnd = addDays(start, -1);
  return { start, end, length, previousEnd, previousStart: addDays(previousEnd, -(length - 1)) };
}

/** Each calendar date from start to end inclusive. */
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * Ordinary least-squares slope of value against elapsed calendar days, or null with fewer than two
 * points or no spread in dates. Missing dates are simply absent; nothing is interpolated.
 */
export function slopePerDay(points: Array<{ date: string; value: number }>): number | null {
  if (points.length < 2) return null;
  const xs = points.map((point) => daysBetween(points[0].date, point.date) - 1);
  const ys = points.map((point) => point.value);
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const denominator = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  if (denominator === 0) return null;
  return xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index] - yMean), 0) / denominator;
}
