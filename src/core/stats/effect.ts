// ==========================================================================
// Ergalics Studio — effect sizes & correlation
//
// Cohen's d (pooled two-sample and paired), plus Pearson and Spearman rank
// correlation. These quantify *how large* an effect is, independent of sample
// size, and pair naturally with the hypothesis tests in `tests.ts`.
// ==========================================================================

import { mean, variance } from './descriptive';

/** Cohen's d. `paired` computes d on the difference scores. */
export function cohensD(a: number[], b: number[], paired = false): number {
  if (paired) {
    const n = Math.min(a.length, b.length);
    const diffs: number[] = [];
    for (let i = 0; i < n; i += 1) diffs.push(a[i]! - b[i]!);
    const md = mean(diffs);
    const sd = Math.sqrt(variance(diffs, true));
    return sd === 0 ? 0 : md / sd;
  }
  const na = a.length;
  const nb = b.length;
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a, true);
  const vb = variance(b, true);
  const sp = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  return sp === 0 ? 0 : (ma - mb) / sp;
}

/** Pearson product-moment correlation. Returns 0 if either variance is 0. */
export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return NaN;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = x[i]! - mx;
    const b = y[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** Spearman rank correlation (Pearson of the ranks). */
export function spearman(x: number[], y: number[]): number {
  return pearson(rank(x), rank(y));
}

/** Convert values to average ranks (1-based, ties share the mean rank). */
export function rank(v: number[]): number[] {
  const idx = [...v.keys()].sort((a, b) => v[a]! - v[b]!);
  const r = new Array<number>(v.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j < idx.length && v[idx[j]!] === v[idx[i]!]) j += 1;
    const avg = (i + j + 1) / 2;
    for (let t = i; t < j; t += 1) r[idx[t]!] = avg;
    i = j;
  }
  return r;
}
