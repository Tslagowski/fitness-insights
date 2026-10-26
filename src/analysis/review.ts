/**
 * Ticket 25: monthly, quarterly, and yearly written reviews (review-v1).
 *
 * Every sentence is a template filled from the existing calculations (tickets 07-09 and 16-24) over the
 * calendar period: weight phases and trend change, nutrition and protein, activity and expenditure per lb,
 * training volume, strength, effort, and muscle balance, plus the owner's dated notes. A section whose data
 * does not meet its coverage gate says so instead of stating a number. Nothing predicts, prescribes, or
 * explains a cause. Reviews are saved as immutable reports (ticket 11) with the inputs they used.
 */
import type { ImportedHistory, MuscleMapping, Preferences } from '../gateway';
import type { EligibilityReport } from './eligibility';
import type { DailyValues } from './daily';
import { daysBetween } from './periods';
import { analyzePhases, phasesMethodVersion, summarizeRange } from './phases';
import { analyzeProtein, proteinMethodVersion } from './protein';
import { expenditureMethodVersion, summarizeGroup } from './expenditure';
import type { ExerciseAnalysis } from './exercise';
import { intakeMethodVersion } from './intake';
import { trendsMethodVersion } from './trends';
import { exerciseMethodVersion } from './exercise';
import { analyzeStrength, strengthMethodVersion } from './strength';
import { analyzeEffort, combine, effortMethodVersion } from './effort';
import { analyzeMuscles, muscleMethodVersion } from './muscles';
import { compareAroundNote, noteCompareMethodVersion, notesInRange, type OwnerNote } from './notes';
import { reportInputs, type Finding, type ReportSection, type WrittenReport } from './report';
import { formatCalendarDate, plural } from '../import/preview';

export const reviewTemplateVersion = 'review-v1';
export type ReviewKind = 'month' | 'quarter' | 'year';
export interface ReviewPeriod { kind: ReviewKind; start: string; end: string; label: string; partial: boolean }

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (value: number) => String(value).padStart(2, '0');
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Calendar periods of a kind overlapping first..last (newest first); the period containing `last` may be partial. */
export function reviewPeriods(kind: ReviewKind, first: string, last: string): ReviewPeriod[] {
  if (!first || !last || last < first) return [];
  const periods: ReviewPeriod[] = [];
  let [year, month] = first.split('-').map(Number);
  const step = kind === 'month' ? 1 : kind === 'quarter' ? 3 : 12;
  if (kind === 'quarter') month = Math.floor((month - 1) / 3) * 3 + 1;
  if (kind === 'year') month = 1;
  for (;;) {
    const start = `${year}-${pad(month)}-01`;
    if (start > last) break;
    const endMonth = month + step - 1;
    const end = `${year}-${pad(endMonth)}-${pad(lastDayOf(year, endMonth))}`;
    const label = kind === 'month' ? `${monthNames[month - 1]} ${year}` : kind === 'quarter' ? `Q${(month + 2) / 3} ${year}` : String(year);
    periods.push({ kind, start, end, label, partial: end > last });
    month += step;
    if (month > 12) { month -= 12; year += 1; }
  }
  return periods.reverse();
}

