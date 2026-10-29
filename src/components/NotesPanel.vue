<script setup lang="ts">
import MethodInfo from './MethodInfo.vue';
import { computed, ref, watch } from 'vue';
import type { Gateway } from '../gateway';
import type { DailyValues } from '../analysis/daily';
import { compareAroundNote, latestNotes, noteCategories, noteCompareMethodVersion, noteWindowLengths, type NoteCategory, type NoteVersion, type OwnerNote, type RangeSummary } from '../analysis/notes';
import type { MeasureSummary } from '../analysis/phases';
import { formatCalendarDate, plural } from '../import/preview';
import TimelineChart, { type TimelineBand } from './TimelineChart.vue';
import DataRows, { type DataRow } from './DataRows.vue';
import { useNarrow } from './use-narrow';

const props = defineProps<{ gateway: Gateway; days: DailyValues[]; versions: NoteVersion[]; problem: string }>();
const emit = defineEmits<{ saved: [version: NoteVersion] }>();
const notes = computed(() => latestNotes(props.versions));
const history = (id: string) => props.versions.filter((version) => version.id === id).sort((left, right) => right.version - left.version);

// Form (new note or edit).
const editing = ref<OwnerNote | null>(null);
const startDate = ref('');
const endDate = ref('');
const text = ref('');
const category = ref<NoteCategory | ''>('');
const saving = ref(false);
const formProblem = ref('');
const formStatus = ref('');
function edit(note: OwnerNote | null) {
  editing.value = note;
  startDate.value = note?.startDate ?? '';
  endDate.value = note && note.endDate !== note.startDate ? note.endDate : '';
  text.value = note?.text ?? '';
  category.value = note?.category ?? '';
  formProblem.value = '';
}
const nextVersion = (id: string) => Math.max(0, ...history(id).map((version) => version.version)) + 1;
async function write(draft: Omit<NoteVersion, 'updatedAt'>, done: string) {
  saving.value = true;
  formProblem.value = '';
  formStatus.value = '';
  try {
    emit('saved', await props.gateway.saveNote(draft));
    formStatus.value = done;
    return true;
  } catch {
    formProblem.value = 'The note was not saved. Check your connection and try again; nothing was changed.';
    return false;
  } finally { saving.value = false; }
}
async function submit() {
  const start = startDate.value;
  const end = endDate.value || start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { formProblem.value = 'Choose the date the note is about.'; return; }
  if (end < start) { formProblem.value = 'The end date must be on or after the start date.'; return; }
  if (!text.value.trim()) { formProblem.value = 'Write a short note.'; return; }
  const id = editing.value?.id ?? globalThis.crypto.randomUUID();
  const ok = await write({ id, version: editing.value ? nextVersion(id) : 1, startDate: start, endDate: end, text: text.value.trim().slice(0, 280), category: category.value || null, removed: false },
    editing.value ? 'Note updated; its earlier version is kept in its history.' : 'Note saved.');
  if (ok) { selectedId.value = id; edit(null); }
}
async function remove(note: OwnerNote) {
  await write({ ...note, version: nextVersion(note.id), removed: true }, 'Note removed; its versions stay in your backup history.');
}

// Before/after comparison.
const selectedId = ref<string | null>(null);
watch(notes, (list) => { if (!list.some((note) => note.id === selectedId.value)) selectedId.value = list.at(-1)?.id ?? null; }, { immediate: true });
const selected = computed(() => notes.value.find((note) => note.id === selectedId.value) ?? null);
const length = ref<number>(28);
const comparison = computed(() => (selected.value && props.days.length ? compareAroundNote(props.days, selected.value, length.value) : null));
const signed = (value: number, digits = 0) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const whole = (value: number) => Math.round(value).toLocaleString('en-US');
const gated = (measure: MeasureSummary, format: (value: number) => string, required: number) => (measure.covered ? `${format(measure.mean!)} (${measure.count}d)` : `Insufficient (${measure.count} of ${required}d)`);
const measures: Array<{ key: string; label: string; value: (range: RangeSummary) => string }> = [
  { key: 'rate', label: 'Trend rate (lb/week)', value: (range) => (range.trend.covered && range.rate !== null ? `${signed(range.rate, 2)} (${range.trend.count}d)` : `Insufficient (${range.trend.count} of ${range.required}d)`) },
  { key: 'intake', label: 'Mean intake (kcal)', value: (range) => gated(range.intake, whole, range.required) },
  { key: 'balance', label: 'Modeled balance (kcal)', value: (range) => gated(range.balance, (value) => signed(value), range.required) },
  { key: 'target', label: 'Vs target (kcal)', value: (range) => gated(range.targetDifference, (value) => signed(value), range.required) },
  { key: 'protein', label: 'Mean protein (g)', value: (range) => gated(range.protein, whole, range.required) },
  { key: 'steps', label: 'Mean steps', value: (range) => gated(range.steps, whole, range.required) },
  { key: 'sets', label: 'Working sets per week', value: (range) => (range.weeklySets.covered ? `${range.weeklySets.mean!.toFixed(1)} (${range.weeklySets.count}d)` : `Insufficient (${range.weeklySets.count} of ${range.required}d)`) },
];
const windowLabel = (range: RangeSummary) => `${formatCalendarDate(range.start)} – ${formatCalendarDate(range.end)}`;
const narrow = useNarrow();
const rows = computed<DataRow[]>(() => (comparison.value ? measures.map((measure) => ({
  key: measure.key, heading: measure.label, primary: `${measure.value(comparison.value!.before).split(' (')[0]} → ${measure.value(comparison.value!.after).split(' (')[0]}`,
  details: [{ label: 'Before', value: measure.value(comparison.value!.before) }, ...(comparison.value!.during ? [{ label: 'During', value: measure.value(comparison.value!.during) }] : []),
    { label: 'After', value: measure.value(comparison.value!.after) }],
})) : []));
const points = computed(() => props.days.map((day) => ({ date: day.date, value: day.trend })));
const bands = computed<TimelineBand[]>(() => (comparison.value ? [
  { key: 'before', start: comparison.value.before.start, end: comparison.value.before.end, tone: 'before', label: 'Before window' },
  { key: 'after', start: comparison.value.after.start, end: [comparison.value.after.end, props.days.at(-1)!.date].sort()[0], tone: 'after', label: 'After window' },
] : []));
const when = (note: OwnerNote) => (note.endDate === note.startDate ? formatCalendarDate(note.startDate) : `${formatCalendarDate(note.startDate)} – ${formatCalendarDate(note.endDate)}`);
</script>

