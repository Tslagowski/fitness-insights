<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { defaultPreferences, emptyHistory, type DisplayDensity, type Gateway, type Identity, type ImportedHistory, type Preferences } from './gateway';
import ImportPanel from './components/ImportPanel.vue';
import FoodLog from './components/FoodLog.vue';
import TrainingLog from './components/TrainingLog.vue';
import DataStatus from './components/DataStatus.vue';
import ReviewQueue from './components/ReviewQueue.vue';
import CompletenessPanel from './components/CompletenessPanel.vue';
import { evaluateEligibility } from './analysis/eligibility';
import type { DurationUnit } from './import/workout';
import DailyTable from './components/DailyTable.vue';
import CorrectDay from './components/CorrectDay.vue';
import ChangeHistory from './components/ChangeHistory.vue';
import NutritionAnalysis from './components/NutritionAnalysis.vue';
import ExerciseProgress from './components/ExerciseProgress.vue';
import { formatCalendarDate, reportingToday } from './import/preview';

const props = defineProps<{ gateway: Gateway | null; configurationProblem?: string }>();
const pages = [
  { id: 'overview', title: 'Overview', short: 'Overview', number: '01' },
  { id: 'nutrition', title: 'Nutrition & Weight', short: 'Nutrition', number: '02' },
  { id: 'training', title: 'Training', short: 'Training', number: '03' },
  { id: 'settings', title: 'Imports & Settings', short: 'Settings', number: '04' },
];
const page = ref('overview');
const title = computed(() => pages.find((item) => item.id === page.value)?.title ?? 'Overview');
const state = ref<'setup' | 'loading' | 'signed-out' | 'denied' | 'error' | 'ready'>('loading');
const identity = ref<Identity | null>(null);
const preferences = ref<Preferences>({ ...defaultPreferences });
const draftDensity = ref<DisplayDensity>('comfortable');
const draftDurationUnit = ref<DurationUnit>('seconds');
const draftBand = ref(defaultPreferences.strengthBandPercent);
const notice = ref('');
const error = ref('');
const saving = ref(false);
const signingIn = ref(false);
const signingOut = ref(false);
const signOutRequired = ref(false);
const history = ref<ImportedHistory>({ ...emptyHistory });
const historyState = ref<'loading' | 'ready' | 'error'>('loading');
const historyDates = computed(() => [...new Set([...history.value.records.map((record) => record.date), ...history.value.foodDays.map((day) => day.date), ...history.value.workoutDays.map((day) => day.date)])].sort());
const eligibility = computed(() => evaluateEligibility(history.value, history.value.review, reportingToday()));
const hasHistory = computed(() => history.value.records.length > 0 || history.value.foodDays.length > 0 || history.value.workoutDays.length > 0);
let revision = 0;
let unsubscribe = () => {};

function readRoute() {
  const route = window.location.hash.slice(1);
  page.value = pages.some((item) => item.id === route) ? route : 'overview';
}
function navigate(route: string) { page.value = route; }
function focusMain() { document.getElementById('main')?.focus(); }

