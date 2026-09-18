// ==========================================================================
// GPU point-cloud enhancement (spec FR-15): million-point budgets,
// deterministic downsampling and a WebGPU height-coloring kernel.
//
// Policy: when WebGPU is available the full cloud (up to GPU_POINT_BUDGET)
// is kept in ONE interleaved buffer and rendered as a single draw — the
// million-point path never splits submissions. Without WebGPU the cloud is
// downsampled to CPU_POINT_BUDGET and `downsampled` is surfaced so the UI
// can tell the user. Both paths share the same data semantics: identical
// xyz-interleaved layout, identical height→color ramp (the WGSL kernel and
// `heightColorsCPU` are exact mirrors of each other).
//
// All pure functions here are unit-testable in the Node environment; the
// WebGPU device is only ever touched behind runtime feature detection.
// ==========================================================================

import { mulberry32 } from './repro/random';
import { logger } from './logger';
import { GPU_BUFFER_USAGE } from './wgsl';
import type { ComputeBufferHandle, GpuComputeApi } from '@/types/plugin';

/** Points kept in full when WebGPU rendering/compute is available. */
export const GPU_POINT_BUDGET = 1_000_000;
/** Points kept when falling back to CPU rendering (spec: ~200k cap). */
export const CPU_POINT_BUDGET = 200_000;
/** Below this point count the CPU color ramp is already fast enough. */
export const GPU_COLOR_THRESHOLD = 200_000;

export type DownsampleStrategy = 'stride' | 'random';

export interface PrepareOptions {
  /** Runtime WebGPU availability (feature-detected by the caller). */
  gpuAvailable: boolean;
  /** Override the automatic budget (tests / explicit UI choice). */
  maxPoints?: number;
  strategy?: DownsampleStrategy;
  /** Seed for the 'random' strategy (deterministic by default). */
  seed?: number;
}

export interface PreparedPointCloud {
  /** Points to render — a subarray view or the original buffer, never a copy. */
  positions: Float32Array;
  /** Total parsed points (input). */
  total: number;
  /** Points actually rendered (`positions.length / 3`). */
  shown: number;
  /** True when the cloud exceeded the budget and was downsampled. */
  downsampled: boolean;
  /** Budget that was applied. */
  budget: number;
}

/**
 * Runtime WebGPU feature detection — never throws in Node / non-GPU
 * environments. Device *usability* additionally requires an initialized
 * backend (see `core/gpu.ts`); this only answers "could we have one".
 */
export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu);
}

/** Uniform stride sampling: evenly spaced points, always including the first. */
export function strideDownsample(positions: Float32Array, maxPoints: number): Float32Array {
  const count = Math.floor(positions.length / 3);
  if (maxPoints <= 0 || count <= maxPoints) return positions;
  const out = new Float32Array(maxPoints * 3);
  for (let i = 0; i < maxPoints; i += 1) {
    const src = Math.min(Math.floor((i * count) / maxPoints), count - 1);
    out[i * 3] = positions[src * 3] ?? 0;
    out[i * 3 + 1] = positions[src * 3 + 1] ?? 0;
    out[i * 3 + 2] = positions[src * 3 + 2] ?? 0;
  }
  return out;
}

/**
 * Random sampling without replacement via a seeded PRNG (mulberry32): the
 * same seed always yields the same subset, so a downsampled view is
 * reproducible across reloads and exports.
 */
export function randomDownsample(positions: Float32Array, maxPoints: number, seed = 1): Float32Array {
  const count = Math.floor(positions.length / 3);
  if (maxPoints <= 0 || count <= maxPoints) return positions;
  const rand = mulberry32(seed);
  const out = new Float32Array(maxPoints * 3);
  for (let i = 0; i < maxPoints; i += 1) {
    const src = Math.min(Math.floor(rand() * count), count - 1);
    out[i * 3] = positions[src * 3] ?? 0;
    out[i * 3 + 1] = positions[src * 3 + 1] ?? 0;
    out[i * 3 + 2] = positions[src * 3 + 2] ?? 0;
  }
  return out;
}

