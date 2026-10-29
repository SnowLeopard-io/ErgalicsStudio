// bio-pk extended kernel validation: two-compartment identity, infusion, oral
// Bateman peak, Emax boundaries, DDI AUC ratio, TDM fit recovery and steady-state
// superposition. Complements tests/bioPk.test.ts (single-mode core).
import { describe, expect, it } from 'vitest';
import {
  ddiScaledParams,
  computePkMetrics,
  emaxEffect,
  fitTdmOneComp,
  macroRates,
  mulberry32,
  oneCompIvConc,
  oneCompInfusionConc,
  oneCompOralConc,
  quantileSorted,
  simulatePk,
  simulatePopulationPk,
  solveDoseForAuc,
  solveDoseForTrough,
  steadyStateAuc,
  steadyStateConc,
  steadyStatePeak,
  steadyStateTrough,
  twoCompOralAmount,
  type PkParams,
  type TdmObservation,
} from '../src/plugins/builtin/med/pk/kernel';

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

const TWO: PkParams = {
  ...BASE,
  model: 'two-compartment',
  route: 'oral',
  k12: 0.8,
  k21: 0.4,
};

/** Terminal-phase slope of a numeric log-conc curve via linear regression on the last fraction. */
function terminalSlope(times: number[], conc: number[], frac = 0.3): number {
  const n = conc.length;
  const start = Math.floor(n * (1 - frac));
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const m = n - start;
  for (let i = start; i < n; i += 1) {
    const x = times[i]!;
    const y = Math.log(conc[i]!);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = sxx - (sx * sx) / m;
  return (sxy - (sx * sy) / m) / denom;
}

describe('two-compartment identity', () => {
  it('numeric oral profile matches the tri-exponential closed form and conserves AUC = D/(ke·V)', () => {
    const s = simulatePk(TWO, 48, 0.002);
    const { alpha, beta } = macroRates(TWO.ke, TWO.k12, TWO.k21);
    let worst = 0;
    for (let i = 0; i < s.concentration.length; i += 1) {
      const ref = twoCompOralAmount(s.times[i]!, TWO.dose, TWO.ke, TWO.k12, TWO.k21, TWO.ka) / TWO.volume;
      if (!Number.isFinite(ref) || ref <= 0) continue;
      worst = Math.max(worst, Math.abs(s.concentration[i]! - ref) / ref);
    }
    expect(worst).toBeLessThan(2e-3);
    const m = computePkMetrics(TWO, 48, 0.002);
    const aucAnalytic = TWO.dose / (TWO.ke * TWO.volume); // ke·k21 identity: AUC = D/(ke·V1)
    expect(Math.abs(m.aucNumeric / aucAnalytic - 1)).toBeLessThan(1e-3);
    expect(alpha).toBeGreaterThan(beta);
  });

  it('terminal slope of the numeric curve converges to the macro beta rate', () => {
    const s = simulatePk(TWO, 240, 0.05);
    const { beta } = macroRates(TWO.ke, TWO.k12, TWO.k21);
    const slope = terminalSlope(s.times, s.concentration, 0.2); // negative: log-conc declines
    expect(Math.abs(-slope / beta - 1)).toBeLessThan(2e-3);
  });
});

describe('new routes and bioavailability', () => {
  it('one-compartment IV infusion matches its closed form and plateaus below it during input', () => {
    const p: PkParams = { ...BASE, route: 'iv-infusion', tInf: 6 };
    const s = simulatePk(p, 24, 0.002);
    let worst = 0;
    for (let i = 0; i < s.concentration.length; i += 1) {
      const ref = oneCompInfusionConc(s.times[i]!, p.dose, p.volume, p.ke, 6);
      if (!Number.isFinite(ref) || ref <= 0) continue;
      worst = Math.max(worst, Math.abs(s.concentration[i]! - ref) / ref);
    }
    expect(worst).toBeLessThan(1e-4);
    const cEnd = oneCompInfusionConc(6, p.dose, p.volume, p.ke, 6);
    const rate = p.dose / 6;
    const plateau = (rate / (p.ke * p.volume)) * (1 - Math.exp(-p.ke * 6)); // R/CL·(1-e^-ke·T)
    expect(Math.abs(cEnd / plateau - 1)).toBeLessThan(1e-12);
  });

  it('oral bioavailability F scales the curve and the AUC linearly', () => {
    const p1: PkParams = { ...BASE, route: 'oral' };
    const pHalf: PkParams = { ...BASE, route: 'oral', f: 0.5 };
    const m1 = computePkMetrics(p1, 48, 0.002);
    const m2 = computePkMetrics(pHalf, 48, 0.002);
    expect(Math.abs(m1.aucAnalytic / m2.aucAnalytic - 2)).toBeLessThan(1e-12);
    expect(Math.abs(m1.cmax / m2.cmax - 2)).toBeLessThan(1e-6);
    const s = simulatePk(pHalf, 48, 0.002);
    const idx = s.times.findIndex((t) => Math.abs(t - 6) < 1e-9);
    const ref = oneCompOralConc(6, pHalf.dose, pHalf.volume, pHalf.ke, pHalf.ka, 0.5);
    expect(Math.abs(s.concentration[idx]! / ref - 1)).toBeLessThan(1e-4);
  });
});

describe('oral Bateman peak time', () => {
  it('numeric Tmax equals ln(ka/ke)/(ka-ke) for several ka/ke ratios', () => {
    for (const [ke, ka] of [
      [0.1, 1.5],
      [0.23, 0.9],
      [0.05, 0.35],
    ] as const) {
      const p: PkParams = { ...BASE, route: 'oral', ke, ka };
      const s = simulatePk(p, 96, 0.001);
      let tmaxIdx = 0;
      for (let i = 1; i < s.concentration.length; i += 1) {
        if (s.concentration[i]! > s.concentration[tmaxIdx]!) tmaxIdx = i;
      }
      const tmaxNumeric = s.times[tmaxIdx]!;
      const tmaxAnalytic = Math.log(ka / ke) / (ka - ke);
      expect(Math.abs(tmaxNumeric - tmaxAnalytic)).toBeLessThan(0.05);
    }
  });
});

describe('sigmoid-Emax effect model', () => {
  it('boundaries: E(0)=E0, C->infty gives E0+Emax, E(EC50)=E0+Emax/2 for any Hill coefficient', () => {
    const pd = { emax: 100, ec50: 10, hill: 1, e0: 5 };
    expect(emaxEffect(0, pd)).toBeCloseTo(5, 12);
    expect(emaxEffect(1e12, pd)).toBeCloseTo(105, 6);
    expect(emaxEffect(10, pd)).toBeCloseTo(55, 10);
    for (const h of [0.5, 2, 5]) {
      const sigmoid = { emax: 80, ec50: 4, hill: h, e0: -10 };
      expect(emaxEffect(4, sigmoid)).toBeCloseTo(-10 + 40, 10);
      expect(emaxEffect(1e20, sigmoid)).toBeCloseTo(70, 6);
      expect(emaxEffect(0, sigmoid)).toBeCloseTo(-10, 12);
    }
  });
});

describe('DDI: CL multiplier vs AUC ratio', () => {
  it('inhibitor CLx0.25 quadruples the AUC; inducer CLx2.5 divides it by 2.5', () => {
    const base = steadyStateAuc(BASE, 12);
    const inhib = steadyStateAuc(ddiScaledParams(BASE, 0.25), 12);
    const induc = steadyStateAuc(ddiScaledParams(BASE, 2.5), 12);
    expect(inhib / base).toBeCloseTo(4, 10);
    expect(induc / base).toBeCloseTo(1 / 2.5, 10);
    const mBase = computePkMetrics(BASE, 48, 0.004);
    const mInhib = computePkMetrics(ddiScaledParams(BASE, 0.25), 48, 0.004);
    expect(mInhib.aucAnalytic / mBase.aucAnalytic).toBeCloseTo(4, 8);
  });
});

describe('steady-state superposition principle', () => {
  it('one-compartment IV: superposition trough matches the geometric-series closed form', () => {
    const tau = 12;
    const closedForm = (BASE.dose / BASE.volume) * Math.exp(-BASE.ke * tau) / (1 - Math.exp(-BASE.ke * tau));
    expect(steadyStateTrough(BASE, tau)).toBeCloseTo(closedForm, 6);
    // trough + single-dose immediate level = just-after-dose peak (superposition additivity)
    const ss0 = steadyStateConc(BASE, tau, 0);
    expect(ss0).toBeCloseTo(closedForm + BASE.dose / BASE.volume, 6);
  });

  it('one-compartment oral: superposition matches the analytic multiple-dose trough', () => {
    const tau = 8;
    const oral: PkParams = { ...BASE, route: 'oral', f: 0.9, ka: 1.2 };
    const A = ((oral.f ?? 1) * oral.dose * oral.ka) / (oral.volume * (oral.ka - oral.ke));
    const closedForm =
      (A * Math.exp(-oral.ke * tau)) / (1 - Math.exp(-oral.ke * tau)) -
      (A * Math.exp(-oral.ka * tau)) / (1 - Math.exp(-oral.ka * tau));
    expect(steadyStateTrough(oral, tau)).toBeCloseTo(closedForm, 6);
    // AUC0-tau,ss equals the single-dose AUC0-inf = F·D/CL under linearity
    expect(steadyStateAuc(oral, tau)).toBeCloseTo(((oral.f ?? 1) * oral.dose) / (oral.ke * oral.volume), 10);
  });

  it('dose inversion: recommended dose reproduces the target trough and AUC exactly', () => {
    const tau = 12;
    const targetTrough = 12;
    const d = solveDoseForTrough(BASE, tau, targetTrough);
    expect(steadyStateTrough({ ...BASE, dose: d }, tau)).toBeCloseTo(targetTrough, 6);
    const targetAuc = 500;
    const dAuc = solveDoseForAuc(BASE, targetAuc);
    expect(steadyStateAuc({ ...BASE, dose: dAuc }, tau)).toBeCloseTo(targetAuc, 8);
  });

  it('steady-state peak search stays consistent with the profile within one interval', () => {
    const tau = 12;
    const peak = steadyStatePeak(BASE, tau);
    expect(peak).toBeGreaterThan(steadyStateTrough(BASE, tau));
    expect(peak).toBeLessThan(steadyStateConc(BASE, tau, 0) + 1e-9);
  });
});

describe('TDM: one-compartment CL/V least-squares fit', () => {
  it('recovers known CL/V from noiseless IV bolus observations', () => {
    const vTrue = 42;
    const keTrue = 0.14;
    const clTrue = keTrue * vTrue;
    const obs: TdmObservation[] = [1, 2, 4, 6, 9, 12].map((t) => ({
      t,
      c: oneCompIvConc(t, BASE.dose, vTrue, keTrue),
    }));
    const fit = fitTdmOneComp(obs, 'iv-bolus', BASE.dose, 1, BASE.ka, 1);
    expect(fit).not.toBeNull();
    expect(fit!.v / vTrue).toBeCloseTo(1, 2);
    expect(fit!.cl / clTrue).toBeCloseTo(1, 2);
    expect(fit!.r2).toBeGreaterThan(0.999);
  });

  it('recovers CL/V within 10% from 5%-noise oral observations (fixed seed)', () => {
    const vTrue = 35;
    const keTrue = 0.12;
    const rng = mulberry32(77);
    const z = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
    const obs: TdmObservation[] = [0.5, 1, 2, 4, 6, 8, 12, 18, 24].map((t) => ({
      t,
      c: oneCompOralConc(t, 500, vTrue, keTrue, 1.5, 0.9) * Math.exp(0.05 * z() - 0.00125),
    }));
    const fit = fitTdmOneComp(obs, 'oral', 500, 0.9, 1.5, 1);
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.cl / (keTrue * vTrue) - 1)).toBeLessThan(0.1);
    expect(Math.abs(fit!.v / vTrue - 1)).toBeLessThan(0.1);
    const halfLife = Math.LN2 / fit!.ke;
    expect(Math.abs(halfLife / (Math.LN2 / keTrue) - 1)).toBeLessThan(0.1);
  });
});

