import {
  defaultPreferences, NothingToChangeError, ReconciliationRequiredError, StaleRevisionError, type CalorieConflict, type ChangeKind,
  type ChangeResult, type ClearableDomain, type ClearDayRequest, type DisplayDensity, type FoodDaySummary, type Gateway, type Identity,
  type ImportedHistory, type ImportSummary, type PreferenceChanges, type SavedFoodDay, type SavedWorkoutDay, type SourcesCommitRequest,
  type SourcesPreview, type SourcesRequest, type SourcesResult, type UndoPreview, type WorkoutDaySummary,
} from '../../src/gateway';
import type { DurationUnit, WorkoutSet, WorkoutSource } from '../../src/import/workout';
import type { CompletenessStatus, ReviewChoice, ReviewState } from '../../src/analysis/eligibility';
import type { DailyDomain, DailyValues } from '../../src/import/workbook';
import { calorieTolerance, foodDayTotals, type FoodEntry, type FoodSource } from '../../src/import/food';
import { sameValues } from '../../src/import/preview';

interface Span { introduced: number; retired: number | null }
interface Row extends Span { date: string; domain: DailyDomain; values: DailyValues; sourceFileId: string }
interface FoodRow extends Span { date: string; source: FoodSource; entries: FoodEntry[]; sourceFileId: string }
interface WorkoutRow extends Span { date: string; source: WorkoutSource; sets: WorkoutSet[]; sourceFileId: string }
interface Event extends ImportSummary { requestId: string; baseRevisionId: number | null }

const sameEntries = (left: unknown[], right: unknown[]) => JSON.stringify(left) === JSON.stringify(right);

/**
 * In-memory stand-in for the Supabase gateway that follows the same rules as the SQL functions:
 * append-only rows with linear revisions, stale and replay checks, CSV-over-workbook food precedence,
 * reconciliation acceptance, and undo by snapshot. The SQL itself is tested against PostgreSQL.
 */
export class MemoryGateway implements Gateway {
  identity: Identity | null = { id: 'owner', name: 'Trevis' };
  owner = true;
  density: DisplayDensity = 'comfortable';
  durationUnit: DurationUnit = 'seconds';
  aliases: Record<string, string> = {};
  review: ReviewState = { decisions: [], completeness: [] };
  failSave = false;
  failWrites = false;
  listener = () => {};
  revisionId: number | null = null;
  rows: Row[] = [];
  food: FoodRow[] = [];
  workouts: WorkoutRow[] = [];
  events: Event[] = [];
  calls: Array<{ method: string; requestId?: string; expectedRevisionId: number | null }> = [];
  private nextRevision = 1;
  private clock = Date.UTC(2026, 9, 20, 15);

  async getIdentity() { return this.identity; }
  async isOwner() { return this.owner; }
  async loadPreferences() { return { ...defaultPreferences, displayDensity: this.density, durationUnit: this.durationUnit }; }
  async savePreferences(_userId: string, changes: PreferenceChanges) {
    if (this.failSave) throw new Error('Network unavailable');
    if (changes.displayDensity) this.density = changes.displayDensity;
    if (changes.durationUnit) this.durationUnit = changes.durationUnit;
    return this.loadPreferences();
  }
  async signIn() {}
  async signOut() { this.identity = null; this.listener(); }
  onIdentityChange(listener: () => void) { this.listener = listener; return () => { this.listener = () => {}; }; }

  get active() { return this.rows.filter((row) => row.retired === null); }
  get activeFood() { return this.food.filter((row) => row.retired === null); }
  get activeWorkouts() { return this.workouts.filter((row) => row.retired === null); }

