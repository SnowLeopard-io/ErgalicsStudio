// ==========================================================================
// Ergalics Studio — nonlinear least squares (pure TS, data layer)
//
// Levenberg–Marquardt fitter for arbitrary user models, plus a small library
// of the models students actually meet in lab courses (Michaelis–Menten,
// four-parameter dose–response, exponential decay, power law, Gaussian peak,
// Arrhenius). The Jacobian is evaluated by central differences, the normal
// equations are solved with a Cholesky factorisation, and the covariance
// matrix at the solution yields parameter SEs, t statistics and 95% CIs.
//
// The API is deliberately the same shape as `ols()`: a structured result with
// fitted values, residuals, R² and a parameter table, so the report builder
// and the model-lab UI can treat linear and nonlinear fits uniformly.
// ==========================================================================

import { inverseSPD, type Matrix } from './linalg';
import { studentTCdf, studentTInv } from '@/core/stats/special';

/** Model function: one predictor row and the parameter vector → prediction. */
export type NonlinearModelFn = (x: number[], params: number[]) => number;

export interface NonlinearParamEstimate {
  name: string;
  estimate: number;
  se: number;
  /** t statistic for H0: estimate = 0 (asymptotic Wald test). */
  t: number;
  p: number;
  ciLow: number;
  ciHigh: number;
}

export interface NonlinearFitResult {
  /** Named parameters, in model order. */
  params: Record<string, number>;
  paramSE: Record<string, number>;
  /** 95% confidence intervals keyed by parameter name. */
  ci95: Record<string, [number, number]>;
  /** Covariance matrix of the estimates (σ̂² (JᵀWJ)⁻¹). */
  covariance: Matrix;
  coefficients: NonlinearParamEstimate[];
  fitted: number[];
  residuals: number[];
  rSquared: number;
  adjRSquared: number;
  /** Residual standard error √(SSE/(n−p)). */
  rmse: number;
  sse: number;
  dof: number;
  aic: number;
  bic: number;
  iterations: number;
  converged: boolean;
  /** Final Marquardt damping factor. */
  lambda: number;
  /** Human-readable convergence message. */
  message: string;
  n: number;
  p: number;
}

export interface LmOptions {
  maxIter?: number;
  /** Relative-SSE and step tolerance. */
  tol?: number;
  lambdaInit?: number;
  /** Optional non-negative observation weights. */
  weights?: number[];
}

export interface NonlinearModelSpec {
  id: NonlinearModelKind;
  name: string;
  paramNames: string[];
  formula: string;
  model: NonlinearModelFn;
  /** Data-driven starting values from the predictor rows and the response. */
  initial: (x: number[][], y: number[]) => number[];
}

function mean(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return values.length ? s / values.length : NaN;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : 0.5 * (s[mid - 1]! + s[mid]!);
}

/**
 * Solve the symmetric positive-definite system A x = b by Cholesky. A small
 * jitter is added when the factorisation meets a non-positive pivot, which
 * happens for rank-deficient Jacobians (e.g. a parameter with no effect).
 */
function solveSPD(A: Matrix, b: number[]): number[] | null {
  const n = A.length;
  const L: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = A[i]![j]!;
      for (let k = 0; k < j; k += 1) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (!(s > 0) || !Number.isFinite(s)) return null;
        L[i]![j] = Math.sqrt(s);
      } else {
        const d = L[j]![j]!;
        L[i]![j] = Math.abs(d) < 1e-15 ? 0 : s / d;
      }
    }
  }
  // Forward solve L y = b, then back solve Lᵀ x = y.
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let s = b[i]!;
    for (let j = 0; j < i; j += 1) s -= L[i]![j]! * y[j]!;
    y[i] = s / L[i]![i]!;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = y[i]!;
    for (let j = i + 1; j < n; j += 1) s -= L[j]![i]! * x[j]!;
    x[i] = s / L[i]![i]!;
  }
  return x.every(Number.isFinite) ? x : null;
}

