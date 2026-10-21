import { test, expect, type Route } from '@playwright/test';
import { setRow, workoutCsv } from '../fixtures/workout-builder';

// Transport fixtures only; the workout rules are exercised against PostgreSQL in workout-database.test.ts.
test('on a phone, the owner imports workouts, reads sessions as logged, and aliases a superset name', async ({ browser }) => {
  let revisionId: number | null = null;
  let workoutDays: Array<{ date: string; source_kind: string; sets: Array<Record<string, string | number>> }> = [];
  const aliases: Record<string, string> = {};
  const uploads: string[] = [];
  const serve = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name = url.pathname.split('/').pop()!;
    if (name === 'is_app_owner') return route.fulfill({ json: true });
    if (name === 'preferences') return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds' } });
    if (name === 'active_history') {
      const sets: Array<Record<string, string | number>> = workoutDays.flatMap((day) => day.sets.map((set) => ({ ...set, date: day.date })));
      const names = [...new Set(sets.map((set) => String(set.Exercise)))].sort();
      return route.fulfill({ json: { revision_id: revisionId, records: [], food_days: [], imports: [], undo_target_id: null, aliases,
        workout_days: workoutDays.map((day) => ({ date: day.date, source_kind: day.source_kind, sets: day.sets.length, revision_id: revisionId,
          exercises: new Set(day.sets.map((set) => set.Exercise)).size, workouts: [...new Set(day.sets.map((set) => set.Workout))], durations: [...new Set(day.sets.map((set) => set['Workout Duration']))] })),
        exercise_names: names.map((item) => ({ name: item, sets: sets.filter((set) => set.Exercise === item).length, days: new Set(sets.filter((set) => set.Exercise === item).map((set) => set.date)).size })) } });
    }
    if (name === 'workout_day_sets') {
      const day = workoutDays.find((item) => item.date === request.postDataJSON().p_date);
      return route.fulfill({ json: day ? { date: day.date, source_kind: day.source_kind, sets: day.sets, revision_id: revisionId } : null });
    }
    if (name === 'active_workout_sets') return route.fulfill({ json: workoutDays.map((day) => ({ ...day, revision_id: revisionId })) });
    if (name === 'exercise_aliases') {
      const body = request.postDataJSON();
      const row = Array.isArray(body) ? body[0] : body;
      aliases[row.source_name] = row.display_name;
      return route.fulfill({ status: 201, json: [] });
    }
    if (url.pathname.includes('/storage/v1/object/source-archives/')) { uploads.push(url.pathname); return route.fulfill({ json: { Key: url.pathname } }); }
    if (name === 'commit_sources') {
      const body = request.postDataJSON();
      const counts = { added: 0, changed: 0, unchanged: 0, food_added: 0, food_changed: 0, food_unchanged: 0, food_kept: 0, workout_changed: 0, workout_unchanged: 0, workout_kept: 0, conflicts: [] };
      if (body.p_dry_run) return route.fulfill({ json: { ...counts, revision_id: revisionId, workout_added: body.p_workouts.length, kept_dates: [], changed_food_dates: [], kept_workout_dates: [], changed_workout_dates: [] } });
      workoutDays = body.p_workouts;
      revisionId = 1;
      return route.fulfill({ json: { ...counts, outcome: 'changed', replayed: false, revision_id: 1, workout_added: workoutDays.length } });
    }
    return route.fulfill({ json: {} });
  };

  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173/fitness-insights/', viewport: { width: 390, height: 844 } });
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

  const csv = workoutCsv([
    setRow('2026-09-01', 'Dumbbell Bench Press', { 'Weight (lb)': 60, Reps: 10 }), setRow('2026-09-01', 'Dumbbell Bench Press', { 'Weight (lb)': 60, Reps: 10 }),
    setRow('2026-09-01', 'Neutral Grip Machine-Assisted Pull-Up ∈ SS1', { 'Weight (lb)': -100, Reps: 6, 'Set Type': 'Failure Set', RIR: 0 }),
    setRow('2026-09-01', 'Plate-Loaded Machine Shoulder Press', { 'Exercise Base Weight (lb)': 25, 'Weight (lb)': 90, Reps: 8 }),
  ]);
  await page.getByLabel('MacroFactor export files').setInputFiles({ name: 'MacroFactor-workouts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByLabel('Proposed changes')).toContainText('1new workout day');
  await page.getByRole('button', { name: 'Confirm import' }).click();
  await expect(page.getByRole('status')).toContainText('workout days 1 added');
  expect(uploads.map((path) => path.replace(/[0-9a-f]{64}/, 'SHA'))).toEqual(['/storage/v1/object/source-archives/workout-csv/SHA.csv']);

  await page.getByRole('link', { name: 'Training' }).click();
  await page.getByRole('button', { name: /Tue, Sep 1, 2026/ }).click();
  await expect(page.locator('.workout-session')).toContainText('Duration 48 min 32 s (read as seconds, unverified; raw 2912)');
  await expect(page.getByRole('region', { name: 'Neutral Grip Machine-Assisted Pull-Up ∈ SS1 sets' })).toContainText('-100 (assistance)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('section', { has: page.getByRole('heading', { name: 'Training log' }) }).screenshot({ path: 'test-results/mobile-training-log.png' });

  await page.getByRole('button', { name: 'Use “Neutral Grip Machine-Assisted Pull-Up”' }).click();
  await expect(page.getByRole('status')).toContainText('The logged name is unchanged');
  expect(aliases).toEqual({ 'Neutral Grip Machine-Assisted Pull-Up ∈ SS1': 'Neutral Grip Machine-Assisted Pull-Up' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('section', { has: page.getByRole('heading', { name: 'Exercise names' }) }).screenshot({ path: 'test-results/mobile-exercise-names.png' });
  await context.close();
});
