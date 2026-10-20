<script setup lang="ts">
import { computed } from 'vue';
import type { DailyDomain, DailyRecord } from '../import/workbook';
import { formatCalendarDate, formatValue } from '../import/preview';

const props = defineProps<{ records: DailyRecord[]; today: string; caption: string }>();

const columns: Array<{ domain: DailyDomain; field: string; label: string; digits?: number }> = [
  { domain: 'scale_weight', field: 'Weight (lb)', label: 'Scale weight (lb)' },
  { domain: 'trend_weight', field: 'Trend Weight (lb)', label: 'Trend weight (lb)' },
  { domain: 'expenditure', field: 'Expenditure', label: 'Expenditure (kcal)', digits: 0 },
  { domain: 'nutrition_totals', field: 'Calories (kcal)', label: 'Calories (kcal)', digits: 0 },
  { domain: 'nutrition_totals', field: 'Protein (g)', label: 'Protein (g)', digits: 1 },
  { domain: 'nutrition_totals', field: 'Fat (g)', label: 'Fat (g)', digits: 1 },
  { domain: 'nutrition_totals', field: 'Carbs (g)', label: 'Carbs (g)', digits: 1 },
  { domain: 'targets', field: 'Target Calories (kcal)', label: 'Target (kcal)', digits: 0 },
  { domain: 'steps', field: 'Steps', label: 'Steps', digits: 0 },
];

const rows = computed(() => {
  const byDate = new Map<string, Map<DailyDomain, DailyRecord['values']>>();
  for (const record of props.records) {
    if (!byDate.has(record.date)) byDate.set(record.date, new Map());
    byDate.get(record.date)!.set(record.domain, record.values);
  }
  return [...byDate.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([date, domains]) => ({
    date,
    status: date === props.today ? 'In progress' : date > props.today ? 'Future' : '',
    cells: columns.map((column) => {
      const values = domains.get(column.domain);
      return values ? formatValue(values[column.field], column.digits) : 'not imported';
    }),
  }));
});
</script>

<template>
  <div class="table-scroll" role="region" :aria-label="caption" tabindex="0">
    <table class="daily-table">
      <caption class="visually-hidden">{{ caption }}</caption>
      <thead><tr><th scope="col">Date</th><th v-for="column in columns" :key="column.label" scope="col">{{ column.label }}</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.date">
          <th scope="row">{{ formatCalendarDate(row.date, { weekday: true }) }}<span v-if="row.status" class="row-status">{{ row.status }}</span></th>
          <td v-for="(cell, index) in row.cells" :key="index" :class="{ missing: cell === '—' || cell === 'not imported' }">{{ cell }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
