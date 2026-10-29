/**
 * Ticket 32: one headline per Insights topic for the card grid. Presentation only: each headline is read
 * from the same versioned calculation the topic view shows, with that view's default scope.
 */
import type { DailyValues } from './daily';
import type { ExerciseAnalysis } from './exercise';
import { addDays } from './eligibility';
import { analyzePhases } from './phases';
import { monthlyGroups } from './expenditure';
import { analyzeWeekdays } from './weekdays';
import { analyzeProtein } from './protein';
import { analyzeStrength } from './strength';
import { analyzeMuscles } from './muscles';
import { analyzeEffort, combine } from './effort';
import { analyzePrecursors } from './precursors';
import type { OwnerNote } from './notes';
import { reviewPeriods } from './review';
import { monthDay } from '../import/preview';

export type InsightTopic = 'phases' | 'expenditure' | 'weekdays' | 'foods' | 'protein' | 'strength' | 'muscles' | 'effort' | 'precursors' | 'notes' | 'reviews';
export interface Headline { text: string; ready: boolean }

const signed = (value: number, digits = 0, unit = '') => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`;
const monthName = (key: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }).format(new Date(`${key}-01T00:00:00Z`));
const wait = (text: string): Headline => ({ text, ready: false });

export function insightHeadlines(days: DailyValues[], exercises: ExerciseAnalysis | null, notes: OwnerNote[], foodDays: number, stallComparisons: number): Record<InsightTopic, Headline> {
  const phases = analyzePhases(days).phases;
  const latestPhase = phases.at(-1);
  const months = monthlyGroups(days).filter((group) => group.covered && group.kcalPerLb !== null);
  const latestMonth = months.at(-1);
  const weekdays = analyzeWeekdays(days.filter((day) => days.length && day.date >= addDays(days.at(-1)!.date, -83)));
  const highest = weekdays.rows.filter((row) => row.targetDifference.sufficient).sort((left, right) => right.targetDifference.mean! - left.targetDifference.mean!)[0];
  const protein = analyzeProtein(days.filter((day) => days.length && day.date >= addDays(days.at(-1)!.date, -83)));
  const last = days.at(-1)?.date;
  const result: Record<InsightTopic, Headline> = {
    phases: latestPhase ? { text: `${latestPhase.plateau ? 'Plateau' : latestPhase.label} ${signed(latestPhase.rate ?? 0, 2, ' lb/wk')}`, ready: true } : wait('Not enough trend data'),
    expenditure: latestMonth ? { text: `${latestMonth.kcalPerLb!.toFixed(1)} kcal/lb in ${monthName(latestMonth.key)}`, ready: true } : wait('No month with enough data'),
    weekdays: highest ? { text: `${highest.name}s ${signed(highest.targetDifference.mean!, 0, ' kcal')} vs target`, ready: true } : wait('Not enough days yet'),
    foods: foodDays ? { text: `Food detail on ${foodDays} days`, ready: true } : wait('Import the food CSV'),
    protein: protein.meanRatio !== null ? { text: `${protein.meanRatio.toFixed(2)} g/lb, last 12 weeks`, ready: true } : wait('Not enough protein data'),
    strength: wait('Workout sets not loaded'),
    muscles: wait('Workout sets not loaded'),
    effort: wait('Workout sets not loaded'),
    precursors: wait('Workout sets not loaded'),
    notes: notes.length ? { text: `${notes.length} note${notes.length === 1 ? '' : 's'}, latest ${monthDay(notes.at(-1)!.startDate)}`, ready: true } : { text: 'Add your first dated note', ready: true },
    reviews: wait('No completed month yet'),
  };
  if (last) {
    const month = reviewPeriods('month', days[0].date, last).find((period) => !period.partial);
    if (month) result.reviews = { text: `${month.label} ready`, ready: true };
  }
  if (exercises) {
    const strength = analyzeStrength(exercises, days);
    const labels = strength.lifts.filter((lift) => lift.change.label !== 'Insufficient data');
    const count = (label: string) => labels.filter((lift) => lift.change.label === label).length;
    result.strength = labels.length ? { text: [['Gained', 'gained'], ['Kept', 'kept'], ['Lost', 'lost']].filter(([label]) => count(label)).map(([label, word]) => `${count(label)} ${word}`).join(' · '), ready: true } : wait('Needs 6 sessions per lift');
    const stalled = analyzeMuscles(exercises, {}, { secondaryCredit: 0, stallComparisons }).stalled.length;
    result.muscles = { text: stalled ? `${stalled} stalled lift${stalled === 1 ? '' : 's'}` : 'No stalled lifts', ready: true };
    const effort = combine(analyzeEffort(exercises, last ? addDays(last, -83) : null).weeks.filter((week) => !week.partial));
    result.effort = effort.recorded ? { text: `${Math.round(effort.hardShare! * 100)}% of sets at RIR 0-2`, ready: true } : wait('No RIR recorded');
    const precursors = analyzePrecursors(exercises, days);
    result.precursors = precursors.sufficient ? { text: `${precursors.days.length} sessions compared`, ready: true } : wait('Needs 15 scored sessions');
  }
  return result;
}
