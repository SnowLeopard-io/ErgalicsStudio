// ==========================================================================
// astro-transit — exoplanet transit light-curve numerics (pure, testable)
//
// A simplified trapezoid transit model (depth δ, total duration T14, flat
// duration T23, linear ingress/egress slopes of duration τ = (T14 − T23)/2),
// a simplified Box-Least-Squares-style period detector (phase-folded grid
// search maximising the in-transit depth significance), and a
// Levenberg-Marquardt refinement of (P, T0, δ, T14, T23, baseline) with an
// analytic Jacobian and covariance-based 1σ parameter errors.
//
// Embedded validation benchmark: a seeded synthetic trapezoid light curve
// with known truth → detect → fit → recovery errors under the unified
// relative-error convention |computed − analytic| / |analytic|.
// All functions are pure: no DOM / canvas dependency, directly unit-testable.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

// ---- trapezoid model -------------------------------------------------------

/** Parameters of the simplified trapezoid transit model. Times in days. */
export interface TrapezoidParams {
  /** Orbital period (d). */
  P: number;
  /** A reference mid-transit epoch (same clock as the data times). */
  T0: number;
  /** Transit depth as a fraction of the baseline flux. */
  delta: number;
  /** Total first-to-fourth contact duration (d). */
  T14: number;
  /** Flat second-to-third contact duration (d); 0 ≤ T23 < T14. */
  T23: number;
  /** Out-of-transit (baseline) flux level. */
  baseline: number;
}

/** Ingress/egress slope duration implied by the trapezoid geometry: τ = (T14 − T23)/2. */
export function ingressDuration(p: Pick<TrapezoidParams, 'T14' | 'T23'>): number {
  return (p.T14 - p.T23) / 2;
}

/**
 * Wrap a time offset relative to the nearest transit centre: the result lies
 * in (−P/2, P/2]. Uses `Math.round` so the wrap is exact for any offset.
 */
export function phaseWrap(dt: number, P: number): number {
  return dt - P * Math.round(dt / P);
}

/** Normalised in-transit shape s(|Δt|): 1 on the flat bottom, linear ramp to 0 across the slopes. */
function trapezoidShape(a: number, T14: number, T23: number): number {
  if (a <= T23 / 2) return 1;
  if (a >= T14 / 2) return 0;
  const tau = (T14 - T23) / 2;
  return (T14 / 2 - a) / tau;
}

/** Flux of the trapezoid model at time t (periodic via phase wrapping). */
export function trapezoidFlux(t: number, p: TrapezoidParams): number {
  const dt = phaseWrap(t - p.T0, p.P);
  return p.baseline - p.delta * trapezoidShape(Math.abs(dt), p.T14, p.T23);
}

/**
 * The same model parametrised directly by the ingress duration τ, with the
 * flat duration imposed through the exact geometric identity T23 = T14 − 2τ.
 * The self-consistency benchmark checks that this parametrisation and the
 * (T14, T23) parametrisation agree to < 1e-9 everywhere.
 */
export function trapezoidFluxTau(
  t: number,
  p: { P: number; T0: number; delta: number; T14: number; tau: number; baseline: number },
): number {
  return trapezoidFlux(t, { P: p.P, T0: p.T0, delta: p.delta, T14: p.T14, T23: p.T14 - 2 * p.tau, baseline: p.baseline });
}

/**
 * Maximum analytical self-consistency deviation of a trapezoid parameter set:
 * the identity T23 = T14 − 2·τ (exact by construction here) plus flux
 * continuity across the second/third and first/fourth contact boundaries.
 * Returns the largest absolute deviation found (0 for a consistent model).
 */
export function trapezoidSelfConsistency(p: TrapezoidParams): number {
  const tau = ingressDuration(p);
  const identity = Math.abs(p.T23 - (p.T14 - 2 * tau));
  let worst = identity;
  const eps = 1e-9;
  for (const boundary of [p.T23 / 2, p.T14 / 2]) {
    const lo = trapezoidFlux(p.T0 + boundary - eps, p);
    const hi = trapezoidFlux(p.T0 + boundary + eps, p);
    worst = Math.max(worst, Math.abs(lo - hi));
  }
  return worst;
}

