// ==========================================================================
// Minimal WCSPH fluid solver for the lake3d teaching plugin.
//
// Purpose-built for a closed lake basin (ellipsoidal bowl + rim wall) with a
// temperature field: each particle carries a temperature that is advected
// with the flow, diffuses weakly between neighbours and feeds back through
// thermal buoyancy  a = g·β·(T − T_ref)  (warm water rises, cold water
// sinks). Seeding T from the theoretical lake profile therefore makes the
// particle assembly form and hold a thermocline — the teaching point of the
// plugin — while wind shear on the surface band drives epilimnion currents.
//
// Method (Müller et al. 2003, weakly compressible):
//   - Poly6 density kernel, Spiky pressure gradient, XSPH artificial
//     viscosity (velocity smoothing).
//   - Uniform spatial hash grid with cell edge = support radius h; two
//     neighbour passes per substep (density + scalars, then forces).
//   - Semi-implicit Euler with a clamped dt:  dt ≤ min(0.4h/v_max,
//     0.4·√(h/a_max), frame budget) — a CFL guard against both advection
//     and stiff pressure spikes.
//   - Analytic boundary SDF: ellipsoid bowl (y ≤ 0) plus a cylindrical rim
//     wall above the waterline. Penetrating particles are projected back
//     onto the wall and their normal velocity reflected (restitution 0.2).
//   - Hydrostatic pre-relaxation: ~20 position-only passes (velocity frozen
//     after each) walk the seeded lattice into pressure/gravity balance, so
//     the fluid starts near rest instead of free-falling into the bowl.
//
// All state lives in preallocated Float32Arrays; the solver allocates once
// per (re)build and never per frame. Pure TS + typed arrays — no DOM, no
// three.js — so the numerics stay unit-testable.
// ==========================================================================

/** Solver configuration (world/render units; y = 0 is the waterline). */
export interface LakeSphConfig {
  /** Requested particle count (a jittered lattice seeds at least this many). */
  count: number;
  /** Waterline radius R of the ellipsoidal bowl. */
  radius: number;
  /** Basin depth D (waterline y = 0 → bottom y = −D). */
  depth: number;
  /** Rim wall height above the waterline (wind may pile water slightly). */
  rim: number;
}

/** Environment passed to every step. */
export interface LakeSphEnv {
  /** Wind speed (m/s) driving surface shear along +x. */
  wind: number;
  /** Nutrient load 0–1, tracked as a passive scalar. */
  nutrients: number;
}

