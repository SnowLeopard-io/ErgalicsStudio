// FR-12 GPU kernel extension tests — matmul / FFT / k-means / binning.
//
// Three layers, matching the architecture rules: (a) CPU-implementation
// correctness against known answers and a seeded reference; (b) text-level
// WGSL structure assertions (workgroup size, binding declarations, compute
// entry point) plus shader ↔ host-descriptor binding-layout agreement from
// the shared `*_BINDINGS` constants; (c) orchestration fallback — with no
// WebGPU device in Node, every `*Async` entry must land on the CPU twin.
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@/core/repro/random';
import {
  matmulKernelWGSL,
  matmulCPU,
  matmulBytes,
  packMatMulParams,
  MATMUL_TILE,
  MATMUL_BINDINGS,
  fftKernelWGSL,
  fftCPU,
  fftFullCPU,
  fftBytes,
  fftBitReverse,
  fftStageCount,
  isPowerOfTwo,
  packFFTParams,
  FFT_MAX_N,
  FFT_BINDINGS,
  kmeansKernelWGSL,
  kmeansCPU,
  kmeansInitCentroids,
  kmeansSumsBytes,
  kmeansCountsBytes,
  packKMeansParams,
  KMEANS_BINDINGS,
  binningKernelWGSL,
  binningCPU,
  binningSumsBytes,
  packBinningParams,
  BINNING_BINDINGS,
} from '@/core/wgsl';
import {
  GPU_KERNEL_THRESHOLDS,
  selectEngine,
  matmulKernelDescriptor,
  fftKernelDescriptor,
  kmeansKernelDescriptor,
  binningKernelDescriptor,
  matmulAsync,
  fftAsync,
  kmeansAsync,
  binningAsync,
} from '@/core/gpu-kernels';
import {
  recordKernelExecution,
  kernelExecutions,
  clearKernelExecutions,
} from '@/core/perf';

/** Extract the `@group(0) @binding(N)` declaration numbers from WGSL text. */
function declaredBindings(src: string): number[] {
  return [...src.matchAll(/@group\(0\) @binding\((\d+)\)/g)].map((m) => Number(m[1]));
}

describe('matmul kernel', () => {
  it('multiplies known 2×3 by 3×2 matrices', () => {
    const a = Float32Array.from([1, 2, 3, 4, 5, 6]);
    const b = Float32Array.from([7, 8, 9, 10, 11, 12]);
    const c = matmulCPU(a, b, 2, 3, 2);
    expect(Array.from(c)).toEqual([58, 64, 139, 154]);
  });

  it('matches a seeded reference triple loop on 16×12×20 matrices', () => {
    const rand = mulberry32(1234);
    const m = 16;
    const k = 12;
    const n = 20;
    const a = Float32Array.from({ length: m * k }, () => rand() * 2 - 1);
    const b = Float32Array.from({ length: k * n }, () => rand() * 2 - 1);
    const c = matmulCPU(a, b, m, k, n);
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < n; j += 1) {
        let ref = 0;
        for (let p = 0; p < k; p += 1) ref += a[i * k + p]! * b[p * n + j]!;
        expect(c[i * n + j]!).toBeCloseTo(ref, 4);
      }
    }
  });

  it('is the identity under multiplication by I', () => {
    const a = Float32Array.from([2, 0, 1, 5]);
    const id = Float32Array.from([1, 0, 0, 1]);
    expect(Array.from(matmulCPU(a, id, 2, 2, 2))).toEqual([2, 0, 1, 5]);
  });

  it('rejects undersized inputs', () => {
    expect(() => matmulCPU(new Float32Array(2), new Float32Array(4), 2, 2, 2)).toThrow();
  });

  it('emits a tiled 2-D compute kernel with workgroup memory and barriers', () => {
    const src = matmulKernelWGSL();
    expect(src).toContain(`@compute @workgroup_size(${MATMUL_TILE}, ${MATMUL_TILE})`);
    expect(src).toContain('var<workgroup> tileA');
    expect(src).toContain('var<workgroup> tileB');
    expect(src).toContain('workgroupBarrier()');
    expect(src).toContain('fn main(@builtin(global_invocation_id)');
    expect(declaredBindings(src)).toEqual([0, 1, 2, 3]);
  });

  it('honours a custom tile size', () => {
    expect(matmulKernelWGSL({ tileSize: 8 })).toContain('@workgroup_size(8, 8)');
  });

  it('descriptor bindings match the shader layout constants', () => {
    const desc = matmulKernelDescriptor();
    expect(desc.bindings.map((b) => b.binding)).toEqual(declaredBindings(matmulKernelWGSL()));
    expect(desc.bindings.map((b) => b.binding)).toEqual([
      MATMUL_BINDINGS.A,
      MATMUL_BINDINGS.B,
      MATMUL_BINDINGS.PARAMS,
      MATMUL_BINDINGS.C,
    ]);
    expect(desc.workgroupSize).toEqual([MATMUL_TILE, MATMUL_TILE, 1]);
  });

  it('packs params with real u32 dimensions and sizes buffers', () => {
    const buf = packMatMulParams(128, 64, 32);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(128);
    expect(dv.getUint32(4, true)).toBe(64);
    expect(dv.getUint32(8, true)).toBe(32);
    expect(matmulBytes(2, 3)).toBe(24);
    expect(matmulBytes(1.9, 2)).toBe(8); // floored
  });
});