// ---- data plumbing ---------------------------------------------------------

/** One photometric measurement: time, flux and optional 1σ error. */
export interface TransitPoint {
  t: number;
  f: number;
  err?: number;
}

/**
 * Parse a light curve from CSV / TSV / whitespace text. Accepts the columns
 * time, flux[, err]; `#`-comment lines and a single non-numeric header line
 * are skipped. Rows with non-finite values are dropped.
 */
export function parseTransitData(text: string): TransitPoint[] {
  const out: TransitPoint[] = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const cells = l.split(/[,\s;]+/).filter(Boolean);
    if (cells.length < 2) continue;
    const t = Number(cells[0]);
    const f = Number(cells[1]);
    if (!Number.isFinite(t) || !Number.isFinite(f)) continue;
    const err = cells.length > 2 ? Number(cells[2]) : NaN;
    out.push({ t, f, err: Number.isFinite(err) && err > 0 ? err : undefined });
  }
  return out;
}

/** Deterministic seeded normal deviates (mulberry32 + Box–Muller). */
export function seededNormal(seed: number): () => number {
  const next = mulberry32(seed);
  return () => {
    let u = 0;
    do {
      u = next();
    } while (u <= 1e-9);
    const v = next() || 0.5;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/**
 * Synthesise a noisy trapezoid light curve: `n` uniform samples over
 * [tMin, tMax] with gaussian noise of standard deviation `noise`.
 */
export function synthesizeTransitData(
  p: TrapezoidParams,
  opts?: { n?: number; tMin?: number; tMax?: number; noise?: number; seed?: number },
): TransitPoint[] {
  const n = Math.max(2, Math.floor(opts?.n ?? 300));
  const tMin = opts?.tMin ?? 0;
  const tMax = opts?.tMax ?? tMin + 3 * p.P;
  const noise = opts?.noise ?? 0;
  const rand = seededNormal(opts?.seed ?? 20260927);
  const pts: TransitPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = tMin + ((tMax - tMin) * i) / (n - 1);
    pts.push({ t, f: trapezoidFlux(t, p) + noise * rand(), err: noise > 0 ? noise : undefined });
  }
  return pts;
}

// ---- robust statistics helpers ---------------------------------------------

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function sortedCopy(a: number[]): number[] {
  return [...a].sort((x, y) => x - y);
}

function robustSigma(values: number[]): number {
  const s = sortedCopy(values);
  const med = median(s);
  const dev = s.map((v) => Math.abs(v - med));
  const mad = median(sortedCopy(dev));
  if (mad > 1e-12) return 1.4826 * mad;
  const varr = values.reduce((acc, v) => acc + (v - med) ** 2, 0) / Math.max(1, values.length - 1);
  return Math.max(Math.sqrt(varr), 1e-12);
}

// ---- period detection (simplified BLS) --------------------------------------

export interface PeriodDetection {
  /** Best trial period (d). */
  period: number;
  /** Best transit centre for that period (same clock as the data). */
  epoch: number;
  /** Box depth of the best trial (fraction). */
  depth: number;
  /** Box width of the best trial (d). */
  width: number;
  /** Depth significance in units of the combined 1σ. */
  score: number;
}

interface GridOpts {
  pMin?: number;
  pMax?: number;
  steps?: number;
}

/**
 * Score one (P, T0, width) box trial: median(flux) − mean(in-transit flux),
 * divided by the combined 1σ of that difference. This is the depth
 * significance a BLS box would achieve — the simplified "boxiness" statistic.
 */
function boxScore(
  ts: number[],
  fs: number[],
  med: number,
  sigma: number,
  P: number,
  T0: number,
  width: number,
): { score: number; depth: number; nIn: number } {
  let nIn = 0;
  let sumIn = 0;
  const half = width / 2;
  for (let i = 0; i < ts.length; i += 1) {
    if (Math.abs(phaseWrap(ts[i]! - T0, P)) < half) {
      nIn += 1;
      sumIn += fs[i]!;
    }
  }
  if (nIn < 3) return { score: 0, depth: 0, nIn };
  const depth = med - sumIn / nIn;
  const score = depth / (sigma * Math.sqrt(1 / nIn + 1 / ts.length));
  return { score, depth, nIn };
}

/**
 * Simplified BLS period detection: a coarse-to-fine grid search over trial
 * periods, phase offsets and box widths, maximising the in-transit depth
 * significance. Returns null when the data cannot support detection
 * (too few points or no significant box found).
 */
export function detectPeriod(data: TransitPoint[], opts?: GridOpts): PeriodDetection | null {
  if (data.length < 20) return null;
  const ts = data.map((d) => d.t);
  const fs = data.map((d) => d.f);
  const med = median(sortedCopy(fs));
  const sigma = robustSigma(fs);

  const sortedTs = sortedCopy(ts);
  const diffs: number[] = [];
  for (let i = 1; i < sortedTs.length; i += 1) diffs.push(sortedTs[i]! - sortedTs[i - 1]!);
  const cadence = Math.max(median(sortedCopy(diffs)), 1e-9);
  const tSpan = sortedTs[sortedTs.length - 1]! - sortedTs[0]!;
  if (tSpan <= 0) return null;

  const lo = Math.max(opts?.pMin && opts.pMin > 0 ? opts.pMin : 0, 2.5 * cadence);
  const hi = Math.min(opts?.pMax && opts.pMax > lo ? opts.pMax : Infinity, tSpan / 2.5);
  if (!(hi > lo)) return null;

  const evaluateGrid = (
    pLo: number,
    pHi: number,
    steps: number,
    nPhase: number,
    widthFractions: number[],
  ): PeriodDetection | null => {
    let best: PeriodDetection | null = null;
    for (let s = 0; s <= steps; s += 1) {
      const P = pLo + ((pHi - pLo) * s) / Math.max(1, steps);
      for (let ph = 0; ph < nPhase; ph += 1) {
        const T0 = ts[0]! + (P * ph) / nPhase;
        for (const wf of widthFractions) {
          const width = wf * P;
          const { score, depth } = boxScore(ts, fs, med, sigma, P, T0, width);
          if (!best || score > best.score) best = { period: P, epoch: T0, depth, width, score };
        }
      }
    }
    return best;
  };

  const steps = Math.max(50, Math.floor(opts?.steps ?? 1000));
  // Coarse pass, then two refinement passes around the best period.
  let best = evaluateGrid(lo, hi, steps, 24, [0.05, 0.1, 0.2]);
  if (!best) return null;
  const d1 = (hi - lo) / steps;
  const b2 = evaluateGrid(Math.max(lo, best.period - d1), Math.min(hi, best.period + d1), 300, 48, [0.04, 0.08, 0.16]);
  if (b2 && b2.score >= best.score) best = b2;
  const d2 = (2 * d1) / 300;
  const b3 = evaluateGrid(Math.max(lo, best.period - d2), Math.min(hi, best.period + d2), 300, 64, [0.03, 0.06, 0.12, 0.24]);
  if (b3 && b3.score >= best.score) best = b3;
  return best.score >= 5 ? best : null;
}

// ---- Levenberg-Marquardt fit -------------------------------------------------

/** Bounds applied to the fitted parameters after every LM step. */
export interface TransitBounds {
  pMin?: number;
  pMax?: number;
  deltaMin?: number;
  deltaMax?: number;
  t14Max?: number;
}

export interface TransitFitResult {
  params: TrapezoidParams;
  /** 1σ formal errors from the covariance matrix (NaN when singular). */
  sigma: { P: number; T0: number; delta: number; T14: number; T23: number; baseline: number };
  chi2: number;
  dof: number;
  r2: number;
  rmse: number;
  converged: boolean;
  iterations: number;
}

const PARAM_COUNT = 6;

/** Clamp a parameter vector into physically admissible bounds. */
function clampVector(x: number[], b: TransitBounds, tSpan: number): number[] {
  const c = [...x];
  c[0] = Math.min(Math.max(c[0]!, b.pMin ?? 1e-4), b.pMax ?? tSpan);
  c[1] = c[1]!;
  c[2] = Math.min(Math.max(c[2]!, b.deltaMin ?? 0), b.deltaMax ?? 0.9);
  c[3] = Math.min(Math.max(c[3]!, 1e-4), b.t14Max ?? tSpan);
  c[4] = Math.min(Math.max(c[4]!, 0), 0.98 * c[3]!);
  return c;
}

/** Flux and analytic ∂f/∂x for x = [P, T0, δ, T14, T23, baseline]. */
function modelAndJacobian(
  t: number,
  x: number[],
  jac: Float64Array | null,
  jOff: number,
): number {
  const [P, T0, delta, T14, T23, baseline] = x as [number, number, number, number, number, number];
  const u = t - T0;
  const k = Math.round(u / P);
  const dt = u - k * P;
  const a = Math.abs(dt);
  const tau = (T14 - T23) / 2;
  const inFlat = a <= T23 / 2;
  const inSlope = !inFlat && a < T14 / 2;
  const s = inFlat ? 1 : inSlope ? (T14 / 2 - a) / tau : 0;
  const f = baseline - delta * s;
  if (jac) {
    // ∂f/∂baseline = 1; ∂f/∂δ = −s
    jac[jOff + 5] = 1;
    jac[jOff + 2] = -s;
    // Chain rule: ∂f/∂Δt = −δ·∂s/∂Δt = δ·sign(Δt)/τ on the slopes.
    // Δt = (t − T0) − k·P with k locally constant, so
    //   ∂f/∂T0 = −∂f/∂Δt   and   ∂f/∂P = −k·∂f/∂Δt.
    const dfddt = inSlope ? (delta * Math.sign(dt)) / tau : 0;
    jac[jOff + 1] = -dfddt;
    jac[jOff + 0] = -dfddt * k;
    if (inSlope) {
      // s = (T14/2 − |Δt|)/τ with τ = (T14 − T23)/2:
      //   ∂s/∂T14 = 1/(2τ) − (T14/2 − |Δt|)/(2τ²)
      //   ∂s/∂T23 =  (T14/2 − |Δt|)/(2τ²)
      const r = T14 / 2 - a;
      jac[jOff + 3] = -delta * (0.5 / tau - r * 0.5 / (tau * tau));
      jac[jOff + 4] = -delta * (r * 0.5 / (tau * tau));
    } else {
      jac[jOff + 3] = 0;
      jac[jOff + 4] = 0;
    }
  }
  return f;
}

/** Solve the 6×6 symmetric positive-definite system (A + λ·diag(A))·dx = −g. */
function solve6(A: Float64Array, g: number[], lambda: number): number[] | null {
  const n = PARAM_COUNT;
  const m: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < n; j += 1) row.push(A[i * n + j]! + (i === j ? lambda * Math.max(A[i * n + i]!, 1e-12) : 0));
    row.push(-g[i]!);
    m.push(row);
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-30) return null;
    if (piv !== col) {
      const tmp = m[piv]!;
      m[piv] = m[col]!;
      m[col] = tmp;
    }
    for (let r = col + 1; r < n; r += 1) {
      const fac = m[r]![col]! / m[col]![col]!;
      if (fac === 0) continue;
      for (let c = col; c <= n; c += 1) m[r]![c] = m[r]![c]! - fac * m[col]![c]!;
    }
  }
  const dx = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let acc = m[r]![n]!;
    for (let c = r + 1; c < n; c += 1) acc -= m[r]![c]! * dx[c]!;
    dx[r] = acc / m[r]![r]!;
  }
  return dx;
}

