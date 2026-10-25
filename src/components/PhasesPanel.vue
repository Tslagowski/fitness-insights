<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DailyValues } from '../analysis/daily';
import { analyzePhases, phasesMethodVersion, type Phase, type MeasureSummary } from '../analysis/phases';
import { formatCalendarDate, monthDay, plural } from '../import/preview';
import type { OwnerNote } from '../analysis/notes';
import TimelineChart, { type TimelineBand } from './TimelineChart.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ days: DailyValues[]; notes: OwnerNote[] }>();
const analysis = computed(() => analyzePhases(props.days));
const phases = computed(() => [...analysis.value.phases].reverse());
const selectedKey = ref<string | null>(null);
watch(phases, (list) => { if (!list.some((phase) => phase.start === selectedKey.value)) selectedKey.value = list[0]?.start ?? null; }, { immediate: true });
const selected = computed(() => analysis.value.phases.find((phase) => phase.start === selectedKey.value) ?? null);

const lb = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)} lb`);
const signed = (value: number | null, digits = 0, unit = '') => (value === null ? '—'
  : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`);
const whole = (value: number | null, unit = '') => (value === null ? '—' : `${Math.round(value).toLocaleString('en-US')}${unit}`);
const rate = (value: number | null) => signed(value, 2, ' lb/week');
const range = (phase: { start: string; end: string }) => `${formatCalendarDate(phase.start)} – ${formatCalendarDate(phase.end)}`;
const gated = (measure: MeasureSummary, format: (value: number | null) => string, required: number) =>
  measure.covered ? `${format(measure.mean)} (${measure.count} days)` : `Insufficient coverage (${measure.count} of ${required} days)`;
const labelText = (phase: Phase) => (phase.plateau ? 'Maintaining (plateau)' : phase.label);

const bands = computed<TimelineBand[]>(() => analysis.value.phases.map((phase) => ({ key: phase.start, start: phase.start, end: phase.end, tone: phase.label.toLowerCase(), label: labelText(phase) })));
const points = computed(() => props.days.map((day) => ({ date: day.date, value: day.trend })));