/**
 * Apply the million-point / downsample policy to a parsed cloud. Returns a
 * zero-copy view when no downsampling is needed.
 */
export function preparePointCloud(
  positions: Float32Array,
  opts: PrepareOptions,
): PreparedPointCloud {
  const total = Math.floor(positions.length / 3);
  const budget = opts.maxPoints ?? (opts.gpuAvailable ? GPU_POINT_BUDGET : CPU_POINT_BUDGET);
  if (total <= budget) {
    return { positions, total, shown: total, downsampled: false, budget };
  }
  const sampled =
    opts.strategy === 'random'
      ? randomDownsample(positions, budget, opts.seed ?? 1)
      : strideDownsample(positions, budget);
  return {
    positions: sampled,
    total,
    shown: Math.floor(sampled.length / 3),
    downsampled: true,
    budget,
  };
}

// ---- Height color ramp ------------------------------------------------------
//
// Deep teal → bright cyan → amber, piecewise-linear at t = 0.5. The WGSL
// kernel below mirrors these stops exactly (0x0d9488 / 0x22d3ee / 0xfbbf24).

export const RAMP_LOW: readonly [number, number, number] = [0x0d / 255, 0x94 / 255, 0x88 / 255];
export const RAMP_MID: readonly [number, number, number] = [0x22 / 255, 0xd3 / 255, 0xee / 255];
export const RAMP_HIGH: readonly [number, number, number] = [0xfb / 255, 0xbf / 255, 0x24 / 255];

/** Piecewise-linear teal → cyan → amber ramp on t ∈ [0, 1] (clamped). */
export function rampColor(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  return rampColorUnclamped(clamped);
}

function rampColorUnclamped(t: number): [number, number, number] {
  const a = t < 0.5 ? RAMP_LOW : RAMP_MID;
  const b = t < 0.5 ? RAMP_MID : RAMP_HIGH;
  const local = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return [
    a[0] + (b[0] - a[0]) * local,
    a[1] + (b[1] - a[1]) * local,
    a[2] + (b[2] - a[2]) * local,
  ];
}

/**
 * Ramp one scalar per input value into one rgb triplet per input value.
 * Shared by the point-cloud CPU path and the surface/voxel meshes.
 */
export function scalarRampColors(
  values: Float32Array,
  min: number,
  max: number,
): Float32Array {
  const colors = new Float32Array(values.length * 3);
  const span = Math.max(max - min, 1e-9);
  for (let i = 0; i < values.length; i += 1) {
    const t = Math.min(1, Math.max(0, ((values[i] ?? 0) - min) / span));
    const c = rampColor(t);
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  return colors;
}

/** CPU path of the coloring kernel: xyz-interleaved in, rgb-interleaved out. */
export function heightColorsCPU(
  positions: Float32Array,
  minZ: number,
  maxZ: number,
): Float32Array {
  const count = Math.floor(positions.length / 3);
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i += 1) heights[i] = positions[i * 3 + 2] ?? 0;
  return scalarRampColors(heights, minZ, maxZ);
}

// ---- WGSL coloring kernel ---------------------------------------------------
//
// One thread per point, one dispatch over the whole million-point buffer —
// the GPU path never splits the work across submissions.
//
// Bind group:
//   @binding(0) read-only-storage — points : f32[count*3] (xyz interleaved)
//   @binding(1) uniform          — struct { count: u32, _pad: u32,
//                                           minZ: f32, maxZ: f32 } (16 bytes)
//   @binding(2) storage, read_write — colors: f32[count*3] (rgb interleaved)

export const POINTCLOUD_GPU_POINTS_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST;

export const POINTCLOUD_GPU_COLORS_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const POINTCLOUD_GPU_PARAMS_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

export interface PointCloudGpuKernelOptions {
  /** Workgroup size (threads per workgroup). Defaults to 64. */
  workgroupSize?: number;
}

