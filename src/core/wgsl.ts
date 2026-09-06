// ==========================================================================
// WGSL kernel templates (spec §8.3).
//
// Reusable compute shaders exposed to plugins. The kernels are deliberately
// minimal and data-driven so any plugin can adapt them: each one documents
// its exact bind group layout (buffer index → usage) and uniform struct, so
// the Rust/JS binding descriptors stay in lockstep.
// ==========================================================================

import type { ParticleState } from '@/types/plugin';

// ---- Buffer usage flags (mirror of GPUBufferUsage, kept local so the
// ---- compute layer does not depend on browser globals at import time).

export const GPU_BUFFER_USAGE = {
  MAP_READ: 1,
  MAP_WRITE: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  INDEX: 16,
  VERTEX: 32,
  UNIFORM: 64,
  STORAGE: 128,
  INDIRECT: 256,
} as const;

/**
 * Usage for the particle integration storage buffer: read/write from the
 * kernel and writable/readable from JS.
 *
 * NOTE: WebGPU forbids combining `MAP_READ` with anything but `COPY_DST`, so
 * a storage buffer cannot be mapped directly. It exposes `COPY_SRC` so
 * results can be copied into a separate `MAP_READ | COPY_DST` readback buffer
 * (see the compute layer's `read`).
 */
export const PARTICLES_BUFFER_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const PARTICLES_UNIFORM_USAGE =
  GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

// ---- Particle integration kernel ----------------------------------------
//
// Bind group:
//   @binding(0) storage, read_write  — interleaved [x,y,vx,vy] × count
//   @binding(1) uniform              — struct { dt: f32, speed: f32,
//                                       count: u32, _pad: u32 }  (16 bytes)
//
// Workgroups: 1 workgroup per 64 particles; guard against `count` overflow.

export interface ParticleKernelOptions {
  /** Workgroup size (threads per workgroup). Defaults to 64. */
  workgroupSize?: number;
}

export function particleKernelWGSL(opts: ParticleKernelOptions = {}): string {
  const workgroupSize = opts.workgroupSize ?? 64;
  return `struct Params {
  dt: f32,
  speed: f32,
  count: u32,
  _pad: u32,
};

@group(0) @binding(0) var<storage, read_write> data: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  let idx = i * 4u;
  var x = data[idx];
  var y = data[idx + 1u];
  var vx = data[idx + 2u];
  var vy = data[idx + 3u];

  x = x + vx * params.dt * params.speed;
  y = y + vy * params.dt * params.speed;

  if (x > 1.0) { x = 1.0; vx = -vx; }
  if (x < -1.0) { x = -1.0; vx = -vx; }
  if (y > 1.0) { y = 1.0; vy = -vy; }
  if (y < -1.0) { y = -1.0; vy = -vy; }

  data[idx] = x;
  data[idx + 1u] = y;
  data[idx + 2u] = vx;
  data[idx + 3u] = vy;
}
`;
}

// ---- Host-side data layout helpers --------------------------------------

/** Floats per particle in the interleaved [x,y,vx,vy] layout. */
export const PARTICLE_FLOATS_PER_PARTICLE = 4;
/** Bytes per particle (4 f32 × 4 bytes). */
export const PARTICLE_BYTES_PER_PARTICLE = 16;

/** Byte size of a particle storage buffer holding `count` particles. */
export function particleBufferBytes(count: number): number {
  return Math.max(0, Math.floor(count)) * PARTICLE_BYTES_PER_PARTICLE;
}

/** Flatten `[x,y,vx,vy] × count` particles into an interleaved f32 array. */
export function packParticles(particles: ParticleState[]): Float32Array {
  const out = new Float32Array(particles.length * PARTICLE_FLOATS_PER_PARTICLE);
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i] as ParticleState;
    const j = i * PARTICLE_FLOATS_PER_PARTICLE;
    out[j] = p.x;
    out[j + 1] = p.y;
    out[j + 2] = p.vx;
    out[j + 3] = p.vy;
  }
  return out;
}

/** Read interleaved f32 data back into `out` (kept at its current length). */
export function unpackParticles(data: Float32Array, out: ParticleState[]): void {
  const n = Math.min(out.length, Math.floor(data.length / PARTICLE_FLOATS_PER_PARTICLE));
  for (let i = 0; i < n; i += 1) {
    const j = i * PARTICLE_FLOATS_PER_PARTICLE;
    const p = out[i] as ParticleState;
    p.x = data[j] as number;
    p.y = data[j + 1] as number;
    p.vx = data[j + 2] as number;
    p.vy = data[j + 3] as number;
  }
}

/** CPU-equivalent of the particle kernel's per-step integration. */
export function advanceParticleCPU(p: ParticleState, dt: number, speed: number): void {
  p.x += p.vx * dt * speed;
  p.y += p.vy * dt * speed;
  if (p.x > 1) {
    p.x = 1;
    p.vx = -p.vx;
  }
  if (p.x < -1) {
    p.x = -1;
    p.vx = -p.vx;
  }
  if (p.y > 1) {
    p.y = 1;
    p.vy = -p.vy;
  }
  if (p.y < -1) {
    p.y = -1;
    p.vy = -p.vy;
  }
}

/**
 * Uniform params buffer bytes: [dt, speed, count, _pad] as 4 × f32.
 *
 * `count` is written as a *real* `u32` through a DataView because the kernel
 * reads it as `u32` (see `particleKernelWGSL`). A plain f32 store would leave
 * the floating-point bit pattern in memory, which the shader would interpret
 * as a huge count and the `i >= params.count` bounds guard would never fire.
 */
export function packParticleParams(dt: number, speed: number, count: number): Float32Array {
  const out = new Float32Array(4);
  out[0] = dt;
  out[1] = speed;
  new DataView(out.buffer).setUint32(8, count >>> 0, true);
  out[3] = 0;
  return out;
}

