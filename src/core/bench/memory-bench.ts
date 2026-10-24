// ==========================================================================
// FR-23 benchmark — memory footprint.
//
// Measures the Node heap delta around loading a large seeded dataset through
// the real import pipeline (CSV text → columnar DataTable). `process.
// memoryUsage()` is Node-only, so this suite is guarded: in a browser it
// reports 0-byte metrics (the benchmark page would use performance.memory
// in the future).
//
// Determinism: same seed → same input → near-identical retained heap; the
// ±10% band absorbs GC timing noise.
// ==========================================================================

import { parseDataText } from '@/blocks/fileData';
import { makeCsvSample } from './import-bench';
import type { BenchMetric, BenchSuite } from './types';

const ROWS = 200_000;

/**
 * Footprint = JS heap + ArrayBuffer backing stores. The DataTable's numeric
 * columns are Float64Arrays whose backing buffers live in V8's *external*
 * memory — `heapUsed` alone doesn't see them, so a heap-only "retained"
 * reading actually measured garbage accumulated during the import (which
 * scales with host speed, not with the table).
 */
function footprintBytes(): number {
  if (typeof process === 'undefined' || !process.memoryUsage) return 0;
  const mem = process.memoryUsage();
  return mem.heapUsed + (mem.arrayBuffers ?? 0);
}

export function runMemoryBench(): BenchSuite {
  const t0 = performance.now();
  const csv = makeCsvSample(ROWS);
  const inputBytes = new TextEncoder().encode(csv).length;

  const hasNodeHeap = typeof process !== 'undefined' && typeof process.memoryUsage === 'function';
  let tableRetainedKb = 0;
  let peakKb = 0;

  if (hasNodeHeap) {
    // Force a GC baseline when --expose-gc is available (bench-run passes it);
    // otherwise fall back to the raw reading (still comparable run to run).
    const gc = (globalThis as { gc?: () => void }).gc;
    if (gc) gc();
    const before = footprintBytes();
    const table = parseDataText(csv, 'memory.csv');
    if (table.length !== ROWS) throw new Error('memory bench: row count drift');
    // Force a second GC before measuring the retained delta: without it the
    // reading includes young-gen garbage whose amount depends on GC timing,
    // which varies with host speed (a slower CI runner accumulated more
    // garbage and reported ~+18% "retained" on identical input).
    if (gc) gc();
    const settled = footprintBytes();
    tableRetainedKb = Math.max(0, Math.round((settled - before) / 1024));
    // Post-GC total footprint (idle heap + table): deterministic, unlike the
    // raw post-import reading whose garbage content scales with host speed.
    peakKb = Math.round(settled / 1024);
    void table; // keep the table alive until after the measurement
  }

  const metrics: BenchMetric[] = [
    {
      id: 'memory.table_retained_kb',
      label: `大表加载堆增量（${ROWS} 行 CSV → DataTable）`,
      value: tableRetainedKb,
      unit: 'KB',
      direction: 'down',
      workload: `${ROWS} rows, seed=42`,
    },
    {
      id: 'memory.heap_peak_kb',
      label: `加载后驻留足迹（GC 后，${ROWS} 行 CSV → DataTable）`,
      value: peakKb,
      unit: 'KB',
      direction: 'down',
      workload: `${ROWS} rows, seed=42`,
    },
    {
      id: 'memory.input_bytes',
      label: '输入样本大小',
      value: inputBytes,
      unit: 'B',
      direction: 'down',
      workload: `${ROWS} rows, seed=42`,
    },
  ];

  return {
    name: 'memory',
    duration_ms: Math.round(performance.now() - t0),
    metrics,
  };
}
