<script setup lang="ts">
import { computed, ref, watch } from 'vue';

/**
 * Phone-friendly replacement for wide tables: rows grouped under month headings, each with a short
 * label, one primary value, and a line of secondary values; tapping a row shows every field.
 */
export interface DataRow {
  key: string;
  /** Calendar date (YYYY-MM-DD) used for month grouping, when rows are dated. */
  date?: string;
  heading: string;
  tag?: string;
  primary: string;
  secondary?: string;
  details?: Array<{ label: string; value: string }>;
  dimmed?: boolean;
  /** Ticket 38: a compact bar comparing a value with its target (for example intake vs target). */
  meter?: { value: number; target: number };
}

const props = withDefaults(defineProps<{ rows: DataRow[]; label: string; groupByMonth?: boolean; pageSize?: number; selected?: string | null; unit?: string }>(),
  { groupByMonth: true, pageSize: 0, selected: null, unit: 'rows' });
const emit = defineEmits<{ select: [key: string] }>();

const shown = ref(props.pageSize || Number.POSITIVE_INFINITY);
watch(() => props.rows.length, () => { shown.value = props.pageSize || Number.POSITIVE_INFINITY; });
const visible = computed(() => props.rows.slice(0, shown.value));
const remaining = computed(() => props.rows.length - visible.value.length);
const monthLabel = (date: string) => {
  const [year, month] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)));
};
const groups = computed(() => {
  if (!props.groupByMonth) return [{ label: '', rows: visible.value }];
  const result: Array<{ label: string; rows: DataRow[] }> = [];
  for (const row of visible.value) {
    const label = row.date ? monthLabel(row.date) : '';
    if (!result.length || result.at(-1)!.label !== label) result.push({ label, rows: [] });
    result.at(-1)!.rows.push(row);
  }
  return result;
});
const expanded = ref<string | null>(null);
function toggle(row: DataRow) {
  expanded.value = expanded.value === row.key ? null : row.key;
  emit('select', row.key);
}
</script>

<template>
  <div class="data-rows">
    <template v-for="group in groups" :key="group.label">
      <div v-if="group.label" class="month-heading" aria-hidden="true">{{ group.label }}</div>
      <ul class="row-list" :aria-label="group.label ? `${label}, ${group.label}` : label">
        <li v-for="row in group.rows" :key="row.key" :class="{ 'is-selected': row.key === selected, dimmed: row.dimmed }">
          <button type="button" class="data-row" :aria-expanded="row.details?.length ? expanded === row.key : undefined" @click="toggle(row)">
            <span class="row-head"><span class="row-heading">{{ row.heading }}</span><span v-if="row.tag" class="row-status">{{ row.tag }}</span></span>
            <span class="row-primary">{{ row.primary }}</span>
            <span v-if="row.secondary" class="row-secondary">{{ row.secondary }}</span>
            <span v-if="row.meter" class="row-meter" :class="{ over: row.meter.value > row.meter.target }" aria-hidden="true">
              <i :style="{ width: `${Math.min(row.meter.value / row.meter.target, 1.5) / 1.5 * 100}%` }"></i><b :style="{ left: `${100 / 1.5}%` }"></b></span>
          </button>
          <dl v-if="expanded === row.key && row.details?.length" class="row-details">
            <div v-for="item in row.details" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
          </dl>
        </li>
      </ul>
    </template>
    <button v-if="remaining > 0" class="text-button show-more" type="button" @click="shown += pageSize">Show {{ Math.min(pageSize, remaining) }} more {{ unit }}</button>
  </div>
</template>