describe('population Monte-Carlo', () => {
  it('is reproducible under a fixed seed, mean-preserving, and orders P5<=P50<=P95', () => {
    const opts = { n: 100, cvCl: 0.3, cvV: 0.25, seed: 42, tMax: 24, gridPoints: 120 };
    const a = simulatePopulationPk(BASE, opts);
    const b = simulatePopulationPk(BASE, opts);
    expect(a.p50).toEqual(b.p50);
    expect(a.individuals.length).toBe(100);
    const clMean = a.individuals.reduce((s, i) => s + i.halfLife, 0) / a.individuals.length;
    const thTrue = Math.LN2 / BASE.ke;
    expect(Math.abs(clMean / thTrue - 1)).toBeLessThan(0.1); // mean-preserving sampling
    for (let i = 0; i < a.times.length; i += 1) {
      expect(a.p5[i]!).toBeLessThanOrEqual(a.p50[i]! + 1e-12);
      expect(a.p50[i]!).toBeLessThanOrEqual(a.p95[i]! + 1e-12);
    }
  });

  it('quantileSorted interpolates and matches known order statistics', () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(quantileSorted(sorted, 0)).toBe(1);
    expect(quantileSorted(sorted, 1)).toBe(5);
    expect(quantileSorted(sorted, 0.5)).toBe(3);
    expect(quantileSorted(sorted, 0.25)).toBeCloseTo(2, 12);
  });
});
