// ==========================================================================
// fluid3d — D3Q19 lattice-Boltzmann kernel (pure, host-agnostic)
//
// A three-dimensional, low-Mach lattice-Boltzmann solver used by the 3-D
// fluid-flow plugin. The velocity set is the 19-velocity D3Q19 stencil; the
// update is one BGK collision pass followed by one pull-scheme streaming pass,
// mirroring the 2-D D2Q9 kernel in `src/core/wgsl.ts` but in three dimensions.
//
// Indexing: cell = (z * ny + y) * nx + x, flat population stride 19.
// Domain: x = streamwise (inflow at x = 0, zero-gradient outflow at x = nx-1),
// y = vertical, z = spanwise. Solid cells carry flags > 0.5 and hold zero
// populations; every solid link is closed with half-way bounce-back.
//
// The same math is available three ways: as plain WGSL kernels for the WebGPU
// path, as a CPU reference implementation, and as small pure helpers (macro
// fields, vorticity, wake-survey force integrals) that are unit-tested.
// ==========================================================================

import { GPU_BUFFER_USAGE } from '@/core/wgsl';

export const LBM3D_DIRECTIONS = 19;

// Direction convention (D3Q19):
//   d :  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18
//   ex:  0  1 -1  0  0  0  0  1 -1  1 -1  1 -1  1 -1  0  0  0  0
//   ey:  0  0  0  1 -1  0  0  1 -1 -1  1  0  0  0  0  1 -1  1 -1
//   ez:  0  0  0  0  0  1 -1  0  0  0  0  1 -1 -1  1  1 -1 -1  1
//   opp: 0  2  1  4  3  6  5  8  7 10  9 12 11 14 13 16 15 18 17
export const LBM3D_EX: readonly number[] = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
export const LBM3D_EY: readonly number[] = [0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1];
export const LBM3D_EZ: readonly number[] = [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1];
export const LBM3D_OPP: readonly number[] = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17];

/** Rest 1/3, six face neighbours 1/18, twelve edge neighbours 1/36. */
export const LBM3D_WEIGHTS: readonly number[] = [
  1 / 3,
  1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18,
  1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36,
  1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36,
];

/** Population + macroscopic + solid buffers for the WebGPU path. */
export const LBM3D_FIELD_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;
export const LBM3D_FLAGS_USAGE =
  GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.COPY_SRC;
export const LBM3D_PARAMS_USAGE = GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST;

/** Bytes for one population field of `cells` lattice cells (19 f32 each). */
export function lbm3dFieldBytes(cells: number): number {
  return Math.max(0, Math.floor(cells)) * LBM3D_DIRECTIONS * 4;
}

/** Bytes for one scalar-per-cell buffer (flags / vorticity / curl) of `cells`. */
export function lbm3dScalarBytes(cells: number): number {
  return Math.max(0, Math.floor(cells)) * 4;
}

/** Bytes for the macroscopic buffer (rho, ux, uy, uz — 4 f32 per cell). */
export function lbm3dMacroBytes(cells: number): number {
  return Math.max(0, Math.floor(cells)) * 4 * 4;
}

/**
 * Width (in cells) of the absorbing layer in front of the outflow boundary.
 *
 * A zero-gradient outflow still reflects part of an outgoing pressure wave,
 * and with a fixed-density inflow at the other end the box behaves as a
 * resonant cavity. Relaxing the last few percent of the streamwise extent
 * toward the free-stream equilibrium drains those waves instead.
 */
export function lbm3dSpongeWidth(nx: number): number {
  return Math.max(4, Math.floor(nx / 12));
}

export const LBM3D_SPONGE_STRENGTH = 0.3;

/**
 * Pack the 3-D lattice uniform block (32 bytes) for a kernel dispatch.
 * Layout: nx/ny/nz/sponge as u32 then omega/u0/spongeStrength/pad as f32.
 * `sponge` is an integer cell width (the WGSL `spongeStrength` helper compares
 * it against the u32 streamwise index, so it must be stored as u32).
 */
