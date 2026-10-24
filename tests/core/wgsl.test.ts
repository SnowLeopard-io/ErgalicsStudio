// WGSL kernel template tests — the histogram, heatmap and point-cloud kernels
// plus their CPU fallbacks. The CPU functions must mirror the WGSL math so
// GPU/CPU results agree (spec §8.3).
import { describe, it, expect } from 'vitest';
import {
  histogramKernelWGSL,
  histogramCPU,
  heatmapKernelWGSL,
  heatmapCPU,
  heatmapColor,
  packHistogramParams,
  packHeatmapParams,
  histogramCountsBytes,
  heatmapColorsBytes,
  pointCloudKernelWGSL,
  pointCloudCPU,
  packPointCloudParams,
  pointCloudOutputBytes,
} from '@/core/wgsl';

describe('histogram kernel', () => {
  it('emits a workgroup_size annotation and guards the count', () => {
    const src = histogramKernelWGSL();
    expect(src).toContain('@workgroup_size(64)');
    expect(src).toContain('if (i >= params.count)');
    expect(src).toContain('atomicAdd(&counts[b], 1u)');
  });

  it('counts CPU-side into the correct buckets for a fixed range', () => {
    // 0 → bucket 0, 0.25 → bucket 1, 0.75 → bucket 3 (4 bins over [0,1]).
    const counts = histogramCPU(Float64Array.from([0, 0.25, 0.75, 0.99]), 4, 0, 1);
    expect(Array.from(counts)).toEqual([1, 1, 0, 2]);
  });

  it('routes out-of-range and NaN values into no bucket', () => {
    const counts = histogramCPU(Float64Array.from([-5, 0.5, 1.5, NaN]), 2, 0, 1);
    expect(Array.from(counts)).toEqual([0, 1]);
  });

  it('handles a degenerate zero-width range without dividing by zero', () => {
    const counts = histogramCPU(Float64Array.from([1, 1, 1]), 4, 1, 1);
    expect(Array.from(counts)).toEqual([3, 0, 0, 0]);
  });

  it('returns zeroed bins for an empty input', () => {
    const counts = histogramCPU(new Float64Array(0), 3, 0, 1);
    expect(Array.from(counts)).toEqual([0, 0, 0]);
  });

  it('packs params with a real u32 count', () => {
    const buf = packHistogramParams(0, 10, 4, 7);
    const dv = new DataView(buf);
    expect(dv.getFloat32(0, true)).toBe(0);
    expect(dv.getFloat32(4, true)).toBe(10);
    expect(dv.getUint32(8, true)).toBe(4);
    expect(dv.getUint32(12, true)).toBe(7);
  });

  it('sizes the counts buffer at 4 bytes per bin', () => {
    expect(histogramCountsBytes(8)).toBe(32);
  });
});

describe('heatmap kernel', () => {
  it('emits 2-D workgroup and pixel guard', () => {
    const src = heatmapKernelWGSL();
    expect(src).toContain('@workgroup_size(8, 8)');
    expect(src).toContain('if (x >= params.width || y >= params.height)');
  });

  it('maps the colormap endpoints correctly', () => {
    expect(heatmapColor(0)[0]).toBeCloseTo(0.13);
    expect(heatmapColor(0)[2]).toBeCloseTo(0.74);
    expect(heatmapColor(1)[0]).toBeCloseTo(0.93);
    expect(heatmapColor(1)[2]).toBeCloseTo(0.13);
  });

  it('produces an RGBA output for a full grid', () => {
    const out = heatmapCPU(new Float32Array([0, 1]), 2, 1, 0, 1);
    expect(out.length).toBe(8);
    // Pixel 0 = min → first stop; pixel 1 = max → last stop.
    expect(out[0]).toBeCloseTo(0.13);
    expect(out[7]).toBeCloseTo(1);
  });

  it('clamps values outside the range', () => {
    const out = heatmapCPU(new Float32Array([-10, 10]), 2, 1, 0, 1);
    expect(out[0]).toBeCloseTo(0.13);
    expect(out[7]).toBeCloseTo(1);
  });

  it('handles an all-equal grid via the zero-width guard', () => {
    const out = heatmapCPU(new Float32Array([5, 5]), 2, 1, 5, 5);
    expect(out[0]).toBeCloseTo(0.13);
  });

  it('packs params and sizes buffers', () => {
    const buf = packHeatmapParams(64, 48, 0, 255);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(64);
    expect(dv.getUint32(4, true)).toBe(48);
    expect(dv.getFloat32(8, true)).toBe(0);
    expect(dv.getFloat32(12, true)).toBe(255);
    expect(heatmapColorsBytes(100)).toBe(1600);
  });
});

describe('point-cloud kernel', () => {
  it('emits a workgroup_size annotation and guards the count', () => {
    const src = pointCloudKernelWGSL();
    expect(src).toContain('@workgroup_size(64)');
    expect(src).toContain('if (i >= params.count)');
  });

  it('projects points into screen space with y flipped', () => {
    // Canvas 100x100, scale 10, origin at (50, 50): (1,1) → (60, 40).
    const out = pointCloudCPU(new Float32Array([1, 1, 0]), 100, 100, 10, 50, 50, 2);
    expect(out[0]).toBe(60);
    expect(out[1]).toBe(40);
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(1);
  });

  it('flags out-of-viewport points as invisible (clipping)', () => {
    const out = pointCloudCPU(new Float32Array([-10, 0, 0, 0, 5, 0, 0, 200, 0]), 100, 100, 10, 50, 50, 2);
    expect(out[3]).toBe(0); // x = -100 + 50 → clipped
    expect(out[7]).toBe(1); // y = 0 → (50, 50) → visible
    expect(out[11]).toBe(0); // y = 200 → (50, -1950) → clipped
  });

  it('keeps the visible flag off for a zero-area canvas', () => {
    const out = pointCloudCPU(new Float32Array([0, 0, 0]), 0, 0, 1, 0, 0, 1);
    expect(out[3]).toBe(0);
  });

  it('packs params with real u32 fields and sizes the output buffer', () => {
    const buf = packPointCloudParams(320, 240, 1000, 2.5, 10, 20, 3);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(320);
    expect(dv.getUint32(4, true)).toBe(240);
    expect(dv.getUint32(8, true)).toBe(1000);
    expect(dv.getFloat32(12, true)).toBeCloseTo(2.5);
    expect(dv.getFloat32(16, true)).toBeCloseTo(10);
    expect(dv.getFloat32(20, true)).toBeCloseTo(20);
    expect(dv.getFloat32(24, true)).toBeCloseTo(3);
    expect(pointCloudOutputBytes(500)).toBe(8000);
  });
});