// ==========================================================================
// N-body gravity kernel (astrophysics, 3D).
//
// All-pairs direct summation in three dimensions: every body feels the
// gravitational pull of every other body (O(N²) per step), integrated with
// semi-implicit Euler. Each invocation handles one body and reads the full
// body array (read-only) while writing only its own slot.
//
// Bind group:
//   @binding(0) read-only-storage  — bodiesIn  : [x,y,z,vx,vy,vz,m]×N
//   @binding(1) storage, read_write — bodiesOut : [x,y,z,vx,vy,vz,m]×N
//   @binding(2) uniform            — struct { dt: f32, G: f32,
//                                            softening: f32, count: u32 }
//
// Workgroups: 1 workgroup per 64 bodies; the `count` guard prevents threads
// from indexing past the array when N is not a multiple of 64.
// ==========================================================================

/** Floats per body in the interleaved [x, y, z, vx, vy, vz, mass] layout. */
export const NBODY_FLOATS_PER_BODY = 7;
/** Bytes per body (7 f32 × 4 bytes). */
export const NBODY_BYTES_PER_BODY = 28;

/**
 * Storage buffer usage for a body array: read/write from the kernel, writable
 * from JS, and (via `COPY_SRC`) copyable into a separate readback buffer.
 */
export const NBODY_BUFFER_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const NBODY_PARAMS_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

export interface NBodyBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Gravitational mass (≥ 0). */
  mass: number;
}

export interface NBodyKernelOptions {
  /** Workgroup size (threads per workgroup). Defaults to 64. */
  workgroupSize?: number;
}

/**
 * Generate the 3-D all-pairs gravity WGSL kernel. The kernel reads `bodiesIn`,
 * accumulates the gravitational acceleration from every other body (skipping
 * self), then advances velocity and position by `dt`.
 */
export function nbodyKernelWGSL(opts: NBodyKernelOptions = {}): string {
  const workgroupSize = opts.workgroupSize ?? 64;
  return `struct Params {
  dt: f32,
  G: f32,
  softening: f32,
  count: u32,
};

@group(0) @binding(0) var<storage, read> bodiesIn: array<f32>;
@group(0) @binding(1) var<storage, read_write> bodiesOut: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

const STRIDE: u32 = 7u;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  let base = i * STRIDE;

  let px = bodiesIn[base + 0u];
  let py = bodiesIn[base + 1u];
  let pz = bodiesIn[base + 2u];
  let vx = bodiesIn[base + 3u];
  let vy = bodiesIn[base + 4u];
  let vz = bodiesIn[base + 5u];
  let m = bodiesIn[base + 6u];

  var ax = 0.0;
  var ay = 0.0;
  var az = 0.0;
  for (var j: u32 = 0u; j < params.count; j = j + 1u) {
    if (j == i) { continue; }
    let jb = j * STRIDE;
    let dx = bodiesIn[jb + 0u] - px;
    let dy = bodiesIn[jb + 1u] - py;
    let dz = bodiesIn[jb + 2u] - pz;
    let distSq = dx * dx + dy * dy + dz * dz + params.softening * params.softening;
    let invDist = inverseSqrt(distSq);
    let invDist3 = invDist * invDist * invDist;
    let f = params.G * m * bodiesIn[jb + 6u] * invDist3;
    ax = ax + f * dx;
    ay = ay + f * dy;
    az = az + f * dz;
  }

  let nvx = vx + ax * params.dt;
  let nvy = vy + ay * params.dt;
  let nvz = vz + az * params.dt;
  bodiesOut[base + 0u] = px + nvx * params.dt;
  bodiesOut[base + 1u] = py + nvy * params.dt;
  bodiesOut[base + 2u] = pz + nvz * params.dt;
  bodiesOut[base + 3u] = nvx;
  bodiesOut[base + 4u] = nvy;
  bodiesOut[base + 5u] = nvz;
  bodiesOut[base + 6u] = m;
}
`;
}

/** Byte size of a body storage buffer holding `count` bodies. */
export function nbodyBufferBytes(count: number): number {
  return Math.max(0, Math.floor(count)) * NBODY_BYTES_PER_BODY;
}

/** Flatten `[x,y,z,vx,vy,vz,mass] × count` bodies into an interleaved f32 array. */
export function packBodies(bodies: NBodyBody[]): Float32Array {
  const out = new Float32Array(bodies.length * NBODY_FLOATS_PER_BODY);
  for (let i = 0; i < bodies.length; i += 1) {
    const b = bodies[i] as NBodyBody;
    const j = i * NBODY_FLOATS_PER_BODY;
    out[j] = b.x;
    out[j + 1] = b.y;
    out[j + 2] = b.z;
    out[j + 3] = b.vx;
    out[j + 4] = b.vy;
    out[j + 5] = b.vz;
    out[j + 6] = b.mass;
  }
  return out;
}

/** Read interleaved f32 data back into `out` (kept at its current length). */
export function unpackBodies(data: Float32Array, out: NBodyBody[]): void {
  const n = Math.min(out.length, Math.floor(data.length / NBODY_FLOATS_PER_BODY));
  for (let i = 0; i < n; i += 1) {
    const j = i * NBODY_FLOATS_PER_BODY;
    const b = out[i] as NBodyBody;
    b.x = data[j] as number;
    b.y = data[j + 1] as number;
    b.z = data[j + 2] as number;
    b.vx = data[j + 3] as number;
    b.vy = data[j + 4] as number;
    b.vz = data[j + 5] as number;
    b.mass = data[j + 6] as number;
  }
}

/**
 * Pack the N-body uniform params into a 16-byte ArrayBuffer.
 *
 * Uses a DataView so the `count` field is written as a *real* `u32` (the
 * kernel reads it as `u32`). A plain Float32Array would store the floating
 * bit-pattern, which the shader would misinterpret as a huge count.
 */
