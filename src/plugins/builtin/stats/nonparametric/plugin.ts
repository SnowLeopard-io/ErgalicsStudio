// ==========================================================================
// Nonparametric Tests plugin
//
// Canvas: empirical CDFs of each group (the distribution-free view behind the
// rank tests) plus the selected test's statistic, effect size and p-value.
// The test selector covers two-sample, k-sample, paired, goodness-of-fit and
// rank-correlation families.
// ==========================================================================

import type { ParamDefinition } from '@/types/plugin';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import type { FigurePanelSpec } from '@/core/figure/sheet';
import { fmtMetric } from '@/core/research/scienceOutput';
import { CS, drawCard, drawLegend, font, plotBox } from '../../shared/cs-utils';
import { fmt, fmtP, xScale, yScale } from '../../shared/stats-utils';
import { StatsPluginBase, type BenchRow, type CsvPayload } from '../shared/plugin-base';
import { statsNonparametricManifest } from './manifest';
import {
  friedman,
  kruskalWallis,
  ksOneSampleNormal,
  ksTwoSample,
  mannWhitney,
  parseNonparametric,
  rankCorrelations,
  runNonparametricBenchmark,
  signTest,
  wilcoxonSignedRank,
  type NpDataset,
  type NpResult,
} from './kernel';
import { nonparametricFigurePanels } from './figure';

const DEFAULT_DATA = `group,value
control,4.8
control,5.6
control,5.1
control,6.3
control,4.4
control,5.9
control,5.2
control,6.1
treated,6.7
treated,7.4
treated,6.2
treated,8.1
treated,7.8
treated,6.9
treated,7.2
treated,8.4`;

type NpTest = 'mann-whitney' | 'wilcoxon' | 'kruskal' | 'friedman' | 'sign' | 'ks2' | 'ks1' | 'corr';

interface NpState {
  test: NpTest;
}

export interface NpViewResult {
  dataset: NpDataset;
  result: NpResult | null;
  correlation: { rho: number; rhoP: number; tau: number; tauP: number } | null;
}

const TEST_LABELS: Array<{ value: NpTest; en: string; zh: string }> = [
  { value: 'mann-whitney', en: 'Mann–Whitney U', zh: 'Mann–Whitney U' },
  { value: 'wilcoxon', en: 'Wilcoxon signed-rank', zh: 'Wilcoxon 符号秩' },
  { value: 'kruskal', en: 'Kruskal–Wallis', zh: 'Kruskal–Wallis' },
  { value: 'friedman', en: 'Friedman', zh: 'Friedman' },
  { value: 'sign', en: 'Exact sign test', zh: '精确符号检验' },
  { value: 'ks2', en: 'Two-sample KS', zh: '双样本 KS' },
  { value: 'ks1', en: 'One-sample KS (normal)', zh: '单样本 KS（正态）' },
  { value: 'corr', en: 'Spearman / Kendall', zh: 'Spearman / Kendall' },
];

export class StatsNonparametricPlugin extends StatsPluginBase<NpState, NpViewResult> {
  constructor() {
    super(statsNonparametricManifest, { test: 'mann-whitney' }, DEFAULT_DATA);
  }

  protected stateParams(): ParamDefinition[] {
    return [this.select('test', 'Test', '检验方法', this.state.test, TEST_LABELS)];
  }

  protected updateState(params: Record<string, unknown>): boolean {
    const match = TEST_LABELS.find((t) => t.value === params.test);
    if (match && match.value !== this.state.test) {
      this.state.test = match.value;
      return true;
    }
    return false;
  }

