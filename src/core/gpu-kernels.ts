// ==========================================================================
// GPU kernel extension (spec FR-12): matmul / FFT / k-means / binning.
//
// Routing + orchestration for the four WGSL kernels defined in `wgsl.ts`.
// Each `*Async` entry point picks an engine with `selectEngine` (data size
// vs. `GPU_KERNEL_THRESHOLDS`, plus live device availability), runs the GPU
// path through the compute service when chosen, and always falls back to the
// mathematically equivalent CPU implementation — a missing device, a failed
// compile or a failed dispatch must never fail the computation itself.
//
// Every execution reports wall time and device-memory footprint to the perf
// recorder (see `perf.ts` → `recordKernelExecution`).
// ==========================================================================

import { logger } from './logger';
import { getGpuCompute } from './compute';
import { recordKernelExecution } from './perf';
import type { ComputeBufferHandle, GpuKernelDescriptor } from '@/types/plugin';
import {
  MATMUL_TILE,
  MATMUL_A_USAGE,
  MATMUL_B_USAGE,
  MATMUL_C_USAGE,
  MATMUL_PARAMS_USAGE,
  MATMUL_BINDINGS,
  matmulKernelWGSL,
  matmulCPU,
  matmulBytes,
  packMatMulParams,
  FFT_DATA_USAGE,
  FFT_PARAMS_USAGE,
  FFT_BINDINGS,
  fftKernelWGSL,
  fftFullCPU,
  fftBytes,
  fftStageCount,
  packFFTParams,
  KMEANS_POINTS_USAGE,
  KMEANS_CENTROIDS_USAGE,
  KMEANS_ASSIGNMENTS_USAGE,
  KMEANS_SUMS_USAGE,
  KMEANS_COUNTS_USAGE,
  KMEANS_PARAMS_USAGE,
  KMEANS_BINDINGS,
  kmeansKernelWGSL,
  kmeansCPU,
  kmeansInitCentroids,
  kmeansSumsBytes,
  kmeansCountsBytes,
  packKMeansParams,
  BINNING_KEYS_USAGE,
  BINNING_VALUES_USAGE,
  BINNING_SUMS_USAGE,
  BINNING_COUNTS_USAGE,
  BINNING_PARAMS_USAGE,
  BINNING_BINDINGS,
  binningKernelWGSL,
  binningCPU,
  binningSumsBytes,
  packBinningParams,
  SPMV_INDPTR_USAGE,
  SPMV_INDICES_USAGE,
  SPMV_VALUES_USAGE,
  SPMV_X_USAGE,
  SPMV_Y_USAGE,
  SPMV_PARAMS_USAGE,
  SPMV_BINDINGS,
  spmvKernelWGSL,
  spmvCPU,
  spmvBytes,
  packSpmvParams,
  type BinningMode,
  type BinningResult,
  type KMeansResult,
} from './wgsl';

/**
 * Data-scale thresholds above which the GPU path is worth its upload/readback
 * overhead (spec FR-12). Units: matmul = output elements (m×n), fft = complex
 * samples, kmeans = points, binning = rows, spmv = stored entries (nnz).
 */
export const GPU_KERNEL_THRESHOLDS = {
  matmul: 128 * 128,
  fft: 1024,
  kmeans: 2048,
  binning: 10000,
  spmv: 65536,
} as const;

export type GpuKernelKind = keyof typeof GPU_KERNEL_THRESHOLDS;

/** Explicit engine override; 'auto' routes through `selectEngine`. */
export type KernelEngineChoice = 'auto' | 'gpu' | 'cpu';

export interface KernelRunOptions {
  engine?: KernelEngineChoice;
}

/** Pure routing decision: GPU only when available *and* the data is big enough. */
export function selectEngine(
  size: number,
  threshold: number,
  gpuAvailable: boolean,
): 'gpu' | 'cpu' {
  return gpuAvailable && size >= threshold ? 'gpu' : 'cpu';
}

// ---- Kernel descriptors ---------------------------------------------------
//
// The bind group layout is derived from the `*_BINDINGS` constants in
// `wgsl.ts`, so the host descriptor and the shader text cannot drift apart
// (the tests assert both against the same source of truth).

