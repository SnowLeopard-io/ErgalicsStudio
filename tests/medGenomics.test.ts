import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHI2_ONE_DF_MEDIAN,
  GENOMEWIDE_P,
  bonferroniThreshold,
  circosSummary,
  compareChr,
  dataLines,
  detectDelimiter,
  gseaCore,
  gwasSummary,
  genomicInflationFromP,
  ldSummary,
  maxLdBlock,
  parseGwasCsv,
  parseLdCsv,
  parseRankedCsv,
  parseRearrangements,
  parseVolcanoCsv,
  pToChi2,
  qqPlotData,
  runGsea,
  volcanoSummary,
} from '../src/plugins/builtin/med/genomics/genomics';

const GWAS_CSV = [
  'chr,pos,p,beta,label',
  '1,1000,0.5,0.10,rs1',
  '1,2000,1e-9,-0.40,rs2',
  '2,1500,0.01,0.20,',
  '3,500,0,0.10,', // p=0 is invalid -> row dropped
  'X,777,0.9,0.00,rsX',
  'X,888,1e-6,0.05,rsS', // suggestive but not genome-wide
].join('\n');

describe('med-genomics CSV intake', () => {
  it('detects delimiters and skips comment lines', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(dataLines('# a note\nchr,pos,p\n#CHROM,pos,p\n1,1,0.5\n\n2,2,0.1')).toEqual([
      'chr,pos,p',
      'CHROM,pos,p',
      '1,1,0.5',
      '2,2,0.1',
    ]);
  });

  it('parses a GWAS table: rows, chromosome slots, p bounds, dropped invalid rows', () => {
    const g = parseGwasCsv(GWAS_CSV);
    expect(g).not.toBeNull();
    expect(g!.n).toBe(5);
    expect(g!.chrNames).toEqual(['1', '2', 'X']); // rank-sorted, chr3 row dropped
    expect(g!.chrIdx[0]).toBe(0);
    expect(g!.chrIdx[2]).toBe(1);
    expect(g!.chrIdx[3]).toBe(2);
    expect(g!.effectKind).toBe('beta');
    expect(g!.effect![1]).toBeCloseTo(-0.4, 10);
    for (let i = 0; i < g!.n; i += 1) {
      expect(g!.p[i]!).toBeGreaterThan(0);
      expect(g!.p[i]!).toBeLessThanOrEqual(1);
    }
    expect(g!.labels![1]).toBe('rs2');
  });

  it('stores odds ratios as ln(OR) and normalizes chr prefixes', () => {
    const g = parseGwasCsv('chr,pos,p,or\nchr1,100,0.5,2\nchr2,200,0.5,0.5\n');
    expect(g).not.toBeNull();
    expect(g!.effectKind).toBe('or');
    expect(g!.effect![0]).toBeCloseTo(Math.LN2, 10);
    expect(g!.effect![1]).toBeCloseTo(-Math.LN2, 10);
    expect(g!.chrNames).toEqual(['1', '2']);
  });

  it('parses volcano tables, falls back to a p column, and classifies counts', () => {
    const v = parseVolcanoCsv('gene,log2fc,padj\nG1,2.5,1e-6\nG2,-3,0.001\nG3,0.2,0.4\nG4,1.5,0\n');
    expect(v).not.toBeNull();
    expect(v!.n).toBe(4);
    expect(v!.padj[3]).toBeGreaterThan(0); // padj=0 clamped away from -log10(0)
    const s = volcanoSummary(v!, 1, 0.05);
    expect(s.up).toBe(2);
    expect(s.down).toBe(1);
    expect(s.ns).toBe(1);

    const viaP = parseVolcanoCsv('gene,log2fc,p\nG1,1.2,0.01\nG2,-1.2,0.5\n');
    expect(viaP).not.toBeNull();
    expect(viaP!.padj[0]).toBeCloseTo(0.01, 10);

    const noHeader = parseVolcanoCsv('G1,1.2,0.01\nG2,-1.2,0.5\n');
    expect(noHeader).not.toBeNull();
    expect(noHeader!.n).toBe(2);
  });

  it('parses a preranked list and keeps the descending order stable', () => {
    const r = parseRankedCsv('gene,score\nA,1\nB,3\nC,2\n');
    expect(r).not.toBeNull();
    expect(r!.gene).toEqual(['B', 'C', 'A']);
    expect(Array.from(r!.score)).toEqual([3, 2, 1]);
  });
});

