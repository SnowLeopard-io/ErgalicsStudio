// ==========================================================================
// Synthetic data kernel (src/core/dataeng/synth) — unit tests.
//
// Covers: seeded RNG determinism, normal-quantile round trip, PSD repair +
// Cholesky, Gaussian-copula correlation preservation, univariate KS distance,
// Laplace ε-DP noise bounds, k-anonymity (binning + suppression), quality
// metrics sanity and CSV round-trip.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@/core/repro/random';
import {
  applyKAnonymity,
  cholesky,
  createRng,
  dpMean,
  fitNumeric,
  generateSynthetic,
  gaussian,
  ksStatistic,
  laplaceNoise,
  makePsd,
  normalCdf,
  normalQuantile,
  parseCsvTable,
  pearson,
  quantile,
  qualityMetrics,
  toCsv,
  type SynthTable,
} from '@/core/dataeng/synth';

// ---- helpers ----------------------------------------------------------------

/** Bivariate standard-normal sample with population correlation `rho`. */
function bivariateNormal(n: number, rho: number, seed: number): { xs: number[]; ys: number[] } {
  const rng = createRng(seed);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = gaussian(rng);
    const b = gaussian(rng);
    xs.push(a);
    ys.push(rho * a + Math.sqrt(1 - rho * rho) * b);
  }
  return { xs, ys };
}

function tableFromCols(columns: string[], cols: number[][]): SynthTable {
  const n = cols[0]?.length ?? 0;
  const rows = Array.from({ length: n }, (_, i) => cols.map((c) => c[i] ?? 0));
  return { columns, rows };
}

function columnValues(table: SynthTable, name: string): number[] {
  const idx = table.columns.indexOf(name);
  return table.rows
    .map((r) => r[idx])
    .filter((v): v is number => typeof v === 'number');
}

// ---- seeded RNG --------------------------------------------------------------

describe('seeded RNG determinism', () => {
  it('produces the same sequence for the same seed (mulberry32)', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 64 }, () => a());
    const seqB = Array.from({ length: 64 }, () => b());
    expect(seqB).toEqual(seqA);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs across seeds and matches the shared core implementation', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
    const core = mulberry32(7);
    const mine = createRng(7);
    expect(mine()).toBe(core());
  });

  it('generates bit-identical synthetic tables for identical (data, seed)', () => {
    const { xs, ys } = bivariateNormal(120, 0.5, 7);
    const t = tableFromCols(['x', 'y'], [xs, ys]);
    const opts = { rows: 80, seed: 42, mode: 'copula' as const, privacy: 'none' as const, epsilon: 1, k: 5 };
    const r1 = generateSynthetic(t, opts);
    const r2 = generateSynthetic(t, opts);
    expect(JSON.stringify(r1.table)).toBe(JSON.stringify(r2.table));
    const r3 = generateSynthetic(t, { ...opts, seed: 43 });
    expect(JSON.stringify(r3.table)).not.toBe(JSON.stringify(r1.table));
  });
});

// ---- normal distribution machinery ---------------------------------------------

describe('normal CDF / quantile round trip', () => {
  it('inverts the CDF to ~1e-6 across the unit interval', () => {
    for (const p of [0.001, 0.02425, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975, 0.999]) {
      expect(Math.abs(normalCdf(normalQuantile(p)) - p)).toBeLessThan(1e-6);
    }
    expect(normalQuantile(0.5)).toBeCloseTo(0, 8);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 4);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
  });
});

// ---- linear algebra ---------------------------------------------------------------

describe('PSD repair and Cholesky', () => {
  it('clamps negative eigenvalues and yields a Cholesky factor', () => {
    // Indefinite correlation-like matrix (smallest eigenvalue ≈ 1 - 0.99√2 < 0).
    const bad = [
      [1, 0.99, 0],
      [0.99, 1, 0.99],
      [0, 0.99, 1],
    ];
    const fixed = makePsd(bad);
    expect(cholesky(fixed)).not.toBeNull();
    // Unit diagonal after rescaling, still symmetric.
    for (let i = 0; i < 3; i += 1) expect(fixed[i]![i]!).toBeCloseTo(1, 10);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) expect(fixed[i]![j]!).toBeCloseTo(fixed[j]![i]!, 12);
    }
    // Clamping the negative eigenvalue pulls the infeasible 0.99 correlation
    // down, but the projection stays in the same neighbourhood.
    expect(fixed[0]![1]!).toBeLessThan(0.99);
    expect(fixed[0]![1]!).toBeGreaterThan(0.5);
  });

  it('keeps a well-conditioned matrix unchanged', () => {
    const good = [
      [1, 0.5],
      [0.5, 1],
    ];
    const out = makePsd(good);
    expect(out[0]![1]!).toBeCloseTo(0.5, 10);
  });
});

