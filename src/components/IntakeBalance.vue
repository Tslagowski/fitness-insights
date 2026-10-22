<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ImportedHistory } from '../gateway';
import { reasonLabels, type EligibilityReport, type Eligibility } from '../analysis/eligibility';
import { analyzeIntake, anchorDate, intakeMethodVersion, type IntakeDay, type Period, type WindowChoice } from '../analysis/intake';
import { formatCalendarDate, formatShortDate, plural } from '../import/preview';
import IntakeCharts from './IntakeCharts.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ history: ImportedHistory; report: EligibilityReport; choice: WindowChoice }>();

const anchor = computed(() => anchorDate(props.report));
const analysis = computed(() => analyzeIntake(props.history, props.report, props.choice));
const current = computed(() => analysis.value.current);
const previous = computed(() => analysis.value.previous);

const selected = ref<string | null>(null);
watch(current, (period) => {
  if (period && !period.days.some((day) => day.date === selected.value)) selected.value = period.end;
}, { immediate: true });
const selectedDay = computed(() => current.value?.days.find((day) => day.date === selected.value) ?? null);

const kcal = (value: number) => Math.round(value).toLocaleString('en-US');
const signed = (value: number, unit = ' kcal') => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${kcal(Math.abs(value))}${unit}`;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const signedPoints = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.round(Math.abs(value) * 100)} percentage points`;
const range = (period: Period) => `${formatCalendarDate(period.start)} – ${formatCalendarDate(period.end)}`;

interface Tile { label: string; value: string; detail: string; comparison: string }

function tiles(kind: 'intake' | 'balance'): Tile[] {
  const period = current.value;
  const before = previous.value;
  if (!period || !before) return [];
  const covered = kind === 'intake' ? period.intakeCovered : period.balanceCovered;
  const count = kind === 'intake' ? period.intake.count : period.balance.count;
  const previousCovered = kind === 'intake' ? before.intakeCovered : before.balanceCovered;
  const insufficient = `Insufficient coverage`;
  const shortBy = `${count} of ${period.required} required ${kind === 'intake' ? 'eligible' : 'matched'} days`;
  const noComparison = previousCovered ? '' : `No comparison: the previous period (${range(before)}) has insufficient coverage.`;
  const compare = (shift: number | null | undefined, format: (value: number) => string, prior: string) =>
    !covered ? 'No comparison shown below the coverage threshold.' : shift === null || shift === undefined ? noComparison || 'No comparison available.' : `${format(shift)} vs previous period (${prior})`;
  if (kind === 'intake') {
    const shift = analysis.value.intakeShift;
    const stats = period.intake;
    return [
      { label: 'Mean intake', value: covered && stats.mean !== null ? `${kcal(stats.mean)} kcal` : insufficient, detail: covered ? plural(stats.count, 'eligible day') : shortBy,
        comparison: compare(shift?.mean, signed, before.intake.mean === null ? '—' : `${kcal(before.intake.mean)} kcal`) },
      { label: 'Median intake', value: covered && stats.median !== null ? `${kcal(stats.median)} kcal` : insufficient, detail: covered ? plural(stats.count, 'eligible day') : shortBy,
        comparison: compare(shift?.median, signed, before.intake.median === null ? '—' : `${kcal(before.intake.median)} kcal`) },
      { label: 'Day-to-day variability', value: covered && stats.sd !== null ? `${kcal(stats.sd)} kcal` : insufficient, detail: covered ? 'Population standard deviation' : shortBy,
        comparison: compare(shift?.sd, signed, before.intake.sd === null ? '—' : `${kcal(before.intake.sd)} kcal`) },
      { label: 'Mean difference from target', value: !covered ? insufficient : period.target.meanDifference === null ? 'No targets recorded' : signed(period.target.meanDifference),
        detail: covered ? `${plural(period.target.count, 'day')} with a target` : shortBy,
        comparison: compare(shift?.targetDifference, signed, before.target.meanDifference === null ? '—' : signed(before.target.meanDifference)) },
    ];
  }
  const shift = analysis.value.balanceShift;
  const stats = period.balance;
  return [
    { label: 'Net modeled balance', value: covered ? signed(stats.net) : insufficient, detail: covered ? `Sum over ${plural(stats.count, 'matched day')}` : shortBy,
      comparison: compare(shift?.net, signed, signed(before.balance.net)) },
    { label: 'Modeled surplus days', value: covered && stats.surplusFrequency !== null ? percent(stats.surplusFrequency) : insufficient,
      detail: covered ? `${stats.surplusDays} of ${plural(stats.count, 'matched day')}` : shortBy,
      comparison: compare(shift?.surplusFrequency, signedPoints, before.balance.surplusFrequency === null ? '—' : percent(before.balance.surplusFrequency)) },
    { label: 'Gross modeled surplus', value: covered ? `${kcal(stats.grossSurplus)} kcal` : insufficient, detail: covered ? `Across ${plural(stats.surplusDays, 'surplus day')}` : shortBy,
      comparison: compare(shift?.grossSurplus, signed, `${kcal(before.balance.grossSurplus)} kcal`) },
    { label: 'Gross modeled deficit', value: covered ? `${kcal(stats.grossDeficit)} kcal` : insufficient, detail: covered ? `Across ${plural(stats.deficitDays, 'deficit day')}` : shortBy,
      comparison: compare(shift?.grossDeficit, signed, `${kcal(before.balance.grossDeficit)} kcal`) },
    { label: 'Surplus ÷ deficit', value: !covered ? insufficient : stats.ratio === null ? 'Unavailable' : percent(stats.ratio),
      detail: !covered ? shortBy : stats.ratio === null ? 'No modeled deficit in this period, so the ratio is undefined.' : 'Gross surplus as a share of gross deficit',
      comparison: !covered ? 'No comparison shown below the coverage threshold.' : '' },
  ];
}
const intakeTiles = computed(() => tiles('intake'));
const balanceTiles = computed(() => tiles('balance'));