/** Weighted residual sum of squares, or Infinity when the model misbehaves. */
function rssOf(
  model: NonlinearModelFn,
  xData: number[][],
  yData: number[],
  params: number[],
  w: number[],
): number {
  let sse = 0;
  for (let i = 0; i < yData.length; i += 1) {
    const f = model(xData[i]!, params);
    if (!Number.isFinite(f)) return Infinity;
    const r = yData[i]! - f;
    sse += w[i]! * r * r;
  }
  return sse;
}

/** Central-difference Jacobian of the model with respect to the parameters. */
function jacobian(
  model: NonlinearModelFn,
  xData: number[][],
  params: number[],
): Matrix {
  const n = xData.length;
  const p = params.length;
  const J: Matrix = Array.from({ length: n }, () => new Array<number>(p).fill(0));
  // Evaluate the unperturbed model once so a finite difference is only used
  // for parameters that actually change the prediction.
  const base = xData.map((row) => model(row, params));
  for (let j = 0; j < p; j += 1) {
    const h = 1e-6 * Math.max(1, Math.abs(params[j]!));
    const up = [...params];
    const dn = [...params];
    up[j]! += h;
    dn[j]! -= h;
    for (let i = 0; i < n; i += 1) {
      const fUp = model(xData[i]!, up);
      const fDn = model(xData[i]!, dn);
      if (Number.isFinite(fUp) && Number.isFinite(fDn)) {
        J[i]![j] = (fUp - fDn) / (2 * h);
      } else if (Number.isFinite(fUp) && Number.isFinite(base[i]!)) {
        J[i]![j] = (fUp - base[i]!) / h;
      } else if (Number.isFinite(fDn) && Number.isFinite(base[i]!)) {
        J[i]![j] = (base[i]! - fDn) / h;
      }
    }
  }
  return J;
}

/**
 * Levenberg–Marquardt fit.
 *
 * @param modelFn model mapping one predictor row and the parameter vector to ŷ
 * @param xData rows of predictors (one row per observation)
 * @param yData observed response
 * @param initialParams starting values (see the model library for heuristics)
 * @param paramNames names reported in `params` / `coefficients`
 */
