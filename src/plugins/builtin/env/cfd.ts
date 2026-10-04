// ==========================================================================
// cfd.ts — 3-D incompressible fluid solver for the plume3d plugin
//
// Jos Stam, "Stable Fluids" (SIGGRAPH 1999), the standard real-time scheme:
//   1. semi-Lagrangian advection (velocity and scalars back-trace along the
//      current velocity field and sample trilinearly — unconditionally stable)
//   2. pressure projection by Gauss-Seidel relaxation of ∇²p = ∇·u*, then
//      u ← u* − ∇p, making the velocity field divergence-free
//   3. source terms: continuous inflow at the stack-top cell (upward exit
//      momentum + smoke density + heat) and thermal buoyancy (w += κ·T·dt)
//   4. ambient wind is added analytically as a uniform +x drift so it never
//      accumulates numerical error and survives the projection unchanged
//
// Everything is plain Float32Array math on a unit-cell grid (dx = dy = dz = 1):
// velocities are in cells/step, so the solver has no physical units — the
// plugin maps its m/s wind and stack height onto grid quantities. Stability
// is enforced by clamping dt to the CFL bound (max speed × dt ≤ 1 cell),
// damping the velocity field slightly each step, and a NaN sentinel that the
// plugin turns into a one-shot field reset instead of a dead render.
// ==========================================================================

/** Grid presets keyed by the plugin's `dim` select value. */
export const RESOLUTION_PRESETS = {
  '32': { nx: 32, ny: 32, nz: 24 },
  '48': { nx: 48, ny: 32, nz: 24 },
  '64': { nx: 64, ny: 40, nz: 28 },
} as const;

export type CfdQuality = keyof typeof RESOLUTION_PRESETS;

/** Gauss-Seidel sweeps per projection (teaching default, 12–20 range). */
export const PRESSURE_ITERATIONS = 14;

/** Max advection per step (CFL): max speed × dt ≤ 1 cell → dt ≤ CFL/max. */
const CFL = 0.9;
const DT_MAX = 1.0;
/** Per-step velocity damping (numerical safety valve, not physics). */
const VEL_DAMP = 0.985;
/** Hard velocity ceiling, cells/step (keeps the back-trace local). */
const VEL_CLAMP = 3.0;
/** Smoke/heat ceiling per cell (keeps the isosurface scale sane). */
const SCALAR_CLAMP = 4.0;

/** Where and what to inject during one solver step. */
export interface CfdSourceSpec {
  /** Stack-top cell (downwind i, crosswind j, vertical k). */
  i: number;
  j: number;
  k: number;
  /** Uniform ambient wind in +x, cells/step. */
  wind: number;
  /** Smoke density added per step at the source. */
  densIn: number;
  /** Heat (buoyancy tracer) added per step at the source. */
  heatIn: number;
  /** Upward exit momentum at the source, cells/step. */
  exitV: number;
  /** Buoyancy coefficient: w += buoyancy · heat · dt. */
  buoyancy: number;
}

/**
 * Stable-fluids solver over an nx×ny×nz grid, index (k·ny + j)·nx + i with
 * x = downwind, y = crosswind, z = vertical. One `step()` = source terms +
 * buoyancy + velocity advection + projection + boundary conditions +
 * scalar advection, all at a CFL-clamped dt.
 */
export class FluidSolver {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;

  /** Velocity perturbation around the ambient wind, cells/step. */
  readonly u: Float32Array;
  readonly v: Float32Array;
  readonly w: Float32Array;
  /** Smoke concentration (arbitrary teaching units, 0..SCALAR_CLAMP). */
  readonly dens: Float32Array;
  /** Heat tracer driving the buoyancy, same units. */
  readonly heat: Float32Array;

  private readonly u0: Float32Array;
  private readonly v0: Float32Array;
  private readonly w0: Float32Array;
  private readonly dens0: Float32Array;
  private readonly heat0: Float32Array;
  private readonly p: Float32Array;
  private readonly div: Float32Array;

  /** Peak smoke density over the grid (updated each step). */
  densMax = 0;
  /** Set when a non-finite value appeared — the caller must reset(). */
  hadNaN = false;
  steps = 0;

