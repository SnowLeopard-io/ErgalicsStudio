// ==========================================================================
// Survival Analysis plugin
//
// Canvas: Kaplan-Meier curves (one per group) with 95 % log-log confidence
// bands and median markers. The science strip reports the log-rank test, the
// Cox hazard ratios and Harrell's concordance.
// ==========================================================================

import type { ParamDefinition } from '@/types/plugin';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import type { FigurePanelSpec } from '@/core/figure/sheet';
import { fmtMetric } from '@/core/research/scienceOutput';
import { CS, drawCard, drawLegend, font, plotBox } from '../../shared/cs-utils';
import { fmt, fmtP, xScale, yScale } from '../../shared/stats-utils';
import { StatsPluginBase, type BenchRow, type CsvPayload } from '../shared/plugin-base';
import { statsSurvivalManifest } from './manifest';
import {
  coxPH,
  kaplanMeier,
  logRank,
  parseSurvival,
  runSurvivalBenchmark,
  type CoxResult,
  type KmCurve,
  type LogRankResult,
  type SurvivalDataset,
} from './kernel';
import { survivalFigurePanels } from './figure';

interface SurvState {
  conf: number;
  showCox: boolean;
}

export interface SurvViewResult {
  dataset: SurvivalDataset;
  curves: KmCurve[];
  logRankResult: LogRankResult | null;
  cox: CoxResult | null;
}

export class StatsSurvivalPlugin extends StatsPluginBase<SurvState, SurvViewResult> {
  constructor() {
    // Data plugins start empty — no bundled sample. The canvas shows an
    // import hint until a dataset is loaded.
    super(statsSurvivalManifest, { conf: 0.95, showCox: true }, '');
  }

  protected emptyStateHint(): string {
    return this.zh
      ? '请导入含 time、event、group 列的 CSV / TSV 生存数据。\n可通过「数据」模式或项目文件列表将数据载入到本插件。'
      : 'Import a CSV / TSV survival dataset with time, event and group columns.\nUse the Data mode or load a file into this plugin from the file list.';
  }

  protected stateParams(): ParamDefinition[] {
    return [
      this.rangeParam('conf', 'Confidence level', '置信水平', this.state.conf, 0.8, 0.99, 0.01),
      this.checkParam('showCox', 'Fit Cox model', '拟合 Cox 模型', this.state.showCox),
    ];
  }

  protected updateState(params: Record<string, unknown>): boolean {
    let dirty = false;
    if (typeof params.conf === 'number' && Number.isFinite(params.conf)) {
      const conf = Math.min(0.99, Math.max(0.8, params.conf));
      if (conf !== this.state.conf) {
        this.state.conf = conf;
        dirty = true;
      }
    }
    if (typeof params.showCox === 'boolean' && params.showCox !== this.state.showCox) {
      this.state.showCox = params.showCox;
      dirty = true;
    }
    return dirty;
  }

  protected computeResult(): SurvViewResult | null {
    const dataset = parseSurvival(this.text);
    if (dataset.time.length < 4) return null;
    const labels = dataset.groups ? [...new Set(dataset.groups)].sort() : ['all'];
    const curves = labels.map((label) =>
      dataset.groups
        ? kaplanMeier(
            dataset.time.filter((_, i) => dataset.groups![i] === label),
            dataset.event.filter((_, i) => dataset.groups![i] === label),
            label,
            this.state.conf,
          )
        : kaplanMeier(dataset.time, dataset.event, 'all', this.state.conf),
    );
    const logRankResult = dataset.groups ? logRank(dataset.time, dataset.event, dataset.groups) : null;
    const cox = this.state.showCox && dataset.covariates
      ? coxPH(dataset.time, dataset.event, dataset.covariates.rows, dataset.covariates.names)
      : null;
    return { dataset, curves, logRankResult, cox };
  }

  protected metrics(view: SurvViewResult): ScienceMetric[] {
    const metrics: ScienceMetric[] = [];
    view.curves.slice(0, 3).forEach((c) => {
      metrics.push({
        key: `median-${c.label}`,
        label: this.zh ? `中位生存 · ${c.label}` : `Median · ${c.label}`,
        value: Number.isFinite(c.median) ? fmt(c.median, 2) : this.zh ? '未达到' : 'not reached',
        hint: this.zh ? `${c.events} 个事件，${c.censored} 个删失` : `${c.events} events, ${c.censored} censored`,
      });
    });
    const lr = view.logRankResult;
    metrics.push({
      key: 'logrank',
      label: 'Log-rank χ²',
      value: lr ? fmt(lr.chi2, 3) : '—',
      severity: lr ? (lr.p < 0.05 ? 'ok' : 'info') : 'info',
      hint: lr ? `df=${lr.df} · p=${fmtP(lr.p)}` : (this.zh ? '需要分组列' : 'needs a group column'),
    });
    const cox = view.cox;
    if (cox) {
      cox.terms.slice(0, 2).forEach((t) => {
        metrics.push({
          key: `hr-${t.name}`,
          label: `HR ${t.name}`,
          value: `${fmt(t.hr, 3)} [${fmt(t.lo, 2)}, ${fmt(t.hi, 2)}]`,
          severity: t.p < 0.05 ? 'ok' : 'info',
          hint: `β=${fmt(t.beta, 3)} · z=${fmt(t.z, 2)} · p=${fmtP(t.p)}`,
        });
      });
      metrics.push({
        key: 'concordance',
        label: "Harrell's C",
        value: fmt(cox.concordance, 4),
        severity: cox.concordance > 0.7 ? 'ok' : 'info',
        hint: this.zh ? `${cox.events} 个事件，${cox.iterations} 次迭代` : `${cox.events} events, ${cox.iterations} iterations`,
      });
    }
    return metrics;
  }

