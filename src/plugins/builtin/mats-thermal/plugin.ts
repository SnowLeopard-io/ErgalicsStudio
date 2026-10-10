// ==========================================================================
// mats-thermal — DSC / TGA thermal analysis laboratory
//
// A 2-D scientific workbench: draws the temperature / signal curve with the
// estimated baseline, marks each detected transition's onset, peak and end
// temperature, and publishes the enthalpy (DSC) / mass-loss & residual (TGA)
// indices to the science-output strip.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { matsThermalManifest } from './manifest';
import { thermalFigurePanels } from './figure';
import {
  analyseThermal,
  derivative,
  estimateBaseline,
  parseThermal,
  type ThermalAnalysis,
  type ThermalMode,
  type ThermalPoint,
} from './kernel';

export { matsThermalManifest } from './manifest';

interface State {
  mode: ThermalMode;
  showBaseline: boolean;
  showDtg: boolean;
}

export class MatsThermalPlugin implements Plugin {
  readonly manifest = matsThermalManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private data: ThermalPoint[] | null = null;
  private baseline: number[] = [];
  private analysis: ThermalAnalysis | null = null;
  private state: State = { mode: 'dsc', showBaseline: true, showDtg: false };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'dsc', label: 'DSC (heat flow)', labelI18n: { 'zh-CN': 'DSC（热流）', 'en-US': 'DSC (heat flow)' } },
          { value: 'tga', label: 'TGA (mass)', labelI18n: { 'zh-CN': 'TGA（质量）', 'en-US': 'TGA (mass)' } },
        ],
        value: this.state.mode,
      },
      {
        key: 'showBaseline',
        label: 'Baseline',
        labelI18n: { 'zh-CN': '基线', 'en-US': 'Baseline' },
        type: 'checkbox',
        value: this.state.showBaseline,
      },
      {
        key: 'showDtg',
        label: 'DTG derivative (TGA)',
        labelI18n: { 'zh-CN': 'DTG 导数（TGA）', 'en-US': 'DTG derivative (TGA)' },
        type: 'checkbox',
        value: this.state.showDtg,
      },
      actionButton('exportCsv', 'Export curve CSV', '导出曲线 CSV'),
      actionButton('exportReport', 'Export report CSV', '导出报告 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let recompute = false;
    let redraw = false;
    if (typeof params.mode === 'string' && (params.mode === 'dsc' || params.mode === 'tga') && params.mode !== this.state.mode) {
      this.state.mode = params.mode as ThermalMode;
      recompute = true;
      redraw = true;
    }
    if (typeof params.showBaseline === 'boolean' && params.showBaseline !== this.state.showBaseline) {
      this.state.showBaseline = params.showBaseline;
      redraw = true;
    }
    if (typeof params.showDtg === 'boolean' && params.showDtg !== this.state.showDtg) {
      this.state.showDtg = params.showDtg;
      redraw = true;
    }
    if (recompute) this.recompute();
    if (redraw) this.draw();
    if (actionFired(params, 'exportCsv')) this.exportCurveCsv();
    if (actionFired(params, 'exportReport')) this.exportReportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    const ok = ['.csv', '.tsv', '.dat', '.txt'].some((e) => low.endsWith(e));
    if (!ok) {
      notify(this.api, 'warning', 'Thermal plugin accepts temperature,signal curves (.csv/.dat/.txt).', '热分析插件接受 温度,信号 曲线 (.csv/.dat/.txt)。');
      return;
    }
    const text = await file.text();
    const { mode, pts } = parseThermal(text, this.state.mode);
    if (pts.length < 8) {
      notify(this.api, 'warning', 'Need ≥8 (temperature, signal) rows.', '至少需要 8 行 (温度, 信号) 数据。');
      return;
    }
    this.data = pts;
    this.state.mode = mode;
    this.recompute();
    const tag = mode === 'dsc' ? 'DSC' : 'TGA';
    notify(this.api, 'success', `Loaded ${pts.length} points (${tag}); ${this.analysis?.peaks.length ?? 0} transitions.`, `已加载 ${pts.length} 个数据点（${tag}）；${this.analysis?.peaks.length ?? 0} 个转变。`);
    this.draw();
  }

  private recompute() {
    if (!this.data) {
      this.baseline = [];
      this.analysis = null;
      clearScienceOutputs(this.manifest.id);
      return;
    }
    this.baseline = estimateBaseline(this.data, this.state.mode);
    this.analysis = analyseThermal(this.data, this.state.mode);
    this.publishScience();
  }

  private publishScience() {
    if (!this.analysis) return;
    const a = this.analysis;
    const metrics: ScienceMetric[] = [];
    metrics.push({
      key: 'peaks',
      label: this.zh ? '检出转变数' : 'Transitions',
      value: String(a.peaks.length),
      severity: 'info',
    });
    a.peaks.forEach((p, i) => {
      const lab = this.zh ? `转变 ${i + 1}` : `Transition ${i + 1}`;
      metrics.push(
        {
          key: `onset-${i}`,
          label: `${lab} onset`,
          value: fmtMetric(p.onsetTemp, 4),
          unit: '°C',
          severity: 'ok',
        },
        {
          key: `peak-${i}`,
          label: `${lab} peak`,
          value: fmtMetric(p.peakTemp, 4),
          unit: '°C',
          severity: 'info',
        },
        {
          key: `integral-${i}`,
          label: this.state.mode === 'dsc' ? `${lab} ΔH` : `${lab} mass loss`,
          value: fmtMetric(p.integral, 4),
          unit: this.state.mode === 'dsc' ? 'mW·°C' : '%',
          severity: 'ok',
        },
      );
    });
    if (this.state.mode === 'dsc' && a.totalEnthalpy !== undefined) {
      metrics.push({
        key: 'total-dH',
        label: this.zh ? '总焓变' : 'Total ΔH',
        value: fmtMetric(a.totalEnthalpy, 4),
        unit: 'mW·°C',
        severity: 'info',
      });
    }
    if (this.state.mode === 'tga') {
      if (a.totalMassLoss !== undefined) {
        metrics.push({
          key: 'total-loss',
          label: this.zh ? '总失重' : 'Total mass loss',
          value: fmtMetric(a.totalMassLoss, 4),
          unit: '%',
          severity: 'ok',
        });
      }
      if (a.residualMass !== undefined) {
        metrics.push({
          key: 'residual',
          label: this.zh ? '残重' : 'Residual mass',
          value: fmtMetric(a.residualMass, 4),
          unit: '%',
          severity: 'info',
        });
      }
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportCurveCsv() {
    if (!this.data) {
      notify(this.api, 'warning', 'No curve to export.', '暂无曲线可导出。');
      return;
    }
    exportRowsCsv(this.api, 'thermal-curve', ['temperature_C', 'signal', 'baseline'], this.data.map((p, i) => [p.temperature.toFixed(3), p.signal.toFixed(4), (this.baseline[i] ?? 0).toFixed(4)]));
  }

  private exportReportCsv() {
    if (!this.analysis || this.analysis.peaks.length === 0) {
      notify(this.api, 'warning', 'No transitions to export.', '暂无转变可导出。');
      return;
    }
    const rows = this.analysis.peaks.map((p, i) => [i + 1, p.onsetTemp.toFixed(3), p.peakTemp.toFixed(3), p.endTemp.toFixed(3), p.integral.toFixed(4)]);
    exportRowsCsv(this.api, 'thermal-report', ['transition', 'onset_C', 'peak_C', 'end_C', 'integral'], rows);
  }

  private async sendToFigure(): Promise<void> {
    if (!this.data || this.data.length < 5 || !this.analysis) {
      notify(this.api, 'warning', 'No curve yet — load a dataset first.', '暂无曲线 — 请先加载数据。');
      return;
    }
    const a = this.analysis;
    const mode = this.state.mode;
    const peaks = a.peaks.length;
    const total = mode === 'dsc' ? a.totalEnthalpy : a.totalMassLoss;
    const residual = a.residualMass;
    const totalStr = total !== undefined ? total.toFixed(2) : '—';
    const caption: Bilingual = mode === 'dsc'
      ? {
          zh: `DSC 分析：${peaks} 个转变，总焓变 ${totalStr} mW·°C。`,
          en: `DSC analysis: ${peaks} transitions, total ΔH ${totalStr} mW·°C.`,
        }
      : {
          zh: `TGA 分析：${peaks} 个失重台阶，总失重 ${totalStr}%${residual !== undefined ? `，残重 ${residual.toFixed(1)}%` : ''}。`,
          en: `TGA analysis: ${peaks} mass-loss steps, total loss ${totalStr}%${residual !== undefined ? `, residual ${residual.toFixed(1)}%` : ''}.`,
        };
    await pushPanelsToFigure(
      this.api,
      { zh: mode === 'dsc' ? 'DSC 热分析' : 'TGA 热分析', en: mode === 'dsc' ? 'DSC Analysis' : 'TGA Analysis' },
      caption,
      thermalFigurePanels({ data: this.data, baseline: this.baseline, analysis: a, mode }),
    );
  }

  // ---- rendering -----------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    if (!this.data || this.data.length < 5) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No thermal curve loaded',
        titleZh: '尚未载入热分析曲线',
        hint: 'Load a temperature,signal curve (.csv / .dat) via the sample bar or Open File.',
        hintZh: '通过顶部「示例数据」或「打开文件」载入 温度,信号 曲线。',
      });
      return;
    }
    const W = canvas.clientWidth || 760;
    const H = canvas.clientHeight || 420;
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = this.zh;

    const padL = 56;
    const padR = 16;
    const padT = 14;
    const padB = 50;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const temps = this.data.map((p) => p.temperature);
    const sigs = this.data.map((p) => p.signal);
    let tMin = Math.min(...temps);
    let tMax = Math.max(...temps);
    let sMin = Math.min(...sigs);
    let sMax = Math.max(...sigs);
    // Include baseline in range if shown.
    if (this.state.showBaseline) {
      for (const b of this.baseline) {
        if (b < sMin) sMin = b;
        if (b > sMax) sMax = b;
      }
    }
    const sPad = (sMax - sMin) * 0.08 || 1;
    sMin -= sPad;
    sMax += sPad;
    if (tMax <= tMin) tMax = tMin + 10;
    const sx = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * plotW;
    const sy = (s: number) => padT + plotH - ((s - sMin) / (sMax - sMin || 1)) * plotH;

    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, W, H);

    // Grid
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.textAlign = 'center';
    const tStep = niceStep((tMax - tMin) / 8);
    for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax; t += tStep) {
      const x = sx(t);
      g.beginPath();
      g.moveTo(x, padT);
      g.lineTo(x, padT + plotH);
      g.stroke();
      g.fillText(t.toFixed(0), x, padT + plotH + 16);
    }
    g.textAlign = 'right';
    const sStep = niceStep((sMax - sMin) / 6);
    for (let s = Math.ceil(sMin / sStep) * sStep; s <= sMax; s += sStep) {
      const y = sy(s);
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(padL + plotW, y);
      g.stroke();
      g.fillText(fmtShort(s), padL - 6, y + 4);
    }

    // Axes labels
    g.fillStyle = 'rgba(210,220,235,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(zh ? '温度 (°C)' : 'Temperature (°C)', padL + plotW / 2, H - 10);
    g.save();
    g.translate(14, padT + plotH / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(this.state.mode === 'dsc' ? (zh ? '热流 (mW)' : 'Heat flow (mW)') : (zh ? '质量 (%)' : 'Mass (%)'), 0, 0);
    g.restore();

    // Baseline
    if (this.state.showBaseline && this.baseline.length === this.data.length) {
      g.strokeStyle = 'rgba(122, 215, 255, 0.6)';
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      g.beginPath();
      this.data.forEach((p, i) => {
        const x = sx(p.temperature);
        const y = sy(this.baseline[i]!);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
    }

    // DTG derivative overlay (TGA)
    if (this.state.mode === 'tga' && this.state.showDtg) {
      const dtg = derivative(this.data);
      if (dtg.length > 2) {
        const dMax = Math.max(...dtg.map((d) => Math.abs(d.signal))) || 1;
        g.strokeStyle = 'rgba(255, 107, 107, 0.7)';
        g.lineWidth = 1.1;
        g.beginPath();
        dtg.forEach((d, i) => {
          const x = sx(d.temperature);
          const y = padT + plotH / 2 - (d.signal / dMax) * (plotH * 0.35);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
      }
    }

    // Curve
    g.strokeStyle = '#5dd0a8';
    g.lineWidth = 1.6;
    g.beginPath();
    this.data.forEach((p, i) => {
      const x = sx(p.temperature);
      const y = sy(p.signal);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();

    // Transition markers
    if (this.analysis) {
      for (const p of this.analysis.peaks) {
        const xOn = sx(p.onsetTemp);
        const xPk = sx(p.peakTemp);
        const xEnd = sx(p.endTemp);
        // Onset vertical line
        g.strokeStyle = 'rgba(255, 209, 102, 0.7)';
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(xOn, padT);
        g.lineTo(xOn, padT + plotH);
        g.stroke();
        // Peak marker
        g.setLineDash([]);
        g.fillStyle = '#ff6b6b';
        g.beginPath();
        g.arc(xPk, sy(this.data.find((d) => Math.abs(d.temperature - p.peakTemp) < 1)?.signal ?? p.peakSignal + (this.baseline[0] ?? 0)), 3.5, 0, Math.PI * 2);
        g.fill();
        // End line
        g.strokeStyle = 'rgba(180, 140, 255, 0.6)';
        g.setLineDash([2, 4]);
        g.beginPath();
        g.moveTo(xEnd, padT);
        g.lineTo(xEnd, padT + plotH);
        g.stroke();
        g.setLineDash([]);
        // Labels
        g.fillStyle = 'rgba(255, 209, 102, 0.95)';
        g.font = `9px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
        g.textAlign = 'center';
        g.fillText(`On ${p.onsetTemp.toFixed(1)}`, xOn, padT + 12);
        g.fillStyle = '#ff6b6b';
        g.fillText(`Pk ${p.peakTemp.toFixed(1)}`, xPk, padT + 24);
      }
    }

    // Border
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 1;
    g.strokeRect(padL, padT, plotW, plotH);
  }
}

// ---- helpers ---------------------------------------------------------------

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  let s: number;
  if (f < 1.5) s = 1;
  else if (f < 3) s = 2;
  else if (f < 7) s = 5;
  else s = 10;
  return s * 10 ** exp;
}

function fmtShort(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export default function (): Plugin {
  return new MatsThermalPlugin();
}
