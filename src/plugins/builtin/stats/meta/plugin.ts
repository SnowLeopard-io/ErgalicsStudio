// ==========================================================================
// Meta-Analysis plugin
//
// Canvas: a forest plot of per-study effects with inverse-variance weights and
// the pooled fixed / random-effect diamonds, plus a funnel plot for
// small-study effects. The science strip reports Q, I², tau², Egger and the
// trim-and-fill estimate.
// ==========================================================================

import type { ParamDefinition } from '@/types/plugin';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import type { FigurePanelSpec } from '@/core/figure/sheet';
import { fmtMetric } from '@/core/research/scienceOutput';
import { CS, drawCard, drawLegend, font, plotBox } from '../../shared/cs-utils';
import { fmt, fmtP, xScale } from '../../shared/stats-utils';
import { StatsPluginBase, type BenchRow, type CsvPayload } from '../shared/plugin-base';
import { statsMetaManifest } from './manifest';
import {
  metaAnalyze,
  parseMeta,
  runMetaBenchmark,
  type MetaDataset,
  type MetaResult,
} from './kernel';
import { metaFigurePanels } from './figure';

const DEFAULT_DATA = `study,effect,se,group
Adams 2016,0.18,0.09,behavioural
Baker 2018,0.34,0.12,behavioural
Chen 2019,0.22,0.08,behavioural
Diaz 2020,0.41,0.15,behavioural
Evans 2017,0.29,0.11,pharmacological
Fischer 2019,0.51,0.17,pharmacological
Garcia 2021,0.37,0.13,pharmacological
Hughes 2022,0.44,0.14,pharmacological`;

interface MetaState {
  model: 'fixed' | 'random';
}

export interface MetaViewResult {
  dataset: MetaDataset;
  result: MetaResult;
}

export class StatsMetaPlugin extends StatsPluginBase<MetaState, MetaViewResult> {
  constructor() {
    super(statsMetaManifest, { model: 'random' }, DEFAULT_DATA);
  }

  protected stateParams(): ParamDefinition[] {
    return [
      this.select('model', 'Pooling model', '合并模型', this.state.model, [
        { value: 'fixed', en: 'Fixed effect', zh: '固定效应' },
        { value: 'random', en: 'Random effects (DL)', zh: '随机效应（DL）' },
      ]),
    ];
  }

  protected updateState(params: Record<string, unknown>): boolean {
    if ((params.model === 'fixed' || params.model === 'random') && params.model !== this.state.model) {
      this.state.model = params.model;
      return true;
    }
    return false;
  }

  protected computeResult(): MetaViewResult | null {
    const dataset = parseMeta(this.text);
    const result = metaAnalyze(dataset.studies);
    return result ? { dataset, result } : null;
  }

  protected metrics(view: MetaViewResult): ScienceMetric[] {
    const r = view.result;
    const pooled = this.state.model === 'fixed' ? r.fixed : r.random;
    return [
      {
        key: 'pooled',
        label: this.zh ? '合并效应量' : 'Pooled effect',
        value: `${fmt(pooled.estimate, 4)} [${fmt(pooled.lo, 3)}, ${fmt(pooled.hi, 3)}]`,
        severity: pooled.p < 0.05 ? 'ok' : 'info',
        hint: `${this.state.model} · z=${fmt(pooled.z, 3)} · p=${fmtP(pooled.p)}`,
      },
      {
        key: 'fixed',
        label: this.zh ? '固定效应' : 'Fixed effect',
        value: fmt(r.fixed.estimate, 4),
        hint: `SE=${fmt(r.fixed.se, 4)} · I²=${fmt(r.i2 * 100, 1)}%`,
      },
      {
        key: 'random',
        label: this.zh ? '随机效应' : 'Random effects',
        value: fmt(r.random.estimate, 4),
        hint: `SE=${fmt(r.random.se, 4)} · τ²=${fmt(r.tau2, 5)}`,
      },
      {
        key: 'q',
        label: 'Cochran Q',
        value: fmt(r.q, 3),
        severity: r.qP < 0.05 ? 'warn' : 'ok',
        hint: `df=${r.qDf} · p=${fmtP(r.qP)}`,
      },
      {
        key: 'i2',
        label: 'I²',
        value: `${fmt(r.i2 * 100, 1)}%`,
        severity: r.i2 > 0.75 ? 'warn' : r.i2 > 0.4 ? 'info' : 'ok',
        hint: this.zh ? '研究间异质性占比' : 'share of total variability due to heterogeneity',
      },
      {
        key: 'egger',
        label: 'Egger intercept',
        value: r.egger ? fmt(r.egger.intercept, 3) : '—',
        severity: r.egger ? (r.egger.p < 0.05 ? 'warn' : 'ok') : 'info',
        hint: r.egger ? `t=${fmt(r.egger.t, 3)} · p=${fmtP(r.egger.p)}` : (this.zh ? '需要至少 3 项研究' : 'needs ≥ 3 studies'),
      },
      {
        key: 'trimfill',
        label: this.zh ? '剪补后估计' : 'Trim-and-fill',
        value: r.trimFill ? fmt(r.trimFill.estimate, 4) : '—',
        hint: r.trimFill ? (this.zh ? `补入 ${r.trimFill.filled} 项研究` : `${r.trimFill.filled} studies imputed`) : '—',
      },
    ];
  }

