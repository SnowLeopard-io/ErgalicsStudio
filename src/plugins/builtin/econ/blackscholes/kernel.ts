// ==========================================================================
// econ-blackscholes — option pricing numerics (pure, dependency-free)
//
// Black-Scholes-Merton analytic pricing and Greeks, a standard normal CDF
// via Abramowitz & Stegun 26.2.17 (|epsilon| < 7.5e-8), a seeded Monte Carlo
// geometric-Brownian-motion engine (Box-Muller pairs, cumulative-mean trace)
// with 95% confidence bands, put-call parity certification and an embedded
// four-part validation benchmark. All functions are pure so the kernel
// unit-tests without a canvas or DOM.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

/** Market / contract inputs. Rates and vol are annualized, T in years. */
export interface BSParams {
  S: number; // spot
  K: number; // strike
  r: number; // risk-free rate
  q: number; // dividend yield
  sigma: number; // volatility
  T: number; // time to maturity (years)
}

export const DEFAULT_BS_PARAMS: BSParams = { S: 100, K: 100, r: 0.05, q: 0, sigma: 0.2, T: 1 };

/** Two-sided 95% normal quantile (large-sample MC interval). */
export const Z95 = 1.959963984540054;

// ---- standard normal -------------------------------------------------------

/** Standard normal density. */
export function stdNormPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal CDF via Abramowitz & Stegun 26.2.17: a 5-term rational
 * polynomial in t = 1/(1 + 0.2316419·|x|), |epsilon(x)| < 7.5e-8 over the
 * whole real line. Negative x handled through the symmetry Phi(x) = 1 - Phi(-x).
 */
export function stdNormCdf(x: number): number {
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const upper = 1 - stdNormPdf(ax) * poly;
  return x >= 0 ? upper : 1 - upper;
}

// ---- analytic pricing ------------------------------------------------------

export interface BsPrices {
  call: number;
  put: number;
  d1: number;
  d2: number;
}

/**
 * Analytic BSM prices for a European call/put. Degenerate inputs (zero vol
 * or zero maturity) fall back to the discounted intrinsic value so curves
 * stay finite at the slider extremes.
 */
export function bsPrices(p: BSParams): BsPrices {
  const discR = Math.exp(-p.r * p.T);
  const discQ = Math.exp(-p.q * p.T);
  const fwd = p.S * discQ;
  const strike = p.K * discR;
  if (!(p.sigma > 0) || !(p.T > 0)) {
    const call = Math.max(fwd - strike, 0);
    const put = Math.max(strike - fwd, 0);
    return { call, put, d1: 0, d2: 0 };
  }
  const sq = p.sigma * Math.sqrt(p.T);
  const d1 = (Math.log(p.S / p.K) + (p.r - p.q + 0.5 * p.sigma * p.sigma) * p.T) / sq;
  const d2 = d1 - sq;
  const call = fwd * stdNormCdf(d1) - strike * stdNormCdf(d2);
  const put = strike * stdNormCdf(-d2) - fwd * stdNormCdf(-d1);
  return { call, put, d1, d2 };
}

export interface BsGreeks {
  deltaCall: number;
  deltaPut: number;
  gamma: number;
  /** Sensitivity to a 1.0 move in volatility (per-year convention). */
  vega: number;
  /** Per-year theta. */
  thetaCall: number;
  thetaPut: number;
}

/** Analytic BSM Greeks (Hull 2015, ch. 19 conventions). */
export function bsGreeks(p: BSParams): BsGreeks {
  const { d1, d2 } = bsPrices(p);
  const discR = Math.exp(-p.r * p.T);
  const discQ = Math.exp(-p.q * p.T);
  const sq = Math.sqrt(Math.max(p.T, 1e-12));
  const pdf1 = stdNormPdf(d1);
  return {
    deltaCall: discQ * stdNormCdf(d1),
    deltaPut: -discQ * stdNormCdf(-d1),
    gamma: (discQ * pdf1) / (p.S * p.sigma * sq),
    vega: p.S * discQ * pdf1 * sq,
    thetaCall:
      (-p.S * discQ * pdf1 * p.sigma) / (2 * sq) -
      p.r * p.K * discR * stdNormCdf(d2) +
      p.q * p.S * discQ * stdNormCdf(d1),
    thetaPut:
      (-p.S * discQ * pdf1 * p.sigma) / (2 * sq) +
      p.r * p.K * discR * stdNormCdf(-d2) -
      p.q * p.S * discQ * stdNormCdf(-d1),
  };
}

/**
 * Put-call parity residual for the analytic side:
 *   (C - P) - (S·e^{-qT} - K·e^{-rT})  — must vanish to machine precision.
 */
export function parityResidual(p: BSParams): number {
  const { call, put } = bsPrices(p);
  return call - put - (p.S * Math.exp(-p.q * p.T) - p.K * Math.exp(-p.r * p.T));
}

/** Analytic Delta (call) cross-checked by a central finite difference in S. */
export function deltaFiniteDiff(p: BSParams, h?: number): number {
  const hh = h ?? Math.max(1e-4, p.S * 1e-3);
  const up = bsPrices({ ...p, S: p.S + hh }).call;
  const dn = bsPrices({ ...p, S: p.S - hh }).call;
  return (up - dn) / (2 * hh);
}

// ---- Monte Carlo engine ----------------------------------------------------