describe('fft kernel', () => {
  it('validates power-of-two lengths', () => {
    expect(isPowerOfTwo(1)).toBe(true);
    expect(isPowerOfTwo(1024)).toBe(true);
    expect(isPowerOfTwo(3)).toBe(false);
    expect(isPowerOfTwo(0)).toBe(false);
    expect(isPowerOfTwo(1.5)).toBe(false);
    expect(() => fftCPU(new Float32Array(6), 3, 0)).toThrow('power of two');
    expect(() => fftCPU(new Float32Array((FFT_MAX_N + 1) * 2), FFT_MAX_N + 1, 0)).toThrow();
  });

  it('bit-reverses indices and counts stages', () => {
    expect(fftBitReverse(0, 3)).toBe(0);
    expect(fftBitReverse(1, 3)).toBe(4);
    expect(fftBitReverse(6, 3)).toBe(3);
    expect(fftStageCount(8)).toBe(3);
    expect(() => fftStageCount(7)).toThrow();
  });

  it('transforms a delta into a flat unit spectrum', () => {
    const n = 8;
    const data = new Float32Array(n * 2);
    data[0] = 1;
    fftFullCPU(data, n);
    for (let k = 0; k < n; k += 1) {
      expect(data[k * 2]!).toBeCloseTo(1, 5);
      expect(data[k * 2 + 1]!).toBeCloseTo(0, 5);
    }
  });

  it('matches a naive DFT on a seeded random signal', () => {
    const n = 16;
    const rand = mulberry32(7);
    const xr = Float32Array.from({ length: n }, () => rand() * 2 - 1);
    const xi = Float32Array.from({ length: n }, () => rand() * 2 - 1);
    const data = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      data[i * 2] = xr[i]!;
      data[i * 2 + 1] = xi[i]!;
    }
    fftFullCPU(data, n);
    for (let k = 0; k < n; k += 1) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t += 1) {
        const ang = (-2 * Math.PI * k * t) / n;
        sr += xr[t]! * Math.cos(ang) - xi[t]! * Math.sin(ang);
        si += xr[t]! * Math.sin(ang) + xi[t]! * Math.cos(ang);
      }
      expect(data[k * 2]!).toBeCloseTo(sr, 3);
      expect(data[k * 2 + 1]!).toBeCloseTo(si, 3);
    }
  });

  it('rejects out-of-range stages and short buffers', () => {
    expect(() => fftCPU(new Float32Array(16), 8, 4)).toThrow();
    expect(() => fftCPU(new Float32Array(8), 8, 1)).toThrow();
  });

  it('emits a stage-parameterised compute kernel with bit-reversal helper', () => {
    const src = fftKernelWGSL();
    expect(src).toContain('@compute @workgroup_size(64)');
    expect(src).toContain('fn bitReverse(');
    expect(src).toContain('params.stage');
    expect(src).toContain('var<storage, read_write> data');
    expect(declaredBindings(src)).toEqual([0, 1]);
    expect(fftKernelWGSL({ workgroupSize: 128 })).toContain('@workgroup_size(128)');
  });

  it('descriptor bindings match the shader layout constants', () => {
    const desc = fftKernelDescriptor();
    expect(desc.bindings.map((b) => b.binding)).toEqual(declaredBindings(fftKernelWGSL()));
    expect(desc.bindings.map((b) => b.binding)).toEqual([FFT_BINDINGS.DATA, FFT_BINDINGS.PARAMS]);
  });

  it('packs params with real u32 fields and sizes the complex buffer', () => {
    const buf = packFFTParams(1024, 3);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(1024);
    expect(dv.getUint32(4, true)).toBe(3);
    expect(fftBytes(512)).toBe(4096);
  });
});

