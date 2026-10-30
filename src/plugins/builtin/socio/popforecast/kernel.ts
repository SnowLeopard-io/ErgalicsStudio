// ==========================================================================
// socio-popforecast — Leslie matrix population projection (pure, testable)
//
// Classic age-classified demographic projection (Leslie 1945): the k age
// classes share a common width (80 / k years). The Leslie matrix carries
// per-class fertility rates on the first row and per-class survival rates
// on the subdiagonal; each yearly step is n(t+1) = L n(t) + m with an
// optional net-migration vector m. Growth rate is the dominant eigenvalue
// of L via power iteration with a FIXED iteration count; age-structure
// indicators (dependency ratio, median age, 65+ share) follow the UN
// convention. All functions are pure — no canvas, no DOM.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

/** Fertility scenario applied as a multiplier on the base schedule. */
export type FertilityScenario = 'high' | 'medium' | 'low';

export const SCENARIO_MULTIPLIER: Record<FertilityScenario, number> = {
  high: 1.25,
  medium: 1,
  low: 0.75,
};

/** Total age span covered by the classes, in years. */
export const AGE_SPAN = 80;

/** UN 65+ aging convention thresholds (fraction of population aged 65+). */
export const AGING_YOUNG_MAX = 0.07;
export const AGING_AGED_MIN = 0.14;

export interface PopForecastParams {
  /** Number of age classes (8, 10 or 16; class width = 80 / classes). */
  classes: number;
  /** Multiplier on the standard fertility schedule (1 = reference). */
  baseFertility: number;
  /** Multiplier on the standard survival schedule (1 = reference). */
  survivalScale: number;
  /** Fertility scenario multiplier (high / medium / low). */
  scenario: FertilityScenario;
  /** Total net migrants per year, distributed uniformly across classes. */
  migrationPerYear: number;
  /** Projection horizon in years. */
  years: number;
  /** Seed for the initial age distribution jitter (full determinism). */
  seed: number;
}

export const DEFAULT_POP_PARAMS: PopForecastParams = {
  classes: 16,
  baseFertility: 1,
  survivalScale: 1,
  scenario: 'medium',
  migrationPerYear: 0,
  years: 120,
  seed: 20260922,
};

// ---- standard schedules -----------------------------------------------------
//
// Hand-coded reference schedules over an 80-year span. Fertility entries are
// per-period daughter-birth rates summing to ~1.075 (near-replacement, so the
// medium scenario is roughly stationary and the high/low scenarios bracket
// growth and decline). Survival entries are the per-period survival
// probabilities; the oldest class has no survival (everyone eventually exits).

const FERTILITY_8 = [0.0, 0.088, 0.732, 0.228, 0.0255, 0.0011, 0, 0];
const SURVIVAL_8 = [0.988, 0.998, 0.997, 0.994, 0.984, 0.955, 0.87];

const FERTILITY_10 = [0.0, 0.0345, 0.473, 0.408, 0.134, 0.0251, 0.0013, 0, 0, 0];
const SURVIVAL_10 = [0.99, 0.998, 0.998, 0.997, 0.995, 0.99, 0.975, 0.935, 0.82];

const FERTILITY_16 = [
  0.0, 0.0046, 0.1431, 0.3463, 0.3102, 0.1825, 0.069, 0.017, 0.0023, 0, 0, 0, 0, 0, 0, 0,
];
const SURVIVAL_16 = [
  0.993, 0.998, 0.9985, 0.9985, 0.998, 0.997, 0.9955, 0.993, 0.989, 0.982, 0.97, 0.95, 0.915, 0.855, 0.74,
];

/**
 * Standard fertility schedule for `k` classes (width 80/k). Known schedules
 * are used verbatim for k = 8/10/16; any other class count is resampled from
 * the 16-class schedule at the band midpoints.
 */
export function fertilitySchedule(k: number): number[] {
  if (k === 8) return FERTILITY_8.slice();
  if (k === 10) return FERTILITY_10.slice();
  if (k === 16) return FERTILITY_16.slice();
  return resample(FERTILITY_16, k);
}

/** Standard survival schedule (k-1 entries: class i -> class i+1). */
export function survivalSchedule(k: number): number[] {
  if (k === 8) return SURVIVAL_8.slice();
  if (k === 10) return SURVIVAL_10.slice();
  if (k === 16) return SURVIVAL_16.slice();
  return resample(SURVIVAL_16, k - 1);
}