describe('med-genomics GWAS statistics', () => {
  it('pToChi2(0.5) equals the chi2(1) median and lambda of constant p=0.5 is 1', () => {
    expect(pToChi2(0.5)).toBeCloseTo(CHI2_ONE_DF_MEDIAN, 9); // probit is a rational approximation
    expect(pToChi2(1)).toBeCloseTo(0, 10);
    expect(genomicInflationFromP([0.5, 0.5, 0.5])).toBeCloseTo(1, 9);
  });

  it('computes lambda from hand-calculated chi-square quantiles', () => {
    // chi2(0.9) = probit(0.55)^2 = 0.0157922; chi2(0.7) = probit(0.65)^2 = 0.1484718;
    // chi2(0.2) = probit(0.90)^2 = 1.6423740 -> median 0.1484718
    const deflated = genomicInflationFromP([0.9, 0.7, 0.2]);
    expect(deflated).toBeCloseTo(0.1484718 / CHI2_ONE_DF_MEDIAN, 3);
    // upper-tail chi2(1) quantiles: p=0.2 -> 1.642374, p=0.1 -> 2.705543, p=0.05 -> 3.841459
    const inflated = genomicInflationFromP([0.2, 0.1, 0.05]);
    expect(inflated).toBeCloseTo(2.705543 / CHI2_ONE_DF_MEDIAN, 2);
  });

  it('Bonferroni threshold is alpha/n', () => {
    expect(bonferroniThreshold(1000)).toBeCloseTo(5e-5, 15);
    expect(bonferroniThreshold(1000, 0.01)).toBeCloseTo(1e-5, 15);
    expect(Number.isNaN(bonferroniThreshold(0))).toBe(true);
  });

  it('summarizes hits against the genome-wide threshold', () => {
    const g = parseGwasCsv(GWAS_CSV)!;
    const s = gwasSummary(g);
    expect(s.genomeWideHits).toBe(1); // p = 1e-9
    expect(s.suggestiveHits).toBe(1); // only p = 1e-6 (1e-9 counts as genome-wide)
    expect(s.minP).toBe(1e-9);
    expect(s.bonferroni).toBeCloseTo(0.05 / g.n, 12);
    expect(GENOMEWIDE_P).toBe(5e-8);
  });

  it('builds QQ points with an ordered axis and a bounded 95% band', () => {
    const g = parseGwasCsv(GWAS_CSV)!;
    const qq = qqPlotData(g)!;
    expect(qq).not.toBeNull();
    expect(qq.n).toBe(g.n);
    for (let i = 1; i < qq.n; i += 1) {
      // expected axis = -log10((i+0.5)/n) decreases as the rank grows
      expect(qq.expected[i]!).toBeLessThan(qq.expected[i - 1]!);
    }
    for (let i = 0; i < qq.n; i += 1) {
      expect(qq.bandLo[i]!).toBeLessThanOrEqual(qq.bandHi[i]!);
    }
    expect(qq.lambda).toBeCloseTo(gwasSummary(g).lambda, 10);
  });
});

