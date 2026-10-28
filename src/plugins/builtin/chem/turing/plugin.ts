// ==========================================================================
// chem-turing — Gray–Scott reaction–diffusion Turing-pattern laboratory
//
// Interactive 2-D reactor: the kernel integrates the Gray–Scott model with
// explicit FTCS on a periodic N×N grid; the plugin drives the evolution from
// a timer, colour-maps the v field through a selectable palette, and offers
// the Pearson (1993) classic (f,k) regimes as one-click presets. The FTCS
// diffusion step is clamped to the von Neumann stability bound (dt ≤
// 1/(4·max(Du,Dv))) with an on-canvas notice whenever clamping kicks in.
// Science outputs publish the step count, mean concentrations and spot
// coverage so the pattern state is always paired with numbers.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportCanvasPng, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { chemTuringManifest } from './manifest';
import { turingFigurePanels } from './figure';
import {
  createState,
  fieldStats,
  GRAY_SCOTT_PRESETS,
  isFiniteState,
  maxStableDt,
  seedCenter,
  seedRandom,
  stepN,
  totalMass,
  type GrayScottParams,
  type GrayScottState,
  type SeedPattern,
} from './kernel';

export { chemTuringManifest } from './manifest';

const GRIDS = [64, 96, 128];

type Colormap = 'gray' | 'ice' | 'iron';

const COLORMAPS: Array<{ value: Colormap; en: string; zh: string }> = [
  { value: 'gray', en: 'Grayscale', zh: '灰度' },
  { value: 'ice', en: 'Ice (blue→white)', zh: '冰蓝（深蓝→白）' },
  { value: 'iron', en: 'Iron (black→red→white)', zh: '铁红（黑→红→白）' },
];

/** Piecewise-linear colour stops t → [r,g,b]. */
const COLORMAP_STOPS: Record<Colormap, Array<[number, number, number, number]>> = {
  gray: [
    [0, 8, 10, 14],
    [1, 245, 248, 252],
  ],
  ice: [
    [0, 6, 8, 20],
    [0.35, 20, 60, 140],
    [0.7, 80, 190, 235],
    [1, 240, 250, 255],
  ],
  iron: [
    [0, 10, 6, 8],
    [0.35, 130, 20, 40],
    [0.65, 235, 110, 40],
    [0.85, 250, 210, 90],
    [1, 255, 252, 235],
  ],
};

function colormapAt(cm: Colormap, t: number): [number, number, number] {
  const stops = COLORMAP_STOPS[cm];
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (x >= a[0] && x <= b[0]) {
      const s = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
      return [
        a[1] + s * (b[1] - a[1]),
        a[2] + s * (b[2] - a[2]),
        a[3] + s * (b[3] - a[3]),
      ];
    }
  }
  const last = stops[stops.length - 1]!;
  return [last[1], last[2], last[3]];
}

interface State {
  f: number;
  k: number;
  du: number;
  dv: number;
  dt: number;
  n: number;
  colormap: Colormap;
  seed: SeedPattern;
  seedValue: number;
}

export class ChemTuringPlugin implements Plugin {
  readonly manifest = chemTuringManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private gs: GrayScottState | null = null;
  private off: HTMLCanvasElement | null = null;
  private image: ImageData | null = null;
  private ticks = 0;
  private warnedClamp = false;
  private state: State = {
    f: 0.03,
    k: 0.062,
    du: 0.16,
    dv: 0.08,
    dt: 1.0,
    n: 96,
    colormap: 'ice',
    seed: 'center',
    seedValue: 20260922,
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
    this.gs = null;
    this.off = null;
    this.image = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.ensureState();
    if (this.running) this.startTimer();
  }

  async deactivate() {
    this.stopTimer();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.ensureState();
    this.draw();
  }

  private params(): GrayScottParams {
    return { f: this.state.f, k: this.state.k, du: this.state.du, dv: this.state.dv, dt: this.state.dt };
  }

  /** Effective params with the FTCS diffusion stability clamp applied. */
  private stableParams(): { p: GrayScottParams; clamped: boolean } {
    const p = this.params();
    const cap = maxStableDt(p.du, p.dv) * 0.98;
    if (p.dt <= cap) return { p, clamped: false };
    return { p: { ...p, dt: cap }, clamped: true };
  }