export function packNBodyParams(dt: number, G: number, softening: number, count: number): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setFloat32(0, dt, true);
  dv.setFloat32(4, G, true);
  dv.setFloat32(8, softening, true);
  dv.setUint32(12, count >>> 0, true);
  return buf;
}

/**
 * CPU-equivalent of the N-body kernel's per-step integration. Computes the
 * gravitational acceleration on every body from every other body, then
 * advances velocity and position (semi-implicit Euler), mirroring the WGSL
 * math exactly so CPU and GPU produce matching trajectories.
 */
export function advanceNBodyCPU(
  bodies: NBodyBody[],
  dt: number,
  G: number,
  softening: number,
): void {
  const n = bodies.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const az = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const bi = bodies[i] as NBodyBody;
    let axi = 0;
    let ayi = 0;
    let azi = 0;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const bj = bodies[j] as NBodyBody;
      const dx = bj.x - bi.x;
      const dy = bj.y - bi.y;
      const dz = bj.z - bi.z;
      const distSq = dx * dx + dy * dy + dz * dz + softening * softening;
      const invDist = 1 / Math.sqrt(distSq);
      const invDist3 = invDist * invDist * invDist;
      const f = (G * bi.mass * bj.mass) * invDist3;
      axi += f * dx;
      ayi += f * dy;
      azi += f * dz;
    }
    ax[i] = axi;
    ay[i] = ayi;
    az[i] = azi;
  }
  for (let i = 0; i < n; i += 1) {
    const bi = bodies[i] as NBodyBody;
    bi.vx += (ax[i] ?? 0) * dt;
    bi.vy += (ay[i] ?? 0) * dt;
    bi.vz += (az[i] ?? 0) * dt;
    bi.x += bi.vx * dt;
    bi.y += bi.vy * dt;
    bi.z += bi.vz * dt;
  }
}

/**
 * Total kinetic + potential energy of the system — a useful sanity check that
 * an integrator is conserving the system (drift stays small over many steps).
 */
export function nbodyTotalEnergy(bodies: NBodyBody[], G: number, softening: number): number {
  let ke = 0;
  let pe = 0;
  const n = bodies.length;
  for (let i = 0; i < n; i += 1) {
    const bi = bodies[i] as NBodyBody;
    ke += 0.5 * bi.mass * (bi.vx * bi.vx + bi.vy * bi.vy + bi.vz * bi.vz);
    for (let j = i + 1; j < n; j += 1) {
      const bj = bodies[j] as NBodyBody;
      const dx = bj.x - bi.x;
      const dy = bj.y - bi.y;
      const dz = bj.z - bi.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz + softening * softening);
      pe -= (G * bi.mass * bj.mass) / dist;
    }
  }
  return ke + pe;
}

// ==========================================================================
// Histogram kernel (1-D binning, GPU-accelerated).
//
// Bins `count` f32 values into `bins` buckets between [min, max]. Each
// invocation handles one value and atomically increments its bucket, so the
// write pattern is race-free regardless of workgroup layout.
//
// Bind group:
//   @binding(0) read-only-storage   — values : f32[count]
//   @binding(1) uniform             — struct { min: f32, max: f32,
//                                            bins: u32, count: u32 } (16 bytes)
//   @binding(2) storage, read_write — counts : atomic<u32>[bins]
//
// The caller must zero the `counts` buffer before each dispatch (COPY_DST).
// ==========================================================================

export const HISTOGRAM_VALUES_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const HISTOGRAM_COUNTS_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const HISTOGRAM_PARAMS_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

export interface HistogramKernelOptions {
  /** Workgroup size (threads per workgroup). Defaults to 64. */
  workgroupSize?: number;
}

export function histogramKernelWGSL(opts: HistogramKernelOptions = {}): string {
  const workgroupSize = opts.workgroupSize ?? 64;
  return `struct Params {
  min: f32,
  max: f32,
  bins: u32,
  count: u32,
};

@group(0) @binding(0) var<storage, read> values: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  let v = values[i];
  // A NaN or a value outside [min, max] never lands in a bucket.
  if (v < params.min || v > params.max) { return; }
  let span = params.max - params.min;
  // Guard against a degenerate zero-width range (all values equal): route
  // everything to the first bucket instead of dividing by zero.
  var b: u32 = 0u;
  if (span > 0.0) {
    let t = (v - params.min) / span;
    b = min(u32(t * f32(params.bins)), params.bins - 1u);
  }
  atomicAdd(&counts[b], 1u);
}
`;
}

/** Byte size of a histogram counts buffer holding `bins` u32 counters. */
export function histogramCountsBytes(bins: number): number {
  return Math.max(0, Math.floor(bins)) * 4;
}

/**
 * Pack the histogram uniform params into a 16-byte ArrayBuffer (count written
 * as a real u32 via DataView, matching the kernel's u32 field).
 */
export function packHistogramParams(min: number, max: number, bins: number, count: number): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setFloat32(0, min, true);
  dv.setFloat32(4, max, true);
  dv.setUint32(8, bins >>> 0, true);
  dv.setUint32(12, count >>> 0, true);
  return buf;
}

