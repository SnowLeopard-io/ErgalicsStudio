// ==========================================================================
// physics-trajectory — trajectory kinematics & energy kernel (pure TS)
//
// Takes discrete trajectory samples (t, x[, y]) — measured or synthetic —
// and provides:
//   - numerical differentiation on NON-UNIFORM time grids via 3-point
//     Lagrange stencils (exact for quadratics, hence exact for ideal
//     projectile motion), with one-sided 3-point formulas at the ends;
//   - optional Savitzky–Golay smoothing: local quadratic least squares over
//     a sliding (bounds-clamped) window, valid on non-uniform grids;
//   - mechanical-energy decomposition KE = ½m|v|², PE = m·g·(y − y₀);
//   - a linearized projectile least-squares fit with known g: x(t) = vx·t + x0
//     and y(t) + ½g·t² = vy·t + y0 (both linear in the unknowns), giving
//     v0 = √(vx²+vy²) and θ = atan2(vy, vx);
//   - a seeded synthetic-projectile generator (mulberry32 PRNG + Box–Muller
//     Gaussian, multiplicative noise) for reproducible validation.
//
// Embedded acceptance benchmarks (uniform relative-error convention
// |num − theory|/|theory|):
//   ① projectile recovery — 0.5 %-noise synthetic data (v0 = 20 m/s,
//      θ = 45°, seed 20251011) refitted to v0/θ within 1 %;
//   ② derivative accuracy — non-uniform-grid 3-point stencils on the exact
//      parabola reproduce vx/vy/ay below 1e-2 relative (machine-level);
//   ③ energy conservation — noiseless total mechanical energy drift
//      (max−min)/mean below 0.5 % (machine-level).
// ==========================================================================

export interface Trajectory {
  t: number[];
  x: number[];
  /** Vertical coordinate; null for 1-D (t, x) tracks. */
  y: number[] | null;
}

export interface Derivatives {
  vx: number[];
  vy: number[] | null;
  ax: number[];
  ay: number[] | null;
}

export interface EnergySeries {
  ke: number[];
  pe: number[] | null;
  total: number[] | null;
}

export interface ProjectileFit {
  x0: number;
  vx: number;
  y0: number | null;
  vy: number | null;
  v0: number | null;
  thetaDeg: number | null;
  /** RMS residual of the x(t) fit (same units as x). */
  rmsX: number;
  /** RMS residual of the y(t) fit (null without y data). */
  rmsY: number | null;
}

// ---- deterministic synthetic data -------------------------------------------------

/** mulberry32 PRNG — tiny, fast, deterministic; returns uniforms in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box–Muller (consumes exactly two uniforms). */
export function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface SynthOptions {
  v0: number;
  thetaDeg: number;
  g: number;
  /** Number of samples (≥ 3). */
  n: number;
  /** Multiplicative position noise (0 → noiseless), e.g. 0.005 for 0.5 %. */
  noise: number;
  /** PRNG seed (reproducibility). */
  seed: number;
}

/**
 * Synthetic projectile sampled uniformly over the full flight
 * T = 2·v0·sinθ/g with independent multiplicative Gaussian noise on x and y.
 */
export function synthesizeProjectile(o: SynthOptions): Trajectory {
  const n = Math.max(3, Math.round(o.n));
  const th = (o.thetaDeg * Math.PI) / 180;
  const vx = o.v0 * Math.cos(th);
  const vy = o.v0 * Math.sin(th);
  const T = (2 * vy) / o.g;
  const rng = mulberry32(o.seed);
  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = (T * i) / (n - 1);
    const ex = o.noise * gaussian(rng);
    const ey = o.noise * gaussian(rng);
    t.push(ti);
    x.push(vx * ti * (1 + ex));
    y.push((vy * ti - 0.5 * o.g * ti * ti) * (1 + ey));
  }
  return { t, x, y };
}

// ---- Savitzky–Golay smoothing (local quadratic least squares) ----------------------

/**
 * Local quadratic Savitzky–Golay smoothing on a (possibly non-uniform) grid:
 * at every index the window is clamped to the data bounds and a parabola
 * a + b·(t−tᵢ) + c·(t−tᵢ)² is fitted by least squares; the smoothed value is
 * the fitted intercept a. window < 5 leaves the data unchanged.
 */