  protected benchmark(): BenchRow[] {
    const labels: Record<string, [string, string]> = {
      'km-hand-product': ['KM product-limit', 'KM 乘积极限'],
      'logrank-computable': ['Log-rank statistic', 'Log-rank 统计量'],
      'cox-hr-recovery': ['Cox HR recovery', 'Cox 风险比回收'],
    };
    return runSurvivalBenchmark().map((b) => ({
      id: b.id,
      labelEn: labels[b.id]?.[0] ?? b.id,
      labelZh: labels[b.id]?.[1] ?? b.id,
      passed: b.passed,
      value: b.relErr < 1e-3 ? b.relErr.toExponential(2) : fmt(b.relErr, 6),
      detail: b.detail,
    }));
  }

  protected csv(view: SurvViewResult): CsvPayload {
    return {
      name: 'kaplan-meier',
      header: ['group', 'time', 'n_risk', 'events', 'survival', 'se', 'lo', 'hi'],
      rows: view.curves.flatMap((c) =>
        c.points.map((p) => [c.label, p.time, p.nRisk, p.events, p.survival, p.se, p.lo, p.hi]),
      ),
    };
  }

  protected figurePanels(view: SurvViewResult): FigurePanelSpec[] {
    return survivalFigurePanels(view);
  }

  protected figureTitle() {
    return { zh: '生存分析 · KM 曲线与风险比', en: 'Survival Analysis · KM Curves & Hazard Ratios' };
  }

  protected figureCaption(view: SurvViewResult) {
    const lr = view.logRankResult;
    return {
      zh: `生存分析（n=${view.dataset.time.length}，${view.dataset.event.filter(Boolean).length} 个事件）：${view.curves.length} 条 KM 曲线；${lr ? `log-rank χ²=${fmt(lr.chi2, 3)}，p=${fmtP(lr.p)}` : '未分组'}；${view.cox ? `Cox C=${fmt(view.cox.concordance, 3)}` : '未拟合 Cox'}。`,
      en: `Survival analysis (n=${view.dataset.time.length}, ${view.dataset.event.filter(Boolean).length} events): ${view.curves.length} KM curves; ${lr ? `log-rank chi2=${fmt(lr.chi2, 3)}, p=${fmtP(lr.p)}` : 'no groups'}; ${view.cox ? `Cox C=${fmt(view.cox.concordance, 3)}` : 'no Cox fit'}.`,
    };
  }

  protected title(): string {
    return this.zh ? '生存分析' : 'Survival Analysis';
  }

  protected subtitle(): string {
    const d = parseSurvival(this.text);
    return this.zh
      ? `${d.time.length} 个观测 · ${d.event.filter(Boolean).length} 个事件${d.groups ? ` · 分组 ${d.groupName}` : ''}${d.covariates ? ` · ${d.covariates.names.length} 个协变量` : ''}`
      : `${d.time.length} observations · ${d.event.filter(Boolean).length} events${d.groups ? ` · group ${d.groupName}` : ''}${d.covariates ? ` · ${d.covariates.names.length} covariates` : ''}`;
  }

  protected footnote(): string {
    return this.zh
      ? '阴影为 log-log 置信带，虚线为中位生存期；删失观测以竖线标出。Cox 模型采用 Breslow 结处理。'
      : 'Shaded ribbons are log-log confidence bands, dashed lines mark median survival; censored observations get tick marks. Cox uses Breslow ties.';
  }

  protected drawBody(g: CanvasRenderingContext2D, w: number, h: number, view: SurvViewResult | null): void {
    if (!view) {
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 12);
      g.textAlign = 'center';
      g.fillText(this.zh ? '需要 time + event 列（可选 group / 协变量）。' : 'Need time + event columns (optional group / covariates).', w / 2, h / 2);
      return;
    }
    const curves = view.curves;
    const maxT = Math.max(...curves.flatMap((c) => c.points.map((p) => p.time)), 1);
    // Keep the KM panel in the upper ~60 % of the canvas. The old call passed
    // `h * 0.72` as the canvas height and `h * 0.62` as the bottom margin, which
    // collapsed the KM box to its 30 px minimum and left the Cox strip to fill
    // the rest of the view.
    const box = plotBox(w, h, 66, 78, 30, Math.round(h * 0.4));
    const xs = xScale(box, 0, maxT * 1.04);
    const ys = yScale(box, 0, 1);
    const palette = [CS.blue, CS.amber, CS.green, CS.violet, CS.pink, CS.cyan];