function evidence(phase: Phase) {
  return [
    { label: 'Dates', value: `${range(phase)} (${plural(phase.length, 'day')})` },
    { label: 'Trend weight', value: `${lb(phase.startTrend)} → ${lb(phase.endTrend)}` },
    { label: 'Rate over the phase', value: rate(phase.rate) },
    { label: 'Mean intake', value: gated(phase.intake, (value) => whole(value, ' kcal'), phase.required) },
    { label: 'Mean modeled balance', value: gated(phase.balance, (value) => signed(value, 0, ' kcal'), phase.required) },
    { label: 'Mean vs target', value: gated(phase.targetDifference, (value) => signed(value, 0, ' kcal'), phase.required) },
    { label: 'Mean steps', value: gated(phase.steps, (value) => whole(value), phase.required) },
    { label: 'Mean protein', value: gated(phase.protein, (value) => whole(value, ' g'), phase.required) },
    { label: 'Working sets per week', value: phase.weeklySets.covered ? `${phase.weeklySets.mean!.toFixed(1)} (${phase.weeklySets.count} confirmed days)` : `Insufficient coverage (${phase.weeklySets.count} of ${phase.required} confirmed workout days)` },
  ];
}
const narrow = useNarrow();
const rows = computed<DataRow[]>(() => phases.value.map((phase) => ({
  key: phase.start, date: phase.start, heading: `${monthDay(phase.start)} – ${monthDay(phase.end)}`, tag: labelText(phase),
  primary: rate(phase.rate), secondary: `${plural(phase.length, 'day')} · ${lb(phase.startTrend)} → ${lb(phase.endTrend)}${phase.warning ? ' †' : ''}`, details: evidence(phase),
})));
const settings = computed(() => analysis.value.settings);
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="phases-heading">
    <div class="section-heading"><div><div class="eyebrow">FROM MACROFACTOR'S TREND WEIGHT</div><h2 id="phases-heading">Weight phases</h2></div>
      <span class="outline-pill">Method {{ phasesMethodVersion }}</span></div>
    <p v-if="!analysis.phases.length" class="field-help">No phase is long enough to label yet. A phase needs {{ settings.minimumDays }} consecutive days with a rolling rate, and each rate needs {{ settings.minimumPoints }} trend values in its {{ settings.windowDays }}-day window.</p>
    <template v-else>
      <p class="field-help">History splits into {{ plural(analysis.phases.length, 'phase') }} by the rate of MacroFactor's trend weight. A plateau is a Maintaining phase: the trend line's rate stayed inside ±{{ settings.gainingAtOrAbove }} lb/week. It describes the trend line only, not your metabolism.</p>
      <TimelineChart :points="points" :bands="bands" :notes="notes" :selected="selectedKey" title="Trend weight with phases (lb)" value-label="Trend weight (MacroFactor estimate)" @select="selectedKey = $event" />
      <div v-if="selected" class="selected-day" aria-live="polite" aria-label="Selected phase">
        <h3>{{ labelText(selected) }} · {{ range(selected) }}</h3>
        <dl class="calendar-details"><div v-for="item in evidence(selected)" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div></dl>
        <p v-if="selected.warning" class="field-help">† Some trend values in this phase may reflect a questioned weigh-in.</p>
      </div>
      <details class="preview-section" open>
        <summary>Phases ({{ analysis.phases.length }})</summary>
        <DataRows v-if="narrow" :rows="rows" label="Weight phases" :group-by-month="false" :selected="selectedKey" @select="selectedKey = $event" />
        <div v-else class="table-scroll" role="region" aria-label="Weight phases" tabindex="0">
          <table class="period-table">
            <thead><tr><th scope="col">Phase</th><th scope="col">Dates</th><th scope="col">Rate</th><th scope="col">Trend</th><th scope="col">Intake</th><th scope="col">Balance</th><th scope="col">Vs target</th><th scope="col">Steps</th><th scope="col">Protein</th><th scope="col">Sets/wk</th></tr></thead>
            <tbody>
              <tr v-for="phase in phases" :key="phase.start" :class="{ 'is-selected': phase.start === selectedKey }">
                <th scope="row"><button class="text-button" type="button" :aria-pressed="phase.start === selectedKey" @click="selectedKey = phase.start">{{ labelText(phase) }}</button></th>
                <td>{{ range(phase) }} ({{ phase.length }}d)</td><td>{{ rate(phase.rate) }}</td><td>{{ lb(phase.startTrend) }} → {{ lb(phase.endTrend) }}{{ phase.warning ? ' †' : '' }}</td>
                <td>{{ phase.intake.covered ? whole(phase.intake.mean) : 'Insufficient' }}</td><td>{{ phase.balance.covered ? signed(phase.balance.mean) : 'Insufficient' }}</td>
                <td>{{ phase.targetDifference.covered ? signed(phase.targetDifference.mean) : 'Insufficient' }}</td><td>{{ phase.steps.covered ? whole(phase.steps.mean) : 'Insufficient' }}</td>
                <td>{{ phase.protein.covered ? whole(phase.protein.mean, ' g') : 'Insufficient' }}</td><td>{{ phase.weeklySets.covered ? phase.weeklySets.mean!.toFixed(1) : 'Insufficient' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <p v-if="analysis.shortRuns.length" class="field-help">Too short to label ({{ analysis.shortRuns.length }}): {{ analysis.shortRuns.map((run) => `${run.label.toLowerCase()} ${formatCalendarDate(run.start)} – ${formatCalendarDate(run.end)}`).join('; ') }}.</p>
    </template>
    <details class="preview-section">
      <summary>How phases are found</summary>
      <ul class="plain-list formulas">
        <li><strong>Rolling rate</strong><span>For each date with a trend value: 7 × the least-squares slope of the trend values in the trailing {{ settings.windowDays }} calendar days, when at least {{ settings.minimumPoints }} are present. Missing days are never filled in, so a gap ends a phase.</span></li>
        <li><strong>Bands</strong><span>Losing at or below {{ settings.losingAtOrBelow }} lb/week; Slowing at or below {{ settings.slowingAtOrBelow }}; Gaining at or above +{{ settings.gainingAtOrAbove }}; otherwise Maintaining.</span></li>
        <li><strong>Phases</strong><span>Consecutive days with the same band. A run shorter than {{ settings.minimumDays }} days between two runs of the same band takes their band; other short runs are listed as too short to label.</span></li>
        <li><strong>Summaries</strong><span>Each measure uses eligible days only and needs 75% of the phase's days (5 of 7, 21 of 28) before its mean is shown. Working sets per week count non-warm-up sets over dates confirmed by a workout import.</span></li>
      </ul>
      <p class="field-help">{{ analysis.unrated }} dates with a trend value have too few values in their window for a rate.</p>
    </details>
  </section>
</template>
