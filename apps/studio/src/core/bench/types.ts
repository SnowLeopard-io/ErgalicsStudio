// ==========================================================================
// FR-23 performance benchmark suite — shared types (pure TS, no DOM).
//
// Every benchmark emits one or more `BenchMetric`s keyed by a stable id so
// `scripts/bench-compare.mjs` can diff runs against `bench/baseline.json`.
// `direction` tells the comparator whether a larger value is better
// ('up' = throughput) or a smaller value is better ('down' = latency/memory).
// ==========================================================================

/** Metric polarity: 'up' → higher is better, 'down' → lower is better. */
export type BenchDirection = 'up' | 'down';

export interface BenchMetric {
  /** Stable key, e.g. `import.csv_rows_per_sec`. */
  id: string;
  /** Human label for the report page. */
  label: string;
  value: number;
  unit: string;
  direction: BenchDirection;
  /** Fixed workload description (rows / elements / iterations). */
  workload: string;
}

export interface BenchSuite {
  /** 'import' | 'compute' | 'render' | 'memory'. */
  name: string;
  /** Wall-clock duration of the whole suite, ms. */
  duration_ms: number;
  metrics: BenchMetric[];
}

export interface BenchEnvironment {
  node: string;
  platform: string;
  arch: string;
  cpu: string;
  date: string;
  /** Which runtime executed the suite ('node' in CI, browser id in future). */
  runtime: string;
}

export interface BenchResults {
  schema: 1;
  environment: BenchEnvironment;
  suites: BenchSuite[];
}

/**
 * Collect environment info; safe in both Node and a browser. The CPU model is
 * passed in by the runner (Node's `os.cpus()`) so this module never imports
 * `node:os` and stays browser-safe.
 */
export function collectEnvironment(cpuModel?: string): BenchEnvironment {
  const proc = typeof process !== 'undefined' ? process : undefined;
  return {
    node: proc?.version ?? 'browser',
    platform: proc?.platform ?? 'web',
    arch: proc?.arch ?? 'wasm',
    cpu: cpuModel ?? 'unknown',
    date: new Date().toISOString(),
    runtime: proc ? 'node' : 'browser',
  };
}

/** Median of a numeric array (deterministic; used to damp run-to-run jitter). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Best-of-N timing helper: returns the minimum elapsed ms (least noise). */
export function timeBestOf(reps: number, fn: () => void): number {
  let best = Infinity;
  for (let i = 0; i < reps; i += 1) {
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    if (dt < best) best = dt;
  }
  return best;
}