async function refreshIdentity() {
  if (signOutRequired.value) return;
  const currentRevision = ++revision;
  identity.value = null;
  preferences.value = { ...defaultPreferences };
  notice.value = '';
  error.value = '';
  saving.value = false;
  history.value = { ...emptyHistory };
  historyState.value = 'loading';
  if (!props.gateway) { state.value = 'setup'; return; }
  state.value = 'loading';
  try {
    const currentIdentity = await props.gateway.getIdentity();
    if (currentRevision !== revision) return;
    if (!currentIdentity) { state.value = 'signed-out'; return; }
    identity.value = currentIdentity;
    const owner = await props.gateway.isOwner();
    if (currentRevision !== revision) return;
    if (!owner) { state.value = 'denied'; return; }
    const savedPreferences = await props.gateway.loadPreferences(currentIdentity.id);
    if (currentRevision !== revision) return;
    preferences.value = savedPreferences;
    draftDensity.value = savedPreferences.displayDensity;
    draftDurationUnit.value = savedPreferences.durationUnit;
    draftBand.value = savedPreferences.strengthBandPercent;
    state.value = 'ready';
    void reloadHistory();
  } catch {
    if (currentRevision !== revision) return;
    state.value = 'error';
    error.value = 'We could not load your workspace. Check your connection and try again.';
  }
}
/** Loads the active shared history. Returns false (keeping the last confirmed view) if it fails. */
async function reloadHistory(): Promise<boolean> {
  if (!props.gateway || state.value !== 'ready') return false;
  const currentRevision = revision;
  if (!hasHistory.value) historyState.value = 'loading';
  try {
    const loaded = await props.gateway.loadHistory();
    if (currentRevision !== revision) return false;
    history.value = loaded;
    historyState.value = 'ready';
    return true;
  } catch {
    if (currentRevision !== revision) return false;
    if (!hasHistory.value) historyState.value = 'error';
    return false;
  }
}
async function signIn() {
  if (!props.gateway || signingIn.value || signOutRequired.value) return;
  signingIn.value = true;
  error.value = '';
  try { await props.gateway.signIn(); }
  catch { error.value = 'GitHub sign-in could not start. Please try again.'; }
  finally { signingIn.value = false; }
}
async function signOut() {
  if (!props.gateway || signingOut.value) return;
  signingOut.value = true;
  signOutRequired.value = true;
  ++revision;
  // Hide private state immediately, including responses from in-flight saves.
  identity.value = null;
  preferences.value = { ...defaultPreferences };
  history.value = { ...emptyHistory };
  notice.value = '';
  error.value = '';
  state.value = 'signed-out';
  try {
    await props.gateway.signOut();
    signOutRequired.value = false;
  }
  catch { error.value = 'Sign-out could not be completed. Please retry before leaving this device.'; }
  finally { signingOut.value = false; }
}
async function save() {
  if (!props.gateway || !identity.value || saving.value) return;
  const currentRevision = revision;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    const saved = await props.gateway.savePreferences(identity.value.id, { displayDensity: draftDensity.value, durationUnit: draftDurationUnit.value, strengthBandPercent: Math.min(20, Math.max(0.5, Number(draftBand.value) || defaultPreferences.strengthBandPercent)) });
    if (currentRevision !== revision) return;
    preferences.value = saved;
    notice.value = 'Preference saved. It will be available when you open another device.';
  } catch {
    if (currentRevision !== revision) return;
    error.value = 'Your preference was not saved. Check your connection and retry.';
  } finally {
    if (currentRevision === revision) saving.value = false;
  }
}
onMounted(() => {
  readRoute();
  window.addEventListener('hashchange', readRoute);
  unsubscribe = props.gateway?.onIdentityChange(() => { void refreshIdentity(); }) ?? (() => {});
  void refreshIdentity();
});
onUnmounted(() => { ++revision; unsubscribe(); window.removeEventListener('hashchange', readRoute); });
</script>

