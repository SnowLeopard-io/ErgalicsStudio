// ==========================================================================
// physics-pinn — Physics-Informed Neural Network lab
//
// Trains a tanh MLP whose loss is the PDE residual of the heat or viscous
// Burgers equation, plus soft IC/BC penalties. The canvas offers three views:
// the solution profiles against the reference at five times, the training
// loss on a log axis, and the residual field over the whole (x, t) square.
//
// The point of the lab is the transfer function: every quantity the student
// already knows from the ODE/FEM labs (residual, truncation error, boundary
// conditions) reappears here as a loss term.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@ergalics/plugin-sdk';
import { actionButton, actionFired, exportRowsCsv, notify } from '@ergalics/plugin-sdk/tools';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@ergalics/plugin-sdk/bridges';
import { physicsPinnManifest } from './manifest';
import {
  PinnTrainer,
  type PdeKind,
  type PinnConfig,
  type PinnSnapshot,
  type Profile,
} from './kernel';

export { physicsPinnManifest } from './manifest';

type View = 'solution' | 'loss' | 'residual' | 'accounting';

interface State {
  pde: PdeKind;
  width: number;
  depth: number;
  lr: number;
  collocation: number;
  epochs: number;
  seed: number;
  coef: number;
  discover: boolean;
  view: View;
}

const DEFAULT_COEF: Record<PdeKind, number> = { heat: 0.1, burgers: 0.05 };

const T_COLORS = ['#e2b04a', '#dd7f57', '#c96586', '#8f7fd0', '#5aa9c9'];

