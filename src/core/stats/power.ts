// ==========================================================================
// Ergalics Studio — statistical power
//
// Power for a two-sample t-test, computed via the normal approximation to the
// noncentral-t distribution. Given an effect size (Cohen's d), per-group sample
// size and significance level, returns the probability of rejecting H0 when the
// alternative holds. Accurate enough for planning (the classic d=0.5, n=64,
// α=0.05 benchmark yields ≈0.80).
// ==========================================================================

import { normalCdf, normalInv } from './special';

/**
 * Power of a two-sample t-test.
 * @param d        standardized effect size (Cohen's d)
 * @param nPerGroup sample size in *each* group
 * @param alpha    significance level
 * @param twoSided whether the test is two-sided (default true)
 */
export function twoSampleTTestPower(
  d: number,
  nPerGroup: number,
  alpha = 0.05,
  twoSided = true,
): number {
  const ncp = Math.abs(d) * Math.sqrt(nPerGroup / 2);
  const zcrit = normalInv(1 - alpha / (twoSided ? 2 : 1));
  return 1 - normalCdf(zcrit - ncp);
}
