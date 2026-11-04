import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeZipf,
  countFrequencies,
  fitZipf,
  olsFit,
  parseFrequencyPairs,
  parseZipfUpload,
  rankByFrequency,
  runZipfBenchmark,
  synthZipfText,
  tokenize,
  tokenizeEnglish,
} from '../src/plugins/builtin/math/zipf/kernel';

describe('stats-zipf tokenization', () => {
  it('splits on non-letters, lowercases, and skips "#..." comment lines', () => {
    expect(tokenizeEnglish('# a comment line\nThe CAT sat.')).toEqual(['the', 'cat', 'sat']);
    expect(tokenizeEnglish('Emma said: “Hello!” 42 times.')).toEqual(['emma', 'said', 'hello', 'times']);
  });

  it('cjk mode keeps one token per Han character and whole Latin words', () => {
    expect(tokenize('你好 world', 'cjk')).toEqual(['你', '好', 'world']);
    expect(tokenize('# 注释\n汉语', 'cjk')).toEqual(['汉', '语']);
  });
});

describe('stats-zipf counting & ranking', () => {
  it('micro corpus "the cat sat on the mat": the → 2, others → 1 (benchmark ②)', () => {
    const tokens = tokenizeEnglish('the cat sat on the mat');
    const counts = countFrequencies(tokens);
    expect(counts.get('the')).toBe(2);
    for (const w of ['cat', 'sat', 'on', 'mat']) expect(counts.get(w)).toBe(1);
    const ranked = rankByFrequency(counts);
    expect(ranked[0]).toEqual({ word: 'the', count: 2 });
    expect(ranked).toHaveLength(5);
    expect(ranked.slice(1).every((r) => r.count === 1)).toBe(true);
  });

  it('upload sniffing separates "word,count" tables from raw corpora', () => {
    const pairs = parseZipfUpload('# freq table\nthe,2\ncat,1');
    expect(pairs.kind).toBe('pairs');
    const text = parseZipfUpload('the cat sat on the mat');
    expect(text.kind).toBe('text');
  });

  it('parseFrequencyPairs validates rows and rejects malformed tables', () => {
    const m = parseFrequencyPairs('# comment\nthe, 2\ncat,1');
    expect(m!.get('the')).toBe(2);
    expect(m!.get('cat')).toBe(1);
    expect(parseFrequencyPairs('the,2\nbadrow')).toBeNull();
    expect(parseFrequencyPairs('the,2')).toBeNull(); // fewer than 2 data rows
    expect(parseFrequencyPairs('the,2\ncat,-1')).toBeNull();
  });
});

describe('stats-zipf OLS fit (benchmark ③: hand-checked closed form)', () => {
  it('recovers slope/intercept/R² of an exactly log-linear fixture to < 1e-9', () => {
    // f(r) = 100 · r^-1.2 exactly for ranks 1..50
    const points = Array.from({ length: 50 }, (_, i) => ({
      x: Math.log(i + 1),
      y: Math.log(100 * Math.pow(i + 1, -1.2)),
    }));
    const fit = olsFit(points)!;
    expect(fit.slope).toBeCloseTo(-1.2, 9);
    expect(fit.intercept).toBeCloseTo(Math.log(100), 9);
    expect(fit.r2).toBeCloseTo(1, 9);
    expect(fit.sigmaSlope).toBeLessThan(1e-9);
  });

  it('fitZipf maps the OLS slope to s = −slope with rank-window options', () => {
    // exact power law f(r) = 1000/r: log f linear in log r (not in r!)
    const ranked = Array.from({ length: 5 }, (_, i) => ({
      word: `w${i + 1}`,
      count: Math.round(1000 / (i + 1)),
    }));
    const fit = fitZipf(ranked)!;
    expect(fit.s).toBeGreaterThan(0.99);
    expect(fit.s).toBeLessThan(1.01);
    expect(fit.rankStart).toBe(1);
    expect(fit.rankEnd).toBe(5);
    expect(fit.residuals).toHaveLength(5);

    const dropped = fitZipf(ranked, { dropTop: 2 })!;
    expect(dropped.rankStart).toBe(3);
    expect(dropped.residuals).toHaveLength(3);

    const windowed = fitZipf(ranked, { fitEnd: 3 })!;
    expect(windowed.rankEnd).toBe(3);

    // too few points → null
    expect(fitZipf(ranked, { dropTop: 4 })).toBeNull();
  });

  it('olsFit returns null for fewer than 3 points', () => {
    expect(olsFit([{ x: 0, y: 0 }])).toBeNull();
  });
});

describe('stats-zipf synthetic corpus (benchmark ①: s-recovery)', () => {
  it('synthZipfText is deterministic per seed', () => {
    const a = synthZipfText(2000, 1.0, 60000, 20261011);
    const b = synthZipfText(2000, 1.0, 60000, 20261011);
    expect(a).toBe(b);
  });

  it('draws 60000 tokens from an exact Zipf(s=1) and recovers s within 5%', () => {
    const bench = runZipfBenchmark();
    expect(bench.tokens).toBe(60000);
    expect(bench.vocab).toBeGreaterThan(1900); // all 2000 ranks (nearly) observed
    expect(bench.recoveredS).toBeGreaterThan(0.95);
    expect(bench.recoveredS).toBeLessThan(1.05);
    expect(bench.relErrS).toBeLessThan(0.05);
    expect(bench.r2).toBeGreaterThan(0.98);
    expect(bench.pass).toBe(true);
  });
});

describe('stats-zipf shipped example corpus (Emma, public domain)', () => {
  const file = fileURLToPath(new URL('../examples/data/gutenberg-emma-ch1.txt', import.meta.url));
  const text = readFileSync(file, 'utf8');

  it('is a non-trivial public-domain corpus with provenance comments', () => {
    expect(text.startsWith('# Emma by Jane Austen')).toBe(true);
    expect(text).toContain('Project Gutenberg eBook #158');
    // comment lines must not leak into the token stream
    const tokens = tokenizeEnglish(text);
    expect(tokens.length).toBeGreaterThan(12000);
    for (const t of tokens) expect(t).not.toContain('#');
  });

  it('yields a Zipf-like fit: s in a plausible band and strong log-log linearity', () => {
    const analysis = analyzeZipf(text, 'english');
    // Heaps' law for ~14k narrative tokens puts the vocabulary around 2100
    expect(analysis.vocab).toBeGreaterThan(1800);
    expect(analysis.ranked[0]!.count).toBeGreaterThan(analysis.ranked[1]!.count);
    // in this dialogue-heavy section "and" edges out "the" (measured on the file)
    expect(['and', 'the', 'of', 'to']).toContain(analysis.ranked[0]!.word);
    expect(analysis.fit).not.toBeNull();
    // full-window fit of real English: s ≈ 1 within a generous band
    expect(analysis.fit!.s).toBeGreaterThan(0.7);
    expect(analysis.fit!.s).toBeLessThan(1.3);
    expect(analysis.fit!.r2).toBeGreaterThan(0.85);
  });

  it('dropTop changes the fitted window without breaking the analysis', () => {
    const analysis = analyzeZipf(text, 'english', { dropTop: 10 });
    expect(analysis.dropTop).toBe(10);
    expect(analysis.fit!.rankStart).toBe(11);
    expect(analysis.fit!.residuals.length).toBe(analysis.vocab - 10);
  });
});
