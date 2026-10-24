// ==========================================================================
// Ergalics Studio — FR-07 AI analysis assistant: offline intent engine
//
// A pure-TS, fully offline rule engine that turns a natural-language request
// ("对 x 和 y 做相关分析并画散点图" / "correlate x and y, scatter plot") into
// runnable `studio.*` Python code. No model, no network: keyword/regex
// matching over five intent templates (correlation / regression /
// distribution / test / filter).
//
// Invariant: every `studio.*` call emitted by `synthesizeCode` must be in the
// allowlist extracted from the real runtime module (`studio.py.ts`), which
// `validateStudioApi` enforces. The assistant never invents APIs.
// ==========================================================================

import { STUDIO_PYTHON_SOURCE } from '@/core/pyodide/studio.py';
import type { Locale } from '@/i18n/types';

export type IntentKind = 'correlation' | 'regression' | 'distribution' | 'test' | 'filter';

export const INTENT_KINDS: readonly IntentKind[] = [
  'correlation',
  'regression',
  'distribution',
  'test',
  'filter',
];

export interface IntentSlots {
  /** Project data file to load, or null → synthesize exampleData. */
  source: string | null;
  /** X / first column hint. */
  x: string | null;
  /** Y / second column hint. */
  y: string | null;
  /** Single-column hint (distribution / test / filter). */
  column: string | null;
  /** Histogram bin count (distribution). */
  bins: number | null;
  /** Moving-average window (filter). */
  window: number | null;
  /** Null-hypothesis mean (test). */
  mu: number | null;
}

export interface IntentMatch {
  kind: IntentKind;
  confidence: number;
  slots: IntentSlots;
}

// ---- supported studio.* API allowlist -------------------------------------
// Derived from the real `_Studio` class in the Pyodide module source so the
// list can never drift from what the runtime actually exposes.

function extractStudioApiNames(source: string): string[] {
  const names = new Set<string>();
  const re = /^ {4}def (\w+)\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[1] && !m[1].startsWith('_')) names.add(m[1]);
  }
  return [...names].sort();
}

export const STUDIO_API_NAMES: readonly string[] = extractStudioApiNames(STUDIO_PYTHON_SOURCE);

const API_SET = new Set<string>(STUDIO_API_NAMES);

/** True when every `studio.xxx` call site in `code` is a supported API. */
export function validateStudioApi(code: string): boolean {
  const re = /studio\.([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(code)) !== null) {
    found = true;
    if (!m[1] || !API_SET.has(m[1])) return false;
  }
  return found;
}

// ---- keyword tables (bilingual) --------------------------------------------

interface IntentRule {
  kind: IntentKind;
  /** Lowercased English / mixed keywords (word-boundary matched). */
  keywords: string[];
  /** Substring keywords for Chinese (no word boundaries). */
  zhKeywords: string[];
}

const INTENT_RULES: IntentRule[] = [
  {
    kind: 'correlation',
    keywords: ['correlation', 'correlate', 'pearson', 'coefficient', 'association'],
    zhKeywords: ['相关', '相关性', '关联'],
  },
  {
    kind: 'regression',
    keywords: ['regression', 'regress', 'fit', 'fitted', 'least', 'squares', 'slope', 'trend line'],
    zhKeywords: ['回归', '拟合', '最小二乘', '斜率'],
  },
  {
    kind: 'distribution',
    keywords: ['distribution', 'histogram', 'hist', 'density', 'spread', 'summary', 'describe'],
    zhKeywords: ['分布', '直方图', '概览', '描述统计', '统计摘要'],
  },
  {
    kind: 'test',
    keywords: ['test', 'hypothesis', 't-test', 'ttest', 'significance', 'p-value', 'compare mean'],
    zhKeywords: ['检验', '假设', '显著', 't 检验', 't检验', 'p 值', 'p值'],
  },
  {
    kind: 'filter',
    keywords: ['filter', 'smooth', 'smoothing', 'moving average', 'denoise', 'noise', 'low-pass'],
    zhKeywords: ['滤波', '平滑', '去噪', '移动平均', '噪声'],
  },
];

// ---- slot extraction --------------------------------------------------------

const FILE_RE = /([\w\-./]+\.(?:csv|tsv|txt|dat|xyz|json))/i;

/** Identifier tokens that must never be mistaken for column names. */
const COLUMN_STOPWORDS = new Set([
  'do', 'the', 'and', 'for', 'with', 'plot', 'draw', 'show', 'make', 'run',
  'data', 'file', 'column', 'columns', 'please', 'help', 'some', 'any',
  'x', 'y', // bare 'x'/'y' handled by the pair regex below, not the fallback
]);

function isLikelyColumn(token: string): boolean {
  return /^[A-Za-z_][\w]*$/.test(token) && !COLUMN_STOPWORDS.has(token.toLowerCase());
}

