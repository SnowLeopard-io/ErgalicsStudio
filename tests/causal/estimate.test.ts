import { describe, expect, it } from 'vitest';
import { didEstimate, ipwAte } from '@/core/causal/estimate';

/** Deterministic LCG so the synthetic sample is reproducible. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('causal effect estimators', () => {
  it('IPW recovers a known ATE under covariate confounding', () => {
    const next = rng(42);
    const treatment: number[] = [];
    const outcomes: number[] = [];
    const covariates: number[][] = [];
    for (let i = 0; i < 1500; i += 1) {
      const x = next() < 0.5 ? 0 : 1;
      const p = x === 1 ? 0.8 : 0.2;
      const t = next() < p ? 1 : 0;
      // True effect of T is 2; X is a confounder with effect 3.
      const y = 2 * t + 3 * x + (next() - 0.5);
      treatment.push(t);
      outcomes.push(y);
      covariates.push([x]);
    }
    const result = ipwAte({ treatment, outcomes, covariates });
    expect(result.ate).toBeGreaterThan(1.7);
    expect(result.ate).toBeLessThan(2.3);
    expect(result.propensities).toHaveLength(1500);
    expect(result.effectiveSampleSize).toBeGreaterThan(100);
  });

  it('IPW rejects mismatched inputs and single-arm data', () => {
    expect(() => ipwAte({ treatment: [], outcomes: [], covariates: [] })).toThrow();
    expect(() =>
      ipwAte({ treatment: [1, 1], outcomes: [1, 2], covariates: [[0], [1]] }),
    ).toThrow();
  });

  it('DiD subtracts the control trend and reports a confidence interval', () => {
    const result = didEstimate({
      treated: { before: [1, 2, 3], after: [5, 6, 7] },
      control: { before: [2, 3, 4], after: [3, 4, 5] },
    });
    expect(result.treatedChange).toBeCloseTo(4);
    expect(result.controlChange).toBeCloseTo(1);
    expect(result.att).toBeCloseTo(3);
    expect(result.confidenceInterval[0]).toBeLessThan(result.att);
    expect(result.confidenceInterval[1]).toBeGreaterThan(result.att);
  });
});
