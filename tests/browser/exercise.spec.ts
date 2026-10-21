import { test, expect, type Route } from '@playwright/test';

// Transport fixtures only; the scoring rules are covered in exercise.test.ts and exercise-ui.test.ts.
const denverToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };

test('on a phone, the owner reads an exercise progress label with its sessions and weekly sets', async ({ browser }) => {
  const yesterday = shift(denverToday, -1);
  const set = (exercise: string, values: Record<string, string | number>) => ({ 'Workout Duration': 2912, Workout: 'Push A', Exercise: exercise, 'Set Type': 'Standard Set', ...values });
  const days = [100, 100, 100, 105, 105, 110, 110].map((load, index) => ({ date: shift(yesterday, (index - 6) * 7), source_kind: 'workout_csv', revision_id: 1, sets: [
    set('Bench Press', { 'Set Type': 'Warm-Up Set', 'Weight (lb)': 45, Reps: 10 }), set('Bench Press', { 'Weight (lb)': load, Reps: 8 }), set('Bench Press', { 'Weight (lb)': load, Reps: 6 }),
    set('Assisted Dip', { 'Weight (lb)': -60 + index * 5, Reps: 8 }), set('Plank', { Duration: 60 + index * 5 }),
  ] }));
  const serve = async (route: Route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    if (name === 'is_app_owner') return route.fulfill({ json: true });
    if (name === 'preferences') return route.fulfill({ json: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds', strength_band_percent: 2.5 } });
    if (name === 'active_history') return route.fulfill({ json: { revision_id: 1, records: [], food_days: [], aliases: {}, undo_target_id: null,
      imports: [{ id: 'i1', kind: 'import', committed_at: new Date().toISOString(), outcome: 'changed', revision_id: 1, added: 0, changed: 0, unchanged: 0, removed: 0, workout_added: days.length, undone: false, file_names: ['workouts.csv'] }],
      workout_days: days.map((day) => ({ date: day.date, source_kind: day.source_kind, sets: day.sets.length, exercises: 3, workouts: ['Push A'], durations: [2912], revision_id: 1 })),
      exercise_names: [{ name: 'Bench Press', sets: 21, days: 7 }, { name: 'Assisted Dip', sets: 7, days: 7 }, { name: 'Plank', sets: 7, days: 7 }] } });
    if (name === 'review_state') return route.fulfill({ json: { decisions: [], completeness: [] } });
    if (name === 'active_workout_sets') return route.fulfill({ json: days });
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
  await page.goto('./#training');

  const section = page.locator('section.exercise-progress');
  await expect(section.getByLabel('Selected exercise')).toContainText('▲ Progressing');
  await expect(section.getByLabel('Selected exercise')).toContainText('+10.0%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await section.screenshot({ path: 'test-results/mobile-exercise-progress.png' });

  await section.locator('#exercise-select').selectOption('Plank');
  await expect(section.getByLabel('Selected exercise')).toContainText('Timed');
  await expect(section.getByLabel('Sessions')).toContainText('90 (1 min 30 s)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});