  async loadHistory(): Promise<ImportedHistory> {
    return {
      revisionId: this.revisionId,
      records: this.active.map((row) => ({ date: row.date, domain: row.domain, values: { ...row.values }, sourceFileId: row.sourceFileId, revisionId: row.introduced })),
      foodDays: this.activeFood.sort((left, right) => left.date.localeCompare(right.date)).map((row): FoodDaySummary => {
        const totals = foodDayTotals(row.entries);
        return { date: row.date, source: row.source, entries: row.entries.length, calories: totals.calories, protein: totals.protein, fat: totals.fat, carbs: totals.carbs, missingCalories: totals.entriesMissingCalories, revisionId: row.introduced };
      }),
      workoutDays: this.activeWorkouts.sort((left, right) => left.date.localeCompare(right.date)).map((row): WorkoutDaySummary => ({
        date: row.date, source: row.source, sets: row.sets.length, exercises: new Set(row.sets.map((set) => set.Exercise)).size,
        workouts: [...new Set(row.sets.map((set) => set.Workout).filter((name): name is string => typeof name === 'string'))],
        durations: [...new Set(row.sets.map((set) => set['Workout Duration']).filter((value): value is number => typeof value === 'number'))],
        revisionId: row.introduced,
      })),
      exerciseNames: [...new Set(this.activeWorkouts.flatMap((row) => row.sets.map((set) => String(set.Exercise))))].sort().map((name) => ({
        name, sets: this.activeWorkouts.flatMap((row) => row.sets).filter((set) => set.Exercise === name).length,
        days: this.activeWorkouts.filter((row) => row.sets.some((set) => set.Exercise === name)).length,
      })),
      aliases: { ...this.aliases },
      imports: [...this.events].reverse().map(({ requestId: _requestId, baseRevisionId: _base, ...summary }) => ({ ...summary, undone: this.events.some((event) => event.undoesId === summary.id) })),
      undoTargetId: this.undoTarget()?.id ?? null,
      review: { decisions: [...this.review.decisions], completeness: [...this.review.completeness] },
    };
  }

  async loadFoodDay(date: string): Promise<SavedFoodDay | null> {
    const row = this.activeFood.find((item) => item.date === date);
    return row ? { date: row.date, source: row.source, entries: row.entries.map((entry) => ({ ...entry })), revisionId: row.introduced } : null;
  }

  async loadWorkoutDay(date: string): Promise<SavedWorkoutDay | null> {
    const row = this.activeWorkouts.find((item) => item.date === date);
    return row ? { date: row.date, source: row.source, sets: row.sets.map((set) => ({ ...set })), revisionId: row.introduced } : null;
  }

  async saveReviewDecision(decision: { date: string; domain: 'scale_weight'; field: string; value: number; decision: ReviewChoice }) {
    this.calls.push({ method: 'saveReviewDecision', expectedRevisionId: null });
    if (this.failWrites) throw new Error('Network unavailable');
    this.clock += 60_000;
    this.review.decisions.push({ ...decision, decidedAt: new Date(this.clock).toISOString() });
  }

  async saveCompleteness(mark: { date: string; domain: 'nutrition'; status: CompletenessStatus }) {
    this.calls.push({ method: 'saveCompleteness', expectedRevisionId: null });
    if (this.failWrites) throw new Error('Network unavailable');
    this.clock += 60_000;
    this.review.completeness.push({ ...mark, decidedAt: new Date(this.clock).toISOString() });
  }

  async saveExerciseAlias(sourceName: string, displayName: string | null) {
    this.calls.push({ method: 'saveExerciseAlias', expectedRevisionId: null });
    if (this.failWrites) throw new Error('Network unavailable');
    if (displayName) this.aliases[sourceName] = displayName;
    else delete this.aliases[sourceName];
  }

  async previewSources(request: SourcesRequest): Promise<SourcesPreview> {
    this.calls.push({ method: 'previewSources', expectedRevisionId: request.expectedRevisionId });
    if (request.expectedRevisionId !== this.revisionId) throw new StaleRevisionError('stale');
    const plan = this.planSources(request);
    return { revisionId: this.revisionId, ...plan.counts, keptDates: plan.food.filter((item) => item.status === 'kept').map((item) => item.day.date),
      changedFoodDates: plan.food.filter((item) => item.status === 'changed').map((item) => item.day.date),
      keptWorkoutDates: plan.workouts.filter((item) => item.status === 'kept').map((item) => item.day.date),
      changedWorkoutDates: plan.workouts.filter((item) => item.status === 'changed').map((item) => item.day.date), conflicts: plan.conflicts };
  }

