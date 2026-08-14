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
 * kernel, writable from JS (`COPY_DST`), and mappable back for reading the
 * result (`MAP_READ`).
 */
export const PARTICLES_BUFFER_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ;

export const PARTICLES_UNIFORM_USAGE = GPU_BUFFER_USAGE.UNIFORM;

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