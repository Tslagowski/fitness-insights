import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  defaultPreferences, NothingToChangeError, ReconciliationRequiredError, StaleRevisionError, type CalorieConflict, type ChangeKind,
  type ChangeResult, type ClearableDomain, type DisplayDensity, type FoodCounts, type Gateway, type ImportedHistory, type Preferences,
  type SavedFoodDay, type SavedWorkoutDay, type SourceFile, type SourcesPreview, type SourcesRequest, type SourcesResult, type UndoPreview,
} from './gateway';
import type { DailyDomain, DailyValues } from './import/workbook';
import type { FoodEntry, FoodSource } from './import/food';
import type { WorkoutSet, WorkoutSource } from './import/workout';
import type { CompletenessStatus, ReviewChoice, ReviewState } from './analysis/eligibility';

const archiveBucket = 'source-archives';

function decodePreferences(value: unknown): Preferences {
  const record = value as Record<string, unknown> | null;
  if (!record || !['compact', 'comfortable'].includes(String(record.display_density)) ||
      record.timezone !== 'America/Denver' || record.week_starts_on !== 1 || !['seconds', 'minutes', undefined].includes(record.duration_unit as string | undefined)) {
    throw new Error('Unsupported saved preference values.');
  }
  return { displayDensity: record.display_density as DisplayDensity, timezone: 'America/Denver', weekStartsOn: 1, durationUnit: record.duration_unit === 'minutes' ? 'minutes' : 'seconds' };
}

