import type { DailyRecord } from '../../src/import/workbook';
import type { FoodDay } from '../../src/import/food';
import type { WorkoutDay, WorkoutSet } from '../../src/import/workout';

/**
 * A synthetic 24-week history ending on `end` for the long-range analyses (tickets 16-25):
 * - weeks 1-10 losing 1 lb/week (intake 2,000, expenditure 2,700), weeks 11-18 flat at 240 lb
 *   (intake 2,600, expenditure 2,600), weeks 19-24 gaining 0.5 lb/week (intake 2,900, expenditure 2,650);
 * - Saturdays: scale 1 lb above trend, 4,000 steps, +500 kcal; protein 170 g on weekdays, 140 g on weekends;
 * - food detail for the last 28 days, when the calorie target is 2,900 (2,200 before) (Saturday pizza at 9:15 PM; one entry without a time; repeated eggs);
 * - Monday/Wednesday/Friday workouts: Bench Press, Back Squat, Cable Row, Assisted Pull-Up, Plank.
 */
const shift = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };
const weekday = (date: string) => { const [y, m, d] = date.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };
export const seedDays = 168;

export interface InsightsSeed { daily: DailyRecord[]; food: FoodDay[]; workouts: WorkoutDay[]; first: string }

export function insightsSeed(end: string): InsightsSeed {
  const first = shift(end, -(seedDays - 1));
  const daily: DailyRecord[] = [];
  const food: FoodDay[] = [];
  const workouts: WorkoutDay[] = [];
  let session = 0;
  for (let index = 0; index < seedDays; index += 1) {
    const date = shift(first, index);
    const day = weekday(date);
    const saturday = day === 5;
    const weekend = day >= 5;
    const trend = index < 70 ? 250 - index / 7 : index < 126 ? 240 : 240 + ((index - 125) * 0.5) / 7;
    const base = index < 70 ? 2000 : index < 126 ? 2600 : 2900;
    const expenditure = index < 70 ? 2700 : index < 126 ? 2600 : 2650;
    const calories = base + (saturday ? 500 : 0);
    const protein = weekend ? 140 : 170;
    daily.push(
      { date, domain: 'trend_weight', values: { 'Trend Weight (lb)': Number(trend.toFixed(2)) } },
      { date, domain: 'scale_weight', values: { 'Weight (lb)': Number((trend + (saturday ? 1 : -0.2)).toFixed(1)) } },
      { date, domain: 'expenditure', values: { Expenditure: expenditure } },
      { date, domain: 'steps', values: { Steps: saturday ? 4000 : 9000 } },
      { date, domain: 'targets', values: { 'Target Calories (kcal)': index >= seedDays - 28 ? 2900 : 2200, 'Target Protein (g)': 160, 'Target Fat (g)': 70, 'Target Carbs (g)': 220 } },
      { date, domain: 'nutrition_totals', values: { 'Calories (kcal)': calories, 'Protein (g)': protein, 'Fat (g)': 70, 'Carbs (g)': saturday ? 320 : 220 } },
    );
    if (index >= seedDays - 28) {
      const entry = (time: string, name: string, kcal: number, grams = 10): Record<string, string | number> => ({ Time: time, 'Food Name': name, 'Serving Size': 'serving', 'Serving Qty': 1,
        'Serving Weight (g)': 100, 'Calories (kcal)': kcal, 'Fat (g)': 5, 'Carbs (g)': 20, 'Protein (g)': grams });
      const entries = [entry('7:30 AM', 'Egg', 70, 6), entry('7:30 AM', 'Egg', 70, 6), entry('12:30 PM', 'Chicken bowl', 900, 60), entry('6:30 PM', 'Salmon dinner', 1100, 70)];
      const used = entries.reduce((sum, item) => sum + (item['Calories (kcal)'] as number), 0);
      const extra = calories - used - (saturday ? 900 : 0);
      if (extra > 0) entries.push(entry('3:00 PM', 'Greek yogurt', extra, Math.max(protein - 142, 0)));
      if (saturday) entries.push(entry('9:15 PM', 'Pizza', 900, 0));
      if (index === seedDays - 3) { const bar = entry('', 'Protein bar', 200, 20); delete bar.Time; entries.push(bar); }
      food.push({ date, source: 'food_csv', entries });
    }
    if (day === 0 || day === 2 || day === 4) {
      const load = 100 + Math.floor(session / 6) * 5;
      const set = (exercise: string, values: WorkoutSet): WorkoutSet => ({ 'Workout Duration': 3000, Workout: 'Full Body', Exercise: exercise, 'Set Type': 'Standard Set', ...values });
      workouts.push({ date, source: 'workout_csv', sets: [
        set('Bench Press', { 'Set Type': 'Warm-Up Set', 'Weight (lb)': 45, Reps: 10 }),
        set('Bench Press', { 'Weight (lb)': load, Reps: 8, RIR: 2 }), set('Bench Press', { 'Weight (lb)': load, Reps: 7, RIR: 1 }),
        set('Back Squat', { 'Weight (lb)': 150 + (session % 3) * 5, Reps: 5, RIR: 3 }), set('Back Squat', { 'Weight (lb)': 150, Reps: 5 }),
        set('Cable Row', { 'Weight (lb)': 90, Reps: 12, RIR: 0, 'Set Type': session % 2 ? 'Failure Set' : 'Standard Set' }),
        set('Assisted Pull-Up', { 'Weight (lb)': -60, Reps: 8, RIR: 2 }),
        set('Plank', { Duration: 60 }),
      ] });
      session += 1;
    }
  }
  return { daily, food, workouts, first };
}
