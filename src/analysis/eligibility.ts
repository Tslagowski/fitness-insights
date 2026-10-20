/**
 * Ticket 06: which saved values are eligible for completed-day analysis, and why not.
 *
 * Everything here is a pure, reproducible function of the saved history, the owner's review
 * decisions, the owner's completeness marks, and the reporting date (America/Denver). Nothing
 * edits raw records: a flagged or excluded value stays saved and is only omitted from dependent
 * calculations (tickets 07-10 consume this module).
 */
import type { ImportedHistory, ImportSummary } from '../gateway';
import type { DailyDomain } from '../import/workbook';

export const weightField = 'Weight (lb)';
/** A weigh-in is flagged when it differs from the baseline median by more than this fraction. */
export const weightFlagThreshold = 0.1;
/** Baseline: previously accepted weigh-ins within this many calendar days before the date. */
export const weightBaselineDays = 7;
export const weightBaselineMinimum = 3;

export type ReviewChoice = 'keep' | 'exclude' | 'pending';

/** One owner decision about one specific saved value. A later decision for the same value replaces it. */
export interface ReviewDecision {
  date: string;
  domain: 'scale_weight';
  field: string;
  value: number;
  decision: ReviewChoice;
  decidedAt: string;
}

export type CompletenessStatus = 'incomplete' | 'complete';

/** The owner's mark that a date's nutrition logging is incomplete (or complete again). Latest wins. */
export interface CompletenessMark {
  date: string;
  domain: 'nutrition';
  status: CompletenessStatus;
  decidedAt: string;
}

export interface ReviewState {
  decisions: ReviewDecision[];
  completeness: CompletenessMark[];
}

export const emptyReviewState: ReviewState = { decisions: [], completeness: [] };

export interface WeightFlag {
  date: string;
  value: number;
  baselineMedian: number;
  baselineDates: string[];
  /** Signed difference from the baseline median, as a fraction (0.5 = 50% higher). */
  difference: number;
  status: 'pending' | 'kept' | 'excluded';
}

export type IneligibleReason =
  | 'future' | 'in-progress' | 'after-import-cutoff' | 'not-recorded' | 'incomplete' | 'pending-review' | 'excluded';

export const reasonLabels: Record<IneligibleReason, string> = {
  future: 'Planned / future',
  'in-progress': 'Today (in progress)',
  'after-import-cutoff': 'Not yet confirmed by an import made after this day',
  'not-recorded': 'Not recorded',
  incomplete: 'Marked incomplete',
  'pending-review': 'Pending review',
  excluded: 'Excluded by you',
};

export type Eligibility = { eligible: true } | { eligible: false; reason: IneligibleReason };

export type ImportGroup = 'daily' | 'food' | 'workouts';

export interface DayStatus {
  date: string;
  intake: Eligibility;
  intakeSource: 'detail' | 'workbook' | null;
  weight: Eligibility;
  trendWeight: Eligibility;
  expenditure: Eligibility;
  steps: Eligibility;
  workouts: Eligibility;
  /** Set when MacroFactor's trend/expenditure for this date may reflect a questioned weigh-in. */
  estimateWarning: string | null;
}

export interface EligibilityReport {
  today: string;
  /** Last completed date confirmed by an import for each kind of data (never after yesterday), or null. */
  cutoffs: Record<ImportGroup, string | null>;
  /** When the import that set each cutoff was made. */
  lastImports: Record<ImportGroup, string | null>;
  flags: WeightFlag[];
  days: DayStatus[];
  incompleteDates: string[];
}