export function packLbm3dParams(
  nx: number,
  ny: number,
  nz: number,
  omega: number,
  u0: number,
  sponge: number,
  spongeStrength: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  const dv = new DataView(buf);
  dv.setUint32(0, nx >>> 0, true);
  dv.setUint32(4, ny >>> 0, true);
  dv.setUint32(8, nz >>> 0, true);
  dv.setUint32(12, sponge >>> 0, true);
  dv.setFloat32(16, omega, true);
  dv.setFloat32(20, u0, true);
  dv.setFloat32(24, spongeStrength, true);
  dv.setFloat32(28, 0, true);
  return buf;
}

/** Equilibrium populations for (rho, ux, uy, uz) — D3Q19. */
export function equilibrium3D(
  rho: number,
  ux: number,
  uy: number,
  uz: number,
  out?: Float32Array,
): Float32Array {
  const f = out && out.length === LBM3D_DIRECTIONS ? out : new Float32Array(LBM3D_DIRECTIONS);
  const u2 = ux * ux + uy * uy + uz * uz;
  for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) {
    const eu = LBM3D_EX[d]! * ux + LBM3D_EY[d]! * uy + LBM3D_EZ[d]! * uz;
    f[d] = LBM3D_WEIGHTS[d]! * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u2);
  }
  return f;
}

/**
 * One full step (BGK collision + pull-scheme streaming) on the CPU.
 *
 * `f` holds the current populations, `fpost` is caller scratch of the same
 * length (`nx*ny*nz*19`); `flags` is `Float32Array(nx*ny*nz)` with 1 = solid.
 * Matches the WGSL kernels term for term.
 */
export function stepCPU3D(
  f: Float32Array,
  fpost: Float32Array,
  flags: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  omega: number,
  u0: number,
): void {
  const cells = nx * ny * nz;
  const feq0 = equilibrium3D(1, u0, 0, 0);
  const spongeStart = nx - lbm3dSpongeWidth(nx);
  const spongeSpan = nx - spongeStart;
  const u0sq = u0 * u0;

  // ---- collide (f → fpost) ----
  for (let cell = 0; cell < cells; cell += 1) {
    const base = cell * LBM3D_DIRECTIONS;
    if (flags[cell]! > 0.5) {
      for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) fpost[base + d] = 0;
      continue;
    }
    let rho = 0;
    let ux = 0;
    let uy = 0;
    let uz = 0;
    for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) {
      const fv = f[base + d]!;
      rho += fv;
      ux += fv * LBM3D_EX[d]!;
      uy += fv * LBM3D_EY[d]!;
      uz += fv * LBM3D_EZ[d]!;
    }
    const inv = rho !== 0 ? 1 / rho : 0;
    ux *= inv;
    uy *= inv;
    uz *= inv;
    const u2 = ux * ux + uy * uy + uz * uz;
    const x = cell % nx;
    // Absorbing layer in front of the outflow boundary.
    let sp = 0;
    if (x >= spongeStart) {
      const t = (x - spongeStart + 1) / spongeSpan;
      sp = LBM3D_SPONGE_STRENGTH * t * t;
    }
    for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) {
      const fv = f[base + d]!;
      const eu = LBM3D_EX[d]! * ux + LBM3D_EY[d]! * uy + LBM3D_EZ[d]! * uz;
      const feq = LBM3D_WEIGHTS[d]! * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u2);
      const out = fv + omega * (feq - fv);
      fpost[base + d] = sp > 0 ? out + sp * (feq0[d]! - out) : out;
    }
  }

  // ---- stream (fpost → f, pull scheme) ----
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const cell = (z * ny + y) * nx + x;
        const base = cell * LBM3D_DIRECTIONS;
        if (flags[cell]! > 0.5) {
          for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) f[base + d] = 0;
          continue;
        }
        for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) {
          const sx = x - LBM3D_EX[d]!;
          const sy = y - LBM3D_EY[d]!;
          const sz = z - LBM3D_EZ[d]!;
          let val: number;
          if (sx < 0) {
            // Inflow: equilibrium population at (rho = 1, u = (u0, 0, 0)).
            val = LBM3D_WEIGHTS[d]! * (1 + 3 * u0 * LBM3D_EX[d]! + 4.5 * u0sq * LBM3D_EX[d]! * LBM3D_EX[d]! - 1.5 * u0sq);
          } else if (sx >= nx) {
            // Outflow: zero-gradient — copy the same slot from the left neighbour.
            val = fpost[(cell - 1) * LBM3D_DIRECTIONS + d]!;
          } else if (sy < 0 || sy >= ny || sz < 0 || sz >= nz) {
            // Channel wall: half-way bounce-back.
            val = fpost[base + LBM3D_OPP[d]!]!;
          } else {
            const scell = (sz * ny + sy) * nx + sx;
            if (flags[scell]! > 0.5) {
              val = fpost[base + LBM3D_OPP[d]!]!;
            } else {
              val = fpost[scell * LBM3D_DIRECTIONS + d]!;
            }
          }
          f[base + d] = val;
        }
      }
    }
  }
}