const statusText = (status: Eligibility, value: number | null) => (value === null && (status.eligible || status.reason === 'not-recorded') ? 'Not recorded'
  : status.eligible ? 'Counted' : reasonLabels[status.reason]);
const sourceText = (day: IntakeDay) => (day.intakeSource === 'detail' ? 'food entries' : day.intakeSource === 'workbook' ? 'workbook total' : '—');
const leftOut = computed(() => {
  const period = current.value;
  if (!period) return [];
  const counts = new Map<string, number>();
  for (const day of period.days) {
    if (day.intakeIncluded) continue;
    const label = statusText(day.intakeStatus, day.intake);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => `${plural(count, 'day')}: ${label.toLowerCase()}`);
});
const freshness = computed(() => {
  const { cutoffs } = props.report;
  const parts = [cutoffs.food ? `food entries complete through ${formatCalendarDate(cutoffs.food)}` : '', cutoffs.daily ? `workbook data complete through ${formatCalendarDate(cutoffs.daily)}` : ''].filter(Boolean);
  return parts.join('; ');
});

const narrow = useNarrow();
const dateRows = computed<DataRow[]>(() => [...(current.value?.days ?? [])].reverse().map((day) => {
  const status = statusText(day.intakeStatus, day.intake);
  return {
    key: day.date, date: day.date, heading: formatShortDate(day.date), tag: status === 'Counted' ? undefined : status, dimmed: !day.intakeIncluded,
    primary: day.intake === null ? '—' : `${kcal(day.intake)} kcal`,
    secondary: `balance ${day.balance === null ? '—' : signed(day.balance, '')} · expenditure ${day.expenditure === null ? '—' : kcal(day.expenditure)}${day.expenditure !== null && !day.expenditureStatus.eligible ? ' (not counted)' : ''} · target ${day.target === null ? '—' : kcal(day.target)} · ${sourceText(day)}`,
  };
}));
</script>

