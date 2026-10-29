// ==========================================================================
// bio-pk — pharmacokinetic compartment-model numerics (pure, DOM-free)
//
// One- and two-compartment mammillary models with IV bolus and first-order
// oral dosing. ODE integration is classical RK4 in amount space; analytic
// references (mono-exponential, bi-exponential and the absorption
// convolution) drive the embedded validation benchmarks.
//
// Conventions / units: dose mg, volumes L, rates 1/h, concentrations mg/L,
// time h. Bioavailability F = 1 (complete absorption) so the total AUC of
// every route equals D/(ke·Vd) — the mass-conservation anchor of the suite.
// ==========================================================================

export type PkModel = 'one-compartment' | 'two-compartment';
export type PkRoute = 'iv-bolus' | 'iv-infusion' | 'oral';

export interface PkParams {
  model: PkModel;
  route: PkRoute;
  /** Dose D (mg). */
  dose: number;
  /** Apparent volume of distribution Vd — central compartment (L). */
  volume: number;
  /** Elimination rate constant ke (1/h). */
  ke: number;
  /** First-order absorption rate ka (1/h); oral route only. */
  ka: number;
  /** Central → peripheral transfer rate k12 (1/h); two-compartment only. */
  k12: number;
  /** Peripheral → central transfer rate k21 (1/h); two-compartment only. */
  k21: number;
  /**
   * IV infusion duration T_inf (h); `iv-infusion` route only. The dose enters
   * the central compartment at a constant rate D/T_inf over [0, T_inf].
   */
  tInf?: number;
  /**
   * Oral bioavailability F (0 < F ≤ 1); `oral` route only, default 1. Scales
   * the amount reaching the gut so AUC = F·D/(ke·Vd) — the mass anchor
   * generalizes while F = 1 keeps the legacy conservation identity exact.
   */
  f?: number;
}

/**
 * Theophylline-flavoured defaults used for the demo curve (Vd ≈ 0.5 L/kg for
 * a 70 kg adult → 35 L; ke ≈ 0.1 h⁻¹ → t½ ≈ 7 h). Literature-scaled values
 * for demonstration only — see manifest research.notesI18n.
 */
export const DEFAULT_PK_PARAMS: PkParams = {
  model: 'one-compartment',
  route: 'iv-bolus',
  dose: 400,
  volume: 35,
  ke: 0.1,
  ka: 1.5,
  k12: 0.4,
  k21: 0.25,
};

export interface PkSeries {
  times: number[];
  /** Central-compartment concentration C(t) (mg/L). */
  concentration: number[];
  /** Peripheral-compartment amount A2(t) (mg); zeros for one-compartment. */
  peripheral: number[];
  /** Gut amount A_gi(t) (mg); zeros for IV bolus. */
  gut: number[];
}

// ---- analytic references ---------------------------------------------------

/** One-compartment IV bolus: C(t) = (D/Vd)·e^(−ke·t). */
export function oneCompIvConc(t: number, dose: number, volume: number, ke: number): number {
  return (dose / volume) * Math.exp(-ke * t);
}

/**
 * One-compartment oral (F defaults to 1): C(t) = F·D·ka/(Vd·(ka−ke))·(e^(−ke·t) − e^(−ka·t)).
 * Returns NaN for the flip-flop degenerate case ka ≈ ke (no closed form here).
 */
export function oneCompOralConc(
  t: number,
  dose: number,
  volume: number,
  ke: number,
  ka: number,
  f = 1,
): number {
  const denom = volume * (ka - ke);
  if (Math.abs(denom) < 1e-9) return Number.NaN;
  return ((f * dose * ka) / denom) * (Math.exp(-ke * t) - Math.exp(-ka * t));
}

/**
 * One-compartment constant-rate IV infusion over [0, T_inf]:
 *   C(t) = R/(ke·Vd)·(1 − e^(−ke·t))              for t ≤ T_inf
 *   C(t) = C(T_inf)·e^(−ke·(t − T_inf))            for t >  T_inf
 * with input rate R = D/T_inf. Returns NaN when ke ≤ 0.
 */
