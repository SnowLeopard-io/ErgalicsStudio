// ==========================================================================
// FR-23 benchmark — render path (data preparation).
//
// True frame-rate sampling is impossible in Node: browser FPS is collected
// manually from the workbench performance dashboard (workbench.perf), and
// this benchmark page can additionally run the exported `fpsProbe()` inside a
// browser. What IS benchmarkable headlessly — and what actually regresses
// when the render pipeline changes — is the *data preparation* the render
// path performs before drawing:
//   1. chart-spec construction from a big DataTable (plot/charts pipeline);
//   2. table virtualization windowing (slice + row materialisation, the same
//      transform VirtualTable performs per scroll).
// Both run on fixed, seeded input → deterministic.
// ==========================================================================

import { mulberry32 } from '../repro/random';
import { createDataTable } from '@/types/datatable';
import { dataTableToHistogram, dataTableToLine } from '@/core/plot/charts';
import { median, timeBestOf, type BenchMetric, type BenchSuite } from './types';

const ROWS = 100_000;
const REPS = 5;

/** Build a deterministic 3-column numeric table. */
export function makeRenderTable(rows: number, seed = 42) {
  const rnd = mulberry32(seed);
  const x = new Float64Array(rows);
  const y = new Float64Array(rows);
  const t = new Float64Array(rows);
  for (let i = 0; i < rows; i += 1) {
    x[i] = i;
    y[i] = Math.sin(i * 0.001) * rnd() * 10;
    t[i] = rnd() * 100;
  }
  return createDataTable('bench', [
    { name: 'x', type: 'f64', data: x },
    { name: 'y', type: 'f64', data: y },
    { name: 'temp', type: 'f64', data: t },
  ]);
}

/**
 * Pure FPS probe for browser use (FR-23 render-frame path). Feed it the
 * `performance.now()` timestamps of successive rAF callbacks; it returns the
 * estimated frames-per-second over the sampled window. Exported for the
 * benchmark report page / future automation; Node runs skip FPS entirely.
 */
export function fpsProbe(frames: number[]): number {
  if (frames.length < 2) return 0;
  const span = frames[frames.length - 1]! - frames[0]!;
  if (span <= 0) return 0;
  return ((frames.length - 1) / span) * 1000;
}

function benchChartSpec(table: ReturnType<typeof makeRenderTable>): number {
  // Chart-spec building allocates ~100k point objects per call, so individual
  // timings are GC-sensitive. Best-of-7 over the full workload keeps the
  // metric at its GC-free floor → stable run to run.
  return timeBestOf(7, () => {
    const line = dataTableToLine(table, 'x', 'y');
    const hist = dataTableToHistogram(table, 'temp', { bins: 64 });
    if (line.series.length !== 1 || hist.series.length !== 1) {
      throw new Error('render bench: unexpected series count');
    }
  });
}

function benchVirtualization(table: ReturnType<typeof makeRenderTable>): number {
  const viewportRows = 40;
  // Workload sizing matters: at 200 steps a single pass is a few µs and
  // swings ±50% on shared runners (CPU freq stepping, context switches),
  // making the metric un-gateable. Empirically scrolls=1000 lands in the
  // stable band: JIT fully warmed, one pass ≈ sub-ms, run-to-run CV < 1%
  // (measured b5/r5). Longer workloads (≥5000) start drifting again as the
  // window spans a turbo/quiet cycle.
  const scrolls = 1000;
  const batch = 5;
  const reps: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    // Best-of-N over the full scroll workload, same policy as benchChartSpec:
    // taking the GC-free floor keeps the metric stable run to run.
    const ms = timeBestOf(7, () => {
      for (let b = 0; b < batch; b += 1) {
        // Emulate 1000 scroll steps: materialise the visible window each time.
        for (let s = 0; s < scrolls; s += 1) {
          const start = Math.floor((s / scrolls) * (table.length - viewportRows));
          const xCol = table.getColumn('x') as Float64Array;
          const yCol = table.getColumn('y') as Float64Array;
          let checksum = 0;
          for (let i = start; i < start + viewportRows; i += 1) {
            checksum += xCol[i]! + yCol[i]!;
          }
          if (!Number.isFinite(checksum)) throw new Error('render bench: bad window');
        }
      }
    });
    reps.push((scrolls * batch / ms) * 1000); // scroll-steps/s
  }
  return median(reps);
}

export function runRenderBench(): BenchSuite {
  const t0 = performance.now();
  const table = makeRenderTable(ROWS);

  // Warm-ups (JIT): both chart builders run at full size before measurement.
  dataTableToLine(table, 'x', 'y');
  dataTableToHistogram(table, 'temp', { bins: 64 });
  dataTableToLine(table, 'x', 'y');
  // Same for the virtualization loop — a fresh Node process starts with a
  // cold JIT; the first passes of the window loop are still being compiled
  // and would drag the best-of floor down.
  const w = 40;
  for (let s = 0; s < 1000; s += 1) {
    const start = Math.floor((s / 1000) * (table.length - w));
    const x = table.getColumn('x') as Float64Array;
    const y = table.getColumn('y') as Float64Array;
    for (let i = start; i < start + w; i += 1) void (x[i]! + y[i]!);
  }

  const chartMs = benchChartSpec(table);
  const scrollStepsPerSec = benchVirtualization(table);

  const metrics: BenchMetric[] = [
    {
      id: 'render.chart_spec_ms',
      label: `图表数据准备（折线+直方图，${ROWS} 行）`,
      value: Math.round(chartMs * 100) / 100,
      unit: 'ms',
      direction: 'down',
      workload: `${ROWS} rows, seed=42`,
    },
    {
      id: 'render.virtual_scroll_steps_per_sec',
      label: '表格虚拟化窗口变换（1000 次滚动）',
      value: Math.round(scrollStepsPerSec),
      unit: 'steps/s',
      direction: 'up',
      workload: `${ROWS} rows, window=40, 1000 steps, best-of-7`,
    },
  ];

  return {
    name: 'render',
    duration_ms: Math.round(performance.now() - t0),
    metrics,
  };
}