describe('med-genomics GSEA', () => {
  const ranked = {
    n: 10,
    gene: Array.from({ length: 10 }, (_, i) => `g${i + 1}`),
    score: Float64Array.from({ length: 10 }, () => 1),
  };

  it('ES = +1 when the set is the top 3 of an equal-score list', () => {
    const core = gseaCore(ranked, ['g1', 'g2', 'g3']);
    expect(core).not.toBeNull();
    expect(core!.es).toBeCloseTo(1, 10);
    expect(core!.esIndex).toBe(2);
    expect(core!.runningEs[9]).toBeCloseTo(0, 10); // running sum ends at 0
    expect(core!.setSize).toBe(3);
  });

  it('ES = -1 when the set is the bottom 3 of an equal-score list', () => {
    const core = gseaCore(ranked, ['g8', 'g9', 'g10']);
    expect(core).not.toBeNull();
    expect(core!.es).toBeCloseTo(-1, 10);
    expect(core!.esIndex).toBe(6); // trough right before the first hit
    expect(core!.runningEs[9]).toBeCloseTo(0, 10);
  });

  it('returns null for an empty or disjoint gene set', () => {
    expect(gseaCore(ranked, [])).toBeNull();
    expect(gseaCore(ranked, ['nope1', 'nope2'])).toBeNull();
  });

  it('is deterministic under a fixed seed and reports a valid nominal p', () => {
    const list = parseRankedCsv(
      ['gene,score', ...Array.from({ length: 30 }, (_, i) => `g${i + 1},${30 - i}`)].join('\n'),
    )!;
    const set = ['g1', 'g2', 'g3', 'g4', 'g5'];
    const a = runGsea(list, set, { permutations: 100, seed: 42 })!;
    const b = runGsea(list, set, { permutations: 100, seed: 42 })!;
    expect(a).not.toBeNull();
    expect(a.es).toBe(b.es);
    expect(a.nominalP).toBe(b.nominalP);
    expect(a.nes).toBe(b.nes);
    expect(a.qValue).toBe(b.qValue);
    expect(a.nominalP).toBeGreaterThan(0);
    expect(a.nominalP).toBeLessThanOrEqual(1);
    expect(a.permutations).toBe(100);
    expect(a.setSize).toBe(5);
    expect(runGsea(list, set, { permutations: 100, seed: 7 })!.es).toBe(a.es); // ES is seed-free
  });
});

describe('med-genomics LD matrix', () => {
  const headerMatrix = [
    'id,a,b,c,d',
    'a,1,0.9,0.1,0.2',
    'b,0.9,1,0.8,0.1',
    'c,0.1,0.8,1,0.7',
    'd,0.2,0.1,0.7,1',
  ].join('\n');

  it('parses a header square matrix with row labels', () => {
    const d = parseLdCsv(headerMatrix)!;
    expect(d).not.toBeNull();
    expect(d.n).toBe(4);
    expect(d.ids).toEqual(['a', 'b', 'c', 'd']);
    expect(d.r2[0]).toBe(1); // diagonal
    expect(d.r2[1]).toBe(0.9);
    const s = ldSummary(d);
    expect(s.maxR2).toBeCloseTo(0.9, 10);
    expect(s.meanR2).toBeCloseTo((0.9 + 0.1 + 0.2 + 0.8 + 0.1 + 0.7) / 6, 10);
  });

  it('parses a headerless numeric square matrix', () => {
    const d = parseLdCsv(['1,0.2,0.3', '0.2,1,0.4', '0.3,0.4,1'].join('\n'))!;
    expect(d).not.toBeNull();
    expect(d.n).toBe(3);
    expect(d.ids).toEqual(['1', '2', '3']);
    expect(d.r2[0 * 3 + 1]).toBeCloseTo(0.2, 10);
    expect(d.r2[2 * 3 + 2]).toBe(1);
  });

  it('finds the largest all-pairs r2 >= 0.5 block', () => {
    const d = parseLdCsv(headerMatrix)!;
    const block = maxLdBlock(d, 0.5)!;
    expect(block.size).toBe(2); // pairs (a,b), (b,c), (c,d) pass but triples fail
    expect(block.start).toBe(0);
    expect(block.end).toBe(2);
    expect(block.minR2).toBeCloseTo(0.9, 10);
  });

  it('parses a long pos_i,pos_j,r2 table into a symmetric matrix', () => {
    const d = parseLdCsv(
      ['pos_i,pos_j,r2', '100,200,0.9', '100,300,0.1', '200,300,0.8'].join('\n'),
    )!;
    expect(d).not.toBeNull();
    expect(d.n).toBe(3);
    expect(d.ids).toEqual(['100', '200', '300']);
    expect(d.r2[0 * 3 + 1]).toBeCloseTo(0.9, 10);
    expect(d.r2[1 * 3 + 0]).toBeCloseTo(0.9, 10); // symmetric fill
    expect(d.r2[2 * 3 + 2]).toBe(1);
    const s = ldSummary(d);
    expect(s.meanR2).toBeCloseTo((0.9 + 0.1 + 0.8) / 3, 10);
    const block = maxLdBlock(d, 0.5)!;
    expect(block.start).toBe(0);
    expect(block.end).toBe(2);
  });
});