/** Macroscopic fields (rho, ux, uy, uz) derived from a population field. */
export function macroCPU3D(
  f: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  out?: { rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array },
): { rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array } {
  const cells = nx * ny * nz;
  const rho = out?.rho.length === cells ? out.rho : new Float32Array(cells);
  const ux = out?.ux.length === cells ? out.ux : new Float32Array(cells);
  const uy = out?.uy.length === cells ? out.uy : new Float32Array(cells);
  const uz = out?.uz.length === cells ? out.uz : new Float32Array(cells);
  for (let cell = 0; cell < cells; cell += 1) {
    const base = cell * LBM3D_DIRECTIONS;
    let r = 0;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) {
      const fv = f[base + d]!;
      r += fv;
      vx += fv * LBM3D_EX[d]!;
      vy += fv * LBM3D_EY[d]!;
      vz += fv * LBM3D_EZ[d]!;
    }
    rho[cell] = r;
    const inv = r !== 0 ? 1 / r : 0;
    ux[cell] = vx * inv;
    uy[cell] = vy * inv;
    uz[cell] = vz * inv;
  }
  return { rho, ux, uy, uz };
}

export interface WakeSurvey {
  /** Streamwise force on the body (lattice units), positive = downstream. */
  drag: number;
  /** Vertical force on the body (lattice units), positive = upward. */
  lift: number;
  /** Planform area of the survey plane, in lattice cells. */
  area: number;
}

/**
 * Control-volume momentum balance on a downstream plane (wake survey).
 *
 * Drag: ∫ [ρ u (U∞ − u) + (p∞ − p)] dy dz over the plane, using the lattice
 * equation of state p = ρ/3. Lift: the negative of the vertical momentum flux
 * ∫ ρ u v dy dz — a lifting wing deflects the wake downward, so the body feels
 * an equal upward reaction.
 *
 * The survey is deliberately a far-field balance rather than a surface
 * integral: on a voxelised, coarse wing the surface pressure integration is
 * far noisier than the plane sum.
 */
export function wakeSurvey3D(
  macro: { rho: Float32Array; ux: Float32Array; uy: Float32Array },
  nx: number,
  ny: number,
  nz: number,
  planeX: number,
  u0: number,
  flags?: Float32Array,
): WakeSurvey {
  const x = Math.max(0, Math.min(nx - 1, Math.round(planeX)));
  const pInf = 1 / 3;
  let drag = 0;
  let lift = 0;
  let area = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      const cell = (z * ny + y) * nx + x;
      if (flags && flags[cell]! > 0.5) continue;
      const r = macro.rho[cell]!;
      const u = macro.ux[cell]!;
      const v = macro.uy[cell]!;
      if (!Number.isFinite(r) || !Number.isFinite(u) || !Number.isFinite(v)) continue;
      const p = r / 3;
      drag += r * u * (u0 - u) + (pInf - p);
      lift += -r * u * v;
      area += 1;
    }
  }
  return { drag, lift, area };
}