// ---- Gaussian copula ---------------------------------------------------------------

describe('Gaussian copula preserves correlation', () => {
  it('reproduces rho = 0.8 within 0.15 (mode: copula)', () => {
    const { xs, ys } = bivariateNormal(600, 0.8, 2026);
    const original = tableFromCols(['x', 'y'], [xs, ys]);
    const res = generateSynthetic(original, {
      rows: 600,
      seed: 42,
      mode: 'copula',
      privacy: 'none',
      epsilon: 1,
      k: 5,
    });
    const sx = columnValues(res.table, 'x');
    const sy = columnValues(res.table, 'y');
    expect(sx).toHaveLength(600);
    const rSyn = pearson(sx, sy);
    expect(Math.abs(rSyn - 0.8)).toBeLessThan(0.15);
    // The quality report agrees (correlation drift component).
    expect(res.report.corrAbsDiff).not.toBeNull();
    expect(res.report.corrAbsDiff!).toBeLessThan(0.15);
  });

  it('does not fabricate correlation in independent mode', () => {
    const { xs, ys } = bivariateNormal(600, 0.8, 2026);
    const original = tableFromCols(['x', 'y'], [xs, ys]);
    const res = generateSynthetic(original, {
      rows: 600,
      seed: 42,
      mode: 'independent',
      privacy: 'none',
      epsilon: 1,
      k: 5,
    });
    const rSyn = pearson(columnValues(res.table, 'x'), columnValues(res.table, 'y'));
    expect(Math.abs(rSyn)).toBeLessThan(0.3);
  });
});

// ---- univariate fidelity ------------------------------------------------------------

describe('KS distance for a normal column', () => {
  it('stays below 0.15 for 500-row normal data (mode: independent)', () => {
    const rng = createRng(11);
    const xs = Array.from({ length: 500 }, () => gaussian(rng));
    const original = tableFromCols(['v'], [xs]);
    const res = generateSynthetic(original, {
      rows: 500,
      seed: 42,
      mode: 'independent',
      privacy: 'none',
      epsilon: 1,
      k: 5,
    });
    const ks = res.report.perColumn.find((d) => d.column === 'v')?.ks;
    expect(ks).toBeDefined();
    expect(ks!).toBeLessThan(0.15);
    expect(res.report.meanKs!).toBeLessThan(0.15);
  });

  it('selects the best marginal by minimal KS (uniform beats normal for uniform data)', () => {
    const rng = createRng(5);
    const us = Array.from({ length: 800 }, () => rng());
    const fit = fitNumeric(us);
    expect(fit.kind).toBe('uniform');
    const normalData = Array.from({ length: 800 }, () => gaussian(rng));
    expect(fitNumeric(normalData).kind).toBe('normal');
  });

  it('computes the KS statistic exactly on a toy case', () => {
    expect(ksStatistic([1, 2, 3, 4], [1, 2, 3, 4])).toBe(0);
    expect(ksStatistic([1, 2, 3, 4], [5, 6, 7, 8])).toBeCloseTo(1, 12);
    expect(ksStatistic([1, 3], [2, 4])).toBeCloseTo(0.5, 12);
  });

  it('quantile is the type-7 definition', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 12);
  });
});

// ---- time-series mode --------------------------------------------------------------

describe('AR(1) time-series mode keeps lag-1 autocorrelation', () => {
  it('reproduces a strong positive autocorrelation within tolerance', () => {
    const rng = createRng(9);
    const n = 800;
    const series: number[] = [];
    let prev = 0;
    for (let i = 0; i < n; i += 1) {
      prev = 0.85 * prev + Math.sqrt(1 - 0.85 * 0.85) * gaussian(rng);
      series.push(prev);
    }
    const original = tableFromCols(['signal'], [series]);
    const res = generateSynthetic(original, {
      rows: 800,
      seed: 42,
      mode: 'timeseries',
      privacy: 'none',
      epsilon: 1,
      k: 5,
    });
    const syn = columnValues(res.table, 'signal');
    // lag-1 autocorrelation of the synthetic series vs the target 0.85.
    const m = series.reduce((s, v) => s + v, 0) / series.length;
    const sm = syn.reduce((s, v) => s + v, 0) / syn.length;
    let c0 = 0;
    let c1 = 0;
    for (let i = 0; i < syn.length; i += 1) {
      const d = syn[i]! - sm;
      c0 += d * d;
      if (i + 1 < syn.length) c1 += d * (syn[i + 1]! - sm);
    }
    const rhoSyn = c1 / c0;
    const rhoOrig =
      series.reduce((s, v, i) => s + (v - m) * ((series[i + 1] ?? v) - m), 0) /
      series.reduce((s, v) => s + (v - m) * (v - m), 0);
    expect(Math.abs(rhoSyn - rhoOrig)).toBeLessThan(0.2);
    // Marginal shape is preserved too.
    expect(res.report.perColumn[0]?.ks ?? 1).toBeLessThan(0.15);
  });
});

