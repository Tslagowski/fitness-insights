import { addDays } from '../../src/analysis/eligibility';
import { weekdayIndex, type DailyValues } from '../../src/analysis/daily';

/** Synthetic eligible daily rows (as produced by buildDailySeries) starting on `start`. */
export function series(start: string, values: Array<Partial<DailyValues>>): DailyValues[] {
  return values.map((value, index) => {
    const date = addDays(start, index);
    const base: DailyValues = { date, weekday: weekdayIndex(date), intake: null, intakeSource: null, protein: null, carbs: null, target: null, targetProtein: null,
      expenditure: null, balance: null, targetDifference: null, scale: null, trend: null, steps: null, estimateWarning: false, workoutsConfirmed: false, workingSets: null };
    const row = { ...base, ...value, date, weekday: weekdayIndex(date) };
    if (row.intake !== null && row.intakeSource === null) row.intakeSource = 'workbook';
    if (value.balance === undefined && row.intake !== null && row.expenditure !== null) row.balance = row.intake - row.expenditure;
    if (value.targetDifference === undefined && row.intake !== null && row.target !== null) row.targetDifference = row.intake - row.target;
    return row;
  });
}

/** A trend line that changes by `perWeek` lb each week for `days` days from `from`. */
export function trendLine(from: number, perWeek: number, days: number): number[] {
  return Array.from({ length: days }, (_, index) => from + (perWeek / 7) * index);
}
