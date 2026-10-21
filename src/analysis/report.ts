/**
 * Ticket 10: an evidence-backed written overview.
 *
 * Every sentence is a template filled from the ticket 07-09 calculation results (never independent
 * formulas, never an AI call). Each finding carries its window, counts, method version, settings, and
 * the values it states. Source estimates (MacroFactor expenditure and trend weight) are labeled as such,
 * unavailable results say so, and nothing prescribes changes or claims a cause. Import changes are
 * reported separately from period-over-period behavior.
 */
import type { ImportedHistory, ImportSummary, Preferences, SavedWorkoutDay } from '../gateway';
import type { EligibilityReport } from './eligibility';
import { analyzeExercises, exerciseMethodVersion } from './exercise';
import { analyzeIntake, intakeMethodVersion } from './intake';
import { analyzeTrends, trendsMethodVersion } from './trends';
import { describeChange, formatCalendarDate, plural } from '../import/preview';

export const overviewTemplateVersion = 'overview-v1';
export const reportPeriodDays = 28;

export type FindingKind = 'observation' | 'source-estimate' | 'unavailable';
export type SectionId = 'intake' | 'balance' | 'weight' | 'activity' | 'exercise' | 'data';

export interface Evidence {
  method: string;
  window?: { start: string; end: string; previousStart: string; previousEnd: string };
  counts?: Record<string, number>;
  values?: Record<string, number | string | null>;
  dates?: string[];
}
export interface Finding { id: string; kind: FindingKind; text: string; evidence: Evidence }
export interface ReportSection { id: SectionId; title: string; page: 'nutrition' | 'training' | 'settings'; findings: Finding[] }

export interface ReportInputs {
  templateVersion: typeof overviewTemplateVersion;
  methods: { intake: string; trends: string; exercise: string };
  revisionId: number | null;
  reportDate: string;
  periodDays: number;
  periodEnd: string | null;
  cutoffs: EligibilityReport['cutoffs'];
  settings: { durationUnit: Preferences['durationUnit']; strengthBandPercent: number };
  review: { excluded: string[]; kept: string[]; pending: string[]; incompleteDates: string[] };
  aliases: Record<string, string>;
}

export interface WrittenReport { inputs: ReportInputs; sections: ReportSection[] }

