import { describe, expect, it } from 'vitest';
import {
  ACID_PRESETS,
  chargeResidual,
  equivalencePhAnalytic,
  equivalenceVolume,
  INDICATORS,
  initialPhAnalytic,
  phAt,
  pKaOf,
  relErr,
  solveH,
  titrationCurve,
  type AcidSpec,
} from '../src/plugins/builtin/chem/titration/kernel';

const strong: AcidSpec = { kind: 'strong', conc: 0.1, volume: 25, baseConc: 0.1, ka: Number.POSITIVE_INFINITY };
const weak: AcidSpec = { kind: 'weak', conc: 0.1, volume: 25, baseConc: 0.1, ka: 1.8e-5 };

describe('chem-titration ionic-balance kernel', () => {
  it('benchmark: 0.1 M NaOH vs 25 mL 0.1 M HCl gives equivalence pH = 7.00 ± 0.02', () => {
    const veq = equivalenceVolume(strong);
    expect(veq).toBeCloseTo(25, 9);
    const ph = phAt(strong, veq);
    expect(Math.abs(ph - 7)).toBeLessThanOrEqual(0.02);
    // The analytic strong/strong oracle is exactly neutral, pH = ½pKw = 7.
    expect(equivalencePhAnalytic(strong)).toBe(7);
  });

  it('benchmark: 0.1 M NaOH vs 0.1 M HAc equivalence matches the hydrolysis formula within 0.5%', () => {
    const veq = equivalenceVolume(weak);
    expect(veq).toBeCloseTo(25, 9);
    const numeric = phAt(weak, veq);
    // Classic salt-hydrolysis oracle: pH = ½(pKw + pKa + lg c_salt), c_salt = 0.05 M.
    const oracle = equivalencePhAnalytic(weak);
    expect(oracle).toBeCloseTo(8.722, 2);
    expect(relErr(numeric, oracle)).toBeLessThan(0.005);
  });

  it('initial pH matches the exact dilution-law quadratic (strong and weak, several c)', () => {
    // 1e-6 relative headroom: the full balance adds the (tiny) water term
    // Kw/[H+], which the quadratic oracle neglects — worst case ~1e-8 for c=1e-3.
    for (const c of [0.1, 0.01, 0.001]) {
      const s: AcidSpec = { ...strong, conc: c };
      expect(relErr(phAt(s, 0), initialPhAnalytic(s))).toBeLessThan(1e-6);
      const w: AcidSpec = { ...weak, conc: c };
      expect(relErr(phAt(w, 0), initialPhAnalytic(w))).toBeLessThan(1e-6);
    }
    // Strong acid 0.1 M: pH = 1.00 to floating-point accuracy.
    expect(phAt(strong, 0)).toBeCloseTo(1, 9);
    // Weak acid 0.1 M HAc: textbook pH ≈ 2.88.
    expect(phAt(weak, 0)).toBeGreaterThan(2.8);
    expect(phAt(weak, 0)).toBeLessThan(2.95);
  });

  it('Henderson–Hasselbalch anchor: half-equivalence pH ≈ pKa within 0.01', () => {
    const veq = equivalenceVolume(weak);
    const phHalf = phAt(weak, veq / 2);
    expect(Math.abs(phHalf - pKaOf(weak))).toBeLessThan(0.01);
  });

  it('curve is monotonically increasing and lands in the excess-OH regime at 2·Ve', () => {
    const curve = titrationCurve(weak, { steps: 200 });
    expect(curve.length).toBe(201);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.ph).toBeGreaterThanOrEqual(curve[i - 1]!.ph - 1e-9);
    }
    // At 2·Ve the excess NaOH dominates: [OH−] ≈ 0.0333 M → pH ≈ 12.52.
    const pEnd = phAt(weak, 2 * equivalenceVolume(weak));
    expect(Math.abs(pEnd - 12.523)).toBeLessThan(0.02);
    expect(curve[0]!.ph).toBeLessThan(phAt(weak, equivalenceVolume(weak)));
  });

  it('solved [H+] satisfies the charge balance to solver accuracy', () => {
    const spec = weak;
    for (const frac of [0, 0.25, 0.5, 1, 1.5, 2]) {
      const v = frac * equivalenceVolume(spec);
      const na = (spec.baseConc * v) / (spec.volume + v);
      const ca = (spec.conc * spec.volume) / (spec.volume + v);
      const h = solveH(na, ca, spec.ka, { tol: 1e-13 });
      expect(Math.abs(chargeResidual(h, na, ca, spec.ka))).toBeLessThan(1e-9);
    }
  });

  it('solver is tolerant-insensitive: ultra vs normal tolerance agree to <1e-4 pH', () => {
    const hi = phAt(weak, equivalenceVolume(weak), 1e-13);
    const lo = phAt(weak, equivalenceVolume(weak), 1e-8);
    expect(Math.abs(hi - lo)).toBeLessThan(1e-4);
  });

  it('respects the equivalence-volume stoichiometry Ve = cₐVₐ/c_b', () => {
    expect(equivalenceVolume({ ...strong, baseConc: 0.05 })).toBeCloseTo(50, 9);
    expect(equivalenceVolume({ ...strong, baseConc: 0.2 })).toBeCloseTo(12.5, 9);
  });

  it('reference data are sane: HAc Ka preset and indicator ranges', () => {
    const hac = ACID_PRESETS.find((p) => p.key === 'hac')!;
    expect(hac.ka).toBeCloseTo(1.8e-5, 12);
    expect(INDICATORS.map((i) => i.key)).toEqual(['methyl-orange', 'phenolphthalein']);
    expect(INDICATORS[0]!.low).toBe(3.1);
    expect(INDICATORS[1]!.high).toBe(10.0);
  });
});
