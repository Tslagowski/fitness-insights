/**
 * Ticket 20: protein relative to body weight (protein-per-lb-v1).
 *
 * Daily protein comes from food detail when the day has it, otherwise the workbook total (labeled by
 * source, never summed). Grams per lb uses MacroFactor's trend weight on the same date; both must be
 * eligible. "Met" compares protein with the owner's own MacroFactor protein target for that day; no other
 * amount is recommended. Weekly means use Monday-start weeks and need 5 of 7 matched days.
 */
import { addDays } from './eligibility';
import { weekStart } from './exercise';
import { requiredDays } from './periods';
import { meanOf, medianOf, type DailyValues } from './daily';

export const proteinMethodVersion = 'protein-per-lb-v1';
export const ratioBinWidth = 0.1;

export interface ProteinDay { date: string; protein: number; source: 'detail' | 'workbook'; trend: number | null; ratio: number | null; target: number | null; met: boolean | null }
export interface ProteinWeek { weekStart: string; matched: number; mean: number | null; covered: boolean; partial: boolean }
export interface ProteinAnalysis {
  method: typeof proteinMethodVersion;
  days: ProteinDay[];
  matched: number;
  sources: { detail: number; workbook: number };
  meanRatio: number | null;
  medianRatio: number | null;
  distribution: Array<{ from: number; to: number; count: number }>;
  target: { compared: number; met: number; share: number | null };
  missed: ProteinDay[];
  weeks: ProteinWeek[];
}

export function analyzeProtein(days: DailyValues[]): ProteinAnalysis {
  const rows: ProteinDay[] = days.flatMap((day) => {
    if (day.protein === null) return [];
    const ratio = day.trend ? day.protein / day.trend : null;
    return [{ date: day.date, protein: day.protein, source: day.intakeSource ?? 'workbook', trend: day.trend, ratio, target: day.targetProtein,
      met: day.targetProtein === null ? null : day.protein >= day.targetProtein }];
  });
  const ratios = rows.flatMap((row) => (row.ratio === null ? [] : [row.ratio]));
  const bins = new Map<number, number>();
  for (const ratio of ratios) {
    const bin = Math.floor(Math.round((ratio / ratioBinWidth) * 1e6) / 1e6);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const binKeys = [...bins.keys()].sort((left, right) => left - right);
  const distribution: ProteinAnalysis['distribution'] = [];
  if (binKeys.length) for (let bin = binKeys[0]; bin <= binKeys.at(-1)!; bin += 1) {
    distribution.push({ from: Number((bin * ratioBinWidth).toFixed(1)), to: Number(((bin + 1) * ratioBinWidth).toFixed(1)), count: bins.get(bin) ?? 0 });
  }
  const compared = rows.filter((row) => row.met !== null);
  const met = compared.filter((row) => row.met).length;
  const weekMap = new Map<string, number[]>();
  for (const row of rows) if (row.ratio !== null) {
    const week = weekStart(row.date);
    if (!weekMap.has(week)) weekMap.set(week, []);
    weekMap.get(week)!.push(row.ratio);
  }
  const weeks: ProteinWeek[] = [];
  if (days.length) {
    const first = weekStart(days[0].date);
    const last = days.at(-1)!.date;
    for (let week = first; week <= last; week = addDays(week, 7)) {
      const values = weekMap.get(week) ?? [];
      weeks.push({ weekStart: week, matched: values.length, mean: meanOf(values), covered: values.length >= requiredDays(7), partial: week < days[0].date || addDays(week, 6) > last });
    }
  }
  return {
    method: proteinMethodVersion, days: rows, matched: ratios.length,
    sources: { detail: rows.filter((row) => row.source === 'detail').length, workbook: rows.filter((row) => row.source === 'workbook').length },
    meanRatio: meanOf(ratios), medianRatio: medianOf(ratios), distribution,
    target: { compared: compared.length, met, share: compared.length ? met / compared.length : null },
    missed: compared.filter((row) => !row.met).reverse(), weeks,
  };
}
