// ==========================================================================
// geo-soilwater — van Genuchten (1980) soil water retention numerics
// (pure, dependency-free, testable)
//
// Model (constrained m = 1 − 1/n):
//   θ(h) = θr + (θs − θr) / [1 + (α|h|)^n]^(1 − 1/n),   h = pressure head (cm).
//
// Layers:
//   - analytic model, effective saturation, specific moisture capacity C(h)
//     and the Young–Laplace equivalent pore radius;
//   - a compact Levenberg–Marquardt nonlinear least-squares fit with a
//     numerical Jacobian, box bounds (projection after every step) and
//     covariance-based parameter standard errors;
//   - seeded synthetic-data benchmark against the published sand parameters of
//     van Genuchten (1980), Table 1 (θr = 0.045, θs = 0.430, α = 0.145 cm⁻¹,
//     n = 2.68) with a uniform relative-error convention
//     |computed − analytic| / |analytic|.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export interface VGParams {
  /** Residual water content (cm³/cm³). */
  thr: number;
  /** Saturated water content (cm³/cm³). */
  ths: number;
  /** Inverse air-entry suction α (1/cm). */
  alpha: number;
  /** Pore-size distribution index n (> 1). */
  n: number;
}

/** Published sand parameters, van Genuchten (1980), Table 1. */
export const VG_SAND_1980: VGParams = { thr: 0.045, ths: 0.43, alpha: 0.145, n: 2.68 };

/** Bounds presets for the fit. */
export type BoundsPreset = 'standard' | 'loose';

export interface VGBounds {
  thr: [number, number];
  ths: [number, number];
  alpha: [number, number];
  n: [number, number];
}

export function vgBounds(preset: BoundsPreset = 'standard'): VGBounds {
  if (preset === 'loose') {
    return {
      thr: [0, 0.4],
      ths: [0.1, 0.9],
      alpha: [1e-5, 10],
      n: [1.001, 10],
    };
  }
  return {
    thr: [0, 0.25],
    ths: [0.2, 0.6],
    alpha: [1e-4, 1],
    n: [1.01, 5],
  };
}

/** Clamp a parameter vector onto the box bounds, order [thr, ths, alpha, n]. */
function clampX(x: number[], b: VGBounds): number[] {
  return [
    Math.min(b.thr[1], Math.max(b.thr[0], x[0]!)),
    Math.min(b.ths[1], Math.max(b.ths[0], x[1]!)),
    Math.min(b.alpha[1], Math.max(b.alpha[0], x[2]!)),
    Math.min(b.n[1], Math.max(b.n[0], x[3]!)),
  ];
}

function xToParams(x: number[]): VGParams {
  return { thr: x[0]!, ths: x[1]!, alpha: x[2]!, n: x[3]! };
}

/** van Genuchten water content at pressure head h (cm; sign ignored). */
export function vgTheta(h: number, p: VGParams): number {
  const hAbs = Math.abs(h);
  if (hAbs <= 0) return p.ths;
  const x = p.alpha * hAbs;
  const m = 1 - 1 / p.n;
  return p.thr + (p.ths - p.thr) / Math.pow(1 + Math.pow(x, p.n), m);
}

/** Effective saturation Se = (θ − θr)/(θs − θr) = [1 + (α|h|)^n]^(−m). */
export function vgSe(h: number, p: VGParams): number {
  const hAbs = Math.abs(h);
  if (hAbs <= 0) return 1;
  const x = p.alpha * hAbs;
  const m = 1 - 1 / p.n;
  return Math.pow(1 + Math.pow(x, p.n), -m);
}

/**
 * Specific moisture capacity magnitude |dθ/dh| (1/cm), analytic derivative of
 * the constrained-m model:
 *   C = (θs − θr)·(n−1)·α·(α|h|)^(n−1) / [1 + (α|h|)^n]^(2 − 1/n).
 */
