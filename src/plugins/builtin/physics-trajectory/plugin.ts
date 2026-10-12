// ==========================================================================
// physics-trajectory — trajectory kinematics & energy laboratory
//
// Loads (t, x[, y]) tables (file upload or the seeded synthetic demo) and
// shows three linked views: the trajectory with the linearized projectile
// fit overlaid, velocity/acceleration components from non-uniform 3-point
// differentiation, and the stacked KE/PE mechanical-energy decomposition
// whose total line visualizes energy conservation. Science outputs carry the
// fitted v0/θ and the energy drift; the benchmark action runs the three
// kernel validations (noise recovery, derivative accuracy, energy drift).
// The processed series export to CSV.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { trajectoryFigurePanels } from './figure';
import { physicsTrajectoryManifest } from './manifest';
import {
  benchmarkDerivativeAccuracy,
  benchmarkEnergyDrift,
  benchmarkProjectileRecovery,
  DEMO_SYNTH,
  derivatives,
  energySeries,
  fitProjectile,
  parseTrajText,
  relativeDrift,
  smoothTrajectory,
  synthesizeProjectile,
  type Derivatives,
  type EnergySeries,
  type ProjectileFit,
  type Trajectory,
} from './kernel';

export { physicsTrajectoryManifest } from './manifest';

