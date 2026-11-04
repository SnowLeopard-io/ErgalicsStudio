// bio-mendel kernel validation: χ² numerics against hand-computed and
// closed-form references, plus the bundled Mendel 1866 sample CSV.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MENDEL_F2_TRAITS,
  chiSquareGof,
  chiSquarePValue,
  groupTraits,
  mergedChiSquare,
  parseTraitCsv,
  runMendelBenchmarks,
} from '../src/plugins/builtin/bio/mendel/kernel';

describe('bio-mendel kernel', () => {
  it('reproduces the hand-computed example O=[12,8] vs 3:1 → χ² = 2.4 exactly', () => {
    const r = chiSquareGof([12, 8], [3, 1]);
    expect(r.expected[0]).toBeCloseTo(15, 9);
    expect(r.expected[1]).toBeCloseTo(5, 9);
    expect(r.chi2).toBeCloseTo(2.4, 9);
    expect(r.df).toBe(1);
    expect(r.p).toBe(chiSquarePValue(2.4, 1));
  });

  it('returns the df=1 upper 5% quantile: p(χ²=3.8414588) = 0.05 within 1e-4', () => {
    const p = chiSquarePValue(3.8414588206941236, 1);
    expect(Math.abs(p - 0.05)).toBeLessThan(1e-4);
  });

  it('matches the even-df closed forms Q(2,x)=e^(−x/2) and Q(4,x)=e^(−x/2)(1+x/2)', () => {
    const p2 = chiSquarePValue(2.71, 2);
    expect(p2).toBeCloseTo(Math.exp(-2.71 / 2), 9);
    const p4 = chiSquarePValue(6.31, 4);
    expect(p4).toBeCloseTo(Math.exp(-6.31 / 2) * (1 + 6.31 / 2), 9);
  });

  it('reproduces Mendel round:wrinkled 5474:1850 → χ² ≈ 0.262879, p ≈ 0.608', () => {
    const r = chiSquareGof([5474, 1850], [3, 1]);
    const exact = (19 * 19) / 5493 + (19 * 19) / 1831;
    expect(r.expected[0]).toBeCloseTo(5493, 6);
    expect(r.expected[1]).toBeCloseTo(1831, 6);
    expect(r.chi2).toBeCloseTo(exact, 9);
    expect(r.p).toBeGreaterThan(0.6);
    expect(r.p).toBeLessThan(0.62);
  });

  it('embeds all eight Mendel 1866 experiments with pooled df = 10', () => {
    expect(MENDEL_F2_TRAITS.length).toBe(18);
    const tests = groupTraits(MENDEL_F2_TRAITS);
    expect(tests.length).toBe(8);
    const pooled = mergedChiSquare(tests);
    expect(pooled.df).toBe(10);
    const sumOfParts = tests.reduce((a, t) => a + t.result.chi2, 0);
    expect(pooled.chi2).toBeCloseTo(sumOfParts, 9);
    // Mendel's counts are famously close to expectation (Fisher 1936).
    expect(pooled.p).toBeGreaterThan(0.95);
  });

  it('parses the bundled mendel-f2-seven-traits.csv sample into 18 rows', () => {
    const text = readFileSync(join('examples', 'data', 'mendel-f2-seven-traits.csv'), 'utf8');
    const rows = parseTraitCsv(text);
    expect(rows.length).toBe(18);
    expect(rows[0]!.trait).toBe('seed-form');
    expect(rows[0]!.observed).toBe(5474);
    expect(rows[0]!.expectedRatio).toBe(3);
    const tests = groupTraits(rows);
    expect(tests.length).toBe(8);
    const embedded = groupTraits(MENDEL_F2_TRAITS);
    expect(mergedChiSquare(tests).chi2).toBeCloseTo(mergedChiSquare(embedded).chi2, 9);
  });

  it('accepts TSV and bare two-column inputs', () => {
    const tsv = 'trait\tcategory\tobserved\tratio\nA\ta\t30\t3\nA\tb\t10\t1';
    expect(parseTraitCsv(tsv).length).toBe(2);
    const bare = '30,3\n10,1';
    const rows = parseTraitCsv(bare);
    expect(rows.length).toBe(2);
    expect(rows[0]!.observed).toBe(30);
    expect(rows[0]!.expectedRatio).toBe(3);
  });

  it('passes the embedded validation battery', () => {
    for (const b of runMendelBenchmarks()) expect(b.relErr).toBeLessThan(b.tolerance);
  });
});