/** Resample a schedule onto a different number of equal 80-year bands. */
function resample(base: number[], k: number): number[] {
  const width = AGE_SPAN / k;
  const baseWidth = AGE_SPAN / base.length;
  const out: number[] = [];
  for (let i = 0; i < k; i += 1) {
    const mid = (i + 0.5) * width;
    out.push(base[Math.min(base.length - 1, Math.max(0, Math.floor(mid / baseWidth)))] ?? 0);
  }
  return out;
}

// ---- Leslie matrix ------------------------------------------------------------

/**
 * Build the k x k Leslie matrix (row-major array of rows) from per-class
 * fertility rates f_i (first row) and survival rates s_i (subdiagonal,
 * s_i moves class i into class i+1). The last class has no exit survival.
 */
export function buildLeslie(fertility: number[], survival: number[]): number[][] {
  const k = fertility.length;
  const L: number[][] = [];
  for (let i = 0; i < k; i += 1) L.push(new Array<number>(k).fill(0));
  for (let j = 0; j < k; j += 1) {
    L[0]![j] = Math.max(0, fertility[j] ?? 0);
  }
  for (let i = 1; i < k; i += 1) {
    L[i]![i - 1] = Math.max(0, Math.min(1, survival[i - 1] ?? 0));
  }
  return L;
}

/**
 * Assemble the full model matrix for the given parameters: standard schedule
 * scaled by the fertility multipliers (base x scenario) and the survival
 * scale, clamped to [0, 0.9995] so the oldest class can never persist.
 */
export function buildLeslieMatrix(p: PopForecastParams): number[][] {
  const scen = SCENARIO_MULTIPLIER[p.scenario] ?? 1;
  const fertility = fertilitySchedule(p.classes).map((f) => Math.max(0, f * p.baseFertility * scen));
  const survival = survivalSchedule(p.classes).map((s) => Math.max(0, Math.min(0.9995, s * p.survivalScale)));
  return buildLeslie(fertility, survival);
}

/** Matrix-vector product for a row-major square matrix. */
export function matVec(L: number[][], v: number[]): number[] {
  const k = L.length;
  const out = new Array<number>(k).fill(0);
  for (let i = 0; i < k; i += 1) {
    const row = L[i] ?? [];
    let s = 0;
    for (let j = 0; j < k; j += 1) s += (row[j] ?? 0) * (v[j] ?? 0);
    out[i] = s;
  }
  return out;
}

// ---- projection ------------------------------------------------------------------

/**
 * Project the age vector for `years` yearly steps, n(t+1) = L n(t) + m.
 * Returns `years + 1` rows; row 0 is a copy of `n0`. The migration vector
 * (same length as `n0`) is added after each step, so migrants age and
 * reproduce in subsequent steps.
 */
export function project(L: number[][], n0: number[], years: number, migration?: number[]): number[][] {
  const k = L.length;
  const rows: number[][] = [n0.slice(0, k)];
  let n = n0.slice(0, k);
  for (let t = 1; t <= years; t += 1) {
    const next = matVec(L, n);
    if (migration) {
      for (let i = 0; i < k; i += 1) next[i] = (next[i] ?? 0) + (migration[i] ?? 0);
    }
    rows.push(next);
    n = next;
  }
  return rows;
}

/** Total population of an age vector. */
export function totalPopulation(n: number[]): number {
  let s = 0;
  for (let i = 0; i < n.length; i += 1) s += n[i] ?? 0;
  return s;
}

// ---- dominant eigenvalue (power iteration, fixed iterations) -----------------------

export interface EigenPair {
  /** Dominant eigenvalue (Rayleigh quotient at the final iterate). */
  lambda: number;
  /** L2-normalized dominant right eigenvector (stable age distribution). */
  vector: number[];
}

/**
 * Dominant eigenpair via power iteration with a FIXED number of iterations
 * (no adaptive stopping — full determinism). For a non-negative primitive
 * Leslie matrix the iterates converge geometrically at rate |lambda2/lambda1|.
 * Returns lambda = 0 and the zero vector when L maps the start vector to 0
 * (e.g. an all-zero matrix).
 */
