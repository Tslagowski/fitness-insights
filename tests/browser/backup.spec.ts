import { test, expect, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';

// Transport fixtures only; restore atomicity and access rules are covered in backup-database.test.ts.
test('on a phone, the owner downloads a backup and restores it after reviewing a preview', async ({ browser }, testInfo) => {
  const csv = Buffer.from('Date,Workout Duration,Workout,Exercise,Set Type,Weight (lb),Reps\n2026-09-01,2912,Push A,Row,Standard Set,100,8\n');
  const hash = createHash('sha256').update(csv).digest('hex');
  const path = `workout-csv/${hash}.csv`;
  const tables = {
    source_files: [{ id: 'f1', sha256: hash, file_name: 'workouts.csv', byte_size: csv.length, media_type: 'text/csv', storage_path: path, received_at: '2026-10-20T15:00:00Z' }],
    data_revisions: [{ id: 1, parent_id: null, created_at: '2026-10-20T15:00:00Z' }],
    import_batches: [], import_batch_sources: [],
    daily_records: [{ id: 1, record_date: '2026-09-01', domain: 'steps', fields: { Steps: 8000 }, source_file_id: 'f1', introduced_revision_id: 1, retired_revision_id: null }],
    food_days: [], workout_days: [], reports: [], exercise_aliases: [], review_decisions: [], completeness_marks: [], exercise_muscles: [],
  };
  const calls: string[] = [];
  const serve = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/storage/v1/object/')) {
      calls.push(`storage ${request.method()}`);
      if (request.method() === 'GET') return route.fulfill({ body: csv, contentType: 'text/csv' });
      return route.fulfill({ status: 400, json: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } });
    }
    if (name === 'is_app_owner') return route.fulfill({ json: true });
    if (name === 'preferences') {
      if (request.method() !== 'GET') calls.push('save preferences');
      return route.fulfill({ json: request.method() === 'GET' ? { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds', strength_band_percent: 2.5 }
        : { display_density: 'compact', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds', strength_band_percent: 2.5 } });
    }
    if (name === 'active_history') return route.fulfill({ json: { revision_id: 1, records: [], food_days: [], workout_days: [], exercise_names: [], aliases: {}, imports: [], undo_target_id: null } });
    if (name === 'review_state') return route.fulfill({ json: { decisions: [], completeness: [] } });
    if (name === 'export_backup') return route.fulfill({ json: { schema_version: 1, tables, workspace_state: { active_revision_id: 1, retained_from_revision_id: null } } });
    if (name === 'capacity_status') return route.fulfill({ json: { database_bytes: 40000000, database_limit_bytes: 524288000, archive_bytes: 1000, archive_limit_bytes: 1073741824, staging_bytes: 0 } });
    if (name === 'workspace_counts') return route.fulfill({ json: { ...Object.fromEntries(Object.keys(tables).map((key) => [key, 0])), daily_records: 5 } });
    if (name === 'stage_restore_chunk') { calls.push(`stage ${request.postDataJSON().p_table}`); return route.fulfill({ json: {} }); }
    if (name === 'apply_restore') { calls.push('apply'); return route.fulfill({ json: { dry_run: false, counts: {}, revision_id: 1 } }); }
    return route.fulfill({ json: {} });
  };
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173/fitness-insights/', viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.addInitScript(() => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp: expiresAt, sub: 'owner' })).replace(/=/g, '');
    localStorage.setItem('sb-test-project-auth-token', JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: 'test-refresh', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer',
      user: { id: 'owner', aud: 'authenticated', role: 'authenticated', user_metadata: { user_name: 'Trevis' }, app_metadata: { provider: 'github' } },
    }));
  });
  await context.route('https://test-project.supabase.co/**', serve);
  const page = await context.newPage();
  await page.goto('./#settings');

  const panel = page.locator('section.backup-panel');
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download backup' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^fitness-insights-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const file = testInfo.outputPath('backup.zip');
  await download.saveAs(file);
  await expect(panel.getByRole('status')).toContainText('no passwords or keys');

  await panel.getByLabel('Choose a backup file').setInputFiles(file);
  await expect(panel.getByLabel('Restore preview')).toContainText('All checksums match.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: 'test-results/mobile-backup-preview.png' });
  await panel.getByRole('button', { name: 'Replace with this backup' }).click();
  await expect(panel.locator('.restore-block').getByRole('status')).toContainText('Restored from backup.zip: 1 daily records');
  expect(calls).toEqual(['storage GET', 'storage POST', ...Object.keys(tables).map((table) => `stage ${table}`), 'apply', 'save preferences']);
  await context.close();
});
