// ==========================================================================
// Ergalics Studio — figure caption drafting (FR-03, core)
//
// `draftCaption` turns a chart kind, its data column names and (optionally)
// a statistical result into an editable caption draft in Chinese or English.
// Pure template + data fill — no LLM, no DOM. The statistical sentence reuses
// the FR-02 narrative generator so both features phrase results identically.
// ==========================================================================

import type { ChartKind, PlotSpec } from '@/core/plot';
import { generateNarrative } from '@/core/stats/narrative';
import type { NarrativeInput, NarrativeLang } from '@/core/stats/narrative';
import { pearson } from '@/core/stats/effect';
import { studentTCdf } from '@/core/stats/special';

export interface CaptionDraftInput {
  chartType: ChartKind;
  /** Data column names backing the chart (x first, y second, extras = series). */
  columns: string[];
  /** Statistical result to fold into the draft; omit when none is available. */
  stats?: NarrativeInput | null;
  lang: NarrativeLang;
}

type Phrase = { zh: string; en: string };

const CHART_NOUN: Record<ChartKind, Phrase> = {
  line: { zh: '折线图', en: 'Line chart' },
  scatter: { zh: '散点图', en: 'Scatter plot' },
  bar: { zh: '条形图', en: 'Bar chart' },
  histogram: { zh: '直方图', en: 'Histogram' },
};

/** Capitalize the leading letter (English phrases start a caption clause). */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One clause describing what the chart shows, in the target language. */
function describeChart(kind: ChartKind, columns: string[], lang: NarrativeLang): string {
  const zh = lang === 'zh-CN';
  const noun = CHART_NOUN[kind][zh ? 'zh' : 'en'];
  const clean = columns.map((c) => c.trim()).filter((c) => c.length > 0);
  const x = clean[0];
  const y = clean[1];

  switch (kind) {
    case 'line':
      return x && y
        ? zh
          ? `${noun}：${y} 随 ${x} 的变化趋势`
          : `${noun} of ${y} as a function of ${x}`
        : zh
          ? `${noun}`
          : `A ${noun.toLowerCase()}`;
    case 'scatter':
      return x && y
        ? zh
          ? `${noun}：${x} 与 ${y} 的关系`
          : `${noun} of ${y} against ${x}`
        : zh
          ? `${noun}`
          : `A ${noun.toLowerCase()}`;
    case 'bar':
      if (clean.length >= 2) {
        const items = clean.slice(1).join(zh ? '、' : ', ');
        return zh ? `${noun}：按 ${x} 比较 ${items}` : `${noun} comparing ${items} by ${x}`;
      }
      return y
        ? zh
          ? `${noun}：${y} 的分组比较`
          : `${noun} comparing ${y} across groups`
        : zh
          ? `${noun}`
          : `A ${noun.toLowerCase()}`;
    case 'histogram':
      return x
        ? zh
          ? `${noun}：${x} 的分布`
          : `${noun} of the distribution of ${x}`
        : zh
          ? `${noun}`
          : `A ${noun.toLowerCase()}`;
  }
}

/**
 * Derive a correlation narrative from the first line/scatter panel that has
 * enough points (n >= 3). Returns null when no panel supports it (bar /
 * histogram data, or too few points) so the draft degrades to a description
 * only — never a fabricated statistic.
 */
export function deriveStatsFromPanels(
  panels: Array<{ spec: PlotSpec }>,
): NarrativeInput | null {
  for (const panel of panels) {
    const series = panel.spec.series[0];
    if (!series?.points || series.points.length < 3) continue;
    if (series.kind !== 'line' && series.kind !== 'scatter') continue;
    const xs = series.points.map((p) => p.x);
    const ys = series.points.map((p) => p.y);
    const n = series.points.length;
    const r = pearson(xs, ys);
    if (!Number.isFinite(r)) continue;
    const denom = 1 - r * r;
    const t = denom === 0 ? 0 : r * Math.sqrt((n - 2) / denom);
    const df = n - 2;
    const pValue = 2 * (1 - studentTCdf(Math.abs(t), df));
    return {
      kind: 'correlation',
      r,
      pValue,
      n,
      xName: panel.spec.xLabel || 'x',
      yName: panel.spec.yLabel || series.name || 'y',
    };
  }
  return null;
}

/**
 * Draft an editable caption:
 * `Figure 1. <chart description>[ <statistical sentence>]`
 * (Chinese: `图 1。<图表描述><统计句>`). Missing columns or stats degrade
 * gracefully to the parts that are available.
 */
export function draftCaption(input: CaptionDraftInput): string {
  const zh = input.lang === 'zh-CN';
  const prefix = zh ? '图 1.' : 'Figure 1.';
  const desc = cap(describeChart(input.chartType, input.columns ?? [], input.lang));
  const head = zh ? `${prefix}${desc}` : `${prefix} ${desc}`;
  if (!input.stats) return zh ? `${head}。` : `${head}.`;
  const sentence = generateNarrative(input.stats, input.lang);
  return zh ? `${head}。${sentence}` : `${head} ${sentence}`;
}
