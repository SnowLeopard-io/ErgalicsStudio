// ==========================================================================
// psych-sdt — signal detection theory ROC / d′ workbench
//
// Left canvas panel: analytic ROC (equal-variance model, optional
// unequal-variance σ ratio) against the chance line, with the empirical
// (FAR, HR) operating point. Right panel: noise and signal distributions
// with the decision criterion — drag horizontally anywhere on the canvas to
// move d′. Every redraw republishes d′, β, c and AUC plus the numeric-vs-
// analytic AUC error; uploaded trial data (signal/respond or counts)
// replaces the slider rates.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { sdtFigurePanels } from './figure';
import { sdtManifest } from './manifest';
import {
  aucAnalytic,
  aucNumeric,
  parseSdtData,
  rocCurve,
  rocHrEv,
  rocHrUv,
  runSdtBenchmark,
  sdtMeasures,
  stdNormCdf,
  stdNormPdf,
  stdNormQuantile,
  confusionToRates,
  safeRate,
  type Confusion,
} from './kernel';

export { sdtManifest } from './manifest';

interface State {
  hitRate: number;
  faRate: number;
  sigmaRatio: number;
}

export class SdtPlugin implements Plugin {
  readonly manifest = sdtManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = { hitRate: 0.8, faRate: 0.2, sigmaRatio: 1 };
  private confusion: Confusion | null = null;
  private boundCanvas: HTMLCanvasElement | null = null;
  private dragging = false;
  private dragStartX = 0;
  private dragStartD = 0;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
  }

  async destroy() {
    this.unbindCanvas();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.dragging = false;
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'hitRate',
        label: 'Hit rate',
        labelI18n: { 'zh-CN': '命中率 H', 'en-US': 'Hit rate' },
        type: 'range',
        min: 0.01,
        max: 0.99,
        step: 0.005,
        value: this.state.hitRate,
        hint: this.zh ? '信号 trial 报告“有信号”的比例' : 'proportion of signal trials reported "signal"',
      },
      {
        key: 'faRate',
        label: 'False-alarm rate',
        labelI18n: { 'zh-CN': '虚报率 F', 'en-US': 'False-alarm rate' },
        type: 'range',
        min: 0.01,
        max: 0.99,
        step: 0.005,
        value: this.state.faRate,
      },
      {
        key: 'sigmaRatio',
        label: 'σ ratio s',
        labelI18n: { 'zh-CN': '方差比 s（信号/噪声）', 'en-US': 'σ ratio s (signal/noise)' },
        type: 'range',
        min: 1,
        max: 2,
        step: 0.05,
        value: this.state.sigmaRatio,
        hint: this.zh ? '1 = 等方差模型；>1 为不等方差比模型' : '1 = equal-variance model; >1 = unequal-variance ratio',
      },
      actionButton('benchmark', 'Run benchmark', '运行基准验证'),
      actionButton('exportRoc', 'Export ROC curve', '导出 ROC 曲线'),
      actionButton('clearData', 'Clear uploaded data', '清除已上传数据'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) apply(params[k] as number);
    };
    num('hitRate', (n) => {
      this.state.hitRate = Math.min(0.99, Math.max(0.01, n));
    });
    num('faRate', (n) => {
      this.state.faRate = Math.min(0.99, Math.max(0.01, n));
    });
    num('sigmaRatio', (n) => {
      this.state.sigmaRatio = Math.min(2, Math.max(1, n));
    });
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportRoc')) this.exportRoc();
    if (actionFired(params, 'clearData')) {
      this.confusion = null;
      notify(this.api, 'info', 'Uploaded data cleared — slider rates back in control.', '已清除上传数据——恢复使用滑块比率。');
    }
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv') && !low.endsWith('.txt')) {
      notify(this.api, 'warning', 'SDT plugin accepts CSV/TSV/TXT (signal,respond or counts).', 'SDT 插件接受 CSV/TSV/TXT（signal,respond 或 counts）。');
      return;
    }
    const text = await file.text();
    const conf = parseSdtData(text);
    if (!conf) {
      notify(this.api, 'warning', 'No usable trials/counts found (need signal,respond columns or a counts row).', '未找到可用 trial 或 counts 数据（需 signal,respond 列或 counts 行）。');
      return;
    }
    this.confusion = conf;
    const rates = confusionToRates(conf);
    this.state.hitRate = Math.min(0.99, Math.max(0.01, rates.hitRate));
    this.state.faRate = Math.min(0.99, Math.max(0.01, rates.faRate));
    notify(
      this.api,
      'success',
      `Loaded ${conf.n} trials: H=${this.state.hitRate.toFixed(3)}, F=${this.state.faRate.toFixed(3)}`,
      `已载入 ${conf.n} 个 trial：H=${this.state.hitRate.toFixed(3)}，F=${this.state.faRate.toFixed(3)}`,
    );
    this.draw();
  }

  // ---- derived quantities ------------------------------------------------------

  private currentDprime(): number {
    return sdtMeasures(this.state.hitRate, this.state.faRate).dprime;
  }

  private applyDragDprime(d: number) {
    const dClamped = Math.min(6, Math.max(0.05, d));
    const zf = stdNormQuantile(safeRate(this.state.faRate));
    const hr = stdNormCdf((dClamped + zf) / this.state.sigmaRatio);
    this.state.hitRate = Math.min(0.99, Math.max(0.01, hr));
  }

  // ---- scientific outputs ---------------------------------------------------------

  private publishOutputs() {
    const m = sdtMeasures(this.state.hitRate, this.state.faRate);
    const auc = aucAnalytic(m.dprime, this.state.sigmaRatio);
    const aucNum = aucNumeric(m.dprime, this.state.sigmaRatio);
    const relErr = Math.abs(aucNum - auc) / auc;
    const src = this.confusion
      ? this.zh
        ? `来源：上传数据（n=${this.confusion.n}）`
        : `source: uploaded data (n=${this.confusion.n})`
      : this.zh
        ? '来源：滑块设定'
        : 'source: slider settings';
    const metrics: ScienceMetric[] = [
      { key: 'dprime', label: "d′", value: fmtMetric(m.dprime), severity: 'info', hint: "d′ = z(H) − z(F)" },
      { key: 'beta', label: 'β', value: fmtMetric(m.beta), severity: 'info', hint: this.zh ? 'β = exp((z_F² − z_H²)/2)，>1 保守 <1 宽松' : 'β = exp((z_F² - z_H²)/2); >1 conservative, <1 liberal' },
      { key: 'criterion', label: 'c', value: fmtMetric(m.criterion), severity: 'info', hint: 'c = −(z_H + z_F)/2' },
      {
        key: 'auc',
        label: 'AUC',
        value: fmtMetric(auc),
        severity: 'info',
        hint:
          this.state.sigmaRatio === 1
            ? 'AUC = Φ(d′/√2)（等方差）'
            : `AUC = Φ(d′/√(1+s²)), s=${this.state.sigmaRatio.toFixed(2)}`,
      },
      {
        key: 'auc-err',
        label: 'AUC num err',
        value: fmtMetric(relErr),
        severity: relErr < 1e-4 ? 'ok' : 'warn',
        hint: this.zh ? '|数值积分 − 解析|/|解析|（量化积分对照）' : '|numeric integral - analytic| / |analytic| (quantile-space quadrature cross-check)',
      },
      { key: 'source', label: this.zh ? '数据来源' : 'Source', value: src, severity: 'info' },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const b = runSdtBenchmark();
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-status',
        label: 'Benchmark',
        value: b.pass ? (this.zh ? '全部通过' : 'ALL PASS') : this.zh ? '未通过' : 'FAIL',
        severity: b.pass ? 'ok' : 'error',
        hint: this.zh ? '内嵌 SDT 数值基准（非用户数据）' : 'embedded SDT numerical battery (not user data)',
      },
      {
        key: 'bench-dprime',
        label: "d′(0.8, 0.2)",
        value: `${b.dprime8020.toFixed(6)} (err ${fmtMetric(b.dprime8020Err)})`,
        severity: b.dprime8020Err < 1e-4 ? 'ok' : 'warn',
        hint: this.zh ? '基准 1.6832425 = 2·z(0.8)，判据 < 1e-4' : 'reference 1.6832425 = 2·z(0.8), criterion < 1e-4',
      },
      {
        key: 'bench-q975',
        label: 'Φ⁻¹(0.975)',
        value: `${b.q975.toFixed(7)} (err ${fmtMetric(b.q975Err)})`,
        severity: b.q975Err < 1e-6 ? 'ok' : 'warn',
        hint: this.zh ? '基准 1.959964，判据 < 1e-6（Acklam + Halley）' : 'reference 1.959964, criterion < 1e-6 (Acklam + Halley)',
      },
      {
        key: 'bench-auc',
        label: 'AUC quad err',
        value: fmtMetric(b.aucNumRelErr),
        severity: b.aucNumRelErr < 1e-4 ? 'ok' : 'warn',
        hint: this.zh ? '数值积分 vs Φ(d′/√2)（s=1 与 s=1.5）' : 'numeric integral vs Φ(d′/√2) (s=1 and s=1.5)',
      },
      {
        key: 'bench-extreme',
        label: "d′(0.999, 0.001)",
        value: `${b.extremeDprime.toFixed(6)}`,
        severity: b.extremeStable ? 'ok' : 'warn',
        hint: this.zh ? '极端比率数值稳定性，基准 6.180465' : 'extreme-rate numerical stability, reference 6.180465',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.pass ? 'success' : 'warning',
      `Benchmark ${b.pass ? 'passed' : 'FAILED'}: d′ err ${fmtMetric(b.dprime8020Err)}, Φ⁻¹(0.975) err ${fmtMetric(b.q975Err)}, AUC err ${fmtMetric(b.aucNumRelErr)}`,
      `基准验证${b.pass ? '通过' : '未通过'}：d′ 误差 ${fmtMetric(b.dprime8020Err)}，Φ⁻¹(0.975) 误差 ${fmtMetric(b.q975Err)}，AUC 误差 ${fmtMetric(b.aucNumRelErr)}`,
    );
  }

  private exportRoc() {
    const d = this.currentDprime();
    const rows: Array<Array<number | string>> = rocCurve(d, this.state.sigmaRatio, 220).map((p) => [
      Number(p.far.toFixed(6)),
      Number(p.hr.toFixed(6)),
    ]);
    exportRowsCsv(this.api, 'sdt-roc-curve', ['far', 'hit_rate'], rows);
  }

  private async sendToFigure(): Promise<void> {
    const m = sdtMeasures(this.state.hitRate, this.state.faRate);
    const auc = aucAnalytic(m.dprime, this.state.sigmaRatio);
    const caption: Bilingual = {
      zh: `信号检测论分析：d′=${m.dprime.toFixed(3)}，β=${m.beta.toFixed(3)}，c=${m.criterion.toFixed(3)}，AUC=${auc.toFixed(4)}（H=${this.state.hitRate.toFixed(3)}，F=${this.state.faRate.toFixed(3)}，s=${this.state.sigmaRatio.toFixed(2)}）。`,
      en: `Signal detection analysis: d′=${m.dprime.toFixed(3)}, β=${m.beta.toFixed(3)}, c=${m.criterion.toFixed(3)}, AUC=${auc.toFixed(4)} (H=${this.state.hitRate.toFixed(3)}, F=${this.state.faRate.toFixed(3)}, s=${this.state.sigmaRatio.toFixed(2)}).`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '信号检测论 ROC 分析', en: 'Signal Detection ROC Analysis' },
      caption,
      sdtFigurePanels({
        hitRate: this.state.hitRate,
        faRate: this.state.faRate,
        sigmaRatio: this.state.sigmaRatio,
      }),
    );
  }

  // ---- canvas interaction -----------------------------------------------------------

  private bindCanvas(canvas: HTMLCanvasElement) {
    if (this.boundCanvas === canvas) return;
    this.unbindCanvas();
    this.boundCanvas = canvas;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerUp);
  }

  private unbindCanvas() {
    const c = this.boundCanvas;
    if (!c) return;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerUp);
    this.boundCanvas = null;
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    this.dragging = true;
    this.dragStartX = e.offsetX;
    this.dragStartD = this.currentDprime();
    this.boundCanvas?.setPointerCapture(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const canvas = this.boundCanvas;
    if (!canvas) return;
    // 1/8 of the distribution panel width ≈ one d′ unit.
    const pxPerUnit = Math.max(30, (canvas.clientWidth - 40) / 8);
    this.applyDragDprime(this.dragStartD + (e.offsetX - this.dragStartX) / pxPerUnit);
    this.draw();
  };

  private readonly onPointerUp = () => {
    this.dragging = false;
  };

  // ---- drawing -------------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    this.bindCanvas(canvas);
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const d = this.currentDprime();
    const panelTop = 44;
    const panelH = Math.max(120, canvas.height - 118);
    const rocSize = Math.min(panelH, canvas.width * 0.42);
    this.drawRocPanel(g, 56, panelTop, rocSize, d);
    this.drawDistPanel(g, 56 + rocSize + 32, panelTop, canvas.width - (56 + rocSize + 32) - 20, panelH, d);
    this.drawFooter(g, canvas);
    this.publishOutputs();
  }

  private drawRocPanel(g: CanvasRenderingContext2D, ox: number, oy: number, size: number, d: number) {
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? 'ROC 曲线（解析）与工作点' : 'ROC curve (analytic) & operating point', ox + size / 2, oy - 8);

    const px = (f: number) => ox + size * f;
    const py = (h: number) => oy + size - size * h;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(ox, oy, size, size);
    // chance diagonal
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(px(0), py(0));
    g.lineTo(px(1), py(1));
    g.stroke();
    g.setLineDash([]);

    // equal-variance analytic curve
    const drawCurve = (fn: (far: number) => number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      const n = 160;
      for (let i = 0; i <= n; i += 1) {
        const far = (i / n) * 0.999 + 0.0005;
        const h = Math.min(1, Math.max(0, fn(far)));
        if (i === 0) g.moveTo(px(far), py(h));
        else g.lineTo(px(far), py(h));
      }
      g.stroke();
    };
    drawCurve((f) => rocHrEv(d, f), 'rgba(110,190,255,0.95)');
    if (this.state.sigmaRatio !== 1) {
      drawCurve((f) => rocHrUv(d, f, this.state.sigmaRatio), 'rgba(190,140,250,0.95)');
    }

    // operating point
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(px(this.state.faRate), py(this.state.hitRate), 4, 0, Math.PI * 2);
    g.fill();

    g.font = '10px Consolas, monospace';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('FAR →', ox + size - 34, oy + size + 13);
    g.save();
    g.translate(ox - 12, oy + 40);
    g.rotate(-Math.PI / 2);
    g.fillText('HR →', 0, 0);
    g.restore();
    // legend
    const legend: Array<[string, string]> = [
      ['rgba(110,190,255,0.95)', zh ? `等方差 ROC (d′=${d.toFixed(2)})` : `equal-variance ROC (d′=${d.toFixed(2)})`],
      ...(this.state.sigmaRatio !== 1
        ? ([[ 'rgba(190,140,250,0.95)', zh ? `不等方差 s=${this.state.sigmaRatio.toFixed(2)}` : `unequal-variance s=${this.state.sigmaRatio.toFixed(2)}` ]] as Array<[string, string]>)
        : []),
      ['rgba(255,255,255,0.95)', zh ? '工作点 (F, H)' : 'operating point (F, H)'],
    ];
    let ly = oy + 6;
    for (const [c, label] of legend) {
      g.fillStyle = c;
      g.fillRect(ox + 8, ly, 14, 3);
      g.fillText(label, ox + 26, ly + 6);
      ly += 14;
    }
  }

  private drawDistPanel(
    g: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    w: number,
    h: number,
    d: number,
  ) {
    if (w < 60 || h < 60) return;
    const zh = this.zh;
    const s = this.state.sigmaRatio;
    const xLo = -4;
    const xHi = Math.max(d + 4 * s, 4);
    const zf = stdNormQuantile(safeRate(this.state.faRate));
    const criterion = -zf; // criterion location in noise-σ units

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh ? `信号/噪声分布重叠（拖拽调节 d′，c=${(-0.5 * (stdNormQuantile(safeRate(this.state.hitRate)) + zf)).toFixed(2)}）`
         : `Signal/noise overlap (drag to adjust d′, c=${(-0.5 * (stdNormQuantile(safeRate(this.state.hitRate)) + zf)).toFixed(2)})`,
      ox + w / 2,
      oy - 8,
    );

    const px = (x: number) => ox + (w * (x - xLo)) / (xHi - xLo);
    const peak = Math.max(stdNormPdf(0), 1e-9);
    const py = (dens: number) => oy + h - (h * dens) / peak * 0.92;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(ox, oy, w, h);

    const fillCurve = (mean: number, sd: number, color: string) => {
      g.beginPath();
      g.moveTo(px(xLo), oy + h);
      const n = 140;
      for (let i = 0; i <= n; i += 1) {
        const x = xLo + ((xHi - xLo) * i) / n;
        const dens = stdNormPdf((x - mean) / sd) / sd;
        g.lineTo(px(x), py(dens));
      }
      g.lineTo(px(xHi), oy + h);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    };
    fillCurve(0, 1, 'rgba(110,190,255,0.16)');
    fillCurve(d, s, 'rgba(250,180,110,0.16)');

    const strokeCurve = (mean: number, sd: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 1.8;
      g.beginPath();
      const n = 140;
      for (let i = 0; i <= n; i += 1) {
        const x = xLo + ((xHi - xLo) * i) / n;
        const dens = stdNormPdf((x - mean) / sd) / sd;
        if (i === 0) g.moveTo(px(x), py(dens));
        else g.lineTo(px(x), py(dens));
      }
      g.stroke();
    };
    strokeCurve(0, 1, 'rgba(110,190,255,0.95)');
    strokeCurve(d, s, 'rgba(250,180,110,0.95)');

    // criterion marker
    g.strokeStyle = 'rgba(255,255,255,0.65)';
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(px(criterion), oy);
    g.lineTo(px(criterion), oy + h);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = '10px Consolas, monospace';
    g.fillText(zh ? '判断标准 c' : 'criterion', px(criterion), oy + 12);

    // d′ arrow between the means
    g.strokeStyle = 'rgba(120,220,190,0.9)';
    g.beginPath();
    g.moveTo(px(0), oy + h - 8);
    g.lineTo(px(d), oy + h - 8);
    g.stroke();
    g.fillStyle = 'rgba(120,220,190,0.95)';
    g.fillText(`d′ = ${d.toFixed(3)}`, px(0) + (px(d) - px(0)) / 2, oy + h - 14);

    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText(zh ? '噪声 N(0,1)' : 'noise N(0,1)', ox + 6, oy + 14);
    g.fillStyle = 'rgba(250,180,110,0.95)';
    g.fillText(zh ? `信号 N(${d.toFixed(2)}, ${s.toFixed(2)})` : `signal N(${d.toFixed(2)}, ${s.toFixed(2)})`, ox + 6, oy + 28);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const m = sdtMeasures(this.state.hitRate, this.state.faRate);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = `H=${this.state.hitRate.toFixed(3)}  F=${this.state.faRate.toFixed(3)}  s=${this.state.sigmaRatio.toFixed(2)}${this.confusion ? `  (n=${this.confusion.n})` : ''}`;
    g.fillText(l1, 56, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = `d′=${m.dprime.toFixed(4)}  β=${m.beta.toFixed(4)}  c=${m.criterion.toFixed(4)}  AUC=${aucAnalytic(m.dprime, this.state.sigmaRatio).toFixed(4)}`;
    g.fillText(l2, 56, canvas.height - 14);
  }
}

export default function createSdtPlugin(): Plugin {
  return new SdtPlugin();
}