/** CPU-equivalent of the histogram kernel: f64 bin counts for the given range. */
export function histogramCPU(
  values: Float64Array,
  bins: number,
  min?: number,
  max?: number,
): Float64Array {
  if (bins < 1) throw new Error('bins must be >= 1');
  const counts = new Float64Array(bins);
  if (values.length === 0) return counts;
  let lo = min;
  let hi = max;
  if (lo === undefined || hi === undefined) {
    lo = Infinity;
    hi = -Infinity;
    for (const v of values) {
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (lo === Infinity) return counts;
  }
  const span = hi - lo;
  for (const v of values) {
    if (!Number.isFinite(v) || v < lo || v > hi) continue;
    let b = 0;
    if (span > 0) {
      const t = (v - lo) / span;
      b = Math.min(Math.floor(t * bins), bins - 1);
    }
    counts[b] = (counts[b] ?? 0) + 1;
  }
  return counts;
}

// ==========================================================================
// Heatmap kernel (2-D grid → RGBA color, GPU-accelerated).
//
// Maps a width×height f32 grid of scalar values onto an RGBA output image
// using a blue→teal→yellow→red colormap. One invocation per pixel; each pixel
// is independent so no synchronization is needed.
//
// Bind group:
//   @binding(0) read-only-storage   — grid    : f32[width*height]
//   @binding(1) uniform             — struct { width: u32, height: u32,
//                                            min: f32, max: f32 } (16 bytes)
//   @binding(2) storage, read_write — colors  : f32[width*height*4] (RGBA)
//
// Workgroups: dispatch with (width/8, height/8); the guard drops overhanging
// threads when the grid is not a multiple of 8.
// ==========================================================================

export const HEATMAP_GRID_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const HEATMAP_COLORS_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const HEATMAP_PARAMS_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

export function heatmapKernelWGSL(): string {
  return `struct Params {
  width: u32,
  height: u32,
  min: f32,
  max: f32,
};

@group(0) @binding(0) var<storage, read> grid: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> colors: array<f32>;

// Blue → teal → yellow → red ramp (matches HEATMAP_STOPS in wgsl.ts).
fn colormap(t: f32) -> vec3<f32> {
  let stops = array<vec3<f32>, 5>(
    vec3<f32>(0.13, 0.23, 0.74),
    vec3<f32>(0.18, 0.64, 0.86),
    vec3<f32>(0.17, 0.94, 0.67),
    vec3<f32>(0.98, 0.86, 0.26),
    vec3<f32>(0.93, 0.28, 0.13),
  );
  let x = clamp(t, 0.0, 1.0) * 4.0;
  let i = min(u32(x), 4u);
  let f = x - f32(i);
  let c0 = stops[i];
  let c1 = stops[min(i + 1u, 4u)];
  return mix(c0, c1, f);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.width || y >= params.height) { return; }
  let idx = y * params.width + x;
  let raw = grid[idx];
  let span = params.max - params.min;
  var t = 0.0;
  if (span > 0.0) {
    t = (raw - params.min) / span;
  }
  let c = colormap(t);
  let o = idx * 4u;
  colors[o + 0u] = c.x;
  colors[o + 1u] = c.y;
  colors[o + 2u] = c.z;
  colors[o + 3u] = 1.0;
}
`;
}

/** Byte size of a heatmap RGBA output buffer holding `pixels` pixels. */
export function heatmapColorsBytes(pixels: number): number {
  return Math.max(0, Math.floor(pixels)) * 4 * 4;
}

/**
 * Pack the heatmap uniform params into a 16-byte ArrayBuffer (width/height as
 * real u32s via DataView, matching the kernel's u32 fields).
 */
export function packHeatmapParams(
  width: number,
  height: number,
  min: number,
  max: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setUint32(0, width >>> 0, true);
  dv.setUint32(4, height >>> 0, true);
  dv.setFloat32(8, min, true);
  dv.setFloat32(12, max, true);
  return buf;
}

/** Colormap stops shared by the CPU fallback (kept in sync with the WGSL). */
export const HEATMAP_STOPS: [number, number, number][] = [
  [0.13, 0.23, 0.74],
  [0.18, 0.64, 0.86],
  [0.17, 0.94, 0.67],
  [0.98, 0.86, 0.26],
  [0.93, 0.28, 0.13],
];

/** Sample the colormap at normalized t ∈ [0, 1] → [r, g, b]. */
export function heatmapColor(t: number): [number, number, number] {
  const x = Math.min(Math.max(t, 0), 1) * (HEATMAP_STOPS.length - 1);
  const i = Math.min(Math.floor(x), HEATMAP_STOPS.length - 1);
  const f = x - i;
  const c0 = HEATMAP_STOPS[i]!;
  const c1 = HEATMAP_STOPS[Math.min(i + 1, HEATMAP_STOPS.length - 1)]!;
  return [
    c0[0] + (c1[0] - c0[0]) * f,
    c0[1] + (c1[1] - c0[1]) * f,
    c0[2] + (c1[2] - c0[2]) * f,
  ];
}

/**
 * CPU-equivalent of the heatmap kernel: maps a width×height f32 grid to an
 * RGBA Float32Array (row-major, 4 floats per pixel).
 */
export function heatmapCPU(
  grid: Float32Array,
  width: number,
  height: number,
  min?: number,
  max?: number,
): Float32Array {
  const pixels = width * height;
  const out = new Float32Array(pixels * 4);
  if (grid.length < pixels) return out;
  let lo = min;
  let hi = max;
  if (lo === undefined || hi === undefined) {
    lo = Infinity;
    hi = -Infinity;
    for (let i = 0; i < pixels; i += 1) {
      const v = grid[i]!;
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (lo === Infinity) return out;
  }
  const span = hi - lo;
  for (let i = 0; i < pixels; i += 1) {
    const raw = grid[i]!;
    const t = span > 0 ? (raw - lo) / span : 0;
    const c = heatmapColor(t);
    const o = i * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = 1;
  }
  return out;
}

// ==========================================================================
// Point-cloud kernel (3-D points → 2-D screen-space, GPU-accelerated).
//
// Projects an interleaved [x,y,z] point cloud onto a 2-D viewport with a
// uniform scale + offset transform (y flipped so +y points up), one thread
// per point. Points outside the viewport are flagged invisible so the host
// can skip them when rasterising (clipping). The kernel never touches other
// threads, so no synchronization is needed.
//
// Bind group:
//   @binding(0) read-only-storage   — points  : f32[count*3] (xyz interleaved)
//   @binding(1) uniform             — struct { width: u32, height: u32,
//                                            count: u32, scale: f32,
//                                            ox: f32, oy: f32,
//                                            size: f32, _pad: f32 } (32 bytes)
//   @binding(2) storage, read_write — output  : f32[count*4] (sx, sy, size, vis)
//
// Workgroups: dispatch with ceil(count / 64); the guard drops overhanging
// threads when count is not a multiple of 64.
// ==========================================================================

export const POINTCLOUD_POINTS_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const POINTCLOUD_OUTPUT_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const POINTCLOUD_PARAMS_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

export interface PointCloudKernelOptions {
  /** Workgroup size (threads per workgroup). Defaults to 64. */
  workgroupSize?: number;
}

export function pointCloudKernelWGSL(opts: PointCloudKernelOptions = {}): string {
  const workgroupSize = opts.workgroupSize ?? 64;
  return `struct Params {
  width: u32,
  height: u32,
  count: u32,
  scale: f32,
  ox: f32,
  oy: f32,
  size: f32,
  _pad: f32,
};

@group(0) @binding(0) var<storage, read> points: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  let i3 = i * 3u;
  let x = points[i3 + 0u];
  let y = points[i3 + 1u];
  // Project to screen space with +y pointing up (matches the JS plugin).
  let sx = params.ox + x * params.scale;
  let sy = params.oy - y * params.scale;
  var vis = 1.0;
  if (sx < 0.0 || sx >= f32(params.width) || sy < 0.0 || sy >= f32(params.height)) {
    vis = 0.0;
  }
  let o = i * 4u;
  output[o + 0u] = sx;
  output[o + 1u] = sy;
  output[o + 2u] = params.size;
  output[o + 3u] = vis;
}
`;
}

/** Byte size of a point-cloud output buffer holding `count` projected points. */
export function pointCloudOutputBytes(count: number): number {
  return Math.max(0, Math.floor(count)) * 4 * 4;
}

/**
 * Pack the point-cloud uniform params into a 32-byte ArrayBuffer (width /
 * height / count as real u32s via DataView, matching the kernel's u32 fields).
 */
export function packPointCloudParams(
  width: number,
  height: number,
  count: number,
  scale: number,
  ox: number,
  oy: number,
  size: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  const dv = new DataView(buf);
  dv.setUint32(0, width >>> 0, true);
  dv.setUint32(4, height >>> 0, true);
  dv.setUint32(8, count >>> 0, true);
  dv.setFloat32(12, scale, true);
  dv.setFloat32(16, ox, true);
  dv.setFloat32(20, oy, true);
  dv.setFloat32(24, size, true);
  dv.setFloat32(28, 0, true);
  return buf;
}

/**
 * CPU-equivalent of the point-cloud kernel: projects an interleaved [x,y,z]
 * array to [sx, sy, size, visible] quads (row-major, 4 floats per point).
 */
export function pointCloudCPU(
  points: Float32Array,
  width: number,
  height: number,
  scale: number,
  ox: number,
  oy: number,
  size: number,
): Float32Array {
  const count = Math.floor(points.length / 3);
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const x = points[i3]!;
    const y = points[i3 + 1]!;
    const sx = ox + x * scale;
    const sy = oy - y * scale;
    const visible = sx < 0 || sx >= width || sy < 0 || sy >= height ? 0 : 1;
    const o = i * 4;
    out[o] = sx;
    out[o + 1] = sy;
    out[o + 2] = size;
    out[o + 3] = visible;
  }
  return out;
}

// ==========================================================================
// Fluid kernel (lattice Boltzmann, D2Q9 — 2-D channel flow).
//
// Two kernels per timestep, ping-ponging a single field buffer:
//   1. collide — BGK relaxation toward the local equilibrium at each cell.
//   2. stream  — pull scheme: each cell gathers its 9 populations from the
//                upstream neighbours, with bounce-back at solid cells and
//                walls, an equilibrium inflow at x=0 and a zero-gradient
//                outflow at x=W-1.
//
// Field layout: interleaved f32 populations, cell-major:
//   field[cell * 9 + d]  for cell = y * width + x, d in [0, 8].
//
// Direction convention (rest, E, N, W, S, NE, NW, SW, SE):
//   d :  0  1  2  3  4  5  6  7  8
//   ex:  0  1  0 -1  0  1 -1 -1  1
//   ey:  0  0  1  0 -1  1  1 -1 -1
//   opp: 0  3  4  1  2  7  8  5  6
// ==========================================================================

export const FLUID_DIRECTIONS = 9;

export const FLUID_WEIGHTS: readonly number[] = [
  4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36,
];

export const FLUID_EX: readonly number[] = [0, 1, 0, -1, 0, 1, -1, -1, 1];
export const FLUID_EY: readonly number[] = [0, 0, 1, 0, -1, 1, 1, -1, -1];
export const FLUID_OPP: readonly number[] = [0, 3, 4, 1, 2, 7, 8, 5, 6];

export const FLUID_FIELD_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const FLUID_FLAGS_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const FLUID_PARAMS_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

/** Byte size of a population field holding `cells` lattice cells. */
export function fluidFieldBytes(cells: number): number {
  return Math.max(0, Math.floor(cells)) * FLUID_DIRECTIONS * 4;
}

/** Byte size of a solid-flag buffer holding `cells` lattice cells (f32 0/1). */
export function fluidFlagsBytes(cells: number): number {
  return Math.max(0, Math.floor(cells)) * 4;
}

/** Byte size of the observe (curl) output buffer for `cells` cells. */
export function fluidCurlBytes(cells: number): number {
  return Math.max(0, Math.floor(cells)) * 4;
}

/**
 * Pack the fluid uniform params into a 16-byte ArrayBuffer (width/height as
 * real u32s via DataView, matching the kernel's u32 fields).
 */
export function packFluidParams(
  width: number,
  height: number,
  omega: number,
  u0: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setUint32(0, width >>> 0, true);
  dv.setUint32(4, height >>> 0, true);
  dv.setFloat32(8, omega, true);
  dv.setFloat32(12, u0, true);
  return buf;
}

export interface FluidKernelOptions {
  /** Workgroup edge (threads per workgroup axis). Defaults to 8 (2-D tiles). */
  workgroupSize?: number;
}

/** Shared WGSL helper functions for the D2Q9 direction tables. */
function fluidDirectionHelpers(): string {
  return `
fn weight(d: u32) -> f32 {
  if (d == 0u) { return 0.44444444444; }
  if (d <= 4u) { return 0.11111111111; }
  return 0.02777777778;
}

fn exv(d: u32) -> i32 {
  if (d == 1u || d == 5u || d == 8u) { return 1; }
  if (d == 3u || d == 6u || d == 7u) { return -1; }
  return 0;
}

fn eyv(d: u32) -> i32 {
  if (d == 2u || d == 5u || d == 6u) { return 1; }
  if (d == 4u || d == 7u || d == 8u) { return -1; }
  return 0;
}

fn opp(d: u32) -> u32 {
  if (d == 1u) { return 3u; }
  if (d == 2u) { return 4u; }
  if (d == 3u) { return 1u; }
  if (d == 4u) { return 2u; }
  if (d == 5u) { return 7u; }
  if (d == 6u) { return 8u; }
  if (d == 7u) { return 5u; }
  if (d == 8u) { return 6u; }
  return 0u;
}
`;
}

/**
 * Kernel 1 of 2 per step: BGK collision. Reads the population field, writes
 * the post-collision field (zeros at solid cells). Bind group:
 *   @binding(0) read-only-storage  — fin    : f32[width*height*9]
 *   @binding(1) storage, read_write — fout  : f32[width*height*9]
 *   @binding(2) read-only-storage  — flags  : f32[width*height]  (1 = solid)
 *   @binding(3) uniform            — { width: u32, height: u32,
 *                                      omega: f32, u0: f32 }
 * Dispatch with (width/8, height/8) workgroups.
 */
export function fluidCollideKernelWGSL(opts: FluidKernelOptions = {}): string {
  const ws = opts.workgroupSize ?? 8;
  return `struct Params {
  width: u32,
  height: u32,
  omega: f32,
  u0: f32,
};

@group(0) @binding(0) var<storage, read> fin: array<f32>;
@group(0) @binding(1) var<storage, read_write> fout: array<f32>;
@group(0) @binding(2) var<storage, read> flags: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;
${fluidDirectionHelpers()}
@compute @workgroup_size(${ws}, ${ws})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.width || y >= params.height) { return; }
  let cell = y * params.width + x;
  let base = cell * 9u;
  if (flags[cell] > 0.5) {
    for (var d: u32 = 0u; d < 9u; d = d + 1u) {
      fout[base + d] = 0.0;
    }
    return;
  }

  var rho = 0.0;
  var ux = 0.0;
  var uy = 0.0;
  for (var d: u32 = 0u; d < 9u; d = d + 1u) {
    let f = fin[base + d];
    rho = rho + f;
    ux = ux + f * f32(exv(d));
    uy = uy + f * f32(eyv(d));
  }
  ux = ux / rho;
  uy = uy / rho;
  let u2 = ux * ux + uy * uy;
  for (var d: u32 = 0u; d < 9u; d = d + 1u) {
    let eu = f32(exv(d)) * ux + f32(eyv(d)) * uy;
    let feq = weight(d) * rho * (1.0 + 3.0 * eu + 4.5 * eu * eu - 1.5 * u2);
    fout[base + d] = fin[base + d] + params.omega * (feq - fin[base + d]);
  }
}
`;
}

/**
 * Kernel 2 of 2 per step: pull-scheme streaming with bounce-back obstacles,
 * equilibrium inflow (x=0) and zero-gradient outflow (x=W-1). Bind group:
 *   @binding(0) read-only-storage   — fin (= post-collision field)
 *   @binding(1) storage, read_write — fout
 *   @binding(2) read-only-storage  — flags
 *   @binding(3) uniform            — same Params struct as the collide kernel
 */
export function fluidStreamKernelWGSL(opts: FluidKernelOptions = {}): string {
  const ws = opts.workgroupSize ?? 8;
  return `struct Params {
  width: u32,
  height: u32,
  omega: f32,
  u0: f32,
};

@group(0) @binding(0) var<storage, read> fin: array<f32>;
@group(0) @binding(1) var<storage, read_write> fout: array<f32>;
@group(0) @binding(2) var<storage, read> flags: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;
${fluidDirectionHelpers()}
@compute @workgroup_size(${ws}, ${ws})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.width || y >= params.height) { return; }
  let cell = y * params.width + x;
  let base = cell * 9u;
  if (flags[cell] > 0.5) {
    for (var d: u32 = 0u; d < 9u; d = d + 1u) {
      fout[base + d] = 0.0;
    }
    return;
  }

  for (var d: u32 = 0u; d < 9u; d = d + 1u) {
    let sx = i32(x) - exv(d);
    let sy = i32(y) - eyv(d);
    var val: f32;
    if (sx < 0) {
      // Inflow: equilibrium population at (rho=1, u=(u0, 0)).
      let eu = params.u0 * f32(exv(d));
      val = weight(d) * (1.0 + 3.0 * eu + 4.5 * eu * eu - 1.5 * params.u0 * params.u0);
    } else if (sx >= i32(params.width)) {
      // Outflow: zero-gradient — copy the same slot from the left neighbour.
      val = fin[(cell - 1u) * 9u + d];
    } else if (sy < 0 || sy >= i32(params.height)) {
      // Channel wall: bounce-back.
      val = fin[base + opp(d)];
    } else {
      let scell = u32(sy) * params.width + u32(sx);
      if (flags[scell] > 0.5) {
        val = fin[base + opp(d)];
      } else {
        val = fin[scell * 9u + d];
      }
    }
    fout[base + d] = val;
  }
}
`;
}

/**
 * Observation kernel: derives the vorticity (curl of the macroscopic
 * velocity) at each cell from the population field, for visualization.
 * Bind group:
 *   @binding(0) read-only-storage   — field : f32[width*height*9]
 *   @binding(1) storage, read_write — curl  : f32[width*height]
 *   @binding(2) uniform            — same Params struct
 */
export function fluidCurlKernelWGSL(opts: FluidKernelOptions = {}): string {
  const ws = opts.workgroupSize ?? 8;
  return `struct Params {
  width: u32,
  height: u32,
  omega: f32,
  u0: f32,
};

@group(0) @binding(0) var<storage, read> field: array<f32>;
@group(0) @binding(1) var<storage, read_write> curl: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;
${fluidDirectionHelpers()}

fn macro(cell: u32) -> vec3<f32> {
  var rho = 0.0;
  var ux = 0.0;
  var uy = 0.0;
  let base = cell * 9u;
  for (var d: u32 = 0u; d < 9u; d = d + 1u) {
    let f = field[base + d];
    rho = rho + f;
    ux = ux + f * f32(exv(d));
    uy = uy + f * f32(eyv(d));
  }
  return vec3<f32>(rho, ux / rho, uy / rho);
}

@compute @workgroup_size(${ws}, ${ws})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.width || y >= params.height) { return; }
  let cell = y * params.width + x;
  if (x < 1u || x >= params.width - 1u || y < 1u || y >= params.height - 1u) {
    curl[cell] = 0.0;
    return;
  }
  let r = macro(cell + 1u);
  let l = macro(cell - 1u);
  let up = macro(cell + params.width);
  let dn = macro(cell - params.width);
  curl[cell] = (r.z - l.z) * 0.5 - (up.y - dn.y) * 0.5;
}
`;
}

/**
 * CPU-equivalent of the fluid pair: one BGK collision pass followed by one
 * pull-streaming pass, mirroring the WGSL math exactly.
 *
 * `f` holds the current populations, `fpost` is caller-provided scratch of
 * the same length. Both are Float32Array(W * H * 9); `flags` is
 * Float32Array(W * H) with 1 = solid.
 */
export function fluidStepCPU(
  f: Float32Array,
  fpost: Float32Array,
  flags: Float32Array,
  width: number,
  height: number,
  omega: number,
  u0: number,
): void {
  // ---- collide (f → fpost) ----
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      const base = cell * FLUID_DIRECTIONS;
      if (flags[cell]! > 0.5) {
        for (let d = 0; d < FLUID_DIRECTIONS; d += 1) fpost[base + d] = 0;
        continue;
      }
      let rho = 0;
      let ux = 0;
      let uy = 0;
      for (let d = 0; d < FLUID_DIRECTIONS; d += 1) {
        const fv = f[base + d]!;
        rho += fv;
        ux += fv * FLUID_EX[d]!;
        uy += fv * FLUID_EY[d]!;
      }
      ux /= rho;
      uy /= rho;
      const u2 = ux * ux + uy * uy;
      for (let d = 0; d < FLUID_DIRECTIONS; d += 1) {
        const fv = f[base + d]!;
        const eu = FLUID_EX[d]! * ux + FLUID_EY[d]! * uy;
        const feq = FLUID_WEIGHTS[d]! * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u2);
        fpost[base + d] = fv + omega * (feq - fv);
      }
    }
  }

  // ---- stream (fpost → f, pull scheme) ----
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      const base = cell * FLUID_DIRECTIONS;
      if (flags[cell]! > 0.5) {
        for (let d = 0; d < FLUID_DIRECTIONS; d += 1) f[base + d] = 0;
        continue;
      }
      for (let d = 0; d < FLUID_DIRECTIONS; d += 1) {
        const sx = x - FLUID_EX[d]!;
        const sy = y - FLUID_EY[d]!;
        let val: number;
        if (sx < 0) {
          const eu = u0 * FLUID_EX[d]!;
          val = FLUID_WEIGHTS[d]! * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u0 * u0);
        } else if (sx >= width) {
          val = fpost[(cell - 1) * FLUID_DIRECTIONS + d]!;
        } else if (sy < 0 || sy >= height) {
          val = fpost[base + FLUID_OPP[d]!]!;
        } else {
          const scell = sy * width + sx;
          if (flags[scell]! > 0.5) {
            val = fpost[base + FLUID_OPP[d]!]!;
          } else {
            val = fpost[scell * FLUID_DIRECTIONS + d]!;
          }
        }
        f[base + d] = val;
      }
    }
  }
}