const SG_OPTIONS: Array<{ value: string; zh: string; en: string }> = [
  { value: '0', zh: '关闭', en: 'Off' },
  { value: '5', zh: '窗口 5', en: 'Window 5' },
  { value: '7', zh: '窗口 7', en: 'Window 7' },
  { value: '9', zh: '窗口 9', en: 'Window 9' },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Curve {
  xs: number[];
  ys: number[];
  color: string;
  dash?: number[];
  width?: number;
  /** Fill the area between the curve and this y value. */
  fillTo?: number;
  /** Fill the area between this series (lower) and the curve (upper). */
  fillAbove?: number[];
}

interface Range {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function autoRange(curves: Curve[]): Range {
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const c of curves) {
    for (let i = 0; i < c.xs.length; i++) {
      x0 = Math.min(x0, c.xs[i]!);
      x1 = Math.max(x1, c.xs[i]!);
      y0 = Math.min(y0, c.ys[i]!);
      y1 = Math.max(y1, c.ys[i]!);
    }
  }
  if (!Number.isFinite(x0)) {
    x0 = 0;
    x1 = 1;
    y0 = 0;
    y1 = 1;
  }
  if (x1 - x0 < 1e-12) x1 = x0 + 1;
  if (y1 - y0 < 1e-12) y1 = y0 + 1;
  const ypad = (y1 - y0) * 0.08;
  return { x0, x1, y0: y0 - ypad, y1: y1 + ypad };
}

/** Draws a framed panel with the given curves; returns the data range used. */
function drawCurves(g: CanvasRenderingContext2D, box: Box, curves: Curve[], range?: Range): Range {
  const r = range ?? autoRange(curves);
  const px = (v: number) => box.x + ((v - r.x0) / (r.x1 - r.x0)) * box.w;
  const py = (v: number) => box.y + box.h - ((v - r.y0) / (r.y1 - r.y0)) * box.h;
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 1;
  g.strokeRect(box.x, box.y, box.w, box.h);
  for (const c of curves) {
    if (c.fillTo !== undefined) {
      g.beginPath();
      g.moveTo(px(c.xs[0]!), py(c.fillTo));
      for (let i = 0; i < c.xs.length; i++) g.lineTo(px(c.xs[i]!), py(c.ys[i]!));
      g.lineTo(px(c.xs[c.xs.length - 1]!), py(c.fillTo));
      g.closePath();
      g.fillStyle = c.color;
      g.fill();
    }
    if (c.fillAbove) {
      g.beginPath();
      for (let i = 0; i < c.xs.length; i++) {
        const sx = px(c.xs[i]!);
        const sy = py(c.ys[i]!);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      for (let i = c.fillAbove.length - 1; i >= 0; i--) g.lineTo(px(c.xs[i]!), py(c.fillAbove[i]!));
      g.closePath();
      g.fillStyle = c.color;
      g.fill();
    }
    g.beginPath();
    for (let i = 0; i < c.xs.length; i++) {
      const sx = px(c.xs[i]!);
      const sy = py(c.ys[i]!);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.strokeStyle = c.color;
    g.lineWidth = c.width ?? 1.6;
    g.setLineDash(c.dash ?? []);
    g.stroke();
    g.setLineDash([]);
  }
  return r;
}

/** Draws lo/mid/hi tick labels on both axes of a panel. */
function drawTicks(g: CanvasRenderingContext2D, box: Box, r: Range, font: string): void {
  g.font = font;
  g.fillStyle = 'rgba(170,182,200,0.9)';
  g.textAlign = 'right';
  for (let k = 0; k <= 2; k++) {
    const v = r.y0 + ((r.y1 - r.y0) * k) / 2;
    g.fillText(fmtMetric(v), box.x - 5, box.y + box.h - (box.h * k) / 2 + 4);
  }
  g.textAlign = 'center';
  for (let k = 0; k <= 2; k++) {
    const v = r.x0 + ((r.x1 - r.x0) * k) / 2;
    g.fillText(fmtMetric(v), box.x + (box.w * k) / 2, box.y + box.h + 13);
  }
}

function drawDots(g: CanvasRenderingContext2D, box: Box, xs: number[], ys: number[], r: Range, color: string): void {
  const px = (v: number) => box.x + ((v - r.x0) / (r.x1 - r.x0)) * box.w;
  const py = (v: number) => box.y + box.h - ((v - r.y0) / (r.y1 - r.y0)) * box.h;
  g.fillStyle = color;
  for (let i = 0; i < xs.length; i++) {
    g.beginPath();
    g.arc(px(xs[i]!), py(ys[i]!), 2, 0, Math.PI * 2);
    g.fill();
  }
}

export class PhysicsTrajectoryPlugin implements Plugin {
  readonly manifest = physicsTrajectoryManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private m = 1;
  private g = 9.81;
  private sgWindow = 0;
  private traj: Trajectory | null = null;
  private source: 'demo' | 'file' | null = null;
  private proc: Trajectory | null = null;
  private deriv: Derivatives | null = null;
  private energy: EnergySeries | null = null;
  private fit: ProjectileFit | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.publishLive();
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
    this.traj = null;
    this.proc = null;
    this.deriv = null;
    this.energy = null;
    this.fit = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (!this.traj) this.loadDemo();
    this.recompute();
    this.draw();
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (!this.traj) this.loadDemo();
    this.recompute();
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    try {
      const text = await file.text();
      const tr = parseTrajText(text);
      this.traj = tr;
      this.source = 'file';
      this.recompute();
      this.draw();
      notify(
        this.api,
        'success',
        `Loaded ${tr.t.length} trajectory samples from ${file.name}.`,
        `已从 ${file.name} 载入 ${tr.t.length} 个轨迹采样点。`,
      );
    } catch (err) {
      notify(
        this.api,
        'warning',
        `Failed to parse trajectory file: ${(err as Error).message}`,
        `轨迹文件解析失败：${(err as Error).message}`,
      );
    }
  }

  private loadDemo() {
    this.traj = synthesizeProjectile(DEMO_SYNTH);
    this.source = 'demo';
  }

  getParams(): ParamDefinition[] {
    const sgOpts = SG_OPTIONS.map((o) => ({
      value: o.value,
      label: this.zh ? o.zh : o.en,
      labelI18n: { 'zh-CN': o.zh, 'en-US': o.en },
    }));
    return [
      {
        key: 'm',
        label: 'Mass m',
        labelI18n: { 'zh-CN': '质量 m', 'en-US': 'Mass m' },
        type: 'range',
        min: 0.1,
        max: 10,
        step: 0.1,
        value: this.m,
      },
      {
        key: 'g',
        label: 'Gravity g',
        labelI18n: { 'zh-CN': '重力加速度 g', 'en-US': 'Gravity g' },
        type: 'range',
        min: 1,
        max: 25,
        step: 0.01,
        value: this.g,
        hint: this.zh ? '拟合与势能分解均使用该 g 值' : 'Used by both the projectile fit and the PE decomposition',
      },
      {
        key: 'sg',
        label: 'Savitzky–Golay smoothing',
        labelI18n: { 'zh-CN': 'Savitzky-Golay 平滑', 'en-US': 'Savitzky–Golay smoothing' },
        type: 'select',
        options: sgOpts,
        value: String(this.sgWindow),
        hint: this.zh
          ? '局部二次最小二乘平滑；可抑制数值微分对位置噪声的放大'
          : 'Local quadratic least-squares smoothing; suppresses noise amplification in numerical differentiation',
      },
      actionButton('demo', 'Load synthetic demo', '载入合成示例'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('export', 'Export series CSV', '导出序列 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    const num = (k: 'm' | 'g', clamp: (v: number) => number): void => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        const next = clamp(v);
        if (next !== this[k]) {
          this[k] = next;
          changed = true;
        }
      }
    };
    num('m', (v) => Math.min(10, Math.max(0.1, v)));
    num('g', (v) => Math.min(25, Math.max(1, v)));
    const sg = params.sg;
    if (typeof sg === 'string') {
      const w = Number(sg);
      if (Number.isFinite(w) && w !== this.sgWindow) {
        this.sgWindow = w;
        changed = true;
      }
    }

    if (changed) {
      this.recompute();
      this.draw();
    }
    if (actionFired(params, 'demo')) {
      this.loadDemo();
      this.recompute();
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmarks();
    if (actionFired(params, 'export')) this.exportSeries();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- compute ----------------------------------------------------------------

  private recompute() {
    if (!this.traj || this.traj.t.length < 3) {
      this.proc = null;
      this.deriv = null;
      this.energy = null;
      this.fit = null;
      clearScienceOutputs(this.manifest.id);
      return;
    }
    this.proc = smoothTrajectory(this.traj, this.sgWindow);
    this.deriv = derivatives(this.proc);
    this.energy = energySeries(this.proc, this.deriv, this.m, this.g);
    this.fit = fitProjectile(this.traj, this.g);
    this.publishLive();
  }

  // ---- science outputs ----------------------------------------------------------

  private publishLive() {
    if (!this.traj || !this.deriv || !this.energy || !this.fit) return;
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'samples',
        label: zh ? '采样点数' : 'Samples',
        value: String(this.traj.t.length),
        unit: zh ? '点' : 'pts',
        severity: 'info',
        hint:
          this.source === 'demo'
            ? zh
              ? `内置合成抛体（v₀ = ${DEMO_SYNTH.v0} m/s，θ = ${DEMO_SYNTH.thetaDeg}°，0.5% 噪声，种子 ${DEMO_SYNTH.seed}）`
              : `Built-in synthetic projectile (v0 = ${DEMO_SYNTH.v0} m/s, θ = ${DEMO_SYNTH.thetaDeg}°, 0.5 % noise, seed ${DEMO_SYNTH.seed})`
            : zh
              ? '上传的轨迹文件（t, x[, y]）'
              : 'Uploaded trajectory file (t, x[, y])',
      },
    ];
    if (this.fit.v0 !== null) {
      metrics.push({
        key: 'fit-v0',
        label: zh ? '拟合初速率 v₀' : 'Fitted launch speed v0',
        value: fmtMetric(this.fit.v0),
        unit: 'm/s',
        severity: 'ok',
        hint:
          zh
            ? '线性化最小二乘：x(t) = vx·t + x0，y(t) + ½g·t² = vy·t + y0'
            : 'Linearized least squares: x(t) = vx·t + x0, y(t) + ½g·t² = vy·t + y0',
      });
    }
    if (this.fit.thetaDeg !== null) {
      metrics.push({
        key: 'fit-theta',
        label: zh ? '拟合发射角 θ' : 'Fitted launch angle θ',
        value: fmtMetric(this.fit.thetaDeg),
        unit: '°',
        severity: 'ok',
        hint: zh ? 'θ = atan2(vy, vx)' : 'θ = atan2(vy, vx)',
      });
    }
    if (this.energy.total) {
      const drift = relativeDrift(this.energy.total);
      metrics.push({
        key: 'energy-drift',
        label: zh ? '机械能漂移' : 'Mechanical-energy drift',
        value: fmtMetric(drift * 100),
        unit: '%',
        severity: drift < 0.005 ? 'ok' : 'warn',
        hint:
          zh
            ? '(max−min)/|mean|；漂移偏大通常源于位置噪声被数值微分放大，可增大 Savitzky-Golay 窗口'
            : '(max−min)/|mean|; a large drift usually means position noise amplified by differentiation — raise the SG window',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmarks() {
    const zh = this.zh;
    const rec = benchmarkProjectileRecovery();
    const der = benchmarkDerivativeAccuracy();
    const en = benchmarkEnergyDrift();
    const okRec = rec.v0RelErr < 0.01 && rec.thetaRelErr < 0.01;
    const okDer = der.maxRelErr < 1e-2 && der.maxAbsAx < 1e-6;
    const okEn = en.drift < 0.005;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-recovery',
        label: zh ? '基准① 抛体回收' : 'Bench ① projectile recovery',
        value: fmtMetric(Math.max(rec.v0RelErr, rec.thetaRelErr) * 100),
        unit: '%',
        severity: okRec ? 'ok' : 'warn',
        hint: zh
          ? `0.5% 噪声合成数据回收：v₀ = ${fmtMetric(rec.v0)} m/s（目标 20），θ = ${fmtMetric(rec.thetaDeg)}°（目标 45），门槛 <1%`
          : `0.5 %-noise recovery: v0 = ${fmtMetric(rec.v0)} m/s (target 20), θ = ${fmtMetric(rec.thetaDeg)}° (target 45); gate <1%`,
      },
      {
        key: 'bench-deriv',
        label: zh ? '基准② 微分精度' : 'Bench ② derivative accuracy',
        value: fmtMetric(der.maxRelErr * 100),
        unit: '%',
        severity: okDer ? 'ok' : 'warn',
        hint: zh
          ? `非均匀网格三点微分 vs 解析抛体（vx/vy/ay），门槛 <1e-2；max|ax| = ${der.maxAbsAx.toExponential(1)}`
          : `non-uniform 3-point stencils vs the analytic parabola (vx/vy/ay), gate <1e-2; max|ax| = ${der.maxAbsAx.toExponential(1)}`,
      },
      {
        key: 'bench-energy',
        label: zh ? '基准③ 能量守恒' : 'Bench ③ energy conservation',
        value: fmtMetric(en.drift * 100),
        unit: '%',
        severity: okEn ? 'ok' : 'warn',
        hint: zh
          ? `无噪声合成抛体 KE+PE 漂移 (max−min)/|mean|，门槛 <0.5%；实测 ${fmtMetric(en.drift * 100)}%`
          : `noiseless KE+PE drift (max−min)/|mean|, gate <0.5%; measured ${fmtMetric(en.drift * 100)}%`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    const allOk = okRec && okDer && okEn;
    notify(
      this.api,
      allOk ? 'success' : 'warning',
      `Benchmarks: recovery ${(Math.max(rec.v0RelErr, rec.thetaRelErr) * 100).toFixed(4)}%, derivatives ${(der.maxRelErr * 100).toFixed(6)}%, energy drift ${(en.drift * 100).toFixed(6)}%`,
      `基准验证：抛体回收 ${(Math.max(rec.v0RelErr, rec.thetaRelErr) * 100).toFixed(4)}%，微分精度 ${(der.maxRelErr * 100).toFixed(6)}%，能量漂移 ${(en.drift * 100).toFixed(6)}%`,
    );
  }

  private exportSeries() {
    if (!this.traj || !this.deriv || !this.energy) {
      notify(this.api, 'warning', 'Nothing to export yet.', '暂无可导出数据。');
      return;
    }
    const n = this.traj.t.length;
    const rows: Array<Array<number | string>> = [];
    for (let i = 0; i < n; i++) {
      const num = (v: number | null): number | string => (v === null ? '—' : Number(v.toFixed(6)));
      rows.push([
        Number(this.traj.t[i]!.toFixed(6)),
        Number(this.traj.x[i]!.toFixed(6)),
        num(this.traj.y ? this.traj.y[i]! : null),
        num(this.deriv.vx[i]!),
        num(this.deriv.vy ? this.deriv.vy[i]! : null),
        num(this.deriv.ax[i]!),
        num(this.deriv.ay ? this.deriv.ay[i]! : null),
        num(this.energy.ke[i]!),
        num(this.energy.pe ? this.energy.pe[i]! : null),
        num(this.energy.total ? this.energy.total[i]! : null),
      ]);
    }
    exportRowsCsv(
      this.api,
      'trajectory-series',
      ['t', 'x', 'y', 'vx', 'vy', 'ax', 'ay', 'KE', 'PE', 'E_total'],
      rows,
    );
  }

  /** Build the trajectory + energy panels and push them into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    if (!this.traj || !this.deriv || !this.energy || !this.fit) {
      notify(this.api, 'warning', 'No trajectory yet — load the demo or a file first.', '暂无轨迹数据——请先载入合成示例或轨迹文件。');
      return;
    }
    const driftTxt = this.energy.total ? `${(relativeDrift(this.energy.total) * 100).toFixed(3)}%` : '—';
    const v0Txt = this.fit.v0 !== null ? `${fmtMetric(this.fit.v0)} m/s` : '—';
    const thTxt = this.fit.thetaDeg !== null ? `${fmtMetric(this.fit.thetaDeg)}°` : '—';
    const caption: Bilingual = {
      zh: `轨迹运动学（${this.traj.t.length} 点，m=${fmtMetric(this.m)} kg，g=${fmtMetric(this.g)} m/s²）：拟合 v₀=${v0Txt}，θ=${thTxt}，机械能漂移 ${driftTxt}。`,
      en: `Trajectory kinematics (${this.traj.t.length} pts, m=${fmtMetric(this.m)} kg, g=${fmtMetric(this.g)} m/s²): fitted v0=${v0Txt}, θ=${thTxt}, mechanical-energy drift ${driftTxt}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '轨迹运动学分析', en: 'Trajectory Kinematics' },
      caption,
      trajectoryFigurePanels({ traj: this.traj, fit: this.fit, energy: this.energy, g: this.g }),
    );
  }

  // ---- drawing ------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 460;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.font = font;

    if (!this.traj || !this.deriv || !this.energy || !this.fit || !this.proc) {
      g.fillStyle = 'rgba(200,210,225,0.8)';
      g.textAlign = 'center';
      g.fillText(
        zh
          ? '载入轨迹文件（CSV/TSV/DAT/TXT，列为 t,x[,y]）或点击「载入合成示例」'
          : 'Load a trajectory file (CSV/TSV/DAT/TXT with t,x[,y] columns) or click "Load synthetic demo"',
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const srcTag = this.source === 'demo' ? (zh ? '合成示例' : 'demo') : zh ? '上传' : 'uploaded';
    g.fillText(
      zh
        ? `轨迹运动学 · ${srcTag} · ${this.traj.t.length} 点 · m=${fmtMetric(this.m)} kg · g=${fmtMetric(this.g)} m/s²`
        : `Trajectory kinematics · ${srcTag} · ${this.traj.t.length} pts · m=${fmtMetric(this.m)} kg · g=${fmtMetric(this.g)} m/s²`,
      canvas.width / 2,
      18,
    );
    g.font = font;

    const topY = 30;
    const bodyH = canvas.height - topY - 40;
    const rowH = Math.max(90, Math.round(bodyH * 0.55));
    const leftW = Math.max(160, Math.round((canvas.width - 40) * 0.5));
    this.drawTrajPanel(g, { x: 44, y: topY, w: leftW, h: rowH }, font);
    this.drawVaPanel(g, { x: leftW + 60, y: topY, w: canvas.width - leftW - 68, h: rowH }, font);
    this.drawEnergyPanel(g, { x: 44, y: topY + rowH + 14, w: canvas.width - 52, h: Math.max(70, canvas.height - topY - rowH - 46) }, font);
  }

  private drawTrajPanel(g: CanvasRenderingContext2D, box: Box, font: string) {
    const zh = this.zh;
    const traj = this.traj!;
    const fit = this.fit!;
    const curves: Curve[] = [];
    const hasY = traj.y !== null;
    if (hasY) {
      curves.push({ xs: traj.x, ys: traj.y!, color: 'rgba(110,180,255,0.95)', width: 1.3 });
      const T = traj.t[traj.t.length - 1]!;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i <= 100; i++) {
        const tt = (T * i) / 100;
        xs.push(fit.vx * tt + fit.x0);
        ys.push(fit.vy! * tt + fit.y0! - 0.5 * this.g * tt * tt);
      }
      curves.push({ xs, ys, color: 'rgba(240,244,250,0.65)', dash: [5, 4] });
    } else {
      curves.push({ xs: traj.t, ys: traj.x, color: 'rgba(110,180,255,0.95)', width: 1.3 });
      const T = traj.t[traj.t.length - 1]!;
      curves.push({
        xs: [0, T],
        ys: [fit.x0, fit.vx * T + fit.x0],
        color: 'rgba(240,244,250,0.65)',
        dash: [5, 4],
      });
    }
    const r = drawCurves(g, box, curves);
    drawDots(g, box, hasY ? traj.x : traj.t, hasY ? traj.y! : traj.x, r, 'rgba(140,200,255,0.9)');
    drawTicks(g, box, r, font);
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.textAlign = 'left';
    g.fillText(hasY ? 'y' : 'x', box.x - 32, box.y + 8);
    g.fillText(hasY ? 'x' : 't', box.x + box.w - 8, box.y + box.h + 26);
    g.fillStyle = 'rgba(235,240,247,0.75)';
    g.fillText(zh ? '轨迹（虚线 = 拟合抛体）' : 'Trajectory (dashed = fitted parabola)', box.x - 32, box.y - 6);
  }

  private drawVaPanel(g: CanvasRenderingContext2D, box: Box, font: string) {
    const zh = this.zh;
    const traj = this.traj!;
    const d = this.deriv!;
    const subH = Math.floor((box.h - 12) / 2);
    const vBox: Box = { ...box, h: subH };
    const aBox: Box = { ...box, y: box.y + subH + 12, h: subH };

    const vCurves: Curve[] = [{ xs: traj.t, ys: d.vx, color: 'rgba(110,180,255,0.95)' }];
    if (d.vy) vCurves.push({ xs: traj.t, ys: d.vy, color: 'rgba(255,170,80,0.95)' });
    const vr = drawCurves(g, vBox, vCurves);
    drawTicks(g, vBox, vr, font);

    const aCurves: Curve[] = [{ xs: traj.t, ys: d.ax, color: 'rgba(110,180,255,0.8)', dash: [4, 3] }];
    if (d.ay) aCurves.push({ xs: traj.t, ys: d.ay, color: 'rgba(255,170,80,0.8)', dash: [4, 3] });
    const ar = drawCurves(g, aBox, aCurves);
    drawTicks(g, aBox, ar, font);

    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('t', vBox.x + vBox.w - 8, vBox.y + vBox.h + 26);
    g.fillText('t', aBox.x + aBox.w - 8, aBox.y + aBox.h + 26);
    g.fillStyle = 'rgba(235,240,247,0.75)';
    g.fillText(zh ? '速度分量 v(t)' : 'Velocity components v(t)', vBox.x - 16, vBox.y - 6);
    g.fillText(zh ? '加速度分量 a(t)' : 'Acceleration components a(t)', aBox.x - 16, aBox.y - 6);
    // legend
    g.textAlign = 'left';
    const lx = vBox.x + 8;
    g.fillStyle = 'rgba(110,180,255,0.95)';
    g.fillText('vx', lx, vBox.y + 12);
    if (d.vy) {
      g.fillStyle = 'rgba(255,170,80,0.95)';
      g.fillText('vy', lx + 30, vBox.y + 12);
    }
    g.fillStyle = 'rgba(110,180,255,0.8)';
    g.fillText('ax', lx, aBox.y + 12);
    if (d.ay) {
      g.fillStyle = 'rgba(255,170,80,0.8)';
      g.fillText('ay', lx + 30, aBox.y + 12);
    }
  }

  private drawEnergyPanel(g: CanvasRenderingContext2D, box: Box, font: string) {
    const zh = this.zh;
    const traj = this.traj!;
    const e = this.energy!;
    const curves: Curve[] = [
      { xs: traj.t, ys: e.ke, color: 'rgba(90,160,250,0.28)', fillTo: 0, width: 0 },
      { xs: traj.t, ys: e.ke, color: 'rgba(110,180,255,0.95)' },
    ];
    if (e.pe) {
      const stacked = e.ke.map((v, i) => v + e.pe![i]!);
      curves.push({ xs: traj.t, ys: stacked, color: 'rgba(255,170,80,0.28)', fillAbove: e.ke, width: 0 });
      curves.push({ xs: traj.t, ys: stacked, color: 'rgba(250,200,120,0.95)' });
    }
    const r = drawCurves(g, box, curves);
    drawTicks(g, box, r, font);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('t', box.x + box.w - 8, box.y + box.h + 26);
    g.fillStyle = 'rgba(235,240,247,0.75)';
    g.fillText(zh ? '机械能分解（堆叠）' : 'Mechanical energy (stacked)', box.x - 32, box.y - 6);
    const lx = box.x + box.w - 190;
    g.fillStyle = 'rgba(110,180,255,0.95)';
    g.fillText(zh ? '动能 KE' : 'Kinetic KE', lx, box.y + 12);
    if (e.pe) {
      g.fillStyle = 'rgba(250,200,120,0.95)';
      g.fillText(zh ? '势能 PE' : 'Potential PE', lx + 62, box.y + 12);
      g.fillStyle = 'rgba(240,244,250,0.9)';
      g.fillText(zh ? '总机械能 E' : 'Total E', lx + 124, box.y + 12);
    }
  }
}

export default function createPhysicsTrajectoryPlugin(): Plugin {
  return new PhysicsTrajectoryPlugin();
}
