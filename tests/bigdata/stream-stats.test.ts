// Tests for the streaming statistics kernels: correctness against a
// naive materialized reference, mergeability, and known accuracy bounds.

import { describe, expect, it } from 'vitest';
import {
  HyperLogLog,
  ProfileBuilder,
  TDigest,
  Welford,
  classifyCell,
  hash32,
} from '@/core/bigdata/stream-stats';

/** Deterministic pseudo-random sequence (no Math.random flakiness). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('Welford', () => {
  it('matches the naive mean/variance on a known sample', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const w = new Welford();
    for (const v of values) w.push(v);
    expect(w.mean).toBe(5);
    expect(w.variance).toBeCloseTo(4.571428571, 6);
    expect(w.min).toBe(2);
    expect(w.max).toBe(9);
  });

  it('matches a naive two-pass computation on random data', () => {
    const rnd = lcg(42);
    const values = Array.from({ length: 5000 }, () => rnd() * 100 - 50);
    const w = new Welford();
    for (const v of values) w.push(v);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
    expect(w.mean).toBeCloseTo(mean, 10);
    expect(w.variance).toBeCloseTo(variance, 6);
  });

  it('merges batches exactly like one-pass over the whole set', () => {
    const rnd = lcg(7);
    const values = Array.from({ length: 4000 }, () => rnd() * 10);
    const whole = new Welford();
    for (const v of values) whole.push(v);

    // Split into batches, accumulate per batch, merge in order and reversed.
    const batchOf = (rows: number[]) => {
      const w = new Welford();
      for (const v of rows) w.push(v);
      return w;
    };
    const a = batchOf(values.slice(0, 1000));
    const b = batchOf(values.slice(1000, 3000));
    const c = batchOf(values.slice(3000));

    const merged = new Welford();
    merged.merge(b);
    merged.merge(c);
    merged.merge(a);
    expect(merged.count).toBe(whole.count);
    expect(merged.mean).toBeCloseTo(whole.mean, 8);
    expect(merged.variance).toBeCloseTo(whole.variance, 6);

    const rev = new Welford();
    rev.merge(a);
    rev.merge(b);
    rev.merge(c);
    expect(rev.mean).toBeCloseTo(whole.mean, 8);
    expect(rev.skewness).toBeCloseTo(whole.skewness, 4);
  });

  it('ignores non-finite values', () => {
    const w = new Welford();
    w.push(Number.NaN);
    w.push(Number.POSITIVE_INFINITY);
    w.push(1);
    expect(w.count).toBe(1);
    expect(w.mean).toBe(1);
  });
});

describe('TDigest', () => {
  it('estimates the median within 1% on uniform data', () => {
    const rnd = lcg(3);
    const d = new TDigest(200);
    for (let i = 0; i < 20000; i += 1) d.push(rnd() * 1000);
    const p50 = d.quantile(0.5);
    expect(p50).toBeGreaterThan(450);
    expect(p50).toBeLessThan(550);
  });

  it('bounds the error at the tails within the digest rank accuracy', () => {
    const rnd = lcg(11);
    const d = new TDigest(500);
    const values: number[] = [];
    for (let i = 0; i < 30000; i += 1) {
      const v = rnd() * 1000;
      values.push(v);
      d.push(v);
    }
    values.sort((a, b) => a - b);
    const at = (q: number) => values[Math.floor(q * (values.length - 1))]!;
    for (const q of [0.25, 0.5, 0.75, 0.95, 0.99]) {
      const truth = at(q);
      const est = d.quantile(q);
      // Rank error bound ~1/(2·delta); allow 2% of the value range.
      expect(Math.abs(est - truth)).toBeLessThan(20);
    }
  });

  it('merges two digests to the accuracy of a single digest', () => {
    const rnd = lcg(5);
    const whole = new TDigest(200);
    const a = new TDigest(200);
    const b = new TDigest(200);
    for (let i = 0; i < 10000; i += 1) {
      const v = rnd() * 100;
      whole.push(v);
      if (i % 2 === 0) a.push(v);
      else b.push(v);
    }
    a.merge(b);
    expect(Math.abs(a.quantile(0.5) - whole.quantile(0.5))).toBeLessThan(2);
  });

  it('keeps memory bounded and tails accurate', () => {
    const d = new TDigest(100);
    for (let i = 0; i < 50000; i += 1) d.push(i);
    // Bounded by a few multiples of delta regardless of stream length.
    expect(d.size).toBeLessThanOrEqual(10 * 100);
    expect(d.quantile(0.9)).toBeGreaterThan(44900);
    expect(d.quantile(0.9)).toBeLessThan(45100);
  });
});

describe('HyperLogLog', () => {
  it('estimates distinct counts within ~3% at p=14', () => {
    const h = new HyperLogLog(14);
    const distinct = 5000;
    for (let i = 0; i < distinct; i += 1) h.push(`value-${i}`);
    // Duplicates must not inflate the estimate.
    for (let i = 0; i < distinct; i += 1) h.push(`value-${i}`);
    const est = h.estimate();
    expect(est).toBeGreaterThan(distinct * 0.97);
    expect(est).toBeLessThan(distinct * 1.03);
  });

  it('stays within ~15% even at the small p=10 register budget', () => {
    const h = new HyperLogLog(10);
    for (let i = 0; i < 5000; i += 1) h.push(`value-${i}`);
    const est = h.estimate();
    expect(est).toBeGreaterThan(4250);
    expect(est).toBeLessThan(5750);
  });

  it('is exact in the tiny-cardinality regime', () => {
    const h = new HyperLogLog(10);
    h.push('a');
    h.push('b');
    h.push('c');
    expect(h.estimate()).toBe(3);
  });

  it('merges register-wise (max), matching a single pass', () => {
    const whole = new HyperLogLog(10);
    const a = new HyperLogLog(10);
    const b = new HyperLogLog(10);
    for (let i = 0; i < 3000; i += 1) {
      whole.push(`k${i}`);
      if (i % 2 === 0) a.push(`k${i}`);
      else b.push(`k${i}`);
    }
    a.merge(b);
    // Both should be in the same ballpark (±3% of each other).
    expect(Math.abs(a.estimate() - whole.estimate()) / whole.estimate()).toBeLessThan(0.03);
  });

  it('hash32 is deterministic and well distributed', () => {
    expect(hash32('abc')).toBe(hash32('abc'));
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) seen.add(hash32(`k${i}`));
    expect(seen.size).toBeGreaterThan(950);
  });
});

describe('classifyCell', () => {
  it('classifies numeric, boolean, empty and string cells', () => {
    expect(classifyCell('42')).toEqual({ kind: 'integer', numeric: 42 });
    expect(classifyCell(' -3 ')).toEqual({ kind: 'integer', numeric: -3 });
    expect(classifyCell('3.14')).toEqual({ kind: 'float', numeric: 3.14 });
    expect(classifyCell('1e6')).toEqual({ kind: 'float', numeric: 1e6 });
    expect(classifyCell('true')).toEqual({ kind: 'boolean' });
    expect(classifyCell('')).toEqual({ kind: 'empty' });
    expect(classifyCell('NA')).toEqual({ kind: 'empty' });
    expect(classifyCell('hello')).toEqual({ kind: 'string' });
    expect(classifyCell('1_000')).toEqual({ kind: 'string' });
  });
});

describe('ProfileBuilder', () => {
  it('profiles numeric columns with correct moments and quantiles', () => {
    const p = new ProfileBuilder();
    p.initColumns(['n', 's']);
    for (let i = 1; i <= 1000; i += 1) p.pushRow([String(i), 'x']);
    const [num, str] = p.summarize();
    if (!num || !str) throw new Error('missing column summaries');
    expect(num.kind).toBe('integer');
    expect(num.count).toBe(1000);
    expect(num.mean).toBeCloseTo(500.5, 8);
    expect(num.p50).toBeGreaterThan(450);
    expect(num.p99).toBeGreaterThan(980);
    expect(num.missing).toBe(0);
    expect(str.kind).toBe('string');
    expect(str.distinctEstimate).toBeCloseTo(1, -1); // one distinct value
  });

  it('promotes integer → float, demotes to string on mixed data', () => {
    const p = new ProfileBuilder();
    p.initColumns(['a', 'b']);
    p.pushRow(['1', '1']);
    p.pushRow(['2.5', '2']);
    p.pushRow(['oops', '3']);
    const [a, b] = p.summarize();
    if (!a || !b) throw new Error('missing column summaries');
    expect(a.kind).toBe('string'); // 'oops' breaks the numeric kind
    expect(b.kind).toBe('integer');
  });

  it('counts missing cells for ragged rows', () => {
    const p = new ProfileBuilder();
    p.initColumns(['a', 'b', 'c']);
    p.pushRow(['1', '2']);
    p.pushRow(['', '3', '']);
    const [c] = p.summarize();
    if (!c) throw new Error('missing column summary');
    expect(c.missing).toBe(1); // row 1 lacked 'c'
  });

  it('builds a histogram over the observed range', () => {
    const p = new ProfileBuilder();
    p.initColumns(['v']);
    for (let i = 0; i < 1000; i += 1) p.pushRow([String(i)]);
    const [v] = p.summarize();
    if (!v) throw new Error('missing column summary');
    expect(v.histogram.edges.length).toBe(25);
    const total = v.histogram.counts.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1000, 0);
  });
});