/** Invert a 6×6 matrix via Gauss–Jordan (for the covariance matrix). */
function invert6(A: Float64Array): Float64Array | null {
  const n = PARAM_COUNT;
  const m: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j += 1) row[j] = A[i * n + j]!;
    row[n + i] = 1;
    m.push(row);
  }
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-30) return null;
    if (piv !== col) {
      const tmp = m[piv]!;
      m[piv] = m[col]!;
      m[col] = tmp;
    }
    const d = m[col]![col]!;
    for (let c = 0; c < 2 * n; c += 1) m[col]![c] = m[col]![c]! / d;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const fac = m[r]![col]!;
      if (fac === 0) continue;
      for (let c = 0; c < 2 * n; c += 1) m[r]![c] = m[r]![c]! - fac * m[col]![c]!;
    }
  }
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) inv[i * n + j] = m[i]![n + j]!;
  return inv;
}

/**
 * Levenberg-Marquardt fit of the trapezoid model (P, T0, δ, T14, T23,
 * baseline) to a light curve, optionally weighted by per-point errors.
 * Parameter errors come from the covariance matrix (JᵀJ)⁻¹ scaled by χ²/dof.
 */
export function fitTransit(
  data: TransitPoint[],
  init: TrapezoidParams,
  opts?: { maxIter?: number; bounds?: TransitBounds },
): TransitFitResult | null {
  const n = data.length;
  if (n <= PARAM_COUNT) return null;
  const tSpan = Math.max(...data.map((d) => d.t)) - Math.min(...data.map((d) => d.t));
  if (!(tSpan > 0)) return null;
  const bounds = opts?.bounds ?? {};
  const maxIter = opts?.maxIter ?? 120;

  let x = clampVector(
    [init.P, init.T0, init.delta, init.T14, init.T23, init.baseline],
    bounds,
    tSpan,
  );
  const jac = new Float64Array(n * PARAM_COUNT);
  const resid = new Float64Array(n);

  const evaluate = (vec: number[]): { cost: number; r2: number; rmse: number } => {
    let cost = 0;
    let ssRes = 0;
    let ssTot = 0;
    let mean = 0;
    for (const d of data) mean += d.f;
    mean /= n;
    for (let i = 0; i < n; i += 1) {
      const d = data[i]!;
      const model = modelAndJacobian(d.t, vec, null, 0);
      const w = d.err && d.err > 0 ? 1 / d.err : 1;
      const r = (model - d.f) * w;
      resid[i] = model - d.f;
      cost += r * r;
      ssRes += (model - d.f) ** 2;
      ssTot += (d.f - mean) ** 2;
    }
    return { cost, r2: ssTot > 1e-30 ? 1 - ssRes / ssTot : 1, rmse: Math.sqrt(ssRes / n) };
  };

  let cur = evaluate(x);
  let lambda = 1e-3;
  let converged = false;
  let it = 0;
  for (; it < maxIter && !converged; it += 1) {
    // Build JᵀJ and Jᵀr at the current point.
    const A = new Float64Array(PARAM_COUNT * PARAM_COUNT);
    const g = new Array<number>(PARAM_COUNT).fill(0);
    for (let i = 0; i < n; i += 1) {
      const d = data[i]!;
      const w = d.err && d.err > 0 ? 1 / d.err : 1;
      modelAndJacobian(d.t, x, jac, i * PARAM_COUNT);
      const r = resid[i]! * w;
      for (let a = 0; a < PARAM_COUNT; a += 1) {
        const ja = jac[i * PARAM_COUNT + a]! * w;
        g[a] = g[a]! + ja * r;
        for (let b = a; b < PARAM_COUNT; b += 1) {
          A[a * PARAM_COUNT + b] = A[a * PARAM_COUNT + b]! + ja * jac[i * PARAM_COUNT + b]! * w;
        }
      }
    }
    for (let a = 0; a < PARAM_COUNT; a += 1) for (let b = 0; b < a; b += 1) A[a * PARAM_COUNT + b] = A[b * PARAM_COUNT + a]!;
    const dx = solve6(A, g, lambda);
    if (!dx) break;
    const trial = clampVector(
      [x[0]! + dx[0]!, x[1]! + dx[1]!, x[2]! + dx[2]!, x[3]! + dx[3]!, x[4]! + dx[4]!, x[5]! + dx[5]!],
      bounds,
      tSpan,
    );
    const next = evaluate(trial);
    if (next.cost < cur.cost) {
      let rel = 0;
      for (let a = 0; a < PARAM_COUNT; a += 1) rel = Math.max(rel, Math.abs(dx[a]!) / Math.max(1e-12, Math.abs(x[a]!)));
      const relCost = cur.cost > 0 ? (cur.cost - next.cost) / cur.cost : 0;
      x = trial;
      cur = next;
      lambda = Math.max(lambda * 0.4, 1e-12);
      // Converged when parameter steps are negligible or the cost has stalled.
      if (rel < 1e-8 || relCost < 1e-14) converged = true;
    } else {
      lambda = Math.min(lambda * 3, 1e9);
      if (lambda >= 1e9) break;
    }
  }

  // Covariance-based 1σ errors.
  const A = new Float64Array(PARAM_COUNT * PARAM_COUNT);
  for (let i = 0; i < n; i += 1) {
    const d = data[i]!;
    const w = d.err && d.err > 0 ? 1 / d.err : 1;
    modelAndJacobian(d.t, x, jac, i * PARAM_COUNT);
    for (let a = 0; a < PARAM_COUNT; a += 1) {
      const ja = jac[i * PARAM_COUNT + a]! * w;
      for (let b = a; b < PARAM_COUNT; b += 1) {
        A[a * PARAM_COUNT + b] = A[a * PARAM_COUNT + b]! + ja * jac[i * PARAM_COUNT + b]! * w;
      }
    }
  }
  for (let a = 0; a < PARAM_COUNT; a += 1) for (let b = 0; b < a; b += 1) A[a * PARAM_COUNT + b] = A[b * PARAM_COUNT + a]!;
  const dof = Math.max(1, n - PARAM_COUNT);
  const inv = invert6(A);
  const scale = cur.cost / dof;
  const sig = (i: number): number => {
    if (!inv) return NaN;
    return Math.sqrt(Math.max(0, inv[i * PARAM_COUNT + i]! * scale));
  };

  return {
    params: { P: x[0]!, T0: x[1]!, delta: x[2]!, T14: x[3]!, T23: x[4]!, baseline: x[5]! },
    sigma: { P: sig(0), T0: sig(1), delta: sig(2), T14: sig(3), T23: sig(4), baseline: sig(5) },
    chi2: cur.cost,
    dof,
    r2: cur.r2,
    rmse: cur.rmse,
    converged,
    iterations: it,
  };
}

