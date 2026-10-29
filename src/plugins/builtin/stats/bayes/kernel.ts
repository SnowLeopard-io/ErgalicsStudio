// ==========================================================================
// bayes — full Bayesian inference kernel
//
// Metropolis-Hastings, conjugate Gibbs and Hamiltonian Monte Carlo samplers
// for the normal model, posterior predictive checks, Savage-Dickey Bayes
// factors, a hierarchical normal model, and Gelman-Rubin / ESS / trace
// diagnostics. Deterministic given a seed so the benchmarks are reproducible.
// ==========================================================================

import { fmt, mean, parseTable, std } from '../../shared/stats-utils';

export interface BayesDataset {
  values: number[];
  groups: string[] | null;
  groupName: string | null;
  valueName: string;
}

export interface NormalPrior {
  mu0: number;
  kappa: number;
  alpha: number;
  beta: number;
}

export const DEFAULT_PRIOR: NormalPrior = { mu0: 0, kappa: 1, alpha: 1, beta: 1 };

/** Parse a single numeric column, keeping an optional group label. */
export function parseBayes(text: string): BayesDataset {
  const table = parseTable(text);
  if (table.header.length === 0) return { values: [], groups: null, groupName: null, valueName: 'value' };
  const lower = table.header.map((h) => h.toLowerCase());
  const groupIdx = lower.findIndex((h) => ['group', 'class', 'site', 'subject', 'cluster'].includes(h));
  const numericIdx = table.header
    .map((_, i) => i)
    .filter((i) => i !== groupIdx && table.rows.some((r) => Number.isFinite(Number(r[i]))));
  const valueIdx = numericIdx[0] ?? 0;
  const values: number[] = [];
  const groups: string[] = [];
  for (const row of table.rows) {
    const v = Number(row[valueIdx]);
    if (!Number.isFinite(v)) continue;
    values.push(v);
    if (groupIdx >= 0) groups.push(String(row[groupIdx] ?? 'group'));
  }
  return {
    values,
    groups: groupIdx >= 0 ? groups : null,
    groupName: groupIdx >= 0 ? table.header[groupIdx]! : null,
    valueName: table.header[valueIdx] ?? 'value',
  };
}

// ---- RNG & distributions ---------------------------------------------------