  protected computeResult(): NpViewResult | null {
    const dataset = parseNonparametric(this.text);
    if (dataset.groups.length === 0) return null;
    const g = dataset.groups;
    const a = g[0]?.values ?? [];
    const b = g[1]?.values ?? [];
    let result: NpResult | null = null;
    let correlation: NpViewResult['correlation'] = null;
    switch (this.state.test) {
      case 'mann-whitney':
        result = mannWhitney(a, b);
        break;
      case 'wilcoxon':
        result = wilcoxonSignedRank(a, b);
        break;
      case 'kruskal':
        result = kruskalWallis(g);
        break;
      case 'friedman':
        result = friedman(g);
        break;
      case 'sign':
        result = signTest(a, b);
        break;
      case 'ks2':
        result = ksTwoSample(a, b);
        break;
      case 'ks1':
        result = ksOneSampleNormal(a);
        break;
      case 'corr':
        correlation = rankCorrelations(a, b);
        break;
    }
    return { dataset, result, correlation };
  }

  protected metrics(view: NpViewResult): ScienceMetric[] {
    const r = view.result;
    const testLabel = TEST_LABELS.find((t) => t.value === this.state.test);
    const metrics: ScienceMetric[] = [
      {
        key: 'test',
        label: this.zh ? '检验' : 'Test',
        value: this.zh ? testLabel?.zh ?? '' : testLabel?.en ?? '',
        hint: view.dataset.paired ? (this.zh ? '配对样本' : 'paired samples') : (this.zh ? '独立样本' : 'independent samples'),
      },
    ];
    if (view.correlation) {
      const c = view.correlation;
      metrics.push(
        {
          key: 'rho',
          label: 'Spearman ρ',
          value: fmt(c.rho, 4),
          severity: Math.abs(c.rho) > 0.5 ? 'ok' : 'info',
          hint: `p=${fmtP(c.rhoP)}`,
        },
        {
          key: 'tau',
          label: 'Kendall τ-b',
          value: fmt(c.tau, 4),
          severity: Math.abs(c.tau) > 0.4 ? 'ok' : 'info',
          hint: `p=${fmtP(c.tauP)}`,
        },
        { key: 'n', label: this.zh ? '样本量' : 'n', value: String(view.dataset.groups[0]?.values.length ?? 0), hint: 'pairs' },
      );
      return metrics;
    }
    if (r) {
      metrics.push(
        {
          key: 'statistic',
          label: this.zh ? '检验统计量' : 'Statistic',
          value: fmt(r.statistic, 4),
          hint: Number.isFinite(r.df) ? `df=${fmt(r.df, 2)}` : (this.zh ? '无自由度' : 'no df'),
        },
        {
          key: 'p',
          label: 'p-value',
          value: fmtP(r.p),
          severity: r.p < 0.05 ? 'ok' : 'info',
          hint: this.zh ? '渐近近似' : 'asymptotic approximation',
        },
        {
          key: 'effect',
          label: r.effectLabel,
          value: fmt(r.effect, 4),
          severity: Math.abs(r.effect) > 0.5 ? 'ok' : Math.abs(r.effect) > 0.3 ? 'warn' : 'info',
          hint: r.detail,
        },
        {
          key: 'groups',
          label: this.zh ? '分组数' : 'Groups',
          value: String(view.dataset.groups.length),
          hint: view.dataset.valueName,
        },
      );
    }
    return metrics;
  }

  protected benchmark(): BenchRow[] {
    const labels: Record<string, [string, string]> = {
      'mann-whitney-separated': ['Mann–Whitney separation', 'Mann–Whitney 分离度'],
      'kruskal-wallis-separated': ['Kruskal–Wallis separation', 'Kruskal–Wallis 分离度'],
      'wilcoxon-symmetric': ['Wilcoxon recovered W+', 'Wilcoxon W+ 回收'],
      'kendall-known': ['Kendall τ reference', 'Kendall τ 参考值'],
    };
    return runNonparametricBenchmark().map((b) => ({
      id: b.id,
      labelEn: labels[b.id]?.[0] ?? b.id,
      labelZh: labels[b.id]?.[1] ?? b.id,
      passed: b.passed,
      value: b.relErr < 1e-3 ? b.relErr.toExponential(2) : fmt(b.relErr, 6),
      detail: b.detail,
    }));
  }

