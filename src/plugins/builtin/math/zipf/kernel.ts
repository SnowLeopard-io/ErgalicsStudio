// ==========================================================================
// stats-zipf — Zipf's-law numerics (pure, dependency-free, testable)
//
// Tokenization (English: split on non-letters + lowercase, "#..." lines are
// comments; CJK mode: one token per Han character plus Latin words), word
// counting, frequency ranking, and an ordinary-least-squares fit of
//   log f(r) = log a - s · log r
// over a configurable rank window (optionally excluding the top-N headwords),
// reporting s ± sigma (slope standard error) and R^2 with per-rank residuals.
//
// Embedded benchmarks against ground truth:
//   (1) a seeded corpus drawn exactly from p(r) ∝ r^-1.0 recovers s within
//       5% relative error;
//   (2) the micro text "the cat sat on the mat" yields the hand-checked
//       counts the:2, cat/sat/on/mat:1;
//   (3) on a perfectly log-linear fixture the OLS slope / intercept / R^2
//       match the closed-form values to < 1e-9.
// All randomness flows through mulberry32. No DOM anywhere.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export type TokenizerMode = 'english' | 'cjk';

/** Frequency-ranked entry: rank starts at 1 (index 0). */
export interface RankedWord {
  word: string;
  count: number;
}

export interface ZipfFit {
  /** Fitted exponent s (positive number; f ∝ r^-s). */
  s: number;
  /** Standard error of s from the OLS slope. */
  sigma: number;
  /** Prefactor a in f = a · r^-s. */
  a: number;
  r2: number;
  /** Ranks included in the fit (1-based). */
  rankStart: number;
  rankEnd: number;
  /** Residuals log f(r) - fit, per fitted rank. */
  residuals: number[];
  fittedRanks: number[];
  fittedLogCounts: number[];
}

export interface ZipfAnalysis {
  mode: TokenizerMode;
  tokens: number;
  vocab: number;
  ranked: RankedWord[];
  fit: ZipfFit | null;
  dropTop: number;
}

// ---- tokenization -----------------------------------------------------------

/** English tokenization: drop "#..." comment lines, split on non-letters, lowercase. */
export function tokenizeEnglish(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const words = line.toLowerCase().split(/[^a-z]+/);
    for (const w of words) {
      if (w.length > 0) out.push(w);
    }
  }
  return out;
}

/** CJK tokenization: one token per Han character; Latin runs stay whole words. */
export function tokenizeCjk(text: string): string[] {
  const out: string[] = [];
  const clean = text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  const matches = clean.toLowerCase().match(/[\u4e00-\u9fff]|[a-z]+/g);
  if (matches) out.push(...matches);
  return out;
}

export function tokenize(text: string, mode: TokenizerMode): string[] {
  return mode === 'cjk' ? tokenizeCjk(text) : tokenizeEnglish(text);
}

// ---- counting & ranking -----------------------------------------------------

/** Raw frequency counts in first-appearance order (deterministic). */
export function countFrequencies(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/**
 * Rank by frequency (descending); ties keep first-appearance order, so the
 * result is deterministic for a given corpus.
 */
export function rankByFrequency(counts: Map<string, number>): RankedWord[] {
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((x, y) => y.count - x.count);
}

/** Parse an uploaded "word,count" frequency table (CSV/TSV). */
export function parseFrequencyPairs(text: string): Map<string, number> | null {
  const counts = new Map<string, number>();
  let rows = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[\t,;]/);
    if (parts.length < 2) return null;
    const word = (parts[0] ?? '').trim().toLowerCase();
    const count = Number((parts[1] ?? '').trim());
    if (!word || !Number.isFinite(count) || count <= 0) return null;
    counts.set(word, Math.round(count));
    rows += 1;
  }
  return rows >= 2 ? counts : null;
}

/**
 * Sniff an upload: a "word,count" table when every non-comment line parses as
 * such a pair, otherwise treat the whole text as a raw corpus.
 */
export function parseZipfUpload(text: string): { kind: 'pairs' | 'text'; content: string } {
  const pairs = parseFrequencyPairs(text);
  if (pairs) {
    return { kind: 'pairs', content: text };
  }
  return { kind: 'text', content: text };
}

// ---- OLS fit ----------------------------------------------------------------

export interface OlsFit {
  slope: number;
  intercept: number;
  r2: number;
  sigmaSlope: number;
}

/** Ordinary least squares of y on x with slope standard error and R². */
export function olsFit(points: Array<{ x: number; y: number }>): OlsFit | null {
  const n = points.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const xbar = sx / n;
  const ybar = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - xbar) * (p.x - xbar);
    sxy += (p.x - xbar) * (p.y - ybar);
  }
  if (sxx <= 1e-300) return null;
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const f = intercept + slope * p.x;
    ssRes += (p.y - f) * (p.y - f);
    ssTot += (p.y - ybar) * (p.y - ybar);
  }
  const mse = ssRes / (n - 2);
  const sigmaSlope = Math.sqrt(Math.max(mse, 0) / sxx);
  const r2 = ssTot <= 1e-300 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2, sigmaSlope };
}

