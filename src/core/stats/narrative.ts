// ==========================================================================
// Ergalics Studio — statistical narrative generation (FR-02)
//
// Turns the structured results of the five headline test families (t-test,
// ANOVA, chi-square, correlation, linear regression) into publication-ready
// sentences in Chinese or English. Pure TS, no DOM — safe in Node and in the
// report builder pipeline.
//
// Conventions encoded here (REQUIREMENTS.md FR-02):
// - p < .001 renders as an inequality (`p < .001`), otherwise three decimals
//   with the leading zero dropped (journal style).
// - Non-significant results get neutral wording ("did not reach significance")
//   rather than "there is no difference", which would over-claim absence.
// - Effect sizes are labelled against Cohen's conventional thresholds and the
//   label is embedded in the sentence so the reader sees the interpretation.
// ==========================================================================

import type { TestResult, ChiSquareResult } from './tests';

export const NARRATIVE_TYPES = ['ttest', 'anova', 'chi2', 'correlation', 'regression'] as const;

export type NarrativeType = (typeof NARRATIVE_TYPES)[number];

export type NarrativeLang = 'zh-CN' | 'en-US';

/** Significance cutoff used for the narrative branch (alpha = .05). */
const ALPHA = 0.05;

// --------------------------------------------------------------------------
// Formatting primitives
// --------------------------------------------------------------------------

/**
 * Journal-style p-value: `p < .001` when the value is below .001,
 * otherwise `p = .XXX` (three decimals, leading zero dropped). Non-finite
 * input yields `p = —` so a degenerate test never prints `p = NaN`.
 */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return 'p = —';
  if (p < 0.001) return 'p < .001';
  return `p = ${p.toFixed(3).replace(/^0/, '')}`;
}

/** Fixed-decimal statistic, leading zero kept (2.31, 0.85 → "0.85"). */
function fmtStat(v: number, digits: number): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function fmtInt(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v)) : '—';
}

// --------------------------------------------------------------------------
// Effect-size labels (Cohen's conventional thresholds)
// --------------------------------------------------------------------------

export type EffectKind = 'd' | 'r' | 'eta2' | 'phi' | 'w';

interface Thresholds {
  small: number;
  medium: number;
  large: number;
}

// Cohen (1988) benchmarks; |d| and |r| are magnitude-based (sign ignored).
const THRESHOLDS: Record<EffectKind, Thresholds> = {
  d: { small: 0.2, medium: 0.5, large: 0.8 },
  r: { small: 0.1, medium: 0.3, large: 0.5 },
  eta2: { small: 0.01, medium: 0.06, large: 0.14 },
  phi: { small: 0.1, medium: 0.3, large: 0.5 },
  w: { small: 0.1, medium: 0.3, large: 0.5 },
};

/**
 * Classify an effect size against Cohen's small/medium/large thresholds.
 * Below the small cutoff is reported as "negligible" (very small) rather
 * than "small", so the label never inflates a trivial effect.
 */
export function effectSizeLabel(kind: EffectKind, value: number): { zh: string; en: string } {
  if (!Number.isFinite(value)) return { zh: '无法解释', en: 'uninterpretable' };
  const t = THRESHOLDS[kind];
  const v = Math.abs(value);
  if (v < t.small) return { zh: '效应极小', en: 'negligible effect' };
  if (v < t.medium) return { zh: '小效应', en: 'small effect' };
  if (v < t.large) return { zh: '中等效应', en: 'medium effect' };
  return { zh: '大效应', en: 'large effect' };
}

// --------------------------------------------------------------------------
// Narrative inputs — derived from the real result shapes in stats/tests.ts
// --------------------------------------------------------------------------

/** `TestResult` from tests.ts plus the context needed to phrase it. */
export interface TTestNarrative {
  kind: 'ttest';
  /** 'one' = one-sample, 'paired' = paired, 'two' = independent samples. */
  variant: 'one' | 'paired' | 'two';
  result: TestResult;
  /** Cohen's d when the caller has computed it (effect.ts `cohensD`). */
  d?: number;
  /** Optional group/variable names for richer phrasing. */
  groupA?: string;
  groupB?: string;
}