describe('med-genomics circos shaping', () => {
  const text = [
    'chrA,posA,chrB,posB,type',
    '1,1000000,1,5000000,inversion',
    '1,2000000,2,3000000,translocation',
    'chrX,500000,3,700000,deletion',
  ].join('\n');

  it('parses events, anchors, types and per-chromosome lengths', () => {
    const d = parseRearrangements(text)!;
    expect(d).not.toBeNull();
    expect(d.n).toBe(3);
    expect(d.types).toEqual(['inversion', 'translocation', 'deletion']);
    expect(d.lengths['1']).toBe(5000000); // largest anchor on chr1
    expect(d.lengths['X']).toBe(500000);
    expect(d.lengths['3']).toBe(700000);
    expect(d.events[0]!.chrA).toBe('1');
    expect(d.events[2]!.chrA).toBe('X'); // chr prefix normalized
    expect(d.events[2]!.chrB).toBe('3');
  });

  it('summarizes totals, cross-chromosome events and type counts', () => {
    const d = parseRearrangements(text)!;
    const s = circosSummary(d);
    expect(s.total).toBe(3);
    expect(s.crossChromosome).toBe(2); // event 1 is intra-chromosomal
    expect(s.chromosomes).toBe(4); // 1, 2, 3, X
    expect(s.byType['translocation']).toBe(1);
  });

  it('rejects tables without anchor columns', () => {
    expect(parseRearrangements('a,b\n1,2\n')).toBeNull();
  });
});

describe('med-genomics bundled example datasets', () => {
  const read = (name: string) => readFileSync(new URL(`../examples/data/${name}`, import.meta.url), 'utf8');

  it('med-gwas-sim.csv: 22 chromosomes, ~20k variants, calibrated lambda, planted signals', () => {
    const g = parseGwasCsv(read('med-gwas-sim.csv'))!;
    expect(g).not.toBeNull();
    expect(g.n).toBeGreaterThan(19000);
    expect(g.chrNames.length).toBe(22);
    expect(compareChr('2', '10')).toBeLessThan(0);
    const s = gwasSummary(g);
    expect(s.lambda).toBeGreaterThan(0.85);
    expect(s.lambda).toBeLessThan(1.15);
    expect(s.genomeWideHits).toBeGreaterThanOrEqual(1);
    expect(s.bonferroni).toBeCloseTo(0.05 / g.n, 12);
  });

  it('med-volcano-de.csv: ~2000 genes with a clear DE set at the default cutoffs', () => {
    const v = parseVolcanoCsv(read('med-volcano-de.csv'))!;
    expect(v).not.toBeNull();
    expect(v.n).toBe(2000);
    const s = volcanoSummary(v, 1, 0.05);
    expect(s.up).toBeGreaterThanOrEqual(40);
    expect(s.down).toBeGreaterThanOrEqual(30);
  });

  it('med-ld-matrix.csv: 40x40 labelled matrix with a high-LD block', () => {
    const d = parseLdCsv(read('med-ld-matrix.csv'))!;
    expect(d).not.toBeNull();
    expect(d.n).toBe(40);
    expect(d.ids[0]).toBe('B01');
    const s = ldSummary(d);
    expect(s.maxR2).toBeGreaterThanOrEqual(0.9);
    expect(s.meanR2).toBeGreaterThan(0);
    expect(s.meanR2).toBeLessThan(1);
    const block = maxLdBlock(d, 0.5)!;
    expect(block.size).toBeGreaterThanOrEqual(5);
  });

  it('med-circos-rearrangements.csv: 30 events across many chromosomes', () => {
    const d = parseRearrangements(read('med-circos-rearrangements.csv'))!;
    expect(d).not.toBeNull();
    expect(d.n).toBe(30);
    expect(Object.keys(d.lengths).length).toBeGreaterThanOrEqual(15);
    const s = circosSummary(d);
    expect(s.crossChromosome).toBeGreaterThanOrEqual(10);
    expect(Object.keys(s.byType).length).toBeGreaterThanOrEqual(4);
  });
});
