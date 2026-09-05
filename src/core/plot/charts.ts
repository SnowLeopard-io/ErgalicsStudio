// ==========================================================================
// Ergalics Studio — DataTable → PlotSpec adapters (pure TS)
//
// Thin, testable layer: pull numeric columns out of a DataTable and shape
// them into a PlotSpec the renderer understands. Keeps all layout/tick logic
// in svg.ts.
// ==========================================================================

import { asFloat64 } from '@/blocks/ops';
import type { DataTable } from '@/types/datatable';
import type { CategoricalTicks, PlotSeries, PlotSpec } from './types';

const DEFAULT_COLOR = '#1f77b4';
const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];

function colorAt(i: number): string {
  return PALETTE[i % PALETTE.length]!;
}

function pairPoints(
  table: DataTable,
  xCol: string,
  yCol: string,
): Array<{ x: number; y: number }> {
  const xs = asFloat64(table, xCol);
  const ys = asFloat64(table, yCol);
  const n = Math.min(xs.length, ys.length);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(xs[i] ?? NaN) && Number.isFinite(ys[i] ?? NaN))
      out.push({ x: xs[i] ?? NaN, y: ys[i] ?? NaN });
  }
  return out;
}

export interface ChartOptions {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  color?: string;
  /** Preserve input order for line charts (default: sort by x). */
  sortX?: boolean;
}

export function dataTableToLine(
  table: DataTable,
  xCol: string,
  yCol: string,
  opts: ChartOptions = {},
): PlotSpec {
  let pts = pairPoints(table, xCol, yCol);
  if (opts.sortX !== false) pts = pts.slice().sort((a, b) => a.x - b.x);
  const series: PlotSeries[] = [
    { name: yCol, kind: 'line', color: opts.color ?? DEFAULT_COLOR, points: pts },
  ];
  return {
    width: 640,
    height: 420,
    title: opts.title,
    xLabel: opts.xLabel ?? xCol,
    yLabel: opts.yLabel ?? yCol,
    series,
  };
}

export function dataTableToScatter(
  table: DataTable,
  xCol: string,
  yCol: string,
  opts: ChartOptions = {},
): PlotSpec {
  const pts = pairPoints(table, xCol, yCol);
  const series: PlotSeries[] = [
    { name: yCol, kind: 'scatter', color: opts.color ?? DEFAULT_COLOR, points: pts },
  ];
  return {
    width: 640,
    height: 420,
    title: opts.title,
    xLabel: opts.xLabel ?? xCol,
    yLabel: opts.yLabel ?? yCol,
    series,
  };
}

export function dataTableToHistogram(
  table: DataTable,
  col: string,
  opts: ChartOptions & { bins?: number } = {},
): PlotSpec {
  const vals = asFloat64(table, col).filter(Number.isFinite);
  const n = vals.length;
  if (n === 0) {
    return { width: 640, height: 420, title: opts.title, xLabel: opts.xLabel ?? col, yLabel: opts.yLabel ?? 'count', series: [] };
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const bins = opts.bins && opts.bins > 0 ? opts.bins : Math.max(1, Math.ceil(Math.log2(n)) + 1);
  const span = max - min || 1;
  const w = span / bins;
  const counts = new Array(bins).fill(0);
  for (const v of vals) {
    let idx = Math.floor((v - min) / w);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx] += 1;
  }
  const bars = counts.map((c, i) => ({ x0: min + i * w, x1: min + (i + 1) * w, y: c }));
  const series: PlotSeries[] = [
    { name: `${col} (n=${n})`, kind: 'histogram', color: opts.color ?? DEFAULT_COLOR, bars },
  ];
  return {
    width: 640,
    height: 420,
    title: opts.title,
    xLabel: opts.xLabel ?? col,
    yLabel: opts.yLabel ?? 'count',
    series,
  };
}

export function dataTableToBar(
  table: DataTable,
  col: string,
  opts: ChartOptions = {},
): PlotSpec {
  const raw = asFloat64(table, col);
  const counts = new Map<string, number>();
  for (const v of raw) {
    if (!Number.isFinite(v)) continue;
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  const bars = entries.map(([, c], i) => ({ x0: i, x1: i + 0.8, y: c }));
  const series: PlotSeries[] = [
    { name: col, kind: 'bar', color: opts.color ?? DEFAULT_COLOR, bars },
  ];
  const ticks: CategoricalTicks[] = entries.map(([k], i) => ({ pos: i + 0.4, label: k }));
  return {
    width: 640,
    height: 420,
    title: opts.title,
    xLabel: opts.xLabel ?? col,
    yLabel: opts.yLabel ?? 'count',
    series,
    xDomain: [-0.4, Math.max(0.6, entries.length - 0.2)],
    xTicksOverride: ticks,
  };
}

void colorAt;
