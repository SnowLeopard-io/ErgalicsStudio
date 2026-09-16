// ==========================================================================
// Ergalics Studio — Inference Forge model DSL (pure TS, data layer)
//
// Compiles a declarative ModelSpec (params + priors + likelihood template, or
// a raw user logPost) into a sampler-ready closure over the *unconstrained*
// vector. Constrained parameters are mapped through bijective transforms with
// the log-Jacobian folded into logPost, so HMC/NUTS can freely move on the
// real line (spec FR9.1). Gradients are numeric (central differences) — the
// model closures are tiny, so the O(dim) extra evaluations per leapfrog step
// are negligible at the scales this engine targets.
// ==========================================================================

import type {
  CompiledModel,
  DistKind,
  ModelData,
  ModelSpec,
  ParamDef,
} from './types';

const LOG_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

/** log Gamma via the Lanczos approximation (g=7, n=9) — accurate to ~1e-13. */
export function logGamma(x: number): number {
  if (x < 0.5) {
    // Reflection formula for small arguments.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i += 1) a += c[i]! / (x + i);
  return LOG_SQRT_2PI + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function logSigmoid(x: number): number {
  return -Math.log1p(Math.exp(-x));
}

// ---------------------------------------------------------------------------
// Priors: log densities (normalising constants kept — cheap and aids
// model-comparison workflows).
// ---------------------------------------------------------------------------

/** Resolve a prior hyper-parameter: numbers pass through, strings reference
 *  another (scalar) parameter's current constrained value. */
function hyper(spec: number | string | undefined, values: Record<string, number>): number {
  if (typeof spec === 'number') return spec;
  if (spec === undefined) return 0;
  return values[spec] ?? Number.NaN;
}

/** Compile one prior into a log-density over a constrained value. */
function compilePrior(dist: DistKind, raw: Record<string, number | string>): (x: number, v: Record<string, number>) => number {
  switch (dist) {
    case 'normal': {
      const mu = raw.mu ?? 0;
      const sigma = raw.sigma ?? 1;
      return (x, v) => {
        const s = hyper(sigma, v);
        if (!(s > 0)) return -Infinity;
        const z = (x - hyper(mu, v)) / s;
        return -0.5 * z * z - Math.log(s) - LOG_SQRT_2PI;
      };
    }
    case 'beta': {
      const alpha = raw.alpha ?? 1;
      const beta = raw.beta ?? 1;
      return (x, v) => {
        if (x <= 0 || x >= 1) return -Infinity;
        const a = hyper(alpha, v);
        const b = hyper(beta, v);
        const norm = logGamma(a) + logGamma(b) - logGamma(a + b);
        return (a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - norm;
      };
    }
    case 'gamma': {
      const shape = raw.shape ?? 1;
      const rate = raw.rate ?? 1;
      return (x, v) => {
        if (x <= 0) return -Infinity;
        const k = hyper(shape, v);
        const r = hyper(rate, v);
        if (!(k > 0) || !(r > 0)) return -Infinity;
        return k * Math.log(r) - logGamma(k) + (k - 1) * Math.log(x) - r * x;
      };
    }
    case 'halfNormal': {
      const sigma = raw.sigma ?? 1;
      return (x, v) => {
        if (x < 0) return -Infinity;
        const s = hyper(sigma, v);
        if (!(s > 0)) return -Infinity;
        return 0.5 * Math.log(2 / Math.PI) - Math.log(s) - 0.5 * (x / s) * (x / s);
      };
    }
    case 'studentT': {
      const mu = raw.mu ?? 0;
      const sigma = raw.sigma ?? 1;
      const nu = raw.nu ?? 4;
      return (x, v) => {
        const s = hyper(sigma, v);
        const n = hyper(nu, v);
        if (!(s > 0) || !(n > 0)) return -Infinity;
        const z = (x - hyper(mu, v)) / s;
        return (
          logGamma((n + 1) / 2) - logGamma(n / 2) - 0.5 * Math.log(n * Math.PI) - Math.log(s)
          - ((n + 1) / 2) * Math.log1p((z * z) / n)
        );
      };
    }
    case 'uniform': {
      const low = raw.low ?? 0;
      const high = raw.high ?? 1;
      return (x, v) => {
        const lo = hyper(low, v);
        const hi = hyper(high, v);
        return x >= lo && x <= hi && hi > lo ? -Math.log(hi - lo) : -Infinity;
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Support bounds -> bijective unconstrained transforms
// ---------------------------------------------------------------------------

interface Transform {
  fwd: (eta: number) => number;
  inv: (theta: number) => number;
  /** log |d theta / d eta| */
  logJacobian: (eta: number) => number;
}

const identity: Transform = { fwd: (e) => e, inv: (t) => t, logJacobian: () => 0 };

function transformFor(lower: number | undefined, upper: number | undefined): Transform {
  if (lower !== undefined && upper !== undefined) {
    // Logit: theta = lower + (upper - lower) * sigmoid(eta).
    const span = upper - lower;
    return {
      fwd: (e) => lower + span / (1 + Math.exp(-e)),
      inv: (t) => Math.log((t - lower) / (upper - t)),
      logJacobian: (e) => Math.log(span) + logSigmoid(e) + logSigmoid(-e),
    };
  }
  if (lower !== undefined) {
    // Shifted log: theta = lower + exp(eta), log|J| = eta.
    return {
      fwd: (e) => lower + Math.exp(e),
      inv: (t) => Math.log(t - lower),
      logJacobian: (e) => e,
    };
  }
  if (upper !== undefined) {
    // theta = upper - exp(eta).
    return {
      fwd: (e) => upper - Math.exp(e),
      inv: (t) => Math.log(upper - t),
      logJacobian: (e) => e,
    };
  }
  return identity;
}

/** Support of the prior family expressed as bounds (undefined = unbounded),
 *  unless the user set explicit bounds on the parameter. */
function familyBounds(param: ParamDef): { lower?: number; upper?: number } {
  if (param.lower !== undefined || param.upper !== undefined) return param;
  switch (param.prior.dist) {
    case 'gamma':
    case 'halfNormal':
      return { lower: 0 };
    case 'beta':
      return { lower: 0, upper: 1 };
    default:
      return {};
  }
}

/** Starting value for a parameter: explicit init, else a safe point inside
 *  the support (0 for unbounded, lower + 1 for one-sided, midpoint otherwise). */
function initValue(param: ParamDef): number {
  if (param.init !== undefined) return param.init;
  const { lower, upper } = familyBounds(param);
  if (lower !== undefined && upper !== undefined) return (lower + upper) / 2;
  if (lower !== undefined) return lower + 1;
  if (upper !== undefined) return upper - 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Likelihood templates
// ---------------------------------------------------------------------------

function getData(data: ModelData, key: string): ArrayLike<number> {
  const arr = data[key];
  if (!arr) throw new Error(`model data missing array: ${key}`);
  return arr;
}

function likelihoodTerm(
  spec: NonNullable<ModelSpec['likelihood']>,
  data: ModelData,
): (values: Record<string, number>) => number {
  switch (spec.kind) {
    case 'normal-linear': {
      const y = Float64Array.from(getData(data, spec.y));
      const x = Float64Array.from(getData(data, spec.x));
      if (y.length !== x.length) throw new Error('normal-linear: y and x must have equal length');
      return (t) => {
        const a = t[spec.a] ?? Number.NaN;
        const b = t[spec.b] ?? Number.NaN;
        const s = t[spec.sigma] ?? Number.NaN;
        if (!(s > 0) || !Number.isFinite(a) || !Number.isFinite(b)) return -Infinity;
        const inv2 = 1 / (2 * s * s);
        let ss = 0;
        for (let i = 0; i < y.length; i += 1) {
          const d = y[i]! - (a + b * x[i]!);
          ss += d * d;
        }
        return -y.length * Math.log(s) - y.length * LOG_SQRT_2PI - ss * inv2;
      };
    }
    case 'normal-mean': {
      const y = Float64Array.from(getData(data, spec.y));
      return (t) => {
        const m = t[spec.mu] ?? Number.NaN;
        const s = t[spec.sigma] ?? Number.NaN;
        if (!(s > 0) || !Number.isFinite(m)) return -Infinity;
        const inv2 = 1 / (2 * s * s);
        let ss = 0;
        for (let i = 0; i < y.length; i += 1) {
          const d = y[i]! - m;
          ss += d * d;
        }
        return -y.length * Math.log(s) - y.length * LOG_SQRT_2PI - ss * inv2;
      };
    }
    case 'normal-hierarchical': {
      const y = Float64Array.from(getData(data, spec.y));
      const g = Int32Array.from(getData(data, spec.group));
      if (y.length !== g.length) throw new Error('normal-hierarchical: y and group must have equal length');
      return (t) => {
        const s = t[spec.sigma] ?? Number.NaN;
        if (!(s > 0)) return -Infinity;
        const inv2 = 1 / (2 * s * s);
        let ll = 0;
        for (let i = 0; i < y.length; i += 1) {
          const m = t[`theta_${g[i]}`] ?? Number.NaN;
          if (!Number.isFinite(m)) return -Infinity;
          const d = y[i]! - m;
          ll += -Math.log(s) - LOG_SQRT_2PI - d * d * inv2;
        }
        return ll;
      };
    }
  }
}

// ---------------------------------------------------------------------------
// buildModel
// ---------------------------------------------------------------------------

/**
 * Compile a model spec into closures over the unconstrained vector:
 *   logPost(eta) = logPrior(transform(eta)) [+ logLik] [+ userLogPost] + log|J|
 * A custom user logPost is treated exactly like the DSL pieces — it expresses
 * a density over the constrained parameters, so the Jacobian still applies.
 */
export function buildModel(spec: ModelSpec, data: ModelData): CompiledModel {
  if (spec.params.length === 0) throw new Error('model needs at least one parameter');
  const names: string[] = [];
  for (const p of spec.params) {
    if (names.includes(p.name)) throw new Error(`duplicate parameter name: ${p.name}`);
    names.push(p.name);
  }

  const transforms = spec.params.map((p) => transformFor(familyBounds(p).lower, familyBounds(p).upper));
  const priors = spec.params.map((p) => compilePrior(p.prior.dist, p.prior.params));
  const userLogPost = spec.logPost;
  const likTerm = spec.likelihood ? likelihoodTerm(spec.likelihood, data) : null;
  // Per-parameter init mapped to the unconstrained scale.
  const initsEta = spec.params.map((p, i) => transforms[i]!.inv(initValue(p)));

  const transform = (eta: Float64Array): Float64Array => {
    const out = new Float64Array(eta.length);
    for (let i = 0; i < eta.length; i += 1) out[i] = transforms[i]!.fwd(eta[i]!);
    return out;
  };
  const inverseTransform = (theta: Float64Array): Float64Array => {
    const out = new Float64Array(theta.length);
    for (let i = 0; i < theta.length; i += 1) out[i] = transforms[i]!.inv(theta[i]!);
    return out;
  };
  const named = (theta: Float64Array): Record<string, number> => {
    const out: Record<string, number> = {};
    for (let i = 0; i < names.length; i += 1) out[names[i]!] = theta[i] ?? Number.NaN;
    return out;
  };

  const logPost = (eta: Float64Array): number => {
    const theta = transform(eta);
    const values = named(theta);
    let lp = 0;
    for (let i = 0; i < spec.params.length; i += 1) {
      const term = priors[i]!(theta[i]!, values);
      if (!Number.isFinite(term)) return -Infinity;
      lp += term;
    }
    if (likTerm) {
      const ll = likTerm(values);
      if (!Number.isFinite(ll)) return -Infinity;
      lp += ll;
    }
    if (userLogPost) {
      const lu = userLogPost(values);
      if (!Number.isFinite(lu)) return -Infinity;
      lp += lu;
    }
    for (let i = 0; i < eta.length; i += 1) {
      const j = transforms[i]!.logJacobian(eta[i]!);
      if (!Number.isFinite(j)) return -Infinity;
      lp += j;
    }
    return lp;
  };

  return {
    paramNames: names,
    dim: names.length,
    logPost,
    transform,
    inverseTransform,
    init: Float64Array.from(initsEta),
    named,
  };
}

/**
 * Central-difference gradient of a scalar field. Used by HMC/NUTS for every
 * model (the DSL compiles to plain closures, so there is no AD graph to
 * differentiate; finite differences keep the sampler model-agnostic).
 */
export function numericGradient(
  f: (x: Float64Array) => number,
  theta: Float64Array,
  eps = 1e-5,
): Float64Array {
  const g = new Float64Array(theta.length);
  const probe = Float64Array.from(theta);
  for (let i = 0; i < theta.length; i += 1) {
    const h = eps * Math.max(1, Math.abs(theta[i]!));
    probe[i] = theta[i]! + h;
    const fp = f(probe);
    probe[i] = theta[i]! - h;
    const fm = f(probe);
    probe[i] = theta[i]!;
    // Non-finite sides (outside support) fall back to the finite one.
    if (Number.isFinite(fp) && Number.isFinite(fm)) {
      g[i] = (fp - fm) / (2 * h);
    } else if (Number.isFinite(fp)) {
      probe[i] = theta[i]!;
      g[i] = (fp - f(probe)) / h;
    } else if (Number.isFinite(fm)) {
      probe[i] = theta[i]!;
      g[i] = (f(probe) - fm) / h;
    } else {
      g[i] = 0;
    }
  }
  return g;
}