export function oneCompInfusionConc(
  t: number,
  dose: number,
  volume: number,
  ke: number,
  tInf: number,
): number {
  if (!(ke > 0) || !(tInf > 0)) return Number.NaN;
  const rate = dose / tInf;
  const cEnd = (rate / (ke * volume)) * (1 - Math.exp(-ke * tInf));
  if (t <= tInf) return (rate / (ke * volume)) * (1 - Math.exp(-ke * t));
  return cEnd * Math.exp(-ke * (t - tInf));
}

/** Two-compartment macro (hybrid) rates: α+β = ke+k12+k21, α·β = ke·k21. */
export function macroRates(ke: number, k12: number, k21: number): { alpha: number; beta: number } {
  const s = ke + k12 + k21;
  const disc = Math.sqrt(Math.max(s * s - 4 * ke * k21, 0));
  return { alpha: (s + disc) / 2, beta: (s - disc) / 2 };
}

/** Two-compartment IV bolus central amount (mg): A1(t) = A·e^(−αt) + B·e^(−βt). */
export function twoCompIvAmount(t: number, dose: number, ke: number, k12: number, k21: number): number {
  const { alpha, beta } = macroRates(ke, k12, k21);
  const span = alpha - beta;
  if (span < 1e-12) return Number.NaN;
  return dose * (((alpha - k21) / span) * Math.exp(-alpha * t) + ((k21 - beta) / span) * Math.exp(-beta * t));
}

/**
 * Two-compartment oral central amount (mg): tri-exponential convolution of the
 * first-order gut input with the bi-exponential impulse response.
 * Returns NaN when ka coincides with α or β (coincident poles).
 */
export function twoCompOralAmount(
  t: number,
  dose: number,
  ke: number,
  k12: number,
  k21: number,
  ka: number,
  f = 1,
): number {
  const { alpha, beta } = macroRates(ke, k12, k21);
  if (
    Math.abs(alpha - beta) < 1e-9 ||
    Math.abs(ka - alpha) < 1e-9 ||
    Math.abs(ka - beta) < 1e-9
  ) {
    return Number.NaN;
  }
  const kaDose = f * ka * dose;
  const c0 = (kaDose * (k21 - ka)) / ((ka - alpha) * (ka - beta));
  const g = (kaDose - (alpha - ka) * c0) / (alpha - beta);
  const h = -g - c0;
  return h * Math.exp(-alpha * t) + g * Math.exp(-beta * t) + c0 * Math.exp(-ka * t);
}

// ---- RK4 integration (amount space: y = [A1 central, A2 peripheral, A_gi gut]) ----

function derivatives(y: [number, number, number], t: number, p: PkParams): [number, number, number] {
  const [a1, a2, agi] = y;
  let input = 0;
  if (p.route === 'oral') input = p.ka * agi;
  else if (p.route === 'iv-infusion' && t < (p.tInf ?? 0)) input = p.dose / Math.max(p.tInf ?? 0, 1e-9);
  if (p.model === 'one-compartment') {
    return [input - p.ke * a1, 0, -p.ka * agi];
  }
  return [
    input - (p.ke + p.k12) * a1 + p.k21 * a2,
    p.k12 * a1 - p.k21 * a2,
    -p.ka * agi,
  ];
}

function rk4Step(y: [number, number, number], dt: number, t: number, p: PkParams): [number, number, number] {
  const k1 = derivatives(y, t, p);
  const k2 = derivatives([y[0] + (dt / 2) * k1[0], y[1] + (dt / 2) * k1[1], y[2] + (dt / 2) * k1[2]], t + dt / 2, p);
  const k3 = derivatives([y[0] + (dt / 2) * k2[0], y[1] + (dt / 2) * k2[1], y[2] + (dt / 2) * k2[2]], t + dt / 2, p);
  const k4 = derivatives([y[0] + dt * k3[0], y[1] + dt * k3[1], y[2] + dt * k3[2]], t + dt, p);
  const adv = (v: number, a: number, b: number, c: number, d: number): number =>
    v + (dt / 6) * (a + 2 * b + 2 * c + d);
  return [
    adv(y[0], k1[0], k2[0], k3[0], k4[0]),
    adv(y[1], k1[1], k2[1], k3[1], k4[1]),
    adv(y[2], k1[2], k2[2], k3[2], k4[2]),
  ];
}