export function matmulKernelDescriptor(): GpuKernelDescriptor {
  return {
    label: 'matmul',
    wgsl: matmulKernelWGSL(),
    workgroupSize: [MATMUL_TILE, MATMUL_TILE, 1],
    bindings: [
      { binding: MATMUL_BINDINGS.A, bufferType: 'read-only-storage' },
      { binding: MATMUL_BINDINGS.B, bufferType: 'read-only-storage' },
      { binding: MATMUL_BINDINGS.PARAMS, bufferType: 'uniform' },
      { binding: MATMUL_BINDINGS.C, bufferType: 'storage' },
    ],
  };
}

export function fftKernelDescriptor(): GpuKernelDescriptor {
  return {
    label: 'fft',
    wgsl: fftKernelWGSL(),
    workgroupSize: [64, 1, 1],
    bindings: [
      { binding: FFT_BINDINGS.DATA, bufferType: 'storage' },
      { binding: FFT_BINDINGS.PARAMS, bufferType: 'uniform' },
    ],
  };
}

export function kmeansKernelDescriptor(): GpuKernelDescriptor {
  return {
    label: 'kmeans-assign',
    wgsl: kmeansKernelWGSL(),
    workgroupSize: [64, 1, 1],
    bindings: [
      { binding: KMEANS_BINDINGS.POINTS, bufferType: 'read-only-storage' },
      { binding: KMEANS_BINDINGS.CENTROIDS, bufferType: 'read-only-storage' },
      { binding: KMEANS_BINDINGS.ASSIGNMENTS, bufferType: 'storage' },
      { binding: KMEANS_BINDINGS.SUMS, bufferType: 'storage' },
      { binding: KMEANS_BINDINGS.COUNTS, bufferType: 'storage' },
      { binding: KMEANS_BINDINGS.PARAMS, bufferType: 'uniform' },
    ],
  };
}

export function binningKernelDescriptor(): GpuKernelDescriptor {
  return {
    label: 'binning',
    wgsl: binningKernelWGSL(),
    workgroupSize: [64, 1, 1],
    bindings: [
      { binding: BINNING_BINDINGS.KEYS, bufferType: 'read-only-storage' },
      { binding: BINNING_BINDINGS.VALUES, bufferType: 'read-only-storage' },
      { binding: BINNING_BINDINGS.PARAMS, bufferType: 'uniform' },
      { binding: BINNING_BINDINGS.SUMS, bufferType: 'storage' },
      { binding: BINNING_BINDINGS.COUNTS, bufferType: 'storage' },
    ],
  };
}

export function spmvKernelDescriptor(): GpuKernelDescriptor {
  return {
    label: 'spmv',
    wgsl: spmvKernelWGSL(),
    workgroupSize: [64, 1, 1],
    bindings: [
      { binding: SPMV_BINDINGS.INDPTR, bufferType: 'read-only-storage' },
      { binding: SPMV_BINDINGS.INDICES, bufferType: 'read-only-storage' },
      { binding: SPMV_BINDINGS.VALUES, bufferType: 'read-only-storage' },
      { binding: SPMV_BINDINGS.X, bufferType: 'read-only-storage' },
      { binding: SPMV_BINDINGS.Y, bufferType: 'storage' },
      { binding: SPMV_BINDINGS.PARAMS, bufferType: 'uniform' },
    ],
  };
}

// ---- Shared helpers --------------------------------------------------------

function report(
  kernel: string,
  engine: 'gpu' | 'cpu',
  started: number,
  memoryBytes: number,
): void {
  recordKernelExecution({
    kernel,
    engine,
    durationMs: performance.now() - started,
    memoryBytes,
  });
}

// ---- matmul ----------------------------------------------------------------

/** C = A × B (row-major f32). Auto-routes GPU/CPU by `m*n` vs. threshold. */
export async function matmulAsync(
  a: Float32Array,
  b: Float32Array,
  m: number,
  k: number,
  n: number,
  opts: KernelRunOptions = {},
): Promise<Float32Array> {
  const started = performance.now();
  const gpu = await tryMatmulGpu(a, b, m, k, n, opts.engine);
  if (gpu) {
    report('matmul', 'gpu', started, matmulBytes(m, k) + matmulBytes(k, n) + matmulBytes(m, n) + 16);
    return gpu;
  }
  const c = matmulCPU(a, b, m, k, n);
  report('matmul', 'cpu', started, matmulBytes(m, k) + matmulBytes(k, n) + matmulBytes(m, n));
  return c;
}

