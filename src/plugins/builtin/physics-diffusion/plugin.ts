// ==========================================================================
// physics-diffusion — animated diffusion-equation laboratory
//
// Renders the evolving concentration/temperature field on the 2-D canvas:
// a numeric curve overlaid with the analytic reference in 1-D, or a heatmap
// in 2-D. A pre-run stability gate refuses FTCS configurations with
// D·Δt/Δx² > 1/2, and the science strip carries the live max relative error
// against the analytic solution plus the courant number. The embedded
// benchmark action runs the three kernel validations (sine decay, Gaussian
// kernel, 2-D convergence) and publishes their errors.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { physicsDiffusionManifest } from './manifest';
import {
  advance,
  analytic1d,
  benchmarkConvergence2D,
  benchmarkGaussian,
  benchmarkSineDecay,
  courantNumber,
  effectiveScheme,
  isStable,
  makeInitialField,
  maxRelativeError,
  STABILITY_LIMIT,
  type Boundary,
  type Dim,
  type DiffusionParams,
  type Field,
  type Initial,
  type Scheme,
} from './kernel';

export { physicsDiffusionManifest } from './manifest';

const DIMS: Array<{ value: Dim; zh: string; en: string }> = [
  { value: '1d', zh: '一维 (1-D)', en: '1-D' },
  { value: '2d', zh: '二维 (2-D)', en: '2-D' },
];
const SCHEMES: Array<{ value: Scheme; zh: string; en: string }> = [
  { value: 'cn', zh: 'Crank–Nicolson（隐式，仅 1-D）', en: 'Crank–Nicolson (implicit, 1-D only)' },
  { value: 'ftcs', zh: 'FTCS（显式）', en: 'FTCS (explicit)' },
];
const BOUNDARIES: Array<{ value: Boundary; zh: string; en: string }> = [
  { value: 'dirichlet', zh: 'Dirichlet（固定边值）', en: 'Dirichlet (fixed value)' },
  { value: 'neumann', zh: 'Neumann（零通量）', en: 'Neumann (zero flux)' },
];
const INITIALS: Array<{ value: Initial; zh: string; en: string }> = [
  { value: 'gauss', zh: '高斯脉冲', en: 'Gaussian pulse' },
  { value: 'square', zh: '方波', en: 'Square wave' },
  { value: 'sine', zh: '正弦模', en: 'Sine mode' },
];

interface State {
  dim: Dim;
  scheme: Scheme;
  d: number;
  n: number;
  dt: number;
  boundary: Boundary;
  initial: Initial;
  stepsPerFrame: number;
  running: boolean;
}

export class PhysicsDiffusionPlugin implements Plugin {
  readonly manifest = physicsDiffusionManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private field: Field | null = null;
  private timer: number | null = null;
  private frame = 0;
  private state: State = {
    dim: '1d',
    scheme: 'cn',
    d: 1,
    n: 160,
    dt: 0.001,
    boundary: 'dirichlet',
    initial: 'sine',
    stepsPerFrame: 2,
    running: false,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.stopTimer();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
    this.field = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (this.state.running) this.startTimer();
    this.draw();
  }