  private ensureState(): void {
    if (this.gs && this.gs.n === this.state.n) return;
    this.gs = createState(this.state.n);
    this.reseed();
  }

  private reseed(): void {
    if (!this.gs) return;
    if (this.state.seed === 'random') seedRandom(this.gs, this.state.seedValue, 12);
    else seedCenter(this.gs, 0.5);
    this.ticks = 0;
  }

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    return [
      {
        key: 'f',
        label: 'f (feed)',
        labelI18n: { 'zh-CN': '进料速率 f', 'en-US': 'Feed rate f' },
        type: 'range',
        min: 0.005,
        max: 0.08,
        step: 0.001,
        value: this.state.f,
      },
      {
        key: 'k',
        label: 'k (kill)',
        labelI18n: { 'zh-CN': '排出速率 k', 'en-US': 'Kill rate k' },
        type: 'range',
        min: 0.03,
        max: 0.07,
        step: 0.0005,
        value: this.state.k,
      },
      {
        key: 'du',
        label: 'Du',
        labelI18n: { 'zh-CN': '扩散系数 Du', 'en-US': 'Diffusivity Du' },
        type: 'range',
        min: 0.05,
        max: 0.3,
        step: 0.005,
        value: this.state.du,
      },
      {
        key: 'dv',
        label: 'Dv',
        labelI18n: { 'zh-CN': '扩散系数 Dv', 'en-US': 'Diffusivity Dv' },
        type: 'range',
        min: 0.02,
        max: 0.2,
        step: 0.005,
        value: this.state.dv,
      },
      {
        key: 'dt',
        label: 'dt',
        labelI18n: { 'zh-CN': '时间步长 dt', 'en-US': 'Time step dt' },
        type: 'range',
        min: 0.1,
        max: 1.5,
        step: 0.05,
        value: this.state.dt,
        hint: zh
          ? `FTCS 稳定上限 ≈ ${maxStableDt(this.state.du, this.state.dv).toFixed(2)}（超出自动钳制）`
          : `FTCS stability bound ≈ ${maxStableDt(this.state.du, this.state.dv).toFixed(2)} (auto-clamped)`,
      },
      {
        key: 'grid',
        label: 'Grid',
        labelI18n: { 'zh-CN': '网格尺寸', 'en-US': 'Grid size' },
        type: 'select',
        options: GRIDS.map((n) => ({
          value: String(n),
          label: `${n}×${n}`,
          labelI18n: { 'zh-CN': `${n}×${n}`, 'en-US': `${n}×${n}` },
        })),
        value: String(this.state.n),
      },
      {
        key: 'colormap',
        label: 'Colormap',
        labelI18n: { 'zh-CN': '色表', 'en-US': 'Colormap' },
        type: 'select',
        options: COLORMAPS.map((c) => ({
          value: c.value,
          label: zh ? c.zh : c.en,
          labelI18n: { 'zh-CN': c.zh, 'en-US': c.en },
        })),
        value: this.state.colormap,
      },
      {
        key: 'seed',
        label: 'Seed pattern',
        labelI18n: { 'zh-CN': '初始扰动', 'en-US': 'Seed pattern' },
        type: 'select',
        options: [
          {
            value: 'center',
            label: zh ? '中心方斑' : 'Central square',
            labelI18n: { 'zh-CN': '中心方斑', 'en-US': 'Central square' },
          },
          {
            value: 'random',
            label: zh ? '随机斑点（固定种子）' : 'Random spots (fixed seed)',
            labelI18n: { 'zh-CN': '随机斑点（固定种子）', 'en-US': 'Random spots (fixed seed)' },
          },
        ],
        value: this.state.seed,
      },
      actionButton('run', this.running ? 'Pause' : 'Run / Pause', this.running ? '暂停' : '运行 / 暂停', 'primary'),
      actionButton('reset', 'Reset & reseed', '重置并重新播种'),
      actionButton('benchmark', 'Run numerics benchmarks', '运行数值基准验证'),
      actionButton('exportPng', 'Export PNG', '导出 PNG'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      ...GRAY_SCOTT_PRESETS.map((p) =>
        actionButton(`preset_${p.key}`, `${zh ? p.zh : p.en} (f=${p.f}, k=${p.k})`, `${p.zh}（f=${p.f}, k=${p.k}）`),
      ),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    const num = (key: string, cb: (v: number) => boolean): void => {
      if (typeof params[key] === 'number' && Number.isFinite(params[key] as number)) {
        if (cb(params[key] as number)) changed = true;
      }
    };
    num('f', (v) => {
      const x = Math.min(0.08, Math.max(0.005, v));
      if (x === this.state.f) return false;
      this.state.f = x;
      return true;
    });
    num('k', (v) => {
      const x = Math.min(0.07, Math.max(0.03, v));
      if (x === this.state.k) return false;
      this.state.k = x;
      return true;
    });
    num('du', (v) => {
      const x = Math.min(0.3, Math.max(0.05, v));
      if (x === this.state.du) return false;
      this.state.du = x;
      return true;
    });
    num('dv', (v) => {
      const x = Math.min(0.2, Math.max(0.02, v));
      if (x === this.state.dv) return false;
      this.state.dv = x;
      return true;
    });
    num('dt', (v) => {
      const x = Math.min(1.5, Math.max(0.1, v));
      if (x === this.state.dt) return false;
      this.state.dt = x;
      return true;
    });
    if (typeof params.grid === 'string' && GRIDS.some((n) => String(n) === params.grid)) {
      const n = Number(params.grid);
      if (n !== this.state.n) {
        this.state.n = n;
        this.gs = null;
        this.off = null;
        this.image = null;
        this.ensureState();
        changed = true;
      }
    }
    if (typeof params.colormap === 'string' && COLORMAPS.some((c) => c.value === params.colormap)) {
      if (params.colormap !== this.state.colormap) {
        this.state.colormap = params.colormap as Colormap;
        changed = true;
      }
    }
    if (typeof params.seed === 'string' && (params.seed === 'center' || params.seed === 'random')) {
      if (params.seed !== this.state.seed) {
        this.state.seed = params.seed as SeedPattern;
        this.reseed();
        changed = true;
      }
    }
    // Presets apply the (f,k) pair and reset the pattern.
    for (const p of GRAY_SCOTT_PRESETS) {
      if (actionFired(params, `preset_${p.key}`)) {
        this.state.f = p.f;
        this.state.k = p.k;
        this.reseed();
        changed = true;
        notify(
          this.api,
          'info',
          `Pearson preset "${p.en}" applied (f=${p.f}, k=${p.k}).`,
          `已应用 Pearson 预设「${p.zh}」（f=${p.f}，k=${p.k}）。`,
        );
      }
    }
    if (actionFired(params, 'run')) {
      this.running = !this.running;
      if (this.running) this.startTimer();
      else this.stopTimer();
      changed = true; // refresh the button label
    }
    if (actionFired(params, 'reset')) {
      this.reseed();
      changed = true;
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'gray-scott-turing');
    }
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    if (changed) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- animation loop ---------------------------------------------------------

  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (!(this.api.isActive?.() ?? true)) return;
      const { p, clamped } = this.stableParams();
      if (clamped && !this.warnedClamp) {
        this.warnedClamp = true;
        notify(
          this.api,
          'warning',
          `dt clamped to ${maxStableDt(this.state.du, this.state.dv).toFixed(2)} for FTCS stability.`,
          `为满足 FTCS 稳定性，dt 已钳制到 ${maxStableDt(this.state.du, this.state.dv).toFixed(2)}。`,
        );
      }
      if (!clamped) this.warnedClamp = false;
      if (this.gs) stepN(this.gs, p, 10);
      this.ticks += 1;
      if (this.ticks % 15 === 0) this.publish(false);
      this.draw();
    }, 40);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---- scientific outputs -------------------------------------------------------

  private publish(bench: boolean, benchMetrics: ScienceMetric[] = []) {
    if (!this.gs) return;
    const stats = fieldStats(this.gs, 'v', 0.15, 6);
    const finite = isFiniteState(this.gs);
    const metrics: ScienceMetric[] = bench
      ? benchMetrics
      : [
          {
            key: 'steps',
            label: this.zh ? '演化步数' : 'Integration steps',
            value: fmtMetric(this.gs.steps),
            severity: 'info',
            hint: this.zh ? 'FTCS 显式差分累计步数' : 'total explicit FTCS steps',
          },
          {
            key: 'mean-v',
            label: this.zh ? '平均 v 浓度' : 'Mean v',
            value: fmtMetric(stats.mean),
            severity: 'info',
          },
          {
            key: 'coverage',
            label: this.zh ? '斑点覆盖率 (v>0.15)' : 'Spot coverage (v>0.15)',
            value: `${(stats.coverage * 100).toFixed(2)}%`,
            severity: stats.coverage > 0 && stats.coverage < 0.6 ? 'ok' : 'info',
            hint: this.zh ? '高于阈值网格占比——图样是否成斑' : 'fraction above threshold — is a pattern formed at all',
          },
          {
            key: 'finite',
            label: this.zh ? '数值有限性' : 'Finiteness',
            value: finite ? (this.zh ? '正常' : 'OK') : this.zh ? '出现 NaN/Inf' : 'NaN/Inf',
            severity: finite ? 'ok' : 'error',
            hint: this.zh ? '全部网格点有限（无 NaN/Inf）' : 'all grid values finite (no NaN/Inf)',
          },
        ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Embedded numerics benchmarks (mass conservation / finiteness / spots). */
  private runBenchmark() {
    // 1. Closed-reactor mass conservation (f = k = 0): Σ(u+v) drift < 1e-10 relative.
    const gsC = createState(48);
    seedRandom(gsC, 7, 8);
    const m0 = totalMassSafe(gsC);
    stepN(gsC, { f: 0, k: 0, du: 0.16, dv: 0.08, dt: 0.5 }, 300);
    const drift = Math.abs(totalMassSafe(gsC) - m0) / m0;
    // 2. Finiteness: standard parameters, 5000 steps on 64².
    const gsF = createState(64);
    seedCenter(gsF, 0.5);
    stepN(gsF, { f: 0.03, k: 0.062, du: 0.16, dv: 0.08, dt: 1.0 }, 5000);
    const finite = isFiniteState(gsF);
    // 3. Qualitative Pearson spot anchor at (f,k)=(0.030,0.062).
    const stats = fieldStats(gsF, 'v', 0.15, 8);
    const spotLike = stats.coverage > 0.002 && stats.coverage < 0.4 && stats.std > 0.05 && stats.autocorr < 0.95;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-mass',
        label: this.zh ? '基准 · 封闭体系质量漂移' : 'Bench · closed-mass drift',
        value: drift.toExponential(2),
        severity: drift < 1e-10 ? 'ok' : 'warn',
        hint: this.zh ? 'f=k=0 时 Σ(u+v) 相对漂移，阈值 1e-10' : 'relative Σ(u+v) drift at f=k=0, threshold 1e-10',
      },
      {
        key: 'bench-finite',
        label: this.zh ? '基准 · 5000 步有限性' : 'Bench · 5000-step finiteness',
        value: finite ? (this.zh ? '通过' : 'pass') : this.zh ? '失败' : 'fail',
        severity: finite ? 'ok' : 'error',
        hint: this.zh ? 'f=0.030, k=0.062, 64×64, dt=1' : 'f=0.030, k=0.062, 64×64, dt=1',
      },
      {
        key: 'bench-spots',
        label: this.zh ? '基准 · 斑点区定性锚点' : 'Bench · spot-regime anchor',
        value: spotLike ? (this.zh ? '斑点状' : 'spot-like') : (this.zh ? '异常' : 'unexpected'),
        severity: spotLike ? 'ok' : 'warn',
        hint: this.zh
          ? `覆盖率 ${(stats.coverage * 100).toFixed(2)}%、σ=${stats.std.toFixed(3)}、自相关=${stats.autocorr.toFixed(3)}（定性判据）`
          : `coverage ${(stats.coverage * 100).toFixed(2)}%, σ=${stats.std.toFixed(3)}, autocorr=${stats.autocorr.toFixed(3)} (qualitative)`,
      },
    ];
    this.publish(true, metrics);
    notify(
      this.api,
      drift < 1e-10 && finite && spotLike ? 'success' : 'warning',
      `Benchmarks: mass drift ${drift.toExponential(1)}, finiteness ${finite ? 'OK' : 'FAIL'}, spot anchor ${spotLike ? 'OK' : 'unexpected'}`,
      `基准对拍：质量漂移 ${drift.toExponential(1)}，有限性 ${finite ? '通过' : '失败'}，斑点锚点 ${spotLike ? '符合' : '异常'}`,
    );
  }

  // ---- drawing -----------------------------------------------------------------

  private async sendToFigure(): Promise<void> {
    if (!this.gs) {
      notify(this.api, 'warning', 'No pattern state yet — run the reactor first.', '暂无图样状态 — 请先运行反应器。');
      return;
    }
    const stats = fieldStats(this.gs, 'v', 0.15, 6);
    const caption: Bilingual = {
      zh: `Gray–Scott 图灵图样（f=${this.state.f}，k=${this.state.k}）：演化 ${this.gs.steps} 步，平均 v=${stats.mean.toFixed(4)}，斑点覆盖率 v>0.15 为 ${(stats.coverage * 100).toFixed(2)}%。`,
      en: `Gray–Scott Turing pattern (f=${this.state.f}, k=${this.state.k}): ${this.gs.steps} steps, mean v=${stats.mean.toFixed(4)}, spot coverage (v>0.15) ${(stats.coverage * 100).toFixed(2)}%.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: 'Gray–Scott 图灵图样', en: 'Gray–Scott Turing Pattern' },
      caption,
      turingFigurePanels({ state: this.gs }),
    );
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.gs) this.ensureState();
    const gs = this.gs;
    if (!gs) return;
    const size = Math.min(canvas.width, canvas.height - 40);
    const ox = Math.floor((canvas.width - size) / 2);

    // offscreen n×n ImageData → scaled crisp drawImage
    if (!this.off || this.off.width !== gs.n) {
      this.off = document.createElement('canvas');
      this.off.width = gs.n;
      this.off.height = gs.n;
      const octx = this.off.getContext('2d');
      this.image = octx ? octx.createImageData(gs.n, gs.n) : null;
    }
    const octx = this.off.getContext('2d');
    const img = this.image;
    if (octx && img) {
      const data = img.data;
      const cm = this.state.colormap;
      for (let i = 0; i < gs.n * gs.n; i += 1) {
        const t = gs.v[i]! / 0.4; // v saturates around 0.25–0.4 in all regimes
        const [r, gg, b] = colormapAt(cm, t);
        const o = i * 4;
        data[o] = r;
        data[o + 1] = gg;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(this.off, ox, 4, size, size);
    }

    // footer
    const { clamped } = this.stableParams();
    const preset = GRAY_SCOTT_PRESETS.find((p) => p.f === this.state.f && p.k === this.state.k);
    g.font = `11px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = this.zh
      ? `f=${this.state.f}  k=${this.state.k}  Du=${this.state.du}  Dv=${this.state.dv}  dt=${this.state.dt}${clamped ? '（已钳制）' : ''}  网格 ${gs.n}×${gs.n}  步数 ${gs.steps}${preset ? `  ·  ${this.zh ? '预设' : 'preset'}: ${this.zh ? preset.zh : preset.en}` : ''}`
      : `f=${this.state.f}  k=${this.state.k}  Du=${this.state.du}  Dv=${this.state.dv}  dt=${this.state.dt}${clamped ? ' (clamped)' : ''}  grid ${gs.n}×${gs.n}  steps ${gs.steps}${preset ? `  ·  preset: ${preset.en}` : ''}`;
    g.fillText(l1, 12, canvas.height - 22);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(
      this.zh
        ? 'Gray–Scott：∂u=Du∇²u−uv²+f(1−u)，∂v=Dv∇²v+uv²−(f+k)v · FTCS · 周期边界'
        : 'Gray–Scott: ∂u=Du∇²u−uv²+f(1−u), ∂v=Dv∇²v+uv²−(f+k)v · FTCS · periodic',
      12,
      canvas.height - 6,
    );
  }
}

/** totalMass with a finite guard (never propagate NaN into a metric). */
function totalMassSafe(state: GrayScottState): number {
  const m = totalMass(state);
  return Number.isFinite(m) ? m : Number.NaN;
}

export default function createChemTuringPlugin(): Plugin {
  return new ChemTuringPlugin();
}
