// ==========================================================================
// Ergalics Studio — GPU uncertainty engine for bootstrap CIs (F1)
//
// `bootstrapEngine` runs a percentile bootstrap on WebGPU when the device is
// available and the statistic belongs to the fixed kernel family
// (mean | median | variance | sd | correlation | ols-slope); custom JS
// statistics and unsupported shapes always run on CPU. Replicates are
// produced in blocks of at most `blockSize` dispatches (≤ 65 536) so a run
// reports progress and reacts to AbortSignal between blocks (spec FR1.5).
//
// The result schema mirrors BootstrapCIResult and only adds engine metadata,
// so existing consumers (dialogs, runs, lineage) keep working unchanged.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';
import { getGpuCompute } from '@/core/compute';
import { getGpuBackend } from '@/core/gpu';
import { GPU_BUFFER_USAGE } from '@/core/wgsl';
import { logger } from '@/core/logger';
import { PCG32_WGSL } from './pcg';
import type { GpuComputeApi, GpuKernelDescriptor } from '@/types/plugin';

export type GpuStat = 'mean' | 'median' | 'variance' | 'sd' | 'correlation' | 'ols-slope';

export type EngineChoice = 'cpu' | 'gpu' | 'auto';

export interface GpuEngineOptions {
  engine?: EngineChoice;
  /** Replicates per dispatch (spec FR1.5, default 65 536). */
  blockSize?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  iters?: number;
  alpha?: number;
  seed?: number | null;
}

export interface EngineBootstrapResult {
  estimate: number;
  lower: number;
  upper: number;
  se: number;
  iters: number;
  alpha: number;
  replicates: Float64Array;
  /** Engine that actually executed (auto may have fallen back to CPU). */
  engine: 'cpu' | 'gpu';
  device?: string;
  backend?: string;
  fallbackReason?: string;
  durationMs: number;
}

/** Paired input for correlation / ols-slope statistics. */
export interface PairedSample {
  x: number[];
  y: number[];
}
export type EngineSample = number[] | PairedSample;

const ITERS_MIN = 100;
/** The engine path (unlike the legacy one-shot bootstrapCI) supports 1e6. */
export const ENGINE_ITERS_MAX = 1_000_000;
const BLOCK_DEFAULT = 65_536;
/** auto() switches to GPU past this many replicates (spec: n ≥ 2^15). */
const AUTO_MIN_ITERS = 1 << 15;
/** Median kernel uses a per-thread fixed-size private array; cap n. */
export const MEDIAN_GPU_N_MAX = 1024;
const WORKGROUP = 64;

function isPaired(s: EngineSample): s is PairedSample {
  return !Array.isArray(s);
}

// --------------------------------------------------------------------------
// CPU statistics
// --------------------------------------------------------------------------

function statForSample(stat: GpuStat, sample: EngineSample): number {
  if (!isPaired(sample)) {
    const n = sample.length;
    if (stat === 'mean') return sample.reduce((a, b) => a + b, 0) / n;
    if (stat === 'median') return medianOf(sample.slice().sort((a, b) => a - b));
    let mean = 0;
    for (const v of sample) mean += v;
    mean /= n;
    let ss = 0;
    for (const v of sample) ss += (v - mean) ** 2;
    const variance = ss / (n - 1);
    if (stat === 'variance') return variance;
    if (stat === 'sd') return Math.sqrt(variance);
    throw new Error(`statistic ${stat} needs paired input`);
  }
  const { x, y } = sample;
  const n = x.length;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += x[i]!;
    sy += y[i]!;
    sxy += x[i]! * y[i]!;
    sxx += x[i]! * x[i]!;
    syy += y[i]! * y[i]!;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (stat === 'correlation') return cov / Math.sqrt(vx * vy);
  if (stat === 'ols-slope') return cov / vx;
  throw new Error(`statistic ${stat} is univariate`);
}

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 ? sorted[n >> 1]! : (sorted[(n >> 1) - 1]! + sorted[n >> 1]!) / 2;
}

// --------------------------------------------------------------------------
// WGSL kernels
// --------------------------------------------------------------------------

const PARAMS_WGSL = /* wgsl */ `
struct Params {
  n: u32,
  count: u32,
  offset: u32,
  seed: u32,
};
`;

function medianKernel(n: number): string {
  const medianExpr =
    n % 2 === 0
      ? 'out[i] = 0.5 * (buf[params.n / 2u - 1u] + buf[params.n / 2u]);'
      : 'out[i] = buf[params.n / 2u];';
  return buildMedianKernel(n, medianExpr);
}

