#!/usr/bin/env node
// Ticket 14: confirms the hosted project refuses anonymous access to every private table, function,
// and the source-archive bucket, using only the public (publishable) key that ships in the static site.
// Usage: VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... node scripts/probe-anonymous-access.mjs
const url = process.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'); process.exit(2); }

const tables = ['preferences', 'source_files', 'data_revisions', 'workspace_state', 'import_batches', 'import_batch_sources', 'daily_records', 'food_days',
  'workout_days', 'exercise_aliases', 'review_decisions', 'completeness_marks', 'reports', 'restore_staging', 'exercise_muscles'];
const functions = {
  active_history: {}, review_state: {}, active_workout_sets: {}, active_food_entries: {}, food_day_entries: { p_date: '2026-09-01' }, workout_day_sets: { p_date: '2026-09-01' },
  commit_sources: { p_request_id: null, p_expected_revision_id: null, p_sources: [], p_daily: [], p_food: [], p_accept_reconciliation: false, p_dry_run: true, p_workouts: [] },
  clear_day: { p_request_id: '00000000-0000-4000-8000-000000000000', p_expected_revision_id: null, p_date: '2026-09-01', p_domain: 'steps' },
  undo_last_change: { p_request_id: null, p_expected_revision_id: null, p_dry_run: true },
  save_report: { p_fingerprint: '0'.repeat(64), p_expected_revision_id: null, p_report_date: '2026-10-21', p_period_end: null, p_template_version: 'x', p_inputs: {}, p_content: {} },
  prune_history: { p_expected_revision_id: null, p_dry_run: true, p_keep: 12 },
  export_backup: {}, workspace_counts: {}, capacity_status: {}, discard_stale_restores: {},
  stage_restore_chunk: { p_restore_id: '00000000-0000-4000-8000-000000000000', p_table: 'reports', p_chunk: 0, p_rows: [] },
  apply_restore: { p_restore_id: '00000000-0000-4000-8000-000000000000', p_expected_revision_id: null, p_manifest: {}, p_dry_run: true },
  discard_restore: { p_restore_id: '00000000-0000-4000-8000-000000000000' },
};
const headers = { apikey: key, 'Content-Type': 'application/json' };
const failures = [];
const refused = (status, body) => status === 401 || status === 403 || (typeof body === 'object' && body !== null && ['42501', 'PGRST301', 'PGRST302'].includes(body.code));

for (const table of tables) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
  const body = await response.json().catch(() => null);
  if (!refused(response.status, body)) failures.push(`table ${table}: HTTP ${response.status} ${JSON.stringify(body).slice(0, 120)}`);
}
for (const [name, args] of Object.entries(functions)) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const body = await response.json().catch(() => null);
  if (!refused(response.status, body)) failures.push(`function ${name}: HTTP ${response.status} ${JSON.stringify(body).slice(0, 120)}`);
}
// Storage: listing and downloading archives, and uploading into the bucket.
const list = await fetch(`${url}/storage/v1/object/list/source-archives`, { method: 'POST', headers, body: JSON.stringify({ prefix: '', limit: 10 }) });
const listed = await list.json().catch(() => null);
if (list.ok && Array.isArray(listed) && listed.length) failures.push(`storage list returned ${listed.length} objects`);
const upload = await fetch(`${url}/storage/v1/object/source-archives/probe/anonymous.csv`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'text/csv' }, body: 'probe' });
if (upload.ok) failures.push('storage upload succeeded anonymously');

if (failures.length) { console.error(`Anonymous access was NOT refused:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log(`Anonymous access refused for ${tables.length} tables, ${Object.keys(functions).length} functions, and archive list/upload.`);