/** Macroscopic fields (rho, ux, uy) derived from a population field. */
export function fluidMacroCPU(
  f: Float32Array,
  width: number,
  height: number,
): { rho: Float32Array; ux: Float32Array; uy: Float32Array } {
  const cells = width * height;
  const rho = new Float32Array(cells);
  const ux = new Float32Array(cells);
  const uy = new Float32Array(cells);
  for (let cell = 0; cell < cells; cell += 1) {
    const base = cell * FLUID_DIRECTIONS;
    let r = 0;
    let vx = 0;
    let vy = 0;
    for (let d = 0; d < FLUID_DIRECTIONS; d += 1) {
      const fv = f[base + d]!;
      r += fv;
      vx += fv * FLUID_EX[d]!;
      vy += fv * FLUID_EY[d]!;
    }
    rho[cell] = r;
    ux[cell] = vx / (r || 1);
    uy[cell] = vy / (r || 1);
  }
  return { rho, ux, uy };
}

/** Vorticity (curl of the macroscopic velocity), central differences. */
export function fluidCurlCPU(
  ux: Float32Array,
  uy: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const cells = width * height;
  const out = new Float32Array(cells);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cell = y * width + x;
      out[cell] =
        (uy[cell + 1]! - uy[cell - 1]!) * 0.5 - (ux[cell + width]! - ux[cell - width]!) * 0.5;
    }
  }
  return out;
}

