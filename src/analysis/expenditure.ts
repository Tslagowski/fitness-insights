/**
 * Ticket 17: MacroFactor's expenditure estimate relative to its trend weight.
 *
 * For each calendar month (and each ticket 16 phase), over matched days where both expenditure and
 * trend weight are eligible: mean expenditure, mean trend weight, and kcal per lb (ratio of the two
 * means). Against a chosen reference group, the "implied" expenditure is the reference kcal-per-lb ratio
 * × the group's mean trend weight; the gap between actual and implied is how much more or less
 * expenditure changed than a constant ratio would give. These are calculations from MacroFactor's
 * estimates, not a measured metabolic rate or a diagnosis of adaptation.
 */
import { daysBetween, requiredDays, datesBetween } from './periods';
import { meanOf, monthOf, type DailyValues } from './daily';
import type { Phase } from './phases';

export const expenditureMethodVersion = 'expenditure-per-lb-v1';
/** Months needed before the expenditure-versus-steps association is shown. */
export const minimumAssociationMonths = 3;

export interface ExpenditureGroup {
  key: string;
  start: string;
  end: string;
  length: number;
  required: number;
  matched: number;
  covered: boolean;
  meanExpenditure: number | null;
  meanTrend: number | null;
  kcalPerLb: number | null;
  stepsCount: number;
  meanSteps: number | null;
  warning: boolean;
}
export interface ReferencedGroup extends ExpenditureGroup {
  /** Actual mean expenditure − the reference group's mean expenditure. */
  expenditureChange: number | null;
  /** Reference kcal/lb × this group's mean trend weight. */
  implied: number | null;
  impliedChange: number | null;
  /** Actual − implied: positive means expenditure is higher than a constant ratio gives. */
  difference: number | null;
}
export interface StepsAssociation { months: number; kcalPer1000Steps: number | null }

export function summarizeGroup(days: DailyValues[], key: string, start: string, end: string): ExpenditureGroup {
  const inside = days.filter((day) => day.date >= start && day.date <= end);
  const matched = inside.filter((day) => day.expenditure !== null && day.trend !== null);
  const length = daysBetween(start, end);
  const required = requiredDays(length);
  const meanExpenditure = meanOf(matched.map((day) => day.expenditure!));
  const meanTrend = meanOf(matched.map((day) => day.trend!));
  const steps = matched.flatMap((day) => (day.steps === null ? [] : [day.steps]));
  const covered = matched.length >= required;
  return {
    key, start, end, length, required, matched: matched.length, covered,
    meanExpenditure, meanTrend, kcalPerLb: meanExpenditure !== null && meanTrend ? meanExpenditure / meanTrend : null,
    stepsCount: steps.length, meanSteps: meanOf(steps), warning: matched.some((day) => day.estimateWarning),
  };
}

export function monthlyGroups(days: DailyValues[]): ExpenditureGroup[] {
  if (!days.length) return [];
  const months = [...new Set(datesBetween(days[0].date, days.at(-1)!.date).map(monthOf))];
  return months.map((month) => {
    const inMonth = days.filter((day) => monthOf(day.date) === month);
    return summarizeGroup(days, month, inMonth[0].date, inMonth.at(-1)!.date);
  });
}

export function phaseGroups(days: DailyValues[], phases: Phase[]): ExpenditureGroup[] {
  return phases.map((phase) => summarizeGroup(days, phase.start, phase.start, phase.end));
}

export function withReference(groups: ExpenditureGroup[], referenceKey: string | null): { reference: ExpenditureGroup | null; groups: ReferencedGroup[] } {
  const reference = groups.find((group) => group.key === referenceKey && group.covered) ?? groups.find((group) => group.covered) ?? null;
  return {
    reference,
    groups: groups.map((group) => {
      if (!reference || !group.covered || reference.kcalPerLb === null) return { ...group, expenditureChange: null, implied: null, impliedChange: null, difference: null };
      const implied = reference.kcalPerLb * group.meanTrend!;
      return { ...group, expenditureChange: group.meanExpenditure! - reference.meanExpenditure!, implied, impliedChange: implied - reference.meanExpenditure!, difference: group.meanExpenditure! - implied };
    }),
  };
}

/** Least-squares slope of monthly mean expenditure on monthly mean steps over covered months with steps for most matched days. */
export function stepsAssociation(groups: ExpenditureGroup[]): StepsAssociation {
  const points = groups.filter((group) => group.covered && group.meanSteps !== null && group.stepsCount >= group.required).map((group) => ({ x: group.meanSteps!, y: group.meanExpenditure! }));
  if (points.length < minimumAssociationMonths) return { months: points.length, kcalPer1000Steps: null };
  const xMean = meanOf(points.map((point) => point.x))!;
  const yMean = meanOf(points.map((point) => point.y))!;
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  if (denominator === 0) return { months: points.length, kcalPer1000Steps: null };
  return { months: points.length, kcalPer1000Steps: (points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator) * 1000 };
}