  protected benchmark(): BenchRow[] {
    const labels: Record<string, [string, string]> = {
      'fixed-effect-hand': ['Fixed-effect estimate', '固定效应估计'],
      'heterogeneity-bounds': ['Heterogeneity bounds', '异质性范围'],
      'random-effect-ci': ['Random-effect CI', '随机效应置信区间'],
    };
    return runMetaBenchmark().map((b) => ({
      id: b.id,
      labelEn: labels[b.id]?.[0] ?? b.id,
      labelZh: labels[b.id]?.[1] ?? b.id,
      passed: b.passed,
      value: b.relErr < 1e-9 ? '0' : b.relErr.toExponential(2),
      detail: b.detail,
    }));
  }

  protected csv(view: MetaViewResult): CsvPayload {
    const r = view.result;
    return {
      name: 'meta-analysis',
      header: ['study', 'effect', 'se', 'weight_pct', 'group'],
      rows: view.dataset.studies.map((s, i) => [s.study, s.effect, s.se, r.random.weightPct[i] ?? '', s.group ?? '']),
    };
  }

  protected figurePanels(view: MetaViewResult): FigurePanelSpec[] {
    return metaFigurePanels(view, this.state.model);
  }

  protected figureTitle() {
    return { zh: '元分析 · 森林图与漏斗图', en: 'Meta-Analysis · Forest & Funnel' };
  }

  protected figureCaption(view: MetaViewResult) {
    const r = view.result;
    const pooled = this.state.model === 'fixed' ? r.fixed : r.random;
    return {
      zh: `元分析（k=${r.k}）：${this.state.model === 'fixed' ? '固定' : '随机'}效应合并 ${fmt(pooled.estimate, 4)} [${fmt(pooled.lo, 3)}, ${fmt(pooled.hi, 3)}]，z=${fmt(pooled.z, 3)}，p=${fmtP(pooled.p)}；Q=${fmt(r.q, 3)} (df=${r.qDf})，I²=${fmt(r.i2 * 100, 1)}%，τ²=${fmt(r.tau2, 5)}。`,
      en: `Meta-analysis (k=${r.k}): ${this.state.model} pooled effect ${fmt(pooled.estimate, 4)} [${fmt(pooled.lo, 3)}, ${fmt(pooled.hi, 3)}], z=${fmt(pooled.z, 3)}, p=${fmtP(pooled.p)}; Q=${fmt(r.q, 3)} (df=${r.qDf}), I²=${fmt(r.i2 * 100, 1)}%, tau²=${fmt(r.tau2, 5)}.`,
    };
  }

  protected title(): string {
    return this.zh ? '元分析' : 'Meta-Analysis';
  }

  protected subtitle(): string {
    const d = parseMeta(this.text);
    return this.zh
      ? `${d.studies.length} 项研究 · 效应量 ${d.effectName} · 标准误 ${d.seName} · ${this.state.model === 'fixed' ? '固定效应' : '随机效应'}`
      : `${d.studies.length} studies · effect ${d.effectName} · SE ${d.seName} · ${this.state.model} effects`;
  }

  protected footnote(): string {
    return this.zh
      ? '方块面积 ∝ 逆方差权重，菱形为合并效应；漏斗图横轴效应量、纵轴标准误，虚线为 95% 伪置信界。'
      : 'Square area ∝ inverse-variance weight, diamonds are pooled effects; the funnel plots effect against SE with 95% pseudo-bounds.';
  }

  protected drawBody(g: CanvasRenderingContext2D, w: number, h: number, view: MetaViewResult | null): void {
    if (!view) {
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 12);
      g.textAlign = 'center';
      g.fillText(this.zh ? '需要 study,effect,se 三列（至少 2 项研究）。' : 'Need study, effect and se columns (at least 2 studies).', w / 2, h / 2);
      return;
    }
    const { studies } = view.dataset;
    const r = view.result;
    const pooled = this.state.model === 'fixed' ? r.fixed : r.random;
    const effects = [...studies.map((s) => s.effect), pooled.lo, pooled.hi];
    const lo = Math.min(...effects) - 0.08 * Math.max(0.2, Math.max(...effects) - Math.min(...effects));
    const hi = Math.max(...effects) + 0.08 * Math.max(0.2, Math.max(...effects) - Math.min(...effects));
    const forestH = Math.round(h * 0.62);
    const box = plotBox(Math.round(w * 0.66), forestH, 150, 74, 26, 46);
    const xs = xScale(box, lo, hi);
    const rows = studies.length;
    const rowY = (i: number) => box.y0 + ((i + 0.5) * box.h) / (rows + 2);

