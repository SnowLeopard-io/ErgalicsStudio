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

function heapUsedBytes(): number {
  return typeof process !== 'undefined' && process.memoryUsage
    ? process.memoryUsage().heapUsed
    : 0;
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
    const before = heapUsedBytes();
    const table = parseDataText(csv, 'memory.csv');
    if (table.length !== ROWS) throw new Error('memory bench: row count drift');
    const after = heapUsedBytes();
    tableRetainedKb = Math.max(0, Math.round((after - before) / 1024));
    peakKb = Math.round(after / 1024);
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
      label: '加载后堆峰值',
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
