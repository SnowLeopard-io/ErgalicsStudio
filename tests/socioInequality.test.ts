import { describe, expect, it } from 'vitest';
import {
  EXPONENTIAL_GINI,
  applyTax,
  atkinsonIndex,
  classifyInequality,
  giniExact,
  giniFromLorenz,
  giniSorted,
  giniWeighted,
  generateIncomes,
  identifyDistribution,
  lognormalGini,
  lorenzCurve,
  palmaRatio,
  paretoGini,
  percentile,
  runInequalityBenchmark,
  simulateMobility,
  theilIndex,
  type LorenzPoint,
} from '../src/plugins/builtin/socio/inequality/kernel';

describe('socio-inequality kernel (Gini / Lorenz / Palma / Theil / Atkinson)', () => {
  it('computes exact Ginis on hand-checked tiny populations', () => {
    // [1,1,1,1]: mean 1, all absolute differences 0 -> G = 0
    expect(giniExact([1, 1, 1, 1])).toBe(0);
    // [0,0,0,4]: unordered-pair MAD sum = 12, n^2*mu = 16 -> G = 0.75
    expect(giniExact([0, 0, 0, 4])).toBeCloseTo(0.75, 12);
    // [1,2,3,4]: unordered-pair MAD sum = 10, n^2*mu = 40 -> G = 0.25
    expect(giniExact([1, 2, 3, 4])).toBeCloseTo(0.25, 12);
  });

  it('giniSorted (Lorenz trapezoid) matches the MAD formula on unweighted data', () => {
    const sorted = [0, 0, 0, 4];
    expect(giniSorted(sorted)).toBeCloseTo(0.75, 12);
    expect(giniSorted([1, 2, 3, 4])).toBeCloseTo(0.25, 12);
    // large seeded log-normal sample: both kernels agree to float noise
    const s = generateIncomes({ distribution: 'log-normal', n: 3000, shape: 0.9, seed: 11 });
    expect(giniSorted([...s].sort((a, b) => a - b))).toBeCloseTo(giniExact(s), 9);
  });

  it('the Lorenz curve closes at (0,0)/(1,1) and integrates back to the Gini', () => {
    const pts: LorenzPoint[] = lorenzCurve([1, 2, 3, 4]);
    expect(pts[0]!.p).toBe(0);
    expect(pts[0]!.l).toBe(0);
    expect(pts[pts.length - 1]!.p).toBeCloseTo(1, 12);
    expect(pts[pts.length - 1]!.l).toBeCloseTo(1, 12);
    // monotone curve with the correct intermediate point L(0.5) = 0.3
    expect(pts[2]!.p).toBeCloseTo(0.5, 12);
    expect(pts[2]!.l).toBeCloseTo(0.3, 12);
    expect(giniFromLorenz(pts)).toBeCloseTo(0.25, 12);
  });

  it('Palma ratio on a known small vector: top decile share / bottom 40% share = 2.5', () => {
    // [1,1,1,1,1,1,1,1,1,10]: top 10% holds 10/19, bottom 40% holds 4/19
    // -> Palma = (10/19) / (4/19) = 2.5
    expect(palmaRatio([1, 1, 1, 1, 1, 1, 1, 1, 1, 10])).toBeCloseTo(2.5, 12);
    // equal incomes -> top decile holds 0.1, bottom 40% holds 0.4 -> Palma = 0.25
    expect(palmaRatio([2, 2, 2, 2, 2, 2, 2, 2, 2, 2])).toBeCloseTo(0.25, 9);
  });

  it('Theil index on a known small vector: [0,0,0,4] gives ln(4)', () => {
    // mu = 1; the three zeros contribute their limit 0, the 4 contributes
    // (4/1)*ln(4) = 4*ln(4); T = 4*ln(4)/4 = ln(4)
    expect(theilIndex([0, 0, 0, 4])).toBeCloseTo(Math.log(4), 12);
    expect(theilIndex([1, 1, 1, 1])).toBe(0);
  });

  it('Atkinson index on a known small vector: [1,2,3,4] at eps = 0.5', () => {
    // mu = 2.5; A = 1 - (mean of sqrt(x/mu))^2
    // = 1 - ((sqrt(0.4)+sqrt(0.8)+sqrt(1.2)+sqrt(1.6))/4)^2
    const want = 1 - Math.pow((Math.sqrt(0.4) + Math.sqrt(0.8) + Math.sqrt(1.2) + Math.sqrt(1.6)) / 4, 2);
    expect(atkinsonIndex([1, 2, 3, 4], 0.5)).toBeCloseTo(want, 12);
    expect(atkinsonIndex([1, 1, 1, 1], 0.5)).toBe(0);
    // eps = 1 uses the geometric-mean form: [0,0,0,4] -> A = 1
    expect(atkinsonIndex([0, 0, 0, 4], 1)).toBe(1);
  });

  it('percentiles use linear interpolation (type 7)', () => {
    const sorted = [1, 2, 3, 4];
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 1)).toBe(4);
    expect(percentile(sorted, 0.5)).toBe(2.5);
    expect(percentile(sorted, 0.25)).toBeCloseTo(1.75, 12);
  });

  it('weighted Gini matches the unweighted one for unit weights', () => {
    const x = generateIncomes({ distribution: 'log-normal', n: 500, shape: 0.7, seed: 3 });
    const ones = new Array<number>(x.length).fill(1);
    expect(giniWeighted(x, ones)).toBeCloseTo(giniExact(x), 9);
  });
});

