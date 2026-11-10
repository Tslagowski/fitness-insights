import { expect, test } from 'vitest';
import { insightsSeed } from './fixtures/insights-seed';

const weekday = (date: string) => { const [y, m, d] = date.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };

test('the untimed protein bar sits on a weekday whatever day the seed ends on', () => {
  for (let offset = 0; offset < 7; offset += 1) {
    const end = new Date(Date.UTC(2026, 10, 2 + offset)).toISOString().slice(0, 10);
    const seed = insightsSeed(end);
    const days = seed.food.filter((day) => day.entries.some((entry) => entry['Food Name'] === 'Protein bar'));
    expect(days).toHaveLength(1);
    expect(weekday(days[0].date)).toBeLessThan(5);
  }
});