// ---- differential privacy ------------------------------------------------------------

describe('Laplace epsilon-DP', () => {
  it('is deterministic under a seed and centred on the true statistic', () => {
    const a = laplaceNoise(createRng(42), 1, 1);
    const b = laplaceNoise(createRng(42), 1, 1);
    expect(a).toBe(b);
    // Empirical mean over many draws ≈ 0, spread scales with 1/ε.
    const rng = createRng(3);
    const draws = Array.from({ length: 20000 }, () => laplaceNoise(rng, 1, 1));
    const m = draws.reduce((s, v) => s + v, 0) / draws.length;
    expect(Math.abs(m)).toBeLessThan(0.05);
    const epsHalf = Array.from({ length: 2000 }, () => laplaceNoise(rng, 0.5, 1));
    const spread = (xs: number[]) => Math.sqrt(xs.reduce((s, v) => s + v * v, 0) / xs.length);
    expect(spread(epsHalf)).toBeGreaterThan(spread(draws.slice(0, 2000)));
  });

  it('dpMean bias is bounded by 5·σ/(ε·√n)', () => {
    const rng = createRng(17);
    const values = Array.from({ length: 500 }, () => gaussian(rng));
    const trueMean = values.reduce((s, v) => s + v, 0) / values.length;
    const sigma = Math.sqrt(values.reduce((s, v) => s + (v - trueMean) * (v - trueMean), 0) / (values.length - 1));
    const epsilon = 1;
    const released = dpMean(values, epsilon, createRng(42));
    expect(released.sensitivity).toBeCloseTo((Math.max(...values) - Math.min(...values)) / 500, 12);
    const bound = (5 * sigma) / (epsilon * Math.sqrt(500));
    expect(Math.abs(released.value - trueMean)).toBeLessThan(bound);
  });

  it('generation with privacy=dp runs and reports the epsilon budget', () => {
    const rng = createRng(23);
    const xs = Array.from({ length: 300 }, () => gaussian(rng));
    const original = tableFromCols(['v'], [xs]);
    const res = generateSynthetic(original, {
      rows: 300,
      seed: 42,
      mode: 'copula',
      privacy: 'dp',
      epsilon: 1,
      k: 5,
    });
    expect(res.privacy.mode).toBe('dp');
    expect(res.privacy.epsilon).toBe(1);
    expect(res.table.rows).toHaveLength(300);
    expect(Number.isFinite(res.report.overall)).toBe(true);
    // The DP release stays close to the original distribution (histogram fidelity).
    expect(res.report.perColumn[0]?.ks ?? 1).toBeLessThan(0.5);
  });
});

// ---- k-anonymity -------------------------------------------------------------------------

describe('k-anonymity (binning + suppression)', () => {
  const base = (): SynthTable => {
    const rows: SynthTable['rows'] = [];
    for (const region of ['north', 'south', 'east']) {
      for (const age of [30, 60]) {
        for (let i = 0; i < 50; i += 1) rows.push([region, age]);
      }
    }
    return { columns: ['region', 'age'], rows };
  };

  it('keeps every equivalence class at or above k after generalization', () => {
    const out = applyKAnonymity(base(), 50);
    expect(out.suppressed).toBe(0);
    expect(out.minClassSize).toBeGreaterThanOrEqual(50);
    expect(out.table.rows).toHaveLength(300);
    // The numeric quasi-identifier is generalized to bin midpoints.
    expect(out.binnedColumns).toContain('age');
    const ages = out.table.rows.map((r) => r[1]).filter((v): v is number => typeof v === 'number');
    expect(ages.some((v) => v !== 30 && v !== 60)).toBe(true);
    for (const v of ages) expect(v).toBeGreaterThanOrEqual(30);
  });

  it('suppresses all rows when every class is smaller than k', () => {
    const out = applyKAnonymity(base(), 60);
    expect(out.table.rows).toHaveLength(0);
    expect(out.suppressed).toBe(300);
  });

  it('is reachable end-to-end through generateSynthetic', () => {
    const csv = ['region,age', ...Array.from({ length: 60 }, (_, i) => `north,${20 + (i % 2) * 40}`), ...Array.from({ length: 60 }, (_, i) => `south,${20 + (i % 2) * 40}`)].join('\n');
    const original = parseCsvTable(csv)!;
    const res = generateSynthetic(original, {
      rows: 120,
      seed: 42,
      mode: 'independent',
      privacy: 'k-anonymity',
      epsilon: 1,
      k: 10,
    });
    expect(res.privacy.mode).toBe('k-anonymity');
    expect(res.privacy.k).toBe(10);
    expect(res.table.rows.length + (res.privacy.suppressed ?? 0)).toBe(120);
    if (res.table.rows.length > 0) {
      expect(res.privacy.minClassSize ?? 0).toBeGreaterThanOrEqual(10);
    }
  });
});