  async commitSources(request: SourcesCommitRequest): Promise<SourcesResult> {
    const replay = this.begin('commitSources', request.requestId, request.expectedRevisionId);
    if (replay) return { ...replay, unchanged: 0, foodAdded: 0, foodChanged: 0, foodUnchanged: 0, foodKept: 0, workoutAdded: 0, workoutChanged: 0, workoutUnchanged: 0, workoutKept: 0, conflicts: [] };
    const plan = this.planSources(request);
    if (plan.conflicts.length && !request.acceptReconciliation) throw new ReconciliationRequiredError('Reconciliation required');
    const applied = [...plan.daily, ...plan.food, ...plan.workouts].filter((item) => item.status === 'added' || item.status === 'changed');
    const revision = applied.length ? this.newRevision() : null;
    const sourceId = (kind: string) => request.sources.find((source) => source.kind === kind)?.sha256 ?? kind;
    for (const item of plan.daily) {
      if (item.status !== 'added' && item.status !== 'changed') continue;
      if (item.existing) item.existing.retired = revision;
      this.rows.push({ date: item.record.date, domain: item.record.domain, values: { ...item.record.values }, sourceFileId: sourceId('workbook'), introduced: revision!, retired: null });
    }
    for (const item of plan.food) {
      if (item.status !== 'added' && item.status !== 'changed') continue;
      if (item.existing) item.existing.retired = revision;
      this.food.push({ date: item.day.date, source: item.day.source, entries: item.day.entries.map((entry) => ({ ...entry })), sourceFileId: sourceId(item.day.source === 'food_csv' ? 'food_csv' : 'workbook'), introduced: revision!, retired: null });
    }
    for (const item of plan.workouts) {
      if (item.status !== 'added' && item.status !== 'changed') continue;
      if (item.existing) item.existing.retired = revision;
      this.workouts.push({ date: item.day.date, source: item.day.source, sets: item.day.sets.map((set) => ({ ...set })), sourceFileId: sourceId(item.day.source === 'workout_csv' ? 'workout_csv' : 'workbook'), introduced: revision!, retired: null });
    }
    const dates = [...request.daily.map((record) => record.date), ...request.food.map((day) => day.date), ...request.workouts.map((day) => day.date)].sort();
    this.record(request.requestId, 'import', revision, { ...plan.counts, removed: 0,
      firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, fileNames: request.sources.map((source) => source.name), reconciliation: plan.conflicts });
    return { outcome: revision ? 'changed' : 'unchanged', replayed: false, revisionId: this.revisionId, ...plan.counts, conflicts: plan.conflicts };
  }

  async clearDay(request: ClearDayRequest): Promise<ChangeResult> {
    const replay = this.begin('clearDay', request.requestId, request.expectedRevisionId);
    if (replay) return replay;
    const existing: Span | undefined = request.domain === 'food_entries'
      ? this.activeFood.find((row) => row.date === request.date)
      : request.domain === 'workout_sets'
        ? this.activeWorkouts.find((row) => row.date === request.date)
        : this.active.find((row) => row.date === request.date && row.domain === request.domain);
    if (!existing) throw new NothingToChangeError('There is no saved record for that date and domain.');
    const revision = this.newRevision();
    existing.retired = revision;
    this.record(request.requestId, 'clear', revision, { added: 0, changed: 0, unchanged: 0, removed: 1, firstDate: request.date, lastDate: request.date, clearedDate: request.date, clearedDomain: request.domain as ClearableDomain });
    return { outcome: 'changed', replayed: false, revisionId: revision, added: 0, changed: 0, removed: 1 };
  }

  async previewUndo(expectedRevisionId: number | null): Promise<UndoPreview> {
    this.calls.push({ method: 'previewUndo', expectedRevisionId });
    if (expectedRevisionId !== this.revisionId) throw new StaleRevisionError('stale');
    const { target, plan } = this.undoPlan();
    const dates = plan.map((item) => item.date).sort();
    return { targetId: target.id, targetKind: target.kind, targetCommittedAt: target.committedAt, restoresRevisionId: target.baseRevisionId, ...this.count(plan), firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null };
  }