/** Initial amounts: IV bolus dumps D into the central compartment, oral dumps F·D into the gut. */
export function initialAmounts(p: PkParams): [number, number, number] {
  if (p.route === 'iv-bolus') return [p.dose, 0, 0];
  if (p.route === 'iv-infusion') return [0, 0, 0];
  return [0, 0, (p.f ?? 1) * p.dose];
}

/** Integrate the chosen model on a uniform grid of ~nPoints samples. */
export function simulatePk(p: PkParams, tMax: number, dt: number): PkSeries {
  const n = Math.max(2, Math.round(tMax / Math.max(dt, 1e-6)));
  const times: number[] = [];
  const concentration: number[] = [];
  const peripheral: number[] = [];
  const gut: number[] = [];
  let y = initialAmounts(p);
  for (let i = 0; i <= n; i += 1) {
    const t = (i * tMax) / n;
    times.push(t);
    concentration.push(y[0] / Math.max(p.volume, 1e-9));
    peripheral.push(p.model === 'two-compartment' ? y[1] : 0);
    gut.push(p.route === 'oral' ? y[2] : 0);
    if (i < n) y = rk4Step(y, tMax / n, t, p);
  }
  return { times, concentration, peripheral, gut };
}

// ---- summary metrics ---------------------------------------------------------

/** Slowest exponential rate governing the terminal phase (β for two-compartment). */
export function terminalSlope(p: PkParams): number {
  if (p.model === 'two-compartment') {
    const { beta } = macroRates(p.ke, p.k12, p.k21);
    return beta;
  }
  return p.route === 'oral' ? Math.min(p.ke, p.ka) : p.ke;
}

/** Terminal half-life t½ = ln2/λz (h); β phase for the two-compartment model. */
export function halfLifeHours(p: PkParams): number {
  const lambda = terminalSlope(p);
  return lambda > 0 ? Math.LN2 / lambda : Number.NaN;
}

export interface PkMetrics {
  /** Peak concentration Cmax (mg/L). */
  cmax: number;
  /** Time of peak Tmax (h). */
  tmax: number;
  /** Terminal half-life (h). */
  halfLife: number;
  /** AUC by trapezoidal integration + tail correction (mg·h/L). */
  aucNumeric: number;
  /** Analytic AUC = D/(ke·Vd) (mg·h/L), F = 1. */
  aucAnalytic: number;
  /** |AUC_num − AUC_analytic| / AUC_analytic. */
  aucRelErr: number;
}

/**
 * Trapezoidal AUC on the sampled curve plus an exponential tail correction
 * C(t_end)/λz, benchmarked against the exact D/(ke·Vd).
 */
export function computePkMetrics(p: PkParams, tMax: number, dt: number): PkMetrics {
  const s = simulatePk(p, tMax, dt);
  let cmax = 0;
  let tmax = 0;
  for (let i = 0; i < s.times.length; i += 1) {
    const c = s.concentration[i]!;
    if (c > cmax) {
      cmax = c;
      tmax = s.times[i]!;
    }
  }
  let auc = 0;
  for (let i = 1; i < s.times.length; i += 1) {
    const dtI = s.times[i]! - s.times[i - 1]!;
    auc += ((s.concentration[i - 1]! + s.concentration[i]!) / 2) * dtI;
  }
  const lastC = s.concentration[s.concentration.length - 1]!;
  auc += lastC / terminalSlope(p);
  const aucAnalytic = ((p.f ?? 1) * p.dose) / (p.ke * Math.max(p.volume, 1e-9));
  return {
    cmax,
    tmax,
    halfLife: halfLifeHours(p),
    aucNumeric: auc,
    aucAnalytic,
    aucRelErr: Math.abs(auc - aucAnalytic) / aucAnalytic,
  };
}

// ---- embedded validation benchmarks ------------------------------------------

export interface PkBenchmarkCase {
  key: string;
  /** Human-readable case label (en). */
  label: string;
  /** Maximum relative error |numeric − analytic| / |analytic| over the grid. */
  relErr: number;
  tolerance: number;
}