    g.strokeStyle = CS.axis;
    g.strokeRect(box.x0, box.y0, box.w, box.h);
    g.strokeStyle = CS.grid;
    for (let i = 0; i <= 5; i += 1) {
      const y = box.y0 + (box.h * i) / 5;
      g.beginPath();
      g.moveTo(box.x0, y);
      g.lineTo(box.x1, y);
      g.stroke();
      g.fillStyle = CS.faint;
      g.font = font(false, 9);
      g.textAlign = 'right';
      g.fillText(fmt(1 - i / 5, 1), box.x0 - 6, y + 3);
    }
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 10);
    g.textAlign = 'center';
    g.fillText(this.zh ? '时间' : 'time', (box.x0 + box.x1) / 2, box.y1 + 16);
    g.save();
    g.translate(18, (box.y0 + box.y1) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText('S(t)', 0, 0);
    g.restore();

    const legend: Array<{ label: string; color: string }> = [];
    curves.forEach((curve, ci) => {
      const color = palette[ci % palette.length]!;
      legend.push({ label: `${curve.label} (n=${curve.points[0]?.nRisk ?? 0})`, color });
      // Confidence ribbon.
      g.fillStyle = `${color}22`;
      g.beginPath();
      curve.points.forEach((p, i) => {
        const x = xs(p.time);
        const y = ys(p.hi);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      for (let i = curve.points.length - 1; i >= 0; i -= 1) {
        const p = curve.points[i]!;
        g.lineTo(xs(p.time), ys(p.lo));
      }
      g.closePath();
      g.fill();
      // Step curve.
      g.strokeStyle = color;
      g.lineWidth = 1.8;
      g.beginPath();
      curve.points.forEach((p, i) => {
        const x = xs(p.time);
        const y = ys(p.survival);
        if (i === 0) g.moveTo(x, y);
        else {
          g.lineTo(x, ys(curve.points[i - 1]!.survival));
          g.lineTo(x, y);
        }
      });
      g.stroke();
      g.lineWidth = 1;
      if (Number.isFinite(curve.median)) {
        g.strokeStyle = color;
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(xs(curve.median), box.y0);
        g.lineTo(xs(curve.median), ys(0.5));
        g.lineTo(box.x0, ys(0.5));
        g.stroke();
        g.setLineDash([]);
      }
      // Censor ticks.
      g.strokeStyle = color;
      curve.points.forEach((p) => {
        if (p.events === 0 && p.time > 0) {
          g.beginPath();
          g.moveTo(xs(p.time), ys(p.survival) - 4);
          g.lineTo(xs(p.time), ys(p.survival) + 4);
          g.stroke();
        }
      });
    });
    drawLegend(g, box.x0 + 8, box.y0 + 12, legend, this.zh);

    // Cox hazard-ratio panel on the right / below.
    const cox = view.cox;
    // Clear the KM x-axis title (drawn at box.y1 + 16) with a comfortable gap
    // before the Cox card and its own heading.
    const panelY = box.y1 + 50;
    const panelH = Math.max(44, h - panelY - 30);
    if (cox && cox.terms.length > 0) {
      const rows = cox.terms.slice(0, 5);
      const panelX = 66;
      const panelW = w - panelX - 34;
      drawCard(g, panelX - 12, panelY - 12, panelW + 18, panelH + 12);
      const lo = Math.min(...rows.map((t) => Math.min(t.lo, 0.5)), 0.5);
      const hi = Math.max(...rows.map((t) => Math.max(t.hi, 2)), 2);
      const logLo = Math.log(lo);
      const logHi = Math.log(hi);
      const xAt = (v: number) => panelX + 120 + ((Math.log(v) - logLo) / (logHi - logLo)) * (panelW - 170);
      g.strokeStyle = CS.faint;
      g.beginPath();
      g.moveTo(xAt(1), panelY);
      g.lineTo(xAt(1), panelY + panelH);
      g.stroke();
      rows.forEach((t, i) => {
        const y = panelY + 10 + (i * Math.max(14, panelH - 14)) / Math.max(1, rows.length);
        g.fillStyle = CS.dim;
        g.font = font(this.zh, 9.5);
        g.textAlign = 'right';
        g.fillText(t.name.slice(0, 12), panelX + 110, y + 3);
        g.strokeStyle = CS.amber;
        g.beginPath();
        g.moveTo(xAt(t.lo), y);
        g.lineTo(xAt(t.hi), y);
        g.stroke();
        g.fillStyle = t.p < 0.05 ? CS.amber : CS.dim;
        g.beginPath();
        g.arc(xAt(t.hr), y, 3.2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = CS.faint;
        g.textAlign = 'left';
        g.fillText(fmt(t.hr, 2), xAt(t.hi) + 5, y + 3);
      });
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 10, '600');
      g.textAlign = 'left';
      g.fillText(this.zh ? 'Cox 风险比 (95% CI)' : 'Cox hazard ratios (95% CI)', panelX, panelY - 14);
    }
    void fmtMetric;
  }
}

export default function createStatsSurvivalPlugin(): StatsSurvivalPlugin {
  return new StatsSurvivalPlugin();
}
