<script setup lang="ts">
import MethodInfo from './MethodInfo.vue';
import { computed, ref } from 'vue';
import type { DailyValues } from '../analysis/daily';
import { addDays } from '../analysis/eligibility';
import { analyzeProtein, proteinMethodVersion, type ProteinDay } from '../analysis/protein';
import { formatCalendarDate, formatShortDate, monthDay, plural } from '../import/preview';
import CategoryChart from './CategoryChart.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ days: DailyValues[] }>();
const scope = ref<'28' | '84' | 'all'>('84');
const scoped = computed(() => {
  if (scope.value === 'all' || !props.days.length) return props.days;
  const from = addDays(props.days.at(-1)!.date, -(Number(scope.value) - 1));
  return props.days.filter((day) => day.date >= from);
});
const result = computed(() => analyzeProtein(scoped.value));
const ratio = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)} g/lb`);
const grams = (value: number | null) => (value === null ? '—' : `${Math.round(value)} g`);
const signedGrams = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Math.round(value))} g`;
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const selectedWeek = ref<number | null>(null);
const weekSeries = computed(() => [{ key: 'ratio', name: 'Weekly mean g/lb', tone: 'teal', values: result.value.weeks.map((week) => (week.covered ? week.mean : null)) }]);
const distributionSeries = computed(() => [{ key: 'days', name: 'Days', tone: 'teal', values: result.value.distribution.map((bin) => bin.count) }]);
const sourceText = (day: ProteinDay) => (day.source === 'detail' ? 'food detail' : 'workbook total');
const narrow = useNarrow();
const missedRows = computed<DataRow[]>(() => result.value.missed.map((day) => ({
  key: day.date, date: day.date, heading: formatShortDate(day.date), primary: `${grams(day.protein)} of ${grams(day.target)}`,
  secondary: `${signedGrams(day.protein - day.target!)} · ${ratio(day.ratio)} · ${sourceText(day)}`,
})));
const weekText = (index: number) => {
  const week = result.value.weeks[index];
  return `Week of ${formatCalendarDate(week.weekStart)}: ${week.covered ? ratio(week.mean) : 'insufficient coverage'} (${week.matched} of 7 days${week.partial ? ', partial week' : ''})`;
};
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="protein-heading">
    <div class="section-heading"><div><div class="eyebrow">AGAINST YOUR OWN MACROFACTOR TARGET</div><h2 id="protein-heading">Protein per pound</h2></div>
      <MethodInfo :label="`Method ${proteinMethodVersion}`" /></div>
    <div class="insight-controls">
      <div class="segmented" role="group" aria-label="Scope">
        <button type="button" :aria-pressed="scope === '28'" @click="scope = '28'">4 weeks</button>
        <button type="button" :aria-pressed="scope === '84'" @click="scope = '84'">12 weeks</button>
        <button type="button" :aria-pressed="scope === 'all'" @click="scope = 'all'">All history</button>
      </div>
    </div>
    <p v-if="!result.days.length" class="field-help">No eligible protein values in this scope.</p>
    <template v-else>
      <div class="metric-grid" aria-label="Protein metrics">
        <article class="metric-tile"><h4>Mean protein per lb</h4><p class="metric-value">{{ ratio(result.meanRatio) }}</p><p class="metric-detail">Median {{ ratio(result.medianRatio) }} · {{ plural(result.matched, 'day') }} with trend weight</p></article>
        <article class="metric-tile"><h4>Protein target met</h4><p class="metric-value">{{ percent(result.target.share) }}</p><p class="metric-detail">{{ result.target.met }} of {{ plural(result.target.compared, 'day') }} with a target</p></article>
        <article class="metric-tile"><h4>Sources</h4><p class="metric-value">{{ result.sources.detail }} / {{ result.sources.workbook }}</p><p class="metric-detail">days from food detail / workbook totals (never summed)</p></article>
      </div>
      <p class="field-help">Grams per lb divides each day's protein by MacroFactor's trend weight that day. "Met" means protein at or above that day's protein target from MacroFactor; no other amount is recommended here.</p>
      <CategoryChart kind="line" :zero="false" :labels="result.weeks.map((week) => monthDay(week.weekStart))" :series="weekSeries" :selected="selectedWeek" title="Weekly mean protein per lb of trend weight (g/lb)" unit=" g/lb" @select="selectedWeek = $event" />
      <p v-if="selectedWeek !== null" class="field-help" aria-live="polite">{{ weekText(selectedWeek) }}</p>
      <CategoryChart :labels="result.distribution.map((bin) => bin.from.toFixed(1))" :series="distributionSeries" title="Days by protein per lb (bins of 0.1 g/lb)" unit=" days" />
      <h3 class="subheading">Days below the protein target ({{ result.missed.length }})</h3>
      <p v-if="!result.missed.length" class="field-help">Every day with a target met it in this scope.</p>
      <DataRows v-else-if="narrow" :rows="missedRows" label="Days below the protein target" :page-size="20" unit="days" />
      <div v-else class="table-scroll" role="region" aria-label="Days below the protein target" tabindex="0">
        <table class="period-table">
          <thead><tr><th scope="col">Date</th><th scope="col">Protein</th><th scope="col">Target</th><th scope="col">Difference</th><th scope="col">g/lb</th><th scope="col">Source</th></tr></thead>
          <tbody><tr v-for="day in result.missed" :key="day.date"><th scope="row">{{ formatCalendarDate(day.date, { weekday: true }) }}</th><td>{{ grams(day.protein) }}</td><td>{{ grams(day.target) }}</td>
            <td>{{ signedGrams(day.protein - day.target!) }}</td><td>{{ ratio(day.ratio) }}</td><td>{{ sourceText(day) }}</td></tr></tbody>
        </table>
      </div>
    </template>
    <details class="preview-section">
      <summary>How this is calculated</summary>
      <ul class="plain-list formulas">
        <li><strong>Daily protein</strong><span>Sum of the day's food entries when food detail exists, otherwise the workbook's daily total; eligible days only.</span></li>
        <li><strong>g/lb</strong><span>Protein ÷ MacroFactor's trend weight on the same date, when both are eligible.</span></li>
        <li><strong>Weekly mean</strong><span>Mean g/lb over Monday-start weeks; a week needs 5 of 7 matched days.</span></li>
      </ul>
    </details>
  </section>
</template>