export function createGateway(url: string, publishableKey: string, redirectUrl: string): Gateway {
  const client = createClient(url, publishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return supabaseGateway(client, redirectUrl);
}

export function supabaseGateway(client: SupabaseClient, redirectUrl: string): Gateway {
  return {
    async getIdentity() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) return null;
      const user = data.session.user;
      return { id: user.id, name: String(user.user_metadata.user_name || user.user_metadata.name || 'owner') };
    },
    async isOwner() {
      const { data, error } = await client.rpc('is_app_owner');
      if (error) throw error;
      return data === true;
    },
    async loadPreferences(userId) {
      const { data, error } = await client.from('preferences')
        .select('display_density,timezone,week_starts_on,duration_unit').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data ? decodePreferences(data) : { ...defaultPreferences };
    },
    async savePreferences(userId, changes) {
      const row: Record<string, string> = { user_id: userId };
      if (changes.displayDensity) row.display_density = changes.displayDensity;
      if (changes.durationUnit) row.duration_unit = changes.durationUnit;
      const { data, error } = await client.from('preferences')
        .upsert(row, { onConflict: 'user_id' })
        .select('display_density,timezone,week_starts_on,duration_unit').single();
      if (error) throw error;
      return decodePreferences(data);
    },
    async signIn() {
      const { error } = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: redirectUrl } });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
    async loadHistory(): Promise<ImportedHistory> {
      const [history, review] = await Promise.all([client.rpc('active_history'), client.rpc('review_state')]);
      if (history.error) throw history.error;
      if (review.error) throw review.error;
      if (!history.data || !review.data) throw new Error('Saved history is unavailable for this account.');
      return { ...decodeHistory(history.data), review: decodeReview(review.data) };
    },
    async saveReviewDecision(decision) {
      const { error } = await client.from('review_decisions').insert({ record_date: decision.date, domain: decision.domain, field: decision.field, value: decision.value, decision: decision.decision });
      if (error) throw translateError(error);
    },
    async saveCompleteness(mark) {
      const { error } = await client.from('completeness_marks').insert({ mark_date: mark.date, domain: mark.domain, status: mark.status });
      if (error) throw translateError(error);
    },
    async loadFoodDay(date): Promise<SavedFoodDay | null> {
      const { data, error } = await client.rpc('food_day_entries', { p_date: date });
      if (error) throw translateError(error);
      if (!data) return null;
      const day = data as Record<string, unknown>;
      return { date: String(day.date), source: day.source_kind as FoodSource, entries: day.entries as FoodEntry[], revisionId: Number(day.revision_id) };
    },
    async loadWorkoutDay(date): Promise<SavedWorkoutDay | null> {
      const { data, error } = await client.rpc('workout_day_sets', { p_date: date });
      if (error) throw translateError(error);
      if (!data) return null;
      const day = data as Record<string, unknown>;
      return { date: String(day.date), source: day.source_kind as WorkoutSource, sets: day.sets as WorkoutSet[], revisionId: Number(day.revision_id) };
    },
    async saveExerciseAlias(sourceName, displayName) {
      const { error } = displayName && displayName.trim()
        ? await client.from('exercise_aliases').upsert({ source_name: sourceName, display_name: displayName.trim(), updated_at: new Date().toISOString() }, { onConflict: 'source_name' })
        : await client.from('exercise_aliases').delete().eq('source_name', sourceName);
      if (error) throw translateError(error);
    },
    async previewSources(request): Promise<SourcesPreview> {
      const { data, error } = await client.rpc('commit_sources', { ...sourcesPayload(request), p_request_id: null, p_accept_reconciliation: false, p_dry_run: true });
      if (error) throw translateError(error);
      const preview = data as Record<string, unknown>;
      return {
        revisionId: typeof preview.revision_id === 'number' ? preview.revision_id : null,
        added: Number(preview.added), changed: Number(preview.changed), unchanged: Number(preview.unchanged),
        ...decodeFoodCounts(preview),
        keptDates: (preview.kept_dates as string[]) ?? [],
        changedFoodDates: (preview.changed_food_dates as string[]) ?? [],
        keptWorkoutDates: (preview.kept_workout_dates as string[]) ?? [],
        changedWorkoutDates: (preview.changed_workout_dates as string[]) ?? [],
        conflicts: decodeConflicts(preview.conflicts),
      };
    },
    async commitSources(request): Promise<SourcesResult> {
      // Content-addressed and immutable: re-uploading the same file is harmless.
      for (const source of request.sources) {
        const { error: uploadError } = await client.storage.from(archiveBucket).upload(
          archivePath(source),
          new Blob([source.bytes as BlobPart], { type: source.mediaType }),
          { contentType: source.mediaType, upsert: false },
        );
        if (uploadError && !isAlreadyStored(uploadError)) throw uploadError;
      }
      const { data, error } = await client.rpc('commit_sources', {
        ...sourcesPayload(request), p_request_id: request.requestId, p_accept_reconciliation: request.acceptReconciliation, p_dry_run: false,
      });
      if (error) throw translateError(error);
      const result = data as Record<string, unknown>;
      return {
        outcome: result.outcome === 'changed' ? 'changed' : 'unchanged',
        replayed: result.replayed === true,
        revisionId: typeof result.revision_id === 'number' ? result.revision_id : null,
        added: Number(result.added), changed: Number(result.changed), unchanged: Number(result.unchanged),
        ...decodeFoodCounts(result),
        conflicts: decodeConflicts(result.conflicts),
      };
    },
    async clearDay(request) {
      const { data, error } = await client.rpc('clear_day', {
        p_request_id: request.requestId, p_expected_revision_id: request.expectedRevisionId, p_date: request.date, p_domain: request.domain,
      });
      if (error) throw translateError(error);
      return decodeChange(data);
    },
    async previewUndo(expectedRevisionId): Promise<UndoPreview> {
      const { data, error } = await client.rpc('undo_last_change', { p_request_id: null, p_expected_revision_id: expectedRevisionId, p_dry_run: true });
      if (error) throw translateError(error);
      const preview = data as Record<string, unknown>;
      return {
        targetId: String(preview.target_batch_id),
        targetKind: preview.target_kind as ChangeKind,
        targetCommittedAt: String(preview.target_committed_at),
        restoresRevisionId: typeof preview.restores_revision_id === 'number' ? preview.restores_revision_id : null,
        added: Number(preview.added), changed: Number(preview.changed), removed: Number(preview.removed),
        firstDate: (preview.first_date as string | null) ?? null,
        lastDate: (preview.last_date as string | null) ?? null,
      };
    },
    async undoLastChange(request) {
      const { data, error } = await client.rpc('undo_last_change', { p_request_id: request.requestId, p_expected_revision_id: request.expectedRevisionId, p_dry_run: false });
      if (error) throw translateError(error);
      return decodeChange(data);
    },
    onIdentityChange(listener) {
      const pending = new Set<ReturnType<typeof setTimeout>>();
      const { data } = client.auth.onAuthStateChange(() => {
        // Auth callbacks run under an auth lock. Defer any subsequent auth calls.
        const timer = setTimeout(() => { pending.delete(timer); listener(); }, 0);
        pending.add(timer);
      });
      return () => { data.subscription.unsubscribe(); pending.forEach(clearTimeout); };
    },
  };
}

function isAlreadyStored(error: { message?: string; status?: number; statusCode?: string }): boolean {
  return error.status === 409 || error.statusCode === '409' || /already exists/i.test(error.message ?? '');
}

function archivePath(source: SourceFile): string {
  if (source.kind === 'workbook') return `workbooks/${source.sha256}.xlsx`;
  return source.kind === 'food_csv' ? `food-csv/${source.sha256}.csv` : `workout-csv/${source.sha256}.csv`;
}

function sourcesPayload(request: SourcesRequest) {
  return {
    p_expected_revision_id: request.expectedRevisionId,
    p_sources: request.sources.map((source) => ({ kind: source.kind, sha256: source.sha256, file_name: source.name, byte_size: source.byteSize, media_type: source.mediaType })),
    p_daily: request.daily.map((record) => ({ date: record.date, domain: record.domain, fields: record.values })),
    p_food: request.food.map((day) => ({ date: day.date, source_kind: day.source, entries: day.entries })),
    p_workouts: request.workouts.map((day) => ({ date: day.date, source_kind: day.source, sets: day.sets })),
  };
}