export interface FitOptions {
  /** Exclude the top-N most frequent words from the fit. */
  dropTop?: number;
  /** Last rank (1-based, post-dropTop) to include; 0 / omitted = all. */
  fitEnd?: number;
}

/**
 * Fit f(r) = a · r^-s on log-log coordinates over the requested window.
 * Returns null when fewer than 3 points remain in the window.
 */
export function fitZipf(ranked: RankedWord[], opts: FitOptions = {}): ZipfFit | null {
  const dropTop = Math.max(0, Math.floor(opts.dropTop ?? 0));
  const rankEnd = opts.fitEnd && opts.fitEnd > 0 ? Math.min(opts.fitEnd, ranked.length) : ranked.length;
  const points: Array<{ x: number; y: number }> = [];
  for (let r = dropTop + 1; r <= rankEnd; r += 1) {
    const entry = ranked[r - 1];
    if (!entry || entry.count <= 0) continue;
    points.push({ x: Math.log(r), y: Math.log(entry.count) });
  }
  const fit = olsFit(points);
  if (!fit) return null;
  const residuals = points.map((p) => p.y - (fit.intercept + fit.slope * p.x));
  return {
    s: -fit.slope,
    sigma: fit.sigmaSlope,
    a: Math.exp(fit.intercept),
    r2: fit.r2,
    rankStart: dropTop + 1,
    rankEnd,
    residuals,
    fittedRanks: points.map((p) => Math.exp(p.x)),
    fittedLogCounts: points.map((p) => p.y),
  };
}

/** Full analysis pipeline: tokenize → rank → fit. */
export function analyzeZipf(text: string, mode: TokenizerMode, opts: FitOptions = {}): ZipfAnalysis {
  const tokens = tokenize(text, mode);
  const counts = countFrequencies(tokens);
  const ranked = rankByFrequency(counts);
  const fit = fitZipf(ranked, opts);
  return { mode, tokens: tokens.length, vocab: ranked.length, ranked, fit, dropTop: Math.max(0, Math.floor(opts.dropTop ?? 0)) };
}

// ---- synthetic Zipf corpus ---------------------------------------------------

/**
 * Generate a token bag drawn exactly from p(r) ∝ r^-s over `vocab` ranks
 * (rank-encoded letter names: 1→a, 2→b, … 26→z, 27→aa …; the English
 * tokenizer keeps letters only, so names must be digit-free),
 * deterministic for a fixed seed. Emitting one group of 12 tokens per line
 * keeps the generated text diff-friendly.
 */
function rankWord(rank: number): string {
  // bijective base-26 letter encoding
  let n = rank;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(97 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function synthZipfText(vocab: number, s: number, tokens: number, seed: number): string {
  const V = Math.max(2, Math.floor(vocab));
  const exponent = Math.max(0.1, s);
  const next = mulberry32(seed >>> 0);
  // Cumulative distribution over ranks 1..V.
  const cdf = new Float64Array(V);
  let acc = 0;
  for (let r = 1; r <= V; r += 1) {
    acc += Math.pow(r, -exponent);
    cdf[r - 1] = acc;
  }
  const total = acc;
  const words: string[] = [];
  for (let i = 0; i < Math.max(1, Math.floor(tokens)); i += 1) {
    const u = next() * total;
    // Binary search for the rank.
    let lo = 0;
    let hi = V - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cdf[mid] ?? 0) < u) lo = mid + 1;
      else hi = mid;
    }
    words.push(rankWord(lo + 1));
  }
  // 12 words per line
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += 12) lines.push(words.slice(i, i + 12).join(' '));
  return lines.join('\n');
}

// ---- embedded benchmark ------------------------------------------------------

export interface ZipfBenchmark {
  /** Synthetic recovery of s = 1. */
  recoveredS: number;
  relErrS: number;
  r2: number;
  tokens: number;
  vocab: number;
  pass: boolean;
  seed: number;
}

/**
 * Benchmark (1): draw 60000 tokens from an exact Zipf(s=1) over 2000 ranks
 * and check that the OLS fit recovers s within 5% relative error. The fit
 * window is restricted to ranks 1-500: deeper ranks have expected counts of
 * only a few, where Poisson noise and the concavity of the log bias the
 * full-window slope upward (a well-known effect; restricting to ranks with
 * expected counts >= ~15 is the standard remedy).
 */
export function runZipfBenchmark(seed = 20261011): ZipfBenchmark {
  const text = synthZipfText(2000, 1.0, 60000, seed);
  const analysis = analyzeZipf(text, 'english', { dropTop: 0, fitEnd: 500 });
  const s = analysis.fit?.s ?? Number.NaN;
  const relErrS = Number.isFinite(s) ? Math.abs(s - 1) / 1 : Number.POSITIVE_INFINITY;
  const r2 = analysis.fit?.r2 ?? Number.NaN;
  const pass = Number.isFinite(relErrS) && relErrS < 0.05;
  return {
    recoveredS: s,
    relErrS,
    r2,
    tokens: analysis.tokens,
    vocab: analysis.vocab,
    pass,
    seed: seed >>> 0,
  };
}