const kcal = (value: number) => `${Math.round(value).toLocaleString('en-US')} kcal`;
const signed = (value: number, digits = 0, unit = '') => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`;
const pct = (value: number) => `${Math.round(value * 100)}%`;
const range = (start: string, end: string) => `${formatCalendarDate(start)} – ${formatCalendarDate(end)}`;
const round = (value: number | null, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

export function reportInputs(history: ImportedHistory, report: EligibilityReport, preferences: Preferences, periodEnd: string | null): ReportInputs {
  return {
    templateVersion: overviewTemplateVersion,
    methods: { intake: intakeMethodVersion, trends: trendsMethodVersion, exercise: exerciseMethodVersion },
    revisionId: history.revisionId,
    reportDate: report.today,
    periodDays: reportPeriodDays,
    periodEnd,
    cutoffs: { ...report.cutoffs },
    settings: { durationUnit: preferences.durationUnit, strengthBandPercent: preferences.strengthBandPercent },
    review: {
      excluded: report.flags.filter((flag) => flag.status === 'excluded').map((flag) => `${flag.date}:${flag.value}`),
      kept: report.flags.filter((flag) => flag.status === 'kept').map((flag) => `${flag.date}:${flag.value}`),
      pending: report.flags.filter((flag) => flag.status === 'pending').map((flag) => `${flag.date}:${flag.value}`),
      incompleteDates: [...report.incompleteDates],
    },
    aliases: Object.fromEntries(Object.entries(history.aliases).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function intakeSections(history: ImportedHistory, report: EligibilityReport): { sections: ReportSection[]; periodEnd: string | null } {
  const analysis = analyzeIntake(history, report, { kind: 'days', length: reportPeriodDays });
  const intake: ReportSection = { id: 'intake', title: 'Intake', page: 'nutrition', findings: [] };
  const balance: ReportSection = { id: 'balance', title: 'Modeled energy balance (estimate)', page: 'nutrition', findings: [] };
  const method = intakeMethodVersion;
  const { current, previous } = analysis;
  if (!current || !previous) {
    intake.findings.push({ id: 'intake-unavailable', kind: 'unavailable', text: 'Intake: unavailable. No completed past day with imported intake yet.', evidence: { method } });
    balance.findings.push({ id: 'balance-unavailable', kind: 'unavailable', text: 'Modeled balance: unavailable. No completed past day with imported intake yet.', evidence: { method } });
    return { sections: [intake, balance], periodEnd: null };
  }
  const window = { start: current.start, end: current.end, previousStart: previous.start, previousEnd: previous.end };
  const counts = { counted: current.intake.count, required: current.required, previousCounted: previous.intake.count, detailDays: current.intake.sources.detail, workbookDays: current.intake.sources.workbook };
  if (!current.intakeCovered) {
    intake.findings.push({ id: 'intake-unavailable', kind: 'unavailable', evidence: { method, window, counts },
      text: `Intake: insufficient coverage for ${range(current.start, current.end)} (${current.intake.count} of ${current.required} required counted days). No headline is given.` });
  } else {
    const shift = analysis.intakeShift;
    let text = `Mean intake was ${kcal(current.intake.mean!)} and median ${kcal(current.intake.median!)} over ${plural(current.intake.count, 'counted day')} (${range(current.start, current.end)}).`;
    if (shift) text += ` Compared with ${range(previous.start, previous.end)}, the mean changed ${signed(shift.mean!, 0, ' kcal')} and the median ${signed(shift.median!, 0, ' kcal')}.`;
    else text += ` No comparison: the previous ${reportPeriodDays} days have insufficient coverage (${previous.intake.count} of ${previous.required}).`;
    intake.findings.push({ id: 'intake-center', kind: 'observation', text, evidence: { method, window, counts,
      values: { mean: round(current.intake.mean), median: round(current.intake.median), sd: round(current.intake.sd), meanShift: round(shift?.mean ?? null), medianShift: round(shift?.median ?? null) } } });
    if (shift && shift.mean !== null && shift.median !== null && Math.abs(shift.mean - shift.median) >= 50) {
      const top = [...current.days].filter((day) => day.intakeIncluded).sort((left, right) => right.intake! - left.intake!).slice(0, 3);
      intake.findings.push({ id: 'intake-tail', kind: 'observation', evidence: { method, window, dates: top.map((day) => day.date), values: Object.fromEntries(top.map((day) => [day.date, day.intake])) },
        text: `The mean moved ${shift.mean > shift.median ? 'more' : 'less'} than the median, which happens when the highest-intake days differ between periods. The highest counted days were ${top.map((day) => `${formatCalendarDate(day.date)} (${kcal(day.intake!)})`).join(', ')}; they remain included. This describes the data and does not establish a cause.` });
    }
    if (current.target.meanDifference !== null) {
      intake.findings.push({ id: 'intake-target', kind: 'observation', evidence: { method, window, counts: { daysWithTarget: current.target.count }, values: { meanDifference: round(current.target.meanDifference) } },
        text: `On ${plural(current.target.count, 'day')} with a target, intake averaged ${signed(current.target.meanDifference, 0, ' kcal')} relative to target.` });
    }
  }
  if (!current.balanceCovered) {
    balance.findings.push({ id: 'balance-unavailable', kind: 'unavailable', evidence: { method, window, counts: { matched: current.balance.count, required: current.required } },
      text: `Modeled balance: insufficient coverage (${current.balance.count} of ${current.required} required days with both counted intake and MacroFactor's expenditure estimate).` });
  } else {
    const stats = current.balance;
    let text = `Using MacroFactor's expenditure estimate, the modeled balance over ${plural(stats.count, 'matched day')} was ${signed(stats.net, 0, ' kcal')} net (gross surplus ${kcal(stats.grossSurplus)}, gross deficit ${kcal(stats.grossDeficit)}); ${stats.surplusDays} of ${stats.count} days (${pct(stats.surplusFrequency!)}) were modeled surpluses.`;
    if (analysis.balanceShift) text += ` The net was ${signed(analysis.balanceShift.net!, 0, ' kcal')} different from the previous ${reportPeriodDays} days.`;
    text += ' This is an estimate, not measured fat or weight change.';
    balance.findings.push({ id: 'balance-net', kind: 'source-estimate', text, evidence: { method, window, counts: { matched: stats.count, surplusDays: stats.surplusDays, deficitDays: stats.deficitDays },
      values: { net: round(stats.net), grossSurplus: round(stats.grossSurplus), grossDeficit: round(stats.grossDeficit), ratio: round(stats.ratio, 4), netShift: round(analysis.balanceShift?.net ?? null) } } });
  }
  return { sections: [intake, balance], periodEnd: current.end };
}

