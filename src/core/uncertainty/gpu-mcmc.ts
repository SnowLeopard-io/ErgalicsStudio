// ==========================================================================
// Ergalics Studio — multi-chain MCMC with GPU engine (F1, FR1.3)
//
// CPU path: independent Metropolis–Hastings chains driven by mulberry32
// (one seed per chain), run in batches with progress + AbortSignal, and
// diagnosed with split-R-hat / ESS.
//
// GPU path: a caller-supplied WGSL log-density body (fixed dimension D baked
// into the kernel) is compiled into a random-walk MH kernel where every
// thread is one chain. Chain state persists in buffers between dispatches of
// `stepsPerBlock` steps, so 1e6-step runs never block the device or the UI.
// Arbitrary JS log-posteriors always run on CPU — WGSL cannot execute JS.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';
import { getGpuCompute } from '@/core/compute';
import { getGpuBackend } from '@/core/gpu';
import { GPU_BUFFER_USAGE } from '@/core/wgsl';
import { logger } from '@/core/logger';
import { PCG32_WGSL } from './pcg';
import { mcmcDiagnostics, type McmcDiagnostics } from './diagnostics';
import type { GpuComputeApi, GpuKernelDescriptor } from '@/types/plugin';

export type McmcEngineChoice = 'cpu' | 'gpu' | 'auto';

export interface McmcEngineOptions {
  engine?: McmcEngineChoice;
  iters?: number;
  burnIn?: number;
  seed?: number | null;
  /** Independent chains (CPU default 4; GPU maps one thread per chain). */
  chains?: number;
  stepSizes?: number[];
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** MH steps per GPU dispatch (default 2 048). */
  stepsPerBlock?: number;
  /** CPU yields every this many steps. */
  batchSize?: number;
}

/** GPU-compatible model: log-density supplied as a WGSL expression body. */
export interface WgslMcmcModel {
  dims: number;
  /**
   * WGSL source appended inside the kernel. Must define
   *   fn logDensity(theta: ptr<function, array<f32, D>>) -> f32
   * returning the unnormalised log-posterior.
   */
  logDensityWGSL: string;
  init: number[][];
}

export interface McmcEngineResult {
  /** Pooled post-burn-in samples, one array per dimension. */
  samples: Float64Array[];
  /** Per-chain post-burn-in samples: chains[chain][dimension]. */
  chainSamples: Float64Array[][];
  acceptanceRate: number[];
  iters: number;
  burnIn: number;
  engine: 'cpu' | 'gpu';
  device?: string;
  diagnostics: McmcDiagnostics;
  durationMs: number;
  fallbackReason?: string;
}

const ITERS_MIN = 500;
const ITERS_MAX = 1_000_000;
const STEPS_BLOCK_DEFAULT = 2048;
const CPU_BATCH_DEFAULT = 2000;
const WORKGROUP = 64;

const STORAGE_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;
const UNIFORM_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

