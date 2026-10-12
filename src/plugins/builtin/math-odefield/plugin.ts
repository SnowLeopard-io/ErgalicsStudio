// ==========================================================================
// math-odefield — ODE vector field & streamline laboratory
//
// Renders the phase plane of a 2D autonomous system x′ = f(x,y), y′ = g(x,y):
// a direction-field arrow grid colored by speed, RK4 streamlines integrated
// in both time directions (see kernel.ts for the parser/RK4/Newton/eigen
// numerics), and equilibria found by Newton from a coarse grid, each marked
// by its Jacobian classification (saddle / node / spiral / center). The
// science strip reports every equilibrium with its position and eigenvalues.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { odefieldFigurePanels } from './figure';
import { mathOdefieldManifest } from './manifest';
import {
  classifyEquilibrium,
  compileReal2,
  eigenvalues2x2,
  integrateStream,
  newtonEquilibrium,
  numericJacobian,
  ODE_PRESETS,
  runOdefieldBenchmarks,
  type ComplexNum,
  type EquilibriumClass,
  type EquilibriumKind,
  type Stability,
  type VectorField,
} from './kernel';

export { mathOdefieldManifest } from './manifest';

interface State {
  system: string;
  fx: string;
  fy: string;
  /** RK4 step size. */
  h: number;
  /** RK4 steps per direction. */
  steps: number;
  /** Streamline seed grid side (seeds × seeds seeds). */
  seeds: number;
  /** View half-span along the x axis. */
  span: number;
}

interface EqItem {
  x: number;
  y: number;
  l1: ComplexNum;
  l2: ComplexNum;
  cls: EquilibriumClass;
}

const KIND_I18N: Record<EquilibriumKind, { en: string; zh: string }> = {
  saddle: { en: 'saddle', zh: '鞍点' },
  node: { en: 'node', zh: '结点' },
  spiral: { en: 'spiral', zh: '螺旋点' },
  center: { en: 'center', zh: '中心' },
  degenerate: { en: 'degenerate', zh: '退化平衡点' },
};

const STAB_I18N: Record<Stability, { en: string; zh: string }> = {
  source: { en: 'unstable (source)', zh: '不稳定（源）' },
  sink: { en: 'asymptotically stable (sink)', zh: '渐近稳定（汇）' },
  none: { en: 'unstable', zh: '不稳定' },
};

function fmtComplex(l: ComplexNum): string {
  const re = Math.abs(l.re) < 1e-12 ? 0 : l.re;
  const im = Math.abs(l.im) < 1e-12 ? 0 : l.im;
  if (im === 0) return fmtMetric(re);
  if (re === 0) return `${fmtMetric(im)}i`;
  return `${fmtMetric(re)} ${im < 0 ? '−' : '+'} ${fmtMetric(Math.abs(im))}i`;
}

const MAX_EQS = 6;