export function sgSmooth(values: number[], t: number[], window: number): number[] {
  const n = values.length;
  if (window < 5) return values.slice();
  const half = Math.floor(window / 2);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    if (hi - lo + 1 < 3) {
      out.push(values[i]!);
      continue;
    }
    // Normal equations of the local quadratic fit in u = t − tᵢ.
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let s4 = 0;
    let r0 = 0;
    let r1 = 0;
    let r2 = 0;
    for (let j = lo; j <= hi; j++) {
      const u = t[j]! - t[i]!;
      const u2 = u * u;
      const w = values[j]!;
      s0 += 1;
      s1 += u;
      s2 += u2;
      s3 += u2 * u;
      s4 += u2 * u2;
      r0 += w;
      r1 += w * u;
      r2 += w * u2;
    }
    // Cramer's rule for [[s0,s1,s2],[s1,s2,s3],[s2,s3,s4]]·[a,b,c] = [r0,r1,r2].
    const dA = s2 * s4 - s3 * s3;
    const dB = s1 * s4 - s2 * s3;
    const dC = s1 * s3 - s2 * s2;
    const det = s0 * dA - s1 * dB + s2 * dC;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-300) {
      out.push(values[i]!);
      continue;
    }
    const detA = r0 * dA - s1 * (r1 * s4 - s3 * r2) + s2 * (r1 * s3 - s2 * r2);
    out.push(detA / det);
  }
  return out;
}

/** Convenience: smooth every component of a trajectory. */
export function smoothTrajectory(tr: Trajectory, window: number): Trajectory {
  if (window < 5) return { t: tr.t.slice(), x: tr.x.slice(), y: tr.y ? tr.y.slice() : null };
  return {
    t: tr.t.slice(),
    x: sgSmooth(tr.x, tr.t, window),
    y: tr.y ? sgSmooth(tr.y, tr.t, window) : null,
  };
}

// ---- numerical differentiation (non-uniform 3-point Lagrange) -----------------------

/**
 * First/second derivative of the quadratic through three nodes, evaluated at
 * one of the nodes (at = 0 → left node, 1 → middle, 2 → right). Exact for any
 * quadratic; the second derivative is 2× the second divided difference and is
 * independent of the evaluation node.
 */
function stencil3(
  t0: number,
  t1: number,
  t2: number,
  f0: number,
  f1: number,
  f2: number,
  at: 0 | 1 | 2,
): { d1: number; d2: number } {
  const h0 = t1 - t0;
  const h1 = t2 - t1;
  let w0: number;
  let w1: number;
  let w2: number;
  if (at === 0) {
    w0 = -((2 * h0 + h1) / (h0 * (h0 + h1)));
    w1 = (h0 + h1) / (h0 * h1);
    w2 = -h0 / ((h0 + h1) * h1);
  } else if (at === 1) {
    w0 = -h1 / (h0 * (h0 + h1));
    w1 = (h1 - h0) / (h0 * h1);
    w2 = h0 / ((h0 + h1) * h1);
  } else {
    w0 = h1 / (h0 * (h0 + h1));
    w1 = -((h0 + h1) / (h0 * h1));
    w2 = (h0 + 2 * h1) / ((h0 + h1) * h1);
  }
  const d2 = (2 * ((f2 - f1) / h1 - (f1 - f0) / h0)) / (h0 + h1);
  return { d1: w0 * f0 + w1 * f1 + w2 * f2, d2 };
}

/** Differentiate every component on the (possibly non-uniform) time grid. */
export function derivatives(tr: Trajectory): Derivatives {
  const n = tr.t.length;
  if (n < 3) throw new Error('derivatives need at least 3 samples');
  const comp = (f: number[]): { d1: number[]; d2: number[] } => {
    const d1: number[] = new Array<number>(n).fill(0);
    const d2: number[] = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const i0 = i === 0 ? 0 : i === n - 1 ? n - 3 : i - 1;
      const r = stencil3(tr.t[i0]!, tr.t[i0 + 1]!, tr.t[i0 + 2]!, f[i0]!, f[i0 + 1]!, f[i0 + 2]!, (i - i0) as 0 | 1 | 2);
      d1[i] = r.d1;
      d2[i] = r.d2;
    }
    return { d1, d2 };
  };
  const cx = comp(tr.x);
  const cy = tr.y ? comp(tr.y) : null;
  return { vx: cx.d1, ax: cx.d2, vy: cy ? cy.d1 : null, ay: cy ? cy.d2 : null };
}

// ---- mechanical energy ---------------------------------------------------------------

/**
 * KE = ½m|v|² and PE = m·g·(y − y₀) (launch-height reference). Without y
 * data only KE is produced. total = KE + PE.
 */