export function dominantEigen(L: number[][], iterations = 600): EigenPair {
  const k = L.length;
  const v = new Array<number>(k).fill(1 / Math.sqrt(k));
  for (let it = 0; it < iterations; it += 1) {
    const w = matVec(L, v);
    const norm = Math.sqrt(w.reduce((acc, x) => acc + x * x, 0));
    if (!Number.isFinite(norm) || norm === 0) {
      return { lambda: 0, vector: new Array<number>(k).fill(0) };
    }
    for (let i = 0; i < k; i += 1) v[i] = (w[i] ?? 0) / norm;
  }
  const w = matVec(L, v);
  const lambda = v.reduce((acc, x, i) => acc + x * (w[i] ?? 0), 0); // v is unit-norm
  return { lambda, vector: v };
}

/** Dominant eigenvalue (long-run annual growth rate) of a Leslie matrix. */
export function growthRate(L: number[][], iterations = 600): number {
  return dominantEigen(L, iterations).lambda;
}

// ---- age-structure indicators -------------------------------------------------------

export interface AgeStructure {
  /** Dependents (approx. 0-14 + 65+) per 100 working-age (approx. 15-64), in %. */
  dependencyRatio: number;
  /** Median age in years, linearly interpolated within the straddling class. */
  medianAge: number;
  /** Fraction of the population aged 65 and over (0-1). */
  share65: number;
}

/**
 * Age-structure indicators for a k-class vector covering the 80-year span.
 * Classes are assigned to youth / working / elderly by their lower age bound
 * (a documented approximation when the class width exceeds 1 year).
 */
export function ageStructure(n: number[]): AgeStructure {
  const k = n.length;
  const width = AGE_SPAN / Math.max(1, k);
  const total = totalPopulation(n);
  if (total <= 0) return { dependencyRatio: 0, medianAge: 0, share65: 0 };
  let youth = 0;
  let elderly = 0;
  let cum = 0;
  let medianAge = AGE_SPAN;
  for (let i = 0; i < k; i += 1) {
    const pop = n[i] ?? 0;
    const lower = i * width;
    if (lower < 15) youth += pop;
    else if (lower >= 65) elderly += pop;
    const share = pop / total;
    if (medianAge === AGE_SPAN && cum + share >= 0.5) {
      medianAge = lower + width * ((0.5 - cum) / Math.max(share, 1e-12));
    }
    cum += share;
  }
  const working = total - youth - elderly;
  return {
    dependencyRatio: ((youth + elderly) / Math.max(working, 1e-12)) * 100,
    medianAge: Math.min(AGE_SPAN, medianAge),
    share65: elderly / total,
  };
}

export type AgingStage = 'young' | 'aging' | 'aged';

export interface AgingVerdict {
  key: AgingStage;
  en: string;
  zh: string;
}

/**
 * UN-convention 65+ classification: < 7% young, 7-14% aging (inclusive),
 * > 14% aged.
 */
export function classifyAging(share65: number): AgingVerdict {
  if (share65 < AGING_YOUNG_MAX) {
    return { key: 'young', en: 'young population (65+ < 7%)', zh: '年轻型人口（65+ < 7%）' };
  }
  if (share65 <= AGING_AGED_MIN) {
    return { key: 'aging', en: 'aging population (7% <= 65+ <= 14%)', zh: '老龄化型人口（7% ≤ 65+ ≤ 14%）' };
  }
  return { key: 'aged', en: 'aged population (65+ > 14%)', zh: '老年型人口（65+ > 14%）' };
}

// ---- initial population and migration ------------------------------------------------

/**
 * Initial age distribution: a smooth exponentially-declining profile
 * (total 1,000,000) with a small seeded per-class jitter, so different seeds
 * give slightly different - but statistically equivalent - starting states.
 */
export function initialPopulation(k: number, seed: number): number[] {
  const width = AGE_SPAN / Math.max(1, k);
  const rand = mulberry32(seed >>> 0 || 1);
  const raw: number[] = [];
  let sum = 0;
  for (let i = 0; i < k; i += 1) {
    const w = Math.exp(-(i * width) / 42) * (1 + 0.02 * (rand() * 2 - 1));
    raw.push(w);
    sum += w;
  }
  return raw.map((w) => (w / Math.max(sum, 1e-12)) * 1_000_000);
}

/** Net-migration vector: the yearly total spread uniformly across classes. */
export function migrationVector(totalPerYear: number, k: number): number[] {
  const per = totalPerYear / Math.max(1, k);
  return new Array<number>(k).fill(per);
}

