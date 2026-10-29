<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Gateway, ImportedHistory, SavedWorkoutDay } from '../gateway';
import type { EligibilityReport } from '../analysis/eligibility';
import { buildDailySeries } from '../analysis/daily';
import { glanceTiles } from '../analysis/glance';
import { formatCalendarDate, plural } from '../import/preview';
import Sparkline from './Sparkline.vue';

// Ticket 28: headline tiles first; every number comes from the same calculations as the detail pages.
const props = defineProps<{ gateway: Gateway; history: ImportedHistory; report: EligibilityReport }>();
const workouts = ref<SavedWorkoutDay[] | null>(null);
async function load() {
  if (!props.history.workoutDays.length) { workouts.value = []; return; }
  try { workouts.value = await props.gateway.loadWorkoutHistory(); } catch { workouts.value = null; }
}
onMounted(load);
watch(() => props.history.revisionId, (now, before) => { if (now !== before) void load(); });

const days = computed(() => buildDailySeries(props.history, props.report, workouts.value));
const tiles = computed(() => glanceTiles(days.value).filter((tile) => tile.id !== 'sets' || props.history.workoutDays.length));
const pending = computed(() => props.report.flags.filter((flag) => flag.status === 'pending').length);
const through = computed(() => days.value.at(-1)?.date ?? null);
function scrollToReview() { document.getElementById('review-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
</script>

<template>
  <section class="glance" aria-labelledby="glance-heading">
    <div class="glance-heading"><h2 id="glance-heading">At a glance</h2><span v-if="through" class="muted">Completed days through {{ formatCalendarDate(through) }}</span></div>
    <button v-if="pending" type="button" class="glance-alert" @click="scrollToReview">{{ plural(pending, 'weigh-in') }} waiting for your review <span aria-hidden="true">→</span></button>
    <div class="glance-grid">
      <a v-for="tile in tiles" :key="tile.id" class="glance-tile" :class="{ empty: tile.value === null }" :href="tile.href" :aria-label="`${tile.label}: ${tile.value ?? 'not enough data'}. ${tile.detail}. ${tile.window}.`">
        <span class="glance-label">{{ tile.label }}</span>
        <span class="glance-value">{{ tile.value ?? '—' }}</span>
        <span class="glance-detail">{{ tile.detail }}</span>
        <Sparkline :values="tile.spark" />
        <span class="glance-window">{{ tile.window }}</span>
      </a>
    </div>
  </section>
</template>
