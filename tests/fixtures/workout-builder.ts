import { strToU8 } from 'fflate';

/** Synthetic workout CSV rows in MacroFactor's column layout. */
export const workoutHeaders = ['Date', 'Workout Duration', 'Workout', 'Exercise', 'Exercise Base Weight (lb)', 'Set Type', 'Weight (lb)', 'Reps', 'RIR', 'Duration', 'Distance short (Yd)', 'Distance long (Mi)'];

export function setRow(date: string, exercise: string, values: Record<string, string | number> = {}): Array<string | number | null> {
  const defaults: Record<string, string | number> = { 'Workout Duration': 2912, Workout: 'Push A', 'Set Type': 'Standard Set', 'Weight (lb)': 50, Reps: 10, RIR: 2 };
  const row: Record<string, string | number> = { ...defaults, ...values, Date: date, Exercise: exercise };
  return workoutHeaders.map((header) => (header in row && row[header] !== '' ? row[header] : null));
}

export function workoutCsv(rows: Array<Array<string | number | null>>): Uint8Array {
  const quote = (value: string | number | null) => {
    if (value === null) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return strToU8(`﻿${[workoutHeaders, ...rows].map((row) => row.map(quote).join(',')).join('\n')}\n`);
}