  async undoLastChange(request: { requestId: string; expectedRevisionId: number | null }): Promise<ChangeResult> {
    const replay = this.begin('undoLastChange', request.requestId, request.expectedRevisionId);
    if (replay) return replay;
    const { target, plan } = this.undoPlan();
    const revision = plan.length ? this.newRevision() : null;
    for (const item of plan) {
      if (item.current) item.current.retired = revision;
      if (item.restoreRow) this.rows.push({ ...item.restoreRow, values: { ...item.restoreRow.values }, introduced: revision!, retired: null });
      if (item.restoreWorkout) this.workouts.push({ ...item.restoreWorkout, sets: item.restoreWorkout.sets.map((set) => ({ ...set })), introduced: revision!, retired: null });
      if (item.restoreFood) this.food.push({ ...item.restoreFood, entries: item.restoreFood.entries.map((entry) => ({ ...entry })), introduced: revision!, retired: null });
    }
    const counts = this.count(plan);
    const dates = plan.map((item) => item.date).sort();
    this.record(request.requestId, 'undo', revision, { ...counts, unchanged: 0, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, undoesId: target.id });
    return { outcome: revision ? 'changed' : 'unchanged', replayed: false, revisionId: this.revisionId, ...counts };
  }

  /** Simulates another device changing the shared history with a workbook-sourced daily import. */
  async otherDeviceImport(records: Array<{ date: string; domain: DailyDomain; values: DailyValues }>) {
    return this.commitSources({ requestId: `other-${this.clock}`, expectedRevisionId: this.revisionId, acceptReconciliation: true,
      sources: [{ name: 'other-device.xlsx', kind: 'workbook', sha256: 'f'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() }], daily: records, food: [], workouts: [] });
  }

  private planSources(request: SourcesRequest) {
    const daily = request.daily.map((record) => {
      const existing = this.active.find((row) => row.date === record.date && row.domain === record.domain);
      const status = !existing ? 'added' : sameValues(existing.values, record.values) ? 'unchanged' : 'changed';
      return { record, existing, status };
    });
    const food = request.food.map((day) => {
      const existing = this.activeFood.find((row) => row.date === day.date);
      const status = !existing ? 'added'
        : existing.source === 'food_csv' && day.source === 'workbook_food_log' ? 'kept'
          : existing.source === day.source && sameEntries(existing.entries, day.entries) ? 'unchanged' : 'changed';
      return { day, existing, status };
    });
    const workouts = request.workouts.map((day) => {
      const existing = this.activeWorkouts.find((row) => row.date === day.date);
      const status = !existing ? 'added'
        : existing.source === 'workout_csv' && day.source === 'workbook_workout_log' ? 'kept'
          : existing.source === day.source && sameEntries(existing.sets, day.sets) ? 'unchanged' : 'changed';
      return { day, existing, status };
    });
    const count = (items: Array<{ status: string }>, status: string) => items.filter((item) => item.status === status).length;
    const counts = { added: count(daily, 'added'), changed: count(daily, 'changed'), unchanged: count(daily, 'unchanged'),
      foodAdded: count(food, 'added'), foodChanged: count(food, 'changed'), foodUnchanged: count(food, 'unchanged'), foodKept: count(food, 'kept'),
      workoutAdded: count(workouts, 'added'), workoutChanged: count(workouts, 'changed'), workoutUnchanged: count(workouts, 'unchanged'), workoutKept: count(workouts, 'kept') };
    const touched = new Set([...food.filter((item) => item.status === 'added' || item.status === 'changed').map((item) => item.day.date),
      ...daily.filter((item) => item.record.domain === 'nutrition_totals' && (item.status === 'added' || item.status === 'changed')).map((item) => item.record.date)]);
    const conflicts: CalorieConflict[] = [];
    for (const date of [...touched].sort()) {
      const incomingFood = food.find((item) => item.day.date === date && (item.status === 'added' || item.status === 'changed'));
      const entries = incomingFood?.day.entries ?? this.activeFood.find((row) => row.date === date)?.entries;
      const totals = daily.find((item) => item.record.date === date && item.record.domain === 'nutrition_totals')?.record.values
        ?? this.active.find((row) => row.date === date && row.domain === 'nutrition_totals')?.values;
      const detail = entries ? foodDayTotals(entries).calories : null;
      const workbook = totals?.['Calories (kcal)'] ?? null;
      if (detail !== null && workbook !== null && Math.abs(detail - workbook) > calorieTolerance(workbook)) {
        conflicts.push({ date, detailCalories: detail, workbookCalories: workbook, difference: detail - workbook });
      }
    }
    return { daily, food, workouts, counts, conflicts };
  }