export interface AnovaNarrative {
  kind: 'anova';
  /** `TestResult` from `anovaOneWay` (df is the [between, within] pair). */
  result: TestResult;
  /** Partial eta-squared from the SS decomposition. */
  eta2?: number;
  /** Number of groups (for the "k groups" phrasing). */
  groups?: number;
}

export interface ChiSquareNarrative {
  kind: 'chi2';
  /** `ChiSquareResult` from `chiSquareIndependence`. */
  result: ChiSquareResult | (Omit<ChiSquareResult, 'expected'> & { expected?: number[][] });
  /** Phi coefficient (effect.ts does not provide one; caller supplies it). */
  phi?: number;
  /** Total sample size (chiSquareIndependence keeps it internal). */
  n?: number;
}

export interface CorrelationNarrative {
  kind: 'correlation';
  /** Pearson r (effect.ts `pearson`). */
  r: number;
  /** Two-sided p-value for the correlation. */
  pValue: number;
  /** Paired observations; df = n - 2 when n is known. */
  n?: number;
  /** Explicit df override (used when n is unknown but df was reported). */
  df?: number;
  method?: 'pearson' | 'spearman';
  xName?: string;
  yName?: string;
}

export interface RegressionNarrative {
  kind: 'regression';
  /** Global model F test (OlsResult.f / .fP with df [p-1, n-p]). */
  f: number;
  df: [number, number];
  pValue: number;
  r2: number;
  /** One focal predictor's standardized coefficient and t test. */
  predictor?: { name?: string; beta: number; t: number; df: number; pValue: number };
}

export type NarrativeInput =
  | TTestNarrative
  | AnovaNarrative
  | ChiSquareNarrative
  | CorrelationNarrative
  | RegressionNarrative;

// --------------------------------------------------------------------------
// Bilingual fragments
// --------------------------------------------------------------------------

type Phrase = { zh: string; en: string };

const T_LABEL: Record<TTestNarrative['variant'], Phrase> = {
  one: { zh: '单样本 t 检验', en: 'One-sample t-test' },
  paired: { zh: '配对样本 t 检验', en: 'Paired-samples t-test' },
  two: { zh: '独立样本 t 检验', en: 'Independent-samples t-test' },
};

const T_SIG: Record<TTestNarrative['variant'], Phrase> = {
  one: { zh: '样本均值与检验值差异显著', en: 'the mean differs significantly from the test value' },
  paired: { zh: '前后测均值差异显著', en: 'the paired means differ significantly' },
  two: { zh: '两组均值差异显著', en: 'the group means differ significantly' },
};

const T_NS: Record<TTestNarrative['variant'], Phrase> = {
  one: { zh: '样本均值与检验值的差异未达显著水平', en: 'the mean did not differ significantly from the test value' },
  paired: { zh: '前后测均值差异未达显著水平', en: 'the paired means did not differ significantly' },
  two: { zh: '两组均值差异未达显著水平', en: 'the group means did not differ significantly' },
};

const CHI_SIG: Phrase = {
  zh: '两个分类变量之间存在显著关联',
  en: 'a significant association existed between the two categorical variables',
};
const CHI_NS: Phrase = {
  zh: '两个分类变量之间的关联未达显著水平',
  en: 'the association between the two categorical variables did not reach significance',
};

const REG_SIG: Phrase = { zh: '模型整体显著', en: 'the model was significant' };
const REG_NS: Phrase = { zh: '模型整体未达显著水平', en: 'the model was not significant' };

function pick(p: Phrase, lang: NarrativeLang): string {
  return lang === 'zh-CN' ? p.zh : p.en;
}

function joinClauses(parts: string[]): string {
  return parts.filter((s) => s.length > 0).join(', ');
}