const kcal = (value: number) => `${Math.round(value).toLocaleString('en-US')} kcal`;
const signed = (value: number, digits = 0, unit = '') => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`;
const lb = (value: number) => `${value.toFixed(1)} lb`;
const range = (start: string, end: string) => `${formatCalendarDate(start)} – ${formatCalendarDate(end)}`;
const round = (value: number | null, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const unavailable = (id: string, text: string, method: string, start: string, end: string): Finding => ({ id, kind: 'unavailable', text, evidence: { method, window: { start, end } } });

export interface ReviewContext {
  history: ImportedHistory;
  report: EligibilityReport;
  preferences: Preferences;
  days: DailyValues[];
  exercises: ExerciseAnalysis | null;
  notes: OwnerNote[];
  muscles: Record<string, MuscleMapping> | null;
}

export function generateReview(context: ReviewContext, period: ReviewPeriod): WrittenReport {
  const { days, exercises, notes } = context;
  const lastDay = days.at(-1)?.date ?? period.start;
  const end = [period.end, lastDay].sort()[0];
  // A period that begins before the saved history starts is summarized from the first saved date.
  const firstDay = days[0]?.date ?? period.start;
  const start = [period.start, firstDay].sort()[1];
  const covered = end >= start;
  const window = { start, end: covered ? end : start };
  const stats = covered ? summarizeRange(days, start, end) : null;
  const length = covered ? daysBetween(start, end) : 0;
  const coverageNote = (count: number, required: number) => `${count} of ${required} days needed (${length}-day period)`;

  // Weight
  const weight: ReportSection = { id: 'weight', title: 'Weight', page: 'nutrition', findings: [] };
  if (stats && stats.trend.covered && stats.startTrend !== null && stats.endTrend !== null) {
    weight.findings.push({ id: 'review-trend', kind: 'source-estimate', text: `MacroFactor's trend weight moved from ${lb(stats.startTrend)} to ${lb(stats.endTrend)} (${signed(stats.endTrend - stats.startTrend, 1, ' lb')}), a rate of ${signed(stats.rate!, 2, ' lb/week')} over ${range(start, end)}.`,
      evidence: { method: phasesMethodVersion, window, counts: { trendDays: stats.trend.count, required: stats.required }, values: { startTrend: round(stats.startTrend), endTrend: round(stats.endTrend), ratePerWeek: round(stats.rate, 2) } } });
  } else {
    weight.findings.push(unavailable('review-trend', `Trend weight change is unavailable: ${stats ? coverageNote(stats.trend.count, stats.required) : 'no completed days in this period'}.`, phasesMethodVersion, window.start, window.end));
  }
  if (period.kind !== 'month' && covered) {
    const months = reviewPeriods('month', start, end).reverse().map((month) => {
      const monthEnd = [month.end, end].sort()[0];
      return { label: month.label, start: month.start, end: monthEnd, stats: summarizeRange(days, month.start, monthEnd) };
    }).filter((month) => month.stats.trend.covered && month.stats.rate !== null);
    if (months.length >= 2) {
      const fastestLoss = [...months].sort((left, right) => left.stats.rate! - right.stats.rate!)[0];
      const fastestGain = [...months].sort((left, right) => right.stats.rate! - left.stats.rate!)[0];
      weight.findings.push({ id: 'review-monthly-rates', kind: 'source-estimate',
        text: `Across ${plural(months.length, 'month')} with enough trend data, the lowest monthly rate was ${signed(fastestLoss.stats.rate!, 2, ' lb/week')} (${fastestLoss.label}) and the highest ${signed(fastestGain.stats.rate!, 2, ' lb/week')} (${fastestGain.label}).`,
        evidence: { method: phasesMethodVersion, window, values: Object.fromEntries(months.map((month) => [month.label, `${signed(month.stats.rate!, 2)} lb/week`])) } });
    }
  }
  const phases = analyzePhases(days).phases.filter((phase) => phase.start <= end && phase.end >= start);
  if (phases.length) {
    weight.findings.push({ id: 'review-phases', kind: 'source-estimate',
      text: `Weight phases in this period: ${phases.map((phase) => `${phase.plateau ? 'Maintaining (plateau)' : phase.label} ${range([phase.start, start].sort()[1], [phase.end, end].sort()[0])}`).join('; ')}.`,
      evidence: { method: phasesMethodVersion, window, values: Object.fromEntries(phases.map((phase) => [`${phase.label} from ${phase.start}`, `${phase.start} – ${phase.end}, ${signed(phase.rate ?? 0, 2)} lb/week`])) } });
  } else {
    weight.findings.push(unavailable('review-phases', 'No labeled weight phase overlaps this period.', phasesMethodVersion, window.start, window.end));
  }

  // Nutrition
  const nutrition: ReportSection = { id: 'nutrition', title: 'Nutrition', page: 'nutrition', findings: [] };
  if (stats && stats.intake.covered) {
    nutrition.findings.push({ id: 'review-intake', kind: 'observation', text: `Mean intake was ${kcal(stats.intake.mean!)} over ${plural(stats.intake.count, 'eligible day')}${stats.targetDifference.covered ? `, ${signed(stats.targetDifference.mean!, 0, ' kcal')} vs your MacroFactor target` : ''}.`,
      evidence: { method: intakeMethodVersion, window, counts: { intakeDays: stats.intake.count, required: stats.required }, values: { meanIntake: round(stats.intake.mean, 0), meanVsTarget: round(stats.targetDifference.mean, 0) } } });
    if (stats.balance.covered) {
      nutrition.findings.push({ id: 'review-balance', kind: 'source-estimate', text: `Modeled balance (intake − MacroFactor expenditure) averaged ${signed(stats.balance.mean!, 0, ' kcal')} per day.`,
        evidence: { method: intakeMethodVersion, window, counts: { days: stats.balance.count }, values: { meanBalance: round(stats.balance.mean, 0) } } });
    }
  } else {
    nutrition.findings.push(unavailable('review-intake', `Intake is unavailable: ${stats ? coverageNote(stats.intake.count, stats.required) : 'no completed days'}.`, intakeMethodVersion, window.start, window.end));
  }
  const protein = analyzeProtein(days.filter((day) => day.date >= start && day.date <= end));
  if (stats && protein.matched >= stats.required) {
    nutrition.findings.push({ id: 'review-protein', kind: 'observation',
      text: `Protein averaged ${protein.meanRatio!.toFixed(2)} g per lb of trend weight over ${plural(protein.matched, 'day')}${protein.target.share !== null ? `; your MacroFactor protein target was met on ${protein.target.met} of ${plural(protein.target.compared, 'day')}` : ''}.`,
      evidence: { method: proteinMethodVersion, window, counts: { matched: protein.matched, compared: protein.target.compared, met: protein.target.met }, values: { meanRatio: round(protein.meanRatio, 2) } } });
  } else {
    nutrition.findings.push(unavailable('review-protein', `Protein per lb is unavailable: ${protein.matched} of ${stats?.required ?? 0} matched days.`, proteinMethodVersion, window.start, window.end));
  }

  // Activity
  const activity: ReportSection = { id: 'activity', title: 'Activity and expenditure', page: 'insights', findings: [] };
  if (stats && stats.steps.covered) {
    activity.findings.push({ id: 'review-steps', kind: 'observation', text: `Steps averaged ${Math.round(stats.steps.mean!).toLocaleString('en-US')} per day over ${plural(stats.steps.count, 'day')}.`,
      evidence: { method: trendsMethodVersion, window, counts: { stepDays: stats.steps.count, required: stats.required }, values: { meanSteps: round(stats.steps.mean, 0) } } });
  } else {
    activity.findings.push(unavailable('review-steps', `Steps are unavailable: ${stats ? coverageNote(stats.steps.count, stats.required) : 'no completed days'}.`, trendsMethodVersion, window.start, window.end));
  }
  const expenditure = covered ? summarizeGroup(days, period.label, start, end) : null;
  if (expenditure?.covered && expenditure.kcalPerLb !== null) {
    activity.findings.push({ id: 'review-expenditure', kind: 'source-estimate', text: `MacroFactor's expenditure averaged ${kcal(expenditure.meanExpenditure!)}, ${expenditure.kcalPerLb.toFixed(2)} kcal per lb of trend weight.`,
      evidence: { method: expenditureMethodVersion, window, counts: { matched: expenditure.matched, required: expenditure.required }, values: { meanExpenditure: round(expenditure.meanExpenditure, 0), kcalPerLb: round(expenditure.kcalPerLb, 2) } } });
  } else {
    activity.findings.push(unavailable('review-expenditure', 'Expenditure per lb is unavailable for this period (too few days with both expenditure and trend weight).', expenditureMethodVersion, window.start, window.end));
  }

  // Training
  const training: ReportSection = { id: 'training', title: 'Training', page: 'training', findings: [] };
  if (!exercises) {
    training.findings.push(unavailable('review-training', 'Training results are unavailable because workout sets did not load.', exerciseMethodVersion, window.start, window.end));
  } else {
    if (stats && stats.weeklySets.covered) {
      training.findings.push({ id: 'review-sets', kind: 'observation', text: `Working sets averaged ${stats.weeklySets.mean!.toFixed(1)} per week over ${plural(stats.weeklySets.count, 'confirmed day')}.`,
        evidence: { method: exerciseMethodVersion, window, counts: { confirmedDays: stats.weeklySets.count }, values: { setsPerWeek: round(stats.weeklySets.mean) } } });
    } else {
      training.findings.push(unavailable('review-sets', `Weekly working sets are unavailable: ${stats?.weeklySets.count ?? 0} of ${stats?.required ?? 0} days confirmed by a workout import.`, exerciseMethodVersion, window.start, window.end));
    }
    const best: string[] = [];
    for (const exercise of exercises.exercises) {
      if (exercise.kind !== 'loaded') continue;
      let record = 0;
      let top: { date: string; score: number } | null = null;
      for (const session of exercise.sessions) {
        if (!session.best || session.date > end) continue;
        if (session.date >= start && session.date <= end && session.best.score > record && record > 0) top = { date: session.date, score: session.best.score };
        record = Math.max(record, session.best.score);
      }
      if (top && top.score === record) best.push(`${exercise.name} (${top.score.toFixed(1)} on ${formatCalendarDate(top.date)})`);
    }
    training.findings.push(best.length
      ? { id: 'review-bests', kind: 'observation', text: `Lifts that reached their highest estimated-strength score so far in this period: ${best.join('; ')}.`, evidence: { method: exerciseMethodVersion, window, counts: { lifts: best.length } } }
      : unavailable('review-bests', 'No lift reached a new highest estimated-strength score in this period.', exerciseMethodVersion, window.start, window.end));
    const strength = analyzeStrength(exercises, days, { start, end });
    const labeled = strength.lifts.filter((lift) => lift.change.label !== 'Insufficient data');
    training.findings.push(labeled.length
      ? { id: 'review-strength', kind: 'observation', text: `Strength vs body weight: ${labeled.slice(0, 6).map((lift) => `${lift.name} ${lift.change.label.toLowerCase()} (score ${signed(lift.change.scoreChangePercent!, 1, '%')}, per lb ${lift.change.relativeChangePercent === null ? 'n/a' : signed(lift.change.relativeChangePercent, 1, '%')})`).join('; ')}.`,
        evidence: { method: strengthMethodVersion, window, counts: { lifts: labeled.length, insufficient: strength.lifts.length - labeled.length } } }
      : unavailable('review-strength', 'Strength vs body weight is unavailable: no lift has six scored sessions in this period.', strengthMethodVersion, window.start, window.end));
    const effort = combine(analyzeEffort(exercises, start).weeks.filter((week) => week.weekStart <= end));
    training.findings.push(effort.covered && effort.hardShare !== null
      ? { id: 'review-effort', kind: 'observation', text: `${Math.round(effort.hardShare * 100)}% of working sets with a logged RIR were at RIR 0-2 (${effort.hard} of ${effort.recorded}); ${plural(effort.failureSets, 'failure set')} logged.`,
        evidence: { method: effortMethodVersion, window, counts: { sets: effort.sets, recorded: effort.recorded, hard: effort.hard, failureSets: effort.failureSets } } }
      : unavailable('review-effort', `Effort is unavailable: RIR was recorded on ${effort.recorded} of ${plural(effort.sets, 'working set')} (75% needed).`, effortMethodVersion, window.start, window.end));
    if (context.muscles && Object.keys(context.muscles).length) {
      const muscles = analyzeMuscles(exercises, context.muscles, { secondaryCredit: context.preferences.secondarySetCredit, stallComparisons: context.preferences.stallComparisons });
      const weeks = muscles.weeks.filter((week) => !week.partial && week.weekStart >= start && week.weekStart <= end);
      const push = weeks.reduce((sum, week) => sum + week.push, 0);
      const pull = weeks.reduce((sum, week) => sum + week.pull, 0);
      const upper = weeks.reduce((sum, week) => sum + week.upper, 0);
      const lower = weeks.reduce((sum, week) => sum + week.lower, 0);
      training.findings.push(push && pull && upper && lower
        ? { id: 'review-muscles', kind: 'observation', text: `Over ${plural(weeks.length, 'complete week')}, push : pull sets were ${(push / pull).toFixed(2)} : 1 and upper : lower ${(upper / lower).toFixed(2)} : 1, from your exercise mapping.`,
          evidence: { method: muscleMethodVersion, window, counts: { weeks: weeks.length }, values: { push, pull, upper, lower } } }
        : unavailable('review-muscles', 'Muscle balance is unavailable: no complete week in this period has mapped sets on both sides.', muscleMethodVersion, window.start, window.end));
    } else {
      training.findings.push(unavailable('review-muscles', 'Muscle balance is unavailable: no exercise is mapped to a muscle yet.', muscleMethodVersion, window.start, window.end));
    }
  }

  // Notes
  const notesSection: ReportSection = { id: 'notes', title: 'Your notes', page: 'insights', findings: [] };
  const inPeriod = notesInRange(notes, start, period.end);
  for (const note of inPeriod) {
    const comparison = compareAroundNote(days, note, period.kind === 'month' ? 14 : 28);
    const part = (label: string, before: { covered: boolean; mean: number | null }, after: { covered: boolean; mean: number | null }, format: (value: number) => string) =>
      before.covered && after.covered ? `${label} ${format(before.mean!)} → ${format(after.mean!)}` : null;
    const parts = [
      comparison.before.rate !== null && comparison.after.rate !== null && comparison.before.trend.covered && comparison.after.trend.covered
        ? `trend rate ${signed(comparison.before.rate, 2)} → ${signed(comparison.after.rate, 2)} lb/week` : null,
      part('intake', comparison.before.intake, comparison.after.intake, kcal),
      part('steps', comparison.before.steps, comparison.after.steps, (value) => Math.round(value).toLocaleString('en-US')),
      part('sets/week', comparison.before.weeklySets, comparison.after.weeklySets, (value) => value.toFixed(1)),
    ].filter(Boolean);
    const when = note.endDate === note.startDate ? formatCalendarDate(note.startDate) : range(note.startDate, note.endDate);
    notesSection.findings.push({ id: `review-note-${note.id}`, kind: parts.length ? 'observation' : 'unavailable',
      text: `${when}: “${note.text}”${note.category ? ` (${note.category})` : ''}. ${parts.length ? `${comparison.length} days before vs after: ${parts.join('; ')}.` : `No measure has enough eligible days in both ${comparison.length}-day windows.`}`,
      evidence: { method: noteCompareMethodVersion, window: { start: comparison.after.start, end: comparison.after.end, previousStart: comparison.before.start, previousEnd: comparison.before.end },
        counts: { length: comparison.length, required: comparison.before.required } } });
  }
  if (!inPeriod.length) notesSection.findings.push(unavailable('review-notes', 'You have no dated notes in this period.', noteCompareMethodVersion, window.start, window.end));

  // Data
  const data: ReportSection = { id: 'data', title: 'About this review', page: 'settings', findings: [] };
  data.findings.push({ id: 'review-scope', kind: period.partial ? 'unavailable' : 'observation',
    text: `${period.partial ? `${period.label} is still in progress: this review covers completed days through ${formatCalendarDate(end)}` : `This review covers ${period.label} (${range(start, end)}), using eligible days only`}${start > period.start ? `; your saved history starts ${formatCalendarDate(start)}, so earlier days are not part of it` : ''}.`,
    evidence: { method: reviewTemplateVersion, window, counts: { days: length } } });

  const inputs = {
    ...reportInputs(context.history, context.report, context.preferences, covered ? end : null),
    templateVersion: reviewTemplateVersion,
    period: { ...period },
    reviewMethods: { phases: phasesMethodVersion, protein: proteinMethodVersion, expenditure: expenditureMethodVersion, strength: strengthMethodVersion, effort: effortMethodVersion, muscles: muscleMethodVersion, notes: noteCompareMethodVersion },
    reviewSettings: { stallComparisons: context.preferences.stallComparisons, secondarySetCredit: context.preferences.secondarySetCredit },
    notes: notes.map((note) => ({ id: note.id, version: note.version, startDate: note.startDate, endDate: note.endDate, text: note.text, category: note.category })),
  };
  return { inputs, sections: [weight, nutrition, activity, training, notesSection, data] };
}

/** First date with saved data and the last completed day, for listing periods. */
export function reviewSpan(days: DailyValues[]): { first: string; last: string } | null {
  return days.length ? { first: days[0].date, last: days.at(-1)!.date } : null;
}
