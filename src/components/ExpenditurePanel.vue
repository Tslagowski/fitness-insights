<script setup lang="ts">
import MethodInfo from './MethodInfo.vue';
import { computed, ref } from 'vue';
import type { DailyValues } from '../analysis/daily';
import { analyzePhases } from '../analysis/phases';
import { expenditureMethodVersion, minimumAssociationMonths, monthlyGroups, phaseGroups, stepsAssociation, withReference, type ReferencedGroup } from '../analysis/expenditure';
import { formatCalendarDate, monthDay, plural } from '../import/preview';
import CategoryChart from './CategoryChart.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ days: DailyValues[] }>();
const view = ref<'month' | 'phase'>('month');
const referenceKey = ref<string | null>(null);
const selected = ref<number | null>(null);
const phases = computed(() => analyzePhases(props.days).phases);
const raw = computed(() => (view.value === 'month' ? monthlyGroups(props.days) : phaseGroups(props.days, phases.value)));
const result = computed(() => withReference(raw.value, referenceKey.value));
const association = computed(() => stepsAssociation(monthlyGroups(props.days)));

const monthName = (key: string, short = false) => {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)));
};
const name = (group: ReferencedGroup, short = false) => {
  if (view.value === 'month') return monthName(group.key, short);
  const phase = phases.value.find((item) => item.start === group.start);
  return short ? monthDay(group.start) : `${phase?.plateau ? 'Maintaining (plateau)' : phase?.label ?? 'Phase'} · ${formatCalendarDate(group.start)} – ${formatCalendarDate(group.end)}`;
};
const kcal = (value: number | null) => (value === null ? '—' : `${Math.round(value).toLocaleString('en-US')} kcal`);
const signed = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Math.round(value)).toLocaleString('en-US')} kcal`);
const ratio = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)} kcal/lb`);
const lb = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)} lb`);
const steps = (value: number | null) => (value === null ? '—' : Math.round(value).toLocaleString('en-US'));

const chartSeries = computed(() => [
  { key: 'actual', name: 'Mean expenditure (MacroFactor estimate)', tone: 'violet', values: result.value.groups.map((group) => (group.covered ? group.meanExpenditure : null)) },
  { key: 'implied', name: 'Implied by the reference kcal/lb', tone: 'gray', dashed: true, values: result.value.groups.map((group) => group.implied) },
]);
const covered = computed(() => raw.value.filter((group) => group.covered));
function details(group: ReferencedGroup) {
  return [
    { label: 'Matched days', value: `${group.matched} of ${group.length} (needs ${group.required})` },
    { label: 'Mean expenditure', value: kcal(group.meanExpenditure) },
    { label: 'Mean trend weight', value: lb(group.meanTrend) },
    { label: 'Expenditure per lb', value: ratio(group.kcalPerLb) },
    { label: 'Change vs reference', value: signed(group.expenditureChange) },
    { label: 'Change a constant kcal/lb implies', value: signed(group.impliedChange) },
    { label: 'Actual − implied', value: signed(group.difference) },
    { label: 'Mean steps', value: group.stepsCount ? `${steps(group.meanSteps)} (${plural(group.stepsCount, 'day')})` : '—' },
  ];
}
const narrow = useNarrow();
const rows = computed<DataRow[]>(() => [...result.value.groups].reverse().map((group) => ({
  key: group.key, heading: name(group, view.value === 'phase'), tag: group.covered ? (group.key === result.value.reference?.key ? 'Reference' : undefined) : 'Insufficient coverage',
  primary: group.covered ? ratio(group.kcalPerLb) : `${group.matched} of ${group.required} days`, secondary: group.covered ? `${kcal(group.meanExpenditure)} · gap ${signed(group.difference)}${group.warning ? ' †' : ''}` : undefined,
  dimmed: !group.covered, details: details(group),
})));
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="expenditure-heading">
    <div class="section-heading"><div><div class="eyebrow">CALCULATED FROM MACROFACTOR'S ESTIMATES</div><h2 id="expenditure-heading">Expenditure per pound</h2></div>
      <MethodInfo :label="`Method ${expenditureMethodVersion}`" /></div>
    <p class="field-help">How MacroFactor's expenditure estimate moved relative to its trend weight. "Implied" is what expenditure would be if the reference period's kcal per lb held constant; the gap shows whether expenditure changed more or less than the weight change alone accounts for. Both are calculations from MacroFactor's estimates, not a measured metabolic rate or a diagnosis.</p>
    <div class="insight-controls">
      <div class="segmented" role="group" aria-label="Group by"><button type="button" :aria-pressed="view === 'month'" @click="view = 'month'; referenceKey = null">Months</button><button type="button" :aria-pressed="view === 'phase'" @click="view = 'phase'; referenceKey = null">Phases</button></div>
      <div v-if="covered.length"><label class="field-label" for="expenditure-reference">Reference</label>
        <select id="expenditure-reference" :value="result.reference?.key" @change="referenceKey = ($event.target as HTMLSelectElement).value">
          <option v-for="group in result.groups.filter((item) => item.covered)" :key="group.key" :value="group.key">{{ name(group) }}</option>
        </select></div>
    </div>
    <p v-if="!covered.length" class="field-help">No {{ view === 'month' ? 'month' : 'phase' }} has enough days with both expenditure and trend weight yet (75% of its days).</p>
    <template v-else>
      <CategoryChart kind="line" :zero="false" :labels="result.groups.map((group) => name(group, true))" :series="chartSeries" :selected="selected" title="Mean expenditure vs the constant-ratio value (kcal)" unit=" kcal" @select="selected = $event" />
      <p v-if="selected !== null && result.groups[selected]" class="field-help" aria-live="polite"><strong>{{ name(result.groups[selected]) }}:</strong> {{ details(result.groups[selected]).map((item) => `${item.label} ${item.value}`).join(' · ') }}</p>
      <DataRows v-if="narrow" :rows="rows" label="Expenditure per pound" :group-by-month="false" />
      <div v-else class="table-scroll" role="region" aria-label="Expenditure per pound" tabindex="0">
        <table class="period-table">
          <thead><tr><th scope="col">{{ view === 'month' ? 'Month' : 'Phase' }}</th><th scope="col">Matched days</th><th scope="col">Expenditure</th><th scope="col">Trend</th><th scope="col">kcal/lb</th><th scope="col">Change</th><th scope="col">Implied change</th><th scope="col">Actual − implied</th><th scope="col">Steps</th></tr></thead>
          <tbody>
            <tr v-for="group in [...result.groups].reverse()" :key="group.key" :class="{ dimmed: !group.covered }">
              <th scope="row">{{ name(group) }}{{ group.key === result.reference?.key ? ' (reference)' : '' }}</th>
              <td>{{ group.matched }} / {{ group.length }}</td>
              <template v-if="group.covered"><td>{{ kcal(group.meanExpenditure) }}</td><td>{{ lb(group.meanTrend) }}</td><td>{{ ratio(group.kcalPerLb) }}{{ group.warning ? ' †' : '' }}</td>
                <td>{{ signed(group.expenditureChange) }}</td><td>{{ signed(group.impliedChange) }}</td><td>{{ signed(group.difference) }}</td></template>
              <td v-else colspan="6">Insufficient coverage ({{ group.matched }} of {{ group.required }} days)</td>
              <td>{{ steps(group.meanSteps) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="result.groups.some((group) => group.warning)" class="field-help">† Includes days whose MacroFactor estimates may reflect a questioned weigh-in.</p>
      <p class="field-help"><strong>Expenditure and steps (association):</strong>{{ ' ' }}
        <template v-if="association.kcalPer1000Steps !== null">across {{ association.months }} covered months, months with 1,000 more mean daily steps had {{ signed(association.kcalPer1000Steps) }} mean expenditure (least-squares slope). This describes how the two moved together in this history, not what steps cause.</template>
        <template v-else>needs {{ minimumAssociationMonths }} covered months with steps on most matched days; {{ association.months }} available.</template></p>
    </template>
    <details class="preview-section">
      <summary>How this is calculated</summary>
      <ul class="plain-list formulas">
        <li><strong>Matched days</strong><span>Days where both MacroFactor's expenditure and trend weight are eligible. A month or phase needs 75% of its days matched.</span></li>
        <li><strong>kcal per lb</strong><span>Mean expenditure ÷ mean trend weight over matched days.</span></li>
        <li><strong>Implied</strong><span>Reference kcal per lb × this group's mean trend weight. Actual − implied is positive when expenditure is higher than a constant ratio gives.</span></li>
        <li><strong>Steps association</strong><span>Least-squares slope of monthly mean expenditure on monthly mean steps, × 1,000.</span></li>
      </ul>
    </details>
  </section>
</template>