export interface PkBenchmark {
  cases: PkBenchmarkCase[];
  allPassed: boolean;
}

function relErrOf(a: number, b: number): number {
  // Guard the t=0 oral case where both numeric and analytic are exactly 0.
  if (b === 0) return a === 0 ? 0 : Math.abs(a);
  return Math.abs(a - b) / Math.abs(b);
}

/**
 * RK4 vs closed forms on one parameter set:
 *  - one-compartment IV vs mono-exponential (tol 1e-4, spec)
 *  - one-compartment oral vs absorption convolution
 *  - two-compartment IV vs bi-exponential (tol 1e-3, spec)
 *  - two-compartment oral vs tri-exponential convolution
 *  - AUC trapezoid + tail vs D/(ke·Vd) (tol 1 %, spec)
 */
export function runPkBenchmarks(dt = 0.002): PkBenchmark {
  const base = DEFAULT_PK_PARAMS;
  const tMax = 48;
  const cases: PkBenchmarkCase[] = [];

  const maxErr = (conc: number[], ref: (t: number) => number): number => {
    let worst = 0;
    for (let i = 0; i < conc.length; i += 1) {
      const r = ref(i * dt);
      if (!Number.isFinite(r)) continue;
      worst = Math.max(worst, relErrOf(conc[i]!, r));
    }
    return worst;
  };

  const oneIv = simulatePk({ ...base, model: 'one-compartment', route: 'iv-bolus' }, tMax, dt);
  cases.push({
    key: 'one-iv',
    label: 'One-compartment IV vs C0·e^(−ke·t)',
    relErr: maxErr(oneIv.concentration, (t) => oneCompIvConc(t, base.dose, base.volume, base.ke)),
    tolerance: 1e-4,
  });

  const oneOral = simulatePk({ ...base, model: 'one-compartment', route: 'oral' }, tMax, dt);
  cases.push({
    key: 'one-oral',
    label: 'One-compartment oral vs Bateman function',
    relErr: maxErr(oneOral.concentration, (t) =>
      oneCompOralConc(t, base.dose, base.volume, base.ke, base.ka),
    ),
    tolerance: 1e-4,
  });

  const twoIv = simulatePk({ ...base, model: 'two-compartment', route: 'iv-bolus' }, tMax, dt);
  cases.push({
    key: 'two-iv',
    label: 'Two-compartment IV vs bi-exponential',
    relErr: maxErr(twoIv.concentration, (t) =>
      twoCompIvAmount(t, base.dose, base.ke, base.k12, base.k21) / base.volume,
    ),
    tolerance: 1e-3,
  });

  const twoOral = simulatePk({ ...base, model: 'two-compartment', route: 'oral' }, tMax, dt);
  cases.push({
    key: 'two-oral',
    label: 'Two-compartment oral vs tri-exponential',
    relErr: maxErr(twoOral.concentration, (t) =>
      twoCompOralAmount(t, base.dose, base.ke, base.k12, base.k21, base.ka) / base.volume,
    ),
    tolerance: 1e-3,
  });

  // Mass conservation: trapezoidal AUC (+ exponential tail) vs D/(ke·Vd) over
  // ~12 elimination half-lives so the truncation tail is tiny.
  const aucT = 120;
  const m = computePkMetrics({ ...base, model: 'one-compartment', route: 'iv-bolus' }, aucT, 0.01);
  cases.push({
    key: 'auc',
    label: 'AUC trapezoid + tail vs D/(ke·Vd)',
    relErr: m.aucRelErr,
    tolerance: 0.01,
  });

  return { cases, allPassed: cases.every((c) => c.relErr < c.tolerance) };
}

// ===========================================================================
// Clinical extensions (backward-compatible additions):
//   1. single-dose closed forms unified  -> superposition steady state
//   2. dose optimization / TDM           -> trough & AUC targets, LS fit
//   3. population PK                     -> seeded lognormal Monte Carlo
//   4. pharmacodynamics                  -> (sigmoid-)Emax effect model
//   5. drug-drug interaction             -> CL multiplier scaling
// ===========================================================================