function endSentence(s: string, lang: NarrativeLang): string {
  return `${s}${lang === 'zh-CN' ? '。' : '.'}`;
}

/** `Cohen's d = 0.85（大效应）` / `Cohen's d = 0.85 (large effect)`. */
function effectClause(symbol: string, value: number, kind: EffectKind, lang: NarrativeLang): string {
  const label = effectSizeLabel(kind, value);
  const num = fmtStat(value, 2);
  return lang === 'zh-CN'
    ? `${symbol} = ${num}（${label.zh}）`
    : `${symbol} = ${num} (${label.en})`;
}

// --------------------------------------------------------------------------
// Per-family narrative builders
// --------------------------------------------------------------------------

function dfText(df: number | [number, number] | undefined): string {
  if (df === undefined) return '—';
  if (Array.isArray(df)) return `${fmtInt(df[0])}, ${fmtInt(df[1])}`;
  return fmtInt(df);
}

function ttestNarrative(input: TTestNarrative, lang: NarrativeLang): string {
  const r = input.result;
  const sig = Number.isFinite(r.pValue) && r.pValue < ALPHA;
  const label = pick(T_LABEL[input.variant], lang);
  const claim = pick(sig ? T_SIG[input.variant] : T_NS[input.variant], lang);
  const stats = [
    `t(${dfText(r.df)}) = ${fmtStat(r.statistic, 2)}`,
    formatP(r.pValue),
  ];
  if (input.d !== undefined && Number.isFinite(input.d)) {
    stats.push(effectClause("Cohen's d", input.d, 'd', lang));
  }
  const body = lang === 'zh-CN' ? `${label}显示，${claim}，${joinClauses(stats)}` : `${label} revealed that ${claim}, ${joinClauses(stats)}`;
  return endSentence(body, lang);
}

function anovaNarrative(input: AnovaNarrative, lang: NarrativeLang): string {
  const r = input.result;
  const sig = Number.isFinite(r.pValue) && r.pValue < ALPHA;
  const label = lang === 'zh-CN' ? '单因素方差分析' : 'One-way ANOVA';
  const k = input.groups;
  const claim = sig
    ? (lang === 'zh-CN'
        ? `${k ? `${k} 个组的` : ''}组间差异显著`
        : `the ${k ? `${k} ` : ''}groups differed significantly`)
    : (lang === 'zh-CN'
        ? `${k ? `${k} 个组的` : ''}组间差异未达显著水平`
        : `the ${k ? `${k} ` : ''}groups did not differ significantly`);
  const stats = [`F(${dfText(r.df)}) = ${fmtStat(r.statistic, 2)}`, formatP(r.pValue)];
  if (input.eta2 !== undefined && Number.isFinite(input.eta2)) {
    stats.push(effectClause('η²', input.eta2, 'eta2', lang));
  }
  const body = lang === 'zh-CN'
    ? `${label}显示，${claim}，${joinClauses(stats)}`
    : `${label} revealed that ${claim}, ${joinClauses(stats)}`;
  return endSentence(body, lang);
}

function chi2Narrative(input: ChiSquareNarrative, lang: NarrativeLang): string {
  const r = input.result;
  const sig = Number.isFinite(r.pValue) && r.pValue < ALPHA;
  const claim = pick(sig ? CHI_SIG : CHI_NS, lang);
  const nPart = input.n !== undefined && Number.isFinite(input.n) ? `, N = ${fmtInt(input.n)}` : '';
  const stats = [`χ²(${fmtInt(r.df)}${nPart}) = ${fmtStat(r.statistic, 2)}`, formatP(r.pValue)];
  if (input.phi !== undefined && Number.isFinite(input.phi)) {
    stats.push(effectClause('φ', input.phi, 'phi', lang));
  }
  const body = lang === 'zh-CN' ? `卡方检验显示，${claim}，${joinClauses(stats)}` : `A chi-square test of independence showed ${claim}, ${joinClauses(stats)}`;
  return endSentence(body, lang);
}

