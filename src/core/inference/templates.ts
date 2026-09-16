// ==========================================================================
// Ergalics Studio — Inference Forge likelihood templates (pure TS, data layer)
//
// UI-facing glue for FR9.1/FR9.6: turns numeric columns into a compiled
// ModelSpec with weakly-informative, data-scaled priors (no hand-tuned
// hyper-parameters required), plus the pointwise log-likelihood and posterior
// predictive simulators the Forge UI needs for WAIC / LOO / PPC (FR9.4/FR9.5).
// ==========================================================================

import type { ModelData, ModelSpec } from './types';

/** The three declarative templates the Forge UI exposes. */
export type TemplateKind = 'normal-mean' | 'normal-linear' | 'normal-hierarchical';

export interface TemplateArrays {
  y: ArrayLike<number>;
  /** Predictor — normal-linear only. */
  x?: ArrayLike<number>;
  /** Integer group codes — normal-hierarchical only. */
  group?: ArrayLike<number>;
}

export interface BuiltTemplate {
  kind: TemplateKind;
  spec: ModelSpec;
  data: ModelData;
  /** Group codes present in the data (hierarchical only, sorted). */
  groups: number[];
}

interface Moment {
  mean: number;
  sd: number;
}

function moment(x: ArrayLike<number>): Moment {
  let s = 0;
  let n = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i]!;
    if (Number.isFinite(v)) {
      s += v;
      n += 1;
    }
  }
  const mean = n > 0 ? s / n : 0;
  let ss = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i]!;
    if (Number.isFinite(v)) ss += (v - mean) * (v - mean);
  }
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 1;
  return { mean, sd: Math.max(sd, 1e-3) };
}

function cols(x: ArrayLike<number>): number[] {
  return Array.from(x, (v) => v);
}

/**
 * Build a template model with weakly-informative, data-scaled priors and
 * support-aware inits (group means for hierarchical thetas, guarded OLS
 * coefficients for the linear template) so chains start in the typical set.
 */
export function buildTemplate(kind: TemplateKind, arrays: TemplateArrays): BuiltTemplate {
  const y = cols(arrays.y);
  const my = moment(arrays.y);
  const scale = my.sd;

  if (kind === 'normal-mean') {
    return {
      kind,
      groups: [],
      data: { y },
      spec: {
        params: [
          { name: 'mu', prior: { dist: 'normal', params: { mu: my.mean, sigma: 10 * scale } }, init: my.mean },
          { name: 'sigma', prior: { dist: 'halfNormal', params: { sigma: scale } }, init: scale },
        ],
        likelihood: { kind: 'normal-mean', mu: 'mu', sigma: 'sigma', y: 'y' },
      },
    };
  }

  if (kind === 'normal-linear') {
    if (!arrays.x) throw new Error('normal-linear needs an x column');
    const x = cols(arrays.x);
    const mx = moment(arrays.x);
    // Guarded least-squares slope/intercept as starting values.
    let num = 0;
    let den = 0;
    for (let i = 0; i < y.length; i += 1) {
      const dx = x[i]! - mx.mean;
      num += dx * (y[i]! - my.mean);
      den += dx * dx;
    }
    const b0 = den > 0 ? num / den : 0;
    const a0 = my.mean - b0 * mx.mean;
    return {
      kind,
      groups: [],
      data: { y, x },
      spec: {
        params: [
          { name: 'a', prior: { dist: 'normal', params: { mu: my.mean, sigma: 10 * scale } }, init: a0 },
          { name: 'b', prior: { dist: 'normal', params: { mu: 0, sigma: 10 * (my.sd / mx.sd) } }, init: b0 },
          { name: 'sigma', prior: { dist: 'halfNormal', params: { sigma: scale } }, init: scale },
        ],
        likelihood: { kind: 'normal-linear', a: 'a', b: 'b', sigma: 'sigma', y: 'y', x: 'x' },
      },
    };
  }

  // normal-hierarchical: one theta per observed group code.
  if (!arrays.group) throw new Error('normal-hierarchical needs a group column');
  const g = Array.from(arrays.group, (v) => Math.trunc(v));
  const groups = [...new Set(g)].sort((a, b) => a - b);
  const groupMean = new Map<number, number>();
  for (const code of groups) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < y.length; i += 1) {
      if (g[i] === code) {
        s += y[i]!;
        n += 1;
      }
    }
    groupMean.set(code, n > 0 ? s / n : my.mean);
  }
  const params: ModelSpec['params'] = [
    { name: 'mu', prior: { dist: 'normal', params: { mu: my.mean, sigma: 10 * scale } }, init: my.mean },
    { name: 'tau', prior: { dist: 'halfNormal', params: { sigma: Math.max(scale, 0.1) } }, init: Math.max(scale, 0.1) },
    { name: 'sigma', prior: { dist: 'halfNormal', params: { sigma: Math.max(scale, 0.1) } }, init: Math.max(scale, 0.1) },
  ];
  for (const code of groups) {
    params.push({
      name: `theta_${code}`,
      prior: { dist: 'normal', params: { mu: 'mu', sigma: 'tau' } },
      init: groupMean.get(code) ?? my.mean,
    });
  }
  return {
    kind,
    groups,
    data: { y, group: g },
    spec: {
      params,
      likelihood: { kind: 'normal-hierarchical', mu: 'mu', tau: 'tau', sigma: 'sigma', y: 'y', group: 'group' },
    },
  };
}

/** Mean of observation i under one constrained posterior draw. */
export function templateMean(
  kind: TemplateKind,
  theta: Record<string, number>,
  arrays: TemplateArrays,
  i: number,
): number {
  const sigma = theta.sigma ?? Number.NaN;
  if (!Number.isFinite(sigma) || sigma <= 0) return Number.NaN;
  if (kind === 'normal-mean') return theta.mu ?? Number.NaN;
  if (kind === 'normal-linear') {
    const x = arrays.x?.[i];
    return (theta.a ?? Number.NaN) + (theta.b ?? Number.NaN) * (x ?? Number.NaN);
  }
  const code = Math.trunc(arrays.group?.[i] ?? Number.NaN);
  return theta[`theta_${code}`] ?? Number.NaN;
}

const LOG_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

/** Pointwise log-likelihood log p(y_i | theta) for WAIC / LOO matrices. */
export function templateLogLik(
  kind: TemplateKind,
  theta: Record<string, number>,
  arrays: TemplateArrays,
  i: number,
): number {
  const sigma = theta.sigma ?? Number.NaN;
  if (!(sigma > 0)) return Number.NaN;
  const mu = templateMean(kind, theta, arrays, i);
  if (!Number.isFinite(mu)) return Number.NaN;
  const d = arrays.y[i]! - mu;
  return -Math.log(sigma) - LOG_SQRT_2PI - (d * d) / (2 * sigma * sigma);
}

/**
 * Posterior predictive simulator (PPC): one replicated dataset of the same
 * shape as the observations, drawn deterministically from `rand`.
 */
export function templateSim(
  kind: TemplateKind,
  theta: Record<string, number>,
  arrays: TemplateArrays,
  rand: () => number,
): Float64Array {
  const sigma = theta.sigma ?? Number.NaN;
  const out = new Float64Array(arrays.y.length);
  if (!(sigma > 0)) return out.fill(Number.NaN);
  // Box-Muller standard normals.
  const normal = (): number => {
    let u1 = rand();
    while (u1 <= 0) u1 = rand();
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  for (let i = 0; i < out.length; i += 1) {
    out[i] = templateMean(kind, theta, arrays, i) + sigma * normal();
  }
  return out;
}
