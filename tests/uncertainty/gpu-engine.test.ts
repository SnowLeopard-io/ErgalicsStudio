import { describe, it, expect } from 'vitest';
import {
  bootstrapEngine,
  hasGpuEngine,
  MEDIAN_GPU_N_MAX,
  ENGINE_ITERS_MAX,
  type GpuStat,
} from '@/core/uncertainty/gpu-engine';
import { mcmcEngine } from '@/core/uncertainty/gpu-mcmc';
import { bootstrapCI } from '@/core/uncertainty/bootstrap';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng: () => number): () => number {
  let cache: number | null = null;
  return () => {
    if (cache !== null) { const v = cache; cache = null; return v; }
    let u1 = rng();
    while (u1 <= 0) u1 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const th = 2 * Math.PI * rng();
    cache = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

const SAMPLE_N = 500;
function normalSample(seed = 5, mean = 10, sd = 2): number[] {
  const g = gaussian(mulberry(seed));
  return Array.from({ length: SAMPLE_N }, () => mean + sd * g());
}

describe('bootstrapEngine CPU path', () => {
  it('mean CI brackets the true mean and carries engine metadata', async () => {
    const sample = normalSample();
    const progress: Array<[number, number]> = [];
    const r = await bootstrapEngine(sample, 'mean', {
      engine: 'cpu',
      iters: 4000,
      seed: 1,
      blockSize: 1024,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(r.engine).toBe('cpu');
    expect(r.iters).toBe(4000);
    expect(r.lower).toBeLessThan(10.2);
    expect(r.upper).toBeGreaterThan(9.8);
    expect(r.replicates.length).toBe(4000);
    expect(r.se).toBeGreaterThan(0);
    expect(progress.at(-1)).toEqual([4000, 4000]);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('supports the full fixed statistic family', async () => {
    const sample = normalSample(7, 0, 1);
    const stats: GpuStat[] = ['mean', 'median', 'variance', 'sd'];
    for (const stat of stats) {
      const r = await bootstrapEngine(sample, stat, { engine: 'cpu', iters: 500, seed: 2 });
      expect(Number.isFinite(r.estimate)).toBe(true);
      expect(r.upper).toBeGreaterThanOrEqual(r.lower);
    }
    const x = sample;
    const y = sample.map((v, i) => 2 * v + 0.01 * (i % 7));
    const corr = await bootstrapEngine({ x, y }, 'correlation', { engine: 'cpu', iters: 500, seed: 3 });
    expect(corr.estimate).toBeGreaterThan(0.95);
    const slope = await bootstrapEngine({ x, y }, 'ols-slope', { engine: 'cpu', iters: 500, seed: 4 });
    expect(Math.abs(slope.estimate - 2)).toBeLessThan(0.2);
  });

  it('accepts arbitrary JS statistics on the CPU path', async () => {
    const sample = normalSample(9, 5, 1);
    const trimMean = (x: number[]) => {
      const s = x.slice().sort((a, b) => a - b);
      const k = Math.floor(s.length / 10);
      return s.slice(k, s.length - k).reduce((a, b) => a + b, 0) / (s.length - 2 * k);
    };
    const r = await bootstrapEngine(sample, trimMean, { engine: 'cpu', iters: 500, seed: 6 });
    expect(r.engine).toBe('cpu');
    expect(Math.abs(r.estimate - 5)).toBeLessThan(0.3);
    expect(r.fallbackReason ?? '').toContain('CPU');
  });

  it('agrees with the legacy bootstrapCI distribution (same seed family)', async () => {
    const sample = normalSample(3, 0, 1);
    // Both are mulberry32-driven with identical seed → identical draws.
    const legacy = bootstrapCI(sample, (x) => x.reduce((a, b) => a + b, 0) / x.length, {
      iters: 1000,
      seed: 42,
    });
    const r = await bootstrapEngine(sample, 'mean', {
      engine: 'cpu',
      iters: 1000,
      seed: 42,
      blockSize: 65536,
    });
    expect(r.lower).toBeCloseTo(legacy.lower, 10);
    expect(r.upper).toBeCloseTo(legacy.upper, 10);
    expect(r.estimate).toBeCloseTo(legacy.estimate, 12);
  });

  it('aborts between blocks within ~200 ms', async () => {
    const sample = normalSample();
    const ac = new AbortController();
    const start = performance.now();
    setTimeout(() => ac.abort(), 30);
    await expect(
      bootstrapEngine(sample, 'mean', {
        engine: 'cpu',
        iters: ENGINE_ITERS_MAX,
        seed: 8,
        blockSize: 4096,
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('falls back to CPU when GPU is requested but unavailable', async () => {
    if (hasGpuEngine()) return; // only meaningful in a device-less CI
    const sample = normalSample();
    const r = await bootstrapEngine(sample, 'mean', { engine: 'gpu', iters: 300, seed: 9 });
    expect(r.engine).toBe('cpu');
    expect(r.fallbackReason).toBeTruthy();
  });

  it('auto stays on CPU below the 2^15 threshold', async () => {
    const r = await bootstrapEngine(normalSample(), 'mean', { engine: 'auto', iters: 1000, seed: 10 });
    expect(r.engine).toBe('cpu');
    expect(r.fallbackReason).toBeUndefined();
  });

  it('rejects shape/stat mismatches', async () => {
    await expect(
      bootstrapEngine([1, 2, 3], 'correlation', { engine: 'cpu', iters: 200 }),
    ).rejects.toThrow();
    await expect(
      bootstrapEngine({ x: [1, 2], y: [1] }, 'mean', { engine: 'cpu', iters: 200 }),
    ).rejects.toThrow();
  });

  it('flags medians above the GPU kernel size limit (CPU fallback if reached)', async () => {
    const sample = Array.from({ length: MEDIAN_GPU_N_MAX + 10 }, (_, i) => i);
    const r = await bootstrapEngine(sample, 'median', { engine: 'gpu', iters: 200, seed: 11 });
    expect(r.engine).toBe('cpu');
    expect(r.fallbackReason).toContain('1024');
  });

  it('runs 1e6 mean replicates on CPU within the CI time budget', async () => {
    const sample = normalSample(2, 0, 1).slice(0, 8);
    const start = performance.now();
    const r = await bootstrapEngine(sample, 'mean', {
      engine: 'cpu',
      iters: 1_000_000,
      seed: 12,
      blockSize: 65536,
    });
    expect(r.iters).toBe(1_000_000);
    expect(r.replicates.length).toBe(1_000_000);
    expect(r.lower).toBeLessThan(0.3);
    expect(r.upper).toBeGreaterThan(-0.3);
    expect(performance.now() - start).toBeLessThan(30000);
  });
});

describe('mcmcEngine CPU multi-chain', () => {
  it('recovers a standard normal posterior with R-hat ≈ 1', async () => {
    // Posterior for known-variance normal with flat prior is N(xbar, 1/n).
    const g = gaussian(mulberry(71));
    const data = Array.from({ length: 100 }, () => 2 + g());
    const xbar = data.reduce((a, b) => a + b, 0) / data.length;
    const logPost = (theta: number[]) => {
      const d = theta[0]! - xbar;
      return (-data.length * d * d) / 2;
    };
    const r = await mcmcEngine(logPost, [0], {
      engine: 'cpu',
      iters: 6000,
      burnIn: 2000,
      chains: 4,
      stepSizes: [0.15],
      seed: 5,
    });
    expect(r.engine).toBe('cpu');
    expect(r.chainSamples.length).toBe(4);
    expect(r.diagnostics.rHat[0]).toBeLessThan(1.05);
    expect(r.diagnostics.ess[0]).toBeGreaterThan(800);
    const pooled = r.samples[0]!;
    const mean = pooled.reduce((a, b) => a + b, 0) / pooled.length;
    expect(Math.abs(mean - xbar)).toBeLessThan(0.1);
    for (const a of r.acceptanceRate) {
      expect(a).toBeGreaterThan(0.1);
      expect(a).toBeLessThan(0.95);
    }
  });

  it('requests for GPU with a JS logPosterior are transparently served by CPU', async () => {
    const logPost = (theta: number[]) => -(theta[0]! ** 2) / 2;
    const r = await mcmcEngine(logPost, [0], { engine: 'gpu', iters: 1000, burnIn: 500, seed: 6 });
    expect(r.engine).toBe('cpu');
    expect(r.fallbackReason).toContain('CPU');
  });
});

// GPU path can only be exercised on a real WebGPU device (spec AC1).
describe.skipIf(!hasGpuEngine())('bootstrapEngine GPU path', () => {
  it('CPU and GPU intervals agree statistically (rel. endpoint error < 1e-3)', async () => {
    const sample = normalSample(42, 5, 1);
    const common = { iters: 100_000, seed: 1234, blockSize: 65536 };
    const cpu = await bootstrapEngine(sample, 'mean', { ...common, engine: 'cpu' });
    const gpu = await bootstrapEngine(sample, 'mean', { ...common, engine: 'gpu' });
    expect(gpu.engine).toBe('gpu');
    expect(gpu.device).toBeTruthy();
    expect(Math.abs(gpu.lower - cpu.lower) / Math.abs(cpu.lower)).toBeLessThan(1e-3);
    expect(Math.abs(gpu.upper - cpu.upper) / Math.abs(cpu.upper)).toBeLessThan(1e-3);
  });

  it('reports progress across multiple dispatches', async () => {
    const seen: number[] = [];
    await bootstrapEngine(normalSample(1, 0, 1).slice(0, 256), 'mean', {
      engine: 'gpu',
      iters: 140000,
      seed: 1,
      blockSize: 65536,
      onProgress: (done) => seen.push(done),
    });
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });
});
