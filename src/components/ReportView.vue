<script setup lang="ts">
import type { Evidence, FindingKind, WrittenReport } from '../analysis/report';
import { formatCalendarDate } from '../import/preview';

// Renders a written report exactly as given: the live overview and saved snapshots use the same view.
defineProps<{ report: WrittenReport; headingLevel?: 'h3' | 'h4' }>();

const kindLabels: Record<FindingKind, string> = { observation: 'Calculated from your records', 'source-estimate': 'Uses a MacroFactor estimate', unavailable: 'Unavailable' };
const pageLabels = { nutrition: 'Nutrition & Weight', training: 'Training', settings: 'Imports & Settings' } as const;
function evidenceRows(evidence: Evidence): Array<[string, string]> {
  const rows: Array<[string, string]> = [['Method', evidence.method]];
  if (evidence.window) rows.push(['Period', `${formatCalendarDate(evidence.window.start)} – ${formatCalendarDate(evidence.window.end)} vs ${formatCalendarDate(evidence.window.previousStart)} – ${formatCalendarDate(evidence.window.previousEnd)}`]);
  for (const [key, value] of Object.entries(evidence.counts ?? {})) rows.push([key, String(value)]);
  for (const [key, value] of Object.entries(evidence.values ?? {})) rows.push([/^\d{4}-\d{2}-\d{2}$/.test(key) ? formatCalendarDate(key) : key, value === null ? 'not available' : String(value)]);
  if (evidence.dates?.length) rows.push(['Dates', evidence.dates.map((date) => formatCalendarDate(date)).join(', ')]);
  return rows;
}
</script>

<template>
  <div class="report-view">
    <section v-for="section in report.sections" :key="section.id" class="report-section" :aria-label="section.title">
      <component :is="headingLevel ?? 'h3'" class="report-section-title">{{ section.title }}</component>
      <article v-for="finding in section.findings" :key="finding.id" class="finding" :class="`finding-${finding.kind}`">
        <span class="finding-kind">{{ kindLabels[finding.kind] }}</span>
        <p>{{ finding.text }}</p>
        <details class="finding-evidence">
          <summary>Evidence</summary>
          <dl><div v-for="[key, value] in evidenceRows(finding.evidence)" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl>
        </details>
      </article>
      <a class="text-button report-link" :href="`#${section.page}`">Open {{ pageLabels[section.page] }}</a>
    </section>
  </div>
</template>
