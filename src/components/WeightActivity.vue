<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ImportedHistory } from '../gateway';
import { reasonLabels, type Eligibility, type EligibilityReport } from '../analysis/eligibility';
import type { WindowChoice } from '../analysis/periods';
import { analyzeTrends, trendsMethodVersion, type Measure, type TrendPeriod } from '../analysis/trends';
import { formatCalendarDate, formatShortDate, plural } from '../import/preview';
import WeightActivityCharts from './WeightActivityCharts.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ history: ImportedHistory; report: EligibilityReport; choice: WindowChoice }>();

const analysis = computed(() => analyzeTrends(props.history, props.report, props.choice));
const current = computed(() => analysis.value.current);
const previous = computed(() => analysis.value.previous);
const selected = ref<string | null>(null);
watch(current, (period) => {
  if (period && !period.days.some((day) => day.date === selected.value)) selected.value = period.end;
}, { immediate: true });
const selectedDay = computed(() => current.value?.days.find((day) => day.date === selected.value) ?? null);

const pounds = (value: number) => `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lb`;
const signedNumber = (value: number, digits: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const steps = (value: number) => Math.round(value).toLocaleString('en-US');
const range = (period: TrendPeriod) => `${formatCalendarDate(period.start)} – ${formatCalendarDate(period.end)}`;
const statusText = (status: Eligibility, value: number | null) => (value === null && (status.eligible || status.reason === 'not-recorded') ? 'Not recorded'
  : status.eligible ? 'Counted' : reasonLabels[status.reason]);

interface Tile { label: string; value: string; detail: string; comparison: string; warning?: boolean }
function tile(label: string, measureNow: Measure, measureBefore: Measure, value: string, detail: string, shift: number | null, formatShift: (value: number) => string, prior: string, unit: string): Tile {
  const period = current.value!;
  const before = previous.value!;
  if (!measureNow.covered) {
    return { label, value: 'Insufficient coverage', detail: `${measureNow.count} of ${period.required} required ${unit}`, comparison: 'No comparison shown below the coverage threshold.' };
  }
  const comparison = shift !== null ? `${formatShift(shift)} vs previous period (${prior})`
    : !measureBefore.covered ? `No comparison: the previous period (${range(before)}) has insufficient coverage.` : 'No comparison available.';
  return { label, value, detail, comparison };
}
const tiles = computed<Tile[]>(() => {
  const period = current.value;
  const before = previous.value;
  if (!period || !before) return [];
  const shift = analysis.value.shift;
  const rate = period.trend.weeklyRate;
  const trendSpan = period.trend.first && period.trend.last ? `${pounds(period.trend.first.value)} (${formatCalendarDate(period.trend.first.date)}) to ${pounds(period.trend.last.value)} (${formatCalendarDate(period.trend.last.date)})` : '';
  return [
    tile('Average scale weight', period.scale, before.scale, period.scale.mean === null ? '—' : pounds(period.scale.mean), plural(period.scale.count, 'weigh-in') + ' counted',
      shift.scaleMean, (value) => `${signedNumber(value, 1)} lb`, before.scale.mean === null ? '—' : pounds(before.scale.mean), 'weigh-ins'),
    { ...tile('Trend weight rate', period.trend, before.trend, rate === null ? 'Not enough spread' : `${signedNumber(rate, 2)} lb/week`, `${trendSpan} · ${plural(period.trend.count, 'trend value')}${period.warningDates.length ? ' †' : ''}`,
      shift.weeklyRate, (value) => `${signedNumber(value, 2)} lb/week`, before.trend.weeklyRate === null ? '—' : `${signedNumber(before.trend.weeklyRate, 2)} lb/week`, 'trend values'), warning: period.warningDates.length > 0 },
    tile('Average daily steps', period.steps, before.steps, period.steps.mean === null ? '—' : steps(period.steps.mean), `${plural(period.steps.count, 'day')} with steps`,
      shift.stepsMean, (value) => `${signedNumber(Math.round(value), 0)}`, before.steps.mean === null ? '—' : steps(before.steps.mean), 'days with steps'),
  ];
});
const leftOutWeighIns = computed(() => current.value?.days.filter((day) => day.scale !== null && !day.scaleStatus.eligible) ?? []);

const narrow = useNarrow();
const dateRows = computed<DataRow[]>(() => [...(current.value?.days ?? [])].reverse().map((day) => {
  const status = statusText(day.scaleStatus, day.scale);
  return {
    key: day.date, date: day.date, heading: formatShortDate(day.date), tag: day.scale !== null && status !== 'Counted' ? status : undefined, dimmed: day.scale !== null && !day.scaleStatus.eligible,
    primary: day.scale === null ? '—' : pounds(day.scale),
    secondary: `trend ${day.trend === null ? '—' : day.trend.toFixed(1)}${day.estimateWarning && day.trend !== null ? ' †' : ''} · ${day.steps === null ? '—' : steps(day.steps)} steps`,
  };
}));
</script>

<template>
  <section class="section-card intake-balance" aria-labelledby="trends-heading">
    <div class="section-heading"><div><div class="eyebrow">EACH MEASURE KEEPS ITS OWN COVERAGE</div><h2 id="trends-heading">Weight and activity</h2></div>
      <span class="outline-pill">Method {{ trendsMethodVersion }}</span></div>
    <p v-if="!current" class="field-help">There is no completed past day with imported weight or steps yet.</p>
    <template v-else-if="current && previous">
      <ul class="coverage-chips" aria-label="Weight and steps coverage">
        <li :class="{ short: !current.scale.covered }"><strong>{{ current.scale.count }}</strong> of {{ current.length }} days with a counted weigh-in</li>
        <li :class="{ short: !current.trend.covered }"><strong>{{ current.trend.count }}</strong> trend values</li>
        <li :class="{ short: !current.steps.covered }"><strong>{{ current.steps.count }}</strong> days with steps</li>
      </ul>
      <p class="field-help">Each measure needs {{ current.required }} of {{ current.length }} days in each period before its headline and comparison are shown. Scale weigh-ins and MacroFactor's trend weight are separate series; the trend is MacroFactor's estimate as exported, never recalculated from your weigh-ins. Missing days stay missing.</p>
      <div class="metric-grid" aria-label="Weight and activity metrics">
        <article v-for="item in tiles" :key="item.label" class="metric-tile" :class="{ insufficient: item.value === 'Insufficient coverage' }">
          <h4>{{ item.label }}</h4><p class="metric-value">{{ item.value }}</p><p class="metric-detail">{{ item.detail }}</p><p class="metric-comparison">{{ item.comparison }}</p>
        </article>
      </div>
      <p v-if="current.warningDates.length" class="alert warning-note" role="note">† MacroFactor's trend weight on {{ plural(current.warningDates.length, 'day') }} in this period (from {{ formatCalendarDate(current.warningDates[0]) }}) may reflect a questioned weigh-in. Excluding a scale value here does not change MacroFactor's estimates; re-export after correcting it in MacroFactor.</p>
      <p v-if="leftOutWeighIns.length" class="field-help">Left out of weight calculations: {{ leftOutWeighIns.map((day) => `${pounds(day.scale!)} on ${formatCalendarDate(day.date)} (${statusText(day.scaleStatus, day.scale).toLowerCase()})`).join('; ') }}.</p>

      <WeightActivityCharts :days="current.days" :selected="selected" @select="selected = $event" />

      <div id="selected-trend-day" class="selected-day" aria-live="polite" aria-label="Selected weight and steps day">
        <template v-if="selectedDay">
          <h3>{{ formatCalendarDate(selectedDay.date, { weekday: true }) }}</h3>
          <dl class="calendar-details">
            <div><dt>Scale weight</dt><dd>{{ selectedDay.scale === null ? '—' : pounds(selectedDay.scale) }} · {{ statusText(selectedDay.scaleStatus, selectedDay.scale) }}</dd></div>
            <div><dt>Trend weight (MacroFactor)</dt><dd>{{ selectedDay.trend === null ? '—' : pounds(selectedDay.trend) }} · {{ statusText(selectedDay.trendStatus, selectedDay.trend) }}{{ selectedDay.estimateWarning ? ' · † may reflect a questioned weigh-in' : '' }}</dd></div>
            <div><dt>Steps</dt><dd>{{ selectedDay.steps === null ? '—' : steps(selectedDay.steps) }} · {{ statusText(selectedDay.stepsStatus, selectedDay.steps) }}</dd></div>
          </dl>
        </template>
      </div>

      <details class="preview-section">
        <summary>Weight and steps dates ({{ current.days.length }})</summary>
        <DataRows v-if="narrow" :rows="dateRows" label="Weight and steps dates" :selected="selected" @select="selected = $event" />
        <div v-else class="table-scroll" role="region" aria-label="Weight and steps dates" tabindex="0">
          <table class="period-table trends-table">
            <caption class="visually-hidden">Every date in {{ range(current) }} with weight and steps</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Scale (lb)</th><th scope="col">Scale status</th><th scope="col">Trend (lb)</th><th scope="col">Steps</th></tr></thead>
            <tbody>
              <tr v-for="day in [...current.days].reverse()" :key="day.date" :class="{ 'is-selected': day.date === selected }">
                <th scope="row"><button class="text-button" type="button" :aria-pressed="day.date === selected" @click="selected = day.date">{{ formatCalendarDate(day.date, { weekday: true }) }}</button></th>
                <td>{{ day.scale === null ? '—' : day.scale.toFixed(1) }}</td><td class="source-cell">{{ statusText(day.scaleStatus, day.scale) }}</td>
                <td>{{ day.trend === null ? '—' : day.trend.toFixed(1) }}{{ day.estimateWarning && day.trend !== null ? ' †' : '' }}</td>
                <td>{{ day.steps === null ? '—' : steps(day.steps) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <details class="preview-section">
        <summary>How weight and steps are calculated</summary>
        <ul class="plain-list formulas">
          <li><strong>Average scale weight</strong><span>Mean of counted weigh-ins (pounds as exported). Weigh-ins pending review or excluded by you are left out.</span></li>
          <li><strong>Trend weight rate</strong><span>7 × the least-squares slope of MacroFactor's trend weight against elapsed calendar days in the period, using only days with a trend value. Missing days are not filled in.</span></li>
          <li><strong>Average daily steps</strong><span>Mean over days with recorded steps; days without steps are not counted as zero.</span></li>
          <li><strong>Coverage</strong><span>5 of 7, 21 of 28, otherwise 75% of the period rounded up, separately for weigh-ins, trend values, and steps. Comparisons need both periods to pass.</span></li>
        </ul>
      </details>
    </template>
  </section>
</template>