// ---- WGSL kernels ---------------------------------------------------------

/** Emit an if-chain lookup table function for a 19-entry direction table. */
function wgslLookup(name: string, ret: 'i32' | 'u32' | 'f32', values: readonly number[]): string {
  const zero = ret === 'f32' ? '0.0' : '0';
  const lines = values.map((v, i) => `  if (d == ${i}u) { return ${ret === 'f32' ? v.toPrecision(9) : v}; }`);
  return `fn ${name}(d: u32) -> ${ret} {\n${lines.join('\n')}\n  return ${zero};\n}`;
}

function lbm3dDirectionHelpers(): string {
  return `
${wgslLookup('exv', 'i32', LBM3D_EX)}
${wgslLookup('eyv', 'i32', LBM3D_EY)}
${wgslLookup('ezv', 'i32', LBM3D_EZ)}
${wgslLookup('opp', 'u32', LBM3D_OPP)}

fn weight(d: u32) -> f32 {
  if (d == 0u) { return 0.3333333333; }
  if (d <= 6u) { return 0.0555555556; }
  return 0.0277777778;
}
`;
}

function lbm3dParamsStruct(): string {
  return `struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  sponge: u32,
  omega: f32,
  u0: f32,
  spongeStrength: f32,
  pad: f32,
};
`;
}

/**
 * Kernel 1 of 2: BGK collision (f → post-collision field). Bind group:
 *   @binding(0) read-only-storage   — fin
 *   @binding(1) storage, read_write — fout
 *   @binding(2) read-only-storage   — flags
 *   @binding(3) uniform             — Params
 * Dispatch (ceil(nx/8), ceil(ny/8), nz).
 */
export function lbm3dCollideKernelWGSL(): string {
  return `${lbm3dParamsStruct()}@group(0) @binding(0) var<storage, read> fin: array<f32>;
@group(0) @binding(1) var<storage, read_write> fout: array<f32>;
@group(0) @binding(2) var<storage, read> flags: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;
${lbm3dDirectionHelpers()}

fn spongeStrength(x: u32, nx: u32) -> f32 {
  let w = max(4u, params.sponge);
  if (x + w < nx) { return 0.0; }
  let d = f32(x + w + 1u - nx) / f32(w);
  return params.spongeStrength * d * d;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  if (x >= params.nx || y >= params.ny || z >= params.nz) { return; }
  let cell = (z * params.ny + y) * params.nx + x;
  let base = cell * 19u;
  if (flags[cell] > 0.5) {
    for (var d: u32 = 0u; d < 19u; d = d + 1u) { fout[base + d] = 0.0; }
    return;
  }

  var rho = 0.0;
  var ux = 0.0;
  var uy = 0.0;
  var uz = 0.0;
  for (var d: u32 = 0u; d < 19u; d = d + 1u) {
    let fv = fin[base + d];
    rho = rho + fv;
    ux = ux + fv * f32(exv(d));
    uy = uy + fv * f32(eyv(d));
    uz = uz + fv * f32(ezv(d));
  }
  ux = ux / rho;
  uy = uy / rho;
  uz = uz / rho;
  let u2 = ux * ux + uy * uy + uz * uz;
  let sp = spongeStrength(x, params.nx);
  for (var d: u32 = 0u; d < 19u; d = d + 1u) {
    let eu = f32(exv(d)) * ux + f32(eyv(d)) * uy + f32(ezv(d)) * uz;
    let feq = weight(d) * rho * (1.0 + 3.0 * eu + 4.5 * eu * eu - 1.5 * u2);
    let fv = fin[base + d];
    var out = fv + params.omega * (feq - fv);
    if (sp > 0.0) {
      let eu0 = params.u0 * f32(exv(d));
      let feq0 = weight(d) * (1.0 + 3.0 * eu0 + 4.5 * eu0 * eu0 - 1.5 * params.u0 * params.u0);
      out = out + sp * (feq0 - out);
    }
    fout[base + d] = out;
  }
}
`;
}