const RESTITUTION = 0.2;
const XSPH_EPSILON = 0.3;
const T_DIFFUSIVITY = 0.35; // 1/s — weak neighbour temperature relaxation
const NUTRIENT_RELAX = 2.0; // 1/s — relaxation toward the depth profile
const BUOY_BETA = 0.0075; // amplified thermal expansion, 1/K (teaching scale)
const BUOYANCY_CAP = 0.35; // |buoyancy| ≤ cap·g
const WIND_COEFF = 0.004; // surface shear acceleration = coeff·wind²·g
const SURFACE_BAND = 0.15; // wind acts on the top fraction of the depth
const STIFFNESS = 1000; // p = STIFFNESS·ρ₀·(ρ/ρ₀ − 1) ≈ 9% compression
const ACCEL_CAP = 120; // |a| ≤ cap·g (explosion guard)
const CFL_V = 0.4; // dt ≤ CFL_V·h/v_max
const CFL_A = 0.4; // dt ≤ CFL_A·√(h/a_max)
const RELAX_ITERS = 20; // hydrostatic pre-relaxation passes at (re)seed

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class LakeSph {
  readonly count: number;
  readonly radius: number;
  readonly depth: number;
  readonly rim: number;
  /** Support radius h ≈ 1.7× lattice spacing. */
  readonly h: number;
  /** Effective gravity (world units/s²) normalised so g·D is constant —
   * dynamics look self-similar across lake depths. */
  readonly gEff: number;
  /** xyz interleaved particle positions. */
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  /** Advected temperature (°C). */
  readonly temp: Float32Array;
  /** Passive nutrient scalar (0–1, surface-high). */
  readonly nutrient: Float32Array;

  private readonly rho: Float32Array;
  private readonly prs: Float32Array;
  private readonly tNum: Float32Array;
  private readonly wSum: Float32Array;
  private readonly vCap: number;

  // uniform spatial hash grid (cell edge = h)
  private readonly gnx: number;
  private readonly gny: number;
  private readonly gnz: number;
  private readonly cells: number;
  private readonly cellCount: Int32Array;
  private readonly cellStart: Int32Array;
  private readonly cursor: Int32Array;
  private readonly cellIdx: Int32Array;
  private readonly entries: Int32Array;

  private readonly poly6C: number;
  private readonly spikyC: number;
  private readonly h2: number;
  private readonly margin: number;
  private rho0 = 1;
  private kStiff = 1;
  private tRef = 10;
  private vMax = 0.2;
  private aMax = 0;
  private spacing: number;

  constructor(cfg: LakeSphConfig) {
    this.count = Math.max(400, Math.round(cfg.count));
    this.radius = cfg.radius;
    this.depth = Math.max(1, cfg.depth);
    this.rim = cfg.rim;
    const vol =
      (2 / 3) * Math.PI * this.radius ** 2 * this.depth +
      Math.PI * this.radius ** 2 * this.rim * 0.5;
    const s = Math.cbrt(vol / this.count);
    this.spacing = s;
    this.h = 1.7 * s;
    this.margin = 0.35 * this.h;
    this.h2 = this.h * this.h;
    this.poly6C = 315 / (64 * Math.PI * this.h ** 9);
    this.spikyC = 45 / (Math.PI * this.h ** 6);
    this.gEff = 89 / this.depth;
    this.vCap = 0.6 * Math.sqrt(this.gEff * this.depth);

    const n = this.count;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.temp = new Float32Array(n);
    this.nutrient = new Float32Array(n);
    this.rho = new Float32Array(n);
    this.prs = new Float32Array(n);
    this.tNum = new Float32Array(n);
    this.wSum = new Float32Array(n);
    const pad = this.h;
    const nx = Math.max(1, Math.ceil((2 * (this.radius + pad)) / this.h));
    const ny = Math.max(1, Math.ceil((this.depth + this.rim + 2 * pad) / this.h));
    this.gnx = nx;
    this.gny = ny;
    this.gnz = nx;
    this.cells = nx * ny * nx;
    this.cellCount = new Int32Array(this.cells);
    this.cellStart = new Int32Array(this.cells + 1);
    this.cursor = new Int32Array(this.cells);
    this.cellIdx = new Int32Array(n);
    this.entries = new Int32Array(n);

    this.seed();
    this.buildGrid();
    this.computeDensity();
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += this.rho[i]!;
    this.rho0 = Math.max(1e-6, sum / n);
    this.kStiff = STIFFNESS * this.rho0;
    this.relax(); // settle into hydrostatic balance before the first frame
    this.buildGrid();
    this.computeDensity();
    sum = 0;
    for (let i = 0; i < n; i += 1) sum += this.rho[i]!;
    this.rho0 = Math.max(1e-6, sum / n);
    this.kStiff = STIFFNESS * this.rho0;
    this.aMax = this.gEff;
  }

  /** Re-seed positions on the jittered lattice and zero the velocities. */
  reset(): void {
    this.seed();
    this.relax();
    this.vMax = 0.2;
    this.aMax = this.gEff;
  }

  /**
   * Hydrostatic pre-relaxation: position-only passes with the velocity frozen
   * after each. Gravity + clamped pressure walk the lattice into balance (the
   * free surface drops to its rest height) so the first frames do not start
   * with an explosion. Thermal buoyancy is pinned to zero (T = T_ref) during
   * relaxation; `seedField` re-seeds the real temperatures afterwards.
   */
  private relax(): void {
    this.temp.fill(this.tRef);
    for (let it = 0; it < RELAX_ITERS; it += 1) {
      this.buildGrid();
      this.computeDensity();
      const dtCflA = CFL_A * Math.sqrt(this.h / Math.max(this.aMax, 0.25 * this.gEff));
      const dt = Math.min(0.02, dtCflA);
      this.integrate(dt, { wind: 0, nutrients: 0 });
      this.vel.fill(0);
      this.vMax = 0.2;
    }
  }

  /**
   * Seed the temperature / nutrient scalars. `tempAt(frac)` samples the
   * teaching profile (frac = 0 at the surface, 1 at the bottom); a small
   * noise breaks perfect symmetry so convection can start.
   */
  seedField(opts: {
    tempAt: (frac: number) => number;
    surfaceTemp: number;
    bottomTemp: number;
    nutrients: number;
  }): void {
    this.tRef = 0.5 * (opts.surfaceTemp + opts.bottomTemp);
    for (let i = 0; i < this.count; i += 1) {
      const frac = Math.min(1, Math.max(0, -this.pos[i * 3 + 1]! / this.depth));
      this.temp[i] = Math.min(40, Math.max(0, opts.tempAt(frac) + (Math.random() - 0.5) * 0.5));
      this.nutrient[i] = Math.min(
        1,
        opts.nutrients * Math.exp(-3.2 * frac) * (0.9 + Math.random() * 0.2),
      );
    }
  }

  /** One solver substep. Returns the dt actually used (CFL-clamped). */
  step(dtIn: number, env: LakeSphEnv): number {
    const dtCflV = (CFL_V * this.h) / Math.max(this.vMax, 1e-3);
    const dtCflA = CFL_A * Math.sqrt(this.h / Math.max(this.aMax, 0.25 * this.gEff));
    const dt = Math.min(dtIn, dtCflV, dtCflA);
    this.buildGrid();
    this.computeDensity();
    this.integrate(dt, env);
    return dt;
  }

  // ---- seeding -------------------------------------------------------------

  private lattice(step: number): number[] {
    const R = this.radius;
    const D = this.depth;
    const m = this.margin;
    const out: number[] = [];
    for (let y = -D + m + step * 0.5; y <= this.rim - m; y += step) {
      const rMax = y < 0 ? R * Math.sqrt(Math.max(0.0004, 1 - (y * y) / (D * D))) - m : R - m;
      if (rMax <= step * 0.25) continue;
      const nSide = Math.max(1, Math.round((2 * rMax) / step));
      for (let ix = 0; ix < nSide; ix += 1) {
        const x = -rMax + ((ix + 0.5) * 2 * rMax) / nSide;
        for (let iz = 0; iz < nSide; iz += 1) {
          out.push(x, y, -rMax + ((iz + 0.5) * 2 * rMax) / nSide);
        }
      }
    }
    return out;
  }

  private seed(): void {
    let s = this.spacing;
    let flat: number[] = this.lattice(s * 0.95);
    for (let iter = 0; iter < 7 && flat.length < this.count * 3; iter += 1) {
      s *= 0.9;
      flat = this.lattice(s * 0.95);
    }
    this.spacing = s;
    const total = flat.length / 3;
    const jitter = 0.22 * s;
    for (let i = 0; i < this.count; i += 1) {
      const src = total > 0 ? Math.min(total - 1, Math.floor((i * total) / this.count)) : 0;
      const k = src * 3;
      this.pos[i * 3] = (flat[k] ?? 0) + (Math.random() - 0.5) * jitter;
      this.pos[i * 3 + 1] = (flat[k + 1] ?? 0) + (Math.random() - 0.5) * jitter;
      this.pos[i * 3 + 2] = (flat[k + 2] ?? 0) + (Math.random() - 0.5) * jitter;
      this.vel[i * 3] = 0;
      this.vel[i * 3 + 1] = 0;
      this.vel[i * 3 + 2] = 0;
    }
  }

  // ---- spatial hash grid ---------------------------------------------------

  private cellAt(x: number, y: number, z: number): number {
    const h = this.h;
    const cx = clampInt(Math.floor((x + this.radius + h) / h), 0, this.gnx - 1);
    const cy = clampInt(Math.floor((y + this.depth + h) / h), 0, this.gny - 1);
    const cz = clampInt(Math.floor((z + this.radius + h) / h), 0, this.gnz - 1);
    return (cz * this.gny + cy) * this.gnx + cx;
  }

  private buildGrid(): void {
    const { pos, count } = this;
    this.cellCount.fill(0);
    for (let i = 0; i < count; i += 1) {
      const ci = this.cellAt(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
      this.cellIdx[i] = ci;
      this.cellCount[ci] = (this.cellCount[ci] ?? 0) + 1;
    }
    let acc = 0;
    for (let c = 0; c < this.cells; c += 1) {
      this.cellStart[c] = acc;
      acc += this.cellCount[c]!;
    }
    this.cellStart[this.cells] = acc;
    this.cursor.set(this.cellStart.subarray(0, this.cells));
    for (let i = 0; i < count; i += 1) {
      const ci = this.cellIdx[i]!;
      this.entries[this.cursor[ci] ?? 0] = i;
      this.cursor[ci] = (this.cursor[ci] ?? 0) + 1;
    }
  }

  // ---- pass 1: density + scalar diffusion sums -----------------------------

  private computeDensity(): void {
    const { pos, temp, h, h2, poly6C, count } = this;
    const w0 = poly6C * h2 * h2 * h2;
    for (let i = 0; i < count; i += 1) {
      const p3 = i * 3;
      const px = pos[p3]!;
      const py = pos[p3 + 1]!;
      const pz = pos[p3 + 2]!;
      const ti = temp[i]!;
      const cx0 = clampInt(Math.floor((px + this.radius + h) / h) - 1, 0, this.gnx - 1);
      const cx1 = clampInt(Math.floor((px + this.radius + h) / h) + 1, 0, this.gnx - 1);
      const cy0 = clampInt(Math.floor((py + this.depth + h) / h) - 1, 0, this.gny - 1);
      const cy1 = clampInt(Math.floor((py + this.depth + h) / h) + 1, 0, this.gny - 1);
      const cz0 = clampInt(Math.floor((pz + this.radius + h) / h) - 1, 0, this.gnz - 1);
      const cz1 = clampInt(Math.floor((pz + this.radius + h) / h) + 1, 0, this.gnz - 1);
      let rho = w0;
      let tAcc = 0;
      let wAcc = 0;
      for (let cz = cz0; cz <= cz1; cz += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) {
          const rowBase = (cz * this.gny + cy) * this.gnx;
          for (let cx = cx0; cx <= cx1; cx += 1) {
            const cell = rowBase + cx;
            const end = this.cellStart[cell + 1]!;
            for (let k = this.cellStart[cell]!; k < end; k += 1) {
              const j = this.entries[k]!;
              if (j === i) continue;
              const q3 = j * 3;
              const dx = px - pos[q3]!;
              const dy = py - pos[q3 + 1]!;
              const dz = pz - pos[q3 + 2]!;
              const r2 = dx * dx + dy * dy + dz * dz;
              if (r2 >= h2) continue;
              const t2 = h2 - r2;
              const w = poly6C * t2 * t2 * t2;
              rho += w;
              wAcc += w;
              tAcc += (temp[j]! - ti) * w;
            }
          }
        }
      }
      this.rho[i] = rho;
      this.tNum[i] = tAcc;
      this.wSum[i] = wAcc;
    }
  }

  // ---- pass 2: forces + XSPH + scalars + integration + boundary ------------

  private integrate(dt: number, env: LakeSphEnv): void {
    const { pos, vel, h, h2, poly6C, spikyC, rho, prs, rho0, kStiff, gEff, count } = this;
    for (let i = 0; i < count; i += 1) {
      prs[i] = kStiff * Math.max(rho[i]! / rho0 - 1, -0.02);
    }
    const windA = WIND_COEFF * env.wind * env.wind * gEff;
    const surfY = -SURFACE_BAND * this.depth;
    const aCap2 = ACCEL_CAP * gEff * (ACCEL_CAP * gEff);
    const invRho0 = XSPH_EPSILON / rho0;
    const buoyCap = BUOYANCY_CAP * gEff;
    let vMax2 = 0;
    let aMax2 = 0;
    for (let i = 0; i < count; i += 1) {
      const p3 = i * 3;
      const px = pos[p3]!;
      const py = pos[p3 + 1]!;
      const pz = pos[p3 + 2]!;
      const rhoI = rho[i]!;
      const pTermI = prs[i]! / (rhoI * rhoI);
      let fx = 0;
      let fy = 0;
      let fz = 0;
      let xsx = 0;
      let xsy = 0;
      let xsz = 0;
      const cx0 = clampInt(Math.floor((px + this.radius + h) / h) - 1, 0, this.gnx - 1);
      const cx1 = clampInt(Math.floor((px + this.radius + h) / h) + 1, 0, this.gnx - 1);
      const cy0 = clampInt(Math.floor((py + this.depth + h) / h) - 1, 0, this.gny - 1);
      const cy1 = clampInt(Math.floor((py + this.depth + h) / h) + 1, 0, this.gny - 1);
      const cz0 = clampInt(Math.floor((pz + this.radius + h) / h) - 1, 0, this.gnz - 1);
      const cz1 = clampInt(Math.floor((pz + this.radius + h) / h) + 1, 0, this.gnz - 1);
      for (let cz = cz0; cz <= cz1; cz += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) {
          const rowBase = (cz * this.gny + cy) * this.gnx;
          for (let cx = cx0; cx <= cx1; cx += 1) {
            const cell = rowBase + cx;
            const end = this.cellStart[cell + 1]!;
            for (let k = this.cellStart[cell]!; k < end; k += 1) {
              const j = this.entries[k]!;
              if (j === i) continue;
              const q3 = j * 3;
              const dx = px - pos[q3]!;
              const dy = py - pos[q3 + 1]!;
              const dz = pz - pos[q3 + 2]!;
              const r2 = dx * dx + dy * dy + dz * dz;
              if (r2 >= h2) continue;
              const r = Math.sqrt(r2);
              // Spiky pressure gradient (magnitude·unit-dir = spikyC·(h−r)²·d̂)
              const grad = (spikyC * (h - r) * (h - r)) / r;
              const pT = pTermI + prs[j]! / (rho[j]! * rho[j]!);
              fx += grad * dx * pT;
              fy += grad * dy * pT;
              fz += grad * dz * pT;
              // XSPH velocity smoothing weights (Poly6)
              const t2 = h2 - r2;
              const w = poly6C * t2 * t2 * t2;
              xsx += (vel[q3]! - vel[p3]!) * w;
              xsy += (vel[q3 + 1]! - vel[p3 + 1]!) * w;
              xsz += (vel[q3 + 2]! - vel[p3 + 2]!) * w;
            }
          }
        }
      }
      // Body forces: gravity + thermal buoyancy + wind shear.
      let buoy = gEff * BUOY_BETA * (this.temp[i]! - this.tRef);
      buoy = Math.max(-buoyCap, Math.min(buoyCap, buoy));
      let ax = fx;
      let ay = fy - gEff + buoy;
      let az = fz;
      if (py > surfY) ax += windA;
      const a2 = ax * ax + ay * ay + az * az;
      if (a2 > aCap2) {
        const sc = Math.sqrt(aCap2 / a2);
        ax *= sc;
        ay *= sc;
        az *= sc;
      }
      if (a2 > aMax2) aMax2 = a2;
      // Semi-implicit Euler + XSPH viscosity.
      let vx = vel[p3]! + dt * ax + xsx * invRho0;
      let vy = vel[p3 + 1]! + dt * ay + xsy * invRho0;
      let vz = vel[p3 + 2]! + dt * az + xsz * invRho0;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > this.vCap * this.vCap) {
        const f = this.vCap / Math.sqrt(v2);
        vx *= f;
        vy *= f;
        vz *= f;
      }
      if (v2 > vMax2) vMax2 = v2;
      // Scalars: weak temperature diffusion + nutrient relaxation.
      const wS = this.wSum[i]!;
      if (wS > 1e-9) this.temp[i] = this.temp[i]! + T_DIFFUSIVITY * dt * (this.tNum[i]! / wS);
      const frac = Math.min(1, Math.max(0, -py / this.depth));
      const target = Math.min(1, env.nutrients * Math.exp(-3.2 * frac));
      this.nutrient[i] = this.nutrient[i]! + (target - this.nutrient[i]!) * Math.min(1, NUTRIENT_RELAX * dt);
      // Advect + confine.
      pos[p3] = px + vx * dt;
      pos[p3 + 1] = py + vy * dt;
      pos[p3 + 2] = pz + vz * dt;
      vel[p3] = vx;
      vel[p3 + 1] = vy;
      vel[p3 + 2] = vz;
      this.confine(p3);
    }
    this.vMax = Math.sqrt(vMax2);
    this.aMax = Math.sqrt(aMax2);
  }

  // ---- analytic boundary: ellipsoid bowl + rim wall -------------------------

  private confine(p3: number): void {
    const pos = this.pos;
    const vel = this.vel;
    const m = this.margin;
    const R = this.radius;
    const D = this.depth;
    const x = pos[p3]!;
    const y = pos[p3 + 1]!;
    const z = pos[p3 + 2]!;
    if (y > 0) {
      // Rim zone: vertical cylinder wall at R with a lid at the rim.
      let nx = x;
      let ny = y;
      let nz = z;
      let vx = vel[p3]!;
      let vy = vel[p3 + 1]!;
      let vz = vel[p3 + 2]!;
      const rr = Math.hypot(x, z);
      const rMax = R - m;
      if (rr > rMax && rr > 1e-9) {
        const ux = x / rr;
        const uz = z / rr;
        nx = ux * rMax;
        nz = uz * rMax;
        const vn = vx * ux + vz * uz;
        if (vn > 0) {
          vx -= (1 + RESTITUTION) * vn * ux;
          vz -= (1 + RESTITUTION) * vn * uz;
        }
      }
      const yMax = this.rim - m;
      if (ny > yMax) {
        ny = yMax;
        if (vy > 0) vy = -vy * RESTITUTION;
      }
      pos[p3] = nx;
      pos[p3 + 1] = ny;
      pos[p3 + 2] = nz;
      vel[p3] = vx;
      vel[p3 + 1] = vy;
      vel[p3 + 2] = vz;
      return;
    }
    // Ellipsoidal bowl: f = √(x²/R² + y²/D² + z²/R²) ≤ 1 with margin m.
    const ex = x / R;
    const ey = y / D;
    const ez = z / R;
    const f = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (f < 1e-6) return;
    const gnorm = Math.sqrt((ex * ex) / (R * R) + (ey * ey) / (D * D) + (ez * ez) / (R * R)) / f;
    const dist = (f - 1) / gnorm; // ≈ world-space signed distance to the wall
    if (dist <= -m) return;
    const inv = 1 / (f * gnorm);
    const nxW = (x / (R * R)) * inv; // outward unit normal ∇f/|∇f|
    const nyW = (y / (D * D)) * inv;
    const nzW = (z / (R * R)) * inv;
    const push = dist + m;
    pos[p3] = x - nxW * push;
    pos[p3 + 1] = y - nyW * push;
    pos[p3 + 2] = z - nzW * push;
    const vn = vel[p3]! * nxW + vel[p3 + 1]! * nyW + vel[p3 + 2]! * nzW;
    if (vn > 0) {
      const b = (1 + RESTITUTION) * vn;
      vel[p3] = vel[p3]! - b * nxW;
      vel[p3 + 1] = vel[p3 + 1]! - b * nyW;
      vel[p3 + 2] = vel[p3 + 2]! - b * nzW;
    }
  }
}

