/**
 * Ticket 18: day-of-week patterns (weekday-patterns-v1).
 *
 * Weekdays are calendar weekdays of the America/Denver reporting date itself (Monday-start weeks); no
 * device time zone is involved. Each measure uses eligible days only and needs `minimumCount` days of
 * that weekday before its mean is shown or ranked. Shares are each weekday's part of the scope's total
 * above-target calories (Σ max(0, intake − target)) and gross modeled surplus (Σ max(0, intake −
 * expenditure)). Findings describe patterns only, never causes or advice.
 */
import { meanOf, medianOf, present, type DailyValues } from './daily';

export const weekdayMethodVersion = 'weekday-patterns-v1';
export const minimumWeekdayCount = 3;
export const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface Stat { count: number; mean: number | null; sufficient: boolean }
export interface WeekdayRow {
  weekday: number;
  name: string;
  days: number;
  intake: Stat & { median: number | null };
  targetDifference: Stat;
  balance: Stat;
  steps: Stat;
  /** Scale weight − trend weight on days with both. */
  residual: Stat;
  aboveTarget: number;
  aboveTargetShare: number | null;
  grossSurplus: number;
  surplusShare: number | null;
}
export interface Split { intake: Stat; targetDifference: Stat; balance: Stat; steps: Stat; residual: Stat }
export interface WeekdayAnalysis {
  method: typeof weekdayMethodVersion;
  start: string | null;
  end: string | null;
  rows: WeekdayRow[];
  weekend: Split;
  weekdays: Split;
  totals: { aboveTarget: number; grossSurplus: number };
  findings: string[];
}

function stat(values: number[], minimum = minimumWeekdayCount): Stat {
  return { count: values.length, mean: meanOf(values), sufficient: values.length >= minimum };
}
function split(days: DailyValues[]): Split {
  return {
    intake: stat(present(days, (day) => day.intake)),
    targetDifference: stat(present(days, (day) => day.targetDifference)),
    balance: stat(present(days, (day) => day.balance)),
    steps: stat(present(days, (day) => day.steps)),
    residual: stat(present(days, (day) => (day.scale !== null && day.trend !== null ? day.scale - day.trend : null))),
  };
}
const signedKcal = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Math.round(value)).toLocaleString('en-US')} kcal`;

export function analyzeWeekdays(days: DailyValues[]): WeekdayAnalysis {
  const above = (day: DailyValues) => Math.max(day.targetDifference ?? 0, 0);
  const surplus = (day: DailyValues) => Math.max(day.balance ?? 0, 0);
  const totals = { aboveTarget: days.reduce((sum, day) => sum + above(day), 0), grossSurplus: days.reduce((sum, day) => sum + surplus(day), 0) };
  const rows = weekdayNames.map((name, weekday): WeekdayRow => {
    const group = days.filter((day) => day.weekday === weekday);
    const parts = split(group);
    const intakes = present(group, (day) => day.intake);
    const aboveTarget = group.reduce((sum, day) => sum + above(day), 0);
    const grossSurplus = group.reduce((sum, day) => sum + surplus(day), 0);
    return {
      weekday, name, days: group.length, ...parts, intake: { ...parts.intake, median: medianOf(intakes) },
      aboveTarget, aboveTargetShare: totals.aboveTarget > 0 ? aboveTarget / totals.aboveTarget : null,
      grossSurplus, surplusShare: totals.grossSurplus > 0 ? grossSurplus / totals.grossSurplus : null,
    };
  });
  const findings: string[] = [];
  const ranked = rows.filter((row) => row.targetDifference.sufficient).sort((left, right) => right.targetDifference.mean! - left.targetDifference.mean!);
  if (ranked.length >= 2) {
    const [top] = ranked;
    // Lowest mean; ties go to the earlier weekday.
    const low = ranked.reduce((lowest, row) => (row.targetDifference.mean! < lowest.targetDifference.mean! || (row.targetDifference.mean === lowest.targetDifference.mean && row.weekday < lowest.weekday) ? row : lowest));
    findings.push(`${top.name}s averaged ${signedKcal(top.targetDifference.mean!)} vs target over ${top.targetDifference.count} ${top.name}s; ${low.name}s averaged ${signedKcal(low.targetDifference.mean!)} over ${low.targetDifference.count}.`);
  }
  const share = rows.filter((row) => row.targetDifference.sufficient && row.aboveTargetShare !== null).sort((left, right) => right.aboveTargetShare! - left.aboveTargetShare!)[0];
  if (share) findings.push(`${share.name}s account for ${Math.round(share.aboveTargetShare! * 100)}% of the above-target calories in this scope (${Math.round(share.aboveTarget).toLocaleString('en-US')} of ${Math.round(totals.aboveTarget).toLocaleString('en-US')} kcal).`);
  const weekend = split(days.filter((day) => day.weekday >= 5));
  const weekdays = split(days.filter((day) => day.weekday < 5));
  if (weekend.intake.sufficient && weekdays.intake.sufficient) {
    findings.push(`Weekend days averaged ${Math.round(weekend.intake.mean!).toLocaleString('en-US')} kcal over ${weekend.intake.count} days; weekdays averaged ${Math.round(weekdays.intake.mean!).toLocaleString('en-US')} kcal over ${weekdays.intake.count} days.`);
  }
  return { method: weekdayMethodVersion, start: days[0]?.date ?? null, end: days.at(-1)?.date ?? null, rows, weekend, weekdays, totals, findings };
}
