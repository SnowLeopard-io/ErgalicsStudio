// ==========================================================================
// math-domaincolor — complex function domain coloring laboratory
//
// Renders f(z) per pixel with hue = arg f and log-magnitude brightness bands
// (see kernel.ts for the parser, winding number and shading numerics). The
// image is rasterized offscreen at ≤ 600×450 and stretched onto the plugin
// canvas, so zoom/pan stay interactive. The science strip reports the
// argument-principle winding count on the inscribed circle of the view
// (zeros − poles) together with the view center and span; malformed
// expressions clear the strip and draw the parser error instead.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { mathDomaincolorManifest } from './manifest';
import { compileComplex, runDomaincolorBenchmarks, shadePixel, windingCount, windingNumber, cx } from './kernel';

export { mathDomaincolorManifest } from './manifest';

interface State {
  expr: string;
  centerRe: number;
  centerIm: number;
  /** Full height of the view along the imaginary axis. */
  spanY: number;
  contour: boolean;
}

interface Preset {
  key: string;
  expr: string;
  labelEn: string;
  labelZh: string;
}

const PRESETS: Preset[] = [
  { key: 'presetZ3', expr: 'z^3 - 1', labelEn: 'Preset: z³ − 1', labelZh: '预设：z³ − 1' },
  { key: 'presetRational', expr: '(z^2 - 1)/(z^2 + 1)', labelEn: 'Preset: rational', labelZh: '预设：有理函数' },
  { key: 'presetEssential', expr: 'exp(1/z)', labelEn: 'Preset: exp(1/z)', labelZh: '预设：exp(1/z)' },
  { key: 'presetSinc', expr: 'sin(z)/z', labelEn: 'Preset: sin(z)/z', labelZh: '预设：sin(z)/z' },
];

const DEFAULT_VIEW: Pick<State, 'centerRe' | 'centerIm' | 'spanY'> = { centerRe: 0, centerIm: 0, spanY: 4 };

