/**
 * Ticket 19: which foods and times of day account for over-target days (food-patterns-v1).
 *
 * Days with food detail, eligible intake, and a calorie target are classed by intake − target: Over
 * above +band, Under below −band, otherwise Within (band = 100 kcal). Workbook-total days have no food
 * entries, so they are excluded and counted. Foods are grouped by their logged name exactly as
 * exported; repeated identical entries each count, as logged. Entries without a calorie value are
 * counted as missing, never as zero. Times come from the logged Time; entries without a readable time
 * are reported separately. Findings describe contributions only; no food is labeled good or bad.
 */
import type { SavedFoodDay } from '../gateway';
import type { DailyValues } from './daily';

export const foodPatternsMethodVersion = 'food-patterns-v1';
export const targetBand = 100;
export const eveningCutoffHour = 20;
export type DayClass = 'over' | 'within' | 'under';
export const dayClasses: DayClass[] = ['over', 'within', 'under'];
export const timeBuckets = [
  { key: 'morning', label: 'Before 11 AM', short: '<11 AM', from: 0, to: 10 },
  { key: 'midday', label: '11 AM – 3:59 PM', short: '11–4', from: 11, to: 15 },
  { key: 'evening', label: '4 – 7:59 PM', short: '4–8 PM', from: 16, to: 19 },
  { key: 'late', label: '8 PM or later', short: '8 PM+', from: 20, to: 23 },
] as const;

export interface FoodRow {
  name: string;
  totalKcal: number;
  entries: number;
  /** Per class: total kcal, entries, and kcal per classed day. */
  byClass: Record<DayClass, { kcal: number; entries: number; perDay: number | null }>;
  /** Over-target per-day kcal − within-target per-day kcal; null unless both classes have days. */
  difference: number | null;
}
export interface ClassTiming {
  days: number;
  kcal: number;
  buckets: Array<{ key: string; label: string; kcal: number; perDay: number | null; share: number | null }>;
  afterCutoffShare: number | null;
  untimed: { entries: number; kcal: number };
}
export interface FoodPatterns {
  method: typeof foodPatternsMethodVersion;
  counts: Record<DayClass, number>;
  excluded: { workbookOnly: number; noTarget: number; missingCalories: number };
  dates: Record<DayClass, string[]>;
  foods: FoodRow[];
  timing: Record<DayClass, ClassTiming>;
}

/** Hour (0-23) from a logged time such as "7:30 AM", "9:15 PM", or "21:05"; null when unreadable. */
export function hourOf(time: unknown): number | null {
  if (typeof time !== 'string') return null;
  const match = time.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  } else if (hour > 23) return null;
  return hour;
}

export function classify(difference: number, band = targetBand): DayClass {
  return difference > band ? 'over' : difference < -band ? 'under' : 'within';
}

export function analyzeFoods(days: DailyValues[], foodDays: SavedFoodDay[]): FoodPatterns {
  const entriesByDate = new Map(foodDays.map((day) => [day.date, day.entries]));
  const counts: Record<DayClass, number> = { over: 0, within: 0, under: 0 };
  const dates: Record<DayClass, string[]> = { over: [], within: [], under: [] };
  const excluded = { workbookOnly: 0, noTarget: 0, missingCalories: 0 };
  const foods = new Map<string, FoodRow>();
  const timing = Object.fromEntries(dayClasses.map((key) => [key, { days: 0, kcal: 0, bucketKcal: [0, 0, 0, 0], untimed: { entries: 0, kcal: 0 } }])) as Record<DayClass, { days: number; kcal: number; bucketKcal: number[]; untimed: { entries: number; kcal: number } }>;
  for (const day of days) {
    if (day.intake === null) continue;
    if (day.intakeSource === 'workbook') { excluded.workbookOnly += 1; continue; }
    if (day.targetDifference === null) { excluded.noTarget += 1; continue; }
    const entries = entriesByDate.get(day.date);
    if (!entries) continue;
    const kind = classify(day.targetDifference);
    counts[kind] += 1;
    dates[kind].push(day.date);
    timing[kind].days += 1;
    for (const entry of entries) {
      const kcal = typeof entry['Calories (kcal)'] === 'number' ? entry['Calories (kcal)'] : null;
      if (kcal === null) { excluded.missingCalories += 1; continue; }
      const name = typeof entry['Food Name'] === 'string' && entry['Food Name'].trim() ? entry['Food Name'] : '(unnamed food)';
      let row = foods.get(name);
      if (!row) {
        row = { name, totalKcal: 0, entries: 0, difference: null, byClass: { over: { kcal: 0, entries: 0, perDay: null }, within: { kcal: 0, entries: 0, perDay: null }, under: { kcal: 0, entries: 0, perDay: null } } };
        foods.set(name, row);
      }
      row.totalKcal += kcal;
      row.entries += 1;
      row.byClass[kind].kcal += kcal;
      row.byClass[kind].entries += 1;
      timing[kind].kcal += kcal;
      const hour = hourOf(entry.Time);
      if (hour === null) { timing[kind].untimed.entries += 1; timing[kind].untimed.kcal += kcal; continue; }
      timing[kind].bucketKcal[timeBuckets.findIndex((bucket) => hour >= bucket.from && hour <= bucket.to)] += kcal;
    }
  }
  const rows = [...foods.values()].map((row) => {
    for (const kind of dayClasses) row.byClass[kind].perDay = counts[kind] ? row.byClass[kind].kcal / counts[kind] : null;
    row.difference = row.byClass.over.perDay !== null && row.byClass.within.perDay !== null ? row.byClass.over.perDay - row.byClass.within.perDay : null;
    return row;
  }).sort((left, right) => right.totalKcal - left.totalKcal || left.name.localeCompare(right.name));
  const classTiming = (kind: DayClass): ClassTiming => {
    const item = timing[kind];
    const timed = item.kcal - item.untimed.kcal;
    return {
      days: item.days, kcal: item.kcal, untimed: item.untimed,
      buckets: timeBuckets.map((bucket, index) => ({ key: bucket.key, label: bucket.label, kcal: item.bucketKcal[index],
        perDay: item.days ? item.bucketKcal[index] / item.days : null, share: timed > 0 ? item.bucketKcal[index] / timed : null })),
      afterCutoffShare: timed > 0 ? item.bucketKcal[3] / timed : null,
    };
  };
  return { method: foodPatternsMethodVersion, counts, excluded, dates, foods: rows, timing: { over: classTiming('over'), within: classTiming('within'), under: classTiming('under') } };
}
