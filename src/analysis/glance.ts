/**
 * Ticket 28: headline tiles for the Overview. Presentation only: every value comes from the existing
 * calculations over eligible days (ticket 06) — phases' range summaries (ticket 16), protein per lb
 * (ticket 20), and the daily series' confirmed working sets. Each tile compares the latest 28 completed
 * days with the 28 before (sets: the latest complete Monday week with the week before) and carries a
 * weekly sparkline of the last 12 weeks. A tile below the coverage gate shows no number.
 */
import { addDays } from './eligibility';
import { meanOf, present, type DailyValues } from './daily';
import { summarizeRange } from './phases';
import { analyzeProtein } from './protein';
import { weekStart } from './exercise';
import { requiredDays } from './periods';

export const glanceWindow = 28;
export const sparkWeeks = 12;

export type TileId = 'weight' | 'intake' | 'protein' | 'steps' | 'sets';
export interface Tile {
  id: TileId;
  label: string;
  /** Formatted headline, or null when the data does not meet the coverage gate. */
  value: string | null;
  /** Comparison with the previous window, or a reason the tile is empty. */
  detail: string;
  /** Direction of the change, for a neutral arrow (never a judgement). */
  trend: 'up' | 'down' | 'flat' | null;
  window: string;
  /** Weekly values for the sparkline, oldest first; null marks a week without enough data. */
  spark: Array<number | null>;
  href: string;
}

const signed = (value: number, digits = 0, unit = '') => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`;
const whole = (value: number) => Math.round(value).toLocaleString('en-US');
const direction = (delta: number | null, tolerance: number) => (delta === null ? null : Math.abs(delta) <= tolerance ? 'flat' : delta > 0 ? 'up' : 'down');

/** Weekly means of a daily value over the last `weeks` Monday weeks; a week needs 5 of 7 values. */
function weekly(days: DailyValues[], pick: (day: DailyValues) => number | null, weeks = sparkWeeks): Array<number | null> {
  if (!days.length) return [];
  const last = weekStart(days.at(-1)!.date);
  return Array.from({ length: weeks }, (_, index) => {
    const start = addDays(last, -7 * (weeks - 1 - index));
    const values = present(days.filter((day) => day.date >= start && day.date <= addDays(start, 6)), pick);
    return values.length >= requiredDays(7) ? meanOf(values) : null;
  });
}

export function glanceTiles(days: DailyValues[]): Tile[] {
  if (!days.length) return [];
  const end = days.at(-1)!.date;
  const start = addDays(end, -(glanceWindow - 1));
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(glanceWindow - 1));
  const now = summarizeRange(days, start, end);
  const before = summarizeRange(days, previousStart, previousEnd);
  const windowText = `Last ${glanceWindow} days`;
  const short = (count: number) => `Not enough data (${count} of ${now.required} days)`;

  const latestTrend = [...days].reverse().find((day) => day.trend !== null) ?? null;
  const rate = now.trend.covered ? now.rate : null;
  const previousRate = before.trend.covered ? before.rate : null;
  const weight: Tile = {
    id: 'weight', label: 'Trend weight', window: windowText, href: '#insights',
    value: latestTrend && rate !== null ? `${latestTrend.trend!.toFixed(1)} lb` : null,
    detail: rate === null ? short(now.trend.count) : `${signed(rate, 2, ' lb/wk')}${previousRate !== null ? ` (was ${signed(previousRate, 2)})` : ''}`,
    trend: rate === null ? null : direction(rate, 0.15),
    spark: weekly(days, (day) => day.trend),
  };

  const intakeNow = now.intake.covered ? now.intake.mean : null;
  const vsTarget = now.targetDifference.covered ? now.targetDifference.mean : null;
  const intake: Tile = {
    id: 'intake', label: 'Intake', window: windowText, href: '#nutrition',
    value: intakeNow === null ? null : `${whole(intakeNow)} kcal`,
    detail: intakeNow === null ? short(now.intake.count) : vsTarget !== null ? `${signed(vsTarget, 0, ' kcal')} vs target` : 'No target recorded',
    trend: intakeNow === null || !before.intake.covered ? null : direction(intakeNow - before.intake.mean!, 50),
    spark: weekly(days, (day) => day.intake),
  };

  const protein = analyzeProtein(days.filter((day) => day.date >= start));
  const proteinBefore = analyzeProtein(days.filter((day) => day.date >= previousStart && day.date <= previousEnd));
  const proteinOk = protein.matched >= now.required;
  const proteinTile: Tile = {
    id: 'protein', label: 'Protein per lb', window: windowText, href: '#insights',
    value: proteinOk ? `${protein.meanRatio!.toFixed(2)} g/lb` : null,
    detail: !proteinOk ? short(protein.matched) : protein.target.share !== null ? `Target met ${protein.target.met} of ${protein.target.compared} days` : `${protein.matched} days`,
    trend: !proteinOk || proteinBefore.matched < before.required ? null : direction(protein.meanRatio! - proteinBefore.meanRatio!, 0.02),
    spark: weekly(days, (day) => (day.protein !== null && day.trend ? day.protein / day.trend : null)),
  };

  const steps: Tile = {
    id: 'steps', label: 'Steps', window: windowText, href: '#nutrition',
    value: now.steps.covered ? whole(now.steps.mean!) : null,
    detail: !now.steps.covered ? short(now.steps.count) : before.steps.covered ? `${signed(now.steps.mean! - before.steps.mean!, 0)} vs previous 28 days` : 'Per day',
    trend: now.steps.covered && before.steps.covered ? direction(now.steps.mean! - before.steps.mean!, 250) : null,
    spark: weekly(days, (day) => day.steps),
  };

  // Sets: the latest complete Monday week whose every day is confirmed by a workout import.
  const confirmedWeek = (monday: string) => {
    const week = days.filter((day) => day.date >= monday && day.date <= addDays(monday, 6));
    return week.length === 7 && week.every((day) => day.workingSets !== null) ? week.reduce((sum, day) => sum + day.workingSets!, 0) : null;
  };
  let monday = weekStart(end);
  if (addDays(monday, 6) > end) monday = addDays(monday, -7);
  const lastWeek = confirmedWeek(monday);
  const weekBefore = confirmedWeek(addDays(monday, -7));
  const setSpark = Array.from({ length: sparkWeeks }, (_, index) => confirmedWeek(addDays(monday, -7 * (sparkWeeks - 1 - index))));
  const sets: Tile = {
    id: 'sets', label: 'Working sets', window: lastWeek === null ? 'Last complete week' : `Week of ${monday.slice(5).replace('-', '/')}`, href: '#training',
    value: lastWeek === null ? null : String(lastWeek),
    detail: lastWeek === null ? 'No complete week confirmed by a workout import' : weekBefore !== null ? `${signed(lastWeek - weekBefore)} vs the week before` : 'Sets that are not warm-ups',
    trend: lastWeek === null || weekBefore === null ? null : direction(lastWeek - weekBefore, 0),
    spark: setSpark,
  };
  return [weight, intake, proteinTile, steps, sets];
}
