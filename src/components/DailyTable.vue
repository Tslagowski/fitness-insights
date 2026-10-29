<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FoodDaySummary } from '../gateway';
import type { DayStatus } from '../analysis/eligibility';
import type { DailyDomain, DailyRecord, DailyValues } from '../import/workbook';
import { dailyIntake, formatCalendarDate, formatShortDate, formatValue } from '../import/preview';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ records: DailyRecord[]; foodDays: FoodDaySummary[]; today: string; caption: string; statuses?: DayStatus[] }>();

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
const anyWarning = computed(() => (props.statuses ?? []).some((status) => status.estimateWarning));

const rows = computed(() => {
  const byDate = new Map<string, Map<DailyDomain, DailyValues>>();
  for (const record of props.records) {
    if (!byDate.has(record.date)) byDate.set(record.date, new Map());
    byDate.get(record.date)!.set(record.domain, record.values);
  }
  const foodByDate = new Map(props.foodDays.map((day) => [day.date, day]));
  const statusByDate = new Map((props.statuses ?? []).map((status) => [status.date, status]));
  const dates = [...new Set([...byDate.keys(), ...foodByDate.keys()])].sort().reverse();
  const cell = (domains: Map<DailyDomain, DailyValues> | undefined, column: { domain: DailyDomain; field: string; digits?: number }) => {
    const values = domains?.get(column.domain);
    return values ? formatValue(values[column.field], column.digits) : '—';
  };
  return dates.map((date) => {
    const domains = byDate.get(date);
    const intake = dailyIntake(foodByDate.get(date), domains?.get('nutrition_totals'));
    const planned = date > props.today;
    const status = statusByDate.get(date);
    const awaiting = !!status && date < props.today && [status.intake, status.weight].some((item) => !item.eligible && item.reason === 'after-import-cutoff');
    const measurements = measurementColumns.map((column) => cell(domains, column));
    if (status && !status.weight.eligible && status.weight.reason === 'pending-review') measurements[0] += ' (pending review)';
    if (status && !status.weight.eligible && status.weight.reason === 'excluded') measurements[0] += ' (excluded)';
    if (status?.estimateWarning) { measurements[1] += ' †'; measurements[2] += ' †'; }
    const incomplete = !!status && !status.intake.eligible && status.intake.reason === 'incomplete';
    return {
      date,
      status: date === props.today ? 'In progress' : planned ? 'Planned' : awaiting ? 'Awaiting import' : '',
      measurements,
      intake: [formatValue(intake.calories, 0), formatValue(intake.protein, 1), formatValue(intake.fat, 1), formatValue(intake.carbs, 1)],
      source: intake.source ? `${sourceLabels[intake.source]}${intake.entries !== null ? ` (${intake.entries})` : ''}${incomplete ? ' · marked incomplete' : ''}` : '—',
      trailing: trailingColumns.map((column) => cell(domains, column)),
      planned,
    };
  });
});

// Phones: one group of values at a time, as month-grouped rows.
const narrow = useNarrow();
const view = ref<'intake' | 'weight' | 'activity'>('intake');
const views = [{ id: 'intake', label: 'Intake' }, { id: 'weight', label: 'Weight' }, { id: 'activity', label: 'Activity' }] as const;
const withUnit = (value: string, unit: string) => (value === '—' ? '—' : `${value} ${unit}`);
const mobileRows = computed<DataRow[]>(() => rows.value.map((row) => {
  const [scale, trend, expenditure] = row.measurements;
  const [calories, protein, fat, carbs] = row.intake;
  const [target, steps] = row.trailing;
  const content = view.value === 'weight'
    ? { primary: withUnit(scale, 'lb'), secondary: `trend ${trend} · expenditure ${withUnit(expenditure, 'kcal')}` }
    : view.value === 'activity'
      ? { primary: withUnit(steps, 'steps'), secondary: `expenditure ${withUnit(expenditure, 'kcal')}` }
      : { primary: withUnit(calories, 'kcal'), secondary: `P ${protein} · F ${fat} · C ${carbs} · target ${target} · ${row.source}` };
  return {
    key: row.date, date: row.date, heading: formatShortDate(row.date), tag: row.status || undefined, dimmed: row.planned, ...content,
    details: [
      ...measurementColumns.map((column, index) => ({ label: column.label, value: row.measurements[index] })),
      { label: 'Intake (kcal)', value: calories }, { label: 'Protein (g)', value: protein }, { label: 'Fat (g)', value: fat }, { label: 'Carbs (g)', value: carbs },
      { label: 'Intake source', value: row.source },
      ...trailingColumns.map((column, index) => ({ label: column.label, value: row.trailing[index] })),
    ],
  };
}));
</script>

<template>
  <template v-if="narrow">
    <div class="segmented view-switch" role="group" :aria-label="`${caption}: values shown`">
      <button v-for="item in views" :key="item.id" type="button" :aria-pressed="view === item.id" @click="view = item.id">{{ item.label }}</button>
    </div>
    <DataRows :rows="mobileRows" :label="caption" :page-size="14" unit="days" />
  </template>
  <div v-else class="table-scroll" role="region" :aria-label="caption" tabindex="0">
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
  <p v-if="anyWarning" class="muted table-note">† MacroFactor's trend weight and expenditure on these dates may reflect a questioned weigh-in; excluding it here does not change those estimates.</p>
</template>
