import { describe, it, expect } from 'vitest';
import {
  Profiler,
  profileRows,
  HyperLogLog,
  SpaceSaving,
  inferColumnKinds,
  isMissing,
  asNumber,
} from '@/core/profiler/profile';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('profiler/HyperLogLog', () => {
  it('estimates small exact cardinalities closely', () => {
    const hll = new HyperLogLog();
    for (let i = 0; i < 100; i += 1) hll.add(`v${i}`);
    expect(hll.estimate()).toBeGreaterThan(90);
    expect(hll.estimate()).toBeLessThan(112);
  });

  it('counts large cardinalities within ~3%', () => {
    const hll = new HyperLogLog();
    for (let i = 0; i < 50000; i += 1) hll.add(`id-${i}`);
    const e = hll.estimate();
    expect(e / 50000).toBeGreaterThan(0.97);
    expect(e / 50000).toBeLessThan(1.03);
  });

  it('ignores duplicates', () => {
    const hll = new HyperLogLog();
    for (let rep = 0; rep < 10; rep += 1) {
      for (let i = 0; i < 50; i += 1) hll.add(`k${i}`);
    }
    expect(Math.round(hll.estimate())).toBe(50);
  });

  it('merges sketches', () => {
    const a = new HyperLogLog();
    const b = new HyperLogLog();
    for (let i = 0; i < 1000; i += 1) a.add(`a${i}`);
    for (let i = 500; i < 1500; i += 1) b.add(`a${i}`);
    a.merge(b);
    const e = a.estimate();
    expect(e).toBeGreaterThan(1400);
    expect(e).toBeLessThan(1620);
  });
});

describe('profiler/SpaceSaving', () => {
  it('returns the true top-k for skewed streams', () => {
    const ss = new SpaceSaving(3);
    const data = ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'c', 'c'];
    for (const v of data) ss.add(v);
    const top = ss.top();
    expect(top[0]).toEqual({ value: 'a', count: 4 });
    expect(top[1]).toEqual({ value: 'b', count: 3 });
    expect(top[2]).toEqual({ value: 'c', count: 2 });
  });

  it('evicts the minimum counter and carries its error', () => {
    const ss = new SpaceSaving(2);
    ['x', 'x', 'x', 'y', 'z'].forEach((v) => ss.add(v));
    const top = ss.top();
    expect(top[0]).toEqual({ value: 'x', count: 3 });
    // z overcounts by at most the evicted item's count (1).
    expect(top[1]!.count).toBeLessThanOrEqual(3);
  });
});

describe('profiler/numeric columns', () => {
  it('computes exact mean/sd/min/max', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [i]);
    const p = profileRows(rows, [{ name: 'x', kind: 'numeric' }]);
    const col = p.columns[0]!;
    expect(col.kind).toBe('numeric');
    if (col.kind !== 'numeric') throw new Error('type narrowing');
    expect(col.min).toBe(0);
    expect(col.max).toBe(99);
    expect(col.mean).toBeCloseTo(49.5, 9);
    expect(col.sd).toBeCloseTo(Math.sqrt(((100 * 100 - 1) / 12) * (100 / 99)), 6);
  });

  it('approximates the median and quantiles via the reservoir', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [i]);
    const p = profileRows(rows, [{ name: 'x', kind: 'numeric' }]);
    const col = p.columns[0]!;
    if (col.kind !== 'numeric') throw new Error('type narrowing');
    expect(col.q50).toBeGreaterThan(2400);
    expect(col.q50).toBeLessThan(2600);
    expect(col.q05).toBeLessThan(col.q50);
    expect(col.q95).toBeGreaterThan(col.q50);
  });

  it('flags outliers by modified z > 3.5', () => {
    const rng = mulberry(3);
    const rows: number[][] = [];
    for (let i = 0; i < 500; i += 1) rows.push([rng()]);
    rows.push([20], [-20]);
    const p = profileRows(rows, [{ name: 'x', kind: 'numeric' }], { reservoir: 5000 });
    const col = p.columns[0]!;
    if (col.kind !== 'numeric') throw new Error('type narrowing');
    expect(col.outlierCount).toBeGreaterThanOrEqual(2);
  });

  it('reports missing values and zeros', () => {
    const rows: Array<[number | null]> = [[1], [0], [null], [0], [3]];
    const p = profileRows(rows, [{ name: 'x', kind: 'numeric' }]);
    const col = p.columns[0]!;
    if (col.kind !== 'numeric') throw new Error('type narrowing');
    expect(col.n).toBe(4);
    expect(col.missing).toBe(1);
    expect(col.zeros).toBe(2);
  });

  it('histogram bin counts cover the observed sample', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => [i]);
    const p = profileRows(rows, [{ name: 'x', kind: 'numeric' }], { bins: 10 });
    const col = p.columns[0]!;
    if (col.kind !== 'numeric') throw new Error('type narrowing');
    expect(col.histogram.bins).toBe(10);
    expect(col.histogram.edges.length).toBe(11);
    const total = col.histogram.counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(1000);
  });
});

describe('profiler/text columns', () => {
  it('tracks distinct, lengths and top values', () => {
    const rows: string[][] = [];
    for (let i = 0; i < 300; i += 1) rows.push([i < 200 ? 'red' : i < 280 ? 'green' : 'blue']);
    const p = profileRows(rows, [{ name: 'color', kind: 'text' }], { topK: 5 });
    const col = p.columns[0]!;
    if (col.kind !== 'text') throw new Error('type narrowing');
    expect(Math.round(col.distinctEstimate)).toBe(3);
    expect(col.topValues[0]).toEqual({ value: 'red', count: 200 });
    expect(col.maxLength).toBe(5);
  });
});