export function vgCapacity(h: number, p: VGParams): number {
  const hAbs = Math.abs(h);
  if (hAbs <= 0) return 0;
  const x = p.alpha * hAbs;
  const num = (p.ths - p.thr) * (p.n - 1) * p.alpha * Math.pow(x, p.n - 1);
  const den = Math.pow(1 + Math.pow(x, p.n), 2 - 1 / p.n);
  return num / den;
}

/**
 * Young–Laplace equivalent pore radius (cm) for a suction |h| in cm:
 *   r = 2σcosγ / (ρ g ψ), with σ = 72.75 dyn/cm (water, 20 °C),
 *   ρ = 0.9982 g/cm³, g = 981 cm/s² → 2σ/(ρg) ≈ 0.1486 cm·(suction in cm).
 */
export const YOUNG_LAPLACE_COEF_CM = 0.1486;

export function equivalentPoreRadiusCm(hCm: number): number {
  const hAbs = Math.abs(hCm);
  if (hAbs <= 0) return Number.POSITIVE_INFINITY;
  return YOUNG_LAPLACE_COEF_CM / hAbs;
}

// ---- data parsing -------------------------------------------------------------

export interface RetentionPoint {
  /** Suction / pressure head magnitude (cm). */
  h: number;
  /** Water content (cm³/cm³). */
  theta: number;
}

export interface ParsedRetention {
  points: RetentionPoint[];
  /** True when values were interpreted as percent and divided by 100. */
  percentScaled: boolean;
}

/**
 * Parse θ(h) data from CSV / TSV / whitespace text with `#` comments and one
 * header row. Expected columns: `h, theta`. Negative pressure heads are
 * accepted (absolute value taken). Values above 1.05 are interpreted as
 * percent and rescaled to cm³/cm³.
 */
export function parseRetentionData(text: string): ParsedRetention {
  const rows: RetentionPoint[] = [];
  let sawHeader = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const cells = line.split(/[,;\t]| +/).map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 2) {
      sawHeader = true;
      continue;
    }
    const hRaw = Number(cells[0]);
    const theta = Number(cells[1]);
    if (!Number.isFinite(hRaw) || !Number.isFinite(theta)) {
      if (!sawHeader) sawHeader = true;
      continue;
    }
    rows.push({ h: Math.abs(hRaw), theta });
  }
  const percentScaled = rows.some((r) => r.theta > 1.05);
  const points = rows
    .map((r) => ({ h: r.h, theta: percentScaled ? r.theta / 100 : r.theta }))
    .filter((r) => r.theta >= 0 && r.theta <= 1);
  return { points, percentScaled: percentScaled && points.length > 0 };
}

// ---- Levenberg–Marquardt fit ----------------------------------------------------

export interface VGFitOptions {
  init?: Partial<VGParams>;
  bounds?: VGBounds;
  maxIter?: number;
  /** Initial Marquardt damping (default 1e-3). */
  lambda0?: number;
}

export interface VGFitResult {
  params: VGParams;
  /** Parameter standard errors from σ̂²·(JᵀJ)⁻¹ (null when singular / dof ≤ 0). */
  stderr: VGParams | null;
  rmse: number;
  sse: number;
  iterations: number;
  converged: boolean;
  history: Array<{ iter: number; sse: number; lambda: number }>;
  /** Residuals obs − pred in data order. */
  residuals: number[];
  /** Model values at the fitted parameters, data order. */
  fitted: number[];
}

/** Heuristic starting vector from the data: θr below the dry tail, θs near the wet end. */
function defaultInit(data: RetentionPoint[]): VGParams {
  let thMax = 0;
  let thMin = 1;
  for (const d of data) {
    thMax = Math.max(thMax, d.theta);
    thMin = Math.min(thMin, d.theta);
  }
  return {
    thr: Math.max(0, Math.min(thMin, 0.1)),
    ths: Math.min(0.6, thMax + 0.02),
    alpha: 0.02,
    n: 1.6,
  };
}

