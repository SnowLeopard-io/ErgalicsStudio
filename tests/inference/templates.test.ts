// ==========================================================================
// Inference Forge templates + UI-level pipeline (F9) — unit tests
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { buildTemplate, templateLogLik, templateSim, templateMean } from '@/core/inference/templates';
import { buildModel } from '@/core/inference/model';
import { runHmc } from '@/core/inference/hmc';
import { constrainChains, summarizeChains, posteriorPredictive } from '@/core/inference/diag';
import { loo, waic } from '@/core/inference/compare';

/** Deterministic Gaussian stream (mulberry32 + Box–Muller). */
function gauss(seed: number): () => number {
  let s = seed >>> 0;
  let cache: number | null = null;
  return () => {
    if (cache !== null) {
      const v = cache;
      cache = null;
      return v;
    }
    s = (s + 0x6d2b79f5) >>> 0;
    let z = (s ^ (s >>> 15)) >>> 0;
    z = Math.imul(z, 0x2c1b3c6d);
    z = (Math.imul(z ^ (z >>> 12), 0x297a2d39) ^ (z ^ (z >>> 15) * 0x1d) >>> 0) >>> 0;
    const u1 = (z + 1) / 4294967297;
    const u2 = (Math.imul(s ^ (s >>> 7), 0x85ebca6b) >>> 0) / 4294967296;
    const r = Math.sqrt(-2 * Math.log(u1));
    cache = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  };
}

describe('buildTemplate', () => {
  it('normal-mean: data-scaled weak priors + inits', () => {
    const y = Float64Array.from({ length: 50 }, ((g) => () => 3 + 2 * g())(gauss(7)));
    const built = buildTemplate('normal-mean', { y });
    expect(built.spec.params.map((p) => p.name)).toEqual(['mu', 'sigma']);
    const mu = built.spec.params[0]!;
    expect(mu.init).toBeCloseTo(3, 1);
    expect(mu.prior.dist).toBe('normal');
    expect(built.spec.likelihood).toMatchObject({ kind: 'normal-mean' });
  });

  it('normal-linear: guarded OLS init', () => {
    const n = 60;
    const g = gauss(11);
    const x = Float64Array.from({ length: n }, () => g());
    const y = Float64Array.from({ length: n }, (_, i) => 1.5 + 2 * x[i]! + 0.1 * g());
    const built = buildTemplate('normal-linear', { y, x });
    const names = built.spec.params.map((p) => p.name);
    expect(names).toEqual(['a', 'b', 'sigma']);
    const a = built.spec.params[0]!;
    const b = built.spec.params[1]!;
    expect(a.init).toBeCloseTo(1.5, 1);
    expect(b.init).toBeCloseTo(2, 1);
  });

  it('normal-hierarchical: one theta per group, referenced priors', () => {
    const y = [1, 1.2, 0.8, 5, 5.4, 4.7];
    const group = [0, 0, 0, 1, 1, 1];
    const built = buildTemplate('normal-hierarchical', { y: Float64Array.from(y), group: Float64Array.from(group) });
    expect(built.groups).toEqual([0, 1]);
    const names = built.spec.params.map((p) => p.name);
    expect(names).toEqual(['mu', 'tau', 'sigma', 'theta_0', 'theta_1']);
    const theta0 = built.spec.params[3]!;
    expect(theta0.prior.params).toEqual({ mu: 'mu', sigma: 'tau' });
    expect(theta0.init).toBeCloseTo(1, 1);
    expect(() => buildTemplate('normal-hierarchical', { y: Float64Array.from(y) })).toThrow();
  });
});

describe('templateLogLik / templateSim', () => {
  it('log-lik peaks at the generating parameters and PPC sims scatter around the mean', () => {
    const y = Float64Array.from([2, 3, 4]);
    const arrays = { y };
    const good = { mu: 3, sigma: 1 };
    const bad = { mu: 30, sigma: 1 };
    let llGood = 0;
    let llBad = 0;
    for (let i = 0; i < y.length; i += 1) {
      llGood += templateLogLik('normal-mean', good, arrays, i);
      llBad += templateLogLik('normal-mean', bad, arrays, i);
      expect(templateMean('normal-mean', good, arrays, i)).toBe(3);
    }
    expect(llGood).toBeGreaterThan(llBad);

    let s = 12345;
    const rand = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const sim = templateSim('normal-mean', good, arrays, rand);
    expect(sim.length).toBe(3);
    const simMean = (sim[0]! + sim[1]! + sim[2]!) / 3;
    expect(Math.abs(simMean - 3)).toBeLessThan(2);
  });
});

describe('end-to-end: template → buildModel → HMC → summaries → WAIC/LOO/PPC', () => {
  it('recovers mu/sigma, converges, and stays deterministic', async () => {
    const g = gauss(99);
    const y = Float64Array.from({ length: 80 }, () => 5 + 2 * g());
    const built = buildTemplate('normal-mean', { y });
    const model = buildModel(built.spec, built.data);
    const cfg = { chains: 2, warmup: 200, samples: 300, seed: 2026, algorithm: 'hmc' as const, targetAccept: 0.8 };
    const samplerRun = await runHmc(model, cfg, {});
    const constrained = constrainChains(samplerRun.chains, model);
    const { samples, diagnostics, summary } = summarizeChains(constrained, model.paramNames);

    const mu = summary.mu!;
    expect(Math.abs(mu.mean - 5)).toBeLessThan(0.5);
    expect(mu.hdi94[0]).toBeLessThan(5);
    expect(mu.hdi94[1]).toBeGreaterThan(5);
    expect(diagnostics.rHat.mu!).toBeLessThan(1.1);
    const sigma = summary.sigma!;
    expect(Math.abs(sigma.mean - 2)).toBeLessThan(0.4);
    expect(samplerRun.chains.every((c) => Number.isFinite(c.stepSize) && c.stepSize > 0)).toBe(true);

    // Determinism: same seed → identical pooled draws.
    const again = await runHmc(model, cfg, {});
    const againConstrained = constrainChains(again.chains, model);
    expect(againConstrained[0]![0]![0]).toBe(constrained[0]![0]![0]);
    expect(againConstrained[0]![1]![299]).toBe(constrained[0]![1]![299]);

    // WAIC / LOO / PPC on the posterior draws.
    const theta: Record<string, number> = {};
    const n = samples.mu!.length;
    const logLik: Float64Array[] = [];
    for (let s = 0; s < n; s += 20) {
      theta.mu = samples.mu![s]!;
      theta.sigma = samples.sigma![s]!;
      logLik.push(Float64Array.from(y, (_, i) => templateLogLik('normal-mean', theta, { y }, i)));
    }
    const w = waic(logLik);
    const l = loo(logLik);
    expect(Number.isFinite(w.elpd)).toBe(true);
    expect(Number.isFinite(l.elpd)).toBe(true);
    expect(l.paretoK.length).toBe(logLik[0]!.length);

    const ppc = posteriorPredictive(
      (th, rand) => templateSim('normal-mean', th, { y }, rand),
      y,
      samples,
      { seed: 7 },
    );
    expect(ppc.stat).toBe('mean');
    expect(ppc.pValue).toBeGreaterThan(0.05);
  });
});