// ---- full deterministic run ------------------------------------------------------------

export interface PopRun {
  classes: number;
  /** Leslie matrix actually used (schedules x multipliers applied). */
  leslie: number[][];
  /** Age vectors per year; index 0 = initial state. */
  populations: number[][];
  /** Total population per year. */
  totals: number[];
  /** 65+ share (0-1) per year. */
  share65: number[];
  /** Dependency ratio (%) per year. */
  dependency: number[];
  /** Median age (years) per year. */
  medianAge: number[];
  /** Dominant eigenvalue of the Leslie matrix (annual growth rate). */
  lambda: number;
  years: number;
}

/** Full deterministic projection for the given parameters. */
export function simulatePopForecast(p: PopForecastParams): PopRun {
  const k = Math.max(1, Math.round(p.classes));
  const L = buildLeslieMatrix(p);
  const n0 = initialPopulation(k, p.seed);
  const m = migrationVector(p.migrationPerYear, k);
  const populations = project(L, n0, p.years, m);
  const totals: number[] = [];
  const share65: number[] = [];
  const dependency: number[] = [];
  const medianAge: number[] = [];
  for (const n of populations) {
    const a = ageStructure(n);
    totals.push(totalPopulation(n));
    share65.push(a.share65);
    dependency.push(a.dependencyRatio);
    medianAge.push(a.medianAge);
  }
  return {
    classes: k,
    leslie: L,
    populations,
    totals,
    share65,
    dependency,
    medianAge,
    lambda: growthRate(L),
    years: p.years,
  };
}

// ---- embedded validation benchmark -------------------------------------------------
//
// Reference matrix: L = [[0, 4, 9], [0.5, 0, 0], [0, 0.6, 0]] whose dominant
// eigenvalue is known in closed form from the Leslie characteristic cubic
// lambda^3 - f1 lambda^2 - f2 s1 lambda - f3 s1 s2 = 0, i.e. here
// lambda^3 - 2 lambda - 2.7 = 0 (Cardano: one real root).

export const POP_BENCHMARK = {
  id: 'leslie-eigen-growth',
  fertility: [0, 4, 9],
  survival: [0.5, 0.6],
  matrix: [
    [0, 4, 9],
    [0.5, 0, 0],
    [0, 0.6, 0],
  ],
} as const;

export interface PopBenchmarkDetails {
  /** Power-iteration dominant eigenvalue of the reference matrix. */
  lambda: number;
  /** Closed-form Cardano root of lambda^3 - 2 lambda - 2.7 = 0. */
  lambdaRef: number;
  /** |lambda - lambdaRef| / lambdaRef. */
  eigenError: number;
  /** Max component deviation of the projected composition from the eigenvector. */
  stableMaxDiff: number;
  /** Final / initial total population under zero fertility. */
  extinctionRatio: number;
  /** Max |total_t - (total_0 + t * sum(m))| over the migration run. */
  migrationMaxErr: number;
}

export interface PopBenchmark {
  eigenOk: boolean;
  stableConvergence: boolean;
  extinction: boolean;
  migrationCumulative: boolean;
  deterministic: boolean;
  details: PopBenchmarkDetails;
  pass: boolean;
}

/**
 * Dominant real root of the 3x3 Leslie characteristic cubic
 * lambda^3 - f1 lambda^2 - f2 s1 lambda - f3 s1 s2 = 0, via Cardano's
 * formula on the depressed cubic (bisection fallback for the three-real-root
 * case, which the benchmark matrix does not exercise).
 */
