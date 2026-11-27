// ==========================================================================
// Ergalics Studio — causal effect estimators (pure TS)
//
// Given an adjustment set from `graph.ts`, this module turns observational
// data into an effect estimate:
//
//   • IPW fits a logistic propensity model and reweights the observed outcome
//     by 1/P(treatment | covariates) (stabilised weights, clipped tails);
//   • DiD compares before/after changes between treated and control groups,
//     with a standard error and a normal-approximation interval.
//
// Both are deliberately explicit about assumptions: neither can repair an
// invalid adjustment set, and IPW is sensitive to extreme propensities.
// ==========================================================================

import { logisticFit } from '@/core/model/logistic';

export interface IpwInput {
  /** 1 = treated, 0 = control. */
  treatment: number[];
  outcomes: number[];
  /** One covariate row per unit; all columns are standardised internally. */
  covariates: number[][];
  /** Maximum IRLS iterations for the propensity model. */
  iterations?: number;
  /** Propensities outside [clip, 1-clip] are clamped (default 0.01). */
  clip?: number;
}

export interface IpwResult {
  ate: number;
  /** Mean of the stabilised weights (a useful diagnostic for overlap). */
  meanWeight: number;
  effectiveSampleSize: number;
  propensities: number[];
  iterations: number;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
}

/** Standardised covariates; `logisticFit` adds the intercept column itself. */
function design(covariates: number[][]): number[][] {
  const columns = covariates[0]?.length ?? 0;
  const centers: number[] = [];
  const scales: number[] = [];
  for (let j = 0; j < columns; j += 1) {
    const values = covariates.map((row) => row[j] ?? 0);
    centers.push(mean(values));
    scales.push(Math.sqrt(variance(values)) || 1);
  }
  return covariates.map((row) => row.map((value, j) => ((value ?? 0) - centers[j]!) / scales[j]!));
}

/**
 * Inverse-probability-of-treatment-weighted average treatment effect.
 * Weights are stabilised by the marginal treatment probability, which keeps
 * the estimate on the outcome scale and reduces variance from extreme weights.
 */
export function ipwAte(input: IpwInput): IpwResult {
  const n = input.treatment.length;
  if (n === 0 || input.outcomes.length !== n || input.covariates.length !== n) {
    throw new Error('IPW requires treatment, outcomes and covariates of equal length');
  }
  const matrix = design(input.covariates);
  const clip = input.clip ?? 0.01;
  // Reuse the workbench's IRLS logistic regression instead of duplicating a
  // propensity model here (same standardisation, better convergence).
  const fit = logisticFit(input.treatment, matrix, {
    ...(input.iterations !== undefined ? { maxIter: input.iterations } : {}),
    ridge: 1e-6,
  });
  const propensities = fit.probs.map((p) => Math.min(1 - clip, Math.max(clip, p)));
  const pTreat = mean(input.treatment);
  if (pTreat <= 0 || pTreat >= 1) {
    throw new Error('IPW requires both treated and control units');
  }

  let treatedSum = 0;
  let controlSum = 0;
  let treatedWeight = 0;
  let controlWeight = 0;
  const allWeights: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = propensities[i]!;
    const treated = input.treatment[i] === 1;
    const w = treated ? pTreat / p : (1 - pTreat) / (1 - p);
    allWeights.push(w);
    if (treated) {
      treatedSum += w * input.outcomes[i]!;
      treatedWeight += w;
    } else {
      controlSum += w * input.outcomes[i]!;
      controlWeight += w;
    }
  }
  if (treatedWeight === 0 || controlWeight === 0) {
    throw new Error('IPW requires both treated and control units');
  }
  const meanWeight = mean(allWeights);
  return {
    ate: treatedSum / treatedWeight - controlSum / controlWeight,
    meanWeight,
    effectiveSampleSize: allWeights.length > 0
      ? allWeights.reduce((s, w) => s + w, 0) ** 2 / allWeights.reduce((s, w) => s + w * w, 0)
      : 0,
    propensities,
    iterations: fit.iterations,
  };
}

export interface DidGroup {
  before: number[];
  after: number[];
}

export interface DidInput {
  treated: DidGroup;
  control: DidGroup;
  /** Two-sided critical value; defaults to 1.96 (95%). */
  z?: number;
}

export interface DidResult {
  /** Average treatment effect on the treated: Δtreated − Δcontrol. */
  att: number;
  treatedChange: number;
  controlChange: number;
  standardError: number;
  confidenceInterval: [number, number];
}

/** Canonical 2×2 difference-in-differences estimator. */
export function didEstimate(input: DidInput): DidResult {
  const { treated, control } = input;
  if (
    treated.before.length === 0 || treated.after.length === 0 ||
    control.before.length === 0 || control.after.length === 0
  ) {
    throw new Error('DiD requires before/after observations in both groups');
  }
  const treatedChange = mean(treated.after) - mean(treated.before);
  const controlChange = mean(control.after) - mean(control.before);
  const att = treatedChange - controlChange;
  const v =
    variance(treated.before) / treated.before.length +
    variance(treated.after) / treated.after.length +
    variance(control.before) / control.before.length +
    variance(control.after) / control.after.length;
  const standardError = Math.sqrt(v);
  const z = input.z ?? 1.96;
  return {
    att,
    treatedChange,
    controlChange,
    standardError,
    confidenceInterval: [att - z * standardError, att + z * standardError],
  };
}