describe('kmeans kernel', () => {
  /** Two well-separated 2-D blobs, 12 points per blob. */
  function blobs(): { points: Float32Array; count: number; dim: number } {
    const dim = 2;
    const points = new Float32Array(24 * dim);
    for (let i = 0; i < 12; i += 1) {
      points[i * dim] = 0 + i * 0.01;
      points[i * dim + 1] = 0 - i * 0.01;
      points[(12 + i) * dim] = 10 + i * 0.01;
      points[(12 + i) * dim + 1] = 10 - i * 0.01;
    }
    return { points, count: 24, dim };
  }

  it('separates two blobs and converges early', () => {
    const { points, count, dim } = blobs();
    const r = kmeansCPU(points, count, dim, 2, 20, 42);
    expect(r.iterations).toBeLessThanOrEqual(20);
    const first = new Set(Array.from(r.assignments.slice(0, 12)));
    const second = new Set(Array.from(r.assignments.slice(12)));
    expect(first.size).toBe(1);
    expect(second.size).toBe(1);
    expect([...first][0]).not.toBe([...second][0]);
    // The two centroids sit near (0,0) and (10,10).
    const c = Array.from(r.centroids);
    const nearOrigin = c.slice(0, 2);
    const far = c.slice(2, 4);
    const [a, b] = nearOrigin[0]! < far[0]! ? [nearOrigin, far] : [far, nearOrigin];
    expect(a[0]).toBeLessThan(1);
    expect(b[0]).toBeGreaterThan(9);
  });

  it('is reproducible for a fixed seed', () => {
    const { points, count, dim } = blobs();
    const r1 = kmeansCPU(points, count, dim, 3, 30, 7);
    const r2 = kmeansCPU(points, count, dim, 3, 30, 7);
    expect(Array.from(r1.centroids)).toEqual(Array.from(r2.centroids));
    expect(Array.from(r1.assignments)).toEqual(Array.from(r2.assignments));
  });

  it('seeds initial centroids from k distinct input points', () => {
    const { points, count, dim } = blobs();
    const c = kmeansInitCentroids(points, count, dim, 4, 99);
    expect(c.length).toBe(8);
    const seen = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        if (
          Math.abs(points[i * dim]! - c[j * dim]!) < 1e-9 &&
          Math.abs(points[i * dim + 1]! - c[j * dim + 1]!) < 1e-9
        ) {
          seen.add(String(j));
        }
      }
    }
    expect(seen.size).toBe(4);
  });

  it('rejects invalid shapes', () => {
    const { points, count, dim } = blobs();
    expect(() => kmeansCPU(points, count, dim, 0, 10, 1)).toThrow();
    expect(() => kmeansCPU(points, 3, dim, 4, 10, 1)).toThrow();
  });

  it('emits an atomic assignment+reduction kernel with the documented layout', () => {
    const src = kmeansKernelWGSL();
    expect(src).toContain('@compute @workgroup_size(64)');
    expect(src).toContain('if (i >= params.count)');
    expect(src).toContain('assignments[i] = best');
    expect(src).toContain('atomicAdd(&counts[best], 1u)');
    expect(src).toContain('fn addF32(');
    expect(declaredBindings(src)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('descriptor bindings match the shader layout constants', () => {
    const desc = kmeansKernelDescriptor();
    expect(desc.bindings.map((b) => b.binding)).toEqual(declaredBindings(kmeansKernelWGSL()));
    expect(desc.bindings.map((b) => b.binding)).toEqual([
      KMEANS_BINDINGS.POINTS,
      KMEANS_BINDINGS.CENTROIDS,
      KMEANS_BINDINGS.ASSIGNMENTS,
      KMEANS_BINDINGS.SUMS,
      KMEANS_BINDINGS.COUNTS,
      KMEANS_BINDINGS.PARAMS,
    ]);
  });

  it('packs params and sizes the reduction buffers', () => {
    const buf = packKMeansParams(2048, 5, 3);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(2048);
    expect(dv.getUint32(4, true)).toBe(5);
    expect(dv.getUint32(8, true)).toBe(3);
    expect(kmeansSumsBytes(5, 3)).toBe(60);
    expect(kmeansCountsBytes(5)).toBe(20);
  });
});

describe('binning kernel', () => {
  it('sums values per bin over a fixed range', () => {
    const keys = Float32Array.from([0.05, 0.15, 0.25, 0.95]);
    const values = Float32Array.from([10, 20, 30, 40]);
    const r = binningCPU(keys, values, 2, 0, 1, 'sum');
    expect(Array.from(r.result)).toEqual([60, 40]);
    expect(Array.from(r.counts)).toEqual([3, 1]);
  });

  it('computes means and counts', () => {
    const keys = Float32Array.from([0, 0.5, 0.5]);
    const values = Float32Array.from([2, 4, 8]);
    const mean = binningCPU(keys, values, 2, 0, 1, 'mean');
    expect(Array.from(mean.result)).toEqual([2, 6]);
    const count = binningCPU(keys, values, 2, 0, 1, 'count');
    expect(Array.from(count.result)).toEqual([1, 2]);
  });

  it('drops NaN and out-of-range keys and handles a zero-width range', () => {
    const keys = Float32Array.from([NaN, -1, 5, 5, 11]);
    const values = Float32Array.from([1, 1, 2, 3, 1]);
    const r = binningCPU(keys, values, 3, 5, 5, 'sum');
    expect(Array.from(r.result)).toEqual([5, 0, 0]);
    expect(Array.from(r.counts)).toEqual([2, 0, 0]);
  });

  it('rejects invalid shapes', () => {
    expect(() => binningCPU(new Float32Array(1), new Float32Array(2), 2, 0, 1, 'sum')).toThrow();
    expect(() => binningCPU(new Float32Array(2), new Float32Array(2), 0, 0, 1, 'sum')).toThrow();
  });

  it('emits an atomic aggregation kernel with the documented layout', () => {
    const src = binningKernelWGSL();
    expect(src).toContain('@compute @workgroup_size(64)');
    expect(src).toContain('if (i >= params.count)');
    expect(src).toContain('atomicAdd(&counts[b], 1u)');
    expect(src).toContain('params.mode');
    expect(src).toContain('if (!(v >= params.min && v <= params.max))');
    expect(declaredBindings(src)).toEqual([0, 1, 2, 3, 4]);
  });

  it('descriptor bindings match the shader layout constants', () => {
    const desc = binningKernelDescriptor();
    expect(desc.bindings.map((b) => b.binding)).toEqual(declaredBindings(binningKernelWGSL()));
    expect(desc.bindings.map((b) => b.binding)).toEqual([
      BINNING_BINDINGS.KEYS,
      BINNING_BINDINGS.VALUES,
      BINNING_BINDINGS.PARAMS,
      BINNING_BINDINGS.SUMS,
      BINNING_BINDINGS.COUNTS,
    ]);
  });

  it('packs params with the mode code and sizes the sums buffer', () => {
    const buf = packBinningParams(0, 10, 4, 1000, 'mean');
    const dv = new DataView(buf);
    expect(buf.byteLength).toBe(32);
    expect(dv.getFloat32(0, true)).toBe(0);
    expect(dv.getFloat32(4, true)).toBe(10);
    expect(dv.getUint32(8, true)).toBe(4);
    expect(dv.getUint32(12, true)).toBe(1000);
    expect(dv.getUint32(16, true)).toBe(1); // mean
    expect(new DataView(packBinningParams(0, 1, 1, 1, 'count')).getUint32(16, true)).toBe(2);
    expect(new DataView(packBinningParams(0, 1, 1, 1, 'sum')).getUint32(16, true)).toBe(0);
    expect(binningSumsBytes(8)).toBe(32);
  });
});

describe('engine routing', () => {
  it('exposes the FR-12 thresholds', () => {
    expect(GPU_KERNEL_THRESHOLDS.matmul).toBe(128 * 128);
    expect(GPU_KERNEL_THRESHOLDS.fft).toBe(1024);
    expect(GPU_KERNEL_THRESHOLDS.kmeans).toBe(2048);
    expect(GPU_KERNEL_THRESHOLDS.binning).toBe(10000);
  });

  it('selects gpu only when available and above threshold', () => {
    expect(selectEngine(16384, 16384, true)).toBe('gpu'); // boundary is inclusive
    expect(selectEngine(16383, 16384, true)).toBe('cpu');
    expect(selectEngine(1_000_000, 16384, false)).toBe('cpu');
    expect(selectEngine(0, 0, true)).toBe('gpu');
  });
});

describe('kernel execution perf reporting', () => {
  it('buffers samples in a bounded ring and clears on demand', () => {
    clearKernelExecutions();
    recordKernelExecution({ kernel: 'matmul', engine: 'cpu', durationMs: 1.5, memoryBytes: 64 });
    recordKernelExecution({ kernel: 'fft', engine: 'gpu', durationMs: 0.5, memoryBytes: 128 });
    const samples = kernelExecutions();
    expect(samples.length).toBe(2);
    expect(samples[0]!.kernel).toBe('matmul');
    expect(samples[1]!.engine).toBe('gpu');
    clearKernelExecutions();
    expect(kernelExecutions().length).toBe(0);
  });
});

describe('async orchestration (CPU fallback without a device)', () => {
  it('matmulAsync matches matmulCPU', async () => {
    const a = Float32Array.from([1, 2, 3, 4]);
    const b = Float32Array.from([5, 6, 7, 8]);
    const c = await matmulAsync(a, b, 2, 2, 2);
    expect(Array.from(c)).toEqual(Array.from(matmulCPU(a, b, 2, 2, 2)));
  });

  it('fftAsync returns the transformed copy without mutating the input', async () => {
    const data = Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]);
    const before = Float32Array.from(data);
    const out = await fftAsync(data, 4);
    expect(Array.from(data)).toEqual(Array.from(before));
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[2]).toBeCloseTo(1, 5);
  });

  it('kmeansAsync matches kmeansCPU for the same seed', async () => {
    const points = new Float32Array(32);
    for (let i = 0; i < 8; i += 1) {
      points[i * 2] = i * 0.01;
      points[i * 2 + 1] = -i * 0.01;
      points[(8 + i) * 2] = 10 + i * 0.01;
      points[(8 + i) * 2 + 1] = 10 - i * 0.01;
    }
    const gpu = await kmeansAsync(points, 16, 2, 2, 20, 5);
    const cpu = kmeansCPU(points, 16, 2, 2, 20, 5);
    expect(Array.from(gpu.centroids)).toEqual(Array.from(cpu.centroids));
    expect(Array.from(gpu.assignments)).toEqual(Array.from(cpu.assignments));
  });

  it('binningAsync matches binningCPU for every mode', async () => {
    const keys = Float32Array.from([0.1, 0.2, 0.7, 0.9]);
    const values = Float32Array.from([1, 2, 3, 4]);
    for (const mode of ['sum', 'mean', 'count'] as const) {
      const r = await binningAsync(keys, values, 4, 0, 1, mode);
      const c = binningCPU(keys, values, 4, 0, 1, mode);
      expect(Array.from(r.result)).toEqual(Array.from(c.result));
      expect(Array.from(r.counts)).toEqual(Array.from(c.counts));
    }
  });
});