function extractSlots(text: string, locale: Locale): IntentSlots {
  const slots: IntentSlots = {
    source: null, x: null, y: null, column: null, bins: null, window: null, mu: null,
  };

  const file = FILE_RE.exec(text);
  if (file?.[1]) slots.source = file[1];

  // "x 和 y" / "x and y" / "between x, y" — pair of column hints.
  const pair = /([A-Za-z_]\w*)\s*(?:和|与|、|and|,)\s*([A-Za-z_]\w*)/.exec(text);
  if (pair?.[1] && pair?.[2] && isLikelyColumn(pair[1]) && isLikelyColumn(pair[2])) {
    slots.x = pair[1];
    slots.y = pair[2];
  }

  // "列 temperature" / "column temp" / "对 temperature 列"
  const colM = /(?:列|column)\s*[:：]?\s*["']?([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*)/i.exec(text)
    ?? /["']([A-Za-z_]\w*)["']\s*(?:列|column)/i.exec(text);
  if (colM?.[1] && isLikelyColumn(colM[1])) slots.column = colM[1];

  const binsM = /(?:bins?|分箱|组数|条数)\D{0,4}(\d+)/i.exec(text) ?? /(\d+)\s*(?:bins?|个?箱)/i.exec(text);
  if (binsM?.[1]) slots.bins = clampInt(binsM[1], 2, 100);

  const winM = /(?:window|窗口)\D{0,4}(\d+)/i.exec(text) ?? /(\d+)\s*(?:点|samples?)\s*(?:移动平均|window)/i.exec(text);
  if (winM?.[1]) slots.window = clampInt(winM[1], 2, 200);

  const muM = /(?:mean|均值|期望)\s*(?:=|为|是)?\s*(-?\d+(?:\.\d+)?)/i.exec(text);
  if (muM?.[1]) slots.mu = Number(muM[1]);
  if (locale === 'zh-CN' && slots.mu === null && /零|0\s*(?:的)?(?:假设|均值)/.test(text)) slots.mu = 0;

  return slots;
}

function clampInt(raw: string, lo: number, hi: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function countHits(text: string, rule: IntentRule): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of rule.keywords) {
    // Word-boundary match for ASCII keywords ("fit" must not hit "output").
    const re = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(lower)) hits += 1;
  }
  for (const kw of rule.zhKeywords) {
    if (text.includes(kw)) hits += 1;
  }
  return hits;
}

/**
 * Match a natural-language request to one of the five intent templates.
 * Returns null when no template reaches the minimum confidence.
 */
export function matchIntent(text: string, locale: Locale = 'zh-CN'): IntentMatch | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let best: { kind: IntentKind; hits: number } | null = null;
  for (const rule of INTENT_RULES) {
    const hits = countHits(trimmed, rule);
    if (hits > 0 && (!best || hits > best.hits)) best = { kind: rule.kind, hits };
  }
  if (!best) return null;

  const confidence = Math.min(0.95, 0.55 + 0.12 * best.hits);
  return { kind: best.kind, confidence, slots: extractSlots(trimmed, locale) };
}

// ---- code synthesis ----------------------------------------------------------

function sourceLine(slots: IntentSlots): string {
  if (slots.source) return `df = studio.load('${slots.source.replace(/'/g, "\\'")}')`;
  return 'df = studio.exampleData(200, 1)  # 无数据文件时合成正弦+噪声样本';
}

// The templates below only ever call APIs from STUDIO_API_NAMES; tests assert
// this via validateStudioApi.