function correlationNarrative(input: CorrelationNarrative, lang: NarrativeLang): string {
  const sig = Number.isFinite(input.pValue) && input.pValue < ALPHA;
  const method = input.method === 'spearman' ? 'Spearman' : 'Pearson';
  const x = input.xName ?? 'x';
  const y = input.yName ?? 'y';
  const df = input.df ?? (input.n !== undefined ? input.n - 2 : undefined);
  const dfPart = df !== undefined ? `(${fmtInt(df)})` : '';
  const stats = [`r${dfPart} = ${fmtStat(input.r, 2)}`, formatP(input.pValue)];
  if (sig) {
    const dir = input.r >= 0
      ? { zh: '正相关', en: 'positive correlation' }
      : { zh: '负相关', en: 'negative correlation' };
    const label = effectSizeLabel('r', input.r);
    const body = lang === 'zh-CN'
      ? `${method} 相关分析显示，${x} 与 ${y} 之间存在显著${dir.zh}，${joinClauses(stats)}（${label.zh}）`
      : `${method} correlation analysis showed a significant ${dir.en} between ${x} and ${y}, ${joinClauses(stats)} (${label.en})`;
    return endSentence(body, lang);
  }
  const body = lang === 'zh-CN'
    ? `${method} 相关分析显示，${x} 与 ${y} 之间的相关未达显著水平，${joinClauses(stats)}`
    : `${method} correlation analysis showed that the association between ${x} and ${y} did not reach significance, ${joinClauses(stats)}`;
  return endSentence(body, lang);
}

function regressionNarrative(input: RegressionNarrative, lang: NarrativeLang): string {
  const sig = Number.isFinite(input.pValue) && input.pValue < ALPHA;
  const claim = pick(sig ? REG_SIG : REG_NS, lang);
  const stats = joinClauses([
    `F(${dfText(input.df)}) = ${fmtStat(input.f, 2)}`,
    formatP(input.pValue),
    `R² = ${fmtStat(input.r2, 2)}`,
  ]);
  const head = lang === 'zh-CN'
    ? `线性回归分析显示，${claim}，${stats}`
    : `Linear regression showed that ${claim}, ${stats}`;
  const pred = input.predictor;
  if (!pred) return endSentence(head, lang);

  const predSig = Number.isFinite(pred.pValue) && pred.pValue < ALPHA;
  const name = pred.name ?? 'x';
  const predStats = joinClauses([
    `β = ${fmtStat(pred.beta, 2)}`,
    `t(${fmtInt(pred.df)}) = ${fmtStat(pred.t, 2)}`,
    formatP(pred.pValue),
  ]);
  const dir = pred.beta >= 0
    ? { zh: '正向', en: 'positive' }
    : { zh: '负向', en: 'negative' };
  const predPart = predSig
    ? (lang === 'zh-CN'
        ? `${name} 对 y 有显著${dir.zh}预测作用，${predStats}`
        : `${name} significantly ${dir.en}ly predicted y, ${predStats}`)
    : (lang === 'zh-CN'
        ? `${name} 对 y 的${dir.zh}预测作用未达显著水平，${predStats}`
        : `${name} did not significantly ${dir.en}ly predict y, ${predStats}`);
  const sep = lang === 'zh-CN' ? '；' : '. In addition, ';
  return endSentence(`${head}${sep}${predPart}`, lang);
}

// --------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------

/**
 * Generate a publication-style narrative paragraph for one statistical
 * result. The output is a single sentence (two for regression with a focal
 * predictor) in the requested language.
 */
export function generateNarrative(input: NarrativeInput, lang: NarrativeLang): string {
  switch (input.kind) {
    case 'ttest':
      return ttestNarrative(input, lang);
    case 'anova':
      return anovaNarrative(input, lang);
    case 'chi2':
      return chi2Narrative(input, lang);
    case 'correlation':
      return correlationNarrative(input, lang);
    case 'regression':
      return regressionNarrative(input, lang);
  }
}
