import { describe, expect, it } from 'vitest';
import {
  analyzeOrder,
  arrheniusFit,
  exactConcentration,
  halfLifeCheck,
  linearFit,
  parseTwoColumn,
  rateConstantUnit,
  synthArrhenius,
  synthKinetics,
  transformY,
} from '../src/plugins/builtin/chem/reaction-order/kernel';

const SEED = 20260922;

describe('chem-reaction-order OLS kernel', () => {
  it('linearFit recovers an exact line with R² = 1 and zero slope SE', () => {
    const fit = linearFit([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.slopeSe).toBeLessThan(1e-9);
  });

  it('integrated rate laws: exactConcentration matches c0−kt, c0·e^(−kt), c0/(1+kc0t)', () => {
    expect(exactConcentration(0, 1, 0.1, 3)).toBeCloseTo(0.7, 12);
    expect(exactConcentration(1, 0.8, 0.0231, 30)).toBeCloseTo(0.8 * Math.exp(-0.0231 * 30), 15);
    expect(exactConcentration(2, 1, 0.5, 2)).toBeCloseTo(0.5, 12);
    expect(transformY(1, 0.5)).toBeCloseTo(Math.log(0.5), 15);
    expect(transformY(2, 0.5)).toBe(2);
  });
});

describe('chem-reaction-order integrated-method screening', () => {
  it('benchmark: seeded first-order data (k = 0.0231 min⁻¹, 1% noise) → order 1, k error < 1%', () => {
    const data = synthKinetics({ order: 1, c0: 0.8, k: 0.0231, tMax: 150, n: 31, noise: 0.01, seed: SEED });
    const a = analyzeOrder(data)!;
    expect(a.best).toBe(1);
    const err = Math.abs(a.k - 0.0231) / 0.0231;
    expect(err).toBeLessThan(0.01);
    expect(a.r2).toBeGreaterThan(0.999);
  });

  it('benchmark: seeded second-order data (k = 0.5 L/(mol·min)) → order 2', () => {
    const data = synthKinetics({ order: 2, c0: 1.0, k: 0.5, tMax: 20, n: 41, noise: 0.01, seed: SEED + 7 });
    const a = analyzeOrder(data)!;
    expect(a.best).toBe(2);
    expect(Math.abs(a.k - 0.5) / 0.5).toBeLessThan(0.05);
  });

  it('benchmark: seeded zero-order data (k = 0.05 mol/(L·min)) → order 0', () => {
    const data = synthKinetics({ order: 0, c0: 1.0, k: 0.05, tMax: 18, n: 38, noise: 0.01, seed: SEED + 3 });
    const a = analyzeOrder(data)!;
    expect(a.best).toBe(0);
    expect(Math.abs(a.k - 0.05) / 0.05).toBeLessThan(0.02);
  });

  it('half-life cross-check: first-order data give n ≈ 1 (t½ constant)', () => {
    const data = synthKinetics({ order: 1, c0: 0.8, k: 0.0231, tMax: 150, n: 31, noise: 0.01, seed: SEED });
    const half = halfLifeCheck(data);
    expect(half.pairs.length).toBeGreaterThanOrEqual(3);
    expect(half.order).not.toBeNull();
    expect(Math.abs(half.order! - 1)).toBeLessThan(0.35);
  });

  it('half-life cross-check: second-order data give n ≈ 2 (t½ doubles per segment)', () => {
    const data = synthKinetics({ order: 2, c0: 1.0, k: 0.5, tMax: 20, n: 41, noise: 0.01, seed: SEED + 7 });
    const half = halfLifeCheck(data);
    expect(half.order).not.toBeNull();
    expect(Math.abs(half.order! - 2)).toBeLessThan(0.35);
  });

  it('noise-free data recover k to machine precision and rank R² correctly', () => {
    const data = synthKinetics({ order: 1, c0: 1, k: 0.07, tMax: 60, n: 25, noise: 0, seed: SEED });
    const a = analyzeOrder(data)!;
    expect(a.best).toBe(1);
    expect(Math.abs(a.k - 0.07) / 0.07).toBeLessThan(1e-10);
    expect(a.fits[1]!.r2).toBeGreaterThan(a.fits[0]!.r2);
    expect(a.fits[1]!.r2).toBeGreaterThan(a.fits[2]!.r2);
  });

  it('rate-constant units follow the order', () => {
    expect(rateConstantUnit(0, 'min')).toBe('mol/(L·min)');
    expect(rateConstantUnit(1, 's')).toBe('s⁻¹');
    expect(rateConstantUnit(2, 's')).toBe('L/(mol·s)');
  });
});

describe('chem-reaction-order Arrhenius kernel', () => {
  it('benchmark: exact three-point recovery of Ea = 50 kJ/mol within 0.5%', () => {
    const pts = synthArrhenius({ eaKJ: 50, a: 1e8, temperatures: [300, 320, 350], noise: 0, seed: SEED });
    const fit = arrheniusFit(pts)!;
    expect(fit.n).toBe(3);
    expect(Math.abs(fit.ea - 50) / 50).toBeLessThan(0.005);
    expect(fit.r2).toBeGreaterThan(0.9999);
    // Relative-error convention: |computed - exact| / |exact| < 1e-9.
    expect(Math.abs(fit.a - 1e8) / 1e8).toBeLessThan(1e-9);
  });

  it('noisy six-point Arrhenius data recover Ea within 1%', () => {
    const pts = synthArrhenius({ eaKJ: 50, a: 1e8, temperatures: [300, 310, 320, 330, 340, 350], noise: 0.005, seed: SEED + 11 });
    const fit = arrheniusFit(pts)!;
    expect(Math.abs(fit.ea - 50) / 50).toBeLessThan(0.01);
    // Ea standard error consistent with the fit scatter.
    expect(fit.eaSe).toBeGreaterThan(0);
  });

  it('rejects fewer than three usable points', () => {
    expect(arrheniusFit([{ T: 300, k: 1 }, { T: 320, k: 2 }])).toBeNull();
    expect(analyzeOrder([{ t: 0, c: 1 }, { t: 1, c: 0.5 }])).toBeNull();
  });
});

describe('chem-reaction-order two-column parser', () => {
  it('sniffs kinetics headers (t, c) and skips comments', () => {
    const txt = `# kinetics run 3\nt_s,c_mol_per_L\n0,1.0\n10,0.79\n20,0.63\n`;
    const parsed = parseTwoColumn(txt, 'kinetics');
    expect(parsed.kind).toBe('kinetics');
    expect(parsed.headerDetected).toBe(true);
    expect(parsed.kinetics).toEqual([
      { t: 0, c: 1 },
      { t: 10, c: 0.79 },
      { t: 20, c: 0.63 },
    ]);
  });

  it('sniffs Arrhenius headers (T, k)', () => {
    const txt = 'T_K,k_s-1\n300,0.2\n320,0.7\n350,3.4\n';
    const parsed = parseTwoColumn(txt, 'kinetics');
    expect(parsed.kind).toBe('arrhenius');
    expect(parsed.arrhenius).toHaveLength(3);
    expect(parsed.arrhenius[0]).toEqual({ T: 300, k: 0.2 });
  });

  it('falls back to the requested mode for headerless numeric tables', () => {
    const parsed = parseTwoColumn('0 1\n1 2\n2 3\n', 'arrhenius');
    expect(parsed.headerDetected).toBe(false);
    expect(parsed.kind).toBe('arrhenius');
    expect(parsed.arrhenius).toHaveLength(3);
  });

  it('drops blank / short rows and tolerates CRLF + semicolons', () => {
    const parsed = parseTwoColumn('t,c\r\n0,1\r\n\r\n1;0.5\r\nbadrow\r\n2,0.25\r\n', 'kinetics');
    expect(parsed.kinetics).toEqual([
      { t: 0, c: 1 },
      { t: 1, c: 0.5 },
      { t: 2, c: 0.25 },
    ]);
  });
});
