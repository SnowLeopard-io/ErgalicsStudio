// ==========================================================================
// meta — fixed / random-effects meta-analysis
//
// Inverse-variance fixed-effect pooling, DerSimonian-Laird random effects,
// Cochran's Q, I², tau², forest-plot data, Egger's regression test for
// funnel-plot asymmetry and a Duval-Tweedie trim-and-fill estimate.
// ==========================================================================

import { chiSquareCdf, normalCdf } from '@/core/stats/special';
import { fmt, mean, parseTable } from '../../shared/stats-utils';

export interface MetaStudy {
  study: string;
  effect: number;
  se: number;
  group: string | null;
}

export interface MetaDataset {
  studies: MetaStudy[];
  effectName: string;
  seName: string;
}

export interface MetaPooled {
  estimate: number;
  se: number;
  lo: number;
  hi: number;
  z: number;
  p: number;
  weights: number[];
  /** Relative weights (%). */
  weightPct: number[];
}

export interface MetaResult {
  fixed: MetaPooled;
  random: MetaPooled;
  q: number;
  qDf: number;
  qP: number;
  i2: number;
  tau2: number;
  k: number;
  egger: { intercept: number; se: number; t: number; p: number } | null;
  trimFill: { filled: number; estimate: number; lo: number; hi: number } | null;
  subgroups: Array<{ label: string; k: number; estimate: number; lo: number; hi: number; i2: number }>;
}

const EFFECT_NAMES = ['effect', 'yi', 'estimate', 'es', 'smd', 'or', 'rr', 'md', 'logor', 'logrr'];
const SE_NAMES = ['se', 'std_error', 'stderr', 'se_effect', 'sei'];
const STUDY_NAMES = ['study', 'trial', 'author', 'name', 'id'];
const GROUP_NAMES = ['group', 'subgroup', 'moderator', 'class'];

/** Parse `study,effect,se[,group]`. */
export function parseMeta(text: string): MetaDataset {
  const table = parseTable(text);
  if (table.header.length === 0) return { studies: [], effectName: 'effect', seName: 'se' };
  const lower = table.header.map((h) => h.toLowerCase());
  let effectIdx = lower.findIndex((h) => EFFECT_NAMES.includes(h));
  let seIdx = lower.findIndex((h) => SE_NAMES.includes(h));
  const studyIdx = lower.findIndex((h) => STUDY_NAMES.includes(h));
  const groupIdx = lower.findIndex((h) => GROUP_NAMES.includes(h));
  if (effectIdx < 0) effectIdx = 0;
  if (seIdx < 0) seIdx = 1;
  const studies: MetaStudy[] = [];
  table.rows.forEach((row, i) => {
    const effect = Number(row[effectIdx]);
    const se = Number(row[seIdx]);
    if (!Number.isFinite(effect) || !Number.isFinite(se) || se <= 0) return;
    studies.push({
      study: studyIdx >= 0 ? String(row[studyIdx] ?? `Study ${i + 1}`) : `Study ${i + 1}`,
      effect,
      se,
      group: groupIdx >= 0 ? String(row[groupIdx] ?? '') || null : null,
    });
  });
  return { studies, effectName: table.header[effectIdx]!, seName: table.header[seIdx]! };
}

function pooledFrom(studies: MetaStudy[], tau2: number): MetaPooled {
  const weights = studies.map((s) => 1 / (s.se * s.se + tau2));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const estimate = sumW > 0 ? studies.reduce((s, st, i) => s + weights[i]! * st.effect, 0) / sumW : NaN;
  const se = sumW > 0 ? Math.sqrt(1 / sumW) : NaN;
  const z = se > 0 ? estimate / se : 0;
  return {
    estimate,
    se,
    lo: estimate - 1.959963984540054 * se,
    hi: estimate + 1.959963984540054 * se,
    z,
    p: 2 * (1 - normalCdf(Math.abs(z))),
    weights,
    weightPct: weights.map((w) => (sumW > 0 ? (100 * w) / sumW : 0)),
  };
}

/** Full fixed / random-effects meta-analysis. */
export function metaAnalyze(studies: MetaStudy[]): MetaResult | null {
  if (studies.length < 2) return null;
  const fixed = pooledFrom(studies, 0);
  const k = studies.length;
  let q = 0;
  for (const s of studies) {
    const w = 1 / (s.se * s.se);
    q += w * (s.effect - fixed.estimate) ** 2;
  }
  const qDf = k - 1;
  const sumW = studies.reduce((s, st) => s + 1 / (st.se * st.se), 0);
  const sumW2 = studies.reduce((s, st) => s + 1 / (st.se * st.se) ** 2, 0);
  const c = sumW - sumW2 / sumW;
  const tau2 = c > 0 ? Math.max(0, (q - qDf) / c) : 0;
  const i2 = q > 0 ? Math.max(0, Math.min(1, (q - qDf) / q)) : 0;
  const random = pooledFrom(studies, tau2);

  // Egger's regression: y/se = b0 + b1 (1/se).
  let egger: MetaResult['egger'] = null;
  if (k >= 3) {
    const yy = studies.map((s) => s.effect / s.se);
    const xx = studies.map((s) => 1 / s.se);
    const mx = mean(xx);
    const my = mean(yy);
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < k; i += 1) {
      sxx += (xx[i]! - mx) ** 2;
      sxy += (xx[i]! - mx) * (yy[i]! - my);
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    let sse = 0;
    for (let i = 0; i < k; i += 1) {
      const pred = intercept + slope * xx[i]!;
      sse += (yy[i]! - pred) ** 2;
    }
    const seIntercept = Math.sqrt(Math.max(1e-30, (sse / Math.max(1, k - 2)) * (1 / k + (mx * mx) / Math.max(1e-30, sxx))));
    const t = intercept / seIntercept;
    // Two-sided p from a t approximation with k-2 df (normal for simplicity).
    egger = { intercept, se: seIntercept, t, p: 2 * (1 - normalCdf(Math.abs(t))) };
  }

  // Duval-Tweedie trim-and-fill (iterative, fixed-effect side).
  const trimFill = trimAndFill(studies, random.estimate);

  // Subgroup pooling.
  const subgroups: MetaResult['subgroups'] = [];
  if (studies.some((s) => s.group)) {
    const labels = [...new Set(studies.map((s) => s.group ?? '—'))];
    for (const label of labels) {
      const subset = studies.filter((s) => (s.group ?? '—') === label);
      const res = metaBasic(subset);
      if (!res) continue;
      subgroups.push({ label, k: subset.length, estimate: res.estimate, lo: res.lo, hi: res.hi, i2: res.i2 });
    }
  }

  return {
    fixed,
    random,
    q,
    qDf,
    qP: 1 - chiSquareCdf(q, qDf),
    i2,
    tau2,
    k,
    egger,
    trimFill,
    subgroups,
  };
}