// ---- phase folding -----------------------------------------------------------

export interface FoldedPoint {
  /** Phase in [−0.5, 0.5), 0 = mid-transit. */
  phase: number;
  f: number;
  t: number;
}

/** Phase-fold the light curve onto (P, T0). Folding is invariant to T0 + k·P. */
export function phaseFold(data: TransitPoint[], P: number, T0: number): FoldedPoint[] {
  return data.map((d) => ({ phase: phaseWrap(d.t - T0, P) / P, f: d.f, t: d.t }));
}

/** Bin means of folded points over nBins uniform phase bins in [−0.5, 0.5). */
export function binFolded(folded: FoldedPoint[], nBins: number): Array<{ phase: number; mean: number; n: number }> {
  const bins = Array.from({ length: nBins }, (): { sum: number; n: number } => ({ sum: 0, n: 0 }));
  for (const p of folded) {
    let idx = Math.floor((p.phase + 0.5) * nBins);
    if (idx < 0) idx = 0;
    if (idx >= nBins) idx = nBins - 1;
    bins[idx]!.sum += p.f;
    bins[idx]!.n += 1;
  }
  return bins.map((b, i) => ({ phase: (i + 0.5) / nBins - 0.5, mean: b.n > 0 ? b.sum / b.n : NaN, n: b.n }));
}