/** Closed-form single-dose central concentration C(t) for any model/route, or null for degenerate poles. */
export function singleDoseConcAt(p: PkParams): ((u: number) => number) | null {
  const f = p.f ?? 1;
  if (p.model === 'one-compartment') {
    if (p.route === 'iv-bolus') return (u) => oneCompIvConc(u, p.dose, p.volume, p.ke);
    if (p.route === 'iv-infusion') return (u) => oneCompInfusionConc(u, p.dose, p.volume, p.ke, p.tInf ?? 0);
    return (u) => oneCompOralConc(u, p.dose, p.volume, p.ke, p.ka, f);
  }
  if (p.route === 'iv-bolus') {
    return (u) => twoCompIvAmount(u, p.dose, p.ke, p.k12, p.k21) / p.volume;
  }
  if (p.route === 'iv-infusion') return null; // no compact closed form; RK4 covers it
  return (u) => twoCompOralAmount(u, p.dose, p.ke, p.k12, p.k21, p.ka, f) / p.volume;
}

/**
 * Steady-state concentration at time t ∈ [0, τ) after the latest dose, by
 * linear superposition: C_ss(t) = Σ_{k≥0} C1(t + k·τ). The sum is truncated
 * once the trailing term falls below 1e-15 of the accumulated total (or after
 * maxTerms terms). Exact for linear kinetics; independent of the route.
 */
export function steadyStateConc(p: PkParams, tau: number, t: number, maxTerms = 4000): number {
  const single = singleDoseConcAt(p);
  if (!single || !(tau > 0)) return Number.NaN;
  let sum = 0;
  for (let k = 0; k < maxTerms; k += 1) {
    const c = single(t + k * tau);
    if (!Number.isFinite(c)) return Number.NaN;
    sum += c;
    if (k > 0 && c <= sum * 1e-15) break;
  }
  return sum;
}

/** Steady-state trough: limit of C_ss as t → τ⁻ (just before the next dose). */
export function steadyStateTrough(p: PkParams, tau: number, maxTerms = 4000): number {
  return steadyStateConc(p, tau, tau * (1 - 1e-9), maxTerms);
}

/** Steady-state peak: maximum of C_ss sampled on a fine grid over one interval. */
export function steadyStatePeak(p: PkParams, tau: number, steps = 400): number {
  let peak = 0;
  for (let i = 0; i <= steps; i += 1) {
    const c = steadyStateConc(p, tau, (tau * i) / steps, 4000);
    if (Number.isFinite(c) && c > peak) peak = c;
  }
  return peak;
}

/**
 * Steady-state AUC over one dosing interval. For linear mamillary models the
 * central-compartment AUC0-τ,ss equals the single-dose AUC0-∞ = F·D/(ke·V1)
 * (the ke·k21 identity of the bi-exponential makes this exact for two
 * compartments as well), so the analytic value is returned directly.
 */
export function steadyStateAuc(p: PkParams, _tau: number): number {
  return ((p.f ?? 1) * p.dose) / (p.ke * Math.max(p.volume, 1e-9));
}

/**
 * Dose achieving a target steady-state trough. C_ss is linear in D, so the
 * per-mg trough is computed once with a unit dose and scaled exactly.
 */
export function solveDoseForTrough(p: PkParams, tau: number, targetTrough: number): number {
  const unit: PkParams = { ...p, dose: 1 };
  const per = steadyStateTrough(unit, tau);
  return Number.isFinite(per) && per > 0 ? targetTrough / per : Number.NaN;
}

/** Dose achieving a target steady-state AUC0-τ: D = AUC_target·CL/F with CL = ke·V1. */
export function solveDoseForAuc(p: PkParams, targetAuc: number): number {
  return (targetAuc * p.ke * Math.max(p.volume, 1e-9)) / (p.f ?? 1);
}

/** Scale ke (i.e. CL) by a DDI factor: inhibitor 0.25, inducer 2.5, none 1. */
export function ddiScaledParams(p: PkParams, clFactor: number): PkParams {
  return { ...p, ke: p.ke * clFactor };
}

// ---- population PK: seeded lognormal Monte Carlo -----------------------------

