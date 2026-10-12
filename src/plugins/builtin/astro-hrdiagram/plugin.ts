// ==========================================================================
// astro-hrdiagram — Hertzsprung–Russell diagram workbench
//
// Draws the colour–magnitude scatter (B−V vs V, or absolute M_V when a
// Hipparcos parallax is available), overlays the empirical main-sequence
// reference band and the solar anchor, and reports the catalogue counts plus
// an observed main-sequence slope fit (0.3 ≤ B−V ≤ 1.0) against the
// reference slope. The distance-modulus conversion is validated against
// analytic anchors through an embedded benchmark.
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
import { astroHrdiagramManifest } from './manifest';
import { hrFigurePanels } from './figure';
import {
  HR_BENCHMARK,
  SUN_ANCHOR,
  absoluteMagnitude,
  fitDataMainSequence,
  mainSequenceMagnitude,
  mainSequenceSlope,
  parseStarTable,
  runHrBenchmark,
  type StarRecord,
} from './kernel';

export { astroHrdiagramManifest } from './manifest';

type MagnitudeMode = 'apparent' | 'absolute';

interface State {
  mode: MagnitudeMode;
  plxMinMas: number;
  magMin: number;
  magMax: number;
  showMs: boolean;
  showSun: boolean;
}

export class AstroHrdiagramPlugin implements Plugin {
  readonly manifest = astroHrdiagramManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private stars: StarRecord[] | null = null;