  async deactivate() {
    // Stop the animation while backgrounded; resumed on re-activation.
    this.stopTimer();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  private params(): DiffusionParams {
    return {
      dim: this.state.dim,
      scheme: this.state.scheme,
      d: this.state.d,
      n: this.state.n,
      dt: this.state.dt,
      boundary: this.state.boundary,
      initial: this.state.initial,
      domain: 1,
    };
  }

  getParams(): ParamDefinition[] {
    const opt = (items: Array<{ value: string; zh: string; en: string }>) =>
      items.map((it) => ({
        value: it.value,
        label: this.zh ? it.zh : it.en,
        labelI18n: { 'zh-CN': it.zh, 'en-US': it.en },
      }));
    return [
      {
        key: 'dim',
        label: 'Dimension',
        labelI18n: { 'zh-CN': '维度', 'en-US': 'Dimension' },
        type: 'select',
        options: opt(DIMS),
        value: this.state.dim,
      },
      {
        key: 'scheme',
        label: 'Scheme',
        labelI18n: { 'zh-CN': '时间格式', 'en-US': 'Time scheme' },
        type: 'select',
        options: opt(SCHEMES),
        value: this.state.scheme,
        hint: this.zh ? '2-D 仅支持 FTCS（CN 回退为 FTCS）' : '2-D supports FTCS only (CN falls back to FTCS)',
      },
      {
        key: 'd',
        label: 'D (diffusivity)',
        labelI18n: { 'zh-CN': 'D（扩散系数）', 'en-US': 'D (diffusivity)' },
        type: 'range',
        min: 0.05,
        max: 2,
        step: 0.05,
        value: this.state.d,
      },
      {
        key: 'n',
        label: 'Grid points / axis',
        labelI18n: { 'zh-CN': '每轴网格点数', 'en-US': 'Grid points / axis' },
        type: 'range',
        min: 32,
        max: 400,
        step: 8,
        value: this.state.n,
      },
      {
        key: 'dt',
        label: 'dt',
        labelI18n: { 'zh-CN': '时间步长 Δt', 'en-US': 'Time step Δt' },
        type: 'range',
        min: 0.0001,
        max: 0.005,
        step: 0.0001,
        value: this.state.dt,
        hint: this.zh ? `FTCS 需 D·Δt/Δx² ≤ ${STABILITY_LIMIT}` : `FTCS requires D·Δt/Δx² ≤ ${STABILITY_LIMIT}`,
      },
      {
        key: 'boundary',
        label: 'Boundary',
        labelI18n: { 'zh-CN': '边界条件', 'en-US': 'Boundary' },
        type: 'select',
        options: opt(BOUNDARIES),
        value: this.state.boundary,
      },
      {
        key: 'initial',
        label: 'Initial condition',
        labelI18n: { 'zh-CN': '初始条件', 'en-US': 'Initial condition' },
        type: 'select',
        options: opt(INITIALS),
        value: this.state.initial,
      },
      {
        key: 'stepsPerFrame',
        label: 'Steps / frame',
        labelI18n: { 'zh-CN': '每帧步数', 'en-US': 'Steps / frame' },
        type: 'range',
        min: 1,
        max: 10,
        step: 1,
        value: this.state.stepsPerFrame,
      },
      actionButton('run', 'Run ▶', '运行 ▶', 'primary'),
      actionButton('pause', 'Pause ⏸', '暂停 ⏸'),
      actionButton('reset', 'Reset field', '重置场'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportProfile', 'Export profile CSV', '导出剖面 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (v: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) cb(params[k] as number);
    };
    const pick = <T extends string>(k: string, allowed: readonly T[], cb: (v: T) => void): void => {
      if (typeof params[k] === 'string' && allowed.includes(params[k] as T)) cb(params[k] as T);
    };

    pick('dim', DIMS.map((d) => d.value) as Dim[], (v) => {
      if (v !== this.state.dim) {
        this.state.dim = v;
        this.resetField();
      }
    });
    pick('scheme', SCHEMES.map((s) => s.value) as Scheme[], (v) => {
      if (v !== this.state.scheme) {
        this.state.scheme = v;
        if (this.state.dim === '2d' && v === 'cn') {
          // Kernel falls back to FTCS in 2-D; surface that to the user once.
          notify(
            this.api,
            'warning',
            'Crank–Nicolson is 1-D only; using FTCS in 2-D.',
            'Crank–Nicolson 仅支持 1-D；2-D 已回退为 FTCS。',
          );
        }
        this.validateStability(true);
        this.draw();
      }
    });
    num('d', (v) => {
      if (v !== this.state.d) {
        this.state.d = v;
        this.validateStability(true);
        this.draw();
      }
    });
    num('n', (v) => {
      const n = Math.round(Math.min(400, Math.max(32, v)));
      if (n !== this.state.n) {
        this.state.n = n;
        this.resetField();
      }
    });
    num('dt', (v) => {
      if (v !== this.state.dt) {
        this.state.dt = v;
        this.validateStability(true);
        this.draw();
      }
    });
    pick('boundary', BOUNDARIES.map((b) => b.value) as Boundary[], (v) => {
      if (v !== this.state.boundary) {
        this.state.boundary = v;
        this.resetField();
      }
    });
    pick('initial', INITIALS.map((i) => i.value) as Initial[], (v) => {
      if (v !== this.state.initial) {
        this.state.initial = v;
        this.resetField();
      }
    });
    num('stepsPerFrame', (v) => {
      this.state.stepsPerFrame = Math.round(Math.min(10, Math.max(1, v)));
    });

    if (actionFired(params, 'run')) {
      if (this.validateStability(true)) {
        this.state.running = true;
        this.startTimer();
      }
    }
    if (actionFired(params, 'pause')) {
      this.state.running = false;
      this.stopTimer();
    }
    if (actionFired(params, 'reset')) {
      this.resetField();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmarks();
    if (actionFired(params, 'exportProfile')) this.exportProfile();
  }

  // ---- simulation control ---------------------------------------------------

  private resetField() {
    this.field = makeInitialField(this.params());
    this.frame = 0;
    this.publishLive();
    this.draw();
  }

  /** Pre-run stability gate for explicit schemes. Returns true when safe. */
  private validateStability(warn: boolean): boolean {
    const p = this.params();
    if (isStable(p)) return true;
    this.state.running = false;
    this.stopTimer();
    if (warn) {
      notify(
        this.api,
        'warning',
        `FTCS unstable: D·Δt/Δx² = ${courantNumber(p).toFixed(3)} > ${STABILITY_LIMIT}. Reduce dt or D.`,
        `FTCS 不稳定：D·Δt/Δx² = ${courantNumber(p).toFixed(3)} > ${STABILITY_LIMIT}。请减小 Δt 或 D。`,
      );
    }
    return false;
  }

  private startTimer() {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 50);
  }

  private stopTimer() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    if (this.api.isActive?.() === false) return;
    if (!this.field) this.resetField();
    const f = this.field;
    if (!f) return;
    advance(f, this.params(), this.state.stepsPerFrame);
    this.frame += 1;
    if (this.frame % 5 === 0) this.publishLive();
    this.draw();
  }

  // ---- science outputs --------------------------------------------------------

  private publishLive() {
    const f = this.field;
    if (!f) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const p = this.params();
    const rel = maxRelativeError(f, p);
    const r = courantNumber(p);
    const stable = isStable(p);
    const errLabel = this.analyticLabel();
    const metrics: ScienceMetric[] = [
      {
        key: 'max-rel-err',
        label: this.zh ? '最大相对误差（对解析解）' : 'Max rel err vs analytic',
        value: rel === null ? '—' : fmtMetric(rel * 100),
        unit: rel === null ? undefined : '%',
        severity: rel === null ? 'info' : rel < 0.01 ? 'ok' : rel < 0.05 ? 'info' : 'warn',
        hint: errLabel,
      },
      {
        key: 'courant',
        label: 'D·Δt/Δx²',
        value: fmtMetric(r),
        severity: stable ? 'ok' : 'error',
        hint: this.zh
          ? `库朗数，FTCS 稳定性上限 ${STABILITY_LIMIT}；${effectiveScheme(p) === 'cn' ? 'CN 无条件稳定' : '当前为 FTCS'}`
          : `courant number, FTCS ceiling ${STABILITY_LIMIT}; ${effectiveScheme(p) === 'cn' ? 'CN is unconditionally stable' : 'currently FTCS'}`,
      },
      { key: 'time', label: 't', value: fmtMetric(f.t), unit: 's', severity: 'info' },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private analyticLabel(): string {
    const p = this.params();
    const zh = this.zh;
    if (p.initial === 'sine') {
      return p.boundary === 'dirichlet'
        ? zh
          ? '解析参考：sin(πx/L)·exp(−Dπ²t/L²)（Dirichlet 精确）'
          : 'analytic: sin(πx/L)·exp(−Dπ²t/L²) (exact, Dirichlet)'
        : zh
          ? '该配置（Neumann + 正弦）无解析参考'
          : 'no analytic reference for Neumann + sine';
    }
    if (p.initial === 'gauss') {
      return zh
        ? '解析参考：无限域热核 σ₀/σ_t·exp(−r²/2σ_t²)，σ_t²=σ₀²+2Dt'
        : 'analytic: infinite-domain heat kernel σ₀/σ_t·exp(−r²/2σ_t²), σ_t²=σ₀²+2Dt';
    }
    return p.dim === '1d'
      ? zh
        ? '解析参考：方波傅里叶级数解（160 项截断）'
        : 'analytic: Fourier-series square-wave solution (160 terms)'
      : zh
        ? '该配置（2-D 方波）无解析参考'
        : 'no analytic reference for 2-D square wave';
  }

  private runBenchmarks() {
    const sine = benchmarkSineDecay();
    const gauss = benchmarkGaussian();
    const conv = benchmarkConvergence2D();
    const zh = this.zh;
    const okSine = sine.relErr < 1e-3;
    const okGauss = gauss.relErrWidth2 < 0.01 && gauss.relErrAmplitude < 0.01;
    const okConv = conv.ratio >= 3 && conv.ratio <= 5;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-sine',
        label: zh ? '基准① 正弦模衰减误差' : 'Bench ① sine-decay err',
        value: fmtMetric(sine.relErr * 100),
        unit: '%',
        severity: okSine ? 'ok' : 'warn',
        hint: zh
          ? 'CN、N=200、Δt=1e-3、t=0.1，门限 <0.1%（exp(−Dk²t) 解析）'
          : 'CN, N=200, Δt=1e-3, t=0.1; gate <0.1% (exp(−Dk²t) reference)',
      },
      {
        key: 'bench-gauss-width',
        label: zh ? '基准② 高斯宽度 σ² 误差' : 'Bench ② Gaussian σ² err',
        value: fmtMetric(gauss.relErrWidth2 * 100),
        unit: '%',
        severity: gauss.relErrWidth2 < 0.01 ? 'ok' : 'warn',
        hint: zh
          ? `FWHM 反演 σ²=${fmtMetric(gauss.measuredSigma2)} vs 解析 ${fmtMetric(gauss.analyticSigma2)}，门限 <1%`
          : `FWHM-inverted σ²=${fmtMetric(gauss.measuredSigma2)} vs analytic ${fmtMetric(gauss.analyticSigma2)}; gate <1%`,
      },
      {
        key: 'bench-gauss-amp',
        label: zh ? '基准② 高斯幅值误差' : 'Bench ② Gaussian amplitude err',
        value: fmtMetric(gauss.relErrAmplitude * 100),
        unit: '%',
        severity: gauss.relErrAmplitude < 0.01 ? 'ok' : 'warn',
        hint: zh ? '峰值应按 σ₀/σ_t 衰减，门限 <1%' : 'peak must decay as σ₀/σ_t; gate <1%',
      },
      {
        key: 'bench-conv',
        label: zh ? '基准③ 2-D 收敛比' : 'Bench ③ 2-D convergence ratio',
        value: fmtMetric(conv.ratio),
        severity: okConv ? 'ok' : 'warn',
        hint: zh
          ? `RMS 误差 ${fmtMetric(conv.errCoarse)} → ${fmtMetric(conv.errFine)}（32→64 网格），二阶应 ≈4（容差 3–5）`
          : `RMS error ${fmtMetric(conv.errCoarse)} → ${fmtMetric(conv.errFine)} (32→64 grid); 2nd order expects ≈4 (band 3–5)`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      okSine && okGauss && okConv ? 'success' : 'warning',
      `Benchmarks: sine ${(sine.relErr * 100).toFixed(4)}%, Gaussian width ${(gauss.relErrWidth2 * 100).toFixed(3)}%, convergence ×${conv.ratio.toFixed(2)}`,
      `基准验证：正弦衰减 ${(sine.relErr * 100).toFixed(4)}%，高斯宽度 ${(gauss.relErrWidth2 * 100).toFixed(3)}%，收敛比 ×${conv.ratio.toFixed(2)}`,
    );
  }

  private exportProfile() {
    const f = this.field;
    if (!f) {
      notify(this.api, 'warning', 'Nothing to export yet — reset the field first.', '暂无可导出数据——请先重置场。');
      return;
    }
    const p = this.params();
    const { dx } = { dx: p.domain / (p.n - 1) };
    const rows: Array<Array<number | string>> = [];
    if (f.dim === '1d') {
      for (let i = 0; i < f.nx; i++) {
        const x = i * dx;
        const ua = analytic1d(p, x, f.t);
        rows.push([Number(x.toFixed(6)), Number(f.u[i]!.toFixed(8)), ua === null ? '—' : Number(ua.toFixed(8))]);
      }
      exportRowsCsv(this.api, 'diffusion-profile-1d', ['x', 'u_numeric', 'u_analytic'], rows);
    } else {
      for (let iy = 0; iy < f.ny; iy++) {
        for (let ix = 0; ix < f.nx; ix++) {
          rows.push([Number((ix * dx).toFixed(6)), Number((iy * dx).toFixed(6)), Number(f.u[iy * f.nx + ix]!.toFixed(8))]);
        }
      }
      exportRowsCsv(this.api, 'diffusion-field-2d', ['x', 'y', 'u'], rows);
    }
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.field) this.resetField();
    const f = this.field;
    if (!f) return;
    const zh = this.zh;
    const font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const p = this.params();
    const schemeName = zh ? (effectiveScheme(p) === 'cn' ? 'Crank–Nicolson' : 'FTCS') : effectiveScheme(p) === 'cn' ? 'Crank–Nicolson' : 'FTCS';
    g.fillText(
      zh
        ? `扩散方程 ∂u/∂t = D∇²u · ${schemeName} · t=${f.t.toFixed(4)} s`
        : `Diffusion ∂u/∂t = D∇²u · ${schemeName} · t=${f.t.toFixed(4)} s`,
      canvas.width / 2,
      18,
    );

    if (!isStable(p) && effectiveScheme(p) === 'ftcs') {
      g.fillStyle = 'rgba(255,150,120,0.95)';
      g.font = font;
      g.fillText(
        zh
          ? `FTCS 不稳定（D·Δt/Δx²=${courantNumber(p).toFixed(2)} > ${STABILITY_LIMIT}）— 已暂停`
          : `FTCS unstable (D·Δt/Δx²=${courantNumber(p).toFixed(2)} > ${STABILITY_LIMIT}) — paused`,
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }

    if (f.dim === '1d') this.draw1d(g, canvas, f, font);
    else this.draw2d(g, canvas, f, font);
    this.drawFooter(g, canvas);
  }

  private draw1d(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, f: Field, font: string) {
    const zh = this.zh;
    const p = this.params();
    const L = p.domain;
    const padL = 52;
    const padR = 16;
    const padT = 34;
    const padB = 52;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    let vMax = 1.05;
    for (let i = 0; i < f.u.length; i++) vMax = Math.max(vMax, Math.abs(f.u[i]!) * 1.08);
    const px = (x: number) => x0 + (plotW * x) / L;
    const py = (v: number) => y1 - (plotH * v) / vMax;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.font = font;

    // analytic reference (dashed) when available
    const hasAnalytic = analytic1d(p, L / 2, f.t) !== null;
    if (hasAnalytic) {
      g.strokeStyle = 'rgba(235,240,247,0.55)';
      g.lineWidth = 1.2;
      g.setLineDash([5, 4]);
      g.beginPath();
      for (let i = 0; i < f.nx; i++) {
        const ua = analytic1d(p, (i * L) / (f.nx - 1), f.t) ?? 0;
        if (i === 0) g.moveTo(px((i * L) / (f.nx - 1)), py(ua));
        else g.lineTo(px((i * L) / (f.nx - 1)), py(ua));
      }
      g.stroke();
      g.setLineDash([]);
    }

    // numeric solution (filled + line)
    g.beginPath();
    g.moveTo(px(0), py(0));
    for (let i = 0; i < f.nx; i++) g.lineTo(px((i * L) / (f.nx - 1)), py(f.u[i]!));
    g.lineTo(px(L), py(0));
    g.closePath();
    g.fillStyle = 'rgba(90,160,250,0.18)';
    g.fill();
    g.beginPath();
    for (let i = 0; i < f.nx; i++) {
      const sx = px((i * L) / (f.nx - 1));
      const sy = py(f.u[i]!);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.strokeStyle = 'rgba(110,180,255,0.95)';
    g.lineWidth = 2;
    g.stroke();

    // ticks + labels
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const v = (vMax * k) / 4;
      g.fillText(v.toFixed(2), x0 - 6, py(v) + 4);
    }
    g.textAlign = 'center';
    for (let k = 0; k <= 4; k++) {
      g.fillText(((L * k) / 4).toFixed(2), px((L * k) / 4), y1 + 14);
    }

    // legend
    g.textAlign = 'left';
    g.fillStyle = 'rgba(110,180,255,0.95)';
    g.fillRect(x1 - 176, y0 + 8, 14, 3);
    g.fillText(zh ? '数值解' : 'numeric', x1 - 156, y0 + 13);
    if (hasAnalytic) {
      g.fillStyle = 'rgba(235,240,247,0.75)';
      g.fillRect(x1 - 176, y0 + 24, 14, 2);
      g.fillText(zh ? '解析参考' : 'analytic ref', x1 - 156, y0 + 27);
    }
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('x', x1 - 8, y1 + 28);
    g.textAlign = 'right';
    g.fillText('u', x0 - 8, y0 + 2);
  }

  private draw2d(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, f: Field, font: string) {
    const p = this.params();
    const L = p.domain;
    const padT = 34;
    const padB = 52;
    const size = Math.max(10, Math.min(canvas.width - 60, canvas.height - padT - padB));
    const ox = (canvas.width - size) / 2;
    const oy = padT;

    // offscreen field bitmap, scaled to the plot square
    const off = document.createElement('canvas');
    off.width = f.nx;
    off.height = f.ny;
    const octx = off.getContext('2d');
    if (octx) {
      const img = octx.createImageData(f.nx, f.ny);
      let maxU = 1e-12;
      for (let i = 0; i < f.u.length; i++) maxU = Math.max(maxU, f.u[i]!);
      for (let i = 0; i < f.u.length; i++) {
        const [r, gg, b] = heatColor(f.u[i]! / maxU);
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = gg;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(off, ox, oy, size, size);
    }
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.strokeRect(ox, oy, size, size);

    // frame ticks: L on both axes
    g.font = font;
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'center';
    for (let k = 0; k <= 4; k++) {
      const v = (L * k) / 4;
      g.fillText(v.toFixed(2), ox + (size * k) / 4, oy + size + 14);
    }
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const v = (L * k) / 4;
      g.fillText(v.toFixed(2), ox - 6, oy + size - (size * k) / 4 + 4);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('x', ox + size + 6, oy + size - 4);
    g.fillText('y', ox + 4, oy - 6);

    // color bar
    const barH = size * 0.6;
    for (let s = 0; s < barH; s++) {
      const [r, gg, b] = heatColor(1 - s / barH);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(ox + size + 12, oy + size - barH + s, 8, 1);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    let maxU = 1e-12;
    for (let i = 0; i < f.u.length; i++) maxU = Math.max(maxU, f.u[i]!);
    g.fillText(maxU.toFixed(2), ox + size + 24, oy + 8);
    g.fillText('0', ox + size + 24, oy + size);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const p = this.params();
    const zh = this.zh;
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const line1 = zh
      ? `D=${p.d}  N=${p.n}/轴  Δt=${p.dt.toExponential(1)}  边界=${p.boundary === 'dirichlet' ? 'Dirichlet' : 'Neumann'}  初始=${p.initial}`
      : `D=${p.d}  N=${p.n}/axis  Δt=${p.dt.toExponential(1)}  BC=${p.boundary}  IC=${p.initial}`;
    g.fillText(line1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const r = courantNumber(p);
    const line2 = zh
      ? `D·Δt/Δx²=${r.toFixed(3)}（FTCS 上限 ${STABILITY_LIMIT}）· 点击「运行验证基准」查看三条准入基准`
      : `D·Δt/Δx²=${r.toFixed(3)} (FTCS ceiling ${STABILITY_LIMIT}) · press "Run validation benchmarks" for the acceptance suite`;
    g.fillText(line2, 54, canvas.height - 14);
  }
}

/** Inferno-like color ramp for the 2-D heatmap. */
function heatColor(v: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, v));
  const stops: Array<[number, number, number, number]> = [
    [0.0, 8, 8, 26],
    [0.25, 74, 20, 100],
    [0.5, 165, 44, 88],
    [0.75, 232, 112, 40],
    [1.0, 250, 232, 150],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i]![0]) {
      const a = stops[i - 1]!;
      const b = stops[i]!;
      const f = (t - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1] + f * (b[1] - a[1])),
        Math.round(a[2] + f * (b[2] - a[2])),
        Math.round(a[3] + f * (b[3] - a[3])),
      ];
    }
  }
  return [250, 232, 150];
}

export default function createPhysicsDiffusionPlugin(): Plugin {
  return new PhysicsDiffusionPlugin();
}