// ---- depth-binned statistics (T(z) profile from the particles) --------------

export interface ProfileBins {
  /** Bin-centre depth (metres), 0 = surface. */
  depth: Float64Array;
  /** Mean temperature per bin (NaN where empty). */
  temp: Float64Array;
  /** Particle count per bin. */
  count: Uint32Array;
}

/** Bin particle temperatures by depth fraction for the T(z) panel. */
export function profileBins(
  pos: Float32Array,
  temps: Float32Array,
  worldDepth: number,
  depthM: number,
  nBins: number,
): ProfileBins {
  const depth = new Float64Array(nBins);
  const tSum = new Float64Array(nBins);
  const count = new Uint32Array(nBins);
  for (let b = 0; b < nBins; b += 1) depth[b] = ((b + 0.5) / nBins) * depthM;
  const n = Math.min(Math.floor(pos.length / 3), temps.length);
  for (let i = 0; i < n; i += 1) {
    const y = pos[i * 3 + 1]!;
    if (!Number.isFinite(y)) continue;
    const frac = Math.min(0.999999, Math.max(0, -y / Math.max(worldDepth, 1e-6)));
    const b = Math.floor(frac * nBins);
    count[b] = (count[b] ?? 0) + 1;
    tSum[b] = (tSum[b] ?? 0) + (temps[i] ?? 0);
  }
  const temp = new Float64Array(nBins);
  for (let b = 0; b < nBins; b += 1) {
    temp[b] = (count[b] ?? 0) > 0 ? (tSum[b] ?? 0) / (count[b] ?? 1) : NaN;
  }
  return { depth, temp, count };
}