<template>
  <section class="section-card insight-card" aria-labelledby="notes-heading">
    <div class="section-heading"><div><div class="eyebrow">PRIVATE, VERSIONED, BACKED UP</div><h2 id="notes-heading">Dated notes</h2></div>
      <MethodInfo :label="`Method ${noteCompareMethodVersion}`" /></div>
    <p class="field-help">Note what changed on a date or across a few dates (a new program, travel, an illness). Notes appear as markers on the weight-phase timeline, and any note can be compared before and after with equal-length windows.</p>
    <div v-if="problem" class="alert error" role="alert">{{ problem }}</div>
    <form class="note-form" aria-label="Note" @submit.prevent="submit">
      <h3 class="subheading">{{ editing ? `Edit note (version ${nextVersion(editing.id)})` : 'Add a note' }}</h3>
      <div class="note-fields">
        <label class="field-label" for="note-start">Date</label>
        <input id="note-start" v-model="startDate" class="text-input" type="date" :disabled="saving" />
        <label class="field-label" for="note-end">End date (optional)</label>
        <input id="note-end" v-model="endDate" class="text-input" type="date" :min="startDate" :disabled="saving" />
        <label class="field-label" for="note-category">Category (optional)</label>
        <select id="note-category" v-model="category" :disabled="saving"><option value="">None</option><option v-for="item in noteCategories" :key="item" :value="item">{{ item }}</option></select>
        <label class="field-label" for="note-text">Note</label>
        <textarea id="note-text" v-model="text" class="text-input" maxlength="280" rows="2" :disabled="saving" placeholder="For example: started a 4-day upper/lower program"></textarea>
      </div>
      <div class="form-footer"><span class="muted">{{ text.length }} / 280</span>
        <button v-if="editing" class="text-button" type="button" @click="edit(null)">Cancel</button>
        <button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save new version' : 'Save note' }}</button></div>
      <div v-if="formProblem" class="alert error" role="alert">{{ formProblem }}</div>
      <p v-else-if="formStatus" class="muted" role="status">{{ formStatus }}</p>
    </form>
    <h3 class="subheading">Your notes ({{ notes.length }})</h3>
    <p v-if="!notes.length" class="field-help">No notes yet.</p>
    <ul v-else class="plain-list note-list" aria-label="Your notes">
      <li v-for="note in [...notes].reverse()" :key="note.id" :class="{ 'is-selected': note.id === selectedId }">
        <button class="text-button note-select" type="button" :aria-pressed="note.id === selectedId" @click="selectedId = note.id"><strong>{{ when(note) }}</strong><span v-if="note.category" class="row-status">{{ note.category }}</span></button>
        <p>{{ note.text }}</p>
        <div class="note-actions">
          <button class="text-button" type="button" :disabled="saving" @click="edit(note)">Edit</button>
          <button class="text-button" type="button" :disabled="saving" @click="remove(note)">Remove</button>
          <details v-if="history(note.id).length > 1" class="note-history"><summary>History ({{ plural(history(note.id).length, 'version') }})</summary>
            <ul class="plain-list"><li v-for="version in history(note.id)" :key="version.version">v{{ version.version }} · {{ when(version) }} · {{ version.removed ? '(removed)' : version.text }}</li></ul></details>
        </div>
      </li>
    </ul>
    <template v-if="selected && comparison">
      <h3 class="subheading">Before and after: {{ when(selected) }}</h3>
      <div class="segmented" role="group" aria-label="Window length">
        <button v-for="days in noteWindowLengths" :key="days" type="button" :aria-pressed="length === days" @click="length = days">{{ days }} days</button>
      </div>
      <p class="field-help">Before: {{ windowLabel(comparison.before) }}. <template v-if="comparison.during">During: {{ windowLabel(comparison.during) }}. </template>After: {{ windowLabel(comparison.after) }}{{ comparison.afterIncomplete ? ' (still in progress)' : '' }}. Each measure needs {{ comparison.before.required }} eligible days in a window. Differences describe this history; they do not show that the change caused them.</p>
      <TimelineChart :points="points" :bands="bands" :notes="notes" title="Trend weight with the compared windows (lb)" value-label="Trend weight (MacroFactor estimate)" />
      <DataRows v-if="narrow" :rows="rows" label="Before and after" :group-by-month="false" />
      <div v-else class="table-scroll" role="region" aria-label="Before and after" tabindex="0">
        <table class="period-table">
          <thead><tr><th scope="col">Measure</th><th scope="col">Before</th><th v-if="comparison.during" scope="col">During</th><th scope="col">After</th></tr></thead>
          <tbody><tr v-for="measure in measures" :key="measure.key"><th scope="row">{{ measure.label }}</th><td>{{ measure.value(comparison.before) }}</td>
            <td v-if="comparison.during">{{ measure.value(comparison.during) }}</td><td>{{ measure.value(comparison.after) }}</td></tr></tbody>
        </table>
      </div>
    </template>
  </section>
</template>