/** Central-difference numerical Jacobian of the model w.r.t. [thr, ths, alpha, n]. */
function numericalJacobian(x: number[], hAbs: number[]): number[][] {
  const nRows = hAbs.length;
  const J: number[][] = Array.from({ length: nRows }, () => [0, 0, 0, 0]);
  for (let j = 0; j < 4; j += 1) {
    const step = 1e-6 * Math.max(Math.abs(x[j]!), 1e-3);
    const xPlus = x.slice();
    const xMinus = x.slice();
    xPlus[j] = x[j]! + step;
    xMinus[j] = x[j]! - step;
    const fPlus = xToParams(xPlus);
    const fMinus = xToParams(xMinus);
    for (let i = 0; i < nRows; i += 1) {
      J[i]![j] = (vgTheta(hAbs[i]!, fPlus) - vgTheta(hAbs[i]!, fMinus)) / (2 * step);
    }
  }
  return J;
}

/** Solve a dense linear system A·z = rhs via Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const m = a.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    }
    if (Math.abs(m[piv]![col]!) < 1e-14) return null;
    if (piv !== col) {
      const tmp = m[col]!;
      m[col] = m[piv]!;
      m[piv] = tmp;
    }
    const diag = m[col]![col]!;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = m[r]![col]! / diag;
      for (let c = col; c <= n; c += 1) m[r]![c] = m[r]![c]! - factor * m[col]![c]!;
    }
  }
  const z: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) z[i] = m[i]![n]! / m[i]![i]!;
  return z;
}

function sseOf(x: number[], hAbs: number[], obs: number[]): number {
  const p = xToParams(x);
  let sse = 0;
  for (let i = 0; i < hAbs.length; i += 1) {
    const d = obs[i]! - vgTheta(hAbs[i]!, p);
    sse += d * d;
  }
  return sse;
}

/**
 * Fit θ(h) data with the constrained-m van Genuchten model using
 * Levenberg–Marquardt (numerical Jacobian, Marquardt-scaled damping, box
 * bounds enforced by projection after every accepted step). Returns null when
 * the data cannot constrain the model (fewer than 5 points).
 */
