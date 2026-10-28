// bio-pk kernel validation: RK4 vs analytic closed forms and AUC conservation.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PK_PARAMS,
  computePkMetrics,
  macroRates,
  oneCompIvConc,
  oneCompOralConc,
  runPkBenchmarks,
  simulatePk,
  twoCompIvAmount,
  twoCompOralAmount,
  type PkParams,
} from '../src/plugins/builtin/bio/pk/kernel';

const BASE: PkParams = {
  model: 'one-compartment',
  route: 'iv-bolus',
  dose: 400,
  volume: 35,
  ke: 0.1,
  ka: 1.5,
  k12: 0.4,
  k21: 0.25,
};

function worstRelErr(conc: number[], ref: (t: number) => number, times: number[]): number {
  let worst = 0;
  for (let i = 0; i < conc.length; i += 1) {
    const r = ref(times[i]!);
    if (!Number.isFinite(r) || r === 0) continue;
    worst = Math.max(worst, Math.abs(conc[i]! - r) / Math.abs(r));
  }
  return worst;
}

describe('bio-pk kernel', () => {
  it('one-compartment IV bolus matches the analytic exponential within 1e-4', () => {
    const s = simulatePk(BASE, 24, 0.002);
    const err = worstRelErr(
      s.concentration,
      (t) => oneCompIvConc(t, BASE.dose, BASE.volume, BASE.ke),
      s.times,
    );
    expect(err).toBeLessThan(1e-4);
  });

  it('one-compartment oral matches the Bateman solution within 1e-4', () => {
    const oral: PkParams = { ...BASE, route: 'oral' };
    const s = simulatePk(oral, 24, 0.002);
    const err = worstRelErr(
      s.concentration,
      (t) => oneCompOralConc(t, oral.dose, oral.volume, oral.ke, oral.ka),
      s.times,
    );
    expect(err).toBeLessThan(1e-4);
  });

  it('two-compartment IV bolus matches the biexponential within 1e-3', () => {
    const two: PkParams = { ...BASE, model: 'two-compartment' };
    const s = simulatePk(two, 24, 0.002);
    const err = worstRelErr(
      s.concentration,
      (t) => twoCompIvAmount(t, two.dose, two.ke, two.k12, two.k21) / two.volume,
      s.times,
    );
    expect(err).toBeLessThan(1e-3);
  });

  it('two-compartment oral matches the tri-exponential within 1e-3', () => {
    const twoOral: PkParams = { ...BASE, model: 'two-compartment', route: 'oral' };
    const s = simulatePk(twoOral, 24, 0.002);
    const err = worstRelErr(
      s.concentration,
      (t) => twoCompOralAmount(t, twoOral.dose, twoOral.ke, twoOral.k12, twoOral.k21, twoOral.ka) / twoOral.volume,
      s.times,
    );
    expect(err).toBeLessThan(1e-3);
  });

  it('macro rates satisfy α+β = ke+k12+k21 and αβ = ke·k21', () => {
    const { alpha, beta } = macroRates(BASE.ke, BASE.k12, BASE.k21);
    expect(alpha + beta).toBeCloseTo(BASE.ke + BASE.k12 + BASE.k21, 9);
    expect(alpha * beta).toBeCloseTo(BASE.ke * BASE.k21, 9);
    expect(alpha).toBeGreaterThan(beta);
  });

  it('trapezoidal AUC agrees with the analytic D/(ke·Vd) within 1%', () => {
    const m = computePkMetrics(BASE, 72, 72 / 6000);
    const analytic = BASE.dose / (BASE.ke * BASE.volume);
    expect(m.aucAnalytic).toBeCloseTo(analytic, 6);
    expect(m.aucRelErr).toBeLessThan(0.01);
  });

  it('embedded benchmark battery passes on all five cases', () => {
    const bench = runPkBenchmarks();
    expect(bench.cases.length).toBe(5);
    expect(bench.allPassed).toBe(true);
    for (const c of bench.cases) expect(c.relErr).toBeLessThan(c.tolerance);
  });

  it('exposes the theophylline demo defaults flagged as literature-scale', () => {
    expect(DEFAULT_PK_PARAMS.volume).toBe(35);
    expect(DEFAULT_PK_PARAMS.ke).toBeCloseTo(0.1, 9);
  });
});