export class PinnPlugin implements Plugin {
  readonly manifest = physicsPinnManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    pde: 'heat',
    width: 24,
    depth: 2,
    lr: 0.02,
    collocation: 300,
    epochs: 400,
    seed: 7,
    coef: 0.1,
    discover: false,
    view: 'solution',
  };
  private snapshot: PinnSnapshot | null = null;
  private running = false;
  private cancelled = false;
  private error: string | null = null;
  /** Epochs trained in the current run (for the live loss curve). */
  private liveLoss: number[] = [];

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.cancelled = true;
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.cancelled = true;
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    // The canvas opens on an empty state; the user presses "Train" (or uses
    // Compute) — a 260-epoch training run on first paint would block startup.
    this.draw();
  }

  // ---- parameters ----------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      actionButton('run', 'Train network', '开始训练', 'primary'),
      {
        key: 'pde',
        label: 'Equation',
        labelI18n: { 'zh-CN': '方程', 'en-US': 'Equation' },
        type: 'select',
        value: s.pde,
        options: [
          {
            value: 'heat',
            label: 'Heat: u_t = α u_xx',
            labelI18n: { 'zh-CN': '热方程：u_t = α u_xx', 'en-US': 'Heat: u_t = α u_xx' },
          },
          {
            value: 'burgers',
            label: 'Burgers: u_t + u u_x = ν u_xx',
            labelI18n: { 'zh-CN': 'Burgers：u_t + u u_x = ν u_xx', 'en-US': 'Burgers: u_t + u u_x = ν u_xx' },
          },
        ],
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        value: s.view,
        options: [
          { value: 'solution', label: 'Solution u(x,t)', labelI18n: { 'zh-CN': '解 u(x,t)', 'en-US': 'Solution u(x,t)' } },
          { value: 'loss', label: 'Training loss', labelI18n: { 'zh-CN': '训练损失', 'en-US': 'Training loss' } },
          { value: 'residual', label: 'PDE residual field', labelI18n: { 'zh-CN': 'PDE 残差场', 'en-US': 'PDE residual field' } },
          { value: 'accounting', label: 'Loss decomposition', labelI18n: { 'zh-CN': '损失分项', 'en-US': 'Loss decomposition' } },
        ],
      },
      {
        key: 'width',
        label: 'Hidden units',
        labelI18n: { 'zh-CN': '隐藏单元数', 'en-US': 'Hidden units' },
        type: 'range',
        min: 4,
        max: 32,
        step: 4,
        value: s.width,
      },
      {
        key: 'depth',
        label: 'Hidden layers',
        labelI18n: { 'zh-CN': '隐藏层数', 'en-US': 'Hidden layers' },
        type: 'range',
        min: 1,
        max: 3,
        step: 1,
        value: s.depth,
      },
      {
        key: 'lr',
        label: 'Learning rate',
        labelI18n: { 'zh-CN': '学习率', 'en-US': 'Learning rate' },
        type: 'range',
        min: 0.001,
        max: 0.03,
        step: 0.001,
        value: s.lr,
      },
      {
        key: 'collocation',
        label: 'Collocation points',
        labelI18n: { 'zh-CN': '配点数', 'en-US': 'Collocation points' },
        type: 'range',
        min: 64,
        max: 512,
        step: 32,
        value: s.collocation,
        hint: this.zh
          ? 'PDE 残差在每个配点上采样；IC/BC 各 48 个软约束点。'
          : 'Residual is sampled at each collocation point; 48 soft IC and 96 BC points.',
      },
      {
        key: 'epochs',
        label: 'Epochs',
        labelI18n: { 'zh-CN': '训练轮数', 'en-US': 'Epochs' },
        type: 'range',
        min: 50,
        max: 800,
        step: 50,
        value: s.epochs,
      },
      {
        key: 'coef',
        label: s.pde === 'heat' ? 'α (diffusivity)' : 'ν (viscosity)',
        labelI18n:
          s.pde === 'heat'
            ? { 'zh-CN': 'α（扩散系数）', 'en-US': 'α (diffusivity)' }
            : { 'zh-CN': 'ν（粘性系数）', 'en-US': 'ν (viscosity)' },
        type: 'range',
        min: 0.002,
        max: 0.2,
        step: 0.002,
        value: s.coef,
      },
      {
        key: 'discover',
        label: 'Inverse: learn α',
        labelI18n: { 'zh-CN': '反演：学习 α', 'en-US': 'Inverse: learn α' },
        type: 'checkbox',
        value: s.discover,
        hint: this.zh
          ? 'α 作为一个可训练标量参与优化，配合 16 个内部“传感器”观测点反演扩散系数；没有内部观测时 α 不可辨识（仅热方程）。'
          : 'α is optimised as a trainable scalar together with 16 interior sensor readings; without interior observations α is unidentifiable (heat only).',
        visibleWhen: { key: 'pde', in: ['heat'] },
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'number',
        value: s.seed,
      },
      actionButton('exportCsv', 'Export profiles CSV', '导出剖面 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    if (actionFired(params, 'run')) {
      void this.runTraining();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (typeof params.pde === 'string' && (params.pde === 'heat' || params.pde === 'burgers')) {
      if (params.pde !== s.pde) {
        s.pde = params.pde;
        s.coef = DEFAULT_COEF[s.pde];
        if (s.pde === 'burgers') s.discover = false;
        this.snapshot = null;
        this.liveLoss = [];
        clearScienceOutputs(this.manifest.id);
      }
    }
    if (typeof params.width === 'number') s.width = clampRound(params.width, 4, 32, 4);
    if (typeof params.depth === 'number') s.depth = clampRound(params.depth, 1, 3, 1);
    if (typeof params.lr === 'number') s.lr = Math.min(0.03, Math.max(0.001, params.lr));
    if (typeof params.collocation === 'number') s.collocation = clampRound(params.collocation, 64, 512, 32);
    if (typeof params.epochs === 'number') s.epochs = clampRound(params.epochs, 50, 800, 50);
    if (typeof params.coef === 'number') s.coef = Math.min(0.2, Math.max(0.002, params.coef));
    if (typeof params.discover === 'boolean') s.discover = params.discover;
    if (typeof params.seed === 'number') s.seed = Math.round(params.seed);
    if (typeof params.view === 'string') {
      s.view = params.view as View;
      this.draw();
    }
  }

  // ---- training ------------------------------------------------------------

  private config(): PinnConfig {
    const s = this.state;
    return {
      pde: s.pde,
      width: s.width,
      depth: s.depth,
      lr: s.lr,
      collocation: s.collocation,
      epochs: s.epochs,
      seed: s.seed,
      coef: s.coef,
      discover: s.discover && s.pde === 'heat',
    };
  }

  private async runTraining(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.error = null;
    this.snapshot = null;
    this.liveLoss = [];
    this.api.setStatus('computing');
    const trainer = new PinnTrainer(this.config());
    try {
      // Chunk epochs and yield to the host so the canvas can repaint the loss
      // curve while training (a full synchronous run would freeze the UI).
      while (!trainer.done && !this.cancelled) {
        for (let i = 0; i < 8 && !trainer.done; i += 1) trainer.step();
        for (const v of trainer.history.slice(this.liveLoss.length)) this.liveLoss.push(v);
        if (this.state.view === 'loss' || this.state.view === 'accounting') this.draw();
        await new Promise((r) => setTimeout(r, 0));
      }
      if (this.cancelled) return;
      this.snapshot = trainer.snapshot();
      this.publishMetrics(this.snapshot);
      if (this.api.isActive?.() === false) {
        notify(
          this.api,
          'success',
          `PINN finished — relative L2 = ${(this.snapshot.relL2 * 100).toFixed(2)}%`,
          `PINN 训练完成 — 相对 L2 = ${(this.snapshot.relL2 * 100).toFixed(2)}%`,
        );
      }
      this.draw();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      clearScienceOutputs(this.manifest.id);
      this.draw();
    } finally {
      this.running = false;
      this.api.setStatus('ready');
    }
  }

  async compute(_input: unknown, onProgress?: (p: { done: number; total: number }) => void) {
    const trainer = new PinnTrainer(this.config());
    const t0 = performance.now();
    while (!trainer.done) {
      trainer.step();
      if (onProgress && trainer.history.length % 10 === 0) {
        onProgress({ done: trainer.history.length, total: this.state.epochs });
      }
    }
    const snap = trainer.snapshot();
    this.snapshot = snap;
    this.liveLoss = snap.loss.slice();
    this.publishMetrics(snap);
    this.draw();
    return {
      ok: true,
      output: {
        pde: snap.pde,
        relativeL2: snap.relL2,
        residualRms: snap.residualRms,
        finalLoss: snap.loss.at(-1) ?? 0,
        coefTrue: snap.coefTrue,
        coefHat: snap.coefHat,
        params: snap.nParams,
      },
      metrics: { gpuMs: performance.now() - t0, bytes: snap.nParams * 8 },
    };
  }

  // ---- science outputs -----------------------------------------------------

  private publishMetrics(snap: PinnSnapshot): void {
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'relL2',
        label: '相对 L2 误差',
        value: `${(snap.relL2 * 100).toFixed(2)}%`,
        severity: snap.relL2 < 0.05 ? 'ok' : snap.relL2 < 0.15 ? 'warn' : 'error',
      },
      {
        key: 'residual',
        label: this.zh ? '残差 RMS' : 'Residual RMS',
        value: fmtMetric(snap.residualRms),
      },
      { key: 'loss', label: zh ? '末轮总损失' : 'Final loss', value: fmtMetric(snap.loss.at(-1) ?? 0) },
      { key: 'pde', label: zh ? 'PDE 损失' : 'PDE loss', value: fmtMetric(snap.lossPde) },
      { key: 'ic', label: zh ? '初值损失' : 'IC loss', value: fmtMetric(snap.lossIc) },
      { key: 'bc', label: zh ? '边值损失' : 'BC loss', value: fmtMetric(snap.lossBc) },
      { key: 'params', label: zh ? '可训练参数' : 'Parameters', value: String(snap.nParams) },
    ];
    if (snap.coefHat !== null) {
      const err = Math.abs(snap.coefHat - snap.coefTrue) / snap.coefTrue;
      metrics.push({
        key: 'coefHat',
        label: zh ? '反演 α' : 'Recovered α',
        value: `${fmtMetric(snap.coefHat)} (${zh ? '真值' : 'true'} ${fmtMetric(snap.coefTrue)})`,
        severity: err < 0.05 ? 'ok' : err < 0.15 ? 'warn' : 'error',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- export --------------------------------------------------------------

  private exportCsv(): void {
    const snap = this.snapshot;
    if (!snap) {
      notify(this.api, 'warning', 'Train the network first.', '请先训练网络。');
      return;
    }
    const header = ['t', 'x', 'u_pred', 'u_ref', 'abs_error'];
    const rows: Array<number | string>[] = [];
    for (const p of snap.profiles) {
      for (let i = 0; i < p.pred.length; i += 1) {
        const pred = (p.pred[i] as { y: number }).y;
        const ref = (p.ref[i] as { y: number }).y;
        rows.push([p.t, (p.pred[i] as { x: number }).x, pred, ref, Math.abs(pred - ref)]);
      }
    }
    exportRowsCsv(this.api, `pinn-${snap.pde}`, header, rows);
  }

  // ---- drawing -------------------------------------------------------------

  private draw(): void {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (this.state.view === 'loss' || this.state.view === 'accounting') {
      this.drawLoss(g, canvas);
      return;
    }
    if (!this.snapshot) {
      this.drawEmpty(g, canvas);
      return;
    }
    if (this.state.view === 'residual') this.drawResidual(g, canvas, this.snapshot);
    else this.drawSolution(g, canvas, this.snapshot);
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(226,234,244,0.92)';
    g.font = `15px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      this.running ? (zh ? '正在训练…' : 'Training…') : zh ? '物理信息神经网络 (PINN)' : 'Physics-Informed Neural Network',
      canvas.width / 2,
      canvas.height / 2 - 12,
    );
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.fillText(
      this.running
        ? `${this.liveLoss.length} ${zh ? '轮' : 'epochs'}`
        : this.error
          ? this.error
          : zh
            ? '点击「开始训练」把 PDE 残差写进损失函数'
            : 'Press "Train network" to put the PDE residual into the loss',
      canvas.width / 2,
      canvas.height / 2 + 14,
    );
  }

  /** Shared frame: returns the plotting rectangle and value ranges. */
  private frame(
    g: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    title: string,
    yLabel: string,
    xRange: [number, number],
    yRange: [number, number],
    logY = false,
  ) {
    const padL = 62;
    const padR = 18;
    const padT = 34;
    const padB = 38;
    const pw = Math.max(40, canvas.width - padL - padR);
    const ph = Math.max(40, canvas.height - padT - padB);
    const x0 = padL;
    const y0 = padT;

    g.textAlign = 'left';
    g.fillStyle = 'rgba(232,238,246,0.95)';
    g.font = `13px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(title, x0, 20);

    g.strokeStyle = 'rgba(120,135,155,0.55)';
    g.lineWidth = 1;
    g.strokeRect(x0, y0, pw, ph);

    const tx = (x: number) => x0 + ((x - xRange[0]) / (xRange[1] - xRange[0] || 1)) * pw;
    const ty = (y: number) => {
      if (logY) {
        const a = Math.log10(Math.max(y, 1e-12));
        return y0 + ph - ((a - yRange[0]) / (yRange[1] - yRange[0] || 1)) * ph;
      }
      return y0 + ph - ((y - yRange[0]) / (yRange[1] - yRange[0] || 1)) * ph;
    };
    g.font = `10px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(168,182,200,0.9)';
    g.textAlign = 'right';
    const ticks = 5;
    for (let i = 0; i <= ticks; i += 1) {
      const f = i / ticks;
      if (logY) {
        const v = yRange[0] + (yRange[1] - yRange[0]) * f;
        g.fillText(`1e${v.toFixed(0)}`, x0 - 8, ty(Math.pow(10, v)) + 3);
      } else {
        const v = yRange[0] + (yRange[1] - yRange[0]) * f;
        g.fillText(fmtAxis(v), x0 - 8, ty(v) + 3);
      }
      g.strokeStyle = 'rgba(120,135,155,0.16)';
      g.beginPath();
      const yy = y0 + ph - f * ph;
      g.moveTo(x0, yy);
      g.lineTo(x0 + pw, yy);
      g.stroke();
    }
    g.textAlign = 'center';
    for (let i = 0; i <= 5; i += 1) {
      const f = i / 5;
      const v = xRange[0] + (xRange[1] - xRange[0]) * f;
      g.fillText(fmtAxis(v), x0 + f * pw, y0 + ph + 15);
    }
    // Axis titles.
    g.fillStyle = 'rgba(168,182,200,0.85)';
    g.fillText(this.zh ? 'x / 轮次' : 'x / epoch', x0 + pw / 2, y0 + ph + 30);
    g.save();
    g.translate(16, y0 + ph / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(yLabel, 0, 0);
    g.restore();

    return { x0, y0, pw, ph, tx, ty };
  }

  private drawSolution(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, snap: PinnSnapshot): void {
    let lo = 0;
    let hi = 0;
    for (const p of snap.profiles) {
      for (const q of [...p.pred, ...p.ref]) {
        lo = Math.min(lo, q.y);
        hi = Math.max(hi, q.y);
      }
    }
    const pad = (hi - lo) * 0.12 + 1e-6;
    const title = this.zh
      ? `解剖面对比 · 相对 L2 ${(snap.relL2 * 100).toFixed(2)}% · ${snap.epochsDone} 轮`
      : `Profiles · relative L2 ${(snap.relL2 * 100).toFixed(2)}% · ${snap.epochsDone} epochs`;
    const f = this.frame(g, canvas, title, 'u(x,t)', [0, 1], [lo - pad, hi + pad]);

    g.lineWidth = 1.6;
    for (let k = 0; k < snap.profiles.length; k += 1) {
      const p = snap.profiles[k] as Profile;
      // Reference: dashed grey.
      g.strokeStyle = 'rgba(160,176,196,0.75)';
      g.setLineDash([4, 4]);
      this.polyline(g, p.ref.map((q) => [f.tx(q.x), f.ty(q.y)]));
      g.setLineDash([]);
      // Prediction: colour by snapshot time.
      g.strokeStyle = T_COLORS[k % T_COLORS.length] as string;
      this.polyline(g, p.pred.map((q) => [f.tx(q.x), f.ty(q.y)]));
    }
    // Legend.
    g.font = `10px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    let lx = f.x0 + 8;
    const ly = f.y0 + 14;
    for (let k = 0; k < snap.profiles.length; k += 1) {
      const c = T_COLORS[k % T_COLORS.length] as string;
      g.strokeStyle = c;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(lx, ly - 4);
      g.lineTo(lx + 14, ly - 4);
      g.stroke();
      const label = `t=${(snap.profiles[k] as Profile).t}`;
      g.fillStyle = 'rgba(214,225,238,0.92)';
      g.fillText(label, lx + 18, ly);
      lx += 18 + g.measureText(label).width + 12;
    }
    g.strokeStyle = 'rgba(160,176,196,0.75)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(lx, ly - 4);
    g.lineTo(lx + 14, ly - 4);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(214,225,238,0.92)';
    g.fillText(this.zh ? '参考解' : 'reference', lx + 18, ly);

    this.drawFooter(g, canvas, snap);
  }

  private drawResidual(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, snap: PinnSnapshot): void {
    const rows = snap.residual;
    const nt = rows.length;
    const nx = (rows[0] as number[]).length;
    // Robust symmetric scale: 98th percentile of |r|.
    const flat = rows.flat().map(Math.abs).sort((a, b) => a - b);
    const p98 = flat[Math.min(flat.length - 1, Math.floor(flat.length * 0.98))] || 1e-6;
    const maxAbs = Math.max(p98, 1e-9);

    const padL = 56;
    const padT = 36;
    const padR = 84;
    const padB = 40;
    const pw = Math.max(40, canvas.width - padL - padR);
    const ph = Math.max(40, canvas.height - padT - padB);
    const x0 = padL;
    const y0 = padT;

    g.textAlign = 'left';
    g.fillStyle = 'rgba(232,238,246,0.95)';
    g.font = `13px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      this.zh
        ? `PDE 残差场 r(x,t) · RMS ${fmtMetric(snap.residualRms)}`
        : `PDE residual field r(x,t) · RMS ${fmtMetric(snap.residualRms)}`,
      x0,
      20,
    );

    g.save();
    g.beginPath();
    g.rect(x0, y0, pw, ph);
    g.clip();
    for (let j = 0; j < nt; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const r = (rows[j] as number[])[i] as number;
        const t = Math.max(-1, Math.min(1, r / maxAbs));
        g.fillStyle = diverging(t);
        const px = x0 + (i / (nx - 1)) * pw;
        const py = y0 + ph - (j / (nt - 1)) * ph;
        g.fillRect(px, py - ph / (nt - 1) - 0.5, pw / (nx - 1) + 0.8, ph / (nt - 1) + 1);
      }
    }
    g.restore();
    g.strokeStyle = 'rgba(120,135,155,0.55)';
    g.strokeRect(x0, y0, pw, ph);

    // Colour bar.
    const bx = x0 + pw + 18;
    const bw = 14;
    for (let i = 0; i < 60; i += 1) {
      const f = i / 59;
      g.fillStyle = diverging(1 - 2 * f);
      g.fillRect(bx, y0 + f * ph, bw, ph / 60 + 1);
    }
    g.strokeRect(bx, y0, bw, ph);
    g.font = `10px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(168,182,200,0.9)';
    g.textAlign = 'left';
    g.fillText(`+${maxAbs.toExponential(1)}`, bx + bw + 5, y0 + 8);
    g.fillText('0', bx + bw + 5, y0 + ph / 2 + 3);
    g.fillText(`-${maxAbs.toExponential(1)}`, bx + bw + 5, y0 + ph - 2);

    g.textAlign = 'center';
    for (let i = 0; i <= 5; i += 1) {
      g.fillText(fmtAxis(i / 5), x0 + (i / 5) * pw, y0 + ph + 15);
    }
    g.fillText('x', x0 + pw / 2, y0 + ph + 30);
    g.save();
    g.translate(16, y0 + ph / 2);
    g.rotate(-Math.PI / 2);
    g.fillText('t', 0, 0);
    g.restore();

    this.drawFooter(g, canvas, snap);
  }

  private drawLoss(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const hist = this.snapshot?.loss ?? this.liveLoss;
    if (hist.length < 2) {
      this.drawEmpty(g, canvas);
      return;
    }
    const logs = hist.map((v) => Math.log10(Math.max(v, 1e-12)));
    const lo = Math.min(...logs);
    const hi = Math.max(...logs);
    const pad = (hi - lo) * 0.08 + 0.2;
    const f = this.frame(
      g,
      canvas,
      this.zh ? `训练损失（对数）· ${hist.length} 轮` : `Training loss (log) · ${hist.length} epochs`,
      this.zh ? '总损失' : 'total loss',
      [0, Math.max(1, hist.length - 1)],
      [lo - pad, hi + pad],
      true,
    );
    g.strokeStyle = '#5aa9c9';
    g.lineWidth = 1.8;
    this.polyline(
      g,
      logs.map((v, i) => [f.tx(i), f.ty(Math.pow(10, v))]),
    );
    if (this.snapshot && this.state.view === 'accounting') {
      const snap = this.snapshot;
      const terms: Array<[string, number, string]> = [
        ['PDE', snap.lossPde, '#dd7f57'],
        ['IC', snap.lossIc, '#8f7fd0'],
        ['BC', snap.lossBc, '#6fae8f'],
      ];
      g.font = `11px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      let ly = f.y0 + 16;
      for (const [name, value, color] of terms) {
        g.fillStyle = color;
        g.fillRect(f.x0 + 10, ly - 8, 10, 10);
        g.fillStyle = 'rgba(220,230,242,0.95)';
        g.textAlign = 'left';
        g.fillText(`${name} = ${fmtMetric(value)}`, f.x0 + 26, ly);
        ly += 18;
      }
    }
    this.drawFooter(g, canvas, this.snapshot);
  }

  private polyline(g: CanvasRenderingContext2D, pts: Array<[number, number]>): void {
    if (pts.length < 2) return;
    g.beginPath();
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i]![0], pts[i]![1]);
    g.stroke();
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, snap: PinnSnapshot | null): void {
    g.font = `10px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(150,165,185,0.9)';
    const bits: string[] = [];
    if (snap) {
      bits.push(`${snap.nParams} ${this.zh ? '参数' : 'params'}`);
      bits.push(`${(snap.ms / 1000).toFixed(2)} s`);
      if (snap.coefHat !== null) bits.push(`α̂=${snap.coefHat.toFixed(4)}`);
    }
    if (bits.length) g.fillText(bits.join('  ·  '), 10, canvas.height - 10);
  }
}

function clampRound(v: number, lo: number, hi: number, step: number): number {
  const r = Math.round(v / step) * step;
  return Math.min(hi, Math.max(lo, r));
}

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100 || a < 0.01) return v.toExponential(1);
  return String(Number(v.toPrecision(2)));
}

/** Blue → white → red diverging ramp for the residual field. */
function diverging(t: number): string {
  const u = Math.max(-1, Math.min(1, t));
  if (u >= 0) {
    const r = Math.round(245 - 55 * u);
    const gg = Math.round(245 - 170 * u);
    const b = Math.round(245 - 180 * u);
    return `rgb(${r}, ${gg}, ${b})`;
  }
  const a = -u;
  const r = Math.round(245 - 190 * a);
  const gg = Math.round(245 - 130 * a);
  const b = Math.round(245 - 30 * a);
  return `rgb(${r}, ${gg}, ${b})`;
}

export default function createPinnPlugin(): Plugin {
  return new PinnPlugin();
}