  protected csv(view: NpViewResult): CsvPayload {
    return {
      name: 'nonparametric',
      header: ['group', 'value'],
      rows: view.dataset.groups.flatMap((g) => g.values.map((v) => [g.label, v])),
    };
  }

  protected figurePanels(view: NpViewResult): FigurePanelSpec[] {
    return nonparametricFigurePanels(view);
  }

  protected figureTitle() {
    return { zh: '非参数检验 · 经验分布', en: 'Nonparametric Tests · Empirical Distributions' };
  }

  protected figureCaption(view: NpViewResult) {
    const r = view.result;
    return {
      zh: `非参数检验（${this.state.test}）：${r ? `${r.test}，统计量 ${fmt(r.statistic, 4)}，p=${fmtP(r.p)}，${r.effectLabel}=${fmt(r.effect, 4)}` : view.correlation ? `Spearman ρ=${fmt(view.correlation.rho, 4)} (p=${fmtP(view.correlation.rhoP)})，Kendall τ=${fmt(view.correlation.tau, 4)}` : '样本不足'}。`,
      en: `Nonparametric test (${this.state.test}): ${r ? `${r.test}, statistic ${fmt(r.statistic, 4)}, p=${fmtP(r.p)}, ${r.effectLabel}=${fmt(r.effect, 4)}` : view.correlation ? `Spearman rho=${fmt(view.correlation.rho, 4)} (p=${fmtP(view.correlation.rhoP)}), Kendall tau=${fmt(view.correlation.tau, 4)}` : 'insufficient data'}.`,
    };
  }

  protected title(): string {
    return this.zh ? '非参数检验' : 'Nonparametric Tests';
  }

  protected subtitle(): string {
    const d = parseNonparametric(this.text);
    return this.zh
      ? `${d.groups.length} 组 · ${d.groups.reduce((s, g) => s + g.values.length, 0)} 个观测 · 变量 ${d.valueName}`
      : `${d.groups.length} groups · ${d.groups.reduce((s, g) => s + g.values.length, 0)} observations · variable ${d.valueName}`;
  }

  protected footnote(): string {
    return this.zh
      ? '阶梯线为各组的经验累积分布；柱状图为组均值。检验 p 值使用带结校正的渐近近似。'
      : 'Step lines are each group\'s empirical CDF; bars are group means. p-values use the tie-corrected asymptotic approximation.';
  }

  protected drawBody(g: CanvasRenderingContext2D, w: number, h: number, view: NpViewResult | null): void {
    if (!view) {
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 12);
      g.textAlign = 'center';
      g.fillText(this.zh ? '需要两列数值（宽表）或 group + value 列。' : 'Need two numeric columns (wide) or group + value (long).', w / 2, h / 2);
      return;
    }
    const groups = view.dataset.groups;
    const all = groups.flatMap((gr) => gr.values);
    if (all.length === 0) return;
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.08 || 1;
    const box = plotBox(w, h, 64, 78, 30, Math.round(h * 0.5));
    const xs = xScale(box, lo - pad, hi + pad);
    const ys = yScale(box, 0, 1);
    const palette = [CS.blue, CS.amber, CS.green, CS.violet, CS.pink, CS.cyan];

