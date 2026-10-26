import { emptyHistory, type ImportSummary, type SavedWorkoutDay } from '../../src/gateway';
import { addDays, emptyReviewState, evaluateEligibility } from '../../src/analysis/eligibility';
import { analyzeExercises } from '../../src/analysis/exercise';
import type { WorkoutSet } from '../../src/import/workout';

/** Synthetic confirmed workout history for the training analyses (tickets 21-24). */
export const workoutToday = '2026-10-20';
export const workoutSet = (exercise: string, values: WorkoutSet = {}): WorkoutSet =>
  ({ 'Workout Duration': 2912, Workout: 'Full Body', Exercise: exercise, 'Set Type': 'Standard Set', ...values });

function importAt(committedAt: string): ImportSummary {
  return { id: committedAt, kind: 'import', committedAt, outcome: 'changed', revisionId: 1, added: 0, changed: 0, unchanged: 0, removed: 0,
    foodAdded: 0, foodChanged: 0, foodUnchanged: 0, foodKept: 0, workoutAdded: 1, workoutChanged: 0, workoutUnchanged: 0, workoutKept: 0,
    firstDate: null, lastDate: null, clearedDate: null, clearedDomain: null, undoesId: null, undone: false, fileNames: [], reconciliation: [] };
}

/** One workout day every `everyDays` days ending at `end`, each built from the given sets. */
export function workoutDays(end: string, sessions: WorkoutSet[][], everyDays = 7): SavedWorkoutDay[] {
  return sessions.map((sets, index) => ({ date: addDays(end, (index - sessions.length + 1) * everyDays), source: 'workout_csv', sets, revisionId: 1 }));
}

export function analyzeWorkouts(days: SavedWorkoutDay[], options: { aliases?: Record<string, string>; band?: number } = {}) {
  const history = { ...emptyHistory, imports: [importAt('2026-10-20T15:00:00Z')],
    workoutDays: days.map((day) => ({ date: day.date, source: day.source, sets: day.sets.length, exercises: 1, workouts: [], durations: [], revisionId: 1 })) };
  const report = evaluateEligibility(history, emptyReviewState, workoutToday);
  return { report, analysis: analyzeExercises(days, report, options.aliases ?? {}, { bandPercent: options.band ?? 2.5, durationUnit: 'seconds' }) };
}
