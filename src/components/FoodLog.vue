<script setup lang="ts">
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';
import { computed, ref } from 'vue';
import type { FoodDaySummary, Gateway, SavedFoodDay } from '../gateway';
import { foodSourceLabels } from '../import/food';
import { formatCalendarDate, formatShortDate, formatValue, plural } from '../import/preview';

const props = defineProps<{ gateway: Gateway; foodDays: FoodDaySummary[]; today: string }>();

const pageSize = 14;
const shown = ref(pageSize);
const open = ref<string | null>(null);
const loading = ref(false);
const loaded = ref<SavedFoodDay | null>(null);
const problem = ref('');
const days = computed(() => [...props.foodDays].sort((left, right) => right.date.localeCompare(left.date)));
const visible = computed(() => days.value.slice(0, shown.value));

async function toggle(date: string) {
  problem.value = '';
  if (open.value === date) { open.value = null; return; }
  open.value = date;
  loaded.value = null;
  loading.value = true;
  try {
    const day = await props.gateway.loadFoodDay(date);
    if (open.value === date) loaded.value = day;
  } catch {
    if (open.value === date) problem.value = 'The entries for this day could not be loaded. Check your connection and try again.';
  } finally {
    if (open.value === date) loading.value = false;
  }
}

function status(date: string): string {
  return date === props.today ? 'In progress' : date > props.today ? 'Planned' : '';
}
function serving(entry: Record<string, string | number>): string {
  const quantity = typeof entry['Serving Qty'] === 'number' ? formatValue(entry['Serving Qty']) : '';
  return [quantity, entry['Serving Size'] ?? ''].filter(Boolean).join(' ') || '—';
}
const numeric = (entry: Record<string, string | number>, label: string, digits: number) => formatValue(typeof entry[label] === 'number' ? (entry[label] as number) : null, digits);

const narrow = useNarrow();
const monthOf = (date: string) => { const [year, month] = date.split('-').map(Number); return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1))); };
/** On phones, a month heading precedes the first day of each month. */
const monthStart = (index: number) => narrow.value && (index === 0 || visible.value[index - 1].date.slice(0, 7) !== visible.value[index].date.slice(0, 7));
const dayLabel = (date: string) => (narrow.value ? formatShortDate(date) : formatCalendarDate(date, { weekday: true }));
const entryRows = computed<DataRow[]>(() => (loaded.value?.entries ?? []).map((entry, index) => ({
  key: String(index), heading: String(entry['Food Name'] ?? '—'), primary: `${numeric(entry, 'Calories (kcal)', 0)} kcal`,
  secondary: [entry.Time ?? 'no time', serving(entry), `P ${numeric(entry, 'Protein (g)', 1)} · F ${numeric(entry, 'Fat (g)', 1)} · C ${numeric(entry, 'Carbs (g)', 1)}`].filter(Boolean).join(' · '),
})));
</script>

<template>
  <section class="section-card" aria-labelledby="food-log-heading">
    <div class="section-heading"><div><div class="eyebrow">WHAT YOU LOGGED</div><h2 id="food-log-heading">Food log</h2></div>
      <span class="outline-pill">{{ plural(foodDays.length, 'day') }}</span></div>
    <p class="field-help">Entries exactly as exported, in order, including identical repeats. Totals add only recorded values; an entry without calories is shown, not counted as zero. Planned days after today are saved but not treated as eaten.</p>
    <ul class="food-days">
      <template v-for="(day, index) in visible" :key="day.date">
      <li v-if="monthStart(index)" class="month-heading" aria-hidden="true">{{ monthOf(day.date) }}</li>
      <li :class="{ planned: day.date > today }">
        <button type="button" class="food-day-toggle" :aria-expanded="open === day.date" @click="toggle(day.date)">
          <span class="food-day-date">{{ dayLabel(day.date) }}<span v-if="status(day.date)" class="row-status">{{ status(day.date) }}</span></span>
          <span class="food-day-totals">{{ formatValue(day.calories, 0) }} kcal · P {{ formatValue(day.protein, 0) }} · F {{ formatValue(day.fat, 0) }} · C {{ formatValue(day.carbs, 0) }}</span>
          <span class="muted">{{ day.entries }} {{ day.entries === 1 ? 'entry' : 'entries' }} · {{ foodSourceLabels[day.source] }}<template v-if="day.missingCalories"> · {{ day.missingCalories }} without calories</template></span>
        </button>
        <div v-if="open === day.date" class="food-entries">
          <p v-if="loading" class="muted" role="status">Loading entries...</p>
          <p v-else-if="problem" class="alert error" role="alert">{{ problem }}</p>
          <DataRows v-else-if="loaded && narrow" :rows="entryRows" :label="`Entries for ${formatCalendarDate(day.date)}`" :group-by-month="false" />
          <div v-else-if="loaded" class="table-scroll" role="region" :aria-label="`Entries for ${formatCalendarDate(day.date)}`" tabindex="0">
            <table class="daily-table">
              <thead><tr><th scope="col">Time</th><th scope="col" class="food-name">Food</th><th scope="col">Serving</th><th scope="col">kcal</th><th scope="col">Protein (g)</th><th scope="col">Fat (g)</th><th scope="col">Carbs (g)</th></tr></thead>
              <tbody><tr v-for="(entry, index) in loaded.entries" :key="index">
                <th scope="row">{{ entry.Time ?? '—' }}</th><td class="food-name">{{ entry['Food Name'] ?? '—' }}</td><td>{{ serving(entry) }}</td>
                <td>{{ numeric(entry, 'Calories (kcal)', 0) }}</td><td>{{ numeric(entry, 'Protein (g)', 1) }}</td><td>{{ numeric(entry, 'Fat (g)', 1) }}</td><td>{{ numeric(entry, 'Carbs (g)', 1) }}</td>
              </tr></tbody>
            </table>
          </div>
        </div>
      </li>
      </template>
    </ul>
    <button v-if="shown < days.length" class="text-button" type="button" @click="shown += pageSize">Show {{ Math.min(pageSize, days.length - shown) }} more days</button>
  </section>
</template>
