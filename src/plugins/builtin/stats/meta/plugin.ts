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

interface MetaState {
  model: 'fixed' | 'random';
}

export interface MetaViewResult {
  dataset: MetaDataset;
  result: MetaResult;
}

export class StatsMetaPlugin extends StatsPluginBase<MetaState, MetaViewResult> {
  constructor() {
    // Data plugins start empty — no bundled sample. The canvas shows an
    // import hint until a dataset is loaded.
    super(statsMetaManifest, { model: 'random' }, '');
  }

  protected emptyStateHint(): string {
    return this.zh
      ? '请导入含 study、effect、se 列的 CSV / TSV 数据（至少 2 项研究）。\n可通过「数据」模式或项目文件列表将数据载入到本插件。'
      : 'Import a CSV / TSV dataset with study, effect and se columns (>= 2 studies).\nUse the Data mode or load a file into this plugin from the file list.';
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
    // The x domain must cover the full 95% CI whiskers (effect ± 1.96·se) as
    // well as the pooled interval — otherwise wide-CI rows extrapolate past
    // the frame and cross the value column / funnel plot.
    const effects = studies.flatMap((s) => [s.effect - 1.96 * s.se, s.effect, s.effect + 1.96 * s.se]).concat([pooled.lo, pooled.hi]);
    const eLo = Math.min(...effects);
    const eHi = Math.max(...effects);
    const pad = 0.08 * Math.max(0.2, eHi - eLo);
    const lo = eLo - pad;
    const hi = eHi + pad;
    // Use the full canvas height; the old 0.72·h layout left a dead band
    // below the plots while squeezing the forest rows.
    const box = plotBox(Math.round(w * 0.62), h, 150, 70, 26, 78);
    const xs = xScale(box, lo, hi);
    const rows = studies.length;
    // Leave a header band above the first study row; previously row 0 sat on
    // the "study (weight %)" caption and the two texts overlapped.
    const rowTop = 16;
    const rowY = (i: number) => box.y0 + rowTop + ((i + 0.5) * (box.h - rowTop - 8)) / (rows + 2);

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
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 9, '600');
    g.textAlign = 'right';
    g.fillText(this.zh ? '研究（权重%）' : 'study (weight %)', box.x0 - 8, box.y0 - 8);

    // Funnel plot on the right. It needs its own x scale — reusing the forest
    // `xs` mapped effects into forest coordinates and pushed every point far
    // outside the funnel frame.
    const funnel = {
      x0: Math.round(w * 0.7),
      y0: 78,
      x1: w - 30,
      // Align the funnel bottom with the forest frame so both plots share one
      // baseline instead of the funnel floating high above dead space.
      y1: box.y1,
      w: 0,
      h: 0,
    };
    funnel.w = funnel.x1 - funnel.x0;
    funnel.h = funnel.y1 - funnel.y0;
    drawCard(g, funnel.x0 - 10, funnel.y0 - 18, funnel.w + 16, funnel.h + 54);
    const maxSe = Math.max(...studies.map((s) => s.se)) * 1.15;
    const bound = 1.96 * maxSe;
    const fLo = Math.min(lo, pooled.estimate - bound);
    const fHi = Math.max(hi, pooled.estimate + bound);
    const fxs = xScale(funnel, fLo, fHi);
    g.strokeStyle = CS.axis;
    g.strokeRect(funnel.x0, funnel.y0, funnel.w, funnel.h);
    // Funnel axes: x = effect size, y = standard error (increasing downwards).
    g.font = font(false, 9);
    for (let i = 0; i <= 4; i += 1) {
      const x = funnel.x0 + (funnel.w * i) / 4;
      g.strokeStyle = CS.grid;
      g.beginPath();
      g.moveTo(x, funnel.y0);
      g.lineTo(x, funnel.y1);
      g.stroke();
      g.fillStyle = CS.faint;
      g.textAlign = 'center';
      g.fillText(fmt(fLo + (i / 4) * (fHi - fLo), 2), x, funnel.y1 + 13);
      const y = funnel.y0 + (funnel.h * i) / 4;
      g.strokeStyle = CS.axis;
      g.beginPath();
      g.moveTo(funnel.x0 - 4, y);
      g.lineTo(funnel.x0, y);
      g.stroke();
      g.textAlign = 'right';
      g.fillText(fmt((i / 4) * maxSe, 2), funnel.x0 - 6, y + 3);
    }
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 10);
    g.textAlign = 'center';
    g.fillText(this.zh ? '效应量' : 'effect size', (funnel.x0 + funnel.x1) / 2, funnel.y1 + 28);
    g.save();
    // Sit the rotated title a little further left so it clears the widest
    // right-aligned tick label ("0.20") instead of touching it.
    g.translate(funnel.x0 - 46, (funnel.y0 + funnel.y1) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(this.zh ? '标准误' : 'SE', 0, 0);
    g.restore();

    g.strokeStyle = CS.faint;
    g.setLineDash([3, 3]);
    g.beginPath();
    // Apex at the pooled estimate (SE = 0), widening to ±1.96·SEmax at the
    // bottom of the frame.
    g.moveTo(fxs(pooled.estimate), funnel.y0);
    g.lineTo(fxs(pooled.estimate - bound), funnel.y1);
    g.moveTo(fxs(pooled.estimate), funnel.y0);
    g.lineTo(fxs(pooled.estimate + bound), funnel.y1);
    g.stroke();
    g.setLineDash([]);
    studies.forEach((s) => {
      const x = fxs(s.effect);
      const y = funnel.y0 + (s.se / maxSe) * funnel.h;
      g.fillStyle = 'rgba(120,200,255,0.8)';
      g.beginPath();
      g.arc(x, y, 3.2, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(this.zh ? '漏斗图' : 'funnel plot', funnel.x0, funnel.y0 - 9);

    drawLegend(g, 34, box.y1 + 22, [
      { label: this.zh ? '单项研究' : 'study', color: CS.blue },
      { label: this.zh ? '合并效应' : 'pooled', color: CS.amber },
    ], this.zh);
    void fmtMetric;
  }
}

export default function createStatsMetaPlugin(): StatsMetaPlugin {
  return new StatsMetaPlugin();
}