/** Deterministic mulberry32 PRNG (32-bit, fixed seed → reproducible panels). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mean-1 lognormal multiplier for a given coefficient of variation:
 * exp(σ·z − σ²/2), σ² = ln(1 + CV²), z ~ N(0,1) via Box–Muller. E[m] = 1 so
 * the sampled population keeps the panel's mean parameters.
 */
export function lognormalFactor(rng: () => number, cv: number): number {
  const c = Math.max(cv, 0);
  const sigma = Math.sqrt(Math.log(1 + c * c));
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(sigma * z - (sigma * sigma) / 2);
}

/** Quantile of an ascending-sorted sample (linear interpolation). */
export function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface PopulationOptions {
  /** Number of virtual individuals (default 100). */
  n: number;
  /** Inter-individual CV (fraction, e.g. 0.3) of clearance CL = ke·V. */
  cvCl: number;
  /** Inter-individual CV of central volume V. */
  cvV: number;
  /** Fixed PRNG seed for reproducibility. */
  seed: number;
  /** Simulated span (h). */
  tMax: number;
  /** Grid size of the returned quantile curves (default 240). */
  gridPoints?: number;
}

export interface PopulationResult {
  times: number[];
  p5: number[];
  p50: number[];
  p95: number[];
  /** Per-individual summary metrics (parallel to the sampled population). */
  individuals: Array<{ cmax: number; auc: number; halfLife: number }>;
}

/**
 * Monte-Carlo population profile: CL and V are drawn lognormally (mean fixed
 * by the panel parameters, ke_i = CL_i/V_i) with a fixed seed; every individual
 * is integrated with the same RK4 kernel and per-time P5/P50/P95 quantiles
 * are extracted to draw the variability band.
 */
export function simulatePopulationPk(base: PkParams, opts: PopulationOptions): PopulationResult {
  const n = Math.max(2, Math.round(opts.n));
  const grid = Math.max(24, Math.round(opts.gridPoints ?? 240));
  const dt = opts.tMax / grid;
  const rng = mulberry32(opts.seed);
  const clBase = base.ke * base.volume;
  const samples: number[][] = [];
  const individuals: PopulationResult['individuals'] = [];
  for (let i = 0; i < n; i += 1) {
    const cl = clBase * lognormalFactor(rng, opts.cvCl);
    const v = base.volume * lognormalFactor(rng, opts.cvV);
    const ind: PkParams = { ...base, ke: cl / Math.max(v, 1e-9), volume: v };
    const s = simulatePk(ind, opts.tMax, dt);
    samples.push(s.concentration);
    const auc = (ind.ke * ind.volume > 0) ? (base.f ?? 1) * base.dose / (ind.ke * ind.volume) : Number.NaN;
    individuals.push({ cmax: Math.max(...s.concentration), auc, halfLife: halfLifeHours(ind) });
  }
  const times = Array.from({ length: grid + 1 }, (_, i) => i * dt);
  const p5: number[] = [];
  const p50: number[] = [];
  const p95: number[] = [];
  const col: number[] = new Array(n);
  for (let j = 0; j <= grid; j += 1) {
    for (let i = 0; i < n; i += 1) col[i] = samples[i]![j]!;
    col.sort((a, b) => a - b);
    p5.push(quantileSorted(col, 0.05));
    p50.push(quantileSorted(col, 0.5));
    p95.push(quantileSorted(col, 0.95));
  }
  return { times, p5, p50, p95, individuals };
}

// ---- pharmacodynamics: (sigmoid-)Emax effect model ---------------------------

export interface PdParams {
  /** Maximum effect (drug-induced increment over baseline). */
  emax: number;
  /** Concentration producing half of Emax (mg/L). */
  ec50: number;
  /** Hill (sigmoidicity) coefficient; 1 reduces to the plain Emax model. */
  hill: number;
  /** Baseline effect E0 (no drug). */
  e0: number;
}

/**
 * Sigmoid-Emax: E(C) = E0 + Emax·C^h/(EC50^h + C^h). Boundaries: E(0) = E0,
 * C → ∞ gives E0 + Emax, and E(EC50) = E0 + Emax/2 for any h > 0.
 */
