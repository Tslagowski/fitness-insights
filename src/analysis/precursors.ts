/**
 * Ticket 24: what the day before your best and worst sessions looked like (session-precursors-v1).
 *
 * 1. Each exercise session with a qualifying set (ticket 09 rules) is compared with the median best score
 *    of that exercise's three preceding scored sessions: relative = best ÷ median. Earlier sessions of an
 *    exercise have no comparison.
 * 2. A training day's score is the mean relative value of its compared exercises, shown as a percentage
 *    change. Days with fewer than `minimumExercises` compared exercises are excluded and counted.
 * 3. Scored days are ranked (ties by date); the top and bottom thirds each hold floor(n ÷ 3) days and the
 *    middle is left out.
 * 4. For each group, the previous calendar day's eligible intake, carbohydrate, modeled balance, and
 *    steps are summarized (count, mean, median); the difference is top mean − bottom mean. A measure
 *    needs `minimumGroup` eligible prior days in both groups.
 * Results are associations in this history only: no significance test, no cause, no advice.
 */
import { addDays, median } from './eligibility';
import { meanOf, medianOf, type DailyValues } from './daily';
import { sessionsPerGroup, type ExerciseAnalysis } from './exercise';

export const precursorMethodVersion = 'session-precursors-v1';
export const minimumExercises = 2;
export const minimumGroup = 5;

export type PriorMeasure = 'intake' | 'carbs' | 'balance' | 'steps';
export const priorMeasures: PriorMeasure[] = ['intake', 'carbs', 'balance', 'steps'];

export interface ComparedExercise { name: string; best: number; baseline: number; relative: number }
export interface ScoredDay {
  date: string;
  /** Mean relative value − 1, as a percentage. */
  scorePercent: number;
  exercises: ComparedExercise[];
  group: 'top' | 'middle' | 'bottom';
  prior: Record<PriorMeasure, number | null>;
}
export interface GroupSummary { count: number; mean: number | null; median: number | null }
export interface MeasureComparison { measure: PriorMeasure; top: GroupSummary; bottom: GroupSummary; difference: number | null; sufficient: boolean }
export interface PrecursorAnalysis {
  method: typeof precursorMethodVersion;
  days: ScoredDay[];
  excluded: { tooFewExercises: number };
  groupSize: number;
  sufficient: boolean;
  measures: MeasureComparison[];
}

const summarize = (values: number[]): GroupSummary => ({ count: values.length, mean: meanOf(values), median: medianOf(values) });

export function analyzePrecursors(exercises: ExerciseAnalysis, days: DailyValues[]): PrecursorAnalysis {
  const byDate = new Map<string, ComparedExercise[]>();
  const trainedDates = new Set<string>();
  for (const exercise of exercises.exercises) {
    const scored = exercise.sessions.filter((session) => session.best);
    for (const session of exercise.sessions) trainedDates.add(session.date);
    scored.forEach((session, index) => {
      if (index < sessionsPerGroup) return;
      const baseline = median(scored.slice(index - sessionsPerGroup, index).map((item) => item.best!.score));
      if (!(baseline > 0)) return;
      if (!byDate.has(session.date)) byDate.set(session.date, []);
      byDate.get(session.date)!.push({ name: exercise.name, best: session.best!.score, baseline, relative: session.best!.score / baseline });
    });
  }
  const daily = new Map(days.map((day) => [day.date, day]));
  let tooFewExercises = 0;
  const scored: ScoredDay[] = [];
  for (const date of [...trainedDates].sort()) {
    const compared = byDate.get(date) ?? [];
    if (compared.length < minimumExercises) { tooFewExercises += 1; continue; }
    const previous = daily.get(addDays(date, -1));
    scored.push({
      date, exercises: compared.sort((left, right) => left.name.localeCompare(right.name)), group: 'middle',
      scorePercent: (compared.reduce((sum, item) => sum + item.relative, 0) / compared.length - 1) * 100,
      prior: { intake: previous?.intake ?? null, carbs: previous?.carbs ?? null, balance: previous?.balance ?? null, steps: previous?.steps ?? null },
    });
  }
  const ranked = [...scored].sort((left, right) => right.scorePercent - left.scorePercent || left.date.localeCompare(right.date));
  const groupSize = Math.floor(ranked.length / 3);
  ranked.slice(0, groupSize).forEach((day) => { day.group = 'top'; });
  ranked.slice(ranked.length - groupSize).forEach((day) => { if (groupSize) day.group = 'bottom'; });
  const top = scored.filter((day) => day.group === 'top');
  const bottom = scored.filter((day) => day.group === 'bottom');
  const sufficient = groupSize >= minimumGroup;
  const measures = priorMeasures.map((measure): MeasureComparison => {
    const values = (group: ScoredDay[]) => group.flatMap((day) => (day.prior[measure] === null ? [] : [day.prior[measure]!]));
    const topSummary = summarize(values(top));
    const bottomSummary = summarize(values(bottom));
    const ok = sufficient && topSummary.count >= minimumGroup && bottomSummary.count >= minimumGroup;
    return { measure, top: topSummary, bottom: bottomSummary, sufficient: ok, difference: ok ? topSummary.mean! - bottomSummary.mean! : null };
  });
  return { method: precursorMethodVersion, days: scored, excluded: { tooFewExercises }, groupSize, sufficient, measures };
}