export function levenbergMarquardt(
  modelFn: NonlinearModelFn,
  xData: number[][],
  yData: number[],
  initialParams: number[],
  paramNames: string[],
  opts: LmOptions = {},
): NonlinearFitResult {
  const n = yData.length;
  const p = initialParams.length;
  if (n !== xData.length) throw new Error('LM: xData and yData lengths must match');
  if (p === 0) throw new Error('LM: at least one parameter is required');
  if (paramNames.length !== p) throw new Error('LM: paramNames must match the parameter count');
  if (n <= p) throw new Error('LM: need more observations than parameters');
  const w = opts.weights ?? new Array<number>(n).fill(1);
  if (w.length !== n) throw new Error('LM: weights must match the observation count');
  if (w.some((v) => !(v >= 0) || !Number.isFinite(v))) {
    throw new Error('LM: weights must be finite and non-negative');
  }

  const maxIter = opts.maxIter ?? 200;
  const tol = opts.tol ?? 1e-10;
  let lambda = Math.max(1e-12, opts.lambdaInit ?? 1e-3);
  let nu = 2;
  let params = [...initialParams];
  let sse = rssOf(modelFn, xData, yData, params, w);
  if (!Number.isFinite(sse)) {
    throw new Error('LM: the model returned a non-finite value at the initial parameters');
  }

  let converged = false;
  let message = 'maximum iterations reached';
  let iterations = 0;

  for (; iterations < maxIter; iterations += 1) {
    const J = jacobian(modelFn, xData, params);
    // A = JᵀWJ, g = JᵀWr.
    const A: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const g = new Array<number>(p).fill(0);
    const resid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      const f = modelFn(xData[i]!, params);
      resid[i] = yData[i]! - f;
      const wi = w[i]!;
      for (let a = 0; a < p; a += 1) {
        const ja = J[i]![a]!;
        g[a]! += wi * ja * resid[i]!;
        for (let b = 0; b <= a; b += 1) A[a]![b]! += wi * ja * J[i]![b]!;
      }
    }
    for (let a = 0; a < p; a += 1) {
      for (let b = a + 1; b < p; b += 1) A[a]![b] = A[b]![a]!;
    }

    // Gradient convergence: every partial derivative is numerically zero.
    let gmax = 0;
    for (const v of g) gmax = Math.max(gmax, Math.abs(v));
    const scale = Math.max(1, sse);
    if (gmax <= tol * scale) {
      converged = true;
      message = 'gradient tolerance reached';
      break;
    }

    // (A + λ diag(A)) δ = −g. A zero diagonal (unidentifiable parameter) gets
    // λ itself so the system stays positive definite.
    let accepted = false;
    for (let attempt = 0; attempt < 60 && !accepted; attempt += 1) {
      const damped: Matrix = A.map((row, i) => {
        const copy = row.slice();
        copy[i] = (copy[i]! > 0 ? copy[i]! : 1) * (1 + lambda);
        return copy;
      });
      const delta = solveSPD(damped, g);
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const candidate = params.map((v, i) => v + delta[i]!);
      const nextSse = rssOf(modelFn, xData, yData, candidate, w);
      // Gain ratio from the linear model of the residual:
      //   q(δ) = ½‖r − Jδ‖²,  q(0) − q(δ) = ½δᵀ(λDδ + g).
      let predicted = 0;
      for (let a = 0; a < p; a += 1) {
        predicted += delta[a]! * (lambda * (A[a]![a]! > 0 ? A[a]![a]! : 1) * delta[a]! + g[a]!);
      }
      predicted *= 0.5;
      const actual = sse - nextSse;
      const rho = predicted > 0 ? actual / predicted : actual > 0 ? 1 : -1;
      if (Number.isFinite(nextSse) && nextSse < sse) {
        const rel = (sse - nextSse) / Math.max(sse, 1e-300);
        params = candidate;
        sse = nextSse;
        lambda *= Math.max(1 / 3, 1 - (2 * rho - 1) ** 3);
        lambda = Math.max(1e-12, lambda);
        nu = 2;
        accepted = true;
        if (rel < tol) {
          converged = true;
          message = 'relative SSE tolerance reached';
        }
      } else {
        lambda *= nu;
        nu *= 2;
        lambda = Math.min(1e16, lambda);
      }
    }
    if (converged) break;
    if (!accepted) {
      message = 'no downhill step could be found (damping exhausted)';
      break;
    }
  }

  // ---- inference at the solution -----------------------------------------
  const J = jacobian(modelFn, xData, params);
  const A: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let a = 0; a < p; a += 1) {
      const ja = J[i]![a]! * w[i]!;
      for (let b = 0; b < p; b += 1) A[a]![b]! += ja * J[i]![b]!;
    }
  }
  const fitted = xData.map((row) => modelFn(row, params));
  const residuals = yData.map((v, i) => v - fitted[i]!);
  let sseUnweighted = 0;
  for (const r of residuals) sseUnweighted += r * r;
  const ybar = mean(yData);
  let tss = 0;
  for (const v of yData) tss += (v - ybar) ** 2;
  const dof = n - p;
  const rSquared = tss > 0 ? 1 - sseUnweighted / tss : NaN;
  const adjRSquared = tss > 0 ? 1 - (1 - rSquared) * ((n - 1) / dof) : NaN;
  const sigma2 = sseUnweighted / dof;
  const rmse = Math.sqrt(Math.max(0, sigma2));

  let cov: Matrix;
  try {
    cov = inverseSPD(A).map((row) => row.map((v) => v * sigma2));
  } catch {
    cov = Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) => (a === b ? NaN : 0)),
    );
  }

  const tcrit = Math.abs(studentTInv(0.975, dof));
  const coefficients: NonlinearParamEstimate[] = params.map((estimate, j) => {
    const se = Math.sqrt(Math.max(0, cov[j]![j]!));
    const t = se > 0 ? estimate / se : 0;
    const pval = Number.isFinite(t) && se > 0 ? 2 * (1 - studentTCdf(Math.abs(t), dof)) : NaN;
    return {
      name: paramNames[j]!,
      estimate,
      se,
      t,
      p: Number.isFinite(pval) ? Math.min(1, Math.max(0, pval)) : NaN,
      ciLow: estimate - tcrit * se,
      ciHigh: estimate + tcrit * se,
    };
  });

  const paramMap: Record<string, number> = {};
  const seMap: Record<string, number> = {};
  const ciMap: Record<string, [number, number]> = {};
  for (const c of coefficients) {
    paramMap[c.name] = c.estimate;
    seMap[c.name] = c.se;
    ciMap[c.name] = [c.ciLow, c.ciHigh];
  }

  const safeSse = Math.max(sseUnweighted, Number.MIN_VALUE);
  return {
    params: paramMap,
    paramSE: seMap,
    ci95: ciMap,
    covariance: cov,
    coefficients,
    fitted,
    residuals,
    rSquared,
    adjRSquared,
    rmse,
    sse: sseUnweighted,
    dof,
    aic: n * Math.log(safeSse / n) + 2 * p,
    bic: n * Math.log(safeSse / n) + p * Math.log(n),
    iterations,
    converged,
    lambda,
    message,
    n,
    p,
  };
}