async function tryMatmulGpu(
  a: Float32Array,
  b: Float32Array,
  m: number,
  k: number,
  n: number,
  engine: KernelEngineChoice = 'auto',
): Promise<Float32Array | null> {
  const compute = getGpuCompute();
  if (!compute) return null;
  if (engine === 'cpu') return null;
  if (engine === 'auto' && selectEngine(m * n, GPU_KERNEL_THRESHOLDS.matmul, true) === 'cpu') {
    return null;
  }
  const buffers: ComputeBufferHandle[] = [];
  try {
    const kernel = compute.compileKernel(matmulKernelDescriptor());
    if (!kernel) return null;
    const aBuf = compute.createBuffer(matmulBytes(m, k), MATMUL_A_USAGE, 'matmul-a');
    const bBuf = compute.createBuffer(matmulBytes(k, n), MATMUL_B_USAGE, 'matmul-b');
    const cBuf = compute.createBuffer(matmulBytes(m, n), MATMUL_C_USAGE, 'matmul-c');
    const pBuf = compute.createBuffer(16, MATMUL_PARAMS_USAGE, 'matmul-params');
    if (!aBuf || !bBuf || !cBuf || !pBuf) return null;
    buffers.push(aBuf, bBuf, cBuf, pBuf);
    aBuf.write(a);
    bBuf.write(b);
    pBuf.write(new Uint8Array(packMatMulParams(m, k, n)));
    const ok = compute.run(
      kernel,
      [aBuf, bBuf, pBuf, cBuf],
      Math.ceil(n / MATMUL_TILE),
      Math.ceil(m / MATMUL_TILE),
      1,
    );
    if (!ok) return null;
    const ab = await cBuf.read();
    return new Float32Array(ab, 0, m * n);
  } catch (err) {
    logger.warn('gpu-kernels', 'matmul GPU path failed, using CPU', err);
    return null;
  } finally {
    for (const buf of buffers) buf.destroy();
  }
}

// ---- fft -------------------------------------------------------------------

/**
 * In-place radix-2 FFT on an interleaved [re, im] buffer (length 2*n, n a
 * power of two ≤ 4096). The GPU path dispatches one pass per butterfly stage;
 * the CPU path runs the identical stage sequence. Returns the transformed
 * copy (the input buffer is never mutated).
 */
export async function fftAsync(
  data: Float32Array,
  n: number,
  opts: KernelRunOptions = {},
): Promise<Float32Array> {
  const started = performance.now();
  const out = new Float32Array(data);
  const gpu = await tryFftGpu(out, n, opts.engine);
  if (gpu) {
    report('fft', 'gpu', started, fftBytes(n) + 16);
    return gpu;
  }
  fftFullCPU(out, n);
  report('fft', 'cpu', started, fftBytes(n));
  return out;
}

async function tryFftGpu(
  data: Float32Array,
  n: number,
  engine: KernelEngineChoice = 'auto',
): Promise<Float32Array | null> {
  const compute = getGpuCompute();
  if (!compute) return null;
  if (engine === 'cpu') return null;
  if (engine === 'auto' && selectEngine(n, GPU_KERNEL_THRESHOLDS.fft, true) === 'cpu') {
    return null;
  }
  const buffers: ComputeBufferHandle[] = [];
  try {
    const kernel = compute.compileKernel(fftKernelDescriptor());
    if (!kernel) return null;
    const dataBuf = compute.createBuffer(fftBytes(n), FFT_DATA_USAGE, 'fft-data');
    const pBuf = compute.createBuffer(16, FFT_PARAMS_USAGE, 'fft-params');
    if (!dataBuf || !pBuf) return null;
    buffers.push(dataBuf, pBuf);
    dataBuf.write(data);
    const stages = fftStageCount(n);
    // The queue executes submissions in order, so all passes can be enqueued
    // back-to-back and only the final buffer state needs a readback.
    for (let stage = 0; stage <= stages; stage += 1) {
      pBuf.write(new Uint8Array(packFFTParams(n, stage)));
      const threads = stage === 0 ? n : n / 2;
      const ok = compute.run(kernel, [dataBuf, pBuf], Math.ceil(threads / 64), 1, 1);
      if (!ok) return null;
    }
    const ab = await dataBuf.read();
    return new Float32Array(ab, 0, n * 2);
  } catch (err) {
    logger.warn('gpu-kernels', 'fft GPU path failed, using CPU', err);
    return null;
  } finally {
    for (const buf of buffers) buf.destroy();
  }
}

