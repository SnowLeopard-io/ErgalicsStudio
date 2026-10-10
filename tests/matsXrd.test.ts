import { describe, expect, it } from 'vitest';
import { refineCubicLattice, type XrdPeak } from '../src/plugins/builtin/mats-xrd/kernel';

/** Build synthetic peaks for a cubic lattice with lattice parameter `a` and allowed s values. */
function synth(a: number, sVals: number[]): XrdPeak[] {
  return sVals.map((s, i) => ({
    twoTheta: 0,
    intensity: 100 - i,
    d: a / Math.sqrt(s),
    prominence: 100 - i,
  }));
}

describe('refineCubicLattice centring discrimination', () => {
  it('identifies a pure F-centred pattern as F', () => {
    // F allows s ≡ 0 or 3 (mod 4): 3, 8, 11, 16, 19, 24 (Si-like).
    const r = refineCubicLattice(synth(5.43102, [3, 8, 11, 16, 19, 24]));
    expect(r).not.toBeNull();
    expect(r!.centring).toBe('F');
    expect(r!.a).toBeCloseTo(5.43102, 3);
    expect(r!.relDev).toBeLessThan(1e-9);
  });

  it('identifies a pure I-centred pattern as I with correct a (bcc Fe)', () => {
    // I allows s even: 2, 4, 6, 8, 10, 12 (bcc Fe, a ≈ 2.8664 Å).
    const r = refineCubicLattice(synth(2.8664, [2, 4, 6, 8, 10, 12]));
    expect(r).not.toBeNull();
    expect(r!.centring).toBe('I');
    expect(r!.a).toBeCloseTo(2.8664, 3);
    expect(r!.relDev).toBeLessThan(1e-9);
  });

  it('indexes a pure P-centred pattern consistently', () => {
    // P and I patterns are d-space isomorphic (s→2s, a→a/√2), so a pure P
    // input may legitimately resolve to I; what matters is a self-consistent
    // indexing with negligible residual.
    const r = refineCubicLattice(synth(4.05, [1, 2, 3, 4, 5, 6]));
    expect(r).not.toBeNull();
    expect(r!.relDev).toBeLessThan(1e-9);
    expect(r!.indexed.length).toBe(6);
  });
});