  constructor(nx: number, ny: number, nz: number) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    const n = nx * ny * nz;
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.w = new Float32Array(n);
    this.dens = new Float32Array(n);
    this.heat = new Float32Array(n);
    this.u0 = new Float32Array(n);
    this.v0 = new Float32Array(n);
    this.w0 = new Float32Array(n);
    this.dens0 = new Float32Array(n);
    this.heat0 = new Float32Array(n);
    this.p = new Float32Array(n);
    this.div = new Float32Array(n);
  }

  get cells(): number {
    return this.nx * this.ny * this.nz;
  }

  /** Zero every field (also clears the NaN sentinel and step counter). */
  reset(): void {
    this.u.fill(0);
    this.v.fill(0);
    this.w.fill(0);
    this.dens.fill(0);
    this.heat.fill(0);
    this.densMax = 0;
    this.hadNaN = false;
    this.steps = 0;
  }

  /**
   * Scan the velocity field for the CFL bound: max(|components|) + |wind|
   * (a conservative bound on |u + wind|). Flags `hadNaN` on the first
   * non-finite entry.
   */
  private cflScan(wind: number): number {
    const { u, v, w } = this;
    let max = 0;
    for (let i = 0; i < u.length; i += 1) {
      const a = u[i]!;
      const b = v[i]!;
      const c = w[i]!;
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
        this.hadNaN = true;
        return Math.abs(wind);
      }
      const m = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
      if (m > max) max = m;
    }
    return max + Math.abs(wind);
  }

  /** Continuous inflow at the stack-top cell: a small weighted 3³ blob. */
  private addSources(src: CfdSourceSpec): void {
    const { nx, ny, dens, heat, w } = this;
    const wt = [0.35, 1, 0.35]; // weight per axis offset (centre heaviest)
    for (let dk = -1; dk <= 1; dk += 1) {
      const k = src.k + dk;
      if (k < 1 || k >= this.nz - 1) continue;
      for (let dj = -1; dj <= 1; dj += 1) {
        const j = src.j + dj;
        if (j < 1 || j >= ny - 1) continue;
        for (let di = -1; di <= 1; di += 1) {
          const i = src.i + di;
          if (i < 1 || i >= nx - 1) continue;
          const amp = wt[di + 1]! * wt[dj + 1]! * wt[dk + 1]!;
          const idx = (k * ny + j) * nx + i;
          dens[idx] = Math.min(SCALAR_CLAMP, dens[idx]! + src.densIn * amp);
          heat[idx] = Math.min(SCALAR_CLAMP, heat[idx]! + src.heatIn * amp);
          const up = src.exitV * amp;
          if (up > w[idx]!) w[idx] = up;
        }
      }
    }
  }

  /** Thermal buoyancy: w += buoyancy · heat · dt over the interior. */
  private addBuoyancy(src: CfdSourceSpec, dt: number): void {
    const { nx, ny, nz, w, heat } = this;
    for (let k = 1; k < nz - 1; k += 1) {
      for (let j = 1; j < ny - 1; j += 1) {
        const row = (k * ny + j) * nx;
        for (let i = 1; i < nx - 1; i += 1) {
          const idx = row + i;
          const h = heat[idx]!;
          if (h > 0) w[idx] = w[idx]! + src.buoyancy * h * dt;
        }
      }
    }
  }

  /** Semi-Lagrangian advection of `src` into `dst` (dst ≠ src). */
  private advect(
    dst: Float32Array,
    src: Float32Array,
    velU: Float32Array,
    velV: Float32Array,
    velW: Float32Array,
    wind: number,
    dt: number,
    dissipation: number,
  ): void {
    const { nx, ny, nz } = this;
    const sy = nx;
    const sz = nx * ny;
    const xLo = 0.5;
    const xHi = nx - 1.5;
    const yLo = 0.5;
    const yHi = ny - 1.5;
    const zLo = 0.5;
    const zHi = nz - 1.5;
    for (let k = 1; k < nz - 1; k += 1) {
      for (let j = 1; j < ny - 1; j += 1) {
        const row = (k * ny + j) * nx;
        for (let i = 1; i < nx - 1; i += 1) {
          const idx = row + i;
          let x = i - dt * (velU[idx]! + wind);
          let y = j - dt * velV[idx]!;
          let z = k - dt * velW[idx]!;
          if (x < xLo) x = xLo;
          else if (x > xHi) x = xHi;
          if (y < yLo) y = yLo;
          else if (y > yHi) y = yHi;
          if (z < zLo) z = zLo;
          else if (z > zHi) z = zHi;
          const i0 = x | 0;
          const j0 = y | 0;
          const k0 = z | 0;
          const fx = x - i0;
          const fy = y - j0;
          const fz = z - k0;
          const b000 = k0 * sz + j0 * sy + i0;
          const c000 = src[b000]!;
          const c100 = src[b000 + 1]!;
          const c010 = src[b000 + sy]!;
          const c110 = src[b000 + sy + 1]!;
          const c001 = src[b000 + sz]!;
          const c101 = src[b000 + sz + 1]!;
          const c011 = src[b000 + sz + sy]!;
          const c111 = src[b000 + sz + sy + 1]!;
          const val =
            (c000 + (c100 - c000) * fx) * (1 - fy) * (1 - fz) +
            (c010 + (c110 - c010) * fx) * fy * (1 - fz) +
            (c001 + (c101 - c001) * fx) * (1 - fy) * fz +
            (c011 + (c111 - c011) * fx) * fy * fz;
          dst[idx] = val * dissipation;
        }
      }
    }
  }

  /** Gauss-Seidel pressure projection → divergence-free interior velocity. */
  private project(): void {
    const { nx, ny, nz, u, v, w, p, div } = this;
    const sy = nx;
    const sz = nx * ny;
    for (let k = 1; k < nz - 1; k += 1) {
      for (let j = 1; j < ny - 1; j += 1) {
        const row = (k * ny + j) * nx;
        for (let i = 1; i < nx - 1; i += 1) {
          const idx = row + i;
          div[idx] =
            -0.5 *
            (u[idx + 1]! - u[idx - 1]! + v[idx + sy]! - v[idx - sy]! + w[idx + sz]! - w[idx - sz]!);
        }
      }
    }
    p.fill(0);
    for (let it = 0; it < PRESSURE_ITERATIONS; it += 1) {
      for (let k = 1; k < nz - 1; k += 1) {
        for (let j = 1; j < ny - 1; j += 1) {
          const row = (k * ny + j) * nx;
          for (let i = 1; i < nx - 1; i += 1) {
            const idx = row + i;
            p[idx] =
              (div[idx]! +
                p[idx - 1]! + p[idx + 1]! +
                p[idx - sy]! + p[idx + sy]! +
                p[idx - sz]! + p[idx + sz]!) / 6;
          }
        }
      }
    }
    for (let k = 1; k < nz - 1; k += 1) {
      for (let j = 1; j < ny - 1; j += 1) {
        const row = (k * ny + j) * nx;
        for (let i = 1; i < nx - 1; i += 1) {
          const idx = row + i;
          u[idx] = u[idx]! - 0.5 * (p[idx + 1]! - p[idx - 1]!);
          v[idx] = v[idx]! - 0.5 * (p[idx + sy]! - p[idx - sy]!);
          w[idx] = w[idx]! - 0.5 * (p[idx + sz]! - p[idx - sz]!);
        }
      }
    }
  }

  /**
   * Boundary conditions: zero-gradient outflow at +x, zero perturbation at
   * the x=0 inflow face (the ambient wind is analytic), free-slip side
   * walls, no-penetration ground, open top. Scalar walls are zeroed
   * (smoke/heat leaving the domain disappears).
   */
  private applyBoundary(): void {
    const { nx, ny, nz, u, v, w } = this;
    const sz = nx * ny;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        const row = (k * ny + j) * nx;
        u[row] = 0; // x = 0 inflow: ambient wind only
        v[row] = v[row + 1]!;
        w[row] = w[row + 1]!;
        const o = row + nx - 1; // x = nx-1 outflow: zero gradient
        u[o] = u[o - 1]!;
        v[o] = v[o - 1]!;
        w[o] = w[o - 1]!;
      }
    }
    for (let k = 0; k < nz; k += 1) {
      for (let i = 0; i < nx; i += 1) {
        const a = k * sz + i; // y = 0 wall (free slip)
        const b = k * sz + (ny - 1) * nx + i;
        u[a] = u[a + nx]!;
        w[a] = w[a + nx]!;
        v[a] = 0;
        u[b] = u[b - nx]!;
        w[b] = w[b - nx]!;
        v[b] = 0;
      }
    }
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const a = j * nx + i; // ground: no penetration
        const b = (nz - 1) * sz + j * nx + i; // open top
        u[a] = u[a + sz]!;
        v[a] = v[a + sz]!;
        w[a] = 0;
        u[b] = u[b - sz]!;
        v[b] = v[b - sz]!;
        w[b] = Math.max(w[b - sz]!, 0);
      }
    }
  }

  /** Damp + clamp velocities; NaN sentinel over the velocity field. */
  private stabilise(): void {
    const { u, v, w } = this;
    let nan = false;
    for (let i = 0; i < u.length; i += 1) {
      let a = u[i]!;
      let b = v[i]!;
      let c = w[i]!;
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
        nan = true;
        a = 0;
        b = 0;
        c = 0;
      }
      a *= VEL_DAMP;
      b *= VEL_DAMP;
      c *= VEL_DAMP;
      u[i] = a > VEL_CLAMP ? VEL_CLAMP : a < -VEL_CLAMP ? -VEL_CLAMP : a;
      v[i] = b > VEL_CLAMP ? VEL_CLAMP : b < -VEL_CLAMP ? -VEL_CLAMP : b;
      w[i] = c > VEL_CLAMP ? VEL_CLAMP : c < -VEL_CLAMP ? -VEL_CLAMP : c;
    }
    this.hadNaN = nan;
  }

  /** Zero the scalar boundary planes (smoke/heat leave the domain). */
  private zeroScalarBoundaries(): void {
    const { nx, ny, nz, dens, heat } = this;
    const sz = nx * ny;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        const row = (k * ny + j) * nx;
        dens[row] = 0;
        heat[row] = 0;
        dens[row + nx - 1] = 0;
        heat[row + nx - 1] = 0;
      }
    }
    for (let k = 0; k < nz; k += 1) {
      for (let i = 0; i < nx; i += 1) {
        dens[k * sz + i] = 0;
        heat[k * sz + i] = 0;
        dens[k * sz + (ny - 1) * nx + i] = 0;
        heat[k * sz + (ny - 1) * nx + i] = 0;
      }
    }
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        dens[j * nx + i] = 0;
        heat[j * nx + i] = 0;
        dens[(nz - 1) * sz + j * nx + i] = 0;
        heat[(nz - 1) * sz + j * nx + i] = 0;
      }
    }
  }

  /** Track the smoke peak (drives the isosurface threshold) + NaN sentinel. */
  private scanScalars(): void {
    const { dens, heat } = this;
    let densMax = 0;
    let nan = false;
    for (let i = 0; i < dens.length; i += 1) {
      const d = dens[i]!;
      if (!Number.isFinite(d)) {
        nan = true;
        dens[i] = 0;
      } else if (d > densMax) densMax = d;
      if (!Number.isFinite(heat[i]!)) {
        nan = true;
        heat[i] = 0;
      }
    }
    this.densMax = densMax;
    this.hadNaN = nan;
  }

  /** Advance one CFL-clamped step. Sets `hadNaN` instead of throwing. */
  step(src: CfdSourceSpec): void {
    this.hadNaN = false;
    const vmax = this.cflScan(src.wind);
    if (this.hadNaN) return; // caller resets
    const dt = Math.min(DT_MAX, CFL / Math.max(vmax, CFL));
    this.steps += 1;

    this.addSources(src);
    this.addBuoyancy(src, dt);

    // Velocity self-advection on the snapshot (u0/v0/w0 hold the pre-step field).
    this.u0.set(this.u);
    this.v0.set(this.v);
    this.w0.set(this.w);
    this.advect(this.u, this.u0, this.u0, this.v0, this.w0, src.wind, dt, 1);
    this.advect(this.v, this.v0, this.u0, this.v0, this.w0, src.wind, dt, 1);
    this.advect(this.w, this.w0, this.u0, this.v0, this.w0, src.wind, dt, 1);
    this.project();
    this.applyBoundary();
    this.stabilise();
    if (this.hadNaN) return;

    // Scalars ride the post-projection (divergence-free) field.
    this.dens0.set(this.dens);
    this.heat0.set(this.heat);
    this.advect(this.dens, this.dens0, this.u, this.v, this.w, src.wind, dt, 0.9985);
    this.advect(this.heat, this.heat0, this.u, this.v, this.w, src.wind, dt, 0.985);
    this.zeroScalarBoundaries();
    this.scanScalars();
  }
}