export function energySeries(tr: Trajectory, d: Derivatives, m: number, g: number): EnergySeries {
  const n = tr.t.length;
  const ke: number[] = [];
  for (let i = 0; i < n; i++) {
    const vy2 = d.vy ? d.vy[i]! * d.vy[i]! : 0;
    ke.push(0.5 * m * (d.vx[i]! * d.vx[i]! + vy2));
  }
  if (!tr.y) return { ke, pe: null, total: null };
  const y0 = tr.y[0]!;
  const pe = tr.y.map((v) => m * g * (v - y0));
  const total = ke.map((v, i) => v + pe[i]!);
  return { ke, pe, total };
}

/** Relative drift (max − min)/|mean| of a series. */
export function relativeDrift(series: number[]): number {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const v of series) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    sum += v;
  }
  const mean = sum / series.length;
  return Math.abs(mean) < 1e-300 ? hi - lo : (hi - lo) / Math.abs(mean);
}

// ---- linearized projectile least-squares fit ------------------------------------------

/** 2-parameter least squares v ≈ a·u + b via normal equations (null if singular). */
function linfit(u: number[], v: number[]): { a: number; b: number } | null {
  const n = u.length;
  let su = 0;
  let sv = 0;
  let suu = 0;
  let suv = 0;
  for (let i = 0; i < n; i++) {
    su += u[i]!;
    sv += v[i]!;
    suu += u[i]! * u[i]!;
    suv += u[i]! * v[i]!;
  }
  const det = n * suu - su * su;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
  const a = (n * suv - su * sv) / det;
  const b = (sv - a * su) / n;
  return { a, b };
}

/**
 * Linearized projectile fit with known g: x(t) = vx·t + x0 and, with y data,
 * y(t) + ½g·t² = vy·t + y0 (the gravity term moved to the left side makes
 * both regressions linear). Then v0 = √(vx²+vy²), θ = atan2(vy, vx).
 */
export function fitProjectile(tr: Trajectory, g: number): ProjectileFit {
  const n = tr.t.length;
  const fx = linfit(tr.t, tr.x);
  const x0 = fx ? fx.b : 0;
  const vx = fx ? fx.a : 0;
  let rmsX = 0;
  for (let i = 0; i < n; i++) {
    const r = tr.x[i]! - (vx * tr.t[i]! + x0);
    rmsX += r * r;
  }
  rmsX = Math.sqrt(rmsX / Math.max(1, n));
  if (!tr.y) {
    return { x0, vx, y0: null, vy: null, v0: null, thetaDeg: null, rmsX, rmsY: null };
  }
  const z = tr.y.map((v, i) => v + 0.5 * g * tr.t[i]! * tr.t[i]!);
  const fy = linfit(tr.t, z);
  const y0 = fy ? fy.b : 0;
  const vy = fy ? fy.a : 0;
  let rmsY = 0;
  for (let i = 0; i < n; i++) {
    const model = vy * tr.t[i]! + y0 - 0.5 * g * tr.t[i]! * tr.t[i]!;
    const r = tr.y[i]! - model;
    rmsY += r * r;
  }
  rmsY = Math.sqrt(rmsY / Math.max(1, n));
  return {
    x0,
    vx,
    y0,
    vy,
    v0: Math.hypot(vx, vy),
    thetaDeg: (Math.atan2(vy, vx) * 180) / Math.PI,
    rmsX,
    rmsY,
  };
}

// ---- text parsing (csv / tsv / dat / txt) ----------------------------------------------

/**
 * Parses t,x[,y] trajectory text: comma / tab / semicolon / whitespace
 * delimited, header and comment (#, //) lines skipped, rows sorted by time.
 * Rows must carry 2 (t,x) or 3 (t,x,y) numeric fields; mixed tables fall
 * back to the 2-column interpretation. Throws below 3 valid rows.
 */
export function parseTrajText(text: string): Trajectory {
  const rows: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    let parts: string[];
    if (line.includes('\t')) parts = line.split('\t');
    else if (line.includes(';')) parts = line.split(';');
    else if (line.includes(',')) parts = line.split(',');
    else parts = line.split(/\s+/);
    const nums: number[] = [];
    let valid = true;
    for (const tok of parts) {
      const s = tok.trim();
      if (!s) continue;
      const v = Number(s);
      if (!Number.isFinite(v)) {
        valid = false;
        break;
      }
      nums.push(v);
    }
    if (valid && (nums.length === 2 || nums.length === 3)) rows.push(nums);
  }
  if (rows.length < 3) throw new Error('trajectory file needs ≥ 3 numeric rows of t,x[,y]');
  rows.sort((a, b) => a[0]! - b[0]!);
  const hasY = rows.every((r) => r.length === 3);
  const t = rows.map((r) => r[0]!);
  const x = rows.map((r) => r[1]!);
  return { t, x, y: hasY ? rows.map((r) => r[2]!) : null };
}