/**
 * Kernel 2 of 2: pull-scheme streaming with bounce-back on solid links,
 * equilibrium inflow (x = 0) and zero-gradient outflow (x = nx-1). Bind group
 * mirrors the collide kernel.
 */
export function lbm3dStreamKernelWGSL(): string {
  return `${lbm3dParamsStruct()}@group(0) @binding(0) var<storage, read> fin: array<f32>;
@group(0) @binding(1) var<storage, read_write> fout: array<f32>;
@group(0) @binding(2) var<storage, read> flags: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;
${lbm3dDirectionHelpers()}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  if (x >= params.nx || y >= params.ny || z >= params.nz) { return; }
  let cell = (z * params.ny + y) * params.nx + x;
  let base = cell * 19u;
  if (flags[cell] > 0.5) {
    for (var d: u32 = 0u; d < 19u; d = d + 1u) { fout[base + d] = 0.0; }
    return;
  }

  for (var d: u32 = 0u; d < 19u; d = d + 1u) {
    let sx = i32(x) - exv(d);
    let sy = i32(y) - eyv(d);
    let sz = i32(z) - ezv(d);
    var val: f32;
    if (sx < 0) {
      let u0sq = params.u0 * params.u0;
      let exf = f32(exv(d));
      val = weight(d) * (1.0 + 3.0 * params.u0 * exf + 4.5 * u0sq * exf * exf - 1.5 * u0sq);
    } else if (sx >= i32(params.nx)) {
      val = fin[(cell - 1u) * 19u + d];
    } else if (sy < 0 || sy >= i32(params.ny) || sz < 0 || sz >= i32(params.nz)) {
      val = fin[base + opp(d)];
    } else {
      let scell = (u32(sz) * params.ny + u32(sy)) * params.nx + u32(sx);
      if (flags[scell] > 0.5) {
        val = fin[base + opp(d)];
      } else {
        val = fin[scell * 19u + d];
      }
    }
    fout[base + d] = val;
  }
}
`;
}

/**
 * Observation kernel: writes (rho, ux, uy, uz) per cell into the macroscopic
 * buffer for visualisation and force metrics. Bind group:
 *   @binding(0) read-only-storage   — field
 *   @binding(1) storage, read_write — macro (4 f32 per cell)
 *   @binding(2) uniform             — Params
 */
export function lbm3dMacroKernelWGSL(): string {
  return `${lbm3dParamsStruct()}@group(0) @binding(0) var<storage, read> field: array<f32>;
@group(0) @binding(1) var<storage, read_write> macro: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;
${lbm3dDirectionHelpers()}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  if (x >= params.nx || y >= params.ny || z >= params.nz) { return; }
  let cell = (z * params.ny + y) * params.nx + x;
  let base = cell * 19u;
  var rho = 0.0;
  var ux = 0.0;
  var uy = 0.0;
  var uz = 0.0;
  for (var d: u32 = 0u; d < 19u; d = d + 1u) {
    let fv = field[base + d];
    rho = rho + fv;
    ux = ux + fv * f32(exv(d));
    uy = uy + fv * f32(eyv(d));
    uz = uz + fv * f32(ezv(d));
  }
  let inv = 1.0 / max(rho, 1e-12);
  macro[cell * 4u + 0u] = rho;
  macro[cell * 4u + 1u] = ux * inv;
  macro[cell * 4u + 2u] = uy * inv;
  macro[cell * 4u + 3u] = uz * inv;
}
`;
}