  private state: State = {
    mode: 'absolute',
    plxMinMas: 3,
    magMin: -2,
    magMax: 12,
    showMs: true,
    showSun: true,
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
    const s = this.state;
    return [
      {
        key: 'mode',
        label: 'Magnitude',
        labelI18n: { 'zh-CN': '星等模式', 'en-US': 'Magnitude mode' },
        type: 'select',
        options: [
          {
            value: 'absolute',
            label: this.zh ? '绝对星等 M_V（需视差）' : 'Absolute M_V (needs parallax)',
            labelI18n: { 'zh-CN': '绝对星等 M_V（需视差）', 'en-US': 'Absolute M_V (needs parallax)' },
          },
          {
            value: 'apparent',
            label: this.zh ? '视星等 V' : 'Apparent V',
            labelI18n: { 'zh-CN': '视星等 V', 'en-US': 'Apparent V' },
          },
        ],
        value: s.mode,
      },
      {
        key: 'plxMinMas',
        label: 'Parallax cut (mas)',
        labelI18n: { 'zh-CN': '视差截断 (mas)', 'en-US': 'Parallax cut (mas)' },
        type: 'range',
        min: 0,
        max: 100,
        step: 1,
        value: s.plxMinMas,
        hint: this.zh ? '绝对模式下剔除 π 低于该值的星（0 = 不剔除）' : 'drop stars with π below this in absolute mode (0 = keep all)',
      },
      {
        key: 'magMin',
        label: 'Mag min',
        labelI18n: { 'zh-CN': '星等下限', 'en-US': 'Mag min' },
        type: 'range',
        min: -12,
        max: 10,
        step: 0.5,
        value: s.magMin,
      },
      {
        key: 'magMax',
        label: 'Mag max',
        labelI18n: { 'zh-CN': '星等上限', 'en-US': 'Mag max' },
        type: 'range',
        min: -5,
        max: 18,
        step: 0.5,
        value: s.magMax,
      },
      {
        key: 'showMs',
        label: 'Main-sequence ref',
        labelI18n: { 'zh-CN': '主序参考线', 'en-US': 'Main-sequence reference' },
        type: 'checkbox',
        value: s.showMs,
      },
      {
        key: 'showSun',
        label: 'Sun anchor',
        labelI18n: { 'zh-CN': '太阳锚点', 'en-US': 'Sun anchor' },
        type: 'checkbox',
        value: s.showSun,
      },
      actionButton('benchmark', 'Run HR benchmark', '运行 HR 基准验证', 'primary'),
      actionButton('exportCsv', 'Export table CSV', '导出星表 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.mode === 'string' && (params.mode === 'absolute' || params.mode === 'apparent')) {
      if (params.mode !== this.state.mode) {
        this.state.mode = params.mode;
        this.publishStats();
        this.draw();
      }
    }
    const num = (k: 'plxMinMas' | 'magMin' | 'magMax', clamp: (n: number) => number): void => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v) && v !== this.state[k]) {
        this.state[k] = clamp(v);
        this.publishStats();
        this.draw();
      }
    };
    num('plxMinMas', (n) => Math.min(100, Math.max(0, n)));
    num('magMin', (n) => Math.min(10, Math.max(-12, n)));
    num('magMax', (n) => Math.max(this.state.magMin + 1, Math.min(18, n)));
    let redraw = false;
    if (typeof params.showMs === 'boolean' && params.showMs !== this.state.showMs) {
      this.state.showMs = params.showMs;
      redraw = true;
    }
    if (typeof params.showSun === 'boolean' && params.showSun !== this.state.showSun) {
      this.state.showSun = params.showSun;
      redraw = true;
    }
    if (redraw) this.draw();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv') && !low.endsWith('.txt')) {
      notify(this.api, 'warning', 'HR plugin accepts name,bv,v[,parallax] CSV/TSV/TXT.', 'HR 插件接受 name,bv,v[,parallax] 的 CSV/TSV/TXT。');
      return;
    }
    const text = await file.text();
    const stars = parseStarTable(text);
    if (stars.length < 5) {
      notify(this.api, 'warning', 'Need ≥5 usable rows (name,bv,v[,parallax]).', '至少需要 5 行有效数据（name,bv,v[,parallax]）。');
      return;
    }
    this.stars = stars;
    this.publishStats();
    notify(
      this.api,
      'success',
      `Loaded ${stars.length} stars (${stars.filter((s) => s.parallax !== null).length} with parallax).`,
      `已加载 ${stars.length} 颗星（其中 ${stars.filter((s) => s.parallax !== null).length} 颗含视差）。`,
    );
    this.draw();
  }

  /** Publish catalogue statistics and the main-sequence slope comparison. */
  private publishStats() {
    const stars = this.stars;
    if (!stars || stars.length === 0) return;
    const nPlx = stars.filter((s) => s.parallax !== null && s.parallax > 0).length;
    const refSlope = mainSequenceSlope(0.3, 1.0);
    const metrics: ScienceMetric[] = [
      {
        key: 'n-stars',
        label: 'Stars',
        value: String(stars.length),
        severity: 'info',
        hint: this.zh ? `其中 ${nPlx} 颗含正视差` : `${nPlx} with a positive parallax`,
      },
      {
        key: 'sun-anchor',
        label: 'Sun anchor',
        value: this.zh ? 'B−V=0.65, M_V=4.83 ✓' : 'B−V=0.65, M_V=4.83 ✓',
        severity: 'ok',
        hint: this.zh ? '太阳锚点自检（IAU 名义值，恒真校验 + 落线检查见基准）' : 'solar anchor self-check (nominal IAU values; on-line check in the benchmark)',
      },
      {
        key: 'ms-ref-slope',
        label: 'MS ref slope',
        value: fmtMetric(refSlope.slope),
        unit: 'mag/mag',
        severity: 'info',
        hint: this.zh
          ? `参考节点在 0.3≤B−V≤1.0 段的最小二乘斜率（n=${refSlope.n}）；粗略教科书线性式 M_V≈2.5(B−V)+4.5 斜率仅 2.5，明显偏平`
          : `least-squares slope of the class-V knots over 0.3≤B−V≤1.0 (n=${refSlope.n}); the crude textbook linear form M_V≈2.5(B−V)+4.5 has a much flatter slope of 2.5`,
      },
    ];
    if (this.state.mode === 'absolute') {
      const fit = fitDataMainSequence(this.visibleStars());
      if (fit) {
        // Compare against the reference knots over the SAME fitted colour span.
        const refFit = mainSequenceSlope(fit.bvMin, fit.bvMax);
        const dev = Math.abs(fit.slope - refFit.slope) / Math.abs(refFit.slope);
        metrics.push({
          key: 'ms-data-slope',
          label: 'MS data slope',
          value: `${fmtMetric(fit.slope)} (n=${fit.n}, rms=${fmtMetric(fit.rms)})`,
          unit: 'mag/mag',
          severity: dev < 0.5 ? 'ok' : 'warn',
          hint: this.zh
            ? `主序成员筛查（全色段 |M_V−参考|<1.5 mag，剔除 ${fit.screenedOut} 颗巨星/污染星，B−V∈[${fit.bvMin.toFixed(2)}, ${fit.bvMax.toFixed(2)}]）后的样本拟合斜率；同色域参考斜率 ${fmtMetric(refFit.slope)}，相对偏差 ${fmtMetric(dev * 100)}%`
            : `slope of the membership-screened sample (full colour range, |M_V − ref| < 1.5 mag, ${fit.screenedOut} giants screened out, B−V∈[${fit.bvMin.toFixed(2)}, ${fit.bvMax.toFixed(2)}]); reference slope over the same span ${fmtMetric(refFit.slope)}, relative deviation ${fmtMetric(dev * 100)}%`,
        });
      }
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const b = runHrBenchmark();
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-10pc',
        label: 'DM @10pc',
        value: fmtMetric(b.err10pc),
        unit: 'mag',
        severity: b.err10pc < 1e-9 ? 'ok' : 'warn',
        hint: this.zh
          ? `距离模数锚点：V=${HR_BENCHMARK.anchor10pc.v}、π=0.1″(10 pc) 应得 M_V=4.83，|偏差|=${fmtMetric(b.err10pc)}`
          : `distance-modulus anchor: V=${HR_BENCHMARK.anchor10pc.v} at π=0.1″ (10 pc) must give M_V=4.83, |dev|=${fmtMetric(b.err10pc)}`,
      },
      {
        key: 'bench-proxima',
        label: 'DM @0.7687″',
        value: fmtMetric(b.errProxima),
        unit: 'mag',
        severity: b.errProxima < 1e-3 ? 'ok' : 'warn',
        hint: this.zh
          ? `V=0.401、π=0.7687″（比邻星视差）应得 M_V=4.8301，|偏差|=${fmtMetric(b.errProxima)}（阈值 1e-3）`
          : `V=0.401 at the Proxima-Centauri parallax 0.7687″ must give M_V=4.8301, |dev|=${fmtMetric(b.errProxima)} (threshold 1e-3)`,
      },
      {
        key: 'bench-1pc',
        label: 'DM @1pc',
        value: fmtMetric(b.err1pc),
        unit: 'mag',
        severity: b.err1pc < 1e-9 ? 'ok' : 'warn',
        hint: this.zh ? '同一星置于 1 pc（π=1″）应亮 5 mag：M_V=9.83' : 'the same star at 1 pc (π=1″) is 5 mag brighter: M_V=9.83',
      },
      {
        key: 'bench-sun-ms',
        label: 'Sun on MS ref',
        value: fmtMetric(b.sunOnMsDeviation),
        unit: 'mag',
        severity: b.sunOnMsDeviation < HR_BENCHMARK.sunTolerance ? 'ok' : 'warn',
        hint: this.zh ? `太阳锚点 (0.65, 4.83) 与参考线偏差（阈值 ${HR_BENCHMARK.sunTolerance} mag）` : `solar anchor (0.65, 4.83) deviation from the reference (threshold ${HR_BENCHMARK.sunTolerance} mag)`,
      },
      {
        key: 'bench-ms-monotonic',
        label: 'MS monotonic',
        value: b.msMonotonic ? 'PASS' : 'FAIL',
        severity: b.msMonotonic && b.msMaxJump < 1e-9 ? 'ok' : 'warn',
        hint: this.zh ? `主序参考线严格单调递减且 C0 连续（最大折返 ${fmtMetric(b.msMaxJump)} mag）` : `reference strictly decreasing and C0-continuous (max jump ${fmtMetric(b.msMaxJump)} mag)`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.passed ? 'success' : 'warning',
      `HR benchmark ${b.passed ? 'PASS' : 'CHECK'}: 10pc err ${b.err10pc.toExponential(1)}, Proxima err ${b.errProxima.toExponential(1)}, sun/MS ${b.sunOnMsDeviation.toFixed(3)} mag`,
      `HR 基准${b.passed ? '通过' : '请检查'}：10pc 误差 ${b.err10pc.toExponential(1)}，比邻星锚点误差 ${b.errProxima.toExponential(1)}，太阳落线偏差 ${b.sunOnMsDeviation.toFixed(3)} mag`,
    );
  }

  private exportCsv() {
    const stars = this.stars;
    if (!stars || stars.length === 0) {
      notify(this.api, 'warning', 'No catalogue loaded yet.', '尚未载入星表。');
      return;
    }
    const rows: Array<Array<number | string>> = stars.map((s) => {
      const mv = s.parallax ? absoluteMagnitude(s.v, s.parallax) : NaN;
      return [s.name, s.bv, s.v, s.parallax ?? '', Number.isFinite(mv) ? Number(mv.toFixed(4)) : ''];
    });
    exportRowsCsv(this.api, 'hrd-catalogue', ['name', 'bv', 'v', 'parallax_arcsec', 'MV'], rows);
  }

  private async sendToFigure(): Promise<void> {
    if (!this.stars || this.stars.length === 0) {
      notify(this.api, 'warning', 'No catalogue loaded yet.', '尚未载入星表。');
      return;
    }
    const visible = this.visibleStars();
    if (visible.length === 0) {
      notify(this.api, 'warning', 'No stars pass the current magnitude/parallax filters.', '当前星等/视差筛选条件下没有可绘制的恒星。');
      return;
    }
    const nPlx = visible.filter((s) => s.parallax !== null && s.parallax > 0).length;
    let zhCap: string;
    let enCap: string;
    const fit = this.state.mode === 'absolute' ? fitDataMainSequence(visible) : null;
    if (fit) {
      const ref = mainSequenceSlope(fit.bvMin, fit.bvMax);
      zhCap = `赫罗图：共 ${this.stars.length} 颗星，绘制 ${visible.length} 颗（含视差 ${nPlx}）；主序数据斜率 ${fit.slope.toFixed(2)} mag/mag（n=${fit.n}）vs 同色域参考 ${ref.slope.toFixed(2)}。`;
      enCap = `HR diagram: ${this.stars.length} stars, ${visible.length} plotted (${nPlx} with parallax); data main-sequence slope ${fit.slope.toFixed(2)} mag/mag (n=${fit.n}) vs reference ${ref.slope.toFixed(2)} over the same colour span.`;
    } else {
      const kindZh = this.state.mode === 'absolute' ? '赫罗图' : '颜色-星等图';
      const kindEn = this.state.mode === 'absolute' ? 'HR diagram' : 'Colour–magnitude diagram';
      zhCap = `${kindZh}：共 ${this.stars.length} 颗星，绘制 ${visible.length} 颗（含视差 ${nPlx}）。`;
      enCap = `${kindEn}: ${this.stars.length} stars, ${visible.length} plotted (${nPlx} with parallax).`;
    }
    await pushPanelsToFigure(
      this.api,
      { zh: '赫罗图', en: 'Hertzsprung–Russell Diagram' },
      { zh: zhCap, en: enCap } satisfies Bilingual,
      hrFigurePanels({
        stars: visible,
        mode: this.state.mode,
        showMs: this.state.showMs,
        showSun: this.state.showSun,
      }),
    );
  }

  /** Stars passing the current filters (parallax cut applies in absolute mode). */
  private visibleStars(): StarRecord[] {
    const stars = this.stars ?? [];
    return stars.filter((s) => {
      const mag = this.magnitudeOf(s);
      if (!Number.isFinite(mag)) return false;
      if (mag < this.state.magMin || mag > this.state.magMax) return false;
      if (this.state.mode === 'absolute') {
        if (this.state.plxMinMas > 0 && (s.parallax === null || s.parallax * 1000 < this.state.plxMinMas)) return false;
      }
      return true;
    });
  }

  private magnitudeOf(s: StarRecord): number {
    if (this.state.mode === 'apparent') return s.v;
    return s.parallax ? absoluteMagnitude(s.v, s.parallax) : NaN;
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    if (!this.stars || this.stars.length === 0) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No star catalogue loaded',
        titleZh: '尚未载入星表',
        hint: 'Load a name,bv,v[,parallax] catalogue (CSV/TSV/TXT) — the bundled Yale BSC bright-star sample is a good start.',
        hintZh: '载入 name,bv,v[,parallax] 星表（CSV/TSV/TXT）——推荐使用内置的 Yale 亮星样本。',
      });
      return;
    }
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    this.drawDiagram(g, canvas, this.zh);
  }

  private drawDiagram(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const pts = this.visibleStars()
      .map((s) => ({ s, bv: s.bv, mag: this.magnitudeOf(s) }))
      .filter((p) => Number.isFinite(p.mag));
    const allBv = pts.map((p) => p.bv);
    let bvMin = Math.min(-0.35, ...(allBv.length ? allBv : [0]));
    let bvMax = Math.max(1.7, ...(allBv.length ? allBv : [1]));
    // Absolute mode must also frame the main-sequence reference and the Sun.
    const magsForFrame = pts.map((p) => p.mag);
    if (this.state.showMs || this.state.mode === 'absolute') {
      magsForFrame.push(mainSequenceMagnitude(bvMin) - 1, mainSequenceMagnitude(bvMax) + 1);
    }
    let magLo = Math.min(this.state.magMin, ...(magsForFrame.length ? magsForFrame : [0]));
    let magHi = Math.max(this.state.magMax, ...(magsForFrame.length ? magsForFrame : [10]));
    if (!(magHi > magLo)) magHi = magLo + 1;

    const padL = 56;
    const padR = 18;
    const padT = 46;
    const padB = 46;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const px = (bv: number) => x0 + ((x1 - x0) * (bv - bvMin)) / (bvMax - bvMin);
    // Bright (small magnitude) at the top — inverted magnitude axis.
    const py = (mag: number) => y1 - ((y1 - y0) * (mag - magLo)) / (magHi - magLo);

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const title =
      this.state.mode === 'absolute'
        ? zh
          ? '赫罗图 · B−V — 绝对星等 M_V'
          : 'Hertzsprung–Russell diagram · B−V vs M_V'
        : zh
          ? '颜色-星等图 · B−V — 视星等 V'
          : 'Colour–magnitude diagram · B−V vs V';
    g.fillText(title, canvas.width / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);

    // grid + ticks
    g.font = '10px Consolas, monospace';
    for (let i = 0; i <= 5; i += 1) {
      const mv = magLo + ((magHi - magLo) * i) / 5;
      const sy = py(mv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(mv.toFixed(1), x0 - 5, sy + 3);
      const bv = bvMin + ((bvMax - bvMin) * i) / 5;
      const sx = px(bv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.textAlign = 'center';
      g.fillText(bv.toFixed(2), sx, y1 + 12);
    }

    // main-sequence reference (dashed)
    if (this.state.showMs) {
      g.strokeStyle = 'rgba(255,210,130,0.85)';
      g.lineWidth = 1.6;
      g.setLineDash([6, 4]);
      g.beginPath();
      for (let i = 0; i <= 120; i += 1) {
        const bv = bvMin + ((bvMax - bvMin) * i) / 120;
        const mv = mainSequenceMagnitude(bv);
        if (i === 0) g.moveTo(px(bv), py(mv));
        else g.lineTo(px(bv), py(mv));
      }
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 1;
      g.textAlign = 'left';
      g.fillStyle = 'rgba(255,210,130,0.9)';
      g.fillText(zh ? '主序参考（光度型 V）' : 'main sequence (class V)', px(bvMin) + 4, py(mainSequenceMagnitude(bvMin)) - 6);
    }

    // stars
    for (const p of pts) {
      const hasPlx = p.s.parallax !== null && p.s.parallax > 0;
      g.fillStyle = hasPlx ? 'rgba(120,200,255,0.85)' : 'rgba(150,160,175,0.65)';
      g.beginPath();
      g.arc(px(p.bv), py(p.mag), 2.4, 0, Math.PI * 2);
      g.fill();
    }

    // Sun anchor
    if (this.state.showSun) {
      const sx = px(SUN_ANCHOR.bv);
      const sy = py(SUN_ANCHOR.mv);
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
        g.strokeStyle = 'rgba(255,240,180,0.95)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(sx, sy, 5, 0, Math.PI * 2);
        g.moveTo(sx - 8, sy);
        g.lineTo(sx + 8, sy);
        g.moveTo(sx, sy - 8);
        g.lineTo(sx, sy + 8);
        g.stroke();
        g.lineWidth = 1;
        g.fillStyle = 'rgba(255,240,180,0.95)';
        g.textAlign = 'left';
        g.fillText(zh ? '太阳 (0.65, 4.83)' : 'Sun (0.65, 4.83)', sx + 9, sy - 6);
      }
    }

    // axes labels
    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(this.state.mode === 'absolute' ? 'M_V' : 'V', x0 - 8, y0 - 6);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('B − V', x1 - 34, y1 + 28);

    // legend for point colours
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(120,200,255,0.85)';
    g.fillRect(x0 + 8, y0 + 8, 12, 4);
    g.fillStyle = 'rgba(190,205,225,0.9)';
    g.fillText(zh ? '含视差' : 'with parallax', x0 + 26, y0 + 12);
    g.fillStyle = 'rgba(150,160,175,0.65)';
    g.fillRect(x0 + 100, y0 + 8, 12, 4);
    g.fillStyle = 'rgba(190,205,225,0.9)';
    g.fillText(zh ? '无视差' : 'no parallax', x0 + 118, y0 + 12);

    // footer
    const plotted = pts.length;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(
      zh
        ? `共 ${(this.stars ?? []).length} 颗星，绘制 ${plotted} 颗 · 模式：${this.state.mode === 'absolute' ? '绝对星等 M_V = V + 5 + 5·log10(π″)' : '视星等 V'}`
        : `${(this.stars ?? []).length} stars, ${plotted} plotted · mode: ${this.state.mode === 'absolute' ? 'absolute M_V = V + 5 + 5·log10(π″)' : 'apparent V'}`,
      x0,
      canvas.height - 14,
    );
  }
}

export default function createAstroHrdiagramPlugin(): Plugin {
  return new AstroHrdiagramPlugin();
}
