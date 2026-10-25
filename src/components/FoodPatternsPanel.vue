<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SavedFoodDay } from '../gateway';
import type { DailyValues } from '../analysis/daily';
import { analyzeFoods, dayClasses, eveningCutoffHour, foodPatternsMethodVersion, targetBand, timeBuckets, type DayClass, type FoodRow } from '../analysis/foods';
import { plural } from '../import/preview';
import CategoryChart from './CategoryChart.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ days: DailyValues[]; foodDays: SavedFoodDay[] | null; problem: string }>();
const result = computed(() => (props.foodDays ? analyzeFoods(props.days, props.foodDays) : null));
const order = ref<'total' | 'difference'>('difference');
const limit = 15;
const ranked = computed(() => {
  const foods = [...(result.value?.foods ?? [])];
  if (order.value === 'difference') return foods.filter((row) => row.difference !== null).sort((left, right) => right.difference! - left.difference! || left.name.localeCompare(right.name)).slice(0, limit);
  return foods.slice(0, limit);
});
const classNames: Record<DayClass, string> = { over: 'Over target', within: 'Within target', under: 'Under target' };
const kcal = (value: number | null) => (value === null ? '—' : `${Math.round(value).toLocaleString('en-US')} kcal`);
const signed = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Math.round(value)).toLocaleString('en-US')} kcal`);
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const selected = ref<number | null>(null);
const chartSeries = computed(() => (result.value ? [
  { key: 'over', name: 'Over-target days', tone: 'red', values: result.value.timing.over.buckets.map((bucket) => bucket.perDay) },
  { key: 'within', name: 'Within-target days', tone: 'blue', values: result.value.timing.within.buckets.map((bucket) => bucket.perDay) },
] : []));
function details(row: FoodRow) {
  return [
    { label: 'Entries (as logged)', value: String(row.entries) },
    { label: 'Total', value: kcal(row.totalKcal) },
    ...dayClasses.map((kind) => ({ label: `${classNames[kind]} per day`, value: `${kcal(row.byClass[kind].perDay)} (${plural(row.byClass[kind].entries, 'entry', 'entries')})` })),
    { label: 'Over − within per day', value: signed(row.difference) },
  ];
}
const narrow = useNarrow();
const rows = computed<DataRow[]>(() => ranked.value.map((row) => ({
  key: row.name, heading: row.name, primary: order.value === 'difference' ? signed(row.difference) : kcal(row.totalKcal),
  secondary: `${plural(row.entries, 'entry', 'entries')} · over ${kcal(row.byClass.over.perDay)}/day · within ${kcal(row.byClass.within.perDay)}/day`, details: details(row),
})));
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="foods-heading">
    <div class="section-heading"><div><div class="eyebrow">FROM YOUR FOOD DETAIL</div><h2 id="foods-heading">Over-target days</h2></div>
      <span class="outline-pill">Method {{ foodPatternsMethodVersion }}</span></div>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <p v-else-if="!result" class="field-help">Loading food entries…</p>
    <template v-else>
      <p class="field-help">Days with food detail and a calorie target are classed by intake − target: over above +{{ targetBand }} kcal, under below −{{ targetBand }} kcal, otherwise within. Foods are grouped by their logged name; repeated entries count as logged. This shows which foods and times contributed, not which foods are good or bad.</p>
      <div class="metric-grid" aria-label="Day classes">
        <article v-for="kind in dayClasses" :key="kind" class="metric-tile"><h4>{{ classNames[kind] }}</h4><p class="metric-value">{{ result.counts[kind] }}</p><p class="metric-detail">{{ result.counts[kind] === 1 ? 'day' : 'days' }} with food detail</p></article>
      </div>
      <p class="field-help">Not included: {{ plural(result.excluded.workbookOnly, 'workbook-total day') }} without food detail, {{ plural(result.excluded.noTarget, 'food-detail day') }} without a target, and {{ plural(result.excluded.missingCalories, 'entry', 'entries') }} with no calorie value (never counted as zero).</p>
      <p v-if="!result.counts.over || !result.counts.within" class="field-help">Comparing over-target with within-target days needs at least one day of each.</p>
      <h3 class="subheading">Foods</h3>
      <div class="segmented" role="group" aria-label="Rank foods by">
        <button type="button" :aria-pressed="order === 'difference'" @click="order = 'difference'">Over − within per day</button>
        <button type="button" :aria-pressed="order === 'total'" @click="order = 'total'">Total kcal</button>
      </div>
      <DataRows v-if="narrow" :rows="rows" label="Foods" :group-by-month="false" />
      <div v-else class="table-scroll" role="region" aria-label="Foods" tabindex="0">
        <table class="period-table">
          <thead><tr><th scope="col">Food (as logged)</th><th scope="col">Entries</th><th scope="col">Total</th><th scope="col">Over days, per day</th><th scope="col">Within days, per day</th><th scope="col">Over − within</th></tr></thead>
          <tbody><tr v-for="row in ranked" :key="row.name"><th scope="row">{{ row.name }}</th><td>{{ row.entries }}</td><td>{{ kcal(row.totalKcal) }}</td>
            <td>{{ kcal(row.byClass.over.perDay) }}</td><td>{{ kcal(row.byClass.within.perDay) }}</td><td>{{ signed(row.difference) }}</td></tr></tbody>
        </table>
      </div>
      <h3 class="subheading">Time of day</h3>
      <CategoryChart :labels="timeBuckets.map((bucket) => bucket.short)" :series="chartSeries" :selected="selected" title="Calories per day by logged time (kcal)" unit=" kcal" @select="selected = $event" />
      <p v-if="selected !== null" class="field-help" aria-live="polite"><strong>{{ timeBuckets[selected].label }}:</strong> over-target days {{ kcal(result.timing.over.buckets[selected].perDay) }} per day ({{ percent(result.timing.over.buckets[selected].share) }}); within-target days {{ kcal(result.timing.within.buckets[selected].perDay) }} per day ({{ percent(result.timing.within.buckets[selected].share) }}).</p>
      <dl class="calendar-details">
        <div v-for="kind in dayClasses" :key="kind"><dt>{{ classNames[kind] }} ({{ result.timing[kind].days }})</dt>
          <dd>{{ percent(result.timing[kind].afterCutoffShare) }} of timed calories at {{ eveningCutoffHour - 12 }} PM or later · {{ plural(result.timing[kind].untimed.entries, 'entry', 'entries') }} without a time ({{ kcal(result.timing[kind].untimed.kcal) }})</dd></div>
      </dl>
    </template>
    <details class="preview-section">
      <summary>How this is calculated</summary>
      <ul class="plain-list formulas">
        <li><strong>Day classes</strong><span>Eligible days with food detail and a target: over when intake − target is above +{{ targetBand }} kcal, under below −{{ targetBand }} kcal, otherwise within.</span></li>
        <li><strong>Per day</strong><span>A food's calories on days of a class ÷ the number of days in that class (days without the food count as 0 for it).</span></li>
        <li><strong>Time of day</strong><span>From each entry's logged Time; the evening share is calories logged at {{ eveningCutoffHour - 12 }}:00 PM or later ÷ timed calories. Entries without a readable time are counted separately.</span></li>
      </ul>
    </details>
  </section>
</template>
