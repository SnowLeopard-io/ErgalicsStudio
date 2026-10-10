// ==========================================================================
// mats-mech — tensile stress-strain analysis laboratory
//
// A 2-D scientific workbench: draws the engineering stress-strain curve with
// the elastic line, 0.2 % offset line, and annotated yield / UTS / fracture
// points. Publishes the full tensile-property index set (E, σ_y, UTS, ε,
// Hollomon n, resilience, toughness) to the science-output strip.
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
import { matsMechManifest } from './manifest';
import { mechFigurePanels } from './figure';
import { analyseTensile, linreg, parseStressStrain, type SSPoint, type TensileResult } from './kernel';

export { matsMechManifest } from './manifest';

interface State {
  showOffset: boolean;
  showHollomon: boolean;
}

export class MatsMechPlugin implements Plugin {
  readonly manifest = matsMechManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private data: SSPoint[] | null = null;
  private result: TensileResult | null = null;
  private state: State = { showOffset: true, showHollomon: false };

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
        key: 'showOffset',
        label: '0.2% offset line',
        labelI18n: { 'zh-CN': '0.2% 偏置线', 'en-US': '0.2% offset line' },
        type: 'checkbox',
        value: this.state.showOffset,
      },
      {
        key: 'showHollomon',
        label: 'Hollomon log-log',
        labelI18n: { 'zh-CN': 'Hollomon 双对数', 'en-US': 'Hollomon log-log' },
        type: 'checkbox',
        value: this.state.showHollomon,
        hint: this.zh ? 'σ=K·εⁿ 的对数线性视图' : 'log-log view of σ=K·εⁿ',
      },
      actionButton('exportCsv', 'Export curve CSV', '导出曲线 CSV'),
      actionButton('exportReport', 'Export report CSV', '导出报告 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let redraw = false;
    if (typeof params.showOffset === 'boolean' && params.showOffset !== this.state.showOffset) {
      this.state.showOffset = params.showOffset;
      redraw = true;
    }
    if (typeof params.showHollomon === 'boolean' && params.showHollomon !== this.state.showHollomon) {
      this.state.showHollomon = params.showHollomon;
      redraw = true;
    }
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
    const ok = ['.csv', '.tsv', '.dat', '.txt', '.json'].some((e) => low.endsWith(e));
    if (!ok) {
      notify(this.api, 'warning', 'Mechanical plugin accepts strain,stress curves (.csv/.dat/.json).', '力学插件接受 应力,应变 曲线 (.csv/.dat/.json)。');
      return;
    }
    const text = await file.text();
    const pts = parseStressStrain(text);
    if (pts.length < 5) {
      notify(this.api, 'warning', 'Need ≥5 (strain, stress) rows.', '至少需要 5 行 (应变, 应力) 数据。');
      return;
    }
    this.data = pts;
    this.result = analyseTensile(pts);
    if (this.result) this.publishScience();
    else clearScienceOutputs(this.manifest.id);
    notify(
      this.api,
      'success',
      `Loaded ${pts.length} points; E=${this.result?.youngsModulus.toFixed(1) ?? '?'} GPa, UTS=${this.result?.ultimateTensile.toFixed(1) ?? '?'} MPa`,
      `已加载 ${pts.length} 个数据点；E=${this.result?.youngsModulus.toFixed(1) ?? '?'} GPa，σ_UTS=${this.result?.ultimateTensile.toFixed(1) ?? '?'} MPa`,
    );
    this.draw();
  }

  private publishScience() {
    if (!this.result) return;
    const r = this.result;
    const metrics: ScienceMetric[] = [
      { key: 'E', label: this.zh ? '杨氏模量 E' : "Young's modulus E", value: fmtMetric(r.youngsModulus, 4), unit: 'GPa', severity: 'ok' },
      { key: 'sy', label: this.zh ? '屈服强度 σ₀.₂' : 'Yield σ₀.₂', value: fmtMetric(r.yieldStrength02, 4), unit: 'MPa', severity: 'ok' },
      { key: 'uts', label: this.zh ? '抗拉强度 UTS' : 'UTS', value: fmtMetric(r.ultimateTensile, 4), unit: 'MPa', severity: 'ok' },
      { key: 'elong', label: this.zh ? '断后伸长率' : 'Elongation', value: fmtMetric(r.elongation, 4), unit: '%', severity: 'info' },
      { key: 'unif', label: this.zh ? '均匀伸长' : 'Uniform ε', value: fmtMetric(r.uniformElongation, 4), severity: 'info' },
      { key: 'n', label: this.zh ? '硬化指数 n' : 'Hollomon n', value: Number.isFinite(r.hollomonN) ? fmtMetric(r.hollomonN, 4) : '—', severity: Number.isFinite(r.hollomonN) ? 'ok' : 'warn' },
      { key: 'K', label: this.zh ? '强度系数 K' : 'Hollomon K', value: Number.isFinite(r.hollomonK) ? fmtMetric(r.hollomonK, 4) : '—', unit: 'MPa', severity: 'info' },
      { key: 'resil', label: this.zh ? '弹性比能' : 'Resilience', value: fmtMetric(r.resilience, 4), unit: 'MJ/m³', severity: 'info' },
      { key: 'tough', label: this.zh ? '断裂韧性' : 'Toughness', value: fmtMetric(r.toughness, 4), unit: 'MJ/m³', severity: 'info' },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportCurveCsv() {
    if (!this.data) {
      notify(this.api, 'warning', 'No curve to export.', '暂无曲线可导出。');
      return;
    }
    exportRowsCsv(this.api, 'stress-strain', ['strain_mm_mm', 'stress_MPa'], this.data.map((p) => [p.strain.toExponential(5), p.stress.toFixed(4)]));
  }

  private exportReportCsv() {
    if (!this.result) {
      notify(this.api, 'warning', 'No analysis to export.', '暂无分析结果可导出。');
      return;
    }
    const r = this.result;
    const rows: Array<Array<string | number>> = [
      ['youngs_modulus_GPa', r.youngsModulus.toFixed(4)],
      ['yield_strength_0.2pct_MPa', r.yieldStrength02.toFixed(4)],
      ['ultimate_tensile_MPa', r.ultimateTensile.toFixed(4)],
      ['fracture_stress_MPa', r.fractureStress.toFixed(4)],
      ['elongation_pct', r.elongation.toFixed(4)],
      ['uniform_elongation', r.uniformElongation.toFixed(6)],
      ['hollomon_n', Number.isFinite(r.hollomonN) ? r.hollomonN.toFixed(4) : ''],
      ['hollomon_K_MPa', Number.isFinite(r.hollomonK) ? r.hollomonK.toFixed(4) : ''],
      ['hollomon_R2', Number.isFinite(r.hollomonR2) ? r.hollomonR2.toFixed(4) : ''],
      ['resilience_MJ_m3', r.resilience.toFixed(4)],
      ['toughness_MJ_m3', r.toughness.toFixed(4)],
    ];
    exportRowsCsv(this.api, 'tensile-report', ['property', 'value'], rows);
  }

  private async sendToFigure(): Promise<void> {
    if (!this.data || !this.result) {
      notify(this.api, 'warning', 'No curve yet — load a dataset first.', '暂无曲线 — 请先加载数据。');
      return;
    }
    const r = this.result;
    const n = Number.isFinite(r.hollomonN) ? r.hollomonN.toFixed(3) : '—';
    const caption: Bilingual = {
      zh: `拉伸分析：E=${r.youngsModulus.toFixed(1)} GPa，σ₀.₂=${r.yieldStrength02.toFixed(1)} MPa，UTS=${r.ultimateTensile.toFixed(1)} MPa，伸长率 ${r.elongation.toFixed(1)}%，Hollomon n=${n}。`,
      en: `Tensile analysis: E=${r.youngsModulus.toFixed(1)} GPa, σ₀.₂=${r.yieldStrength02.toFixed(1)} MPa, UTS=${r.ultimateTensile.toFixed(1)} MPa, elongation ${r.elongation.toFixed(1)}%, Hollomon n=${n}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '应力-应变分析', en: 'Stress–Strain Analysis' },
      caption,
      mechFigurePanels({ data: this.data, result: r }),
    );
  }

  // ---- rendering -----------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    if (!this.data || this.data.length < 5) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No stress-strain curve loaded',
        titleZh: '尚未载入应力-应变曲线',
        hint: 'Load a strain,stress curve (.csv / .dat / .json) via the sample bar or Open File.',
        hintZh: '通过顶部「示例数据」或「打开文件」载入 应变,应力 曲线。',
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

    // If Hollomon view requested, switch to log-log.
    if (this.state.showHollomon) {
      this.drawHollomon(g, canvas, W, H, padL, padR, padT, padB, plotW, plotH, zh);
      return;
    }

    const strains = this.data.map((p) => p.strain);
    const stresses = this.data.map((p) => p.stress);
    let eMin = 0;
    let eMax = Math.max(...strains) * 1.05;
    let sMin = 0;
    let sMax = Math.max(...stresses) * 1.1;
    if (eMax <= 0) eMax = 1;
    if (sMax <= 0) sMax = 1;
    const sx = (e: number) => padL + ((e - eMin) / (eMax - eMin)) * plotW;
    const sy = (s: number) => padT + plotH - ((s - sMin) / (sMax - sMin || 1)) * plotH;

    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, W, H);

    // Grid
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.textAlign = 'center';
    const eStep = niceStep((eMax - eMin) / 8);
    for (let e = eMin; e <= eMax + 1e-9; e += eStep) {
      const x = sx(e);
      g.beginPath();
      g.moveTo(x, padT);
      g.lineTo(x, padT + plotH);
      g.stroke();
      g.fillText(e.toFixed(3), x, padT + plotH + 16);
    }
    g.textAlign = 'right';
    const sStep = niceStep(sMax / 6);
    for (let s = 0; s <= sMax; s += sStep) {
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
    g.fillText(zh ? '工程应变 ε (mm/mm)' : 'Engineering strain ε', padL + plotW / 2, H - 10);
    g.save();
    g.translate(14, padT + plotH / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(zh ? '工程应力 σ (MPa)' : 'Stress σ (MPa)', 0, 0);
    g.restore();

    // Curve
    g.strokeStyle = '#5dd0a8';
    g.lineWidth = 1.6;
    g.beginPath();
    this.data.forEach((p, i) => {
      const x = sx(p.strain);
      const y = sy(p.stress);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();

    // Elastic line (regression)
    if (this.result) {
      const r = this.result;
      const seg = this.data.slice(r.elasticStart, r.elasticEnd);
      if (seg.length >= 2) {
        const { slope, intercept } = linreg(seg.map((p) => ({ x: p.strain, y: p.stress })));
        if (Number.isFinite(slope)) {
          const e0 = seg[0]!.strain;
          const e1 = seg[seg.length - 1]!.strain;
          g.strokeStyle = 'rgba(122, 215, 255, 0.85)';
          g.lineWidth = 1.2;
          g.setLineDash([5, 4]);
          g.beginPath();
          g.moveTo(sx(e0), sy(intercept + slope * e0));
          g.lineTo(sx(e1), sy(intercept + slope * e1));
          g.stroke();
          g.setLineDash([]);
          // 0.2% offset line (parallel, shifted by +0.002)
          if (this.state.showOffset) {
            const off0 = e0 + 0.002;
            const off1 = Math.min(e1 + 0.002, eMax);
            g.strokeStyle = 'rgba(255, 209, 102, 0.8)';
            g.beginPath();
            g.moveTo(sx(off0), sy(intercept + slope * off0));
            g.lineTo(sx(off1), sy(intercept + slope * off1));
            g.stroke();
            g.fillStyle = 'rgba(255, 209, 102, 0.9)';
            g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
            g.textAlign = 'left';
            g.fillText('σ₀.₂', sx(off1) + 4, sy(intercept + slope * off1) - 4);
          }
        }
      }
      // Annotated points: yield, UTS, fracture
      const mark = (i: number, color: string, label: string) => {
        if (i < 0 || i >= this.data!.length) return;
        const p = this.data![i]!;
        const x = sx(p.strain);
        const y = sy(p.stress);
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = color;
        g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
        g.textAlign = 'left';
        g.fillText(label, x + 6, y - 4);
      };
      mark(r.yieldIdx, '#ffd166', zh ? '屈服' : 'Yield');
      mark(r.utsIdx, '#ff6b6b', zh ? 'UTS' : 'UTS');
      mark(this.data.length - 1, '#b48cff', zh ? '断裂' : 'Fracture');
    }

    // Border
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 1;
    g.strokeRect(padL, padT, plotW, plotH);
  }

  private drawHollomon(
    g: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    W: number,
    H: number,
    padL: number,
    _padR: number,
    padT: number,
    _padB: number,
    plotW: number,
    plotH: number,
    zh: boolean,
  ) {
    const r = this.result;
    if (!r) return;
    // Build plastic points in log-log space.
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = r.yieldIdx; i <= r.utsIdx && i < this.data!.length; i += 1) {
      const p = this.data![i]!;
      const ep = p.strain - p.stress / (r.youngsModulus * 1000 || 1);
      if (ep > 1e-6 && p.stress > 0) pts.push({ x: Math.log(ep), y: Math.log(p.stress) });
    }
    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, W, H);
    if (pts.length < 3) {
      g.fillStyle = 'rgba(160,175,195,0.9)';
      g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(zh ? '塑性区不足，无法拟合 Hollomon' : 'Plastic region too small for Hollomon fit', W / 2, H / 2);
      return;
    }
    let xMin = Math.min(...pts.map((p) => p.x));
    let xMax = Math.max(...pts.map((p) => p.x));
    let yMin = Math.min(...pts.map((p) => p.y));
    let yMax = Math.max(...pts.map((p) => p.y));
    const xPad = (xMax - xMin) * 0.08 || 0.2;
    const yPad = (yMax - yMin) * 0.08 || 0.5;
    xMin -= xPad;
    xMax += xPad;
    yMin -= yPad;
    yMax += yPad;
    const sx = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * plotW;
    const sy = (y: number) => padT + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
    // Grid + ticks
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.font = `11px Consolas, monospace`;
    g.textAlign = 'center';
    const xStep = niceStep((xMax - xMin) / 6);
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      g.beginPath();
      g.moveTo(sx(x), padT);
      g.lineTo(sx(x), padT + plotH);
      g.stroke();
      g.fillText(Math.exp(x).toExponential(1), sx(x), padT + plotH + 16);
    }
    // Points
    g.fillStyle = '#5dd0a8';
    for (const p of pts) {
      g.beginPath();
      g.arc(sx(p.x), sy(p.y), 2, 0, Math.PI * 2);
      g.fill();
    }
    // Fit line
    const { slope, intercept } = linreg(pts);
    if (Number.isFinite(slope)) {
      g.strokeStyle = '#ffd166';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(sx(xMin), sy(intercept + slope * xMin));
      g.lineTo(sx(xMax), sy(intercept + slope * xMax));
      g.stroke();
      g.fillStyle = '#ffd166';
      g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'left';
      g.fillText(
        zh ? `n=${slope.toFixed(3)}, K=${Math.exp(intercept).toFixed(1)} MPa` : `n=${slope.toFixed(3)}, K=${Math.exp(intercept).toFixed(1)} MPa`,
        padL + 8,
        padT + 20,
      );
    }
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 1;
    g.strokeRect(padL, padT, plotW, plotH);
    g.fillStyle = 'rgba(210,220,235,0.95)';
    g.font = `12px Consolas, monospace`;
    g.textAlign = 'center';
    g.fillText(zh ? 'log(塑性应变 ε_p)' : 'log(plastic strain ε_p)', padL + plotW / 2, H - 10);
    g.save();
    g.translate(14, padT + plotH / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(zh ? 'log(应力 σ / MPa)' : 'log(stress σ / MPa)', 0, 0);
    g.restore();
    void canvas;
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
  return v.toFixed(2);
}

export default function (): Plugin {
  return new MatsMechPlugin();
}