// --------------------------------------------------------------------------
// Model library
// --------------------------------------------------------------------------

export type NonlinearModelKind =
  | 'michaelis-menten'
  | 'sigmoid4'
  | 'exponential'
  | 'power'
  | 'gaussian'
  | 'arrhenius';

/** Four-parameter log-logistic dose–response (the Prism `log(agonist) vs response` model). */
function sigmoid4(x: number[], p: number[]): number {
  const emin = p[0]!;
  const emax = p[1]!;
  const logEc50 = p[2]!;
  const hill = p[3]!;
  return emin + (emax - emin) / (1 + 10 ** ((logEc50 - x[0]!) * hill));
}

export const NONLINEAR_MODELS: Record<NonlinearModelKind, NonlinearModelSpec> = {
  'michaelis-menten': {
    id: 'michaelis-menten',
    name: 'Michaelis–Menten',
    paramNames: ['Vmax', 'Km'],
    formula: 'v = Vmax·[S]/(Km + [S])',
    model: (x, p) => (p[0]! * x[0]!) / (p[1]! + x[0]!),
    initial: (x, y) => {
      const xs = x.map((row) => row[0]!);
      return [Math.max(...y) || 1, Math.max(1e-9, median(xs))];
    },
  },
  sigmoid4: {
    id: 'sigmoid4',
    name: 'Four-parameter dose–response',
    paramNames: ['Emin', 'Emax', 'logEC50', 'Hill'],
    formula: 'E = Emin + (Emax − Emin)/(1 + 10^((logEC50 − x)·Hill))',
    model: sigmoid4,
    initial: (x, y) => {
      const xs = x.map((row) => row[0]!);
      return [Math.min(...y), Math.max(...y), median(xs), 1];
    },
  },
  exponential: {
    id: 'exponential',
    name: 'Exponential decay + offset',
    paramNames: ['A', 'k', 'C'],
    formula: 'y = A·exp(−k·x) + C',
    model: (x, p) => p[0]! * Math.exp(-p[1]! * x[0]!) + p[2]!,
    initial: (x, y) => {
      const xs = x.map((row) => row[0]!);
      const span = Math.max(...xs) - Math.min(...xs);
      const c = Math.min(...y);
      return [Math.max(Math.max(...y) - c, 1e-3), span > 0 ? 3 / span : 1, c];
    },
  },
  power: {
    id: 'power',
    name: 'Power law',
    paramNames: ['a', 'b'],
    formula: 'y = a·x^b',
    model: (x, p) => p[0]! * x[0]! ** p[1]!,
    initial: (x, y) => {
      // Log–log least squares when both axes are positive; otherwise a = ȳ.
      const lx: number[] = [];
      const ly: number[] = [];
      for (let i = 0; i < x.length; i += 1) {
        const xi = x[i]![0]!;
        const yi = y[i]!;
        if (xi > 0 && yi > 0) {
          lx.push(Math.log(xi));
          ly.push(Math.log(yi));
        }
      }
      if (lx.length >= 2) {
        const mx = mean(lx);
        const my = mean(ly);
        let num = 0;
        let den = 0;
        for (let i = 0; i < lx.length; i += 1) {
          num += (lx[i]! - mx) * (ly[i]! - my);
          den += (lx[i]! - mx) ** 2;
        }
        const b = den > 0 ? num / den : 1;
        return [Math.exp(my - b * mx), b];
      }
      return [mean(y) || 1, 1];
    },
  },
  gaussian: {
    id: 'gaussian',
    name: 'Gaussian peak + baseline',
    paramNames: ['A', 'mu', 'sigma', 'C'],
    formula: 'y = C + A·exp(−(x − mu)²/(2σ²))',
    model: (x, p) => p[3]! + p[0]! * Math.exp(-((x[0]! - p[1]!) ** 2) / (2 * p[2]! * p[2]!)),
    initial: (x, y) => {
      const xs = x.map((row) => row[0]!);
      let iMax = 0;
      for (let i = 1; i < y.length; i += 1) if (y[i]! > y[iMax]!) iMax = i;
      const span = Math.max(...xs) - Math.min(...xs);
      const c = Math.min(...y);
      return [Math.max(y[iMax]! - c, 1e-6), xs[iMax]!, span > 0 ? span / 6 : 1, c];
    },
  },
  arrhenius: {
    id: 'arrhenius',
    name: 'Arrhenius',
    paramNames: ['lnA', 'Ea'],
    formula: 'k = exp(lnA − Ea/(R·T)), R = 8.314 J/(mol·K)',
    model: (x, p) => Math.exp(p[0]! - p[1]! / (8.314 * x[0]!)),
    initial: (x, y) => {
      const xs = x.map((row) => row[0]!);
      // ln k should be linear in 1/T: fit that line for the starting point.
      const lx = xs.map((t) => 1 / t);
      const ly = y.map((v) => Math.log(Math.max(v, 1e-12)));
      const mx = mean(lx);
      const my = mean(ly);
      let num = 0;
      let den = 0;
      for (let i = 0; i < lx.length; i += 1) {
        num += (lx[i]! - mx) * (ly[i]! - my);
        den += (lx[i]! - mx) ** 2;
      }
      const slope = den > 0 ? num / den : 0;
      return [my - slope * mx, Math.max(1, -slope)];
    },
  },
};

export interface FitModelOptions extends LmOptions {
  /** Override the data-driven starting values. */
  initial?: number[];
  paramNames?: string[];
}

/**
 * Fit one of the built-in models to a single predictor. Convenience wrapper
 * around `levenbergMarquardt` that supplies initial guesses and names.
 */
export function fitNonlinearModel(
  kind: NonlinearModelKind,
  x: number[],
  y: number[],
  opts: FitModelOptions = {},
): NonlinearFitResult {
  const spec = NONLINEAR_MODELS[kind];
  if (!spec) throw new Error(`unknown nonlinear model "${String(kind)}"`);
  if (x.length !== y.length) throw new Error('fitNonlinearModel: x and y lengths must match');
  const xData = x.map((v) => [v]);
  const initial = opts.initial ?? spec.initial(xData, y);
  const names = opts.paramNames ?? spec.paramNames;
  return levenbergMarquardt(spec.model, xData, y, initial, names, opts);
}