// ---- quality metrics + CSV --------------------------------------------------------------

describe('qualityMetrics', () => {
  it('reports a perfect score for identical tables', () => {
    const { xs, ys } = bivariateNormal(200, 0.6, 31);
    const t = tableFromCols(['x', 'y'], [xs, ys]);
    const rep = qualityMetrics(t, t);
    expect(rep.meanKs).toBe(0);
    expect(rep.corrAbsDiff).toBe(0);
    expect(rep.missingRateDiff).toBe(0);
    expect(rep.overall).toBeCloseTo(1, 12);
  });

  it('does not score a numeric column with no synthetic values as a perfect match', () => {
    // k-anonymity with a large k (or DP with a small ε) can empty a column.
    // It used to be scored as KS = 0 ("identical"), which RAISED the overall
    // similarity — an absence looked like a perfect match.
    const original = tableFromCols(
      ['x', 'y'],
      [
        [1, 2, 3, 4, 5],
        [30, 20, 10, 40, 50],
      ],
    );
    const synthetic: SynthTable = {
      columns: ['x', 'y'],
      rows: [
        [null, 30],
        [null, 20],
        [null, 10],
        [null, 40],
        [null, 50],
      ],
    };
    const rep = qualityMetrics(original, synthetic);
    const x = rep.perColumn.find((d) => d.column === 'x')!;
    expect(Number.isNaN(x.ks)).toBe(true);
    expect(Number.isNaN(x.similarity)).toBe(true);
    expect(rep.skippedColumns).toEqual(['x']);
    // `y` is the only comparable numeric column, so it alone drives meanKs.
    expect(rep.meanKs).toBe(0);
    expect(rep.overall).toBeLessThan(1);
  });

  it('keeps every component in range for genuinely different tables', () => {
    const rng = createRng(77);
    const a = tableFromCols(['v'], [Array.from({ length: 200 }, () => gaussian(rng))]);
    const b = tableFromCols(['v'], [Array.from({ length: 200 }, () => rng() * 6 - 3)]);
    const rep = qualityMetrics(a, b);
    expect(rep.meanKs!).toBeGreaterThan(0);
    expect(rep.meanKs!).toBeLessThanOrEqual(1);
    expect(rep.overall).toBeGreaterThanOrEqual(0);
    expect(rep.overall).toBeLessThan(1);
    // TVD on a categorical column.
    const catA: SynthTable = { columns: ['c'], rows: [['p'], ['p'], ['q'], ['q']] };
    const catB: SynthTable = { columns: ['c'], rows: [['p'], ['p'], ['p'], ['q']] };
    const catRep = qualityMetrics(catA, catB);
    expect(catRep.meanTvd!).toBeCloseTo(0.25, 12);
  });
});

describe('CSV serialization', () => {
  it('round-trips typed cells through toCsv / parseCsvTable', () => {
    const t: SynthTable = {
      columns: ['name', 'value', 'flag'],
      rows: [
        ['Doe, John', 1.5, true],
        ['plain', null, false],
        ['"quoted"', 2, true],
      ],
    };
    const csv = toCsv(t);
    expect(csv.split('\n')[0]).toBe('name,value,flag');
    expect(csv).toContain('"Doe, John"');
    const back = parseCsvTable(csv);
    expect(back).not.toBeNull();
    expect(back!.columns).toEqual(['name', 'value', 'flag']);
    expect(back!.rows[0]).toEqual(['Doe, John', '1.5', 'true']);
    expect(back!.rows[1]).toEqual(['plain', '', 'false']);
    expect(back!.rows[2]).toEqual(['"quoted"', '2', 'true']);
  });

  it('skips high-cardinality id columns and notes them', () => {
    const csv = [
      'id,score',
      ...Array.from({ length: 30 }, (_, i) => `P${i + 1},${(i % 7) + 1}`),
    ].join('\n');
    const original = parseCsvTable(csv)!;
    const res = generateSynthetic(original, {
      rows: 30,
      seed: 42,
      mode: 'copula',
      privacy: 'none',
      epsilon: 1,
      k: 5,
    });
    expect(res.table.columns).toEqual(['score']);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]?.column).toBe('id');
    expect(res.skipped[0]?.reason).toMatch(/identifier/i);
  });
});