function buildMedianKernel(n: number, medianExpr: string): string {
  return /* wgsl */ `${PARAMS_WGSL}
${PCG32_WGSL}
@group(0) @binding(0) var<storage, read> sample: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

fn sortN(a: ptr<function, array<f32, ${n}>>, len: u32) {
  var loStack: array<u32, 32>;
  var hiStack: array<u32, 32>;
  var top: i32 = 0;
  loStack[0] = 0u;
  hiStack[0] = len - 1u;
  top = 1;
  loop {
    if (top == 0) { break; }
    top = top - 1;
    let lo = loStack[top];
    let hi = hiStack[top];
    if (lo >= hi) { continue; }
    let mid = lo + (hi - lo) / 2u;
    if ((*a)[lo] > (*a)[mid]) { let t = (*a)[lo]; (*a)[lo] = (*a)[mid]; (*a)[mid] = t; }
    if ((*a)[lo] > (*a)[hi]) { let t = (*a)[lo]; (*a)[lo] = (*a)[hi]; (*a)[hi] = t; }
    if ((*a)[mid] > (*a)[hi]) { let t = (*a)[mid]; (*a)[mid] = (*a)[hi]; (*a)[hi] = t; }
    let pivot = (*a)[mid];
    var i = lo;
    var j = hi;
    loop {
      loop { if (!((*a)[i] < pivot)) { break; } i = i + 1u; }
      loop { if (!((*a)[j] > pivot)) { break; } j = j - 1u; }
      if (i >= j) { break; }
      let t = (*a)[i]; (*a)[i] = (*a)[j]; (*a)[j] = t;
      i = i + 1u;
      j = j - 1u;
    }
    if (top < 31) {
      if (lo < j) { loStack[top] = lo; hiStack[top] = j; top = top + 1; }
      if (j + 1u < hi) { loStack[top] = j + 1u; hiStack[top] = hi; top = top + 1; }
    }
  }
}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  var rng = pcgSeed(params.seed, params.offset + i + 1u);
  var buf: array<f32, ${n}>;
  for (var j: u32 = 0u; j < params.n; j = j + 1u) {
    buf[j] = sample[pcgU32(&rng) % params.n];
  }
  sortN(&buf, params.n);
  ${medianExpr}
}
`;
}

function momentsKernel(stat: 'mean' | 'variance' | 'sd'): string {
  const result =
    stat === 'mean'
      ? 'mean'
      : stat === 'variance'
        ? 'm2 / f32(params.n - 1u)'
        : 'sqrt(m2 / f32(params.n - 1u))';
  return /* wgsl */ `${PARAMS_WGSL}
${PCG32_WGSL}
@group(0) @binding(0) var<storage, read> sample: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  var rng = pcgSeed(params.seed, params.offset + i + 1u);
  var mean = 0.0;
  var m2 = 0.0;
  for (var j: u32 = 0u; j < params.n; j = j + 1u) {
    let v = sample[pcgU32(&rng) % params.n];
    let d1 = v - mean;
    mean = mean + d1 / f32(j + 1u);
    m2 = m2 + d1 * (v - mean);
  }
  out[i] = ${result};
}
`;
}

function pairsKernel(stat: 'correlation' | 'ols-slope'): string {
  const result =
    stat === 'correlation'
      ? 'cov / sqrt(vx * vy)'
      : 'cov / vx';
  return /* wgsl */ `${PARAMS_WGSL}
${PCG32_WGSL}
@group(0) @binding(0) var<storage, read> xs: array<f32>;
@group(0) @binding(1) var<storage, read> ys: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  var rng = pcgSeed(params.seed, params.offset + i + 1u);
  var sx = 0.0;
  var sy = 0.0;
  var sxy = 0.0;
  var sxx = 0.0;
  var syy = 0.0;
  for (var j: u32 = 0u; j < params.n; j = j + 1u) {
    let idx = pcgU32(&rng) % params.n;
    let xv = xs[idx];
    let yv = ys[idx];
    sx = sx + xv;
    sy = sy + yv;
    sxy = sxy + xv * yv;
    sxx = sxx + xv * xv;
    syy = syy + yv * yv;
  }
  let fn_ = f32(params.n);
  let cov = sxy - sx * sy / fn_;
  let vx = sxx - sx * sx / fn_;
  let vy = syy - sy * sy / fn_;
  out[i] = ${result};
}
`;
}

// --------------------------------------------------------------------------
// GPU orchestration
// --------------------------------------------------------------------------

