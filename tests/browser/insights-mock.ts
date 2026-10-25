import type { Browser, Route } from '@playwright/test';
import { insightsSeed } from '../fixtures/insights-seed';

// Serves the synthetic 24-week history (tests/fixtures/insights-seed.ts) as the Supabase API would.
const denverToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };

export async function insightsPage(browser: Browser, extra: Record<string, unknown> = {}) {
  const seed = insightsSeed(shift(denverToday, -1));
  const records = seed.daily.map((record) => ({ date: record.date, domain: record.domain, fields: record.values, source_file_id: 'f', revision_id: 1 }));
  const total = (entries: Array<Record<string, string | number>>, field: string) => entries.reduce((sum, entry) => sum + (typeof entry[field] === 'number' ? entry[field] as number : 0), 0);
  const foodDays = seed.food.map((day) => ({ date: day.date, source_kind: day.source, entries: day.entries.length, calories: total(day.entries, 'Calories (kcal)'),
    protein: total(day.entries, 'Protein (g)'), fat: total(day.entries, 'Fat (g)'), carbs: total(day.entries, 'Carbs (g)'), missing_calories: 0, revision_id: 1 }));
  const workoutDays = seed.workouts.map((day) => ({ date: day.date, source_kind: day.source, sets: day.sets.length, exercises: new Set(day.sets.map((set) => set.Exercise)).size,
    workouts: ['Full Body'], durations: [3000], revision_id: 1 }));
  const imports = [{ id: 'i1', kind: 'import', committed_at: new Date().toISOString(), outcome: 'changed', revision_id: 1, added: records.length, changed: 0, unchanged: 0, removed: 0,
    food_added: foodDays.length, workout_added: workoutDays.length, undone: false, file_names: ['export.xlsx'] }];
  const responses: Record<string, unknown> = {
    is_app_owner: true,
    preferences: { display_density: 'comfortable', timezone: 'America/Denver', week_starts_on: 1, duration_unit: 'seconds', strength_band_percent: 2.5, stall_comparisons: 3 },
    active_history: { revision_id: 1, records, food_days: foodDays, workout_days: workoutDays, exercise_names: [], aliases: {}, undo_target_id: 'i1', imports },
    review_state: { decisions: [], completeness: [] },
    active_workout_sets: seed.workouts.map((day) => ({ date: day.date, source_kind: day.source, sets: day.sets, revision_id: 1 })),
    active_food_entries: seed.food.map((day) => ({ date: day.date, source_kind: day.source, entries: day.entries, revision_id: 1 })),
    exercise_muscles: [], owner_notes: [], reports: [],
    ...extra,
  };
  const serve = async (route: Route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    return route.fulfill({ json: name in responses ? responses[name] : {} });
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
  await page.goto('./#insights');
  return { context, page };
}