export function leslieCubicDominantRoot(fertility: number[], survival: number[]): number {
  const f1 = fertility[0] ?? 0;
  const f2 = fertility[1] ?? 0;
  const f3 = fertility[2] ?? 0;
  const s1 = survival[0] ?? 0;
  const s2 = survival[1] ?? 0;
  // lambda^3 + a lambda^2 + b lambda + c = 0
  const a = -f1;
  const b = -f2 * s1;
  const c = -f3 * s1 * s2;
  // Depressed cubic x^3 + p x + q = 0 with lambda = x - a/3.
  const p = b - (a * a) / 3;
  const q = (2 * a * a * a) / 27 - (a * b) / 3 + c;
  const delta = (q * q) / 4 + (p * p * p) / 27;
  if (delta >= 0) {
    const sq = Math.sqrt(delta);
    const x = Math.cbrt(-q / 2 + sq) + Math.cbrt(-q / 2 - sq);
    return x - a / 3;
  }
  // Three real roots: bisect the original cubic on [0, 1e3] (c < 0 here).
  const poly = (t: number): number => t * t * t + a * t * t + b * t + c;
  let lo = 0;
  let hi = 1e3;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (poly(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2 - a / 3;
}

/**
 * Run the embedded Leslie validation battery:
 *  (a) dominant eigenvalue vs the closed-form cubic root (criterion 1e-6 rel.),
 *  (b) projected age composition converges to the stable age distribution
 *      (dominant eigenvector) and satisfies the eigen equation,
 *  (c) geometric extinction under zero fertility,
 *  (d) net migration shifts totals by the exact cumulative sum
 *      (1-class identity Leslie: L = [[1]]),
 *  (e) seed determinism of the full simulation.
 */
export function runPopForecastBenchmark(): PopBenchmark {
  const L = POP_BENCHMARK.matrix.map((row) => row.slice());

  // (a) dominant eigenvalue vs the characteristic cubic.
  const pair = dominantEigen(L);
  const lambdaRef = leslieCubicDominantRoot(POP_BENCHMARK.fertility.slice(), POP_BENCHMARK.survival.slice());
  const eigenError = Math.abs(pair.lambda - lambdaRef) / Math.max(1e-12, Math.abs(lambdaRef));

  // (b) stable age distribution: 400 years of projection from a positive start.
  const long = project(L, [1, 1, 1], 400);
  const u = long[long.length - 1] ?? [0, 0, 0];
  const uSum = totalPopulation(u) || 1;
  const v = pair.vector;
  const vSum = totalPopulation(v) || 1;
  let stableMaxDiff = 0;
  for (let i = 0; i < 3; i += 1) {
    stableMaxDiff = Math.max(stableMaxDiff, Math.abs((u[i] ?? 0) / uSum - (v[i] ?? 0) / vSum));
  }
  let eigenResidual = 0;
  const Lv = matVec(L, pair.vector);
  for (let i = 0; i < 3; i += 1) {
    eigenResidual = Math.max(eigenResidual, Math.abs((Lv[i] ?? 0) - pair.lambda * (pair.vector[i] ?? 0)));
  }
  const stableConvergence = stableMaxDiff <= 1e-6 && eigenResidual <= 1e-6 * Math.max(1, pair.lambda);

  // (c) zero-fertility extinction: pure survival shift decays geometrically.
  const Lext = buildLeslie([0, 0, 0], [0.6, 0.5]);
  const ext0 = project(Lext, [1000, 800, 300], 240);
  const extinctionRatio = totalPopulation(ext0[ext0.length - 1] ?? [0]) / totalPopulation([1000, 800, 300]);
  const extinction = extinctionRatio < 1e-12;

  // (d) migration cumulative-sum identity with the 1-class identity Leslie.
  const n0 = [1000];
  const m = [50];
  const years = 100;
  const mig = project([[1]], n0, years, m);
  let migrationMaxErr = 0;
  for (let t = 0; t <= years; t += 1) {
    const want = n0[0]! + t * m[0]!;
    migrationMaxErr = Math.max(migrationMaxErr, Math.abs(totalPopulation(mig[t] ?? [0]) - want));
  }
  const migrationCumulative = migrationMaxErr <= 1e-6;

  // (e) seed determinism of the full deterministic simulation.
  const p: PopForecastParams = { ...DEFAULT_POP_PARAMS, years: 40, seed: 42 };
  const r1 = simulatePopForecast(p);
  const r2 = simulatePopForecast(p);
  const pOther: PopForecastParams = { ...p, seed: 43 };
  const r3 = simulatePopForecast(pOther);
  const deterministic =
    r1.totals.every((x, i) => x === (r2.totals[i] ?? NaN)) &&
    r1.totals[0] !== r3.totals[0];

  return {
    eigenOk: eigenError <= 1e-6,
    stableConvergence,
    extinction,
    migrationCumulative,
    deterministic,
    details: { lambda: pair.lambda, lambdaRef, eigenError, stableMaxDiff, extinctionRatio, migrationMaxErr },
    pass: eigenError <= 1e-6 && stableConvergence && extinction && migrationCumulative && deterministic,
  };
}