export function emaxEffect(conc: number, pd: PdParams): number {
  const c = Math.max(conc, 0);
  const h = pd.hill > 0 ? pd.hill : 1;
  const ch = Math.pow(c, h);
  const e50 = Math.pow(pd.ec50, h);
  return pd.e0 + (pd.emax * ch) / (e50 + ch);
}

// ---- TDM: one-compartment individual CL/V least-squares fit -------------------

export interface TdmObservation {
  t: number;
  c: number;
  /** Optional subject tag (multi-subject CSV); fit uses one subject at a time. */
  subject?: string;
}

export interface TdmFitResult {
  /** Fitted clearance CL = ke·V (L/h). */
  cl: number;
  /** Fitted central volume V (L). */
  v: number;
  /** Fitted elimination rate ke (1/h). */
  ke: number;
  /** Fitted absorption rate ka (1/h); oral route only, otherwise the fixed input. */
  ka: number;
  /** Residual sum of squares over the observations. */
  sse: number;
  /** Root-mean-square residual (mg/L). */
  rmse: number;
  /** Coefficient of determination R² of the fit. */
  r2: number;
  /** True when the optimizer met its tolerance. */
  converged: boolean;
}

/** One-compartment model prediction used by the TDM fitter (route-aware, F-aware). */
function tdmModelConc(
  t: number,
  route: 'iv-bolus' | 'iv-infusion' | 'oral',
  dose: number,
  ke: number,
  v: number,
  ka: number,
  f: number,
  tInf: number,
): number {
  if (route === 'iv-bolus') return oneCompIvConc(t, dose, v, ke);
  if (route === 'iv-infusion') return oneCompInfusionConc(t, dose, v, ke, tInf);
  return oneCompOralConc(t, dose, v, ke, ka, f);
}

/**
 * Nelder–Mead simplex minimization over x ∈ R^d (unconstrained; the objective
 * returns Infinity outside the feasible box). Compact, derivative-free, and
 * sufficient for 2–3 TDM parameters.
 */
function nelderMead(
  x0: number[],
  objective: (x: number[]) => number,
  maxIter = 1200,
): { x: number[]; fx: number; converged: boolean } {
  const d = x0.length;
  const simplex: number[][] = [x0.slice()];
  const step = 0.12;
  for (let i = 0; i < d; i += 1) {
    const p = x0.slice();
    p[i] = x0[i]! + (x0[i] !== 0 ? x0[i]! * step : step);
    simplex.push(p);
  }
  const fx = simplex.map(objective);
  const order = () => simplex.map((_, i) => i).sort((a, b) => fx[a]! - fx[b]!);
  let converged = false;
  for (let iter = 0; iter < maxIter && !converged; iter += 1) {
    const idx = order();
    const best = idx[0]!;
    const worst = idx[d]!;
    const spread = Math.abs(fx[worst]! - fx[best]!);
    const scale = Math.max(Math.abs(fx[best]!), 1e-12);
    if (spread <= 1e-12 * scale) {
      converged = true;
      break;
    }
    const centroid = new Array<number>(d).fill(0);
    for (const i of idx) if (i !== worst) for (let j = 0; j < d; j += 1) centroid[j]! += simplex[i]![j]! / (d);
    const reflect = (coef: number): { x: number[]; fx: number } => {
      const x = centroid.map((c, j) => c + coef * (c - simplex[worst]![j]!));
      return { x, fx: objective(x) };
    };
    const xr = reflect(1);
    if (xr.fx < fx[best]!) {
      const xe = reflect(2);
      if (xe.fx < xr.fx) {
        simplex[worst] = xe.x;
        fx[worst] = xe.fx;
      } else {
        simplex[worst] = xr.x;
        fx[worst] = xr.fx;
      }
    } else if (xr.fx < fx[idx[d - 1]!]!) {
      simplex[worst] = xr.x;
      fx[worst] = xr.fx;
    } else {
      const xc = reflect(xr.fx < fx[worst]! ? 0.5 : -0.5);
      if (xc.fx < (xr.fx < fx[worst]! ? fx[worst]! : fx[idx[d - 1]!]!)) {
        simplex[worst] = xc.x;
        fx[worst] = xc.fx;
      } else {
        for (const i of idx) {
          if (i === best) continue;
          for (let j = 0; j < d; j += 1) simplex[i]![j] = simplex[best]![j]! + 0.5 * (simplex[i]![j]! - simplex[best]![j]!);
          fx[i] = objective(simplex[i]!);
        }
      }
    }
  }
  const idx2 = order();
  const bi = idx2[0]!;
  return { x: simplex[bi]!, fx: fx[bi]!, converged };
}