// ---- embedded validation benchmark -------------------------------------------

export const TRANSIT_BENCHMARK = {
  id: 'trapezoid-recovery-benchmark',
  /** Truth parameters of the seeded synthetic light curve. */
  P: 3.0,
  T0: 0.5,
  delta: 0.01,
  T14: 0.15,
  tau: 0.05,
  baseline: 1.0,
  /** 300 uniform points covering 3 periods. */
  nPoints: 300,
  nPeriods: 3,
  /**
   * Noise: 1% of the transit depth (σ = 1e-4 for δ = 0.01), fixed seed.
   * This keeps the δ recovery threshold (< 10%) statistically meaningful
   * with only ~15 in-transit points.
   */
  noise: 1e-4,
  seed: 20260927,
  /** Acceptance thresholds (unified relative-error convention). */
  maxRelErrP: 0.005,
  maxRelErrDelta: 0.10,
} as const;

export interface TransitBenchmarkResult {
  trueP: number;
  fitP: number;
  trueDelta: number;
  fitDelta: number;
  trueT0: number;
  fitT0: number;
  relErrP: number;
  relErrDelta: number;
  absErrT0: number;
  relErrT14: number;
  r2: number;
  rmse: number;
  detectionScore: number;
  selfConsistency: number;
  passed: boolean;
}

