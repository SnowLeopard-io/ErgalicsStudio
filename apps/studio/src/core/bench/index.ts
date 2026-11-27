// ==========================================================================
// FR-23 benchmark suite entry point.
//
// `runAllBenchmarks()` executes the four key-path suites (import / compute /
// render / memory) and returns a structured result including environment
// info (Node version, platform, arch, CPU model, date). Designed to be run
// headlessly in Node via `scripts/bench-run.mjs`; the result is serialised
// to `bench-results.json` and diffed against `bench/baseline.json`.
// ==========================================================================

import { collectEnvironment, type BenchResults, type BenchSuite } from './types';
import { runImportBench } from './import-bench';
import { runComputeBench } from './compute-bench';
import { runRenderBench } from './render-bench';
import { runMemoryBench } from './memory-bench';

export { fpsProbe } from './render-bench';
export type { BenchMetric, BenchSuite, BenchEnvironment, BenchResults } from './types';

/**
 * Execute all suites sequentially (never concurrently — timing suites would
 * distort each other). `cpuModel` comes from the runner (Node `os.cpus()`),
 * keeping this module free of Node-only imports.
 */
export function runAllBenchmarks(cpuModel?: string): BenchResults {
  const suites: BenchSuite[] = [
    runImportBench(),
    runComputeBench(),
    runRenderBench(),
    runMemoryBench(),
  ];
  return {
    schema: 1,
    environment: collectEnvironment(cpuModel),
    suites,
  };
}
