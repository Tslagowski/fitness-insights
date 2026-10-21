/**
 * Ticket 07: intake distributions, target differences, and modeled energy balance for a period.
 *
 * Pure and reproducible: a function of the saved history, the ticket 06 eligibility report, and the
 * chosen window. Charts and headline metrics both read the `days` rows produced here, so they can never
 * disagree. Modeled balance compares logged intake with MacroFactor's expenditure estimate; it is an
 * estimate, never measured fat or weight change.
 */
import type { ImportedHistory } from '../gateway';
import { addDays, median, type DayStatus, type Eligibility, type EligibilityReport } from './eligibility';
import { anchorDate, daysBetween, populationSd, requiredDays, resolvePeriod, type WindowChoice } from './periods';

export { anchorDate, customWindowProblem, daysBetween, maximumWindowDays, populationSd, requiredDays, type WindowChoice } from './periods';

export const intakeMethodVersion = 'intake-balance-v1';
export const expenditureField = 'Expenditure';
export const targetField = 'Target Calories (kcal)';
export interface IntakeDay {
  date: string;
  intake: number | null;
  intakeSource: 'detail' | 'workbook' | null;
  intakeStatus: Eligibility;
  expenditure: number | null;
  expenditureStatus: Eligibility;
  target: number | null;
  /** Intake counts toward intake distribution metrics. */
  intakeIncluded: boolean;
  /** Intake and expenditure are both eligible on this date. */
  matched: boolean;
  /** intake − expenditure on matched dates; null otherwise. */
  balance: number | null;
  /** intake − target on included dates that have a target; null otherwise. */
  targetDifference: number | null;
}

export interface IntakeStats { count: number; mean: number | null; median: number | null; sd: number | null; sources: { detail: number; workbook: number } }
export interface TargetStats { count: number; meanDifference: number | null }
export interface BalanceStats {
  count: number;
  grossSurplus: number;
  grossDeficit: number;
  net: number;
  surplusDays: number;
  deficitDays: number;
  /** surplus days / matched days, or null with no matched days. */
  surplusFrequency: number | null;
  /** gross surplus / gross deficit, only when gross deficit is above zero. May exceed 1. */
  ratio: number | null;
}

export interface Period {
  start: string;
  end: string;
  length: number;
  required: number;
  days: IntakeDay[];
  intake: IntakeStats;
  target: TargetStats;
  balance: BalanceStats;
  intakeCovered: boolean;
  balanceCovered: boolean;
}

export interface Shift { mean: number | null; median: number | null; sd: number | null; targetDifference: number | null }
export interface BalanceShift { net: number | null; surplusFrequency: number | null; grossSurplus: number | null; grossDeficit: number | null }

export interface IntakeAnalysis {
  method: typeof intakeMethodVersion;
  /** Latest past day with imported intake that an import has confirmed; null when there is none. */
  anchor: string | null;
  current: Period | null;
  previous: Period | null;
  /** Present only when both periods pass the intake coverage gate. */
  intakeShift: Shift | null;
  /** Present only when both periods pass the matched-day coverage gate. */
  balanceShift: BalanceShift | null;
}

function buildDays(history: ImportedHistory, report: EligibilityReport, start: string, end: string): IntakeDay[] {
  const statusByDate = new Map(report.days.map((day) => [day.date, day]));
  const foodByDate = new Map(history.foodDays.map((day) => [day.date, day]));
  const values = new Map<string, Record<string, number | null>>();
  for (const record of history.records) {
    if (record.domain === 'nutrition_totals' || record.domain === 'expenditure' || record.domain === 'targets') {
      values.set(`${record.date}|${record.domain}`, record.values);
    }
  }
  const number = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const missing = (date: string): DayStatus['intake'] => ({ eligible: false, reason: date > report.today ? 'future' : date === report.today ? 'in-progress' : 'not-recorded' });
  const days: IntakeDay[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const status = statusByDate.get(date);
    const intakeSource = status?.intakeSource ?? null;
    const intake = intakeSource === 'detail' ? number(foodByDate.get(date)?.calories)
      : intakeSource === 'workbook' ? number(values.get(`${date}|nutrition_totals`)?.['Calories (kcal)']) : null;
    const intakeStatus = status?.intake ?? missing(date);
    const expenditure = number(values.get(`${date}|expenditure`)?.[expenditureField]);
    const expenditureStatus = status?.expenditure ?? missing(date);
    const target = number(values.get(`${date}|targets`)?.[targetField]);
    const intakeIncluded = intakeStatus.eligible && intake !== null;
    const matched = intakeIncluded && expenditureStatus.eligible && expenditure !== null;
    days.push({
      date, intake, intakeSource, intakeStatus, expenditure, expenditureStatus, target, intakeIncluded, matched,
      balance: matched ? intake! - expenditure! : null,
      targetDifference: intakeIncluded && target !== null ? intake! - target : null,
    });
  }
  return days;
}