function trendSections(history: ImportedHistory, report: EligibilityReport): ReportSection[] {
  const analysis = analyzeTrends(history, report, { kind: 'days', length: reportPeriodDays });
  const weight: ReportSection = { id: 'weight', title: 'Weight', page: 'nutrition', findings: [] };
  const activity: ReportSection = { id: 'activity', title: 'Steps', page: 'nutrition', findings: [] };
  const method = trendsMethodVersion;
  const { current, previous } = analysis;
  if (!current || !previous) {
    weight.findings.push({ id: 'weight-unavailable', kind: 'unavailable', text: 'Weight: unavailable. No completed past day with imported weight yet.', evidence: { method } });
    activity.findings.push({ id: 'steps-unavailable', kind: 'unavailable', text: 'Steps: unavailable. No completed past day with imported steps yet.', evidence: { method } });
    return [weight, activity];
  }
  const window = { start: current.start, end: current.end, previousStart: previous.start, previousEnd: previous.end };
  if (current.trend.weeklyRate !== null) {
    let text = `MacroFactor's trend weight changed at ${signed(current.trend.weeklyRate, 2, ' lb/week')} (${current.trend.first!.value.toFixed(1)} lb on ${formatCalendarDate(current.trend.first!.date)} to ${current.trend.last!.value.toFixed(1)} lb on ${formatCalendarDate(current.trend.last!.date)}).`;
    if (analysis.shift.weeklyRate !== null) text += ` In the previous ${reportPeriodDays} days the rate was ${signed(previous.trend.weeklyRate!, 2, ' lb/week')}.`;
    if (current.warningDates.length) text += ` Trend values from ${formatCalendarDate(current.warningDates[0])} may reflect a questioned weigh-in.`;
    weight.findings.push({ id: 'weight-trend', kind: 'source-estimate', text, evidence: { method, window, counts: { trendValues: current.trend.count, required: current.required }, dates: current.warningDates,
      values: { weeklyRate: round(current.trend.weeklyRate, 3), previousWeeklyRate: round(previous.trend.weeklyRate, 3) } } });
  } else {
    weight.findings.push({ id: 'weight-trend-unavailable', kind: 'unavailable', evidence: { method, window, counts: { trendValues: current.trend.count, required: current.required } },
      text: `Trend weight rate: insufficient coverage (${current.trend.count} of ${current.required} required trend values).` });
  }
  if (current.scale.covered) {
    let text = `Counted scale weigh-ins averaged ${current.scale.mean!.toFixed(1)} lb (${plural(current.scale.count, 'weigh-in')}).`;
    if (analysis.shift.scaleMean !== null) text += ` That is ${signed(analysis.shift.scaleMean, 1, ' lb')} vs the previous ${reportPeriodDays} days.`;
    weight.findings.push({ id: 'weight-scale', kind: 'observation', text, evidence: { method, window, counts: { weighIns: current.scale.count }, values: { mean: round(current.scale.mean, 2), shift: round(analysis.shift.scaleMean, 2) } } });
  } else {
    weight.findings.push({ id: 'weight-scale-unavailable', kind: 'unavailable', evidence: { method, window, counts: { weighIns: current.scale.count, required: current.required } },
      text: `Scale weight average: insufficient coverage (${current.scale.count} of ${current.required} required weigh-ins).` });
  }
  if (current.steps.covered) {
    let text = `Steps averaged ${Math.round(current.steps.mean!).toLocaleString('en-US')} per day over ${plural(current.steps.count, 'day')} with steps.`;
    if (analysis.shift.stepsMean !== null) text += ` That is ${signed(Math.round(analysis.shift.stepsMean))} vs the previous ${reportPeriodDays} days.`;
    activity.findings.push({ id: 'steps-mean', kind: 'observation', text, evidence: { method, window, counts: { days: current.steps.count }, values: { mean: round(current.steps.mean, 0), shift: round(analysis.shift.stepsMean, 0) } } });
  } else {
    activity.findings.push({ id: 'steps-unavailable', kind: 'unavailable', evidence: { method, window, counts: { days: current.steps.count, required: current.required } },
      text: `Steps: insufficient coverage (${current.steps.count} of ${current.required} required days).` });
  }
  return [weight, activity];
}