function decodeFoodCounts(value: Record<string, unknown>): FoodCounts {
  return {
    foodAdded: Number(value.food_added ?? 0), foodChanged: Number(value.food_changed ?? 0), foodUnchanged: Number(value.food_unchanged ?? 0), foodKept: Number(value.food_kept ?? 0),
    workoutAdded: Number(value.workout_added ?? 0), workoutChanged: Number(value.workout_changed ?? 0), workoutUnchanged: Number(value.workout_unchanged ?? 0), workoutKept: Number(value.workout_kept ?? 0),
  };
}

function decodeConflicts(value: unknown): CalorieConflict[] {
  return ((value as Array<Record<string, unknown>> | null) ?? []).map((item) => ({
    date: String(item.date), detailCalories: Number(item.detail_calories), workbookCalories: Number(item.workbook_calories), difference: Number(item.difference),
  }));
}

function translateError(error: { code?: string; message: string }): Error {
  if (error.code === 'FI409') return new StaleRevisionError(error.message);
  if (error.code === 'FI422') return new ReconciliationRequiredError(error.message);
  if (error.code === 'P0002') return new NothingToChangeError(error.message);
  return Object.assign(new Error(error.message), { code: error.code });
}

function decodeChange(value: unknown): ChangeResult {
  const result = value as Record<string, unknown>;
  return {
    outcome: result.outcome === 'changed' ? 'changed' : 'unchanged',
    replayed: result.replayed === true,
    revisionId: typeof result.revision_id === 'number' ? result.revision_id : null,
    added: Number(result.added ?? 0), changed: Number(result.changed ?? 0), removed: Number(result.removed ?? 0),
  };
}

function decodeReview(value: unknown): ReviewState {
  const state = value as { decisions?: Array<Record<string, unknown>>; completeness?: Array<Record<string, unknown>> };
  return {
    decisions: (state.decisions ?? []).map((item) => ({ date: String(item.date), domain: 'scale_weight', field: String(item.field), value: Number(item.value),
      decision: item.decision as ReviewChoice, decidedAt: String(item.decided_at) })),
    completeness: (state.completeness ?? []).map((item) => ({ date: String(item.date), domain: 'nutrition', status: item.status as CompletenessStatus, decidedAt: String(item.decided_at) })),
  };
}

function decodeHistory(value: unknown): Omit<ImportedHistory, 'review'> {
  const history = value as {
    revision_id: number | null; records: Array<Record<string, unknown>>; food_days?: Array<Record<string, unknown>>; workout_days?: Array<Record<string, unknown>>;
    exercise_names?: Array<Record<string, unknown>>; aliases?: Record<string, string>; imports: Array<Record<string, unknown>>; undo_target_id?: string | null;
  };
  const numberOrNull = (item: unknown) => (item === null || item === undefined ? null : Number(item));
  return {
    revisionId: history.revision_id ?? null,
    undoTargetId: history.undo_target_id ?? null,
    records: history.records.map((record) => ({
      date: String(record.date),
      domain: record.domain as DailyDomain,
      values: record.fields as DailyValues,
      sourceFileId: String(record.source_file_id),
      revisionId: Number(record.revision_id),
    })),
    foodDays: (history.food_days ?? []).map((day) => ({
      date: String(day.date), source: day.source_kind as FoodSource, entries: Number(day.entries),
      calories: numberOrNull(day.calories), protein: numberOrNull(day.protein), fat: numberOrNull(day.fat), carbs: numberOrNull(day.carbs),
      missingCalories: Number(day.missing_calories ?? 0), revisionId: Number(day.revision_id),
    })),
    workoutDays: (history.workout_days ?? []).map((day) => ({
      date: String(day.date), source: day.source_kind as WorkoutSource, sets: Number(day.sets), exercises: Number(day.exercises),
      workouts: ((day.workouts as unknown[]) ?? []).map(String), durations: ((day.durations as unknown[]) ?? []).map(Number), revisionId: Number(day.revision_id),
    })),
    exerciseNames: (history.exercise_names ?? []).map((item) => ({ name: String(item.name), sets: Number(item.sets), days: Number(item.days) })),
    aliases: history.aliases ?? {},
    imports: history.imports.map((item) => ({
      id: String(item.id),
      kind: (item.kind as ChangeKind | undefined) ?? 'workbook',
      removed: Number(item.removed ?? 0),
      clearedDate: (item.cleared_date as string | null) ?? null,
      clearedDomain: (item.cleared_domain as ClearableDomain | null) ?? null,
      undoesId: (item.undoes_batch_id as string | null) ?? null,
      undone: item.undone === true,
      committedAt: String(item.committed_at),
      outcome: item.outcome === 'changed' ? 'changed' : 'unchanged',
      revisionId: typeof item.revision_id === 'number' ? item.revision_id : null,
      added: Number(item.added), changed: Number(item.changed), unchanged: Number(item.unchanged),
      firstDate: (item.first_date as string | null) ?? null,
      lastDate: (item.last_date as string | null) ?? null,
      fileNames: (item.file_names as string[] | undefined) ?? (item.file_name ? [String(item.file_name)] : []),
      ...decodeFoodCounts(item),
      reconciliation: decodeConflicts(item.reconciliation),
    })),
  };
}