const TEMPLATES: Record<IntentKind, (slots: IntentSlots) => string> = {
  correlation: (slots) => `# AI 助手：相关分析（${slots.x ?? '自动列'} × ${slots.y ?? '自动列'}）
import studio
import math

${sourceLine(slots)}
cols = dict(df.columns)
names = df.column_names()
xcol = ${q(slots.x)} if ${q(slots.x)} in names else names[0]
ycol = ${q(slots.y)} if (${q(slots.y)} in names and ${q(slots.y)} != xcol) else (names[1] if len(names) > 1 else xcol)
xs = cols[xcol]
ys = cols[ycol]
n = min(len(xs), len(ys))
mx = sum(xs[:n]) / n
my = sum(ys[:n]) / n
sxy = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
sxx = sum((xs[i] - mx) ** 2 for i in range(n))
syy = sum((ys[i] - my) ** 2 for i in range(n))
r = sxy / math.sqrt(sxx * syy) if sxx > 0 and syy > 0 else float('nan')
studio.print('Pearson r(%s, %s) = %.4f  (n=%d)' % (xcol, ycol, r, n))
studio.print(studio.summary(df, xcol))
studio.plot('scatter', df, {'x': xcol, 'y': ycol})
`,

  regression: (slots) => `# AI 助手：线性回归（最小二乘拟合 ${slots.x ?? '自动列'} → ${slots.y ?? '自动列'}）
import studio
import math

${sourceLine(slots)}
cols = dict(df.columns)
names = df.column_names()
xcol = ${q(slots.x)} if ${q(slots.x)} in names else names[0]
ycol = ${q(slots.y)} if (${q(slots.y)} in names and ${q(slots.y)} != xcol) else (names[1] if len(names) > 1 else xcol)
xs = cols[xcol]
ys = cols[ycol]
n = min(len(xs), len(ys))
mx = sum(xs[:n]) / n
my = sum(ys[:n]) / n
sxy = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
sxx = sum((xs[i] - mx) ** 2 for i in range(n))
slope = sxy / sxx if sxx > 0 else 0.0
intercept = my - slope * mx
resid = [ys[i] - (slope * xs[i] + intercept) for i in range(n)]
sse = sum(e * e for e in resid)
sst = sum((ys[i] - my) ** 2 for i in range(n))
r2 = 1 - sse / sst if sst > 0 else float('nan')
fit = [slope * xs[i] + intercept for i in range(n)]
df2 = studio.addColumn(df, 'fit', fit)
studio.print('y = %.4f * x + %.4f   R^2 = %.4f' % (slope, intercept, r2))
studio.plot('scatter', df, {'x': xcol, 'y': ycol})
studio.plot('line', df2, {'x': xcol, 'y': 'fit'})
`,

  distribution: (slots) => `# AI 助手：分布查看（${q(slots.column) ?? '自动列'}，${slots.bins ?? 20} 个分箱）
import studio

${sourceLine(slots)}
names = df.column_names()
col = ${q(slots.column)} if ${q(slots.column)} in names else names[0]
bins = ${slots.bins ?? 20}
studio.print(studio.summary(df, col))
studio.print(studio.histogram(df, col, bins))
studio.plot('histogram', df, {'column': col})
`,

  test: (slots) => `# AI 助手：单样本 t 检验（${q(slots.column) ?? '自动列'} vs μ₀=${slots.mu ?? 0}）
import studio
import math

${sourceLine(slots)}
cols = dict(df.columns)
names = df.column_names()
col = ${q(slots.column)} if ${q(slots.column)} in names else names[0]
mu0 = ${slots.mu ?? 0}
vals = cols[col]
n = len(vals)
m = sum(vals) / n
sd = math.sqrt(sum((v - m) ** 2 for v in vals) / (n - 1)) if n > 1 else 0.0
t = (m - mu0) / (sd / math.sqrt(n)) if sd > 0 else float('nan')
studio.print('n=%d  mean=%.4f  sd=%.4f' % (n, m, sd))
studio.print('t = %.4f  df = %d  (|t| > 1.96 ⇒ 大样本近似下 5%% 显著)' % (t, n - 1))
studio.print('显著' if abs(t) > 1.96 else '不显著')
`,

  filter: (slots) => `# AI 助手：信号滤波（移动平均，窗口=${slots.window ?? 5}）
import studio

${sourceLine(slots)}
cols = dict(df.columns)
names = df.column_names()
col = ${q(slots.column)} if ${q(slots.column)} in names else (names[1] if len(names) > 1 else names[0])
window = ${slots.window ?? 5}
half = window // 2
vals = cols[col]
smoothed = []
for i in range(len(vals)):
    lo = max(0, i - half)
    hi = min(len(vals), i + half + 1)
    seg = vals[lo:hi]
    smoothed.append(sum(seg) / len(seg))
xaxis = 't' if 't' in names else next((c for c in names if c != col), col)
df2 = studio.addColumn(df, 'smoothed', smoothed)
studio.print('moving average window=%d on column %s' % (window, col))
studio.plot('line', df2, {'x': xaxis, 'y': col})
studio.plot('line', df2, {'x': xaxis, 'y': 'smoothed'})
`,
};

