// ==========================================================================
// FR-23 benchmark — compute kernels (CPU fallback path).
//
// Node has no WebGPU device, so the GPU kernels are benchmarked through the
// mathematically-equivalent CPU implementations exported by `wgsl.ts`
// (matmul / FFT / k-means / binning) — the same code the browser executes
// when `selectEngine` routes below-threshold data to the CPU. The recorded
// environment (node version + platform) makes the numbers comparable run to
// run, per FR-23's "fixed environment" rule.
//
// Workloads are fixed-size and seeded (mulberry32) → fully deterministic.
// ==========================================================================

import { mulberry32 } from '../repro/random';
import { matmulCPU, fftFullCPU, kmeansCPU, binningCPU } from '../wgsl';
import { median, timeBestOf, type BenchMetric, type BenchSuite } from './types';

const REPS = 5;

/** 256×256×256 matmul: 2·n³ = 33.55M FLOPs per rep. */
function benchMatmul(): number {
  const n = 256;
  const rnd = mulberry32(7);
  const a = new Float32Array(n * n);
  const b = new Float32Array(n * n);
  for (let i = 0; i < n * n; i += 1) {
    a[i] = rnd();
    b[i] = rnd();
  }
  const reps: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const ms = timeBestOf(1, () => {
      const c = matmulCPU(a, b, n, n, n);
      if (c[n * n - 1] === undefined) throw new Error('matmul: missing output');
    });
    reps.push(((2 * n * n * n) / ms) / 1e6); // GFLOP/s
  }
  return median(reps);
}

/** In-place radix-2 FFT of 4096 complex samples (kernel max, FFT_MAX_N).
 *  A single transform is sub-millisecond, so each rep batches 100 transforms
 *  and reports the per-transform mean — batching keeps the metric above the
 *  timer-noise floor and stable across runs. */
function benchFft(): number {
  const n = 4096;
  const batch = 100;
  const rnd = mulberry32(11);
  const data = new Float32Array(2 * n);
  for (let i = 0; i < 2 * n; i += 1) data[i] = rnd() * 2 - 1;
  const reps: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const ms = timeBestOf(1, () => {
      for (let i = 0; i < batch; i += 1) fftFullCPU(data, n);
    });
    reps.push(ms / batch);
  }
  return median(reps);
}

/** k-means: 20k points × 3 dims, k=8, ≤20 iterations (converges early). */
function benchKmeans(): number {
  const count = 20_000;
  const dim = 3;
  const k = 8;
  const rnd = mulberry32(23);
  const points = new Float32Array(count * dim);
  for (let i = 0; i < count * dim; i += 1) points[i] = rnd();
  const reps: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const ms = timeBestOf(1, () => {
      const res = kmeansCPU(points, count, dim, k, 20, 5);
      if (res.assignments.length !== count) throw new Error('kmeans: assignment drift');
    });
    reps.push(ms);
  }
  return median(reps);
}

/** Mean-binning of 200k key/value rows into 256 bins. Batched ×10 so one rep
 *  lasts long enough to escape JIT-tier noise. */
function benchBinning(): number {
  const rows = 200_000;
  const batch = 10;
  const bins = 256;
  const rnd = mulberry32(31);
  const keys = new Float32Array(rows);
  const values = new Float32Array(rows);
  for (let i = 0; i < rows; i += 1) {
    keys[i] = rnd();
    values[i] = rnd();
  }
  const reps: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const ms = timeBestOf(1, () => {
      for (let i = 0; i < batch; i += 1) {
        const res = binningCPU(keys, values, bins, 0, 1, 'mean');
        if (res.result.length !== bins) throw new Error('binning: bin drift');
      }
    });
    reps.push((rows * batch / ms) * 1000); // rows/s
  }
  return median(reps);
}

export function runComputeBench(): BenchSuite {
  const t0 = performance.now();

  // Warm-ups (JIT), not measured. FFT is warmed with a full-size batch so the
  // tiny per-transform cost is not dominated by first-call optimisation.
  benchMatmulOnce();
  benchFftOnce();
  benchFftOnce();
  benchKmeansOnce();
  benchBinningOnce();

  const matmulGflops = benchMatmul();
  const fftMs = benchFft();
  const kmeansMs = benchKmeans();
  const binningRowsPerSec = benchBinning();

  const metrics: BenchMetric[] = [
    {
      id: 'compute.matmul_gflops',
      label: 'Matmul CPU 内核（256³）',
      value: Math.round(matmulGflops * 100) / 100,
      unit: 'GFLOP/s',
      direction: 'up',
      workload: '256x256x256, seed=7',
    },
    {
      id: 'compute.fft_ms',
      label: 'FFT CPU 内核（4096 复数点）',
      value: Math.round(fftMs * 100) / 100,
      unit: 'ms',
      direction: 'down',
      workload: 'n=4096 radix-2, seed=11',
    },
    {
      id: 'compute.kmeans_ms',
      label: 'k-means CPU 内核（20k 点 × 3 维 × k8）',
      value: Math.round(kmeansMs * 100) / 100,
      unit: 'ms',
      direction: 'down',
      workload: '20000x3, k=8, maxIter=20, seed=23',
    },
    {
      id: 'compute.binning_rows_per_sec',
      label: '分箱聚合 CPU 内核（200k 行 → 256 箱）',
      value: Math.round(binningRowsPerSec),
      unit: 'rows/s',
      direction: 'up',
      workload: '200000 rows, 256 bins, seed=31',
    },
  ];

  return {
    name: 'compute',
    duration_ms: Math.round(performance.now() - t0),
    metrics,
  };
}

// Single-shot warm-up helpers (tiny fixed work, result discarded).
function benchMatmulOnce(): void {
  const a = new Float32Array(256 * 256);
  const b = new Float32Array(256 * 256);
  matmulCPU(a, b, 256, 256, 256);
}
function benchFftOnce(): void {
  const data = new Float32Array(2 * 4096);
  for (let i = 0; i < 20; i += 1) fftFullCPU(data, 4096);
}
function benchKmeansOnce(): void {
  const pts = new Float32Array(60);
  kmeansCPU(pts, 20, 3, 4, 2, 1);
}
function benchBinningOnce(): void {
  const keys = new Float32Array(200_000);
  const values = new Float32Array(200_000);
  for (let i = 0; i < 3; i += 1) binningCPU(keys, values, 256, 0, 1, 'mean');
}
