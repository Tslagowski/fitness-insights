<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ImportedHistory } from '../gateway';
import { addDays, type EligibilityReport } from '../analysis/eligibility';
import { anchorDate, customWindowProblem, measurementAnchor, resolvePeriod, type WindowChoice } from '../analysis/periods';
import { formatCalendarDate, plural } from '../import/preview';
import IntakeBalance from './IntakeBalance.vue';
import WeightActivity from './WeightActivity.vue';

// One period picker scopes every analysis on the page, so the sections always describe the same dates.
const props = defineProps<{ history: ImportedHistory; report: EligibilityReport }>();

const mode = ref<'7' | '28' | 'custom'>('28');
const anchor = computed(() => anchorDate(props.report) ?? measurementAnchor(props.report));
const defaultEnd = computed(() => anchor.value ?? addDays(props.report.today, -1));
const customStart = ref(addDays(defaultEnd.value, -27));
const customEnd = ref(defaultEnd.value);
const customProblem = computed(() => (mode.value === 'custom' ? customWindowProblem(customStart.value, customEnd.value, props.report.today) : null));
const choice = computed<WindowChoice>(() => (mode.value === 'custom' ? { kind: 'custom', start: customStart.value, end: customEnd.value } : { kind: 'days', length: mode.value === '7' ? 7 : 28 }));
const bounds = computed(() => resolvePeriod(choice.value, anchor.value, props.report.today));
const range = (start: string, end: string) => `${formatCalendarDate(start)} – ${formatCalendarDate(end)}`;
</script>

<template>
  <section class="section-card period-card" aria-labelledby="period-heading">
    <div class="eyebrow">ANALYSIS PERIOD</div>
    <h2 id="period-heading" class="visually-hidden">Analysis period</h2>
    <div class="period-controls">
      <div class="segmented" role="group" aria-label="Period length">
        <button type="button" :aria-pressed="mode === '7'" @click="mode = '7'">7 days</button>
        <button type="button" :aria-pressed="mode === '28'" @click="mode = '28'">28 days</button>
        <button type="button" :aria-pressed="mode === 'custom'" @click="mode = 'custom'">Custom</button>
      </div>
      <div v-if="mode === 'custom'" class="custom-range">
        <div><label class="field-label" for="custom-start">From</label><input id="custom-start" v-model="customStart" type="date" :max="addDays(report.today, -1)" /></div>
        <div><label class="field-label" for="custom-end">Through</label><input id="custom-end" v-model="customEnd" type="date" :max="addDays(report.today, -1)" /></div>
      </div>
    </div>
    <div v-if="customProblem" class="alert error" role="alert">{{ customProblem }}</div>
    <p v-else-if="bounds" id="period-line" class="period-line"><strong>{{ range(bounds.start, bounds.end) }}</strong> ({{ plural(bounds.length, 'day') }}), compared with {{ range(bounds.previousStart, bounds.previousEnd) }}.</p>
    <p v-else class="field-help">No completed past day has been imported yet, so there is no period to analyze.</p>
    <p class="field-help">Dates are America/Denver calendar days. Today is in progress and is never part of a completed period.</p>
  </section>
  <template v-if="!customProblem">
    <IntakeBalance :history="history" :report="report" :choice="choice" />
    <WeightActivity :history="history" :report="report" :choice="choice" />
  </template>
</template>
