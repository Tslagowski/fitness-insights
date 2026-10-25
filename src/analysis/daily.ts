/**
 * Shared daily series for the long-range analyses (tickets 16-25).
 *
 * One row per calendar date from the first saved date through the last completed day, holding only
 * eligible values (ticket 06): anything excluded, pending review, incomplete, unconfirmed, today, or
 * in the future is null here, and its reason stays on the ticket 06 report. Intake and protein come
 * from food detail when a day has it, otherwise from the workbook total; the two are never added.
 * Nothing is interpolated: a missing day is a row of nulls.
 */
import type { ImportedHistory, SavedWorkoutDay } from '../gateway';
import { addDays, weightField, type DayStatus, type EligibilityReport } from './eligibility';
import { expenditureField, targetField } from './intake';
import { stepsField, trendWeightField } from './trends';
import { datesBetween } from './periods';
import { warmUpSetType } from './exercise';

export const proteinField = 'Protein (g)';
export const carbsField = 'Carbs (g)';
export const targetProteinField = 'Target Protein (g)';

export interface DailyValues {
  date: string;
  /** 0 = Monday … 6 = Sunday (calendar arithmetic on the date itself; no device time zone). */
  weekday: number;
  intake: number | null;
  intakeSource: 'detail' | 'workbook' | null;
  protein: number | null;
  carbs: number | null;
  target: number | null;
  targetProtein: number | null;
  expenditure: number | null;
  /** intake − expenditure when both are eligible. */
  balance: number | null;
  /** intake − target when intake is eligible and a target exists. */
  targetDifference: number | null;
  scale: number | null;
  trend: number | null;
  steps: number | null;
  /** MacroFactor's trend/expenditure on this date may reflect a questioned weigh-in. */
  estimateWarning: boolean;
  /** The date is covered by a confirmed workout import (a day without sets then counts as 0 sets). */
  workoutsConfirmed: boolean;
  /** Non-warm-up sets logged on the date when workouts are confirmed and the sets were loaded; otherwise null. */
  workingSets: number | null;
}

export function weekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Every date from the first saved date through yesterday (or the last saved date, if earlier). */
export function buildDailySeries(history: ImportedHistory, report: EligibilityReport, workouts: SavedWorkoutDay[] | null = null): DailyValues[] {
  const dates = report.days.map((day) => day.date);
  if (!dates.length) return [];
  const last = [dates.at(-1)!, addDays(report.today, -1)].sort()[0];
  if (last < dates[0]) return [];
  const status = new Map<string, DayStatus>(report.days.map((day) => [day.date, day]));
  const values = new Map<string, Record<string, number | null>>();
  for (const record of history.records) values.set(`${record.date}|${record.domain}`, record.values);
  const food = new Map(history.foodDays.map((day) => [day.date, day]));
  const sets = new Map<string, number>();
  for (const day of workouts ?? []) sets.set(day.date, day.sets.filter((set) => set['Set Type'] !== warmUpSetType).length);
  const cutoff = report.cutoffs.workouts;

  return datesBetween(dates[0], last).map((date): DailyValues => {
    const day = status.get(date);
    const get = (domain: string, field: string) => number(values.get(`${date}|${domain}`)?.[field]);
    const intakeOk = !!day?.intake.eligible;
    const detail = day?.intakeSource === 'detail' ? food.get(date) : undefined;
    const intake = !intakeOk ? null : detail ? number(detail.calories) : get('nutrition_totals', 'Calories (kcal)');
    const protein = !intakeOk ? null : detail ? number(detail.protein) : get('nutrition_totals', proteinField);
    const carbs = !intakeOk ? null : detail ? number(detail.carbs) : get('nutrition_totals', carbsField);
    const expenditure = day?.expenditure.eligible ? get('expenditure', expenditureField) : null;
    const target = get('targets', targetField);
    const workoutsConfirmed = cutoff !== null && date <= cutoff && date < report.today;
    return {
      date, weekday: weekdayIndex(date),
      intake, intakeSource: intake === null ? null : day!.intakeSource, protein, carbs, target,
      targetProtein: get('targets', targetProteinField), expenditure,
      balance: intake !== null && expenditure !== null ? intake - expenditure : null,
      targetDifference: intake !== null && target !== null ? intake - target : null,
      scale: day?.weight.eligible ? get('scale_weight', weightField) : null,
      trend: day?.trendWeight.eligible ? get('trend_weight', trendWeightField) : null,
      steps: day?.steps.eligible ? get('steps', stepsField) : null,
      estimateWarning: !!day?.estimateWarning,
      workoutsConfirmed,
      workingSets: workoutsConfirmed && workouts ? sets.get(date) ?? 0 : null,
    };
  });
}

export const meanOf = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
export function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function present<T>(days: DailyValues[], pick: (day: DailyValues) => T | null): T[] {
  return days.flatMap((day) => { const value = pick(day); return value === null ? [] : [value]; });
}
/** Calendar month key (YYYY-MM). */
export const monthOf = (date: string) => date.slice(0, 7);