function makeNormals(rand: () => number): () => number {
  let cache: number | null = null;
  return () => {
    if (cache !== null) {
      const v = cache;
      cache = null;
      return v;
    }
    let u1 = rand();
    while (u1 <= 1e-12) u1 = rand();
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    cache = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

function abortError(): Error {
  const err = new Error('mcmc aborted');
  err.name = 'AbortError';
  return err;
}

// --------------------------------------------------------------------------
// CPU multi-chain MH
// --------------------------------------------------------------------------

export interface CpuMcmcChainOutput {
  samples: Float64Array[];
  accepted: number;
}

async function runCpuChains(
  logPost: (theta: number[]) => number,
  inits: number[][],
  stepSizes: number[],
  iters: number,
  burnIn: number,
  seed: number,
  batchSize: number,
  onProgress: McmcEngineOptions['onProgress'],
  signal: AbortSignal | undefined,
): Promise<{ chains: Float64Array[][]; acceptance: number[] }> {
  const keep = iters - burnIn;
  const chainsOut: Float64Array[][] = [];
  const acceptance: number[] = [];
  const totalSteps = inits.length * iters;
  let done = 0;

  for (let c = 0; c < inits.length; c += 1) {
    const d = inits[c]!.length;
    const rand = mulberry32((seed + c * 0x9e3779b9) >>> 0);
    const gauss = makeNormals(rand);
    const current = inits[c]!.slice();
    let lp = logPost(current);
    if (!Number.isFinite(lp)) throw new Error('logPosterior must be finite at the initial state');
    let accepted = 0;
    const proposal = new Array<number>(d).fill(0);
    const out = current.map(() => new Float64Array(keep));

    for (let i = 0; i < iters; i += 1) {
      for (let k = 0; k < d; k += 1) proposal[k] = current[k]! + stepSizes[k]! * gauss();
      const lpProp = logPost(proposal);
      if (Number.isFinite(lpProp)) {
        const delta = lpProp - lp;
        if (delta >= 0 || rand() < Math.exp(delta)) {
          for (let k = 0; k < d; k += 1) current[k] = proposal[k]!;
          lp = lpProp;
          accepted += 1;
        }
      }
      if (i >= burnIn) {
        const k = i - burnIn;
        for (let dim = 0; dim < d; dim += 1) out[dim]![k] = current[dim]!;
      }
      if (i % batchSize === batchSize - 1) {
        if (signal?.aborted) throw abortError();
        onProgress?.(done + i, totalSteps);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    done += iters;
    chainsOut.push(out);
    acceptance.push(accepted / iters);
  }
  onProgress?.(totalSteps, totalSteps);
  return { chains: chainsOut, acceptance };
}

function poolChains(perChain: Float64Array[][]): Float64Array[] {
  const dims = perChain[0]!.length;
  const keep = perChain[0]![0]!.length;
  const pooled = Array.from({ length: dims }, () => new Float64Array(keep * perChain.length));
  perChain.forEach((chain, c) => {
    for (let d = 0; d < dims; d += 1) pooled[d]!.set(chain[d]!, c * keep);
  });
  return pooled;
}

async function runCpuEngine(
  logPost: (theta: number[]) => number,
  init0: number[],
  opts: ResolvedMcmcOptions,
): Promise<McmcEngineResult> {
  const started = performance.now();
  const d = init0.length;
  const step =
    opts.stepSizes && opts.stepSizes.length === d
      ? opts.stepSizes.slice()
      : init0.map(() => 0.5);
  // Deterministic, dispersed initial values for the extra chains.
  const inits = [init0.slice()];
  for (let c = 1; c < opts.chains; c += 1) {
    inits.push(init0.map((v, k) => v + (((c * 7 + k * 13) % 11) - 5) * step[k]! * 0.4));
  }
  const { chains, acceptance } = await runCpuChains(
    logPost,
    inits,
    step,
    opts.iters,
    opts.burnIn,
    opts.seed,
    opts.batchSize,
    opts.onProgress,
    opts.signal,
  );
  const diagnostics = mcmcDiagnostics(chains);
  return {
    samples: poolChains(chains),
    chainSamples: chains,
    acceptanceRate: acceptance,
    iters: opts.iters,
    burnIn: opts.burnIn,
    engine: 'cpu',
    diagnostics,
    durationMs: performance.now() - started,
  };
}

interface ResolvedMcmcOptions {
  iters: number;
  burnIn: number;
  seed: number;
  chains: number;
  stepSizes?: number[];
  onProgress: McmcEngineOptions['onProgress'];
  signal: AbortSignal | undefined;
  batchSize: number;
}

// --------------------------------------------------------------------------
// GPU MH kernel
// --------------------------------------------------------------------------

function mcmcKernelWGSL(model: WgslMcmcModel, stepsPerBlock: number): string {
  const D = model.dims;
  return /* wgsl */ `struct Params {
  chains: u32,
  steps: u32,
  blockOffset: u32,
  seed: u32,
};

@group(0) @binding(0) var<storage, read_write> state: array<f32>;   // chains * (D + 1)
@group(0) @binding(1) var<storage, read_write> samples: array<f32>; // steps * chains * D
@group(0) @binding(2) var<storage, read> stepSizes: array<f32>;
@group(0) @binding(3) var<storage, read_write> counters: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;
${PCG32_WGSL}

fn gaussN(rng: ptr<function, Pcg>, cache: ptr<function, f32>, has: ptr<function, bool>) -> f32 {
  if (*has) {
    *has = false;
    return *cache;
  }
  var u1 = pcgFloat(rng);
  loop { if (u1 > 1e-9) { break; } u1 = pcgFloat(rng); }
  let u2 = pcgFloat(rng);
  let r = sqrt(-2.0 * log(u1));
  let th = 6.283185307 * u2;
  *cache = r * sin(th);
  *has = true;
  return r * cos(th);
}

${model.logDensityWGSL}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= params.chains) { return; }

  var rng = pcgSeed(params.seed + params.blockOffset, c + 1u);
  var theta: array<f32, ${D}>;
  let base = c * ${D + 1}u;
  for (var d: u32 = 0u; d < ${D}u; d = d + 1u) {
    theta[d] = state[base + d];
  }
  var lp = state[base + ${D}u];
  var accepted = counters[c];
  var cache = 0.0;
  var hasCache = false;

  for (var t: u32 = 0u; t < ${stepsPerBlock}u; t = t + 1u) {
    var prop: array<f32, ${D}>;
    for (var d: u32 = 0u; d < ${D}u; d = d + 1u) {
      prop[d] = theta[d] + stepSizes[d] * gaussN(&rng, &cache, &hasCache);
    }
    let lpProp = logDensity(&prop);
    if (lpProp == lpProp) { // NaN guard
      let delta = lpProp - lp;
      var take = delta >= 0.0;
      if (!take) {
        let u = max(pcgFloat(&rng), 1e-30);
        take = log(u) < delta;
      }
      if (take) {
        for (var d: u32 = 0u; d < ${D}u; d = d + 1u) { theta[d] = prop[d]; }
        lp = lpProp;
        accepted = accepted + 1u;
      }
    }
    if (t < params.steps) {
      let outBase = (t * params.chains + c) * ${D}u;
      for (var d: u32 = 0u; d < ${D}u; d = d + 1u) {
        samples[outBase + d] = theta[d];
      }
    }
  }

  for (var d: u32 = 0u; d < ${D}u; d = d + 1u) { state[base + d] = theta[d]; }
  state[base + ${D}u] = lp;
  counters[c] = accepted;
}
`;
}

// --------------------------------------------------------------------------
// GPU orchestration
// --------------------------------------------------------------------------

async function runGpuEngine(
  model: WgslMcmcModel,
  opts: ResolvedMcmcOptions,
): Promise<McmcEngineResult> {
  const compute: GpuComputeApi = getGpuCompute() as GpuComputeApi;
  if (!compute) throw new Error('no gpu device');
  const backend = getGpuBackend();
  const D = model.dims;
  const chains = model.init.length;
  if (chains < 2) throw new Error('GPU MCMC needs ≥ 2 initial chains');
  if (model.init.some((v) => v.length !== D)) throw new Error('init chain dimension mismatch');
  const stepsPerBlock = opts.batchSize
    ? opts.batchSize
    : STEPS_BLOCK_DEFAULT;

  const desc: GpuKernelDescriptor = {
    label: 'mcmc-mh',
    wgsl: mcmcKernelWGSL(model, stepsPerBlock),
    workgroupSize: [WORKGROUP, 1, 1],
    bindings: [
      { binding: 0, bufferType: 'storage' },
      { binding: 1, bufferType: 'storage' },
      { binding: 2, bufferType: 'read-only-storage' },
      { binding: 3, bufferType: 'storage' },
      { binding: 4, bufferType: 'uniform' },
    ],
  };
  const kernel = compute.compileKernel(desc);
  if (!kernel) throw new Error('MCMC kernel compilation failed');
  const messages = await kernel.compilationInfo();
  if (messages.some((m) => m.startsWith('[error]'))) {
    throw new Error(`MCMC kernel compile error: ${messages.join('; ')}`);
  }

  const stateBuf = compute.createBuffer(chains * (D + 1) * 4, STORAGE_USAGE, 'mcmc-state');
  const sampleBuf = compute.createBuffer(stepsPerBlock * chains * D * 4, STORAGE_USAGE, 'mcmc-samples');
  const stepBuf = compute.createBuffer(D * 4, STORAGE_USAGE, 'mcmc-steps');
  const counterBuf = compute.createBuffer(chains * 4, STORAGE_USAGE, 'mcmc-counters');
  const paramBuf = compute.createBuffer(16, UNIFORM_USAGE, 'mcmc-params');
  if (!stateBuf || !sampleBuf || !stepBuf || !counterBuf || !paramBuf) {
    throw new Error('MCMC buffer creation failed');
  }

  // Initial state [theta D | lp] per chain; lp evaluated on the CPU side is
  // not available for a WGSL-only model, so start at 0 (first proposal's
  // acceptance is simply relative to the prior-free value 0).
  const initF32 = new Float32Array(chains * (D + 1));
  model.init.forEach((init, c) => {
    init.forEach((v, d) => {
      initF32[c * (D + 1) + d] = v;
    });
  });
  stateBuf.write(initF32);
  const stepF32 = new Float32Array(D);
  const steps =
    opts.stepSizes && opts.stepSizes.length === D ? opts.stepSizes : new Array(D).fill(0.5);
  steps.forEach((v, d) => {
    stepF32[d] = v;
  });
  stepBuf.write(stepF32);
  counterBuf.write(new Uint32Array(chains));

  const started = performance.now();
  const keep = opts.iters - opts.burnIn;
  // Per-chain kept samples, filled block by block.
  const out: Float64Array[][] = model.init.map(() =>
    Array.from({ length: D }, () => new Float64Array(keep)),
  );

  try {
    let kept = 0;
    let blockOffset = 0;
    // Phase 1: burn-in (discard writes), phase 2: sampling (collect reads).
    const phases: Array<{ from: number; to: number; collect: boolean }> = [];
    if (opts.burnIn > 0) phases.push({ from: 0, to: opts.burnIn, collect: false });
    phases.push({ from: opts.burnIn, to: opts.iters, collect: true });

    for (const phase of phases) {
      let cursor = phase.from;
      while (cursor < phase.to) {
        if (opts.signal?.aborted) throw abortError();
        const stepsNow = Math.min(stepsPerBlock, phase.to - cursor);
        const params = new ArrayBuffer(16);
        const dv = new DataView(params);
        dv.setUint32(0, chains, true);
        dv.setUint32(4, stepsNow, true);
        dv.setUint32(8, blockOffset, true);
        dv.setUint32(12, opts.seed >>> 0, true);
        paramBuf.write(new Uint8Array(params));
        const ok = compute.run(
          kernel,
          [stateBuf, sampleBuf, stepBuf, counterBuf, paramBuf],
          Math.ceil(chains / WORKGROUP),
          1,
          1,
        );
        if (!ok) throw new Error('MCMC dispatch failed');

        if (phase.collect) {
          const ab = await sampleBuf.read();
          const block = new Float32Array(ab, 0, stepsNow * chains * D);
          for (let t = 0; t < stepsNow; t += 1) {
            for (let c = 0; c < chains; c += 1) {
              if (kept + t >= keep) break;
              const src = (t * chains + c) * D;
              for (let d = 0; d < D; d += 1) {
                out[c]![d]![kept + t] = block[src + d]!;
              }
            }
          }
          kept += stepsNow;
        }
        cursor += stepsNow;
        blockOffset += stepsNow;
        opts.onProgress?.(cursor, opts.iters);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const counterBytes = await counterBuf.read();
    const counters = new Uint32Array(counterBytes);
    const acceptance = Array.from(counters).map((a) => a / opts.iters);
    const diagnostics = mcmcDiagnostics(out);
    return {
      samples: poolChains(out),
      chainSamples: out,
      acceptanceRate: acceptance,
      iters: opts.iters,
      burnIn: opts.burnIn,
      engine: 'gpu',
      device: backend.name,
      diagnostics,
      durationMs: performance.now() - started,
    };
  } finally {
    stateBuf.destroy();
    sampleBuf.destroy();
    stepBuf.destroy();
    counterBuf.destroy();
    paramBuf.destroy();
  }
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Multi-chain random-walk Metropolis MCMC.
 *
 * @param target JS log-posterior (CPU; auto falls back here) or a
 *               {@link WgslMcmcModel} (GPU)
 * @param init   initial state for chain 0 (used by the JS path)
 */
export async function mcmcEngine(
  target: ((theta: number[]) => number) | WgslMcmcModel,
  init: number[],
  rawOpts: McmcEngineOptions = {},
): Promise<McmcEngineResult> {
  const rawIters = Math.floor(rawOpts.iters ?? 10000);
  const iters = Number.isFinite(rawIters)
    ? Math.min(ITERS_MAX, Math.max(ITERS_MIN, rawIters))
    : 10000;
  const rawBurn = Math.floor(rawOpts.burnIn ?? iters / 2);
  const burnIn = Math.min(iters - 1, Math.max(0, rawBurn));
  const opts: ResolvedMcmcOptions = {
    iters,
    burnIn,
    seed:
      rawOpts.seed === null || rawOpts.seed === undefined
        ? (Math.random() * 2 ** 32) >>> 0
        : rawOpts.seed >>> 0,
    chains: Math.max(2, Math.min(WORKGROUP, Math.floor(rawOpts.chains ?? 4))),
    stepSizes: rawOpts.stepSizes,
    onProgress: rawOpts.onProgress,
    signal: rawOpts.signal,
    batchSize: Math.max(100, rawOpts.batchSize ?? rawOpts.stepsPerBlock ?? CPU_BATCH_DEFAULT),
  };

  const isWgsl = typeof target !== 'function';

  if (isWgsl) {
    const model = target as WgslMcmcModel;
    if (opts.chains !== model.init.length) {
      // The WGSL path derives chain count from the model's inits.
      opts.chains = model.init.length;
    }
    if (rawOpts.engine === 'cpu') {
      throw new Error('WGSL MCMC models require the GPU engine; pass a JS logPosterior for CPU');
    }
    try {
      return await runGpuEngine(model, opts);
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new Error(`GPU MCMC unavailable: ${(err as Error).message}`);
    }
  }

  const logPost = target as (theta: number[]) => number;
  if (rawOpts.engine === 'gpu') {
    // Arbitrary JS cannot run on the device — honour the request by running
    // CPU but say so in the result.
    logger.warn('uncertainty', 'JS logPosterior runs on CPU (GPU MCMC needs WGSL)');
    const result = await runCpuEngine(logPost, init, opts);
    result.fallbackReason = 'arbitrary JS log-posteriors run on CPU';
    return result;
  }
  return runCpuEngine(logPost, init, opts);
}
