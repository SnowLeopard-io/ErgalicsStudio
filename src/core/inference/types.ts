// ==========================================================================
// Ergalics Studio — Inference Forge (F9) shared types (pure TS, data layer)
//
// Data model for the native Bayesian inference engine (spec §10.5): model
// definitions, sampler configuration and the aggregate inference result.
// The samplers (HMC / NUTS) always work on an *unconstrained* vector `eta`;
// constrained parameters (ParamDef.lower/upper) are mapped through a
// bijective transform whose log-Jacobian is folded into the log-posterior.
// ==========================================================================

/** Supported prior / parameter distribution families (spec FR9.1). */
export type DistKind = 'normal' | 'beta' | 'gamma' | 'halfNormal' | 'studentT' | 'uniform';

/** One model parameter: prior, optional start value and optional box support. */
export interface ParamDef {
  name: string;
  /** Prior distribution; `params` values may be numbers or the *name* of
   *  another (scalar) parameter — used by hierarchical models, e.g. a group
   *  effect's prior `normal(mu, tau)` references the hyperparameters. */
  prior: { dist: DistKind; params: Record<string, number | string> };
  /** Scalar params only; vector params are expanded by the template. */
  init?: number;
  /** Support bounds — compiled into a bijective transform (log / logit). */
  lower?: number;
  upper?: number;
}

/** Likelihood templates (spec FR9.1: fit without writing code). Data arrays
 *  are keyed by name in the `ModelData` record passed to `buildModel`. */
export type LikelihoodSpec =
  /** y_i ~ N(a + b * x_i, sigma) — normal linear regression. */
  | { kind: 'normal-linear'; a: string; b: string; sigma: string; y: string; x: string }
  /** y_i ~ N(mu, sigma) — simple normal location model. */
  | { kind: 'normal-mean'; mu: string; sigma: string; y: string }
  /** y_i ~ N(theta_{g_i}, sigma) with theta_j ~ N(mu, tau) — 8-schools-style
   *  hierarchical normal-mean model; one scalar theta param per group. */
  | { kind: 'normal-hierarchical'; mu: string; tau: string; sigma: string; y: string; group: string };

/** Declarative model description. Either a `likelihood` template (plus the
 *  param priors) or a raw user `logPost` over the constrained parameters. */
export interface ModelSpec {
  params: ParamDef[];
  likelihood?: LikelihoodSpec;
  /** Custom log-posterior over the constrained parameters. Treated as the
   *  full log density (prior + likelihood); must return -Infinity outside
   *  the support. Gradients are taken numerically. */
  logPost?: (theta: Record<string, number>) => number;
}

/** Named data arrays referenced by the likelihood spec. */
export type ModelData = Record<string, ArrayLike<number>>;

/** A model compiled to a sampler-ready closure (unconstrained space). */
export interface CompiledModel {
  paramNames: string[];
  /** Total number of scalar parameters (= eta length). */
  dim: number;
  /** log p(eta) over the *unconstrained* vector, Jacobian included. */
  logPost: (eta: Float64Array) => number;
  /** Unconstrained eta -> constrained parameter values (flat, param order). */
  transform: (eta: Float64Array) => Float64Array;
  /** Constrained values -> unconstrained eta. */
  inverseTransform: (theta: Float64Array) => Float64Array;
  /** Default unconstrained starting point (from ParamDef.init or a safe
   *  support-aware default). Samplers add a deterministic per-chain jitter. */
  init: Float64Array;
  /** Build the `{name: value}` record for one constrained draw. */
  named: (theta: Float64Array) => Record<string, number>;
}

export interface InferenceConfig {
  chains: number;
  warmup: number;
  samples: number;
  seed: number;
  algorithm: 'hmc' | 'nuts';
  targetAccept: number;
  thin?: number;
}

export interface ParamSummary {
  mean: number;
  sd: number;
  median: number;
  hdi94: [number, number];
  mcse: number;
}

export interface InferenceDiagnostics {
  rHat: Record<string, number>;
  essBulk: Record<string, number>;
  essTail: Record<string, number>;
}

export interface InferenceResult {
  /** Post-warmup draws flattened across chains, per parameter. */
  samples: Record<string, Float64Array>;
  diagnostics: InferenceDiagnostics;
  summary: Record<string, ParamSummary>;
  waic?: { elpd: number; se: number; p_eff: number };
  loo?: { elpd: number; se: number; paretoK: number[] };
  ppc?: { stat: string; observed: number; simulated: Float64Array; pValue: number };
  timing: { warmupMs: number; samplingMs: number; chains: number };
}

/** Per-chain sampler output before flattening. */
export interface ChainSamples {
  /** One draw array per scalar parameter (unconstrained order). */
  samples: Float64Array[];
  acceptRate: number;
  stepSize: number;
  divergences: number;
  warmupMs: number;
  samplingMs: number;
}
