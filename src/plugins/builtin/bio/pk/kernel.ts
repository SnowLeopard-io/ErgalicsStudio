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
export type PkRoute = 'iv-bolus' | 'oral';

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
 * One-compartment oral (F = 1): C(t) = D·ka/(Vd·(ka−ke))·(e^(−ke·t) − e^(−ka·t)).
 * Returns NaN for the flip-flop degenerate case ka ≈ ke (no closed form here).
 */
export function oneCompOralConc(t: number, dose: number, volume: number, ke: number, ka: number): number {
  const denom = volume * (ka - ke);
  if (Math.abs(denom) < 1e-9) return Number.NaN;
  return ((dose * ka) / denom) * (Math.exp(-ke * t) - Math.exp(-ka * t));
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
export function twoCompOralAmount(t: number, dose: number, ke: number, k12: number, k21: number, ka: number): number {
  const { alpha, beta } = macroRates(ke, k12, k21);
  if (
    Math.abs(alpha - beta) < 1e-9 ||
    Math.abs(ka - alpha) < 1e-9 ||
    Math.abs(ka - beta) < 1e-9
  ) {
    return Number.NaN;
  }
  const c0 = (ka * dose * (k21 - ka)) / ((ka - alpha) * (ka - beta));
  const g = (ka * dose - (alpha - ka) * c0) / (alpha - beta);
  const h = -g - c0;
  return h * Math.exp(-alpha * t) + g * Math.exp(-beta * t) + c0 * Math.exp(-ka * t);
}

// ---- RK4 integration (amount space: y = [A1 central, A2 peripheral, A_gi gut]) ----

function derivatives(y: [number, number, number], p: PkParams): [number, number, number] {
  const [a1, a2, agi] = y;
  const input = p.route === 'oral' ? p.ka * agi : 0;
  if (p.model === 'one-compartment') {
    return [input - p.ke * a1, 0, -p.ka * agi];
  }
  return [
    input - (p.ke + p.k12) * a1 + p.k21 * a2,
    p.k12 * a1 - p.k21 * a2,
    -p.ka * agi,
  ];
}

function rk4Step(y: [number, number, number], dt: number, p: PkParams): [number, number, number] {
  const k1 = derivatives(y, p);
  const k2 = derivatives([y[0] + (dt / 2) * k1[0], y[1] + (dt / 2) * k1[1], y[2] + (dt / 2) * k1[2]], p);
  const k3 = derivatives([y[0] + (dt / 2) * k2[0], y[1] + (dt / 2) * k2[1], y[2] + (dt / 2) * k2[2]], p);
  const k4 = derivatives([y[0] + dt * k3[0], y[1] + dt * k3[1], y[2] + dt * k3[2]], p);
  const adv = (v: number, a: number, b: number, c: number, d: number): number =>
    v + (dt / 6) * (a + 2 * b + 2 * c + d);
  return [
    adv(y[0], k1[0], k2[0], k3[0], k4[0]),
    adv(y[1], k1[1], k2[1], k3[1], k4[1]),
    adv(y[2], k1[2], k2[2], k3[2], k4[2]),
  ];
}

/** Initial amounts: IV bolus dumps D into the central compartment, oral into the gut. */
export function initialAmounts(p: PkParams): [number, number, number] {
  return [p.route === 'iv-bolus' ? p.dose : 0, 0, p.route === 'oral' ? p.dose : 0];
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
    if (i < n) y = rk4Step(y, tMax / n, p);
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
  const aucAnalytic = p.dose / (p.ke * Math.max(p.volume, 1e-9));
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
