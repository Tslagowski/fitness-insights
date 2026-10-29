import { describe, expect, test } from 'vitest';
import { glanceTiles } from '../src/analysis/glance';
import { series, trendLine } from './fixtures/daily-builder';

const start = '2026-07-06'; // a Monday; 84 days ends Sunday 2026-09-27
describe('overview glance tiles', () => {
  test('headline values compare the latest 28 days with the 28 before, with weekly sparklines', () => {
    const days = series(start, trendLine(250, -1, 84).map((trend, index) => ({ trend, intake: index < 56 ? 2400 : 2200, target: 2300, protein: 180, steps: index < 56 ? 8000 : 9000,
      workoutsConfirmed: true, workingSets: index % 7 === 0 ? (index >= 77 ? 24 : 20) : 0 })));
    const tiles = Object.fromEntries(glanceTiles(days).map((tile) => [tile.id, tile]));
    expect(tiles.weight.value).toBe(`${(250 - 83 / 7).toFixed(1)} lb`);
    expect(tiles.weight.detail).toBe('−1.00 lb/wk (was −1.00)');
    expect(tiles.weight.trend).toBe('down');
    expect(tiles.intake).toMatchObject({ value: '2,200 kcal', detail: '−100 kcal vs target', trend: 'down' });
    expect(tiles.protein.value).toMatch(/^0\.7\d g\/lb$/);
    expect(tiles.steps).toMatchObject({ value: '9,000', detail: '+1,000 vs previous 28 days', trend: 'up' });
    expect(tiles.sets).toMatchObject({ value: '24', detail: '+4 vs the week before', window: 'Week of 09/21' });
    expect(tiles.weight.spark).toHaveLength(12);
    expect(tiles.weight.spark.every((value) => value !== null)).toBe(true);
  });

  test('a tile below the coverage gate shows no number and says why', () => {
    const days = series(start, Array.from({ length: 84 }, (_, index) => ({ trend: index > 70 ? 240 : null, intake: index % 3 ? null : 2000 })));
    const tiles = Object.fromEntries(glanceTiles(days).map((tile) => [tile.id, tile]));
    expect(tiles.weight.value).toBeNull();
    expect(tiles.weight.detail).toBe('Not enough data (13 of 21 days)');
    expect(tiles.intake.value).toBeNull();
    expect(tiles.sets).toMatchObject({ value: null, detail: 'No complete week confirmed by a workout import' });
    expect(glanceTiles([])).toEqual([]);
  });
});