const STORAGE_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;
const UNIFORM_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

function packParams(n: number, count: number, offset: number, seed: number): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setUint32(0, n >>> 0, true);
  dv.setUint32(4, count >>> 0, true);
  dv.setUint32(8, offset >>> 0, true);
  dv.setUint32(12, seed >>> 0, true);
  return buf;
}

function gpuKernelDescriptor(stat: GpuStat, n: number): GpuKernelDescriptor {
  const paired = stat === 'correlation' || stat === 'ols-slope';
  const bindings: GpuKernelDescriptor['bindings'] = paired
    ? [
        { binding: 0, bufferType: 'read-only-storage' },
        { binding: 1, bufferType: 'read-only-storage' },
        { binding: 2, bufferType: 'storage' },
        { binding: 3, bufferType: 'uniform' },
      ]
    : [
        { binding: 0, bufferType: 'read-only-storage' },
        { binding: 2, bufferType: 'storage' },
        { binding: 3, bufferType: 'uniform' },
      ];
  let wgsl: string;
  if (stat === 'mean' || stat === 'variance' || stat === 'sd') wgsl = momentsKernel(stat);
  else if (stat === 'correlation' || stat === 'ols-slope') wgsl = pairsKernel(stat);
  else {
    if (n > MEDIAN_GPU_N_MAX) throw new Error(`median GPU path supports n ≤ ${MEDIAN_GPU_N_MAX}`);
    wgsl = medianKernel(n);
  }
  return { label: `bootstrap-${stat}`, wgsl, workgroupSize: [WORKGROUP, 1, 1], bindings };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('bootstrap aborted');
    err.name = 'AbortError';
    throw err;
  }
}