// ---- kmeans ----------------------------------------------------------------

/**
 * Lloyd k-means. The GPU path runs the assignment+reduction kernel per
 * iteration (the O(k·dim) centroid update is host-side); the CPU path runs
 * the same loop in `kmeansCPU`. Both start from `kmeansInitCentroids(seed)`,
 * so results agree within float tolerance.
 */
export async function kmeansAsync(
  points: Float32Array,
  count: number,
  dim: number,
  k: number,
  maxIter: number,
  seed: number,
  opts: KernelRunOptions = {},
): Promise<KMeansResult> {
  const started = performance.now();
  const gpu = await tryKMeansGpu(points, count, dim, k, maxIter, seed, opts.engine);
  if (gpu) {
    report(
      'kmeans',
      'gpu',
      started,
      count * dim * 4 + k * dim * 4 + count * 4 + k * dim * 4 + k * 4 + 16,
    );
    return gpu;
  }
  const cpu = kmeansCPU(points, count, dim, k, maxIter, seed);
  report('kmeans', 'cpu', started, count * dim * 4 + k * dim * 4);
  return cpu;
}

async function tryKMeansGpu(
  points: Float32Array,
  count: number,
  dim: number,
  k: number,
  maxIter: number,
  seed: number,
  engine: KernelEngineChoice = 'auto',
): Promise<KMeansResult | null> {
  const compute = getGpuCompute();
  if (!compute) return null;
  if (engine === 'cpu') return null;
  if (engine === 'auto' && selectEngine(count, GPU_KERNEL_THRESHOLDS.kmeans, true) === 'cpu') {
    return null;
  }
  const buffers: ComputeBufferHandle[] = [];
  try {
    const kernel = compute.compileKernel(kmeansKernelDescriptor());
    if (!kernel) return null;
    const pointsBuf = compute.createBuffer(count * dim * 4, KMEANS_POINTS_USAGE, 'kmeans-points');
    const centroidsBuf = compute.createBuffer(
      k * dim * 4,
      KMEANS_CENTROIDS_USAGE,
      'kmeans-centroids',
    );
    const assignBuf = compute.createBuffer(count * 4, KMEANS_ASSIGNMENTS_USAGE, 'kmeans-assign');
    const sumsBuf = compute.createBuffer(kmeansSumsBytes(k, dim), KMEANS_SUMS_USAGE, 'kmeans-sums');
    const countsBuf = compute.createBuffer(kmeansCountsBytes(k), KMEANS_COUNTS_USAGE, 'kmeans-counts');
    const pBuf = compute.createBuffer(16, KMEANS_PARAMS_USAGE, 'kmeans-params');
    if (!pointsBuf || !centroidsBuf || !assignBuf || !sumsBuf || !countsBuf || !pBuf) return null;
    buffers.push(pointsBuf, centroidsBuf, assignBuf, sumsBuf, countsBuf, pBuf);
    pointsBuf.write(points);
    pBuf.write(new Uint8Array(packKMeansParams(count, k, dim)));
    const centroids = kmeansInitCentroids(points, count, dim, k, seed);
    const zeroSums = new Uint8Array(kmeansSumsBytes(k, dim));
    const zeroCounts = new Uint8Array(kmeansCountsBytes(k));
    let assignments = new Uint32Array(count);
    let iterations = 0;
    for (let it = 0; it < maxIter; it += 1) {
      iterations = it + 1;
      centroidsBuf.write(centroids);
      sumsBuf.write(zeroSums);
      countsBuf.write(zeroCounts);
      const ok = compute.run(
        kernel,
        [pointsBuf, centroidsBuf, assignBuf, sumsBuf, countsBuf, pBuf],
        Math.ceil(count / 64),
        1,
        1,
      );
      if (!ok) return null;
      const sumsAb = await sumsBuf.read();
      const countsAb = await countsBuf.read();
      const assignAb = await assignBuf.read();
      assignments = new Uint32Array(assignAb, 0, count).slice();
      // The sums buffer holds f32 bit patterns (u32 atomics, see the kernel).
      const sums = new Float32Array(sumsAb, 0, k * dim);
      const counts = new Uint32Array(countsAb, 0, k);
      let changed = false;
      for (let c = 0; c < k; c += 1) {
        const n = counts[c] ?? 0;
        if (n === 0) continue; // empty cluster keeps its previous centroid
        for (let d = 0; d < dim; d += 1) {
          const next = (sums[c * dim + d] ?? 0) / n;
          if (centroids[c * dim + d] !== next) changed = true;
          centroids[c * dim + d] = next;
        }
      }
      if (!changed) break;
    }
    return { centroids, assignments, iterations };
  } catch (err) {
    logger.warn('gpu-kernels', 'kmeans GPU path failed, using CPU', err);
    return null;
  } finally {
    for (const buf of buffers) buf.destroy();
  }
}

