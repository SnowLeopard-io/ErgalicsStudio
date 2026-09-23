import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WF,
  applySelection,
  effectiveHeterozygosity,
  hweTest,
  mulberry32,
  parseGenotypeCounts,
  parseVcfGenotypes,
  wrightFisher,
} from '../src/plugins/builtin/bio-popgen/popgen';

describe('bio-popgen kernel', () => {
  it('mulberry32 is deterministic and bounded', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i += 1) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('computes allele frequencies from genotype counts', () => {
    // 42 AA + 46 Aa + 12 aa → N=100, p=(84+46)/200=0.65, q=0.35
    const r = hweTest({ AA: 42, Aa: 46, aa: 12 });
    expect(r.alleleA).toBeCloseTo(0.65, 9);
    expect(r.alleleB).toBeCloseTo(0.35, 9);
    expect(r.expected.AA).toBeCloseTo(0.4225 * 100, 6);
    expect(r.expected.Aa).toBeCloseTo(2 * 0.65 * 0.35 * 100, 6);
  });

  it('perfect HWE data yields chi² ≈ 0 and p ≈ 1', () => {
    // p=0.5 → 25 AA, 50 Aa, 25 aa
    const r = hweTest({ AA: 25, Aa: 50, aa: 25 });
    expect(r.chi2).toBeLessThan(1e-9);
    expect(r.pValue).toBeCloseTo(1, 6);
    expect(r.deviates).toBe(false);
  });

  it('does not reject HWE at the 5% level for mild deviations', () => {
    // small perturbation stays within sampling noise at this sample size
    const r = hweTest({ AA: 27, Aa: 46, aa: 27 });
    expect(r.deviates).toBe(false);
  });

  it('Wilks/chi-square p-value is bounded in [0,1] and monotone in chi²', () => {
    const low = hweTest({ AA: 25, Aa: 50, aa: 25 });
    const mid = hweTest({ AA: 30, Aa: 40, aa: 30 });
    const high = hweTest({ AA: 40, Aa: 20, aa: 40 }); // strong heterozygote deficit
    expect(high.chi2).toBeGreaterThan(mid.chi2);
    expect(low.pValue).toBeGreaterThan(mid.pValue);
    expect(mid.pValue).toBeGreaterThan(high.pValue);
    for (const v of [low, mid, high]) {
      expect(v.pValue).toBeGreaterThanOrEqual(0);
      expect(v.pValue).toBeLessThanOrEqual(1);
    }
  });

  it('Wright-Fisher conserves the allele as a martingale on average (E[p_∞] ≈ p₀)', () => {
    const wf = wrightFisher({ ...DEFAULT_WF, p0: 0.5, replicates: 160, generations: 20, seed: 7 });
    const finalP = wf.paths.map((p) => p[p.length - 1]!);
    const meanFinal = finalP.reduce((a, b) => a + b, 0) / finalP.length;
    expect(Math.abs(meanFinal - 0.5)).toBeLessThan(0.1);
  });

  it('drift with no selection yields fixation of a private allele eventually at high N', () => {
    const wf = wrightFisher({ ...DEFAULT_WF, p0: 0.5, diploidN: 8, generations: 120, replicates: 30, seed: 3 });
    const fixedLost = wf.fixedA + wf.lostA;
    expect(fixedLost).toBeGreaterThan(0); // some replicates fix
    expect(wf.fixedA + wf.lostA).toBeLessThanOrEqual(wf.paths.length);
  });

  it('positive selection biases fixation toward the advantageous allele', () => {
    const sel = wrightFisher({ p0: 0.5, diploidN: 60, generations: 180, replicates: 200, selection: 0.08, dominance: 0.5, seed: 11 });
    // with an advantage of the A allele, a clear majority should fix A
    expect(sel.fixedA).toBeGreaterThan(sel.lostA);
    expect(sel.meanFixationTime).not.toBeNull();
  });

  it('heterozygosity decays (H_eff lower than at t=0)', () => {
    const wf = wrightFisher({ ...DEFAULT_WF, p0: 0.9, replicates: 120, seed: 5 });
    const initH = wf.paths.reduce((a, p) => a + 2 * p[0]! * (1 - p[0]!), 0) / wf.paths.length;
    const finalH = effectiveHeterozygosity(wf.paths);
    expect(finalH).toBeLessThanOrEqual(initH + 1e-9);
  });

  it('applySelection adds a consistent selection pressure', () => {
    // s>0, h=1 (dominant) favours A → post-selection frequency rises
    const p2 = applySelection(0.5, 0.1, 1);
    expect(p2).toBeGreaterThan(0.5);
    // s=0 → unchanged
    expect(applySelection(0.5, 0, 0)).toBeCloseTo(0.5, 9);
  });
});

describe('bio-popgen genotype parsers', () => {
  it('parses a header + comment CSV of AA,Aa,aa counts', () => {
    const c = parseGenotypeCounts('# note\nAA,Aa,aa\n52,96,50');
    expect(c).toEqual({ AA: 52, Aa: 96, aa: 50 });
  });

  it('parses a bare three-number row and a JSON object / array', () => {
    expect(parseGenotypeCounts('10 20 30')).toEqual({ AA: 10, Aa: 20, aa: 30 });
    expect(parseGenotypeCounts('{"AA":2,"Aa":3,"aa":5}')).toEqual({ AA: 2, Aa: 3, aa: 5 });
    expect(parseGenotypeCounts('[2,3,5]')).toEqual({ AA: 2, Aa: 3, aa: 5 });
  });

  it('returns null for invalid / negative counts', () => {
    expect(parseGenotypeCounts('')).toBeNull();
    expect(parseGenotypeCounts('a,b,c')).toBeNull();
    expect(parseGenotypeCounts('10,-2,5')).toBeNull();
  });

  it('parses VCF genotypes: 0/0→AA, 0/1→Aa, 1/1→aa', () => {
    const vcf = `##fileformat=VCFv4.2
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\tS2\tS3
chr1\t1\t.\tA\tG\t.\tPASS\t.\tGT\t0/0\t0/1\t1/1
chr1\t2\t.\tA\tG\t.\tPASS\t.\tGT\t0|1\t0/0\t1|1`;
    const c = parseVcfGenotypes(vcf);
    expect(c).toEqual({ AA: 2, Aa: 2, aa: 2 });
  });

  it('ignores missing ./ and non-GT columns in VCF', () => {
    const vcf = `##fileformat=VCFv4.2
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\tS2\tS3
chrX\t7\t.\tC\tT\t.\tPASS\t.\tGT\t./.\t0/1\t0/0`;
    const c = parseVcfGenotypes(vcf);
    expect(c).toEqual({ AA: 1, Aa: 1, aa: 0 });
  });
});