<template>
  <div class="app-layout" :data-density="preferences.displayDensity">
    <a class="skip-link" href="#main" @click.prevent="focusMain">Skip to content</a>
    <aside class="sidebar">
      <a class="brand" href="#overview" @click="navigate('overview')" aria-label="Fitness Insights home">
        <span class="brand-symbol" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>FITNESS<br><strong>INSIGHTS</strong></span>
      </a>
      <div class="workspace-label">PERSONAL WORKSPACE</div>
      <nav aria-label="Main navigation">
        <a v-for="item in pages" :key="item.id" :href="`#${item.id}`"
          :aria-current="page === item.id ? 'page' : undefined" @click="navigate(item.id)">
          <span class="nav-number" aria-hidden="true">{{ item.number }}</span>
          <span class="desktop-label">{{ item.title }}</span><span class="mobile-label">{{ item.short }}</span>
          <span class="nav-dot" aria-hidden="true"></span>
        </a>
      </nav>
      <div class="sidebar-note"><span class="small-rule"></span><p>Your data.<br>A clearer perspective.</p>
        <span>Nutrition / Movement / Progress</span></div>
      <div class="sidebar-footer"><span class="status-dot"></span> Personal edition <span class="version">v0.1</span></div>
    </aside>

    <div class="workspace">
      <header class="topbar"><span class="breadcrumb">Workspace <span>/</span> <strong>{{ title }}</strong></span>
        <div class="account"><span v-if="state === 'ready'" class="private-label">Owner access</span>
          <button v-if="identity || signOutRequired" class="text-button" @click="signOut" :disabled="signingOut">{{ signingOut ? 'Signing out...' : 'Sign out' }}</button>
          <span v-else class="private-label">Personal workspace</span>
        </div>
      </header>
      <main id="main" tabindex="-1">
        <div class="page-heading"><div><div class="eyebrow">THE BIG PICTURE</div><h1>{{ title }}</h1></div>
          <span class="calendar-label">Mountain Time <span aria-hidden="true">/</span> Monday-start weeks</span>
        </div>
        <div v-if="error" class="alert error" role="alert">{{ error }}</div>
        <div v-if="notice && state === 'ready'" class="alert success" role="status">{{ notice }}</div>

        <section v-if="state === 'setup' || state === 'signed-out'" class="welcome-card">
          <div class="welcome-content"><span class="pill">A PERSONAL VIEW OF YOUR PROGRESS</span>
            <h2>Your history.<br>A clearer picture.</h2>
            <p>A place to understand your nutrition, training, and the changes that matter over time.</p>
            <template v-if="state === 'setup'">
              <div class="setup-note"><strong>Workspace setup needed</strong><p>{{ configurationProblem || 'Connect your Supabase project to enable GitHub sign-in and saved preferences.' }}</p></div>
              <span class="muted">Follow the included setup guide to connect your account.</span>
            </template>
            <template v-else>
              <button class="primary-button" @click="signIn" :disabled="signingIn || signOutRequired">{{ signingIn ? 'Opening GitHub...' : 'Continue with GitHub' }} <span aria-hidden="true">&rarr;</span></button>
              <span class="muted signin-caption">Only the configured owner can access this workspace.</span>
            </template>
          </div>
          <div class="welcome-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div>
            <div class="art-center"><span class="brand-symbol large"><i></i><i></i><i></i></span></div>
            <span class="art-caption">CONSISTENCY, IN CONTEXT.</span>
          </div>
        </section>

        <section v-else-if="state === 'loading'" class="empty-card" role="status"><span class="loading-line"></span><h2>Opening your workspace</h2><p>Checking your account and saved preferences.</p></section>
        <section v-else-if="state === 'denied'" class="empty-card"><div class="eyebrow">PRIVATE WORKSPACE</div><h2>This account does not have access.</h2><p>Sign out and use the GitHub account configured as the owner.</p><button class="primary-button" @click="signOut">Sign out</button></section>
        <section v-else-if="state === 'error'" class="empty-card"><h2>Your workspace is temporarily unavailable.</h2><p>No preferences have been changed. If the free service is paused, resume the project and retry.</p><button class="primary-button" @click="refreshIdentity">Try again</button></section>

        <template v-else-if="state === 'ready'">
          <template v-if="page === 'settings'">
            <ImportPanel v-if="gateway" :gateway="gateway" :history="history" :history-state="historyState" :reload-history="reloadHistory" />
            <CorrectDay v-if="gateway && historyState === 'ready' && hasHistory" :gateway="gateway" :history="history" :reload-history="reloadHistory" />
            <ChangeHistory v-if="gateway && historyState === 'ready' && history.imports.length" :gateway="gateway" :history="history" :reload-history="reloadHistory" />
            <section class="section-card"><div class="section-heading"><div><div class="eyebrow">MAKE IT YOURS</div><h2>Display preferences</h2></div><span class="outline-pill">Saved to your account</span></div>
              <form @submit.prevent="save"><label class="field-label" for="density">Display density</label><p class="field-help">Choose how much space to leave between records.</p>
                <select id="density" aria-label="Display density" v-model="draftDensity" :disabled="saving"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>
                <div class="density-preview" aria-hidden="true"><span></span><span></span><span></span></div>
                <label class="field-label" for="duration-unit">Workout duration values</label>
                <p class="field-help">MacroFactor exports durations without a unit. They are read as seconds by default; this is a provisional assumption until one workout is checked against the app. Raw values are always kept.</p>
                <select id="duration-unit" aria-label="Workout duration unit" v-model="draftDurationUnit" :disabled="saving"><option value="seconds">Seconds (provisional default)</option><option value="minutes">Minutes</option></select>
                <label class="field-label band-label" for="strength-band">Exercise progress label band (%)</label>
                <p class="field-help">A change in median best score above +band is labeled Progressing, below −band Declining, otherwise Stable. The accepted default is 2.5%. This is a display heuristic, not statistical significance.</p>
                <input id="strength-band" v-model.number="draftBand" class="text-input band-input" type="number" min="0.5" max="20" step="0.5" inputmode="decimal" :disabled="saving" />
                <div class="form-footer"><span class="muted">Applies after saving.</span><button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Save preference' }}</button></div>
              </form>
            </section>
            <section class="section-card"><div class="eyebrow">CONSISTENT ACROSS DEVICES</div><h2>Reporting calendar</h2><dl class="calendar-details"><div><dt>Time zone</dt><dd>America/Denver</dd></div><div><dt>Week starts</dt><dd>Monday</dd></div></dl></section>
          </template>
          <template v-else-if="page === 'nutrition' && (history.records.length || history.foodDays.length)">
            <NutritionAnalysis :history="history" :report="eligibility" />
            <section class="section-card"><div class="section-heading"><div><div class="eyebrow">IMPORTED DAILY HISTORY</div><h2>Daily records</h2></div>
              <span class="outline-pill">Version {{ history.revisionId }}</span></div>
              <p class="field-help">{{ historyDates.length }} dates, {{ formatCalendarDate(historyDates[0]) }} – {{ formatCalendarDate(historyDates[historyDates.length - 1]) }}.
                Values are shown exactly as exported; "—" means not recorded. Intake is the sum of that day's food entries when they exist, otherwise the workbook's daily total; the two are never added together. </p>
              <DailyTable :records="history.records" :food-days="history.foodDays" :today="reportingToday()" :statuses="eligibility.days" caption="Saved daily history" />
            </section>
            <FoodLog v-if="gateway && history.foodDays.length" :gateway="gateway" :food-days="history.foodDays" :today="reportingToday()" />
          </template>
          <template v-else-if="page === 'overview' && gateway && historyState === 'ready' && hasHistory">
            <DataStatus :report="eligibility" />
            <ReviewQueue :gateway="gateway" :report="eligibility" :reload-history="reloadHistory" />
            <CompletenessPanel :gateway="gateway" :report="eligibility" :reload-history="reloadHistory" />
          </template>
          <template v-else-if="page === 'training' && gateway && history.workoutDays.length">
            <ExerciseProgress :gateway="gateway" :history="history" :report="eligibility" :preferences="preferences" />
            <TrainingLog :gateway="gateway" :history="history" :duration-unit="preferences.durationUnit" :today="reportingToday()" :reload-history="reloadHistory" />
          </template>
          <section v-else-if="page === 'nutrition' && historyState === 'error'" class="empty-card"><h2>Your saved history could not be loaded.</h2><p>Nothing has been changed. If the free service is paused, resume the project and retry.</p><button class="primary-button" @click="reloadHistory">Try again</button></section>
          <section v-else class="empty-card data-empty"><div class="empty-mark" aria-hidden="true"><span></span><span></span><span></span></div>
            <div class="eyebrow">YOUR STARTING POINT</div>
            <h2>{{ page === 'training' ? 'Your training story starts here.' : page === 'nutrition' ? 'Room for the whole picture.' : `Welcome to your workspace, ${identity?.name}.` }}</h2>
            <p>{{ page === 'training' ? 'No workout history has been imported yet. Import the MacroFactor workout CSV or workbook to see your sessions and sets here.' : page === 'nutrition' ? 'No nutrition or weight history has been imported yet. Import a MacroFactor workbook to see your daily records here.' : hasHistory ? `Your saved history covers ${historyDates.length} dates through ${formatCalendarDate(historyDates[historyDates.length - 1])}. Written findings arrive in a later update.` : 'Your account is connected. Import a MacroFactor workbook to start building your history.' }}</p>
            <a class="primary-button" href="#settings" @click="navigate('settings')">Open imports <span aria-hidden="true">&rarr;</span></a>
          </section>
        </template>

        <section v-if="state === 'setup' || state === 'signed-out' || (state === 'ready' && page === 'overview')" class="feature-grid" aria-label="Planned analysis areas">
          <article><span class="feature-number">01 / NUTRITION</span><h3>See the patterns.</h3><p>Intake, weight, and activity in the same context.</p></article>
          <article><span class="feature-number">02 / TRAINING</span><h3>Follow your progress.</h3><p>Exercise history with the details that matter.</p></article>
          <article><span class="feature-number">03 / UNDERSTANDING</span><h3>Know what changed.</h3><p>Clear summaries supported by your records.</p></article>
        </section>
        <footer class="page-footer"><span>FITNESS INSIGHTS</span><span>Personal analytics, built around your history.</span></footer>
      </main>
    </div>
  </div>
</template>
