// ==========================================================================
// astro-transit kernel unit tests: trapezoid self-consistency, seeded
// benchmark recovery (P < 0.5%, δ < 10%), phase-fold invariance, parser and
// the shipped example light curve end-to-end.
// ==========================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TRANSIT_BENCHMARK,
  binFolded,
  detectPeriod,
  fitTransit,
  parseTransitData,
  phaseFold,
  phaseWrap,
  runTransitBenchmark,
  synthesizeTransitData,
  trapezoidFlux,
  trapezoidFluxTau,
  trapezoidSelfConsistency,
  type TrapezoidParams,
} from '@/plugins/builtin/astro/transit/kernel';

const REFERENCE_P = 3.52474859; // HD 209458 b (NASA Exoplanet Archive)

describe('trapezoid model self-consistency', () => {
  const p: TrapezoidParams = { P: 3.0, T0: 0.5, delta: 0.01, T14: 0.15, T23: 0.05, baseline: 1 };

  it('satisfies T23 = T14 − 2τ and contact-point continuity to < 1e-9', () => {
    expect(trapezoidSelfConsistency(p)).toBeLessThan(1e-9);
  });

  it('evaluates the exact trapezoid depths at centre, contacts and ramp midpoint', () => {
    expect(trapezoidFlux(p.T0, p)).toBeCloseTo(p.baseline - p.delta, 12);
    expect(trapezoidFlux(p.T0 + p.T23 / 2, p)).toBeCloseTo(p.baseline - p.delta, 12);
    expect(trapezoidFlux(p.T0 + p.T14 / 2, p)).toBeCloseTo(p.baseline, 12);
    // Midpoint of the ingress/egress ramp in time: (T23/2 + T14/2) / 2.
    expect(trapezoidFlux(p.T0 + (p.T14 + p.T23) / 4, p)).toBeCloseTo(p.baseline - p.delta / 2, 12);
  });

  it('τ-parametrisation matches the (T14, T23) parametrisation exactly', () => {
    let worst = 0;
    for (let i = 0; i <= 400; i += 1) {
      const t = -0.5 + (2 * i) / 400;
      worst = Math.max(
        worst,
        Math.abs(
          trapezoidFlux(t, p) -
            trapezoidFluxTau(t, { P: p.P, T0: p.T0, delta: p.delta, T14: p.T14, tau: (p.T14 - p.T23) / 2, baseline: p.baseline }),
        ),
      );
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('phaseWrap always lands in (−P/2, P/2]', () => {
    for (let k = -10; k <= 10; k += 1) {
      const w = phaseWrap(0.37 + k * p.P + p.P / 3, p.P);
      expect(w).toBeGreaterThan(-p.P / 2 - 1e-12);
      expect(w).toBeLessThanOrEqual(p.P / 2 + 1e-12);
    }
  });
});

describe('embedded recovery benchmark', () => {
  it('recovers P within 0.5% and δ within 10% from the seeded synthetic curve', () => {
    const bench = runTransitBenchmark();
    expect(bench).not.toBeNull();
    const b = bench!;
    expect(b.selfConsistency).toBeLessThan(1e-9);
    expect(b.relErrP).toBeLessThan(TRANSIT_BENCHMARK.maxRelErrP);
    expect(b.relErrDelta).toBeLessThan(TRANSIT_BENCHMARK.maxRelErrDelta);
    expect(b.passed).toBe(true);
  });
});

describe('phase-fold invariance', () => {
  it('folding is identical for T0 and T0 + k·P with integer k (circular phase distance)', () => {
    const truth: TrapezoidParams = { P: 2.7, T0: 0.4, delta: 0.02, T14: 0.12, T23: 0.07, baseline: 1 };
    const data = synthesizeTransitData(truth, { n: 240, noise: 0, seed: 7 });
    const a = phaseFold(data, truth.P, truth.T0);
    const b = phaseFold(data, truth.P, truth.T0 + 5 * truth.P);
    expect(a.length).toBe(b.length);
    let worst = 0;
    for (let i = 0; i < a.length; i += 1) {
      // Wrap the phase difference onto [0, 0.5]: floating-point rounding at
      // the wrap boundary may swap −0.5 ↔ +0.5 for individual points.
      let d = Math.abs(a[i]!.phase - b[i]!.phase);
      d = Math.min(d, 1 - d);
      worst = Math.max(worst, d);
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('bins the folded curve over nBins uniform bins', () => {
    const truth: TrapezoidParams = { P: 3, T0: 0.5, delta: 0.01, T14: 0.15, T23: 0.05, baseline: 1 };
    const data = synthesizeTransitData(truth, { n: 300, noise: 0, seed: 11 });
    const bins = binFolded(phaseFold(data, truth.P, truth.T0), 30);
    expect(bins.length).toBe(30);
    let total = 0;
    for (const b of bins) total += b.n;
    expect(total).toBe(data.length);
    // The deepest bin mean must show a clear dip (bin mixing of flat + ramp
    // points keeps it well above baseline − δ but far below baseline).
    const deepest = Math.min(...bins.map((x) => x.mean));
    expect(deepest).toBeLessThan(1 - truth.delta * 0.5);
    expect(deepest).toBeGreaterThan(1 - truth.delta - 2e-3);
  });
});

describe('parser', () => {
  it('accepts CSV / whitespace / semicolon rows and skips comments & headers', () => {
    const text = [
      '# time,flux,err',
      'time,flux,err',
      '0.0,1.000,0.001',
      '1.0 0.990 0.001',
      '2.0;0.980',
      '',
    ].join('\n');
    const pts = parseTransitData(text);
    expect(pts.length).toBe(3);
    expect(pts[0]).toEqual({ t: 0, f: 1, err: 0.001 });
    expect(pts[1]).toEqual({ t: 1, f: 0.99, err: 0.001 });
    expect(pts[2]).toEqual({ t: 2, f: 0.98, err: undefined });
  });
});

describe('shipped example light curve (HD 209458 b parameters)', () => {
  const csv = readFileSync(fileURLToPath(new URL('../examples/data/astro-transit-lightcurve.csv', import.meta.url)), 'utf8');
  const data = parseTransitData(csv);

  it('contains the expected sampling', () => {
    expect(data.length).toBeGreaterThanOrEqual(900);
    const span = data[data.length - 1]!.t - data[0]!.t;
    expect(span).toBeGreaterThan(30);
  });

  it('recovers the reference period and depth end-to-end (detect → LM fit)', () => {
    const det = detectPeriod(data, { pMin: 0.5, pMax: 20, steps: 1200 });
    expect(det).not.toBeNull();
    const fit = fitTransit(
      data,
      {
        P: det!.period,
        T0: det!.epoch,
        delta: det!.depth,
        T14: det!.width,
        T23: 0.7 * det!.width,
        baseline: 1,
      },
      { bounds: { pMin: 0.5, pMax: 20, deltaMax: 0.2, t14Max: 0.5 } },
    );
    expect(fit).not.toBeNull();
    const f = fit!;
    expect(f.converged).toBe(true);
    const relP = Math.abs(f.params.P - REFERENCE_P) / REFERENCE_P;
    const relDelta = Math.abs(f.params.delta - 0.015) / 0.015;
    expect(relP).toBeLessThan(0.005);
    expect(relDelta).toBeLessThan(0.1);
    // Shallow transit (depth/noise ≈ 12 with ~4% in-transit duty cycle):
    // R² ≈ 0.75–0.85 is the expected band here.
    expect(f.r2).toBeGreaterThan(0.6);
  });
});