/**
 * Fit individual CL/V (one-compartment) to observed concentrations by ordinary
 * least squares on C. Parameters optimized: (ln ke, ln V) for IV routes and
 * (ln ke, ln V, ln ka) for oral; F is taken as fixed from the panel.
 * Initial guesses come from a log-linear terminal-phase regression.
 */
export function fitTdmOneComp(
  obs: TdmObservation[],
  route: PkRoute,
  dose: number,
  f: number,
  kaFixed: number,
  tInf: number,
): TdmFitResult | null {
  const valid = obs.filter((o) => Number.isFinite(o.t) && Number.isFinite(o.c) && o.t > 0 && o.c > 0);
  if (valid.length < 3) return null;
  // Log-linear regression on the last third of the (time-ordered) data seeds ke.
  const sorted = valid.slice().sort((a, b) => a.t - b.t);
  const tail = sorted.slice(Math.max(1, Math.floor(sorted.length * 0.6)));
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const o of tail) {
    const x = o.t;
    const y = Math.log(o.c);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const m = tail.length;
  const slope = m > 1 && sxx - (sx * sx) / m !== 0 ? (sxy - (sx * sy) / m) / (sxx - (sx * sx) / m) : -0.1;
  const ke0 = Math.min(-slope, 2);
  const cAt = sorted[0]!.c;
  const v0 = Math.max(cAt > 0 ? dose / cAt : dose / 10, dose / 100);
  const fitRoute = route === 'oral' ? 'oral' : route === 'iv-infusion' ? 'iv-infusion' : 'iv-bolus';
  const objective = (x: number[]): number => {
    const ke = Math.exp(x[0]!);
    const v = Math.exp(x[1]!);
    const ka = fitRoute === 'oral' ? Math.exp(x[2]!) : kaFixed;
    if (!(ke > 1e-6 && ke < 10) || !(v > 0.1 && v < 1e5)) return Number.POSITIVE_INFINITY;
    if (fitRoute === 'oral' && Math.abs(ka - ke) < 1e-6) return Number.POSITIVE_INFINITY;
    let sse = 0;
    for (const o of valid) {
      const pred = tdmModelConc(o.t, fitRoute, dose, ke, v, ka, f, tInf);
      if (!Number.isFinite(pred)) return Number.POSITIVE_INFINITY;
      const r = pred - o.c;
      sse += r * r;
    }
    return Number.isFinite(sse) ? sse : Number.POSITIVE_INFINITY;
  };
  const x0 = fitRoute === 'oral' ? [Math.log(Math.max(ke0, 1e-3)), Math.log(v0), Math.log(Math.max(2 * ke0, 0.2))] : [Math.log(Math.max(ke0, 1e-3)), Math.log(v0)];
  const res = nelderMead(x0, objective);
  const ke = Math.exp(res.x[0]!);
  const v = Math.exp(res.x[1]!);
  if (!Number.isFinite(ke) || !Number.isFinite(v) || v <= 0) return null;
  const ka = fitRoute === 'oral' ? Math.exp(res.x[2]!) : kaFixed;
  const predMean = valid.reduce((s, o) => s + o.c, 0) / valid.length;
  const ssTot = valid.reduce((s, o) => s + (o.c - predMean) * (o.c - predMean), 0);
  return {
    cl: ke * v,
    v,
    ke,
    ka,
    sse: res.fx,
    rmse: Math.sqrt(res.fx / valid.length),
    r2: ssTot > 0 ? 1 - res.fx / ssTot : Number.NaN,
    converged: res.converged,
  };
}