  private begin(method: string, requestId: string, expectedRevisionId: number | null): ChangeResult | null {
    this.calls.push({ method, requestId, expectedRevisionId });
    if (this.failWrites) throw new Error('Network unavailable');
    const existing = this.events.find((event) => event.requestId === requestId);
    if (existing) return { outcome: existing.outcome, replayed: true, revisionId: existing.revisionId ?? existing.baseRevisionId, added: existing.added, changed: existing.changed, removed: existing.removed };
    if (expectedRevisionId !== this.revisionId) throw new StaleRevisionError('stale');
    return null;
  }

  private undoTarget() {
    return [...this.events].reverse().find((event) => event.outcome === 'changed' && event.kind !== 'undo' && !this.events.some((undo) => undo.undoesId === event.id));
  }

  private undoPlan() {
    const target = this.undoTarget();
    if (!target) throw new NothingToChangeError('There is no import or correction to undo.');
    const base = target.baseRevisionId;
    const at = <T extends Span>(rows: T[]) => (base === null ? [] : rows.filter((row) => row.introduced <= base && (row.retired === null || row.retired > base)));
    const plan: Array<{ date: string; action: 'added' | 'changed' | 'removed'; current?: Span; restoreRow?: Row; restoreFood?: FoodRow; restoreWorkout?: WorkoutRow }> = [];
    const snapshot = at(this.rows);
    for (const key of new Set([...snapshot, ...this.active].map((row) => `${row.date}|${row.domain}`))) {
      const [date, domain] = key.split('|');
      const restoreRow = snapshot.find((row) => row.date === date && row.domain === domain);
      const current = this.active.find((row) => row.date === date && row.domain === domain);
      if (restoreRow && current && sameValues(restoreRow.values, current.values)) continue;
      plan.push({ date, action: !current ? 'added' : !restoreRow ? 'removed' : 'changed', current, restoreRow });
    }
    const foodSnapshot = at(this.food);
    for (const date of new Set([...foodSnapshot, ...this.activeFood].map((row) => row.date))) {
      const restoreFood = foodSnapshot.find((row) => row.date === date);
      const current = this.activeFood.find((row) => row.date === date);
      if (restoreFood && current && restoreFood.source === current.source && sameEntries(restoreFood.entries, current.entries)) continue;
      plan.push({ date, action: !current ? 'added' : !restoreFood ? 'removed' : 'changed', current, restoreFood });
    }
    const workoutSnapshot = at(this.workouts);
    for (const date of new Set([...workoutSnapshot, ...this.activeWorkouts].map((row) => row.date))) {
      const restoreWorkout = workoutSnapshot.find((row) => row.date === date);
      const current = this.activeWorkouts.find((row) => row.date === date);
      if (restoreWorkout && current && restoreWorkout.source === current.source && sameEntries(restoreWorkout.sets, current.sets)) continue;
      plan.push({ date, action: !current ? 'added' : !restoreWorkout ? 'removed' : 'changed', current, restoreWorkout });
    }
    return { target, plan };
  }

  private count(plan: Array<{ action: string }>) {
    return { added: plan.filter((item) => item.action === 'added').length, changed: plan.filter((item) => item.action === 'changed').length, removed: plan.filter((item) => item.action === 'removed').length };
  }

  private newRevision() { return this.nextRevision++; }

  private record(requestId: string, kind: ChangeKind, revision: number | null, details: Partial<ImportSummary> & { added: number; changed: number; unchanged: number; removed: number }) {
    this.clock += 60_000;
    this.events.push({
      id: `change-${this.events.length + 1}`, requestId, kind, baseRevisionId: this.revisionId, outcome: revision ? 'changed' : 'unchanged',
      revisionId: revision, committedAt: new Date(this.clock).toISOString(), clearedDate: null, clearedDomain: null, undoesId: null, undone: false,
      firstDate: null, lastDate: null, fileNames: [], reconciliation: [], foodAdded: 0, foodChanged: 0, foodUnchanged: 0, foodKept: 0,
      workoutAdded: 0, workoutChanged: 0, workoutUnchanged: 0, workoutKept: 0, ...details,
    });
    if (revision) this.revisionId = revision;
  }
}