/**
 * Run the embedded benchmark: synthesise the seeded trapezoid light curve,
 * detect the period blind, refine with LM, and return recovery errors under
 * the unified relative-error convention |computed − truth| / |truth|.
 */
export function runTransitBenchmark(): TransitBenchmarkResult | null {
  const b = TRANSIT_BENCHMARK;
  const truth: TrapezoidParams = {
    P: b.P,
    T0: b.T0,
    delta: b.delta,
    T14: b.T14,
    T23: b.T14 - 2 * b.tau,
    baseline: b.baseline,
  };
  const data = synthesizeTransitData(truth, {
    n: b.nPoints,
    tMin: 0,
    tMax: b.nPeriods * b.P,
    noise: b.noise,
    seed: b.seed,
  });
  const det = detectPeriod(data, { pMin: 0.5, pMax: 10, steps: 800 });
  if (!det) return null;
  const fit = fitTransit(
    data,
    {
      P: det.period,
      T0: det.epoch,
      delta: Math.max(det.depth, 1e-6),
      T14: Math.max(1.4 * det.width, 1e-3),
      T23: Math.max(0.6 * det.width, 0),
      baseline: truth.baseline,
    },
    { bounds: { deltaMax: 5 * b.delta, t14Max: 2 * b.T14 } },
  );
  if (!fit) return null;
  const relErrP = Math.abs(fit.params.P - b.P) / b.P;
  const relErrDelta = Math.abs(fit.params.delta - b.delta) / b.delta;
  const selfConsistency = trapezoidSelfConsistency(fit.params);
  return {
    trueP: b.P,
    fitP: fit.params.P,
    trueDelta: b.delta,
    fitDelta: fit.params.delta,
    trueT0: b.T0,
    fitT0: fit.params.T0,
    relErrP,
    relErrDelta,
    absErrT0: Math.abs(phaseWrap(fit.params.T0 - b.T0, b.P)),
    relErrT14: Math.abs(fit.params.T14 - b.T14) / b.T14,
    r2: fit.r2,
    rmse: fit.rmse,
    detectionScore: det.score,
    selfConsistency,
    passed: relErrP < b.maxRelErrP && relErrDelta < b.maxRelErrDelta && selfConsistency < 1e-9,
  };
}