describe('profiler/correlations', () => {
  it('Pearson is 1 / −1 / ~0 for known relations', () => {
    const rows = Array.from({ length: 400 }, (_, i) => [i, 2 * i + 1, -i, (i * 31) % 17]);
    const p = profileRows(rows, ['a', 'b', 'c', 'd']);
    const m = p.correlations!;
    expect(m.pearson[0]![1]).toBeCloseTo(1, 9);
    expect(m.pearson[0]![2]).toBeCloseTo(-1, 9);
    expect(Math.abs(m.pearson[0]![3]!)).toBeLessThan(0.25);
  });

  it('Spearman is ~1 for a monotonic nonlinear relation', () => {
    const rows = Array.from({ length: 300 }, (_, i) => [i, Math.exp(i / 100)]);
    const p = profileRows(rows, [{ name: 'x', kind: 'numeric' }, { name: 'y', kind: 'numeric' }]);
    expect(p.correlations!.spearman[0]![1]).toBeCloseTo(1, 6);
  });

  it('handles missing cells pairwise', () => {
    const rows: Array<[number, number | null]> = [[1, 2], [2, null], [3, 6], [4, 8]];
    const p = profileRows(rows, ['x', 'y']);
    const col = p.columns[1]!;
    if (col.kind !== 'numeric') throw new Error('type narrowing');
    expect(col.missing).toBe(1);
    expect(Number.isFinite(p.correlations!.pearson[0]![1])).toBe(true);
  });
});

describe('profiler/scoring', () => {
  it('clean data scores 100 with no issues', () => {
    const rng = mulberry(9);
    const rows = Array.from({ length: 200 }, () => [rng() * 10, rng() * 5]);
    const p = profileRows(rows, ['a', 'b']);
    expect(p.issues).toEqual([]);
    expect(p.score).toBe(100);
  });

  it('deducts for a constant column', () => {
    const rows = Array.from({ length: 50 }, (_, i) => [7, i]);
    const p = profileRows(rows, ['k', 'i']);
    expect(p.issues.some((i) => i.code === 'constant' && i.column === 'k')).toBe(true);
    expect(p.score).toBeLessThan(100);
    expect(p.score).toBeGreaterThanOrEqual(0);
  });

  it('estimates duplicate rows', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [i % 20, i % 20]);
    const p = profileRows(rows, ['a', 'b']);
    expect(p.duplicates.duplicateRate).toBeGreaterThan(0.7);
  });

  it('score is always inside [0, 100]', () => {
    const bad: Array<[number, null, string]> = Array.from({ length: 80 }, () => [1, null, 'x']);
    const p = profileRows(bad, ['k', 'm', 's']);
    expect(p.score).toBeGreaterThanOrEqual(0);
    expect(p.score).toBeLessThanOrEqual(100);
  });

  it('produces the same result across repeated runs (deterministic)', () => {
    const rng = mulberry(42);
    const rows = Array.from({ length: 5000 }, (_, i) => [i + rng(), (i * 7) % 13, String(i % 31)]);
    const a = profileRows(rows, ['a', 'b', 'c']);
    const b = profileRows(rows, ['a', 'b', 'c']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('profiler/streaming & helpers', () => {
  it('chunked ingestion matches one-shot ingestion', () => {
    const rows = Array.from({ length: 300 }, (_, i) => [i, i * 2, String(i % 7)]);
    const specs = [{ name: 'a', kind: 'numeric' as const }, { name: 'b', kind: 'numeric' as const }, { name: 'c', kind: 'text' as const }];
    const oneShot = profileRows(rows, specs);
    const p = new Profiler(specs);
    for (let i = 0; i < rows.length; i += 37) p.addChunk(rows.slice(i, i + 37));
    const chunked = p.finalize();
    expect(JSON.stringify(chunked)).toBe(JSON.stringify(oneShot));
  });

  it('respects the reservoir cap for memory bounds', () => {
    const p = new Profiler([{ name: 'x', kind: 'numeric' }], { reservoir: 100 });
    for (let i = 0; i < 10000; i += 1) p.addRow([i]);
    const result = p.finalize();
    const col = result.columns[0]!;
    if (col.kind !== 'numeric') throw new Error('type narrowing');
    const sampled = col.histogram.counts.reduce((a, b) => a + b, 0);
    expect(sampled).toBe(100);
    // Exact extremes still tracked outside the sample.
    expect(col.min).toBe(0);
    expect(col.max).toBe(9999);
    // A single numeric column yields no correlation matrix.
    expect(result.correlations).toBeNull();
  });

  it('infers column kinds from a sample', () => {
    const sample: Array<[number, string, string]> = [
      [1, 'a', '2024'],
      [2, 'b', '2025'],
    ];
    const specs = inferColumnKinds(['n', 't', 'y'], sample);
    expect(specs[0]!.kind).toBe('numeric');
    expect(specs[1]!.kind).toBe('text');
    expect(specs[2]!.kind).toBe('numeric');
  });

  it('isMissing / asNumber recognise common tokens', () => {
    expect(isMissing('')).toBe(true);
    expect(isMissing('NA')).toBe(true);
    expect(isMissing(NaN)).toBe(true);
    expect(isMissing('3.5')).toBe(false);
    expect(asNumber(' 12 ')).toBe(12);
    expect(asNumber('abc')).toBeNull();
    expect(asNumber(true)).toBe(1);
  });

  it('handles an empty table', () => {
    const p = profileRows([], ['a']);
    expect(p.rows).toBe(0);
    expect(p.score).toBe(100);
    expect(p.correlations).toBeNull();
    const col = p.columns[0]!;
    if (col.kind !== 'numeric') throw new Error('type narrowing');
    expect(Number.isNaN(col.mean)).toBe(true);
  });
});
