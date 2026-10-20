import { describe, expect, test } from 'vitest';
import { planImport } from '../src/import/sources';
import { formatDuration, groupSessions, supersetBaseName } from '../src/import/workout';
import { buildWorkbook, dailyHeaders, dailyRow } from './fixtures/workbook-builder';
import { setRow, workoutCsv, workoutHeaders } from './fixtures/workout-builder';

describe('workout sets', () => {
  test('keep source order, identical sets, and every value exactly as logged', () => {
    const plan = planImport([{ name: 'export.csv', bytes: workoutCsv([
      setRow('2026-09-01', 'Dumbbell Curl', { 'Weight (lb)': 30, Reps: 12 }),
      setRow('2026-09-01', 'Dumbbell Curl', { 'Weight (lb)': 30, Reps: 12 }),
      setRow('2026-09-01', 'Machine-Assisted Pull-Up', { 'Weight (lb)': -100, Reps: 6, 'Set Type': 'Failure Set', RIR: 0 }),
      setRow('2026-09-01', 'Hack Squat', { 'Exercise Base Weight (lb)': 100, 'Weight (lb)': 90 }),
      setRow('2026-09-01', 'Side Plank', { 'Weight (lb)': '', Reps: '', RIR: '', Duration: 60 }),
      setRow('2026-09-01', 'Push-Up', { 'Weight (lb)': '', Reps: 15, 'Set Type': 'Warm-Up Set' }),
    ]) }]);
    expect(plan.sources.map((source) => source.kind)).toEqual(['workout_csv']);
    const sets = plan.workouts!.days[0].sets;
    expect(sets).toHaveLength(6);
    expect(sets[0]).toEqual(sets[1]);
    expect(sets[2]).toMatchObject({ 'Weight (lb)': -100, Reps: 6, 'Set Type': 'Failure Set', RIR: 0 });
    // Base weight is metadata only: the logged load stays 90, never 190.
    expect(sets[3]).toMatchObject({ 'Exercise Base Weight (lb)': 100, 'Weight (lb)': 90 });
    expect(sets[4]).toEqual({ 'Workout Duration': 2912, Workout: 'Push A', Exercise: 'Side Plank', 'Set Type': 'Standard Set', Duration: 60 });
    expect(sets[5]).not.toHaveProperty('Weight (lb)');
    expect(sets[5]['Set Type']).toBe('Warm-Up Set');
  });

  test('a workout CSV wins over the workbook Workout Log on dates it covers', () => {
    const log = { name: 'Workout Log', rows: [workoutHeaders, setRow('2026-09-01', 'Workbook Bench'), setRow('2026-09-02', 'Workbook Squat')] };
    const workbook = buildWorkbook([{ name: 'Quick Export', rows: [dailyHeaders, dailyRow('2026-09-01')] }, log]);
    const plan = planImport([{ name: 'a.xlsx', bytes: workbook }, { name: 'b.csv', bytes: workoutCsv([setRow('2026-09-02', 'CSV Squat')]) }]);
    expect(plan.daily!.sheets.find((sheet) => sheet.name === 'Workout Log')?.disposition).toBe('workout-detail');
    expect(plan.workouts!.days.map((day) => [day.date, day.source, day.sets[0].Exercise])).toEqual([
      ['2026-09-01', 'workbook_workout_log', 'Workbook Bench'], ['2026-09-02', 'workout_csv', 'CSV Squat'],
    ]);
    expect(plan.workouts!.overriddenWorkbookDates).toEqual(['2026-09-02']);
  });

  test('invalid numbers and dates become findings, and duplicate workout CSVs are rejected', () => {
    const plan = planImport([{ name: 'w.csv', bytes: workoutCsv([setRow('2026-09-01', 'Row', { Reps: 'ten' }), setRow('2026-13-01', 'Row')]) }]);
    expect(plan.workouts!.days[0].sets[0]).not.toHaveProperty('Reps');
    expect(plan.workouts!.findings.map((finding) => [finding.row, finding.column])).toEqual([[2, 'Reps'], [3, 'Date']]);
    const csv = workoutCsv([setRow('2026-09-01', 'Row')]);
    expect(() => planImport([{ name: 'a.csv', bytes: csv }, { name: 'b.csv', bytes: csv }])).toThrow(/More than one workout CSV/);
  });
});

describe('sessions and durations', () => {
  test('group by workout name and duration without summing duration across sets', () => {
    const sets = planImport([{ name: 'w.csv', bytes: workoutCsv([
      setRow('2026-09-01', 'Bench'), setRow('2026-09-01', 'Row'), setRow('2026-09-01', 'Bench'),
      setRow('2026-09-01', 'Run', { Workout: 'Cardio', 'Workout Duration': 600, Duration: 600, 'Weight (lb)': '', Reps: '' }),
    ]) }]).workouts!.days[0].sets;
    const sessions = groupSessions(sets);
    expect(sessions.map((session) => [session.workout, session.durationRaw, session.setCount])).toEqual([['Push A', 2912, 3], ['Cardio', 600, 1]]);
    expect(sessions[0].exercises.map((exercise) => [exercise.name, exercise.sets.length])).toEqual([['Bench', 2], ['Row', 1]]);
  });

  test('format raw durations under the provisional unit and recognize superset labels', () => {
    expect(formatDuration(2912, 'seconds')).toBe('48 min 32 s');
    expect(formatDuration(2912, 'minutes')).toBe('48 h 32 min');
    expect(formatDuration(60, 'seconds')).toBe('1 min');
    expect(formatDuration(null, 'seconds')).toBe('—');
    expect(supersetBaseName('Hack Squat ∈ SS1')).toBe('Hack Squat');
    expect(supersetBaseName('Hack Squat')).toBeNull();
  });
});
