<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Gateway } from '../gateway';
import { capacityLevel, capacitySafetyFraction, formatBytes, type CapacityLevel, type CapacityStatus } from '../backup/capacity';
import { plural } from '../import/preview';

const props = defineProps<{ gateway: Gateway }>();

const status = ref<CapacityStatus | null>(null);
const unreachable = ref(false);
const checking = ref(false);
const cleaning = ref(false);
const notice = ref('');
async function check() {
  checking.value = true;
  notice.value = '';
  try { status.value = await props.gateway.capacity(); unreachable.value = false; }
  catch { unreachable.value = true; }
  finally { checking.value = false; }
}
onMounted(check);

const levelLabels: Record<CapacityLevel, { icon: string; text: string }> = {
  ok: { icon: '✓', text: 'Plenty of room' },
  high: { icon: '!', text: 'Getting full' },
  full: { icon: '✕', text: 'Nearly full: new imports are paused' },
};
const meters = computed(() => status.value ? [
  { id: 'database', label: 'Database', used: status.value.databaseBytes, limit: status.value.databaseLimitBytes },
  { id: 'files', label: 'Original export files', used: status.value.archiveBytes, limit: status.value.archiveLimitBytes },
].map((meter) => ({ ...meter, level: capacityLevel(meter.used, meter.limit), percent: Math.min(100, (meter.used / meter.limit) * 100) })) : []);
const oldest = computed(() => (status.value?.oldestStagingAt ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(status.value.oldestStagingAt)) : ''));

async function cleanUp() {
  cleaning.value = true;
  notice.value = '';
  try {
    const result = await props.gateway.discardStaleRestores();
    await check();
    notice.value = `Removed ${plural(result.removedUploads, 'unfinished restore upload')}. Your saved history was not touched.`;
  } catch { notice.value = 'Nothing was removed; the service could not be reached. Try again later.'; }
  finally { cleaning.value = false; }
}
</script>

<template>
  <section class="section-card service-status" aria-labelledby="service-heading">
    <div class="section-heading"><div><div class="eyebrow">FREE TIER, NO SURPRISES</div><h2 id="service-heading">Service and storage</h2></div>
      <button class="text-button" type="button" :disabled="checking" @click="check">{{ checking ? 'Checking…' : 'Check again' }}</button></div>
    <div v-if="unreachable" class="alert error" role="alert">The service could not be reached, so usage is unknown. Your saved data is not affected. If this continues, see the recovery steps below.</div>
    <template v-else-if="status">
      <div class="meters">
        <div v-for="meter in meters" :key="meter.id" class="meter-row">
          <div class="meter-label"><span>{{ meter.label }}</span><span>{{ formatBytes(meter.used) }} of {{ formatBytes(meter.limit) }}</span></div>
          <div class="meter" role="meter" :aria-label="`${meter.label} usage`" :aria-valuenow="Math.round(meter.percent)" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="`${Math.round(meter.percent)}% used, ${levelLabels[meter.level].text}`">
            <span :class="['meter-fill', meter.level]" :style="{ width: `${Math.max(meter.percent, 1)}%` }"></span>
            <span class="meter-stop" :style="{ left: `${capacitySafetyFraction * 100}%` }" aria-hidden="true"></span>
          </div>
          <span :class="['level-label', meter.level]"><span aria-hidden="true">{{ levelLabels[meter.level].icon }}</span> {{ levelLabels[meter.level].text }} · {{ Math.round(meter.percent) }}% used</span>
        </div>
      </div>
      <p class="field-help">The app stops imports, report saves, and restores at 90% of either limit (the mark on each bar), and the database itself refuses new data at {{ Math.round(status.hardStopFraction * 100) }}%. It never upgrades your plan or removes data on its own.</p>
      <div v-if="status.stagingUploads" class="staging-note" role="group" aria-label="Unfinished restore uploads">
        <p class="field-help">{{ plural(status.stagingUploads, 'unfinished restore upload') }} ({{ formatBytes(status.stagingBytes) }}), the oldest from {{ oldest }}. These are partial uploads from restores that were never applied; removing them does not touch your saved history. Uploads newer than ten minutes are kept in case a restore is still running.</p>
        <button class="primary-button" type="button" :disabled="cleaning" @click="cleanUp">{{ cleaning ? 'Removing…' : 'Remove unfinished uploads' }}</button>
      </div>
    </template>
    <p v-if="notice" class="muted" role="status">{{ notice }}</p>
    <details class="preview-section recovery-guide">
      <summary>Recovery steps</summary>
      <ul class="plain-list">
        <li><strong>The app cannot load or save (service paused)</strong><span>Supabase Free pauses a project after about a week without use. Open the Supabase dashboard, select the fitness-insights project, and choose Restore/Resume. Wait a few minutes, then reload this page. Nothing is lost while it is paused.</span></li>
        <li><strong>The connection dropped during a save</strong><span>Press the same button again. Imports, corrections, undo, report saves, and restores check request ids or the current data version, so a retry never saves twice and never overwrites a newer change from another device.</span></li>
        <li><strong>Storage is getting full</strong><span>Review older versions in Version retention (the latest 12 are always kept), remove unfinished restore uploads here, and download a backup before freeing space. Imports resume once usage is below 90%.</span></li>
        <li><strong>Keeping a copy</strong><span>Download a backup after each import you care about. If the service is unavailable, a backup cannot be downloaded; the last backup file you saved is your copy, and it restores into this or a new installation.</span></li>
      </ul>
    </details>
  </section>
</template>
