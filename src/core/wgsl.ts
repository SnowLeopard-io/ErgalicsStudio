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

/** Uniform params buffer bytes: [dt, speed, count, _pad] as 4 × f32. */
export function packParticleParams(dt: number, speed: number, count: number): Float32Array {
  const out = new Float32Array(4);
  out[0] = dt;
  out[1] = speed;
  out[2] = count;
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