/** Python string literal for a slot value, or `None`. */
function q(value: string | null): string {
  if (value === null || value === undefined) return 'None';
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Synthesize runnable `studio.*` Python code for a matched intent. */
export function synthesizeCode(kind: IntentKind, slots: Partial<IntentSlots> = {}): string {
  const full: IntentSlots = {
    source: null, x: null, y: null, column: null, bins: null, window: null, mu: null,
    ...slots,
  };
  return TEMPLATES[kind](full);
}

// ---- error-driven fix suggestions --------------------------------------------

interface FixRule {
  /** Lowercased substrings of a runtime error that trigger this advice. */
  patterns: string[];
  zh: string;
  en: string;
}

const FIX_RULES: FixRule[] = [
  {
    patterns: ['not found', 'filenotfounderror', 'no such file'],
    zh: '数据文件不存在：请先在「数据」面板导入该文件，或改用合成数据 —— 把 studio.load(...) 替换为 studio.exampleData(200, 1)。',
    en: 'Data file not found: import it via the Data panel first, or switch to synthetic data — replace studio.load(...) with studio.exampleData(200, 1).',
  },
  {
    patterns: ['column', 'does not exist', '不存在'],
    zh: '列名不存在：先用 studio.print(df.column_names()) 查看实际列名，再修正代码里的列名（注意大小写）。',
    en: 'Column does not exist: run studio.print(df.column_names()) to see the real column names, then fix the column name in the code (case matters).',
  },
  {
    patterns: ['is not a function', 'not defined', 'attributeerror', 'unknown plot type'],
    zh: '调用了不支持的 API：助手只会使用 studio 运行时支持的 API（如 load、select、summary、histogram、addColumn、plot、print、notify）。请检查拼写或改用受支持的调用。',
    en: 'Unsupported API call: only the studio runtime\'s own APIs exist (load, select, summary, histogram, addColumn, plot, print, notify…). Check the spelling or use a supported call.',
  },
  {
    patterns: ['division by zero', 'zerodivisionerror'],
    zh: '除以零：当列的方差为 0（全相同值）时相关/回归会退化，请换一列数据或先过滤常数列。',
    en: 'Division by zero: correlation/regression degenerate when a column has zero variance — pick another column or drop constant columns first.',
  },
  {
    patterns: ['no numeric data', 'could not convert', 'valueerror: could', 'invalid literal'],
    zh: '数据不是数值型：studio 的统计块只接受数值列，请确认文件内容为数字（检查表头与分隔符），或先 studio.filterRange 去掉非数值行。',
    en: 'Non-numeric data: studio statistics need numeric columns — verify the file holds numbers (check header/delimiter), or drop non-numeric rows with studio.filterRange first.',
  },
  {
    patterns: ['length', '!= table length', 'different length'],
    zh: '列长度不一致：addColumn 的 values 长度必须等于表的行数，请确认派生列与源列逐行对齐。',
    en: 'Column length mismatch: addColumn values must have exactly one entry per table row — make sure the derived series is aligned with the source column.',
  },
  {
    patterns: ['expected a datatable'],
    zh: '传入了非表对象：统计/绘图 API 的第一个参数必须是 studio.load/exampleData/random 返回的表，请检查变量赋值。',
    en: 'A table was expected: the first argument of statistics/plot APIs must be a DataTable returned by studio.load/exampleData/random — check the variable assignment.',
  },
  {
    patterns: ['syntaxerror', 'indentationerror', 'unexpected indent', 'invalid syntax'],
    zh: '语法/缩进错误：Python 缩进必须是 4 空格的整数倍，检查冒号、引号与括号是否成对。',
    en: 'Syntax/indentation error: Python blocks indent in multiples of 4 spaces; check colons, quotes and balanced brackets.',
  },
  {
    patterns: ['nameerror', 'name \'', 'is not defined'],
    zh: '变量未定义：变量名拼写错误或在使用前未赋值，请核对上方 studio.* 赋值语句。',
    en: 'Undefined variable: a name is misspelled or used before assignment — verify the studio.* assignment above it.',
  },
  {
    patterns: ['maximum call stack', 'recursion'],
    zh: '递归过深：函数缺少终止条件，请给递归加上基准情形或改用循环。',
    en: 'Recursion too deep: the function lacks a base case — add one or rewrite the recursion as a loop.',
  },
];

function isZh(locale: Locale): boolean {
  return locale === 'zh-CN';
}

/**
 * Rule-based fix advice for a run error. `lastCode` is used for a couple of
 * targeted hints (e.g. which studio.load call to swap out).
 */
export function suggestFix(error: string, lastCode: string, locale: Locale = 'zh-CN'): string {
  const lower = error.toLowerCase();
  for (const rule of FIX_RULES) {
    if (rule.patterns.some((p) => lower.includes(p))) {
      let advice = isZh(locale) ? rule.zh : rule.en;
      if (rule.patterns.includes('not found') && /studio\.load\((['"])(.*?)\1\)/.test(lastCode)) {
        const m = /studio\.load\((['"])(.*?)\1\)/.exec(lastCode);
        if (m?.[2]) {
          advice += isZh(locale)
            ? `（当前加载的是 "${m[2]}"）`
            : ` (currently loading "${m[2]}")`;
        }
      }
      return advice;
    }
  }
  return isZh(locale)
    ? '未识别的错误类型：请查看控制台完整堆栈，或简化代码后分步运行定位问题。'
    : 'Unrecognized error: check the full console stack trace, or simplify the code and run step by step to isolate it.';
}
