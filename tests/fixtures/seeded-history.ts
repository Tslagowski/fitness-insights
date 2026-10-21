import { addDays } from '../../src/analysis/eligibility';
import { reportingToday } from '../../src/import/preview';
import { parseWorkbook } from '../../src/import/workbook';
import type { WorkoutDay, WorkoutSet } from '../../src/import/workout';
import { dailyRow, syntheticWorkbook } from './workbook-builder';
import { MemoryGateway } from './memory-gateway';

export const yesterday = () => addDays(reportingToday(), -1);
const set = (exercise: string, values: WorkoutSet): WorkoutSet => ({ 'Workout Duration': 2912, Workout: 'Push A', Exercise: exercise, 'Set Type': 'Standard Set', ...values });

/**
 * 56 days of daily history ending yesterday (a steady previous 28 days, then four 3,500 kcal days in the
 * current 28) plus seven weekly Bench Press sessions, committed now so every day is confirmed.
 */
export async function seededGateway() {
  const gateway = new MemoryGateway();
  gateway.clock = Date.now();
  const rows = Array.from({ length: 56 }, (_, index) => dailyRow(addDays(yesterday(), index - 55), {
    'Calories (kcal)': index >= 28 ? (index % 7 === 5 ? 3500 : 2200) : 2300, Expenditure: 2500, 'Target Calories (kcal)': 2400,
    'Weight (lb)': 201 - 0.1 * index, 'Trend Weight (lb)': 200 - 0.1 * index, Steps: index >= 28 ? 9000 : 7000 }));
  const workouts: WorkoutDay[] = [100, 100, 100, 105, 105, 110, 110].map((load, index) => ({ date: addDays(yesterday(), (index - 6) * 7), source: 'workout_csv', sets: [set('Bench Press', { 'Weight (lb)': load, Reps: 8 })] }));
  await gateway.commitSources({ requestId: 'seed', expectedRevisionId: null, acceptReconciliation: false, food: [], workouts,
    daily: parseWorkbook(syntheticWorkbook(rows)).records, sources: [
      { name: 'export.xlsx', kind: 'workbook', sha256: 'a'.repeat(64), byteSize: 1, mediaType: 'x', bytes: new Uint8Array() },
      { name: 'workouts.csv', kind: 'workout_csv', sha256: 'c'.repeat(64), byteSize: 1, mediaType: 'text/csv', bytes: new Uint8Array() }] });
  return gateway;
}