/** Equilibrium populations for (rho, ux, uy) — used to seed the lattice. */
export function fluidEquilibrium(rho: number, ux: number, uy: number): Float32Array {
  const out = new Float32Array(FLUID_DIRECTIONS);
  const u2 = ux * ux + uy * uy;
  for (let d = 0; d < FLUID_DIRECTIONS; d += 1) {
    const eu = FLUID_EX[d]! * ux + FLUID_EY[d]! * uy;
    out[d] = FLUID_WEIGHTS[d]! * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u2);
  }
  return out;
}

// ==========================================================================
// Wave kernel (2-D linear wave equation, finite differences).
//
// Solves u_tt = c² ∇²u with a velocity field v = ∂u/∂t (leapfrog):
//   v' = (v + k ∇²u) · damping;   u' = u + v'
// with k = c² Δt² / Δx². Stability requires k ≤ 0.5 in 2-D.
//
// A separate `drive` buffer encodes per-cell boundary conditions:
//   drive < 0  → barrier (u pinned to 0, reflecting)
//   drive > 0  → continuous source, amplitude `drive`, sinusoidal in time
//   drive == 0 → free cell
//
// Ping-pong: u and v each need input + output buffers (4 storage buffers).
//
// Bind group:
//   @binding(0) read-only-storage   — uIn   : f32[width*height]
//   @binding(1) read-only-storage   — vIn   : f32[width*height]
//   @binding(2) storage, read_write — uOut  : f32[width*height]
//   @binding(3) storage, read_write — vOut  : f32[width*height]
//   @binding(4) read-only-storage   — drive : f32[width*height]
//   @binding(5) uniform            — { width: u32, height: u32, k: f32,
//                                      damping: f32, time: f32,
//                                      _mode: u32 }  (24 bytes)
// ==========================================================================