export class Rng {
  private state: number;
  constructor(seed = 20261029) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
  normal(): number {
    const u = Math.max(1e-12, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  gamma(shape: number): number {
    if (shape < 1) {
      const u = Math.max(1e-12, this.next());
      return this.gamma(shape + 1) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = this.normal();
      const v = (1 + c * x) ** 3;
      if (v <= 0) continue;
      const u = this.next();
      if (u < 1 - 0.0331 * x ** 4) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
}

function logPosteriorNormal(y: number[], mu: number, sigma: number, prior: NormalPrior): number {
  if (!(sigma > 0)) return -Infinity;
  let ll = 0;
  for (const v of y) ll += -0.5 * Math.log(2 * Math.PI) - Math.log(sigma) - ((v - mu) ** 2) / (2 * sigma * sigma);
  const priorMu = -0.5 * ((mu - prior.mu0) ** 2) / (1 / Math.sqrt(prior.kappa));
  const priorSigma = (prior.alpha + 1) * Math.log(sigma) + prior.beta / (sigma * sigma);
  return ll + priorMu - priorSigma;
}

export interface Chain {
  mu: number[];
  sigma: number[];
  accepted: number;
}

/** Random-walk Metropolis-Hastings for (μ, σ) of a normal model. */
export function metropolisHastings(
  y: number[],
  opts: { iterations?: number; burn?: number; seed?: number; prior?: NormalPrior; proposal?: number } = {},
): Chain {
  const iterations = opts.iterations ?? 4000;
  const burn = opts.burn ?? 1000;
  const prior = opts.prior ?? DEFAULT_PRIOR;
  const rng = new Rng(opts.seed ?? 20261029);
  const y0 = y.length > 0 ? mean(y) : prior.mu0;
  const s0 = y.length > 1 ? Math.max(1e-3, std(y, true)) : 1;
  let mu = y0;
  let sigma = s0;
  let logp = logPosteriorNormal(y, mu, sigma, prior);
  const prop = opts.proposal ?? 0.35;
  const out: Chain = { mu: [], sigma: [], accepted: 0 };
  for (let i = 0; i < iterations + burn; i += 1) {
    const muT = mu + rng.normal() * prop * (s0 / Math.sqrt(Math.max(1, y.length)));
    const sigmaT = Math.abs(sigma + rng.normal() * prop * s0 * 0.5);
    const logpT = logPosteriorNormal(y, muT, sigmaT, prior);
    if (Math.log(Math.max(1e-300, rng.next())) < logpT - logp) {
      mu = muT;
      sigma = sigmaT;
      logp = logpT;
      if (i >= burn) out.accepted += 1;
    }
    if (i >= burn) {
      out.mu.push(mu);
      out.sigma.push(sigma);
    }
  }
  return out;
}

/** Conjugate Gibbs sampler for the normal model with a normal-inverse-gamma prior. */
export function gibbsNormal(
  y: number[],
  opts: { iterations?: number; burn?: number; seed?: number; prior?: NormalPrior } = {},
): Chain {
  const iterations = opts.iterations ?? 4000;
  const burn = opts.burn ?? 1000;
  const prior = opts.prior ?? DEFAULT_PRIOR;
  const rng = new Rng(opts.seed ?? 424242);
  const n = y.length;
  const ybar = n > 0 ? mean(y) : 0;
  const out: Chain = { mu: [], sigma: [], accepted: iterations };
  let mu = ybar;
  let precision = 1;
  for (let i = 0; i < iterations + burn; i += 1) {
    // precision | mu, y ~ Gamma(alpha + n/2, beta + 0.5 Σ(y-mu)^2 + 0.5 κ(mu-μ0)^2)
    let ss = 0;
    for (const v of y) ss += (v - mu) ** 2;
    const shape = prior.alpha + n / 2;
    const rate = prior.beta + 0.5 * ss + 0.5 * prior.kappa * (mu - prior.mu0) ** 2;
    precision = Math.max(1e-12, rng.gamma(shape) / Math.max(1e-12, rate));
    // mu | precision, y ~ Normal((κ μ0 + n ȳ)/(κ+n), 1/(precision(κ+n)))
    const postMean = (prior.kappa * prior.mu0 + n * ybar) / (prior.kappa + n);
    mu = postMean + rng.normal() / Math.sqrt(precision * (prior.kappa + n));
    if (i >= burn) {
      out.mu.push(mu);
      out.sigma.push(1 / Math.sqrt(precision));
    }
  }
  return out;
}

/** 1-D Hamiltonian Monte Carlo for the normal mean with known σ. */
export function hmcMean(
  y: number[],
  opts: { iterations?: number; burn?: number; seed?: number; sigma?: number; step?: number; leaps?: number; prior?: NormalPrior } = {},
): number[] {
  const iterations = opts.iterations ?? 3000;
  const burn = opts.burn ?? 800;
  const rng = new Rng(opts.seed ?? 987654);
  const prior = opts.prior ?? DEFAULT_PRIOR;
  const sigma = opts.sigma ?? (y.length > 1 ? std(y, true) : 1);
  const n = y.length;
  const ybar = y.length > 0 ? mean(y) : 0;
  const postVar = 1 / (n / (sigma * sigma) + prior.kappa);
  const postMean = postVar * ((n * ybar) / (sigma * sigma) + prior.kappa * prior.mu0);
  const grad = (mu: number): number => -(mu - postMean) / postVar;
  const potential = (mu: number): number => (0.5 * (mu - postMean) ** 2) / postVar;
  const eps = opts.step ?? Math.min(0.5, 0.8 * Math.sqrt(postVar));
  const leaps = opts.leaps ?? 12;
  let q = postMean;
  const out: number[] = [];
  for (let i = 0; i < iterations + burn; i += 1) {
    const p0 = rng.normal();
    let p = p0;
    let qNew = q;
    p += 0.5 * eps * grad(qNew);
    for (let l = 0; l < leaps; l += 1) {
      qNew += eps * p;
      if (l < leaps - 1) p += eps * grad(qNew);
    }
    p += 0.5 * eps * grad(qNew);
    const h0 = potential(q) + 0.5 * p0 * p0;
    const h1 = potential(qNew) + 0.5 * p * p;
    if (Math.log(Math.max(1e-300, rng.next())) < h0 - h1) q = qNew;
    if (i >= burn) out.push(q);
  }
  return out;
}

export interface Convergence {
  rhat: number;
  ess: number;
  autocorr1: number;
  means: number[];
  sds: number[];
}

/** Gelman-Rubin R-hat, effective sample size and lag-1 autocorrelation. */
export function convergence(chains: number[][]): Convergence {
  const valid = chains.filter((c) => c.length > 1);
  if (valid.length === 0) return { rhat: NaN, ess: NaN, autocorr1: NaN, means: [], sds: [] };
  const n = Math.min(...valid.map((c) => c.length));
  const m = valid.length;
  const means = valid.map((c) => mean(c.slice(0, n)));
  const variances = valid.map((c) => {
    const mu = mean(c.slice(0, n));
    return c.slice(0, n).reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, n - 1);
  });
  const grand = mean(means);
  const between = (n / Math.max(1, m - 1)) * means.reduce((s, v) => s + (v - grand) ** 2, 0);
  const within = mean(variances);
  const varPlus = ((n - 1) / n) * within + between / n;
  const rhat = within > 0 ? Math.sqrt(varPlus / within) : NaN;
  // Effective sample size from the pooled autocorrelation.
  let rhoSum = 0;
  const flat = valid.flatMap((c) => c.slice(0, n));
  const flatMean = mean(flat);
  let denom = 0;
  for (const v of flat) denom += (v - flatMean) ** 2;
  for (let lag = 1; lag <= Math.min(50, n - 1); lag += 1) {
    let num = 0;
    let count = 0;
    for (const c of valid) {
      for (let i = lag; i < n; i += 1) {
        num += (c[i]! - flatMean) * (c[i - lag]! - flatMean);
        count += 1;
      }
    }
    const rho = denom > 0 ? (num / Math.max(1, count)) / (denom / Math.max(1, flat.length)) : 0;
    if (Math.abs(rho) < 0.05) break;
    rhoSum += rho;
  }
  let autocorr1 = 0;
  const c0 = valid[0]!;
  const mu0 = mean(c0.slice(0, n));
  let num = 0;
  let d0 = 0;
  for (let i = 0; i < n; i += 1) d0 += (c0[i]! - mu0) ** 2;
  for (let i = 1; i < n; i += 1) num += (c0[i]! - mu0) * (c0[i - 1]! - mu0);
  autocorr1 = d0 > 0 ? num / d0 : 0;
  const ess = Math.max(1, (m * n) / (1 + 2 * Math.max(0, rhoSum)));
  return { rhat, ess, autocorr1, means, sds: variances.map((v) => Math.sqrt(v)) };
}

/** Posterior predictive draws: y* ~ N(μ_s, σ_s) for each retained draw. */
export function posteriorPredictive(chain: Chain, count = 400, seed = 13579): number[] {
  const rng = new Rng(seed);
  const out: number[] = [];
  const n = Math.min(count, chain.mu.length);
  for (let i = 0; i < n; i += 1) {
    const idx = Math.floor(rng.next() * chain.mu.length);
    out.push(chain.mu[idx]! + rng.normal() * chain.sigma[idx]!);
  }
  return out;
}

/** Posterior summary: mean and equal-tailed credible interval. */
export function credibleInterval(samples: number[], level = 0.95): { mean: number; lo: number; hi: number; median: number } {
  if (samples.length === 0) return { mean: NaN, lo: NaN, hi: NaN, median: NaN };
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]!;
  return {
    mean: mean(samples),
    lo: q((1 - level) / 2),
    hi: q(1 - (1 - level) / 2),
    median: q(0.5),
  };
}

/** Gaussian KDE density at `x`. */
export function kde(samples: number[], x: number): number {
  if (samples.length === 0) return 0;
  const n = samples.length;
  const s = std(samples, true) || 1;
  const h = 1.06 * s * Math.pow(n, -1 / 5);
  let sum = 0;
  for (const v of samples) sum += Math.exp(-0.5 * ((x - v) / h) ** 2);
  return sum / (n * h * Math.sqrt(2 * Math.PI));
}

/** Savage-Dickey Bayes factor BF10 for H0: μ = μ0 against a normal prior. */
export function bayesFactor(chain: Chain, prior: NormalPrior = DEFAULT_PRIOR): number {
  if (chain.mu.length === 0) return NaN;
  const priorDensity = Math.exp(-0.5 * ((prior.mu0 - prior.mu0) / (1 / Math.sqrt(prior.kappa))) ** 2) /
    ((1 / Math.sqrt(prior.kappa)) * Math.sqrt(2 * Math.PI));
  const postDensity = kde(chain.mu, prior.mu0);
  if (!(postDensity > 0)) return Infinity;
  return priorDensity / postDensity;
}

export interface HierarchicalResult {
  grandMean: number;
  grandLo: number;
  grandHi: number;
  tau: number;
  groupMeans: Array<{ label: string; mean: number; lo: number; hi: number; shrinkage: number }>;
  rhat: number;
  ess: number;
}

/** Gibbs sampler for a hierarchical normal model (random intercepts). */
export function hierarchicalModel(groups: string[], values: number[], iterations = 3000, seed = 24680): HierarchicalResult | null {
  const labels = [...new Set(groups)].sort();
  if (labels.length < 2) return null;
  const data = labels.map((label) => values.filter((_, i) => groups[i] === label));
  if (data.some((d) => d.length === 0)) return null;
  const rng = new Rng(seed);
  const ybars = data.map((d) => mean(d));
  const ns = data.map((d) => d.length);
  const within = data.map((d) => {
    const m = mean(d);
    return d.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, d.length - 1);
  });
  const sigma2 = Math.max(1e-6, mean(within));
  let mu = mean(ybars);
  let tau2 = Math.max(1e-6, std(ybars, true) ** 2);
  const theta = [...ybars];
  const muChain: number[] = [];
  const tauChain: number[] = [];
  const thetaChains: number[][] = labels.map(() => []);
  for (let it = 0; it < iterations; it += 1) {
    // theta_j | mu, tau2, y
    for (let j = 0; j < labels.length; j += 1) {
      const v = 1 / (ns[j]! / sigma2 + 1 / tau2);
      const m = v * ((ns[j]! * ybars[j]!) / sigma2 + mu / tau2);
      theta[j] = m + rng.normal() * Math.sqrt(v);
    }
    // mu | theta, tau2
    const vMu = tau2 / labels.length;
    mu = mean(theta) + rng.normal() * Math.sqrt(vMu);
    // tau2 | theta, mu ~ inverse-gamma(k/2, Σ(theta-mu)^2/2)
    const ss = theta.reduce((s, t) => s + (t - mu) ** 2, 0);
    tau2 = Math.max(1e-8, (ss / 2) / Math.max(1e-12, rng.gamma(labels.length / 2)));
    muChain.push(mu);
    tauChain.push(Math.sqrt(tau2));
    theta.forEach((t, j) => thetaChains[j]!.push(t));
  }
  const burn = Math.floor(iterations * 0.25);
  const grand = credibleInterval(muChain.slice(burn));
  const tau = credibleInterval(tauChain.slice(burn));
  const conv = convergence([muChain.slice(burn)]);
  return {
    grandMean: grand.mean,
    grandLo: grand.lo,
    grandHi: grand.hi,
    tau: tau.mean,
    groupMeans: labels.map((label, j) => {
      const ci = credibleInterval(thetaChains[j]!.slice(burn));
      return {
        label,
        mean: ci.mean,
        lo: ci.lo,
        hi: ci.hi,
        shrinkage: Math.abs(ci.mean - ybars[j]!),
      };
    }),
    rhat: conv.rhat,
    ess: conv.ess,
  };
}

export interface BayesResult {
  chain: Chain;
  gibbs: Chain;
  hmc: number[];
  muSummary: ReturnType<typeof credibleInterval>;
  sigmaSummary: ReturnType<typeof credibleInterval>;
  convergenceMu: Convergence;
  convergenceSigma: Convergence;
  bf10: number;
  posteriorPredictive: number[];
  rhat: number;
  ess: number;
}

/** Run all samplers and diagnostics for one dataset. */
export function runBayes(
  values: number[],
  opts: { iterations?: number; chains?: number; seed?: number; prior?: NormalPrior } = {},
): BayesResult {
  const iterations = opts.iterations ?? 2000;
  const seed = opts.seed ?? 20261029;
  const prior = opts.prior ?? DEFAULT_PRIOR;
  const nChains = opts.chains ?? 4;
  const chains = Array.from({ length: nChains }, (_, i) =>
    metropolisHastings(values, { iterations, burn: 500, seed: seed + i * 17, prior }),
  );
  const chain = chains[0] ?? metropolisHastings(values, { iterations, burn: 500, seed, prior });
  const gibbs = gibbsNormal(values, { iterations, burn: 500, seed: seed + 7, prior });
  const hmc = hmcMean(values, { iterations: Math.max(500, iterations), burn: 300, seed: seed + 3, prior });
  const convMu = convergence(chains.map((c) => c.mu));
  const convSigma = convergence(chains.map((c) => c.sigma));
  return {
    chain,
    gibbs,
    hmc,
    muSummary: credibleInterval(chain.mu),
    sigmaSummary: credibleInterval(chain.sigma),
    convergenceMu: convMu,
    convergenceSigma: convSigma,
    bf10: bayesFactor(chain, prior),
    posteriorPredictive: posteriorPredictive(chain, 600, seed + 11),
    rhat: convMu.rhat,
    ess: convMu.ess,
  };
}

export interface BayesBenchmark {
  id: string;
  passed: boolean;
  relErr: number;
  detail: string;
}

/** Conjugate posterior recovery and convergence diagnostics. */
export function runBayesBenchmark(): BayesBenchmark[] {
  const rng = new Rng(20261029);
  const truthMu = 2;
  const truthSigma = 1.5;
  const data: number[] = [];
  for (let i = 0; i < 120; i += 1) data.push(truthMu + truthSigma * rng.normal());
  const res = runBayes(data, { iterations: 1500, chains: 4, seed: 20261029 });
  const muErr = Math.abs(res.muSummary.mean - truthMu);
  const sigmaErr = Math.abs(res.sigmaSummary.mean - truthSigma);
  // Analytic conjugate posterior mean for the default prior.
  const prior = DEFAULT_PRIOR;
  const n = data.length;
  const postMean = (prior.kappa * prior.mu0 + n * mean(data)) / (prior.kappa + n);
  const analyticErr = Math.abs(res.gibbs.mu.length ? mean(res.gibbs.mu) - postMean : NaN);
  return [
    {
      id: 'posterior-mean',
      passed: muErr < 0.35,
      relErr: muErr / Math.abs(truthMu),
      detail: `posterior mean ${fmt(res.muSummary.mean, 3)} vs true 2.0 (n=120, seeded)`,
    },
    {
      id: 'posterior-sigma',
      passed: sigmaErr < 0.35,
      relErr: sigmaErr / truthSigma,
      detail: `posterior σ ${fmt(res.sigmaSummary.mean, 3)} vs true 1.5`,
    },
    {
      id: 'gibbs-analytic',
      passed: analyticErr < 0.05,
      relErr: analyticErr,
      detail: `Gibbs mean ${fmt(res.gibbs.mu.length ? mean(res.gibbs.mu) : NaN, 4)} vs conjugate ${fmt(postMean, 4)}`,
    },
    {
      id: 'rhat-convergence',
      passed: res.rhat < 1.05,
      relErr: res.rhat - 1,
      detail: `Gelman–Rubin R̂=${fmt(res.rhat, 4)} across 4 chains (threshold 1.05)`,
    },
  ];
}