export function pointCloudColorKernelWGSL(opts: PointCloudGpuKernelOptions = {}): string {
  const workgroupSize = opts.workgroupSize ?? 64;
  return `struct Params {
  count: u32,
  _pad: u32,
  minZ: f32,
  maxZ: f32,
};

@group(0) @binding(0) var<storage, read> points: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> colors: array<f32>;

fn ramp(tIn: f32) -> vec3<f32> {
  let t = clamp(tIn, 0.0, 1.0);
  let low = vec3<f32>(0.05098, 0.58039, 0.53333);
  let mid = vec3<f32>(0.13333, 0.82745, 0.93333);
  let high = vec3<f32>(0.98431, 0.74902, 0.14118);
  if (t < 0.5) {
    return mix(low, mid, t * 2.0);
  }
  return mix(mid, high, (t - 0.5) * 2.0);
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  let i3 = i * 3u;
  let z = points[i3 + 2u];
  let span = max(params.maxZ - params.minZ, 1e-9);
  let c = ramp((z - params.minZ) / span);
  colors[i3 + 0u] = c.x;
  colors[i3 + 1u] = c.y;
  colors[i3 + 2u] = c.z;
}
`;
}

/** Byte size of the color output buffer for `count` points. */
export function pointCloudColorBytes(count: number): number {
  return Math.max(0, Math.floor(count)) * 3 * 4;
}

/** Pack the coloring kernel's 16-byte uniform block. */
export function packPointCloudGpuParams(count: number, minZ: number, maxZ: number): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setUint32(0, count >>> 0, true);
  dv.setUint32(4, 0, true);
  dv.setFloat32(8, minZ, true);
  dv.setFloat32(12, maxZ, true);
  return buf;
}

/**
 * GPU path of `heightColorsCPU`: upload the whole cloud once, dispatch once,
 * read the colors back. Returns `null` on any failure so the caller can fall
 * back to the CPU ramp transparently.
 */
export async function heightColorsGpu(
  gpu: GpuComputeApi,
  positions: Float32Array,
  minZ: number,
  maxZ: number,
): Promise<Float32Array | null> {
  const count = Math.floor(positions.length / 3);
  if (count === 0) return new Float32Array(0);
  const buffers: ComputeBufferHandle[] = [];
  try {
    const kernel = gpu.compileKernel({
      label: 'pointcloud.color',
      wgsl: pointCloudColorKernelWGSL(),
      workgroupSize: [64, 1, 1],
      bindings: [
        { binding: 0, bufferType: 'read-only-storage' },
        { binding: 1, bufferType: 'uniform' },
        { binding: 2, bufferType: 'storage' },
      ],
    });
    if (!kernel) return null;
    const pointsBuf = gpu.createBuffer(positions.byteLength, POINTCLOUD_GPU_POINTS_USAGE, 'pointcloud.points');
    if (pointsBuf) buffers.push(pointsBuf);
    const paramsBuf = gpu.createBuffer(16, POINTCLOUD_GPU_PARAMS_USAGE, 'pointcloud.color.params');
    if (paramsBuf) buffers.push(paramsBuf);
    const colorsBuf = gpu.createBuffer(pointCloudColorBytes(count), POINTCLOUD_GPU_COLORS_USAGE, 'pointcloud.colors');
    if (colorsBuf) buffers.push(colorsBuf);
    if (!pointsBuf || !paramsBuf || !colorsBuf) return null;
    pointsBuf.write(positions);
    paramsBuf.write(new Uint8Array(packPointCloudGpuParams(count, minZ, maxZ)));
    if (!gpu.run(kernel, [pointsBuf, paramsBuf, colorsBuf], Math.ceil(count / 64), 1, 1)) {
      return null;
    }
    const ab = await colorsBuf.read();
    return new Float32Array(ab, 0, count * 3);
  } catch (err) {
    logger.warn('pointcloud-gpu', 'GPU coloring failed, using CPU ramp', err);
    return null;
  } finally {
    for (const buf of buffers) buf.destroy();
  }
}