function exerciseSection(workouts: SavedWorkoutDay[] | null, history: ImportedHistory, report: EligibilityReport, preferences: Preferences): ReportSection {
  const section: ReportSection = { id: 'exercise', title: 'Exercise progress', page: 'training', findings: [] };
  const method = exerciseMethodVersion;
  if (!workouts) {
    section.findings.push({ id: 'exercise-unavailable', kind: 'unavailable', text: 'Exercise progress: unavailable because workout sets could not be loaded.', evidence: { method } });
    return section;
  }
  const analysis = analyzeExercises(workouts, report, history.aliases, { bandPercent: preferences.strengthBandPercent, durationUnit: preferences.durationUnit });
  const labeled = analysis.exercises.filter((exercise) => ['Progressing', 'Stable', 'Declining'].includes(exercise.comparison.label));
  if (!labeled.length) {
    section.findings.push({ id: 'exercise-unavailable', kind: 'unavailable', evidence: { method, counts: { exercises: analysis.exercises.length } },
      text: `Exercise progress: no exercise has six completed sessions with a qualifying set yet${analysis.exercises.length ? ` (${plural(analysis.exercises.length, 'exercise')} logged)` : ''}.` });
  } else {
    const group = (label: string) => labeled.filter((exercise) => exercise.comparison.label === label);
    const describe = (label: string) => group(label).slice(0, 5).map((exercise) => `${exercise.name} (${signed(exercise.comparison.changePercent!, 1, '%')})`).join(', ');
    const parts = ['Progressing', 'Stable', 'Declining'].filter((label) => group(label).length).map((label) => `${label}: ${describe(label)}${group(label).length > 5 ? `, and ${group(label).length - 5} more` : ''}`);
    section.findings.push({ id: 'exercise-labels', kind: 'observation', evidence: { method, counts: { labeled: labeled.length, progressing: group('Progressing').length, stable: group('Stable').length, declining: group('Declining').length },
      values: Object.fromEntries(labeled.map((exercise) => [exercise.name, round(exercise.comparison.changePercent, 2)])) },
      text: `Of ${plural(labeled.length, 'exercise')} with six comparable sessions (median best score of the latest 3 vs the 3 before, band ±${preferences.strengthBandPercent}%): ${parts.join('. ')}.` });
  }
  const complete = analysis.weekly.filter((week) => !week.partial);
  if (complete.length >= 2) {
    const last = complete.at(-1)!;
    const before = complete.slice(-5, -1);
    const average = before.reduce((sum, week) => sum + week.workingSets, 0) / before.length;
    section.findings.push({ id: 'exercise-weekly-sets', kind: 'observation', evidence: { method, dates: [last.weekStart, ...before.map((week) => week.weekStart)], values: { lastWeek: last.workingSets, previousAverage: round(average, 1) } },
      text: `The latest completed week (from ${formatCalendarDate(last.weekStart)}) had ${plural(last.workingSets, 'working set')}; the ${plural(before.length, 'week')} before averaged ${average.toLocaleString('en-US', { maximumFractionDigits: 1 })}.` });
  }
  return section;
}

/** Import changes, kept apart from period comparisons: a correction to old dates is not a recent behavior change. */
function dataSection(history: ImportedHistory, periodStart: string | null): ReportSection {
  const section: ReportSection = { id: 'data', title: 'Data changes (not behavior)', page: 'settings', findings: [] };
  const changes = history.imports.filter((item: ImportSummary) => item.outcome === 'changed' && !item.undone).slice(0, 3);
  if (!changes.length) {
    section.findings.push({ id: 'data-none', kind: 'observation', text: 'No saved imports or corrections yet.', evidence: { method: overviewTemplateVersion } });
    return section;
  }
  for (const change of changes) {
    const older = periodStart && change.lastDate && change.lastDate < periodStart;
    section.findings.push({ id: `data-${change.id}`, kind: 'observation', evidence: { method: overviewTemplateVersion, dates: [change.firstDate, change.lastDate].filter((date): date is string => !!date), values: { revision: change.revisionId } },
      text: `${describeChange(change, history.imports)} (${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium' }).format(new Date(change.committedAt))})${change.firstDate && change.lastDate ? `, covering ${range(change.firstDate, change.lastDate)}` : ''}.${older ? ' These dates are before the current period, so this is a correction to older records, not a recent change.' : ''}` });
  }
  return section;
}

export function generateReport(history: ImportedHistory, report: EligibilityReport, workouts: SavedWorkoutDay[] | null, preferences: Preferences): WrittenReport {
  const { sections: nutrition, periodEnd } = intakeSections(history, report);
  const trends = trendSections(history, report);
  const periodStart = nutrition[0].findings[0]?.evidence.window?.start ?? trends[0].findings[0]?.evidence.window?.start ?? null;
  return {
    inputs: reportInputs(history, report, preferences, periodEnd ?? trends[0].findings[0]?.evidence.window?.end ?? null),
    sections: [...nutrition, ...trends, exerciseSection(workouts, history, report, preferences), dataSection(history, periodStart)],
  };
}

