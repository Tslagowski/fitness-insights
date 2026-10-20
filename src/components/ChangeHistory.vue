<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NothingToChangeError, StaleRevisionError, type Gateway, type ImportedHistory, type UndoPreview } from '../gateway';
import { describeChange, describeCounts, formatCalendarDate, newRequestId } from '../import/preview';

const props = defineProps<{ gateway: Gateway; history: ImportedHistory; reloadHistory: () => Promise<boolean> }>();

const preview = ref<UndoPreview | null>(null);
const requestId = ref('');
const phase = ref<'idle' | 'checking' | 'confirming' | 'undoing'>('idle');
const problem = ref('');
const outcome = ref('');
const target = computed(() => props.history.imports.find((item) => item.id === props.history.undoTargetId) ?? null);

watch(() => props.history.revisionId, () => { if (phase.value === 'confirming') { preview.value = null; phase.value = 'idle'; } });

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function reviewUndo() {
  problem.value = '';
  outcome.value = '';
  phase.value = 'checking';
  try {
    preview.value = await props.gateway.previewUndo(props.history.revisionId);
    requestId.value = newRequestId();
    phase.value = 'confirming';
  } catch (error) {
    phase.value = 'idle';
    await handleFailure(error, 'Undo could not be prepared. Check your connection and try again.');
  }
}

async function undo() {
  if (!preview.value || phase.value === 'undoing') return;
  phase.value = 'undoing';
  problem.value = '';
  try {
    const result = await props.gateway.undoLastChange({ requestId: requestId.value, expectedRevisionId: props.history.revisionId });
    outcome.value = `Undone: ${describeCounts(result)}. Your history is back to how it was before that change.`;
    preview.value = null;
    phase.value = 'idle';
    await props.reloadHistory();
  } catch (error) {
    phase.value = 'confirming';
    await handleFailure(error, 'Undo was not saved, and your history is unchanged. Check your connection and press Undo again; retrying cannot undo twice.');
  }
}

async function handleFailure(error: unknown, fallback: string) {
  if (error instanceof StaleRevisionError || error instanceof NothingToChangeError) {
    preview.value = null;
    phase.value = 'idle';
    problem.value = 'Your saved history changed (possibly on another device), so nothing was undone. Review the latest changes below and try again.';
    await props.reloadHistory();
  } else {
    problem.value = fallback;
  }
}

function cancel() { preview.value = null; phase.value = 'idle'; }
</script>

<template>
  <section class="section-card" aria-labelledby="history-heading">
    <div class="section-heading"><div><div class="eyebrow">WHAT CHANGED, AND WHEN</div><h2 id="history-heading">Change history</h2></div>
      <span class="outline-pill">Version {{ history.revisionId ?? 'none' }}</span></div>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <div v-if="outcome" class="alert success" role="status">{{ outcome }}</div>

    <div v-if="target" class="undo-box">
      <div><strong>Latest change</strong><span>{{ describeChange(target, history.imports) }} · {{ formatTimestamp(target.committedAt) }}</span></div>
      <button v-if="phase === 'idle' || phase === 'checking'" class="primary-button" type="button" @click="reviewUndo" :disabled="phase === 'checking'">
        {{ phase === 'checking' ? 'Checking...' : 'Undo this change' }}</button>
    </div>
    <p v-else class="field-help">There is nothing to undo.</p>

    <div v-if="preview && (phase === 'confirming' || phase === 'undoing')" class="confirm-box" role="group" aria-label="Confirm undo">
      <p>Undo restores your saved history to exactly how it was before this change: <strong>{{ describeCounts(preview) }}</strong><template v-if="preview.firstDate">, affecting {{ formatCalendarDate(preview.firstDate) }} – {{ formatCalendarDate(preview.lastDate!) }}</template>.
        Nothing is permanently deleted, and earlier versions stay recoverable.</p>
      <div class="form-footer"><button class="text-button" type="button" @click="cancel" :disabled="phase === 'undoing'">Cancel</button>
        <button class="primary-button" type="button" @click="undo" :disabled="phase === 'undoing'">{{ phase === 'undoing' ? 'Undoing...' : 'Confirm undo' }}</button></div>
    </div>

    <ol v-if="history.imports.length" class="change-log" aria-label="Change log">
      <li v-for="item in history.imports" :key="item.id" :class="{ undone: item.undone }">
        <strong>{{ describeChange(item, history.imports) }}</strong>
        <span>{{ formatTimestamp(item.committedAt) }}<template v-if="item.kind === 'workbook' && item.firstDate"> · dates {{ formatCalendarDate(item.firstDate) }} – {{ formatCalendarDate(item.lastDate!) }}</template><template v-if="item.kind === 'undo'"> · {{ describeCounts(item) }}</template><template v-if="item.undone"> · later undone</template></span>
      </li>
    </ol>
  </section>
</template>