export function fitVanGenuchten(data: RetentionPoint[], opts?: VGFitOptions): VGFitResult | null {
  const pts = data.filter((d) => Number.isFinite(d.h) && Number.isFinite(d.theta) && d.h > 0);
  if (pts.length < 5) return null;
  const hAbs = pts.map((d) => Math.abs(d.h));
  const obs = pts.map((d) => d.theta);
  const bounds = opts?.bounds ?? vgBounds('standard');
  const maxIter = opts?.maxIter ?? 200;
  const init = { ...defaultInit(pts), ...(opts?.init ?? {}) };
  const x0 = clampX([init.thr, init.ths, init.alpha, init.n], bounds);

  let x = x0;
  let sse = sseOf(x, hAbs, obs);
  let lambda = opts?.lambda0 ?? 1e-3;
  const history: Array<{ iter: number; sse: number; lambda: number }> = [];
  let converged = false;
  let iter = 0;

  for (; iter < maxIter; iter += 1) {
    const J = numericalJacobian(x, hAbs);
    const p = xToParams(x);
    const r: number[] = hAbs.map((h, i) => obs[i]! - vgTheta(h, p));
    // A = JᵀJ, g = Jᵀr
    const A: number[][] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const g = [0, 0, 0, 0];
    for (let i = 0; i < hAbs.length; i += 1) {
      for (let a = 0; a < 4; a += 1) {
        g[a]! += J[i]![a]! * r[i]!;
        for (let b = 0; b < 4; b += 1) A[a]![b]! += J[i]![a]! * J[i]![b]!;
      }
    }
    let accepted = false;
    let xNew = x;
    let sseNew = sse;
    for (let trial = 0; trial < 40; trial += 1) {
      const damped = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) : v)));
      const delta = solveLinear(damped, g);
      if (delta && delta.every((v) => Number.isFinite(v))) {
        xNew = clampX([x[0]! + delta[0]!, x[1]! + delta[1]!, x[2]! + delta[2]!, x[3]! + delta[3]!], bounds);
        sseNew = sseOf(xNew, hAbs, obs);
        if (sseNew < sse) {
          accepted = true;
          break;
        }
      }
      lambda *= 4;
      if (lambda > 1e12) break;
    }
    history.push({ iter, sse, lambda });
    if (!accepted) {
      converged = true; // no downhill step left — at a local optimum
      break;
    }
    const relChange = Math.abs(sse - sseNew) / Math.max(sse, 1e-30);
    x = xNew;
    sse = sseNew;
    lambda = Math.max(lambda / 3, 1e-12);
    if (relChange < 1e-13) {
      converged = true;
      break;
    }
  }

  const params = xToParams(x);
  const fitted = hAbs.map((h) => vgTheta(h, params));
  const residuals = obs.map((o, i) => o - fitted[i]!);
  const rmse = Math.sqrt(sse / hAbs.length);

  // Covariance-based standard errors: σ̂²·(JᵀJ)⁻¹ at the solution.
  let stderr: VGParams | null = null;
  const dof = hAbs.length - 4;
  if (dof > 0 && sse > 0) {
    const J = numericalJacobian(x, hAbs);
    const A: number[][] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    for (let i = 0; i < hAbs.length; i += 1) {
      for (let a = 0; a < 4; a += 1) {
        for (let b = 0; b < 4; b += 1) A[a]![b]! += J[i]![a]! * J[i]![b]!;
      }
    }
    const covScale = sse / dof;
    const se: number[] = [];
    let ok = true;
    for (let j = 0; j < 4; j += 1) {
      const rhs = [0, 0, 0, 0];
      rhs[j] = 1;
      const col = solveLinear(A, rhs);
      if (!col || col[j]! < 0) {
        ok = false;
        break;
      }
      se.push(Math.sqrt(covScale * col[j]!));
    }
    if (ok) {
      stderr = { thr: se[0]!, ths: se[1]!, alpha: se[2]!, n: se[3]! };
    }
  }

  return {
    params,
    stderr,
    rmse,
    sse,
    iterations: iter + 1,
    converged,
    history,
    residuals,
    fitted,
  };
}

// ---- seeded synthetic data + validation benchmarks ------------------------------

/**
 * Deterministic synthetic retention dataset: exact model + multiplicative
 * gaussian noise (mulberry32 + Box-Muller), θ_synth = θ·(1 + noise·z).
 */