<template>
  <section class="section-card intake-balance" aria-labelledby="intake-heading">
    <div class="section-heading"><div><div class="eyebrow">COMPLETED DAYS ONLY</div><h2 id="intake-heading">Intake and modeled energy balance</h2></div>
      <span class="outline-pill">Method {{ intakeMethodVersion }}</span></div>

    <p v-if="!current" class="field-help">There is no completed past day with imported intake yet, so there is no period to analyze. Import food entries or a workbook made after the days you want to include.</p>

    <template v-else-if="current && previous">
      <p class="field-help">
        <template v-if="choice.kind === 'days'">Ends at the latest past day with imported intake ({{ anchor ? formatCalendarDate(anchor) : '—' }}). </template>
        <template v-if="freshness">Freshness: {{ freshness }}. </template>
        Headline values need {{ current.required }} of {{ current.length }} days in each period{{ current.length !== 7 && current.length !== 28 ? ' (75% of the period, rounded up)' : '' }}.
      </p>
      <ul class="coverage-chips" aria-label="Coverage">
        <li :class="{ short: !current.intakeCovered }"><strong>{{ current.intake.count }}</strong> of {{ current.length }} days with counted intake<span v-if="!current.intakeCovered"> · Insufficient coverage</span></li>
        <li :class="{ short: !current.balanceCovered }"><strong>{{ current.balance.count }}</strong> matched intake + expenditure days<span v-if="!current.balanceCovered"> · Insufficient coverage</span></li>
        <li>Previous period: {{ previous.intake.count }} intake, {{ previous.balance.count }} matched</li>
      </ul>
      <p class="field-help source-line">Intake source: food entries on {{ plural(current.intake.sources.detail, 'day') }}, workbook daily totals on {{ plural(current.intake.sources.workbook, 'day') }} (never added together).
        <template v-if="leftOut.length">Left out of this period: {{ leftOut.join('; ') }}.</template> High-intake days are always kept.</p>

      <h3 class="metric-group-title">Intake distribution</h3>
      <div class="metric-grid" aria-label="Intake metrics">
        <article v-for="tile in intakeTiles" :key="tile.label" class="metric-tile" :class="{ insufficient: tile.value === 'Insufficient coverage' }">
          <h4>{{ tile.label }}</h4><p class="metric-value">{{ tile.value }}</p><p class="metric-detail">{{ tile.detail }}</p><p v-if="tile.comparison" class="metric-comparison">{{ tile.comparison }}</p>
        </article>
      </div>
      <h3 class="metric-group-title">Modeled balance <span class="muted">(intake − MacroFactor's expenditure estimate)</span></h3>
      <div class="metric-grid" aria-label="Modeled balance metrics">
        <article v-for="tile in balanceTiles" :key="tile.label" class="metric-tile" :class="{ insufficient: tile.value === 'Insufficient coverage' }">
          <h4>{{ tile.label }}</h4><p class="metric-value">{{ tile.value }}</p><p class="metric-detail">{{ tile.detail }}</p><p v-if="tile.comparison" class="metric-comparison">{{ tile.comparison }}</p>
        </article>
      </div>
      <p class="field-help estimate-note">Modeled balance is an estimate built from logged intake and MacroFactor's expenditure estimate. It is not measured fat or weight change, and differences between periods are not explained causes.</p>

      <IntakeCharts :days="current.days" :selected="selected" @select="selected = $event" />

      <div id="selected-day" class="selected-day" aria-live="polite" aria-label="Selected day">
        <template v-if="selectedDay">
          <h3>{{ formatCalendarDate(selectedDay.date, { weekday: true }) }}</h3>
          <dl class="calendar-details">
            <div><dt>Intake</dt><dd>{{ selectedDay.intake === null ? '—' : `${kcal(selectedDay.intake)} kcal` }} · {{ sourceText(selectedDay) }} · {{ statusText(selectedDay.intakeStatus, selectedDay.intake) }}</dd></div>
            <div><dt>Expenditure (estimate)</dt><dd>{{ selectedDay.expenditure === null ? '—' : `${kcal(selectedDay.expenditure)} kcal` }} · {{ statusText(selectedDay.expenditureStatus, selectedDay.expenditure) }}</dd></div>
            <div><dt>Target</dt><dd>{{ selectedDay.target === null ? 'Not recorded' : `${kcal(selectedDay.target)} kcal` }}</dd></div>
            <div><dt>Modeled balance</dt><dd>{{ selectedDay.balance === null ? 'Not calculated: needs counted intake and an expenditure estimate on the same day'
              : `${kcal(selectedDay.intake!)} − ${kcal(selectedDay.expenditure!)} = ${signed(selectedDay.balance)} (${selectedDay.balance > 0 ? 'surplus' : selectedDay.balance < 0 ? 'deficit' : 'even'})` }}</dd></div>
            <div><dt>Versus target</dt><dd>{{ selectedDay.targetDifference === null ? 'Not calculated' : `${kcal(selectedDay.intake!)} − ${kcal(selectedDay.target!)} = ${signed(selectedDay.targetDifference)}` }}</dd></div>
          </dl>
        </template>
      </div>

      <details class="preview-section">
        <summary>Dates behind these numbers ({{ current.days.length }})</summary>
        <DataRows v-if="narrow" :rows="dateRows" label="Dates behind these numbers" :selected="selected" @select="selected = $event" />
        <div v-else class="table-scroll" role="region" aria-label="Dates behind these numbers" tabindex="0">
          <table class="period-table">
            <caption class="visually-hidden">Every date in {{ range(current) }} and whether it was counted</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Intake (kcal)</th><th scope="col">Source</th><th scope="col">Intake status</th><th scope="col">Expenditure (kcal)</th><th scope="col">Balance (kcal)</th><th scope="col">Target (kcal)</th></tr></thead>
            <tbody>
              <tr v-for="day in [...current.days].reverse()" :key="day.date" :class="{ 'is-selected': day.date === selected }">
                <th scope="row"><button class="text-button" type="button" :aria-pressed="day.date === selected" @click="selected = day.date">{{ formatCalendarDate(day.date, { weekday: true }) }}</button></th>
                <td>{{ day.intake === null ? '—' : kcal(day.intake) }}</td><td class="source-cell">{{ sourceText(day) }}</td>
                <td class="source-cell">{{ statusText(day.intakeStatus, day.intake) }}</td>
                <td>{{ day.expenditure === null ? '—' : kcal(day.expenditure) }}{{ day.expenditure !== null && !day.expenditureStatus.eligible ? ' (not counted)' : '' }}</td>
                <td>{{ day.balance === null ? '—' : signed(day.balance, '') }}</td><td>{{ day.target === null ? '—' : kcal(day.target) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <details class="preview-section">
        <summary>How these are calculated</summary>
        <ul class="plain-list formulas">
          <li><strong>Counted intake days</strong><span>Completed past days with imported intake, confirmed by a later import, not marked incomplete. Food entries are used when present, otherwise the workbook daily total.</span></li>
          <li><strong>Mean intake</strong><span>Sum of counted intake ÷ number of counted days.</span></li>
          <li><strong>Median intake</strong><span>Middle counted value (average of the two middle values for an even count).</span></li>
          <li><strong>Day-to-day variability</strong><span>Population standard deviation: √(Σ(intake − mean)² ÷ days).</span></li>
          <li><strong>Mean difference from target</strong><span>Mean of (intake − target) on counted days that have a target.</span></li>
          <li><strong>Daily modeled balance</strong><span>Intake − expenditure estimate, only on days where both are counted ("matched days"). Positive is a modeled surplus, negative a modeled deficit.</span></li>
          <li><strong>Gross surplus / deficit</strong><span>Σ max(intake − expenditure, 0) and Σ max(expenditure − intake, 0).</span></li>
          <li><strong>Net modeled balance</strong><span>Gross surplus − gross deficit.</span></li>
          <li><strong>Modeled surplus days</strong><span>Days with a positive balance ÷ matched days.</span></li>
          <li><strong>Surplus ÷ deficit</strong><span>Gross surplus ÷ gross deficit, only when the gross deficit is above zero. It can exceed 100%.</span></li>
          <li><strong>Coverage</strong><span>Each period needs 5 of 7 or 21 of 28 days (other lengths: 75% rounded up): counted intake days for intake metrics, matched days for balance metrics. Comparisons need both periods to pass. These are product heuristics, not statistical confidence.</span></li>
        </ul>
      </details>
    </template>
  </section>
</template>