/** Canonical JSON (sorted keys) so equal inputs always produce the same fingerprint. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Fingerprint of a report: its content and inputs except the day it was viewed, so revisiting an
 * unchanged report never saves a duplicate, while any change in data, settings, review decisions,
 * cutoffs, or methods produces a distinct report.
 */
export async function reportFingerprint(report: WrittenReport): Promise<string> {
  const { reportDate: _viewed, ...inputs } = report.inputs;
  const bytes = new TextEncoder().encode(canonicalJson({ inputs, sections: report.sections }));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface ReportComparison {
  /** Differences in what the reports were computed from: imports, corrections, settings, review, methods. */
  inputChanges: string[];
  /** Statements whose wording or values differ, by section. */
  findingChanges: Array<{ section: string; before: string | null; after: string | null }>;
}

/** Compares a saved report with another (usually the current one), keeping input changes apart from findings. */
export function compareReports(before: WrittenReport, after: WrittenReport, history: ImportedHistory): ReportComparison {
  const changes: string[] = [];
  const a = before.inputs;
  const b = after.inputs;
  if (a.revisionId !== b.revisionId) {
    const between = history.imports.filter((item) => item.revisionId !== null && item.outcome === 'changed'
      && item.revisionId > (a.revisionId ?? 0) && item.revisionId <= (b.revisionId ?? 0)).reverse();
    changes.push(`Saved data changed from version ${a.revisionId ?? 'none'} to ${b.revisionId ?? 'none'}${between.length ? ':' : '.'}`);
    for (const item of between) changes.push(`• ${describeChange(item, history.imports)}${item.firstDate && item.lastDate ? ` (${range(item.firstDate, item.lastDate)})` : ''}`);
  }
  if (a.periodEnd !== b.periodEnd) changes.push(`The period end moved from ${a.periodEnd ? formatCalendarDate(a.periodEnd) : 'none'} to ${b.periodEnd ? formatCalendarDate(b.periodEnd) : 'none'}.`);
  if (a.settings.strengthBandPercent !== b.settings.strengthBandPercent) changes.push(`Exercise label band changed from ±${a.settings.strengthBandPercent}% to ±${b.settings.strengthBandPercent}%.`);
  if (a.settings.durationUnit !== b.settings.durationUnit) changes.push(`Workout durations are read as ${b.settings.durationUnit} instead of ${a.settings.durationUnit}.`);
  const methods = (inputs: ReportInputs) => `${inputs.templateVersion}, ${inputs.methods.intake}, ${inputs.methods.trends}, ${inputs.methods.exercise}`;
  if (methods(a) !== methods(b)) changes.push(`Calculation methods changed (${methods(a)} → ${methods(b)}).`);
  const listDiff = (label: string, left: string[], right: string[], format: (item: string) => string) => {
    const added = right.filter((item) => !left.includes(item));
    const removed = left.filter((item) => !right.includes(item));
    if (added.length) changes.push(`${label} added: ${added.map(format).join(', ')}.`);
    if (removed.length) changes.push(`${label} removed: ${removed.map(format).join(', ')}.`);
  };
  const weighIn = (item: string) => { const [date, value] = item.split(':'); return `${value} lb on ${formatCalendarDate(date)}`; };
  listDiff('Excluded weigh-ins', a.review.excluded, b.review.excluded, weighIn);
  listDiff('Kept weigh-ins', a.review.kept, b.review.kept, weighIn);
  listDiff('Weigh-ins pending review', a.review.pending, b.review.pending, weighIn);
  listDiff('Days marked incomplete', a.review.incompleteDates, b.review.incompleteDates, (date) => formatCalendarDate(date));
  if (canonicalJson(a.aliases) !== canonicalJson(b.aliases)) changes.push('Exercise display names (aliases) changed.');

  const findings = (report: WrittenReport) => new Map(report.sections.flatMap((section) => section.findings.map((finding) => [finding.id, { section: section.title, text: finding.text }] as const)));
  const left = findings(before);
  const right = findings(after);
  const findingChanges: ReportComparison['findingChanges'] = [];
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const old = left.get(id);
    const now = right.get(id);
    if (old?.text === now?.text) continue;
    findingChanges.push({ section: (now ?? old)!.section, before: old?.text ?? null, after: now?.text ?? null });
  }
  return { inputChanges: changes, findingChanges };
}