export const WAVE_FIELD_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const WAVE_DRIVE_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;

export const WAVE_PARAMS_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

/** Byte size of a wave scalar field holding `cells` cells. */
export function waveFieldBytes(cells: number): number {
  return Math.max(0, Math.floor(cells)) * 4;
}

/**
 * Pack the wave uniform params into a 24-byte ArrayBuffer (width/height as
 * real u32s via DataView, matching the kernel's u32 fields).
 */
export function packWaveParams(
  width: number,
  height: number,
  k: number,
  damping: number,
  time: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(24);
  const dv = new DataView(buf);
  dv.setUint32(0, width >>> 0, true);
  dv.setUint32(4, height >>> 0, true);
  dv.setFloat32(8, k, true);
  dv.setFloat32(12, damping, true);
  dv.setFloat32(16, time, true);
  dv.setUint32(20, 0, true); // _mode reserved
  return buf;
}

export interface WaveKernelOptions {
  /** Workgroup edge (threads per workgroup axis). Defaults to 8 (2-D tiles). */
  workgroupSize?: number;
}

export function waveKernelWGSL(opts: WaveKernelOptions = {}): string {
  const ws = opts.workgroupSize ?? 8;
  return `struct Params {
  width: u32,
  height: u32,
  k: f32,
  damping: f32,
  time: f32,
  _mode: u32,
};

@group(0) @binding(0) var<storage, read> uIn: array<f32>;
@group(0) @binding(1) var<storage, read> vIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> uOut: array<f32>;
@group(0) @binding(3) var<storage, read_write> vOut: array<f32>;
@group(0) @binding(4) var<storage, read> drive: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

@compute @workgroup_size(${ws}, ${ws})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.width || y >= params.height) { return; }
  let cell = y * params.width + x;
  if (drive[cell] < 0.0) {
    // Barrier: pinned zero — perfectly reflecting.
    uOut[cell] = 0.0;
    vOut[cell] = 0.0;
    return;
  }

  // Clamped (reflective) neighbours at the domain edges.
  let xl = select(x, x - 1u, x > 0u);
  let xr = select(x, x + 1u, x < params.width - 1u);
  let yd = select(y, y - 1u, y > 0u);
  let yu = select(y, y + 1u, y < params.height - 1u);
  let lap = uIn[y * params.width + xr] + uIn[y * params.width + xl]
          + uIn[yu * params.width + x] + uIn[yd * params.width + x]
          - 4.0 * uIn[cell];

  var nv = (vIn[cell] + params.k * lap) * params.damping;
  var nu = uIn[cell] + nv;
  if (drive[cell] > 0.0) {
    // Continuous sinusoidal source.
    nu = drive[cell] * sin(params.time);
    nv = 0.0;
  }
  uOut[cell] = nu;
  vOut[cell] = nv;
}
`;
}

