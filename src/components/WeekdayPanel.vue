<script setup lang="ts">
import MethodInfo from './MethodInfo.vue';
import { computed, ref } from 'vue';
import type { DailyValues } from '../analysis/daily';
import { addDays } from '../analysis/eligibility';
import { analyzeWeekdays, minimumWeekdayCount, weekdayMethodVersion, type Stat, type WeekdayRow } from '../analysis/weekdays';
import { formatCalendarDate } from '../import/preview';
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
const result = computed(() => analyzeWeekdays(scoped.value));
const selected = ref<number | null>(null);

const signed = (value: number | null, unit = ' kcal', digits = 0) => (value === null ? '—'
  : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`);
const whole = (value: number | null, unit = '') => (value === null ? '—' : `${Math.round(value).toLocaleString('en-US')}${unit}`);
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const shown = (item: Stat, format: (value: number | null) => string) => (item.sufficient ? format(item.mean) : `Insufficient (${item.count})`);
const short = (name: string) => name.slice(0, 3);

const chartSeries = computed(() => [{ key: 'target', name: 'Mean vs target', tone: 'red', values: result.value.rows.map((row) => (row.targetDifference.sufficient ? row.targetDifference.mean : null)) }]);
function details(row: WeekdayRow) {
  return [
    { label: 'Days in scope', value: String(row.days) },
    { label: 'Intake mean / median', value: row.intake.sufficient ? `${whole(row.intake.mean, ' kcal')} / ${whole(row.intake.median, ' kcal')} (${row.intake.count} days)` : `Insufficient (${row.intake.count} days)` },
    { label: 'Mean vs target', value: `${shown(row.targetDifference, (value) => signed(value))} (${row.targetDifference.count} days)` },
    { label: 'Mean modeled balance', value: `${shown(row.balance, (value) => signed(value))} (${row.balance.count} days)` },
    { label: 'Mean steps', value: `${shown(row.steps, (value) => whole(value))} (${row.steps.count} days)` },
    { label: 'Scale − trend', value: `${shown(row.residual, (value) => signed(value, ' lb', 1))} (${row.residual.count} days)` },
    { label: 'Share of above-target kcal', value: `${percent(row.aboveTargetShare)} (${whole(row.aboveTarget, ' kcal')})` },
    { label: 'Share of gross surplus', value: `${percent(row.surplusShare)} (${whole(row.grossSurplus, ' kcal')})` },
  ];
}
const narrow = useNarrow();
const rows = computed<DataRow[]>(() => result.value.rows.map((row) => ({
  key: String(row.weekday), heading: row.name, tag: row.targetDifference.sufficient ? undefined : 'Insufficient',
  primary: shown(row.targetDifference, (value) => signed(value)), secondary: `${shown(row.intake, (value) => whole(value, ' kcal'))} · ${percent(row.aboveTargetShare)} of above-target`,
  dimmed: !row.targetDifference.sufficient, details: details(row),
})));
const splitRows = computed(() => [
  { label: 'Mean intake', weekend: result.value.weekend.intake, weekdays: result.value.weekdays.intake, format: (value: number | null) => whole(value, ' kcal') },
  { label: 'Mean vs target', weekend: result.value.weekend.targetDifference, weekdays: result.value.weekdays.targetDifference, format: (value: number | null) => signed(value) },
  { label: 'Mean modeled balance', weekend: result.value.weekend.balance, weekdays: result.value.weekdays.balance, format: (value: number | null) => signed(value) },
  { label: 'Mean steps', weekend: result.value.weekend.steps, weekdays: result.value.weekdays.steps, format: (value: number | null) => whole(value) },
  { label: 'Scale − trend', weekend: result.value.weekend.residual, weekdays: result.value.weekdays.residual, format: (value: number | null) => signed(value, ' lb', 1) },
]);
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="weekday-heading">
    <div class="section-heading"><div><div class="eyebrow">MONDAY-START WEEKS, AMERICA/DENVER DATES</div><h2 id="weekday-heading">Day-of-week patterns</h2></div>
      <MethodInfo :label="`Method ${weekdayMethodVersion}`" /></div>
    <div class="insight-controls">
      <div class="segmented" role="group" aria-label="Scope">
        <button type="button" :aria-pressed="scope === '28'" @click="scope = '28'">4 weeks</button>
        <button type="button" :aria-pressed="scope === '84'" @click="scope = '84'">12 weeks</button>
        <button type="button" :aria-pressed="scope === 'all'" @click="scope = 'all'">All history</button>
      </div>
    </div>
    <p v-if="result.start" class="field-help">{{ formatCalendarDate(result.start) }} – {{ formatCalendarDate(result.end!) }}. Each weekday needs {{ minimumWeekdayCount }} eligible days of a measure before its mean is shown or ranked.</p>
    <ul v-if="result.findings.length" class="plain-list findings" aria-label="Patterns">
      <li v-for="finding in result.findings" :key="finding">{{ finding }}</li>
    </ul>
    <p v-else class="field-help">No weekday has enough eligible days for a pattern in this scope.</p>
    <CategoryChart :labels="result.rows.map((row) => short(row.name))" :series="chartSeries" :selected="selected" title="Mean intake vs target by weekday (kcal)" unit=" kcal" @select="selected = $event" />
    <p v-if="selected !== null" class="field-help" aria-live="polite"><strong>{{ result.rows[selected].name }}:</strong> {{ details(result.rows[selected]).map((item) => `${item.label} ${item.value}`).join(' · ') }}</p>
    <DataRows v-if="narrow" :rows="rows" label="Weekday patterns" :group-by-month="false" />
    <div v-else class="table-scroll" role="region" aria-label="Weekday patterns" tabindex="0">
      <table class="period-table">
        <thead><tr><th scope="col">Weekday</th><th scope="col">Intake (mean / median)</th><th scope="col">Vs target</th><th scope="col">Balance</th><th scope="col">Steps</th><th scope="col">Scale − trend</th><th scope="col">Above-target share</th><th scope="col">Surplus share</th></tr></thead>
        <tbody>
          <tr v-for="row in result.rows" :key="row.weekday" :class="{ dimmed: !row.targetDifference.sufficient }">
            <th scope="row">{{ row.name }}</th>
            <td>{{ row.intake.sufficient ? `${whole(row.intake.mean)} / ${whole(row.intake.median)}` : `Insufficient (${row.intake.count})` }}</td>
            <td>{{ shown(row.targetDifference, (value) => signed(value)) }}</td><td>{{ shown(row.balance, (value) => signed(value)) }}</td>
            <td>{{ shown(row.steps, (value) => whole(value)) }}</td><td>{{ shown(row.residual, (value) => signed(value, ' lb', 1)) }}</td>
            <td>{{ percent(row.aboveTargetShare) }}</td><td>{{ percent(row.surplusShare) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <h3 class="subheading">Weekend vs weekdays</h3>
    <dl class="calendar-details">
      <div v-for="item in splitRows" :key="item.label"><dt>{{ item.label }}</dt>
        <dd>Sat–Sun {{ shown(item.weekend, item.format) }} ({{ item.weekend.count }}) · Mon–Fri {{ shown(item.weekdays, item.format) }} ({{ item.weekdays.count }})</dd></div>
    </dl>
    <details class="preview-section">
      <summary>How this is calculated</summary>
      <ul class="plain-list formulas">
        <li><strong>Weekday</strong><span>The weekday of each reporting date (America/Denver), Monday first. Device time zones never shift a day.</span></li>
        <li><strong>Means</strong><span>Over eligible days only; a weekday below {{ minimumWeekdayCount }} days of a measure is marked insufficient and not ranked.</span></li>
        <li><strong>Shares</strong><span>Each weekday's Σ max(0, intake − target) over the scope's total, and likewise for gross modeled surplus Σ max(0, intake − expenditure).</span></li>
        <li><strong>Scale − trend</strong><span>Counted scale weigh-in minus MacroFactor's trend weight on days with both.</span></li>
      </ul>
    </details>
  </section>
</template>