export class MathDomaincolorPlugin implements Plugin {
  readonly manifest = mathDomaincolorManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    expr: 'z^3 - 1',
    ...DEFAULT_VIEW,
    contour: true,
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
    const fns =
      this.zh
        ? 'exp / ln / sin / cos / tan / sinh / cosh / tanh / sqrt / abs / arg / conj / re / im'
        : 'exp / ln / sin / cos / tan / sinh / cosh / tanh / sqrt / abs / arg / conj / re / im';
    return [
      {
        key: 'expr',
        label: 'f(z) expression',
        labelI18n: { 'zh-CN': 'f(z) 表达式', 'en-US': 'f(z) expression' },
        type: 'text',
        value: this.state.expr,
        placeholder: 'e.g. z^3 - 1',
        hint: this.zh
          ? `变量 z；常量 i、pi、e；支持 + − * / ^、隐式乘法（如 2i）与函数：${fns}`
          : `variable z; constants i, pi, e; + − * / ^, implicit multiplication (2i) and: ${fns}`,
      },
      ...PRESETS.map((p) => actionButton(p.key, p.labelEn, p.labelZh)),
      {
        key: 'contour',
        label: 'Magnitude contours',
        labelI18n: { 'zh-CN': '模长等值线', 'en-US': 'Magnitude contours' },
        type: 'checkbox',
        value: this.state.contour,
        hint: this.zh
          ? '在 |f| = 2^k 与 arg f = k·π/8 处压暗（极点白、零点黑）'
          : 'darken |f| = 2^k rings and arg f = k·π/8 sectors (poles white, zeros black)',
      },
      {
        key: 'centerRe',
        label: 'View center Re',
        labelI18n: { 'zh-CN': '视野中心 Re', 'en-US': 'View center Re' },
        type: 'number',
        min: -100,
        max: 100,
        step: 0.05,
        value: this.state.centerRe,
      },
      {
        key: 'centerIm',
        label: 'View center Im',
        labelI18n: { 'zh-CN': '视野中心 Im', 'en-US': 'View center Im' },
        type: 'number',
        min: -100,
        max: 100,
        step: 0.05,
        value: this.state.centerIm,
      },
      {
        key: 'spanY',
        label: 'View height (Im span)',
        labelI18n: { 'zh-CN': '视野高度（虚轴跨度）', 'en-US': 'View height (Im span)' },
        type: 'number',
        min: 0.02,
        max: 60,
        step: 0.1,
        value: this.state.spanY,
      },
      actionButton('zoomIn', 'Zoom in ×1.5', '放大 ×1.5'),
      actionButton('zoomOut', 'Zoom out ×1.5', '缩小 ×1.5'),
      actionButton('resetView', 'Reset view', '重置视野'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.expr === 'string' && params.expr !== this.state.expr) {
      this.state.expr = params.expr;
      this.draw();
    }
    const num = (k: string, cb: (v: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    num('centerRe', (v) => {
      const x = Math.min(100, Math.max(-100, v));
      if (x === this.state.centerRe) return false;
      this.state.centerRe = x;
      return true;
    });
    num('centerIm', (v) => {
      const x = Math.min(100, Math.max(-100, v));
      if (x === this.state.centerIm) return false;
      this.state.centerIm = x;
      return true;
    });
    num('spanY', (v) => {
      const x = Math.min(60, Math.max(0.02, v));
      if (x === this.state.spanY) return false;
      this.state.spanY = x;
      return true;
    });
    if (typeof params.contour === 'boolean' && params.contour !== this.state.contour) {
      this.state.contour = params.contour;
      this.draw();
    }
    for (const p of PRESETS) {
      if (actionFired(params, p.key)) {
        this.state.expr = p.expr;
        this.draw();
      }
    }
    if (actionFired(params, 'zoomIn')) this.zoom(1 / 1.5);
    if (actionFired(params, 'zoomOut')) this.zoom(1.5);
    if (actionFired(params, 'resetView')) {
      this.state.centerRe = DEFAULT_VIEW.centerRe;
      this.state.centerIm = DEFAULT_VIEW.centerIm;
      this.state.spanY = DEFAULT_VIEW.spanY;
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
  }

  // ---- actions ---------------------------------------------------------------

  private zoom(factor: number) {
    this.state.spanY = Math.min(60, Math.max(0.02, this.state.spanY * factor));
    this.draw();
  }

  /** Run the embedded validation suite and publish one metric per benchmark. */
  private runBenchmark() {
    const bench = runDomaincolorBenchmarks();
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
        ? `All ${bench.length} domain-coloring benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项域着色基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  // ---- science outputs ---------------------------------------------------------

  private publishScience(winding: number, radius: number, spanX: number) {
    const metrics: ScienceMetric[] = [
      {
        key: 'winding',
        label: 'Winding (view loop)',
        value: Number.isFinite(winding) ? fmtMetric(winding) : '—',
        severity: Number.isFinite(winding) ? 'ok' : 'warn',
        hint: this.zh
          ? `辐角原理：以视野中心为圆心、半径 ${fmtMetric(radius)} 的内切圆上 f(z) 的绕数（零点数 − 极点数）；NaN 表示回路撞上零点/极点`
          : `argument principle: winding of f on the inscribed circle (center = view center, radius ${fmtMetric(radius)}); zeros − poles; NaN = loop hits a zero/pole`,
      },
      {
        key: 'view-center',
        label: 'View center',
        value: `${fmtMetric(this.state.centerRe)} ${this.state.centerIm < 0 ? '−' : '+'} ${fmtMetric(Math.abs(this.state.centerIm))}i`,
        severity: 'info',
        hint: this.zh ? '视野中心的复平面坐标' : 'complex-plane coordinates of the view center',
      },
      {
        key: 'view-span',
        label: 'View span',
        value: fmtMetric(this.state.spanY),
        unit: this.zh ? '单位' : 'units',
        severity: 'info',
        hint: this.zh
          ? `虚轴方向视野总高；实轴方向总宽 ${fmtMetric(spanX)}（保持像素等比）`
          : `full view height along Im; width ${fmtMetric(spanX)} along Re (square pixels)`,
      },
    ];
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

    const compiled = compileComplex(this.state.expr);
    if (!compiled.ok) {
      clearScienceOutputs(this.manifest.id);
      g.fillStyle = 'rgba(255,140,140,0.95)';
      g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(
        zh ? `表达式无法解析：${compiled.error}` : `Cannot parse expression: ${compiled.error}`,
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }
    const f = compiled.fn;

    // ---- offscreen raster (≤ 600×450, square pixels) ---------------------------
    const scale = Math.min(600 / canvas.width, 450 / canvas.height, 1);
    const w = Math.max(2, Math.round(canvas.width * scale));
    const h = Math.max(2, Math.round(canvas.height * scale));
    const spanY = this.state.spanY;
    const spanX = spanY * (w / h);
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const og = off.getContext('2d');
    if (!og) return;
    const img = og.createImageData(w, h);
    const data = img.data;
    let p = 0;
    for (let py = 0; py < h; py += 1) {
      const im = this.state.centerIm - ((py + 0.5) / h - 0.5) * spanY;
      for (let px = 0; px < w; px += 1) {
        const re = this.state.centerRe + ((px + 0.5) / w - 0.5) * spanX;
        const [r, gg, b] = shadePixel(f(cx(re, im)), this.state.contour);
        data[p] = r;
        data[p + 1] = gg;
        data[p + 2] = b;
        data[p + 3] = 255;
        p += 4;
      }
    }
    og.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(off, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
    this.api.reportDataScale(w * h);

    // ---- winding number on the inscribed circle ---------------------------------
    const center = cx(this.state.centerRe, this.state.centerIm);
    const radius = 0.35 * Math.min(spanX, spanY);
    const wRaw = windingNumber(f, center, radius);
    const wCnt = windingCount(f, center, radius);
    this.publishScience(wCnt, radius, spanX);

    // ---- overlay -------------------------------------------------------------------
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(240,244,250,0.92)';
    g.fillText(
      `f(z) = ${this.state.expr}${this.state.contour ? (zh ? '  （等值线）' : '  (contours)') : ''}`,
      canvas.width / 2,
      18,
    );
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(235,240,247,0.9)';
    const wTxt = Number.isFinite(wRaw)
      ? `${wCnt >= 0 ? '+' : ''}${wCnt}（精确值 ${wRaw.toFixed(3)}）`
      : `${wCnt >= 0 ? '+' : ''}${wCnt}（回路撞上零点/极点）`;
    g.fillText(
      zh
        ? `绕数=${wTxt}  半径=${radius.toFixed(3)}  视野中心=${this.state.centerRe.toFixed(2)}${this.state.centerIm < 0 ? '−' : '+'}${Math.abs(this.state.centerIm).toFixed(2)}i  高=${spanY.toFixed(3)}`
        : `winding=${wTxt}  r=${radius.toFixed(3)}  center=${this.state.centerRe.toFixed(2)}${this.state.centerIm < 0 ? '−' : '+'}${Math.abs(this.state.centerIm).toFixed(2)}i  height=${spanY.toFixed(3)}`,
      54,
      canvas.height - 14,
    );
  }
}

export default function createMathDomaincolorPlugin(): Plugin {
  return new MathDomaincolorPlugin();
}