    g.strokeStyle = CS.axis;
    g.strokeRect(box.x0, box.y0, box.w, box.h);
    g.strokeStyle = CS.faint;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(xs(0), box.y0);
    g.lineTo(xs(0), box.y1);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = CS.grid;
    for (let i = 0; i <= 4; i += 1) {
      const x = box.x0 + (box.w * i) / 4;
      g.beginPath();
      g.moveTo(x, box.y0);
      g.lineTo(x, box.y1);
      g.stroke();
      g.fillStyle = CS.faint;
      g.font = font(false, 9);
      g.textAlign = 'center';
      g.fillText(fmt(lo + (i / 4) * (hi - lo), 2), x, box.y1 + 13);
    }
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 10);
    g.textAlign = 'center';
    g.fillText(this.zh ? '效应量' : 'effect size', (box.x0 + box.x1) / 2, box.y1 + 28);

    const maxWeight = Math.max(...r.random.weightPct);
    studies.forEach((s, i) => {
      const y = rowY(i);
      const half = 1.96 * s.se;
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 9.5);
      g.textAlign = 'right';
      g.fillText(s.study.slice(0, 18), box.x0 - 52, y + 3);
      g.strokeStyle = CS.blue;
      g.beginPath();
      g.moveTo(xs(s.effect - half), y);
      g.lineTo(xs(s.effect + half), y);
      g.stroke();
      const size = 3 + 6 * Math.sqrt((r.random.weightPct[i] ?? 0) / Math.max(1e-9, maxWeight));
      g.fillStyle = CS.blue;
      g.fillRect(xs(s.effect) - size / 2, y - size / 2, size, size);
      g.fillStyle = CS.faint;
      g.textAlign = 'left';
      g.fillText(fmt(s.effect, 2), box.x1 + 8, y + 3);
    });
    // Pooled diamond.
    const yP = rowY(rows);
    g.fillStyle = 'rgba(255,209,102,0.9)';
    g.beginPath();
    g.moveTo(xs(pooled.lo), yP);
    g.lineTo(xs(pooled.estimate), yP - 6);
    g.lineTo(xs(pooled.hi), yP);
    g.lineTo(xs(pooled.estimate), yP + 6);
    g.closePath();
    g.fill();
    g.fillStyle = CS.amber;
    g.font = font(this.zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(`${this.zh ? '合并' : 'pooled'} ${fmt(pooled.estimate, 3)}`, box.x1 + 8, yP + 3);
    g.save();
    g.translate(box.x0 - 52, box.y0 + 14);
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 9, '600');
    g.fillText(this.zh ? '研究（权重%）' : 'study (weight %)', 0, 0);
    g.restore();

    // Funnel plot on the right.
    const funnel = {
      x0: Math.round(w * 0.70),
      y0: 74,
      x1: w - 30,
      y1: forestH - 26,
      w: 0,
      h: 0,
    };
    funnel.w = funnel.x1 - funnel.x0;
    funnel.h = funnel.y1 - funnel.y0;
    drawCard(g, funnel.x0 - 10, funnel.y0 - 14, funnel.w + 16, funnel.h + 24);
    const maxSe = Math.max(...studies.map((s) => s.se)) * 1.15;
    const zero = xs(pooled.estimate);
    g.strokeStyle = CS.axis;
    g.strokeRect(funnel.x0, funnel.y0, funnel.w, funnel.h);
    g.strokeStyle = CS.faint;
    g.setLineDash([3, 3]);
    const halfWidth = 1.96 * maxSe * (box.w / (hi - lo));
    g.beginPath();
    g.moveTo(zero, funnel.y0);
    g.lineTo(zero - (halfWidth * funnel.w) / box.w, funnel.y1);
    g.moveTo(zero, funnel.y0);
    g.lineTo(zero + (halfWidth * funnel.w) / box.w, funnel.y1);
    g.stroke();
    g.setLineDash([]);
    studies.forEach((s) => {
      const x = xs(s.effect);
      const y = funnel.y0 + (s.se / maxSe) * funnel.h;
      g.fillStyle = 'rgba(120,200,255,0.8)';
      g.beginPath();
      g.arc(x, y, 3.2, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(this.zh ? '漏斗图' : 'funnel plot', funnel.x0, funnel.y0 - 5);
    g.font = font(this.zh, 9);
    g.textAlign = 'right';
    g.fillText(this.zh ? '标准误' : 'SE', funnel.x0 - 4, funnel.y0 + 10);

    drawLegend(g, 34, forestH + 18, [
      { label: this.zh ? '单项研究' : 'study', color: CS.blue },
      { label: this.zh ? '合并效应' : 'pooled', color: CS.amber },
    ], this.zh);
    void fmtMetric;
  }
}

export default function createStatsMetaPlugin(): StatsMetaPlugin {
  return new StatsMetaPlugin();
}