// ---- binning ---------------------------------------------------------------

/**
 * Bin `keys` into `bins` buckets over [min, max] and aggregate `values`
 * (sum | mean | count). Auto-routes GPU/CPU by row count vs. threshold.
 */
export async function binningAsync(
  keys: Float32Array,
  values: Float32Array,
  bins: number,
  min: number,
  max: number,
  mode: BinningMode,
  opts: KernelRunOptions = {},
): Promise<BinningResult> {
  const started = performance.now();
  const count = keys.length;
  const gpu = await tryBinningGpu(keys, values, bins, min, max, mode, opts.engine);
  if (gpu) {
    report('binning', 'gpu', started, count * 4 * 2 + bins * 4 * 2 + 32);
    return gpu;
  }
  const cpu = binningCPU(keys, values, bins, min, max, mode);
  report('binning', 'cpu', started, count * 4 * 2 + bins * 4 * 2);
  return cpu;
}

async function tryBinningGpu(
  keys: Float32Array,
  values: Float32Array,
  bins: number,
  min: number,
  max: number,
  mode: BinningMode,
  engine: KernelEngineChoice = 'auto',
): Promise<BinningResult | null> {
  const compute = getGpuCompute();
  if (!compute) return null;
  if (engine === 'cpu') return null;
  const count = keys.length;
  if (engine === 'auto' && selectEngine(count, GPU_KERNEL_THRESHOLDS.binning, true) === 'cpu') {
    return null;
  }
  const buffers: ComputeBufferHandle[] = [];
  try {
    const kernel = compute.compileKernel(binningKernelDescriptor());
    if (!kernel) return null;
    const keysBuf = compute.createBuffer(count * 4, BINNING_KEYS_USAGE, 'binning-keys');
    const valuesBuf = compute.createBuffer(count * 4, BINNING_VALUES_USAGE, 'binning-values');
    const sumsBuf = compute.createBuffer(binningSumsBytes(bins), BINNING_SUMS_USAGE, 'binning-sums');
    const countsBuf = compute.createBuffer(binningSumsBytes(bins), BINNING_COUNTS_USAGE, 'binning-counts');
    const pBuf = compute.createBuffer(32, BINNING_PARAMS_USAGE, 'binning-params');
    if (!keysBuf || !valuesBuf || !sumsBuf || !countsBuf || !pBuf) return null;
    buffers.push(keysBuf, valuesBuf, sumsBuf, countsBuf, pBuf);
    keysBuf.write(keys);
    valuesBuf.write(values);
    sumsBuf.write(new Uint8Array(binningSumsBytes(bins)));
    countsBuf.write(new Uint8Array(binningSumsBytes(bins)));
    pBuf.write(new Uint8Array(packBinningParams(min, max, bins, count, mode)));
    const ok = compute.run(
      kernel,
      [keysBuf, valuesBuf, pBuf, sumsBuf, countsBuf],
      Math.ceil(count / 64),
      1,
      1,
    );
    if (!ok) return null;
    const sumsAb = await sumsBuf.read();
    const countsAb = await countsBuf.read();
    const sums = new Float32Array(sumsAb, 0, bins);
    const counts = new Uint32Array(countsAb, 0, bins);
    const result = new Float64Array(bins);
    const countsOut = new Float64Array(bins);
    for (let b = 0; b < bins; b += 1) {
      const c = counts[b] ?? 0;
      countsOut[b] = c;
      result[b] = mode === 'count' ? c : mode === 'sum' ? sums[b] ?? 0 : c > 0 ? (sums[b] ?? 0) / c : 0;
    }
    return { result, counts: countsOut };
  } catch (err) {
    logger.warn('gpu-kernels', 'binning GPU path failed, using CPU', err);
    return null;
  } finally {
    for (const buf of buffers) buf.destroy();
  }
}