const eligible: Eligibility = { eligible: true };
const not = (reason: IneligibleReason): Eligibility => ({ eligible: false, reason });

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The calendar date (America/Denver) of an instant. */
export function denverDate(instant: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function decisionKey(date: string, domain: string, field: string, value: number): string {
  return `${date}|${domain}|${field}|${value}`;
}

/** Latest owner decision per specific value. A decision about a different value for the same date does not apply. */
export function latestDecisions(decisions: ReviewDecision[]): Map<string, ReviewChoice> {
  const latest = new Map<string, { choice: ReviewChoice; at: string }>();
  for (const decision of decisions) {
    const key = decisionKey(decision.date, decision.domain, decision.field, decision.value);
    const existing = latest.get(key);
    if (!existing || decision.decidedAt >= existing.at) latest.set(key, { choice: decision.decision, at: decision.decidedAt });
  }
  return new Map([...latest.entries()].map(([key, item]) => [key, item.choice]));
}

export function incompleteDates(marks: CompletenessMark[]): string[] {
  const latest = new Map<string, { status: CompletenessStatus; at: string }>();
  for (const mark of marks) {
    const existing = latest.get(mark.date);
    if (!existing || mark.decidedAt >= existing.at) latest.set(mark.date, { status: mark.status, at: mark.decidedAt });
  }
  return [...latest.entries()].filter(([, item]) => item.status === 'incomplete').map(([date]) => date).sort();
}

/**
 * Weigh-ins more than 10% from the median of at least three previously accepted weigh-ins within the
 * seven calendar days before. Pending and excluded values are not accepted, so they never form a baseline
 * for later dates; kept values are. Without a baseline, no relative flag is produced.
 */
export function weightFlags(history: ImportedHistory, decisions: ReviewDecision[]): WeightFlag[] {
  const choices = latestDecisions(decisions);
  const weighIns = history.records
    .filter((record) => record.domain === 'scale_weight' && typeof record.values[weightField] === 'number')
    .map((record) => ({ date: record.date, value: record.values[weightField] as number }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const accepted: Array<{ date: string; value: number }> = [];
  const flags: WeightFlag[] = [];
  for (const weighIn of weighIns) {
    const windowStart = addDays(weighIn.date, -weightBaselineDays);
    const baseline = accepted.filter((item) => item.date >= windowStart && item.date < weighIn.date);
    if (baseline.length >= weightBaselineMinimum) {
      const center = median(baseline.map((item) => item.value));
      const difference = (weighIn.value - center) / center;
      if (Math.abs(difference) > weightFlagThreshold) {
        const choice = choices.get(decisionKey(weighIn.date, 'scale_weight', weightField, weighIn.value)) ?? 'pending';
        const status = choice === 'keep' ? 'kept' : choice === 'exclude' ? 'excluded' : 'pending';
        flags.push({ date: weighIn.date, value: weighIn.value, baselineMedian: center, baselineDates: baseline.map((item) => item.date), difference, status });
        if (status === 'kept') accepted.push(weighIn);
        continue;
      }
    }
    accepted.push(weighIn);
  }
  return flags;
}

function groupTouched(item: ImportSummary, group: ImportGroup): boolean {
  if (item.kind !== 'import' && item.kind !== 'workbook') return false;
  if (group === 'daily') return item.added + item.changed + item.unchanged > 0;
  if (group === 'food') return item.foodAdded + item.foodChanged + item.foodUnchanged + item.foodKept > 0;
  return item.workoutAdded + item.workoutChanged + item.workoutUnchanged + item.workoutKept > 0;
}

/**
 * Completed-day cutoff per kind of data: the day before the latest (not undone) import that included
 * that kind of data, and never later than yesterday. A day pre-logged ahead of time is therefore not
 * treated as completed until an import made after that day confirms it; time passing alone is not enough.
 */
export function importCutoffs(history: ImportedHistory, today: string) {
  const yesterday = addDays(today, -1);
  const cutoffs: Record<ImportGroup, string | null> = { daily: null, food: null, workouts: null };
  const lastImports: Record<ImportGroup, string | null> = { daily: null, food: null, workouts: null };
  for (const group of ['daily', 'food', 'workouts'] as const) {
    const latest = history.imports.filter((item) => !item.undone && groupTouched(item, group))
      .sort((left, right) => right.committedAt.localeCompare(left.committedAt))[0];
    if (!latest) continue;
    const dayBefore = addDays(denverDate(latest.committedAt), -1);
    cutoffs[group] = dayBefore < yesterday ? dayBefore : yesterday;
    lastImports[group] = latest.committedAt;
  }
  return { cutoffs, lastImports };
}

export function evaluateEligibility(history: ImportedHistory, review: ReviewState, today: string): EligibilityReport {
  const { cutoffs, lastImports } = importCutoffs(history, today);
  const flags = weightFlags(history, review.decisions);
  const flagByDate = new Map(flags.map((flag) => [flag.date, flag]));
  const incomplete = new Set(incompleteDates(review.completeness));
  const questioned = flags.filter((flag) => flag.status !== 'kept').map((flag) => flag.date).sort();
  const records = new Map<string, Map<DailyDomain, Record<string, number | null>>>();
  for (const record of history.records) {
    if (!records.has(record.date)) records.set(record.date, new Map());
    records.get(record.date)!.set(record.domain, record.values);
  }
  const foodDates = new Set(history.foodDays.map((day) => day.date));
  const workoutDates = new Set(history.workoutDays.map((day) => day.date));
  const dates = [...new Set([...records.keys(), ...foodDates, ...workoutDates])].sort();

  const timing = (date: string, cutoff: string | null): Eligibility | null => {
    if (date > today) return not('future');
    if (date === today) return not('in-progress');
    if (!cutoff || date > cutoff) return not('after-import-cutoff');
    return null;
  };
  const hasValue = (values: Record<string, number | null> | undefined, field?: string) =>
    !!values && (field ? typeof values[field] === 'number' : Object.values(values).some((value) => typeof value === 'number'));

  const days = dates.map((date): DayStatus => {
    const domains = records.get(date);
    const workbookTotals = domains?.get('nutrition_totals');
    const intakeSource = foodDates.has(date) ? 'detail' : hasValue(workbookTotals, 'Calories (kcal)') ? 'workbook' : null;
    const intakeCutoff = intakeSource === 'detail' ? cutoffs.food : cutoffs.daily;
    const intake = timing(date, intakeCutoff) ?? (!intakeSource ? not('not-recorded') : incomplete.has(date) ? not('incomplete') : eligible);

    const flag = flagByDate.get(date);
    const weight = timing(date, cutoffs.daily) ?? (!hasValue(domains?.get('scale_weight'), weightField) ? not('not-recorded')
      : flag?.status === 'pending' ? not('pending-review') : flag?.status === 'excluded' ? not('excluded') : eligible);
    const simple = (domain: DailyDomain, cutoff: string | null) => timing(date, cutoff) ?? (hasValue(domains?.get(domain)) ? eligible : not('not-recorded'));
    const affectedBy = questioned.filter((flagDate) => flagDate <= date).at(-1);
    return {
      date,
      intake,
      intakeSource,
      weight,
      trendWeight: simple('trend_weight', cutoffs.daily),
      expenditure: simple('expenditure', cutoffs.daily),
      steps: simple('steps', cutoffs.daily),
      workouts: timing(date, cutoffs.workouts) ?? (workoutDates.has(date) ? eligible : not('not-recorded')),
      estimateWarning: affectedBy && (hasValue(domains?.get('trend_weight')) || hasValue(domains?.get('expenditure')))
        ? `MacroFactor's trend weight and expenditure from ${affectedBy} onward may reflect a questioned weigh-in; excluding it here does not change those estimates.`
        : null,
    };
  });
  return { today, cutoffs, lastImports, flags, days, incompleteDates: [...incomplete].sort() };
}
