// ==========================================================================
// Ergalics Studio — Inference Forge model comparison (pure TS, data layer)
//
// WAIC and a PSIS-LOO approximation on pointwise log-likelihood matrices
// (spec FR9.5). Log-likelihood input layout: `logLik[s][i]` = log p(y_i |
// theta_s) for draw s and data point i.
//
// Pragmatic simplifications (documented): PSIS uses raw truncation of the
// importance weights at 0.2 * max (no full generalized-Pareto refit), and the
// Pareto-k diagnostic is a rough Hill-type tail estimator on the normalized
// weights — enough to flag k > 0.7, not a substitute for loo::pareto_k_ids.
// ==========================================================================

/** log(sum(exp(x))) computed stably (shift by the max). */
function logSumExp(x: ArrayLike<number>): number {
  let max = -Infinity;
  for (let i = 0; i < x.length; i += 1) {
    if (Number.isFinite(x[i]) && x[i]! > max) max = x[i]!;
  }
  if (max === -Infinity) return -Infinity;
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += Math.exp(x[i]! - max);
  return max + Math.log(s);
}

function variance(x: ArrayLike<number>): number {
  const n = x.length;
  if (n < 2) return 0;
  let m = 0;
  for (let i = 0; i < n; i += 1) m += x[i]!;
  m /= n;
  let ss = 0;
  for (let i = 0; i < n; i += 1) ss += (x[i]! - m) * (x[i]! - m);
  return ss / (n - 1);
}

export interface CriterionResult {
  elpd: number;
  se: number;
  p_eff: number;
}

/**
 * Watanabe–Akaike information criterion:
 *   elpd_waic = Σ_i [ log mean_s exp(ll_si) - var_s(ll_si) ]
 * The SE is the sqrt of N times the variance of the pointwise contributions.
 */
export function waic(logLik: Float64Array[]): CriterionResult {
  const S = logLik.length;
  const N = S > 0 ? logLik[0]!.length : 0;
  if (S === 0 || N === 0) throw new Error('waic needs a non-empty samples x points log-likelihood matrix');
  const lppd = new Float64Array(N);
  const pWa = new Float64Array(N);
  const col = new Float64Array(S);
  for (let i = 0; i < N; i += 1) {
    for (let s = 0; s < S; s += 1) col[s] = logLik[s]![i]!;
    lppd[i] = logSumExp(col) - Math.log(S);
    pWa[i] = variance(col);
  }
  const pointwise = new Float64Array(N);
  let elpd = 0;
  let pEff = 0;
  for (let i = 0; i < N; i += 1) {
    pointwise[i] = lppd[i]! - pWa[i]!;
    elpd += pointwise[i]!;
    pEff += pWa[i]!;
  }
  return { elpd, se: Math.sqrt(N * variance(pointwise)), p_eff: pEff };
}

export interface LooResult extends CriterionResult {
  /** Rough Pareto-k estimate per data point (> 0.7 means the PSIS
   *  approximation is unreliable for that point). */
  paretoK: number[];
  maxParetoK: number;
}

/**
 * PSIS-LOO approximation: per point, the importance ratios are
 * exp(-ll_si); weights are normalized, truncated at 0.2 * max and
 * renormalized before the elpd estimate.
 */
export function loo(logLik: Float64Array[]): LooResult {
  const S = logLik.length;
  const N = S > 0 ? logLik[0]!.length : 0;
  if (S === 0 || N === 0) throw new Error('loo needs a non-empty samples x points log-likelihood matrix');

  const lppd = new Float64Array(N);
  const elpd = new Float64Array(N);
  const paretoK = new Array<number>(N).fill(0);
  const logS = Math.log(S);
  const col = new Float64Array(S);
  const logw = new Float64Array(S);

  // Tail size for the Hill-type estimator (sqrt rule, at least 2 points).
  const tailSize = Math.max(2, Math.min(Math.ceil(Math.sqrt(S)), Math.floor(S / 2)));

  for (let i = 0; i < N; i += 1) {
    for (let s = 0; s < S; s += 1) col[s] = logLik[s]![i]!;
    lppd[i] = logSumExp(col) - logS;

    // Normalized log importance weights: log r_s - log sum exp(log r).
    for (let s = 0; s < S; s += 1) logw[s] = -col[s]!;
    const norm = logSumExp(logw);
    for (let s = 0; s < S; s += 1) logw[s] = logw[s]! - norm;

    // PSIS truncation: cap weights at 0.2 * max, then renormalize.
    let maxLogW = -Infinity;
    for (let s = 0; s < S; s += 1) maxLogW = Math.max(maxLogW, logw[s]!);
    const cap = Math.log(0.2) + maxLogW;
    let logCapSum = -Infinity;
    for (let s = 0; s < S; s += 1) {
      if (logw[s]! > cap) {
        logw[s] = cap;
      }
      logCapSum = logAddExp(logCapSum, logw[s]!);
    }

    for (let s = 0; s < S; s += 1) col[s] = logLik[s]![i]! + logw[s]! - logCapSum;
    elpd[i] = logSumExp(col);

    // Rough Hill-type Pareto-k estimate on the truncated normalized weights.
    paretoK[i] = hillK(Float64Array.from(logw).sort(), tailSize);
  }

  const pointwise = new Float64Array(N);
  let totalElpd = 0;
  let pEff = 0;
  for (let i = 0; i < N; i += 1) {
    pointwise[i] = lppd[i]! - elpd[i]!;
    totalElpd += elpd[i]!;
    pEff += pointwise[i]!;
  }
  return {
    elpd: totalElpd,
    se: Math.sqrt(N * variance(pointwise)),
    p_eff: pEff,
    paretoK,
    maxParetoK: Math.max(...paretoK),
  };
}

/** Hill estimator on the largest `tail` log-weights: mean log excess ratio. */
function hillK(sortedLogW: Float64Array, tail: number): number {
  // sortedLogW ascending; the tail is the last `tail` entries.
  const k = sortedLogW[sortedLogW.length - tail]!;
  let excess = 0;
  let n = 0;
  for (let i = sortedLogW.length - tail + 1; i < sortedLogW.length; i += 1) {
    const d = sortedLogW[i]! - k;
    if (d > 0) {
      excess += d;
      n += 1;
    }
  }
  return n === 0 ? 0 : excess / n;
}

function logAddExp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

export interface ModelCompareRow {
  name: string;
  elpd: number;
  pEff: number;
  se: number;
  /** elpd - max(elpd) over the compared models (0 for the best). */
  deltaElpd: number;
  /** Approximate SE of the difference (covariance between models unknown). */
  seDelta: number;
}

/** Compare several models on their pointwise log-likelihood matrices. */
export function compareModels(
  models: Array<{ name: string; logLik: Float64Array[] }>,
): ModelCompareRow[] {
  const rows = models.map((m) => {
    const w = waic(m.logLik);
    return { name: m.name, elpd: w.elpd, pEff: w.p_eff, se: w.se, deltaElpd: 0, seDelta: 0 };
  });
  const best = rows.reduce((b, r) => (r.elpd > b.elpd ? r : b), rows[0]!);
  for (const r of rows) {
    r.deltaElpd = r.elpd - best.elpd;
    r.seDelta = Math.sqrt(r.se * r.se + best.se * best.se);
  }
  return rows;
}