export function syntheticRetention(p: VGParams, hValues: number[], noise = 0.01, seed = 20260922): RetentionPoint[] {
  const rand = mulberry32(seed >>> 0);
  const nextNormal = (): number => {
    let u = 0;
    do {
      u = rand();
    } while (u <= 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  return hValues.map((h) => ({ h, theta: vgTheta(h, p) * (1 + noise * nextNormal()) }));
}

/** Log-spaced suction grid from hMin to hMax with n points. */
export function logSpacedHeads(hMin: number, hMax: number, n: number): number[] {
  const lo = Math.log10(hMin);
  const hi = Math.log10(hMax);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(Math.pow(10, lo + ((hi - lo) * i) / (n - 1)));
  }
  return out;
}

export interface BenchmarkOutcome {
  name: string;
  passed: boolean;
  relErr: number | null;
  detail: string;
}

/** Relative-error convention shared by all benchmarks. */
function relErr(computed: number, analytic: number): number {
  return Math.abs(computed - analytic) / Math.abs(analytic);
}

/**
 * Benchmark 1 — parameter recovery: synthesise the published sand retention
 * curve (van Genuchten 1980 Table 1: θr=0.045, θs=0.430, α=0.145 cm⁻¹,
 * n=2.68) on 24 log-spaced suctions 1–15000 cm with 1% seeded noise, refit and
 * require every parameter within 3% relative error.
 */
export function benchmarkParameterRecovery(): BenchmarkOutcome & { recovered?: VGParams; truth?: VGParams } {
  const truth = VG_SAND_1980;
  const heads = logSpacedHeads(1, 15000, 24);
  const data = syntheticRetention(truth, heads, 0.01, 20260922);
  const fit = fitVanGenuchten(data, {
    init: { thr: 0.05, ths: 0.4, alpha: 0.05, n: 1.8 },
    bounds: vgBounds('standard'),
    maxIter: 300,
  });
  if (!fit) {
    return { name: 'vg-sand-recovery', passed: false, relErr: null, detail: 'fit failed' };
  }
  const errs = {
    thr: relErr(fit.params.thr, truth.thr),
    ths: relErr(fit.params.ths, truth.ths),
    alpha: relErr(fit.params.alpha, truth.alpha),
    n: relErr(fit.params.n, truth.n),
  };
  const worst = Math.max(errs.thr, errs.ths, errs.alpha, errs.n);
  return {
    name: 'vg-sand-recovery',
    passed: worst < 0.03 && fit.converged,
    relErr: worst,
    detail:
      `rel err θr=${(errs.thr * 100).toFixed(2)}% θs=${(errs.ths * 100).toFixed(2)}% ` +
      `α=${(errs.alpha * 100).toFixed(2)}% n=${(errs.n * 100).toFixed(2)}%, RMSE=${fit.rmse.toFixed(5)}`,
    recovered: fit.params,
    truth,
  };
}

/**
 * Benchmark 2 — C(h) consistency: analytic capacity vs central-difference
 * numerical derivative of θ(h) across the suction range (worst relative
 * error must stay below 1%).
 */
export function benchmarkCapacityDerivative(): BenchmarkOutcome {
  const p = VG_SAND_1980;
  let worst = 0;
  let worstH = Number.NaN;
  for (const h of logSpacedHeads(1, 15000, 30)) {
    const d = Math.max(h, 1) * 1e-4;
    // theta decreases with h, so the central difference is negative; compare magnitudes.
    const numeric = Math.abs((vgTheta(h + d, p) - vgTheta(h - d, p)) / (2 * d));
    const analytic = vgCapacity(h, p);
    if (analytic <= 0) continue;
    const e = Math.abs(numeric - analytic) / analytic;
    if (e > worst) {
      worst = e;
      worstH = h;
    }
  }
  return {
    name: 'vg-capacity-derivative',
    passed: worst < 0.01,
    relErr: worst,
    detail: `worst |dθ/dh| rel err ${(worst * 100).toFixed(4)}% at h=${worstH.toFixed(1)} cm`,
  };
}

/**
 * Benchmark 3 — convergence: the accepted-step history of the recovery fit
 * must be monotonically non-increasing in SSE and end converged.
 */
export function benchmarkRmseConvergence(): BenchmarkOutcome {
  const heads = logSpacedHeads(1, 15000, 24);
  const data = syntheticRetention(VG_SAND_1980, heads, 0.01, 20260922);
  const fit = fitVanGenuchten(data, {
    init: { thr: 0.05, ths: 0.4, alpha: 0.05, n: 1.8 },
    bounds: vgBounds('standard'),
    maxIter: 300,
  });
  if (!fit) {
    return { name: 'vg-rmse-convergence', passed: false, relErr: null, detail: 'fit failed' };
  }
  let monotone = true;
  for (let i = 1; i < fit.history.length; i += 1) {
    if (fit.history[i]!.sse > fit.history[i - 1]!.sse + 1e-18) {
      monotone = false;
      break;
    }
  }
  const first = fit.history[0]!.sse;
  const last = fit.history[fit.history.length - 1]!.sse;
  const drop = first > 0 ? (first - last) / first : 0;
  return {
    name: 'vg-rmse-convergence',
    passed: monotone && fit.converged,
    relErr: monotone ? 0 : 1,
    detail: `${fit.iterations} accepted steps, SSE ${first.toExponential(3)} → ${last.toExponential(3)} (drop ${(drop * 100).toFixed(1)}%), RMSE=${fit.rmse.toFixed(5)}`,
  };
}