describe('socio-inequality theoretical-Gini identities', () => {
  it('log-normal sample Gini converges to 2*Phi(sigma/sqrt(2)) - 1', () => {
    const sigma = 0.8;
    const s = generateIncomes({ distribution: 'log-normal', n: 20000, shape: sigma, seed: 20261029 });
    expect(Math.abs(giniExact(s) - lognormalGini(sigma))).toBeLessThan(0.02);
  });

  it('Pareto sample Gini converges to 1/(2a-1)', () => {
    const alpha = 3;
    const s = generateIncomes({ distribution: 'pareto', n: 20000, shape: alpha, seed: 20261030 });
    expect(Math.abs(giniExact(s) - paretoGini(alpha))).toBeLessThan(0.02);
  });

  it('exponential sample Gini converges to exactly 1/2', () => {
    const s = generateIncomes({ distribution: 'exponential', n: 20000, shape: 1, seed: 20261031 });
    expect(Math.abs(giniExact(s) - EXPONENTIAL_GINI)).toBeLessThan(0.02);
  });

  it('moment identification recovers the shape and the identity gap stays small', () => {
    const s = generateIncomes({ distribution: 'log-normal', n: 20000, shape: 0.8, seed: 20261029 });
    const id = identifyDistribution(s, 'log-normal');
    expect(id.hasIdentity).toBe(true);
    expect(id.shape).toBeGreaterThan(0.75);
    expect(id.shape).toBeLessThan(0.85);
    expect(id.giniGap).toBeLessThan(0.02);
    const p = generateIncomes({ distribution: 'pareto', n: 20000, shape: 3, seed: 20261030 });
    const idp = identifyDistribution(p, 'pareto');
    expect(idp.shape).toBeGreaterThan(2.7);
    expect(idp.shape).toBeLessThan(3.3);
    expect(idp.giniGap).toBeLessThan(0.02);
  });
});

describe('socio-inequality mobility and tax counterfactuals', () => {
  it('rank-rank slope is positive, below 1 and near its population value', () => {
    const rho = 0.4;
    const mob = simulateMobility(4000, rho, 555);
    expect(mob.rankRankSlope).toBeGreaterThan(0);
    expect(mob.rankRankSlope).toBeLessThan(1);
    // population value 6*arcsin(rho/2)/pi (see expectedRankRankSlope);
    // n = 4000 keeps the sampling error far below this tolerance
    const expected = (6 * Math.asin(rho / 2)) / Math.PI;
    expect(Math.abs(mob.rankRankSlope - expected)).toBeLessThan(0.08);
    // IGE recovers the elasticity on log incomes
    expect(Math.abs(mob.igeSlope - rho)).toBeLessThan(0.08);
  });

  it('progressive tax reduces the Gini, flat tax leaves it unchanged, regressive tax raises it', () => {
    const s = generateIncomes({ distribution: 'log-normal', n: 3000, shape: 0.8, seed: 9 });
    const gPre = giniExact(s);
    const prog = applyTax(s, 'progressive', 0.4);
    expect(prog.giniPost).toBeLessThan(gPre);
    expect(prog.redistribution).toBeGreaterThan(0);
    // hand-checkable tiny population: [1,2,3,4], median 2.5, rate 0.5
    // brackets (1.25, 5] at rate 0.25 -> post-tax [1, 1.8125, 2.5625, 3.3125]
    const tiny = applyTax([1, 2, 3, 4], 'progressive', 0.5);
    expect(tiny.postTax[0]).toBeCloseTo(1, 12);
    expect(tiny.postTax[1]).toBeCloseTo(1.8125, 12);
    expect(tiny.postTax[2]).toBeCloseTo(2.5625, 12);
    expect(tiny.postTax[3]).toBeCloseTo(3.3125, 12);
    // G_post = 7.6875 / 34.75 (unordered-pair MAD sum 7.6875 over n^2*mu = 34.75)
    expect(tiny.giniPost).toBeCloseTo(7.6875 / 34.75, 12);
    expect(tiny.giniPost).toBeCloseTo(0.2212230215827338, 9);
    // flat: Gini is scale invariant
    const flat = applyTax(s, 'flat', 0.3);
    expect(flat.giniPost).toBeCloseTo(gPre, 9);
    expect(flat.redistribution).toBeCloseTo(0, 9);
    // regressive: inequality rises
    const reg = applyTax(s, 'regressive', 0.4);
    expect(reg.giniPost).toBeGreaterThan(gPre);
    expect(reg.redistribution).toBeLessThan(0);
  });
});

describe('socio-inequality embedded benchmark', () => {
  it('passes the full validation battery (tiny Ginis, identities, closure, CI, determinism)', () => {
    const b = runInequalityBenchmark();
    expect(b.details.giniTinyExact).toBe(true);
    expect(b.details.lognormalGiniErr).toBeLessThan(0.02);
    expect(b.details.paretoGiniErr).toBeLessThan(0.02);
    expect(b.details.exponentialGiniErr).toBeLessThan(0.02);
    expect(b.details.lorenzClosure).toBe(true);
    expect(b.details.ciContainsEstimate).toBe(true);
    expect(b.details.ciWidthPositive).toBe(true);
    expect(b.details.deterministic).toBe(true);
    expect(b.pass).toBe(true);
  });

  it('classifies severity monotonically', () => {
    expect(classifyInequality(0.1).key).toBe('low');
    expect(classifyInequality(0.3).key).toBe('moderate');
    expect(classifyInequality(0.4).key).toBe('high');
    expect(classifyInequality(0.6).key).toBe('severe');
  });
});
