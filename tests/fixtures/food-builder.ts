import { strToU8 } from 'fflate';

/** Synthetic food CSV rows in MacroFactor's column layout (a subset of nutrient columns). */
export const foodHeaders = ['Date', 'Time', 'Food Name', 'Serving Size', 'Serving Qty', 'Serving Weight (g)', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)', 'Caffeine (mg)'];

export function foodRow(date: string, time: string, name: string, values: Record<string, string | number>): Array<string | number | null> {
  const defaults: Record<string, string | number> = { 'Serving Size': 'serving', 'Serving Qty': 1, 'Serving Weight (g)': 100, 'Fat (g)': 1, 'Carbs (g)': 2, 'Protein (g)': 3 };
  const row: Record<string, string | number> = { ...defaults, ...values, Date: date, Time: time, 'Food Name': name };
  return foodHeaders.map((header) => (header in row && row[header] !== '' ? row[header] : null));
}

export function foodCsv(rows: Array<Array<string | number | null>>): Uint8Array {
  const quote = (value: string | number | null) => {
    if (value === null) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return strToU8(`﻿${[foodHeaders, ...rows].map((row) => row.map(quote).join(',')).join('\n')}\n`);
}