export class MathOdefieldPlugin implements Plugin {
  readonly manifest = mathOdefieldManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    system: 'lv',
    fx: ODE_PRESETS[0]!.fx,
    fy: ODE_PRESETS[0]!.fy,
    h: 0.01,
    steps: 160,
    seeds: 8,
    span: ODE_PRESETS[0]!.span,
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
    const systemOptions = [
      ...ODE_PRESETS.map((p) => ({
        value: p.id,
        label: this.zh ? p.labelZh : p.labelEn,
        labelI18n: { 'zh-CN': p.labelZh, 'en-US': p.labelEn },
      })),
      {
        value: 'custom',
        label: this.zh ? '自定义（编辑下方表达式）' : 'Custom (edit expressions below)',
        labelI18n: { 'zh-CN': '自定义（编辑下方表达式）', 'en-US': 'Custom (edit expressions below)' },
      },
    ];
    return [
      {
        key: 'system',
        label: 'System preset',
        labelI18n: { 'zh-CN': '系统预设', 'en-US': 'System preset' },
        type: 'select',
        options: systemOptions,
        value: this.state.system,
      },
      {
        key: 'fx',
        label: 'x′ = f(x, y)',
        labelI18n: { 'zh-CN': "x′ = f(x, y)", 'en-US': "x′ = f(x, y)" },
        type: 'text',
        value: this.state.fx,
        placeholder: 'e.g. x*(1.1 - 0.4*y)',
        hint: this.zh ? '变量 x、y；常量 pi、e；支持 + − * / ^、隐式乘法与 exp/ln/sin/cos/tan/sinh/cosh/tanh/sqrt/abs/atan' : 'variables x, y; constants pi, e; + − * / ^, implicit multiplication, exp/ln/sin/cos/tan/sinh/cosh/tanh/sqrt/abs/atan',
      },
      {
        key: 'fy',
        label: 'y′ = g(x, y)',
        labelI18n: { 'zh-CN': "y′ = g(x, y)", 'en-US': "y′ = g(x, y)" },
        type: 'text',
        value: this.state.fy,
        placeholder: 'e.g. y*(0.3*x - 0.9)',
      },
      {
        key: 'h',
        label: 'RK4 step h',
        labelI18n: { 'zh-CN': 'RK4 步长 h', 'en-US': 'RK4 step h' },
        type: 'number',
        min: 0.001,
        max: 0.05,
        step: 0.001,
        value: this.state.h,
      },
      {
        key: 'steps',
        label: 'Steps per direction',
        labelI18n: { 'zh-CN': '每方向积分步数', 'en-US': 'Steps per direction' },
        type: 'range',
        min: 40,
        max: 400,
        step: 10,
        value: this.state.steps,
      },
      {
        key: 'seeds',
        label: 'Streamline seeds',
        labelI18n: { 'zh-CN': '流线种子数', 'en-US': 'Streamline seeds' },
        type: 'range',
        min: 4,
        max: 16,
        step: 1,
        value: this.state.seeds,
        hint: this.zh ? '种子按 seeds × seeds 网格均匀铺满视野，正反向各积分一次' : 'seeds laid on a seeds × seeds grid, integrated forward and backward',
      },
      {
        key: 'span',
        label: 'View half-span (x)',
        labelI18n: { 'zh-CN': '视野半宽（x 轴）', 'en-US': 'View half-span (x)' },
        type: 'number',
        min: 1,
        max: 30,
        step: 0.5,
        value: this.state.span,
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (v: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    num('h', (v) => {
      const x = Math.min(0.05, Math.max(0.001, v));
      if (x === this.state.h) return false;
      this.state.h = x;
      return true;
    });
    num('steps', (v) => {
      const x = Math.round(Math.min(400, Math.max(40, v)));
      if (x === this.state.steps) return false;
      this.state.steps = x;
      return true;
    });
    num('seeds', (v) => {
      const x = Math.round(Math.min(16, Math.max(4, v)));
      if (x === this.state.seeds) return false;
      this.state.seeds = x;
      return true;
    });
    num('span', (v) => {
      const x = Math.min(30, Math.max(1, v));
      if (x === this.state.span) return false;
      this.state.span = x;
      return true;
    });
    if (typeof params.fx === 'string' && params.fx !== this.state.fx) {
      this.state.fx = params.fx;
      this.draw();
    }
    if (typeof params.fy === 'string' && params.fy !== this.state.fy) {
      this.state.fy = params.fy;
      this.draw();
    }
    if (typeof params.system === 'string' && params.system !== this.state.system) {
      const preset = ODE_PRESETS.find((p) => p.id === params.system);
      this.state.system = params.system;
      if (preset) {
        this.state.fx = preset.fx;
        this.state.fy = preset.fy;
        this.state.span = preset.span;
      }
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- actions ---------------------------------------------------------------

  /** Run the embedded validation suite and publish one metric per benchmark. */
  private runBenchmark() {
    const bench = runOdefieldBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: this.zh ? b.detailZh : b.detailEn,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} ODE-field benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项 ODE 向量场基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  /** Build the phase-portrait + time-series panels and push them into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    const cfx = compileReal2(this.state.fx);
    const cfy = compileReal2(this.state.fy);
    if (!cfx.ok || !cfy.ok) {
      notify(this.api, 'warning', 'Cannot parse the expressions — fix f or g first.', '表达式无法解析——请先修正 f 或 g。');
      return;
    }
    const f: VectorField = (x, y) => [cfx.fn(x, y), cfy.fn(x, y)];
    const eqs = this.findEquilibria(f, this.state.span, this.state.span);
    const first = eqs[0];
    const eqZh = first
      ? `${eqs.length} 个（距原点最近：(${fmtMetric(first.x)}, ${fmtMetric(first.y)})，${KIND_I18N[first.cls.kind].zh}）`
      : '0 个（视野内未找到）';
    const eqEn = first
      ? `${eqs.length} (nearest origin: (${fmtMetric(first.x)}, ${fmtMetric(first.y)}), ${KIND_I18N[first.cls.kind].en})`
      : '0 (none found in view)';
    const caption: Bilingual = {
      zh: `ODE 向量场相平面（x′=${this.state.fx}，y′=${this.state.fy}；RK4 h=${this.state.h}，每方向 ${this.state.steps} 步）：平衡点 ${eqZh}。`,
      en: `ODE phase portrait (x′=${this.state.fx}, y′=${this.state.fy}; RK4 h=${this.state.h}, ${this.state.steps} steps/direction): equilibria ${eqEn}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: 'ODE 向量场相平面', en: 'ODE Phase Portrait' },
      caption,
      odefieldFigurePanels({
        f,
        h: this.state.h,
        steps: this.state.steps,
        span: this.state.span,
        equilibria: eqs.map((e) => ({ x: e.x, y: e.y, kind: e.cls.kind, stability: e.cls.stability })),
      }),
    );
  }

  // ---- numerics + science outputs ---------------------------------------------

  private findEquilibria(f: VectorField, xHalf: number, yHalf: number): EqItem[] {
    const found: EqItem[] = [];
    const dedup = this.state.span * 0.02;
    const starts: Array<[number, number]> = [[0, 0]];
    const G = 5;
    for (let i = 0; i < G; i += 1) {
      for (let j = 0; j < G; j += 1) {
        starts.push([-xHalf + ((i + 0.5) * 2 * xHalf) / G, -yHalf + ((j + 0.5) * 2 * yHalf) / G]);
      }
    }
    for (const [sx, sy] of starts) {
      const eq = newtonEquilibrium(f, sx, sy);
      if (!eq.converged) continue;
      if (Math.abs(eq.x) > xHalf * 1.5 || Math.abs(eq.y) > yHalf * 1.5) continue;
      if (found.some((p) => Math.hypot(p.x - eq.x, p.y - eq.y) < dedup)) continue;
      const [a, b, c, d] = numericJacobian(f, eq.x, eq.y);
      const [l1, l2] = eigenvalues2x2(a, b, c, d);
      found.push({ x: eq.x, y: eq.y, l1, l2, cls: classifyEquilibrium(a, b, c, d) });
      if (found.length >= MAX_EQS) break;
    }
    found.sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y));
    return found;
  }

  private publishScience(eqs: EqItem[]) {
    const zh = this.zh;
    const metrics: ScienceMetric[] = [];
    if (eqs.length === 0) {
      metrics.push({
        key: 'equilibria',
        label: 'Equilibria',
        value: '0',
        severity: 'info',
        hint: zh
          ? '视野内未找到平衡点（牛顿法从 5×5 网格起点出发，容差 ‖f‖ < 1e-12）'
          : 'no equilibrium found in view (Newton from a 5×5 grid of starts, tolerance ‖f‖ < 1e-12)',
      });
    }
    for (let i = 0; i < eqs.length; i += 1) {
      const eq = eqs[i]!;
      const kind = zh ? KIND_I18N[eq.cls.kind].zh : KIND_I18N[eq.cls.kind].en;
      const stab = zh ? STAB_I18N[eq.cls.stability].zh : STAB_I18N[eq.cls.stability].en;
      metrics.push({
        key: `eq${i}-pos`,
        label: `${zh ? '平衡点' : 'Equilibrium'} #${i + 1}`,
        value: `(${fmtMetric(eq.x)}, ${fmtMetric(eq.y)})`,
        severity: 'ok',
        hint: `${kind} · ${stab}`,
      });
      metrics.push({
        key: `eq${i}-eig`,
        label: `${zh ? '特征值' : 'Eigenvalues'} #${i + 1}`,
        value: `${fmtComplex(eq.l1)}, ${fmtComplex(eq.l2)}`,
        severity: eq.cls.stability === 'sink' ? 'ok' : 'info',
        hint: zh
          ? `${kind}（雅可比 trace = ${fmtMetric(eq.cls.trace)}，det = ${fmtMetric(eq.cls.det)}）`
          : `${kind} (Jacobian trace = ${fmtMetric(eq.cls.trace)}, det = ${fmtMetric(eq.cls.det)})`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing ------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = this.zh;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const cfx = compileReal2(this.state.fx);
    const cfy = compileReal2(this.state.fy);
    if (!cfx.ok || !cfy.ok) {
      clearScienceOutputs(this.manifest.id);
      let err = 'unknown parse error';
      if (!cfx.ok) err = cfx.error;
      else if (!cfy.ok) err = cfy.error;
      g.fillStyle = 'rgba(255,140,140,0.95)';
      g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(
        zh ? `表达式无法解析：${err}` : `Cannot parse expression: ${err}`,
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }
    const f: VectorField = (x, y) => [cfx.fn(x, y), cfy.fn(x, y)];

    // view window (square pixels: y half-span follows the canvas aspect)
    const xHalf = this.state.span;
    const yHalf = (xHalf * canvas.height) / canvas.width;
    const px = (x: number) => ((x + xHalf) / (2 * xHalf)) * canvas.width;
    const py = (y: number) => ((yHalf - y) / (2 * yHalf)) * canvas.height;

    // ---- direction field arrows -------------------------------------------------
    const cols = 24;
    const rows = Math.max(6, Math.round((cols * canvas.height) / canvas.width));
    let maxSpeed = 0;
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const x = -xHalf + ((i + 0.5) * 2 * xHalf) / cols;
        const y = -yHalf + ((j + 0.5) * 2 * yHalf) / rows;
        const [vx, vy] = f(x, y);
        if (Number.isFinite(vx) && Number.isFinite(vy)) maxSpeed = Math.max(maxSpeed, Math.hypot(vx, vy));
      }
    }
    const speedHue = (s: number): string => {
      const t = maxSpeed > 0 ? Math.min(1, s / maxSpeed) : 0;
      return `hsl(${Math.round(220 - 200 * t)}, 85%, 62%)`;
    };

    const cw = canvas.width / cols;
    const ch = canvas.height / rows;
    const L = Math.min(cw, ch) * 0.42;
    g.lineWidth = 1.5;
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const x = -xHalf + ((i + 0.5) * 2 * xHalf) / cols;
        const y = -yHalf + ((j + 0.5) * 2 * yHalf) / rows;
        const [vx, vy] = f(x, y);
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
        const s = Math.hypot(vx, vy);
        if (s < 1e-12) continue;
        const ux = vx / s;
        const uy = -vy / s; // screen y is flipped
        const cxp = px(x);
        const cyp = py(y);
        g.strokeStyle = speedHue(s);
        g.beginPath();
        g.moveTo(cxp - (ux * L) / 2, cyp - (uy * L) / 2);
        g.lineTo(cxp + (ux * L) / 2, cyp + (uy * L) / 2);
        const hx = cxp + (ux * L) / 2;
        const hy = cyp + (uy * L) / 2;
        g.moveTo(hx, hy);
        g.lineTo(hx - (ux * 0.45 + -uy * 0.35) * (L * 0.5), hy - (uy * 0.45 + ux * 0.35) * (L * 0.5));
        g.moveTo(hx, hy);
        g.lineTo(hx - (ux * 0.45 - -uy * 0.35) * (L * 0.5), hy - (uy * 0.45 - ux * 0.35) * (L * 0.5));
        g.stroke();
      }
    }

    // ---- streamlines (both directions, colored by initial speed) ----------------
    const ns = this.state.seeds;
    g.lineWidth = 1.6;
    g.globalAlpha = 0.85;
    for (let i = 0; i < ns; i += 1) {
      for (let j = 0; j < ns; j += 1) {
        const x0 = -xHalf + ((i + 0.5) * 2 * xHalf) / ns;
        const y0 = -yHalf + ((j + 0.5) * 2 * yHalf) / ns;
        const [v0x, v0y] = f(x0, y0);
        const s0 = Math.hypot(v0x, v0y);
        if (!Number.isFinite(s0) || s0 < 1e-9) continue;
        g.strokeStyle = speedHue(s0);
        for (const dir of [1, -1]) {
          const pts = integrateStream(f, x0, y0, dir * this.state.h, this.state.steps);
          g.beginPath();
          for (let k = 0; k < pts.length; k += 1) {
            const p = pts[k]!;
            if (k === 0) g.moveTo(px(p.x), py(p.y));
            else g.lineTo(px(p.x), py(p.y));
          }
          g.stroke();
        }
      }
    }
    g.globalAlpha = 1;

    // ---- equilibria: Newton + Jacobian classification ---------------------------
    const eqs = this.findEquilibria(f, xHalf, yHalf);
    this.publishScience(eqs);
    for (const eq of eqs) {
      const X = px(eq.x);
      const Y = py(eq.y);
      const R = 9;
      g.lineWidth = 2;
      const isSink = eq.cls.stability === 'sink';
      switch (eq.cls.kind) {
        case 'node':
        case 'spiral': {
          g.strokeStyle = isSink ? '#6db4ff' : '#ff7a7a';
          const dir = isSink ? -1 : 1;
          g.beginPath();
          g.moveTo(X, Y + dir * R);
          g.lineTo(X + R * 0.9, Y - dir * R * 0.7);
          g.lineTo(X - R * 0.9, Y - dir * R * 0.7);
          g.closePath();
          g.stroke();
          break;
        }
        case 'saddle':
          g.strokeStyle = '#f5a623';
          g.beginPath();
          g.moveTo(X - R * 0.8, Y - R * 0.8);
          g.lineTo(X + R * 0.8, Y + R * 0.8);
          g.moveTo(X + R * 0.8, Y - R * 0.8);
          g.lineTo(X - R * 0.8, Y + R * 0.8);
          g.stroke();
          break;
        case 'center':
          g.strokeStyle = '#4be1c3';
          g.beginPath();
          g.arc(X, Y, R * 0.8, 0, 2 * Math.PI);
          g.stroke();
          break;
        default:
          g.strokeStyle = 'rgba(200,210,225,0.9)';
          g.beginPath();
          g.moveTo(X, Y - R * 0.8);
          g.lineTo(X + R * 0.8, Y);
          g.lineTo(X, Y + R * 0.8);
          g.lineTo(X - R * 0.8, Y);
          g.closePath();
          g.stroke();
      }
      g.font = `10px Consolas, monospace`;
      g.fillStyle = 'rgba(235,240,247,0.92)';
      g.fillText(`(${eq.x.toFixed(2)}, ${eq.y.toFixed(2)})`, X + R + 3, Y - R - 2);
    }

    // ---- title + footer ------------------------------------------------------------
    const preset = ODE_PRESETS.find((p) => p.id === this.state.system);
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(240,244,250,0.92)';
    g.fillText(
      `x′ = ${this.state.fx}   y′ = ${this.state.fy}${preset ? (zh ? `   （${preset.labelZh}）` : `   (${preset.labelEn})`) : ''}`,
      canvas.width / 2,
      18,
    );
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(
      zh
        ? `h=${this.state.h}  步数=${this.state.steps}×2  平衡点=${eqs.length}  箭头=方向场（颜色=速度，蓝慢→红快）`
        : `h=${this.state.h}  steps=${this.state.steps}×2  equilibria=${eqs.length}  arrows=direction field (color=speed, slow→fast)`,
      54,
      canvas.height - 14,
    );
  }
}

export default function createMathOdefieldPlugin(): Plugin {
  return new MathOdefieldPlugin();
}