export interface McLeg {
  mean: number;
  se: number;
  lo: number;
  hi: number;
}

export interface McResult {
  paths: number;
  call: McLeg;
  put: McLeg;
}

export interface McTracePoint {
  n: number;
  callMean: number;
  putMean: number;
}

export interface McOutput {
  result: McResult;
  trace: McTracePoint[];
}

/**
 * Monte Carlo pricing under geometric Brownian motion:
 *   S_T = S·exp((r - q - σ²/2)T + σ√T·Z),
 * European payoffs averaged over `paths` fixed-seed Box-Muller normals and
 * discounted at e^{-rT}. Reports mean, standard error and a two-sided 95%
 * normal confidence interval for both legs (same terminal prices, so the MC
 * put-call difference is exact per path). `tracePoints` controls the density
 * of the cumulative-mean convergence trace.
 */
export function mcPrices(p: BSParams, paths: number, seed: number, tracePoints = 160): McOutput {
  const n = Math.max(2, Math.floor(paths));
  const rand = mulberry32(seed >>> 0 || 1);
  const drift = (p.r - p.q - 0.5 * p.sigma * p.sigma) * p.T;
  const vol = p.sigma * Math.sqrt(p.T);
  const disc = Math.exp(-p.r * p.T);
  const every = Math.max(1, Math.floor(n / Math.max(10, tracePoints)));

  let sumC = 0;
  let sumC2 = 0;
  let sumP = 0;
  let sumP2 = 0;
  let done = 0;
  const trace: McTracePoint[] = [];

  while (done < n) {
    // One Box-Muller pair from two uniforms (deterministic given the seed).
    let u1 = rand();
    if (u1 < 1e-12) u1 = 1e-12;
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const zs = [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
    for (const z of zs) {
      if (done >= n) break;
      const st = p.S * Math.exp(drift + vol * z);
      const pc = Math.max(st - p.K, 0);
      const pp = Math.max(p.K - st, 0);
      sumC += pc;
      sumC2 += pc * pc;
      sumP += pp;
      sumP2 += pp * pp;
      done += 1;
      if (done % every === 0 || done === n) {
        trace.push({ n: done, callMean: (disc * sumC) / done, putMean: (disc * sumP) / done });
      }
    }
  }

  const leg = (sum: number, sum2: number): McLeg => {
    const mean = (disc * sum) / n;
    const variance = Math.max(0, (sum2 - (sum * sum) / n) / (n - 1));
    const se = disc * Math.sqrt(variance / n);
    return { mean, se, lo: mean - Z95 * se, hi: mean + Z95 * se };
  };

  return {
    result: { paths: n, call: leg(sumC, sumC2), put: leg(sumP, sumP2) },
    trace,
  };
}

// ---- spot curve -------------------------------------------------------------

export interface SpotCurvePoint {
  s: number;
  call: number;
  put: number;
}

/** Analytic call/put sampled over a spot grid (for the price-vs-spot panel). */
export function spotCurve(p: BSParams, sMin: number, sMax: number, n = 121): SpotCurvePoint[] {
  const pts: SpotCurvePoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = sMin + ((sMax - sMin) * i) / (n - 1);
    const { call, put } = bsPrices({ ...p, S: s });
    pts.push({ s, call, put });
  }
  return pts;
}

// ---- embedded validation benchmark ------------------------------------------

export const BS_BENCHMARK = {
  id: 'blackscholes-benchmark',
  params: DEFAULT_BS_PARAMS,
  paths: 100_000,
  seed: 20260922,
  /** Reference value N(1.96) = 0.9750021048517795 (double-precision table). */
  n196: 0.9750021048517795,
} as const;

export interface BsBenchmark {
  /** |MC - analytic| for the call. */
  mcAbsErr: number;
  /** Same error expressed in MC standard-error units (criterion: < 3). */
  mcSeUnits: number;
  /** |parity residual| (criterion: < 1e-10). */
  parity: number;
  /** |N(1.96) - reference| (criterion: < 1e-7). */
  cdfErr196: number;
  /** |analytic Delta - finite-difference Delta| (criterion: < 1e-3). */
  deltaFdErr: number;
  pass: boolean;
}

/**
 * Run the four embedded benchmarks on the typical ATM parameter set. The
 * MC-vs-analytic check uses the uniform relative error yardstick expressed
 * in SE units: |computed - analytic| / SE < 3 (≈ 99.7% normal coverage).
 */
export function runBlackscholesBenchmark(): BsBenchmark {
  const p = BS_BENCHMARK.params;
  const an = bsPrices(p);
  const mc = mcPrices(p, BS_BENCHMARK.paths, BS_BENCHMARK.seed).result;
  const mcAbsErr = Math.abs(mc.call.mean - an.call);
  const parity = Math.abs(parityResidual(p));
  const cdfErr196 = Math.abs(stdNormCdf(1.96) - BS_BENCHMARK.n196);
  const deltaFdErr = Math.abs(bsGreeks(p).deltaCall - deltaFiniteDiff(p));
  const mcSeUnits = mc.call.se > 0 ? mcAbsErr / mc.call.se : Number.POSITIVE_INFINITY;
  return {
    mcAbsErr,
    mcSeUnits,
    parity,
    cdfErr196,
    deltaFdErr,
    pass: mcSeUnits < 3 && parity < 1e-10 && cdfErr196 < 1e-7 && deltaFdErr < 1e-3,
  };
}