// ---- embedded validation benchmarks -----------------------------------------------------

/** Parameters of the embedded synthetic recovery benchmark / demo dataset. */
export const DEMO_SYNTH: SynthOptions = { v0: 20, thetaDeg: 45, g: 9.81, n: 50, noise: 0.005, seed: 20251011 };

export interface RecoveryBenchmark {
  v0: number;
  thetaDeg: number;
  v0RelErr: number;
  thetaRelErr: number;
}

/**
 * Benchmark ① — projectile recovery. A 0.5 %-multiplicative-noise synthetic
 * trajectory (v0 = 20 m/s, θ = 45°, g = 9.81 m/s², seed 20251011) pushed
 * through the linearized least-squares fit must recover v0 and θ within 1 %.
 */
export function benchmarkProjectileRecovery(): RecoveryBenchmark {
  const tr = synthesizeProjectile(DEMO_SYNTH);
  const fit = fitProjectile(tr, DEMO_SYNTH.g);
  const v0RelErr = Math.abs(fit.v0! - DEMO_SYNTH.v0) / DEMO_SYNTH.v0;
  const thetaRelErr = Math.abs(fit.thetaDeg! - DEMO_SYNTH.thetaDeg) / DEMO_SYNTH.thetaDeg;
  return { v0: fit.v0!, thetaDeg: fit.thetaDeg!, v0RelErr, thetaRelErr };
}

/** Worst relative error where |reference| ≥ 5 % of its peak magnitude. */
function maxRel(num: number[], ref: number[]): number {
  let peak = 0;
  for (const v of ref) peak = Math.max(peak, Math.abs(v));
  let worst = 0;
  for (let i = 0; i < ref.length; i++) {
    if (Math.abs(ref[i]!) < 0.05 * peak) continue;
    worst = Math.max(worst, Math.abs(num[i]! - ref[i]!) / Math.abs(ref[i]!));
  }
  return worst;
}

/**
 * Benchmark ② — derivative accuracy. The 3-point non-uniform stencils are
 * exact for quadratics: on a power-law stretched time grid of the exact
 * parabola the recovered vx, vy and ay must match the analytic values below
 * 1e-2 relative (evaluated where |ref| ≥ 5 % of peak — vy crosses zero at
 * the apex), and ax must vanish to < 1e-6 absolute.
 */
export function benchmarkDerivativeAccuracy(): { maxRelErr: number; maxAbsAx: number } {
  const g = 9.81;
  const v0 = 20;
  const th = Math.PI / 4;
  const vx0 = v0 * Math.cos(th);
  const vy0 = v0 * Math.sin(th);
  const n = 50;
  const T = (2 * vy0) / g;
  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = T * Math.pow(i / (n - 1), 1.35); // stretched, non-uniform grid
    t.push(ti);
    x.push(vx0 * ti);
    y.push(vy0 * ti - 0.5 * g * ti * ti);
  }
  const d = derivatives({ t, x, y });
  let maxRelErr = maxRel(d.vx, t.map(() => vx0));
  maxRelErr = Math.max(maxRelErr, maxRel(d.vy!, t.map((ti) => vy0 - g * ti)));
  maxRelErr = Math.max(maxRelErr, maxRel(d.ay!, t.map(() => -g)));
  let maxAbsAx = 0;
  for (const v of d.ax) maxAbsAx = Math.max(maxAbsAx, Math.abs(v));
  return { maxRelErr, maxAbsAx };
}

/**
 * Benchmark ③ — energy conservation. On the noiseless synthetic parabola the
 * total mechanical energy (KE + PE, launch-height reference) must stay flat:
 * relative drift (max−min)/|mean| below 0.5 % — machine-level in practice.
 */
export function benchmarkEnergyDrift(): { drift: number } {
  const tr = synthesizeProjectile({ ...DEMO_SYNTH, noise: 0 });
  const d = derivatives(tr);
  const e = energySeries(tr, d, 1, DEMO_SYNTH.g);
  return { drift: relativeDrift(e.total!) };
}
