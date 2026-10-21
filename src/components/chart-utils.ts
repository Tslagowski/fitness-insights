/**
 * Shared geometry for the inline SVG charts. Specs follow the dataviz method: bars ≤24px with a 4px
 * rounded data end and a square baseline, 2px lines that never bridge missing days, hairline grids.
 */
import { formatCalendarDate } from '../import/preview';

export const chartMargin = { left: 44, right: 8, top: 12, bottom: 26 };
export const plotHeight = 170;
export const chartHeight = plotHeight + chartMargin.top + chartMargin.bottom;

export interface BandLayout { band: number; barWidth: number; x: (index: number) => number; left: (index: number) => number }

export function bandLayout(width: number, count: number): BandLayout {
  const plotWidth = Math.max(width - chartMargin.left - chartMargin.right, 80);
  const band = plotWidth / Math.max(count, 1);
  return {
    band,
    barWidth: Math.max(Math.min(24, band - 2), 1),
    x: (index) => chartMargin.left + index * band + band / 2,
    left: (index) => chartMargin.left + index * band,
  };
}

export function niceStep(span: number, ticks = 4): number {
  const raw = Math.max(span, 1e-9) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((step) => step * magnitude).find((step) => step >= raw) ?? raw;
}

/** Axis label: 1,000 and up become 1K / 2.5K; negatives use a true minus sign. */
export function compact(value: number): string {
  const sign = value < 0 ? '−' : '';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return `${sign}${(magnitude / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`;
  return `${sign}${magnitude.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
}

/** A bar with a 4px rounded data end and a square baseline end. Empty when shorter than half a pixel. */
export function barPath(center: number, barWidth: number, from: number, to: number): string {
  const half = barWidth / 2;
  const left = center - half;
  const right = center + half;
  const length = Math.abs(to - from);
  const radius = Math.min(4, half, length);
  if (length < 0.5) return '';
  if (to < from) return `M${left},${from}V${to + radius}Q${left},${to} ${left + radius},${to}H${right - radius}Q${right},${to} ${right},${to + radius}V${from}Z`;
  return `M${left},${from}V${to - radius}Q${left},${to} ${left + radius},${to}H${right - radius}Q${right},${to} ${right},${to - radius}V${from}Z`;
}

/** Line segments only between consecutive days that both have a value: gaps are never bridged. */
export function linePath(values: Array<number | null>, x: (index: number) => number, y: (value: number) => number): string {
  let path = '';
  values.forEach((value, index) => {
    if (value === null) return;
    path += `${index > 0 && values[index - 1] !== null ? 'L' : 'M'}${x(index)},${y(value)}`;
  });
  return path;
}

/** First, middle, and last date labels (year dropped), anchored so they never overflow the plot. */
export function dateLabels(dates: string[], x: (index: number) => number) {
  const count = dates.length;
  if (!count) return [];
  const picks = count <= 2 ? [...Array(count).keys()] : [0, Math.floor((count - 1) / 2), count - 1];
  return picks.map((index) => ({ index, x: x(index), label: formatCalendarDate(dates[index]).replace(/, \d{4}$/, ''),
    anchor: index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle' }));
}

/** Arrow-key navigation shared by every daily chart. */
export function nextIndex(key: string, current: number, count: number): number | null {
  const next = key === 'ArrowLeft' ? current - 1 : key === 'ArrowRight' ? current + 1 : key === 'Home' ? 0 : key === 'End' ? count - 1 : null;
  return next === null ? null : Math.min(Math.max(next, 0), count - 1);
}