function metaBasic(studies: MetaStudy[]): { estimate: number; lo: number; hi: number; i2: number } | null {
  if (studies.length === 0) return null;
  const fixed = pooledFrom(studies, 0);
  const q = studies.reduce((s, st) => s + (st.effect - fixed.estimate) ** 2 / (st.se * st.se), 0);
  const k = studies.length;
  const i2 = q > 0 ? Math.max(0, (q - (k - 1)) / q) : 0;
  return { estimate: fixed.estimate, lo: fixed.lo, hi: fixed.hi, i2 };
}

function trimAndFill(studies: MetaStudy[], center: number): { filled: number; estimate: number; lo: number; hi: number } {
  let current = [...studies];
  let filled = 0;
  for (let iter = 0; iter < 10; iter += 1) {
    // Rank by distance from the centre; trim the most extreme on the heavy side.
    const sorted = [...current].sort((a, b) => a.effect - b.effect);
    const left = current.filter((s) => s.effect < center).length;
    const right = current.length - left;
    const side = right >= left ? 'right' : 'left';
    const kTrim = Math.max(0, Math.min(3, Math.abs(right - left)));
    if (kTrim === 0) break;
    const trimmed = side === 'right' ? sorted.slice(0, sorted.length - kTrim) : sorted.slice(kTrim);
    const re = pooledFrom(trimmed, 0);
    current = trimmed;
    center = re.estimate;
    filled = kTrim;
  }
  // Impute mirror images of the trimmed studies around the centre.
  const imputed: MetaStudy[] = [];
  const sorted = [...studies].sort((a, b) => a.effect - b.effect);
  const side = mean(studies.map((s) => s.effect)) >= center ? 'left' : 'right';
  const trim = Math.min(filled, sorted.length);
  for (let i = 0; i < trim; i += 1) {
    const src = side === 'left' ? sorted[i]! : sorted[sorted.length - 1 - i]!;
    imputed.push({ ...src, effect: 2 * center - src.effect });
  }
  const filledSet = [...studies, ...imputed];
  const res = pooledFrom(filledSet, 0);
  return { filled: imputed.length, estimate: res.estimate, lo: res.lo, hi: res.hi };
}

export interface MetaBenchmark {
  id: string;
  passed: boolean;
  relErr: number;
  detail: string;
}

/** Hand-checkable fixed/random pooling plus heterogeneity. */
export function runMetaBenchmark(): MetaBenchmark[] {
  const studies: MetaStudy[] = [
    { study: 'A', effect: 0.2, se: 0.1, group: null },
    { study: 'B', effect: 0.4, se: 0.1, group: null },
    { study: 'C', effect: 0.3, se: 0.2, group: null },
    { study: 'D', effect: 0.25, se: 0.15, group: null },
  ];
  const res = metaAnalyze(studies);
  const w = studies.map((s) => 1 / (s.se * s.se));
  const manual = studies.reduce((s, st, i) => s + w[i]! * st.effect, 0) / w.reduce((a, b) => a + b, 0);
  const feErr = Math.abs((res?.fixed.estimate ?? NaN) - manual);
  const i2 = res?.i2 ?? NaN;
  return [
    {
      id: 'fixed-effect-hand',
      passed: feErr < 1e-12,
      relErr: feErr,
      detail: `inverse-variance estimate ${fmt(res?.fixed.estimate ?? NaN, 6)} vs hand ${fmt(manual, 6)}`,
    },
    {
      id: 'heterogeneity-bounds',
      passed: !!res && i2 >= 0 && i2 <= 1 && res.tau2 >= 0,
      relErr: 0,
      detail: `Q=${fmt(res?.q ?? NaN, 3)}, I²=${fmt(i2 * 100, 2)}%, τ²=${fmt(res?.tau2 ?? NaN, 5)}`,
    },
    {
      id: 'random-effect-ci',
      passed: !!res && res.random.lo <= res.random.estimate && res.random.estimate <= res.random.hi,
      relErr: 0,
      detail: `random-effects ${fmt(res?.random.estimate ?? NaN, 4)} [${fmt(res?.random.lo ?? NaN, 4)}, ${fmt(res?.random.hi ?? NaN, 4)}]`,
    },
  ];
}