    g.strokeStyle = CS.axis;
    g.strokeRect(box.x0, box.y0, box.w, box.h);
    g.strokeStyle = CS.grid;
    for (let i = 0; i <= 4; i += 1) {
      const y = box.y0 + (box.h * i) / 4;
      g.beginPath();
      g.moveTo(box.x0, y);
      g.lineTo(box.x1, y);
      g.stroke();
      g.fillStyle = CS.faint;
      g.font = font(false, 9);
      g.textAlign = 'right';
      g.fillText(fmt(1 - i / 4, 2), box.x0 - 6, y + 3);
    }
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 10);
    g.textAlign = 'center';
    g.fillText(this.zh ? '观测值' : 'value', (box.x0 + box.x1) / 2, box.y1 + 16);
    g.fillText('F(x)', box.x0 - 34, box.y0 - 8);

    const legend: Array<{ label: string; color: string }> = [];
    groups.forEach((gr, idx) => {
      const sorted = [...gr.values].sort((a, b) => a - b);
      const color = palette[idx % palette.length]!;
      legend.push({ label: `${gr.label} (n=${gr.values.length})`, color });
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(xs(lo - pad), ys(0));
      sorted.forEach((v, i) => {
        g.lineTo(xs(v), ys(i / sorted.length));
        g.lineTo(xs(v), ys((i + 1) / sorted.length));
      });
      g.lineTo(xs(hi + pad), ys(1));
      g.stroke();
      g.lineWidth = 1;
    });
    drawLegend(g, box.x0 + 8, box.y0 + 12, legend, this.zh);

    // Group-mean bars underneath.
    const barBox = { x0: 64, y0: Math.round(h * 0.63), x1: Math.round(w * 0.55), y1: h - 52, w: 0, h: 0 };
    barBox.w = barBox.x1 - barBox.x0;
    barBox.h = barBox.y1 - barBox.y0;
    const means = groups.map((gr) => gr.values.reduce((s, v) => s + v, 0) / Math.max(1, gr.values.length));
    const meanMax = Math.max(1e-9, ...means.map(Math.abs));
    const barW = barBox.w / Math.max(1, means.length);
    g.strokeStyle = CS.axis;
    g.strokeRect(barBox.x0, barBox.y0, barBox.w, barBox.h);
    means.forEach((m, i) => {
      const bh = (Math.abs(m) / meanMax) * (barBox.h - 16);
      g.fillStyle = palette[i % palette.length]!;
      g.fillRect(barBox.x0 + i * barW + barW * 0.2, barBox.y1 - bh, barW * 0.6, bh);
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 9);
      g.textAlign = 'center';
      g.fillText(groups[i]!.label.slice(0, 10), barBox.x0 + i * barW + barW / 2, barBox.y1 + 12);
      g.fillStyle = CS.faint;
      g.fillText(fmt(m, 2), barBox.x0 + i * barW + barW / 2, barBox.y1 - bh - 5);
    });
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 10, '600');
    g.textAlign = 'left';
    g.fillText(this.zh ? '组均值' : 'group means', barBox.x0, barBox.y0 - 6);

    // Result card.
    const cardX = Math.round(w * 0.6);
    drawCard(g, cardX, barBox.y0 - 12, w - cardX - 26, barBox.h + 18);
    const r = view.result;
    const lines: Array<[string, string]> = r
      ? [
          [this.zh ? '检验' : 'test', r.test],
          [this.zh ? '统计量' : 'statistic', fmt(r.statistic, 4)],
          ['df', Number.isFinite(r.df) ? fmt(r.df, 2) : '—'],
          ['p', fmtP(r.p)],
          [r.effectLabel, fmt(r.effect, 4)],
        ]
      : view.correlation
        ? [
            ['Spearman ρ', fmt(view.correlation.rho, 4)],
            ['ρ p-value', fmtP(view.correlation.rhoP)],
            ['Kendall τ', fmt(view.correlation.tau, 4)],
            ['τ p-value', fmtP(view.correlation.tauP)],
          ]
        : [];
    g.font = font(this.zh, 10.5);
    lines.forEach(([k, v], i) => {
      const y = barBox.y0 + 16 + i * 22;
      g.fillStyle = CS.dim;
      g.textAlign = 'left';
      g.fillText(k, cardX + 14, y);
      g.fillStyle = CS.text;
      g.textAlign = 'right';
      g.fillText(v, w - 40, y);
    });
    void fmtMetric;
    void drawCard;
  }
}

export default function createStatsNonparametricPlugin(): StatsNonparametricPlugin {
  return new StatsNonparametricPlugin();
}
