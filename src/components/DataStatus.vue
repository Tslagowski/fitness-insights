<script setup lang="ts">
import { computed } from 'vue';
import type { EligibilityReport, ImportGroup } from '../analysis/eligibility';
import { formatCalendarDate, plural } from '../import/preview';

const props = defineProps<{ report: EligibilityReport }>();

const groups: Array<{ group: ImportGroup; label: string }> = [
  { group: 'daily', label: 'Weight, estimates, targets, steps' },
  { group: 'food', label: 'Food entries' },
  { group: 'workouts', label: 'Workouts' },
];
const counts = computed(() => {
  const days = props.report.days;
  const count = (pick: (day: (typeof days)[number]) => boolean) => days.filter(pick).length;
  return {
    intake: count((day) => day.intake.eligible),
    weight: count((day) => day.weight.eligible),
    workouts: count((day) => day.workouts.eligible),
    pending: props.report.flags.filter((flag) => flag.status === 'pending').length,
    excluded: props.report.flags.filter((flag) => flag.status === 'excluded').length,
    incomplete: props.report.incompleteDates.length,
    unconfirmed: count((day) => !day.intake.eligible && day.intake.reason === 'after-import-cutoff'),
  };
});
function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
</script>

<template>
  <section class="section-card" aria-labelledby="status-heading">
    <div class="section-heading"><div><div class="eyebrow">WHAT COUNTS AS COMPLETE</div><h2 id="status-heading">Data status</h2></div>
      <span class="outline-pill">Today: {{ formatCalendarDate(report.today) }} (in progress)</span></div>
    <p class="field-help">Completed-day analysis uses past days confirmed by an import made after that day. Today is in progress, later dates are planned, and a pre-logged day is not treated as complete just because time has passed.</p>
    <dl class="calendar-details" aria-label="Completed-day cutoffs">
      <div v-for="item in groups" :key="item.group"><dt>{{ item.label }}</dt>
        <dd>{{ report.cutoffs[item.group] ? `complete through ${formatCalendarDate(report.cutoffs[item.group]!)}` : 'not imported yet' }}<template v-if="report.lastImports[item.group]"> · imported {{ formatTimestamp(report.lastImports[item.group]!) }}</template></dd></div>
    </dl>
    <div class="change-summary status-counts" aria-label="Eligible days">
      <div><span class="change-count">{{ counts.intake }}</span><span>completed intake days</span></div>
      <div><span class="change-count">{{ counts.weight }}</span><span>usable weigh-ins</span></div>
      <div><span class="change-count">{{ counts.workouts }}</span><span>completed workout days</span></div>
    </div>
    <ul class="plain-list">
      <li v-if="counts.pending"><span><strong>{{ plural(counts.pending, 'weigh-in') }} waiting for review</strong>; {{ counts.pending === 1 ? 'it is' : 'they are' }} left out of calculations until you keep or exclude {{ counts.pending === 1 ? 'it' : 'them' }}.</span></li>
      <li v-if="counts.excluded"><span>{{ plural(counts.excluded, 'weigh-in') }} excluded by you (still saved).</span></li>
      <li v-if="counts.incomplete"><span>{{ plural(counts.incomplete, 'day') }} marked with incomplete nutrition logging (intake left out; other data still used).</span></li>
      <li v-if="counts.unconfirmed"><span>{{ plural(counts.unconfirmed, 'past day') }} with intake {{ counts.unconfirmed === 1 ? 'is' : 'are' }} waiting for a newer import to confirm {{ counts.unconfirmed === 1 ? 'it' : 'them' }}.</span></li>
      <li v-if="!counts.pending && !counts.excluded && !counts.incomplete"><span>Nothing needs review.</span></li>
    </ul>
  </section>
</template>