// ---- spmv (CSR, em-eigensolver) --------------------------------------------

/**
 * y = A·x for a CSR matrix (row-major, one thread per row). Auto-routes
 * GPU/CPU by nnz vs. threshold. The buffers arrive as typed views matching
 * the WGSL storage types (u32 offsets/indices, f32 values); the caller owns
 * them. GPU failure — missing device, failed compile, failed dispatch —
 * always falls back to the mathematically equivalent `spmvCPU`.
 */
export async function spmvAsync(
  indptr: Uint32Array,
  indices: Uint32Array,
  values: Float32Array,
  x: Float32Array,
  nrows: number,
  opts: KernelRunOptions = {},
): Promise<Float32Array> {
  const started = performance.now();
  const nnz = values.length;
  const gpu = await trySpmvGpu(indptr, indices, values, x, nrows, opts.engine);
  if (gpu) {
    report('spmv', 'gpu', started, spmvBytes(nrows, nnz));
    return gpu;
  }
  const y = spmvCPU(indptr, indices, values, x);
  report('spmv', 'cpu', started, spmvBytes(nrows, nnz));
  return y;
}

async function trySpmvGpu(
  indptr: Uint32Array,
  indices: Uint32Array,
  values: Float32Array,
  x: Float32Array,
  nrows: number,
  engine: KernelEngineChoice = 'auto',
): Promise<Float32Array | null> {
  const compute = getGpuCompute();
  if (!compute) return null;
  if (engine === 'cpu') return null;
  const nnz = values.length;
  if (engine === 'auto' && selectEngine(nnz, GPU_KERNEL_THRESHOLDS.spmv, true) === 'cpu') {
    return null;
  }
  const buffers: ComputeBufferHandle[] = [];
  try {
    const kernel = compute.compileKernel(spmvKernelDescriptor());
    if (!kernel) return null;
    const indptrBuf = compute.createBuffer((nrows + 1) * 4, SPMV_INDPTR_USAGE, 'spmv-indptr');
    const indicesBuf = compute.createBuffer(nnz * 4, SPMV_INDICES_USAGE, 'spmv-indices');
    const valuesBuf = compute.createBuffer(nnz * 4, SPMV_VALUES_USAGE, 'spmv-values');
    const xBuf = compute.createBuffer(x.length * 4, SPMV_X_USAGE, 'spmv-x');
    const yBuf = compute.createBuffer(nrows * 4, SPMV_Y_USAGE, 'spmv-y');
    const pBuf = compute.createBuffer(16, SPMV_PARAMS_USAGE, 'spmv-params');
    if (!indptrBuf || !indicesBuf || !valuesBuf || !xBuf || !yBuf || !pBuf) return null;
    buffers.push(indptrBuf, indicesBuf, valuesBuf, xBuf, yBuf, pBuf);
    indptrBuf.write(indptr);
    indicesBuf.write(indices);
    valuesBuf.write(values);
    xBuf.write(x);
    pBuf.write(new Uint8Array(packSpmvParams(nrows)));
    const ok = compute.run(kernel, [indptrBuf, indicesBuf, valuesBuf, xBuf, yBuf, pBuf], Math.ceil(nrows / 64), 1, 1);
    if (!ok) return null;
    const ab = await yBuf.read();
    return new Float32Array(ab, 0, nrows);
  } catch (err) {
    logger.warn('gpu-kernels', 'spmv GPU path failed, using CPU', err);
    return null;
  } finally {
    for (const buf of buffers) buf.destroy();
  }
}