export function summarize(days: IntakeDay[], start: string, end: string): Period {
  const length = daysBetween(start, end);
  const required = requiredDays(length);
  const included = days.filter((day) => day.intakeIncluded);
  const intakes = included.map((day) => day.intake!);
  const differences = days.flatMap((day) => (day.targetDifference === null ? [] : [day.targetDifference]));
  const balances = days.flatMap((day) => (day.balance === null ? [] : [day.balance]));
  const grossSurplus = balances.reduce((sum, value) => sum + Math.max(value, 0), 0);
  const grossDeficit = balances.reduce((sum, value) => sum + Math.max(-value, 0), 0);
  const surplusDays = balances.filter((value) => value > 0).length;
  return {
    start, end, length, required, days,
    intake: {
      count: intakes.length,
      mean: intakes.length ? intakes.reduce((sum, value) => sum + value, 0) / intakes.length : null,
      median: intakes.length ? median(intakes) : null,
      sd: intakes.length ? populationSd(intakes) : null,
      sources: { detail: included.filter((day) => day.intakeSource === 'detail').length, workbook: included.filter((day) => day.intakeSource === 'workbook').length },
    },
    target: { count: differences.length, meanDifference: differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : null },
    balance: {
      count: balances.length, grossSurplus, grossDeficit, net: grossSurplus - grossDeficit, surplusDays,
      deficitDays: balances.filter((value) => value < 0).length,
      surplusFrequency: balances.length ? surplusDays / balances.length : null,
      ratio: grossDeficit > 0 ? grossSurplus / grossDeficit : null,
    },
    intakeCovered: intakes.length >= required,
    balanceCovered: balances.length >= required,
  };
}

const difference = (left: number | null, right: number | null) => (left === null || right === null ? null : left - right);

export function analyzeIntake(history: ImportedHistory, report: EligibilityReport, choice: WindowChoice): IntakeAnalysis {
  const anchor = anchorDate(report);
  const bounds = resolvePeriod(choice, anchor, report.today);
  if (!bounds) return { method: intakeMethodVersion, anchor, current: null, previous: null, intakeShift: null, balanceShift: null };
  const current = summarize(buildDays(history, report, bounds.start, bounds.end), bounds.start, bounds.end);
  const previous = summarize(buildDays(history, report, bounds.previousStart, bounds.previousEnd), bounds.previousStart, bounds.previousEnd);
  const intakeShift = current.intakeCovered && previous.intakeCovered ? {
    mean: difference(current.intake.mean, previous.intake.mean),
    median: difference(current.intake.median, previous.intake.median),
    sd: difference(current.intake.sd, previous.intake.sd),
    targetDifference: difference(current.target.meanDifference, previous.target.meanDifference),
  } : null;
  const balanceShift = current.balanceCovered && previous.balanceCovered ? {
    net: current.balance.net - previous.balance.net,
    surplusFrequency: difference(current.balance.surplusFrequency, previous.balance.surplusFrequency),
    grossSurplus: current.balance.grossSurplus - previous.balance.grossSurplus,
    grossDeficit: current.balance.grossDeficit - previous.balance.grossDeficit,
  } : null;
  return { method: intakeMethodVersion, anchor, current, previous, intakeShift, balanceShift };
}
