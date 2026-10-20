<script setup lang="ts">
import { computed } from 'vue';
import type { FoodDaySummary } from '../gateway';
import type { DailyDomain, DailyRecord, DailyValues } from '../import/workbook';
import { dailyIntake, formatCalendarDate, formatValue } from '../import/preview';

const props = defineProps<{ records: DailyRecord[]; foodDays: FoodDaySummary[]; today: string; caption: string }>();

const measurementColumns: Array<{ domain: DailyDomain; field: string; label: string; digits?: number }> = [
  { domain: 'scale_weight', field: 'Weight (lb)', label: 'Scale weight (lb)' },
  { domain: 'trend_weight', field: 'Trend Weight (lb)', label: 'Trend weight (lb)' },
  { domain: 'expenditure', field: 'Expenditure', label: 'Expenditure (kcal)', digits: 0 },
];
const trailingColumns: Array<{ domain: DailyDomain; field: string; label: string; digits?: number }> = [
  { domain: 'targets', field: 'Target Calories (kcal)', label: 'Target (kcal)', digits: 0 },
  { domain: 'steps', field: 'Steps', label: 'Steps', digits: 0 },
];
const sourceLabels = { detail: 'food entries', workbook: 'workbook total' } as const;

const rows = computed(() => {
  const byDate = new Map<string, Map<DailyDomain, DailyValues>>();
  for (const record of props.records) {
    if (!byDate.has(record.date)) byDate.set(record.date, new Map());
    byDate.get(record.date)!.set(record.domain, record.values);
  }
  const foodByDate = new Map(props.foodDays.map((day) => [day.date, day]));
  const dates = [...new Set([...byDate.keys(), ...foodByDate.keys()])].sort().reverse();
  const cell = (domains: Map<DailyDomain, DailyValues> | undefined, column: { domain: DailyDomain; field: string; digits?: number }) => {
    const values = domains?.get(column.domain);
    return values ? formatValue(values[column.field], column.digits) : '—';
  };
  return dates.map((date) => {
    const domains = byDate.get(date);
    const intake = dailyIntake(foodByDate.get(date), domains?.get('nutrition_totals'));
    const planned = date > props.today;
    return {
      date,
      status: date === props.today ? 'In progress' : planned ? 'Planned' : '',
      measurements: measurementColumns.map((column) => cell(domains, column)),
      intake: [formatValue(intake.calories, 0), formatValue(intake.protein, 1), formatValue(intake.fat, 1), formatValue(intake.carbs, 1)],
      source: intake.source ? `${sourceLabels[intake.source]}${intake.entries !== null ? ` (${intake.entries})` : ''}` : '—',
      trailing: trailingColumns.map((column) => cell(domains, column)),
      planned,
    };
  });
});
</script>

<template>
  <div class="table-scroll" role="region" :aria-label="caption" tabindex="0">
    <table class="daily-table">
      <caption class="visually-hidden">{{ caption }}</caption>
      <thead><tr><th scope="col">Date</th><th v-for="column in measurementColumns" :key="column.label" scope="col">{{ column.label }}</th>
        <th scope="col">Intake (kcal)</th><th scope="col">Protein (g)</th><th scope="col">Fat (g)</th><th scope="col">Carbs (g)</th><th scope="col">Intake source</th>
        <th v-for="column in trailingColumns" :key="column.label" scope="col">{{ column.label }}</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.date" :class="{ planned: row.planned }">
          <th scope="row">{{ formatCalendarDate(row.date, { weekday: true }) }}<span v-if="row.status" class="row-status">{{ row.status }}</span></th>
          <td v-for="(value, index) in row.measurements" :key="`m${index}`" :class="{ missing: value === '—' }">{{ value }}</td>
          <td v-for="(value, index) in row.intake" :key="`i${index}`" :class="{ missing: value === '—' }">{{ value }}</td>
          <td class="source-cell">{{ row.source }}</td>
          <td v-for="(value, index) in row.trailing" :key="`t${index}`" :class="{ missing: value === '—' }">{{ value }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