async function runGpu(
  sample: EngineSample,
  stat: GpuStat,
  iters: number,
  alpha: number,
  seed: number,
  blockSize: number,
  onProgress: GpuEngineOptions['onProgress'],
  signal: AbortSignal | undefined,
): Promise<EngineBootstrapResult> {
  const compute: GpuComputeApi = getGpuCompute() as GpuComputeApi;
  if (!compute) throw new Error('no gpu device');
  const backend = getGpuBackend();
  const n = isPaired(sample) ? sample.x.length : sample.length;

  const desc = gpuKernelDescriptor(stat, n);
  const kernel = compute.compileKernel(desc);
  if (!kernel) throw new Error('kernel compilation failed');
  const compileMessages = await kernel.compilationInfo();
  if (compileMessages.some((m) => m.startsWith('[error]'))) {
    throw new Error(`kernel compile error: ${compileMessages.join('; ')}`);
  }

  const paired = stat === 'correlation' || stat === 'ols-slope';
  const inputBytes = n * 4;
  const inputBuf = compute.createBuffer(inputBytes, STORAGE_USAGE, 'bootstrap-sample');
  const inputBuf2 = paired
    ? compute.createBuffer(inputBytes, STORAGE_USAGE, 'bootstrap-sample-y')
    : null;
  if (!inputBuf || (paired && !inputBuf2)) throw new Error('input buffer creation failed');
  const f32 = new Float32Array(n);
  if (isPaired(sample)) {
    f32.set(sample.x);
    inputBuf.write(f32);
    f32.set(sample.y);
    inputBuf2!.write(f32);
  } else {
    f32.set(sample);
    inputBuf.write(f32);
  }

  const outBuf = compute.createBuffer(blockSize * 4, STORAGE_USAGE, 'bootstrap-out');
  const paramBuf = compute.createBuffer(16, UNIFORM_USAGE, 'bootstrap-params');
  if (!outBuf || !paramBuf) throw new Error('buffer creation failed');

  const started = performance.now();
  const replicates = new Float64Array(iters);
  try {
    for (let offset = 0; offset < iters; offset += blockSize) {
      throwIfAborted(signal);
      const count = Math.min(blockSize, iters - offset);
      paramBuf.write(new Uint8Array(packParams(n, count, offset, seed)));
      const buffers = paired
        ? [inputBuf, inputBuf2!, outBuf, paramBuf]
        : [inputBuf, outBuf, paramBuf];
      const ok = compute.run(kernel, buffers, Math.ceil(count / WORKGROUP), 1, 1);
      if (!ok) throw new Error('kernel dispatch failed');
      const ab = await outBuf.read();
      const block = new Float32Array(ab, 0, count);
      for (let i = 0; i < count; i += 1) replicates[offset + i] = block[i]!;
      onProgress?.(offset + count, iters);
      // Yield so the abort/progress stay responsive between blocks.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    inputBuf.destroy();
    inputBuf2?.destroy();
    outBuf.destroy();
    paramBuf.destroy();
  }

  return finalizeBootstrap(
    sample,
    stat,
    replicates,
    iters,
    alpha,
    'gpu',
    backend.name,
    backend.backend,
    started,
  );
}

// --------------------------------------------------------------------------
// CPU path
// --------------------------------------------------------------------------

async function runCpu(
  sample: EngineSample,
  stat: GpuStat,
  iters: number,
  alpha: number,
  seed: number,
  blockSize: number,
  onProgress: GpuEngineOptions['onProgress'],
  signal: AbortSignal | undefined,
): Promise<EngineBootstrapResult> {
  const started = performance.now();
  const rand = mulberry32(seed);
  const n = isPaired(sample) ? sample.x.length : sample.length;
  const replicates = new Float64Array(iters);
  const scratch: number[] = new Array(n);
  const pScratchX: number[] = new Array(n);
  const pScratchY: number[] = new Array(n);

  for (let b = 0; b < iters; b += 1) {
    if (b % blockSize === 0) {
      throwIfAborted(signal);
      onProgress?.(b, iters);
      if (b > 0) await new Promise((r) => setTimeout(r, 0));
    }
    if (isPaired(sample)) {
      for (let i = 0; i < n; i += 1) {
        const j = (rand() * n) | 0;
        pScratchX[i] = sample.x[j]!;
        pScratchY[i] = sample.y[j]!;
      }
      replicates[b] = statForSample(stat, { x: pScratchX, y: pScratchY });
    } else if (stat === 'median') {
      for (let i = 0; i < n; i += 1) scratch[i] = sample[(rand() * n) | 0]!;
      scratch.sort((a, b) => a - b);
      replicates[b] = medianOf(scratch);
    } else {
      for (let i = 0; i < n; i += 1) scratch[i] = sample[(rand() * n) | 0]!;
      replicates[b] = statForSample(stat, scratch);
    }
  }
  onProgress?.(iters, iters);
  return finalizeBootstrap(sample, stat, replicates, iters, alpha, 'cpu', undefined, undefined, started);
}

// --------------------------------------------------------------------------
// Finalisation
// --------------------------------------------------------------------------

async function finalizeBootstrap(
  sample: EngineSample,
  stat: GpuStat,
  replicates: Float64Array,
  iters: number,
  alpha: number,
  engine: 'cpu' | 'gpu',
  device: string | undefined,
  backend: string | undefined,
  started: number,
  estimateOverride?: number,
): Promise<EngineBootstrapResult> {
  const finite: number[] = [];
  let sum = 0;
  for (let i = 0; i < replicates.length; i += 1) {
    const v = replicates[i]!;
    if (Number.isFinite(v)) {
      finite.push(v);
      sum += v;
    }
  }
  if (finite.length === 0) throw new Error('bootstrap produced no finite replicates');
  finite.sort((a, b) => a - b);
  const mean = sum / finite.length;
  let ss = 0;
  for (const v of finite) ss += (v - mean) ** 2;
  const se = Math.sqrt(ss / finite.length);
  const lo = finite[Math.floor((alpha / 2) * finite.length)]!;
  const hi = finite[Math.min(finite.length - 1, Math.floor((1 - alpha / 2) * finite.length))]!;
  const estimate = estimateOverride ?? statForSample(stat, sample);
  return {
    estimate,
    lower: lo,
    upper: hi,
    se,
    iters,
    alpha,
    replicates,
    engine,
    device,
    backend,
    durationMs: performance.now() - started,
  };
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/** Whether a live WebGPU compute surface is attached. */
export function hasGpuEngine(): boolean {
  return getGpuCompute() !== null;
}

/**
 * Percentile bootstrap CI with auto CPU/GPU routing.
 *
 * @param stat a fixed kernel-statistic name, or a JS statistic for the CPU
 *             path: `(resample, paired) => number`
 */
export async function bootstrapEngine(
  sample: EngineSample,
  stat: GpuStat | ((resample: number[], paired: PairedSample | null) => number),
  opts: GpuEngineOptions = {},
): Promise<EngineBootstrapResult> {
  const n = isPaired(sample) ? sample.x.length : sample.length;
  if (n === 0) throw new Error('bootstrap needs a non-empty sample');
  if (isPaired(sample) && sample.y.length !== n) {
    throw new Error('paired bootstrap: x/y length differ');
  }
  const rawIters = Math.floor(opts.iters ?? 2000);
  const iters = Number.isFinite(rawIters)
    ? Math.min(ENGINE_ITERS_MAX, Math.max(ITERS_MIN, rawIters))
    : 2000;
  const alpha = Math.min(0.49, Math.max(0.001, opts.alpha ?? 0.05));
  const blockSize = Math.min(BLOCK_DEFAULT, Math.max(64, Math.floor(opts.blockSize ?? BLOCK_DEFAULT)));
  const seed = opts.seed === null || opts.seed === undefined ? (Math.random() * 2 ** 32) >>> 0 : opts.seed >>> 0;

  const customFn = typeof stat === 'function' ? stat : null;
  const namedStat = customFn ? null : (stat as GpuStat);
  const paired = namedStat === 'correlation' || namedStat === 'ols-slope';
  if (namedStat && paired !== isPaired(sample)) {
    throw new Error(`${namedStat} ${isPaired(sample) ? 'expects univariate' : 'expects paired'} input`);
  }

  let wantGpu = opts.engine === 'gpu';
  if (opts.engine === 'auto' || !opts.engine) {
    wantGpu = iters >= AUTO_MIN_ITERS;
  }

  if (wantGpu && namedStat) {
    try {
      if (namedStat === 'median' && n > MEDIAN_GPU_N_MAX) {
        throw new Error(`median GPU path supports n ≤ ${MEDIAN_GPU_N_MAX}`);
      }
      return await runGpu(sample, namedStat, iters, alpha, seed, blockSize, opts.onProgress, opts.signal);
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      const reason = (err as Error).message;
      // GPU unavailable, kernel rejected or n too large: always keep the run
      // alive on CPU and record why (spec FR: automatic fallback).
      logger.warn('uncertainty', 'GPU bootstrap fell back to CPU', reason);
      const result = await runCpu(sample, namedStat, iters, alpha, seed, blockSize, opts.onProgress, opts.signal);
      result.fallbackReason = reason;
      return result;
    }
  }

  // CPU path (explicit choice, custom JS statistic, or auto below threshold).
  if (customFn) {
    const started = performance.now();
    const estimate = isPaired(sample)
      ? customFn(sample.x.slice(), { x: sample.x, y: sample.y })
      : customFn(sample.slice(), null);
    const result = await runCpuWithEstimate(sample, customFn, iters, alpha, seed, blockSize, opts, started, estimate);
    // Arbitrary JS statistics cannot be expressed in WGSL — annotate the
    // forced routing even when the user asked for CPU explicitly.
    result.fallbackReason = 'arbitrary JS statistics run on CPU';
    return result;
  }
  return runCpu(sample, namedStat as GpuStat, iters, alpha, seed, blockSize, opts.onProgress, opts.signal);
}

/** CPU run wrapper that injects a custom statistic's original-sample estimate. */
async function runCpuWithEstimate(
  sample: EngineSample,
  fn: (resample: number[], paired: PairedSample | null) => number,
  iters: number,
  alpha: number,
  seed: number,
  blockSize: number,
  opts: GpuEngineOptions,
  started: number,
  estimate: number,
): Promise<EngineBootstrapResult> {
  const rand = mulberry32(seed);
  const n = isPaired(sample) ? sample.x.length : sample.length;
  const replicates = new Float64Array(iters);
  const scratch: number[] = new Array(n);
  const px: number[] = new Array(n);
  const py: number[] = new Array(n);
  for (let b = 0; b < iters; b += 1) {
    if (b % blockSize === 0) {
      if (opts.signal?.aborted) {
        const err = new Error('bootstrap aborted');
        err.name = 'AbortError';
        throw err;
      }
      opts.onProgress?.(b, iters);
      if (b > 0) await new Promise((r) => setTimeout(r, 0));
    }
    if (isPaired(sample)) {
      for (let i = 0; i < n; i += 1) {
        const j = (rand() * n) | 0;
        px[i] = sample.x[j]!;
        py[i] = sample.y[j]!;
      }
      replicates[b] = fn(px, { x: px, y: py });
    } else {
      for (let i = 0; i < n; i += 1) scratch[i] = sample[(rand() * n) | 0]!;
      replicates[b] = fn(scratch, null);
    }
  }
  opts.onProgress?.(iters, iters);
  return finalizeBootstrap(
    sample,
    'mean', // estimate overridden; stat unused
    replicates,
    iters,
    alpha,
    'cpu',
    undefined,
    undefined,
    started,
    estimate,
  );
}
