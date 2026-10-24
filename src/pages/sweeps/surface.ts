// ==========================================================================
// Sweep Studio — response-surface derivation (pure presentation model)
//
// Turns a flat SweepResult + its plan into a PlotSpec for either a 1-axis
// line chart (mean of repeats vs first axis) or a 2-axis multi-line surface
// (one line per second-axis level), plus the numeric grid the SVG heat map
// renders. Kept separate from React components so the math is unit-testable.
// ==========================================================================

import { summarizePoints } from '@/core/sweep/runner';
import type { SweepPlan, SweepResult } from '@/core/sweep/types';
import type { AxisValue } from '@/core/sweep/design';
import type { PlotSpec } from '@/core/plot';
import { fmt as fmtNum } from '../research/researchUi';

export const HEAT_COLORS = ['#08306b', '#2171b5', '#6baed6', '#fdae61', '#f46d43', '#d73027', '#a50f15'];

export function heatColor(value: number, low: number, high: number): string {
  if (!Number.isFinite(value) || high === low) return '#e5e5e5';
  const u = Math.min(1, Math.max(0, (value - low) / (high - low)));
  const index = Math.min(HEAT_COLORS.length - 1, Math.floor(u * HEAT_COLORS.length));
  return HEAT_COLORS[index]!;
}

export type ResponseSurface =
  | { kind: 'line'; spec: PlotSpec }
  | {
      kind: 'heat';
      spec: PlotSpec;
      xVals: number[];
      yVals: number[];
      grid: number[][];
      lo: number;
      hi: number;
      xName: string;
      yName: string;
    };

function sortedUniques(points: Array<{ params: Record<string, AxisValue> }>, name: string): number[] {
  return [...new Set(points.map((p) => Number(p.params[name])))].sort((a, b) => a - b);
}

/** Build the response surface, or null when the plan has no axes/points. */
export function buildSurface(plan: SweepPlan, result: SweepResult): ResponseSurface | null {
  const points = summarizePoints(result);
  const axisNames = plan.axes.map((a) => a.param);
  if (axisNames.length === 0 || points.length === 0) return null;

  const xName = axisNames[0]!;
  const xVals = sortedUniques(points, xName);

  if (axisNames.length === 1) {
    const spec: PlotSpec = {
      width: 620,
      height: 320,
      title: `${plan.metric} vs ${xName}`,
      xLabel: xName,
      yLabel: plan.metric,
      grid: true,
      series: [
        {
          name: plan.metric,
          kind: 'line',
          color: '#0072B2',
          points: xVals.map((x) => {
            const point = points.find((p) => Number(p.params[xName]) === x);
            return { x, y: point?.mean ?? Number.NaN };
          }),
        },
      ],
    };
    return { kind: 'line', spec };
  }

  const yName = axisNames[1]!;
  const yVals = sortedUniques(points, yName);
  const grid: number[][] = yVals.map((y) =>
    xVals.map((x) => {
      const point = points.find(
        (p) => Number(p.params[xName]) === x && Number(p.params[yName]) === y,
      );
      return point?.mean ?? Number.NaN;
    }),
  );
  const spec: PlotSpec = {
    width: 620,
    height: 320,
    title: `${plan.metric}: ${xName} × ${yName}`,
    xLabel: xName,
    yLabel: plan.metric,
    grid: true,
    legend: true,
    series: yVals.map((y, i) => ({
      name: `${yName}=${fmtNum(y, 4)}`,
      kind: 'line' as const,
      color: HEAT_COLORS[Math.round((i / Math.max(1, yVals.length - 1)) * (HEAT_COLORS.length - 1))]!,
      points: xVals.map((x) => {
        const point = points.find(
          (p) => Number(p.params[xName]) === x && Number(p.params[yName]) === y,
        );
        return { x, y: point?.mean ?? Number.NaN };
      }),
    })),
  };
  const flat = grid.flat().filter(Number.isFinite);
  const lo = flat.length > 0 ? Math.min(...flat) : Number.NaN;
  const hi = flat.length > 0 ? Math.max(...flat) : Number.NaN;
  return { kind: 'heat', spec, xVals, yVals, grid, lo, hi, xName, yName };
}