/**
 * CPU-equivalent of the wave kernel: one leapfrog step over `u`/`v` in place
 * via caller-provided scratch buffers `unew`/`vnew` (all Float32Array(W*H)).
 * Mirrors the WGSL math exactly, including clamped Neumann edges.
 */
export function waveStepCPU(
  u: Float32Array,
  v: Float32Array,
  unew: Float32Array,
  vnew: Float32Array,
  drive: Float32Array,
  width: number,
  height: number,
  k: number,
  damping: number,
  time: number,
): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      const dr = drive[cell]!;
      if (dr < 0) {
        unew[cell] = 0;
        vnew[cell] = 0;
        continue;
      }
      const xr = x < width - 1 ? x + 1 : x;
      const xl = x > 0 ? x - 1 : x;
      const yu = y < height - 1 ? y + 1 : y;
      const yd = y > 0 ? y - 1 : y;
      const lap =
        u[y * width + xr]! + u[y * width + xl]! + u[yu * width + x]! + u[yd * width + x]! - 4 * u[cell]!;
      let nv = (v[cell]! + k * lap) * damping;
      let nu = u[cell]! + nv;
      if (dr > 0) {
        nu = dr * Math.sin(time);
        nv = 0;
      }
      unew[cell] = nu;
      vnew[cell] = nv;
    }
  }
  u.set(unew);
  v.set(vnew);
}