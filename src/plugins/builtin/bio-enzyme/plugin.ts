// ==========================================================================
// bio-enzyme — Michaelis-Menten enzyme kinetics laboratory
//
// A 2-D scientific workbench: draws the v–[S] saturation curve for the
// substrate and overlays the three textbook inhibition families (competitive /
// non-competitive / uncompetitive) from the current [I]/Ki; then back-fits
// Vmax & Km from a deterministic noisy dataset with Levenberg-Marquardt and
// reports kcat, catalytic efficiency, R² and RMSE. Lineweaver-Burk linearised
// plot and raw data are one click into Figure Studio via CSV export.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportCanvasPng, exportRowsCsv, notify } from '../shared/enhance';
import { bioEnzymeManifest } from './manifest';
import {
  DEFAULT_RATE_PARAMS,
  DEFAULT_S_SUBSTRATES,
  apparentParams,
  derivedKinetics,
  fitMichaelisMenten,
  initialRate,
  lineweaverBurkX,
  lineweaverBurkY,
  parseRateData,
  reportFit,
  synthesizeRates,
  type FitPoint,
  type InhibitionMode,
  type RateParams,
} from './kinetics';

export { bioEnzymeManifest } from './manifest';

const MODES: Array<{ value: InhibitionMode; labelEn: string; labelZh: string }> = [
  { value: 'none', labelEn: 'No inhibitor', labelZh: '无抑制' },
  { value: 'competitive', labelEn: 'Competitive', labelZh: '竞争性' },
  { value: 'noncompetitive', labelEn: 'Non-competitive', labelZh: '非竞争性' },
  { value: 'uncompetitive', labelEn: 'Uncompetitive', labelZh: '反竞争性' },
];

interface State {
  vmax: number;
  km: number;
  inhibitor: number;
  ki: number;
  mode: InhibitionMode;
  enzymeConc: number;
  noise: number;
  showLb: boolean;
}

export class BioEnzymePlugin implements Plugin {
  readonly manifest = bioEnzymeManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private hasData = false;
  private state: State = {
    vmax: DEFAULT_RATE_PARAMS.vmax,
    km: DEFAULT_RATE_PARAMS.km,
    inhibitor: 12,
    ki: 10,
    mode: 'none',
    enzymeConc: 0.5,
    noise: 0.08,
    showLb: false,
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

  private params(): RateParams {
    return {
      vmax: this.state.vmax,
      km: this.state.km,
      inhibitor: this.state.inhibitor,
      ki: this.state.ki,
      mode: this.state.mode,
    };
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'vmax',
        label: 'Vmax',
        labelI18n: { 'zh-CN': 'Vmax（最大初速度）', 'en-US': 'Vmax' },
        type: 'range',
        min: 10,
        max: 300,
        step: 5,
        value: this.state.vmax,
        hint: this.zh ? '底物饱和时的极限速率' : 'limit rate at saturating substrate',
      },
      {
        key: 'km',
        label: 'Km',
        labelI18n: { 'zh-CN': 'Km（米氏常数）', 'en-US': 'Km' },
        type: 'range',
        min: 0.5,
        max: 60,
        step: 0.5,
        value: this.state.km,
      },
      {
        key: 'mode',
        label: 'Inhibition',
        labelI18n: { 'zh-CN': '抑制类型', 'en-US': 'Inhibition' },
        type: 'select',
        options: MODES.map((m) => ({
          value: m.value,
          label: this.zh ? m.labelZh : m.labelEn,
          labelI18n: { 'zh-CN': m.labelZh, 'en-US': m.labelEn },
        })),
        value: this.state.mode,
      },
      {
        key: 'inhibitor',
        label: '[I]',
        labelI18n: { 'zh-CN': '抑制浓度 [I]', 'en-US': 'Inhibitor [I]' },
        type: 'range',
        min: 0,
        max: 60,
        step: 1,
        value: this.state.inhibitor,
      },
      {
        key: 'ki',
        label: 'Ki',
        labelI18n: { 'zh-CN': '抑制常数 Ki', 'en-US': 'Inhibition const Ki' },
        type: 'range',
        min: 1,
        max: 60,
        step: 1,
        value: this.state.ki,
      },
      {
        key: 'enzymeConc',
        label: '[E]t',
        labelI18n: { 'zh-CN': '酶总浓度 [E]t', 'en-US': 'Total enzyme [E]t' },
        type: 'range',
        min: 0.05,
        max: 2,
        step: 0.05,
        value: this.state.enzymeConc,
        hint: this.zh ? '用于换算 kcat 与催化效率' : 'used to derive kcat and efficiency',
      },
      {
        key: 'noise',
        label: 'Noise',
        labelI18n: { 'zh-CN': '拟合数据噪声', 'en-US': 'Fit-data noise' },
        type: 'range',
        min: 0,
        max: 0.25,
        step: 0.01,
        value: this.state.noise,
        hint: this.zh ? '越大约应于“实验误差”越大' : 'larger ≈ larger experimental scatter',
      },
      {
        key: 'showLb',
        label: 'Lineweaver-Burk',
        labelI18n: { 'zh-CN': '双倒数图（Lineweaver-Burk）', 'en-US': 'Lineweaver-Burk view' },
        type: 'checkbox',
        value: this.state.showLb,
      },
      actionButton('fit', 'Fit Vmax & Km', '拟合 Vmax 与 Km', 'primary'),
      actionButton('fitRun', 'Demo · fit', '演示 · 拟合含噪数据'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportCsv', 'Export data CSV', '导出数据 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    num('vmax', (n) => {
      if (n === this.state.vmax) return false;
      this.state.vmax = Math.max(1, n);
      return true;
    });
    num('km', (n) => {
      if (n === this.state.km) return false;
      this.state.km = Math.max(0.1, n);
      return true;
    });
    num('inhibitor', (n) => {
      if (n === this.state.inhibitor) return false;
      this.state.inhibitor = Math.max(0, n);
      return true;
    });
    num('ki', (n) => {
      if (n === this.state.ki) return false;
      this.state.ki = Math.max(0.1, n);
      return true;
    });
    num('enzymeConc', (n) => {
      if (n === this.state.enzymeConc) return false;
      this.state.enzymeConc = n;
      return true;
    });
    num('noise', (n) => {
      if (n === this.state.noise) return false;
      this.state.noise = n;
      return true;
    });
    if (typeof params.mode === 'string' && MODES.some((m) => m.value === params.mode)) {
      if (params.mode !== this.state.mode) {
        this.state.mode = params.mode as InhibitionMode;
        this.draw();
      }
    }
    if (typeof params.showLb === 'boolean' && params.showLb !== this.state.showLb) {
      this.state.showLb = params.showLb;
      this.draw();
    }
    if (actionFired(params, 'fit')) this.fitNow(false, 'primary');
    if (actionFired(params, 'fitRun')) this.fitNow(true, 'demo');
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'bio-enzyme');
      return;
    }
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    const ok = low.endsWith('.csv') || low.endsWith('.tsv') || low.endsWith('.txt') || low.endsWith('.dat') || low.endsWith('.json');
    if (!ok) {
      notify(this.api, 'warning', 'Enzyme plugin accepts substrate,v0 CSV/TSV/JSON.', '酶插件接受 substrate,v0 的 CSV/TSV/JSON。');
      return;
    }
    const text = await file.text();
    const pts = parseRateData(text);
    if (pts.length < 4) {
      notify(this.api, 'warning', 'Need ≥4 substrate, v0 rows.', '至少需要 4 行 substrate,v0 数据。');
      return;
    }
    this.lastData = pts;
    this.hasData = true;
    const fit = fitMichaelisMenten(pts);
    if (fit) {
      this.state.vmax = fit.vmax;
      this.state.km = fit.km;
    }
    this.fitReport = { data: pts, vmax: fit?.vmax ?? 0, km: fit?.km ?? 0 };
    notify(
      this.api,
      'success',
      `Loaded ${pts.length} points; Vmax=${fit?.vmax.toFixed(2) ?? '?'}, Km=${fit?.km.toFixed(2) ?? '?'}`,
      `已加载 ${pts.length} 个数据点；Vmax=${fit?.vmax.toFixed(2) ?? '?'}，Km=${fit?.km.toFixed(2) ?? '?'}`,
    );
    this.draw();
  }

  private lastData: FitPoint[] | null = null;

  /** Run fitting: either on the loaded data or on freshly synthesized demo data. */
  private fitNow(synthetic: boolean, mode: 'primary' | 'demo') {
    const data = synthetic || !this.lastData ? synthesizeRates(this.params(), DEFAULT_S_SUBSTRATES, this.state.noise) : this.lastData;
    if (synthetic) {
      this.hasData = true;
      this.lastData = data;
    }
    const fit = fitMichaelisMenten(data);
    if (!fit) {
      notify(this.api, 'warning', 'Fit failed — need more/different data.', '拟合失败——需要更多或不同的数据。');
      return;
    }
    this.state.vmax = fit.vmax;
    this.state.km = fit.km;
    this.fitReport = { data, vmax: fit.vmax, km: fit.km };
    const { r2, rmse } = reportFit(data, fit.vmax, fit.km);
    notify(
      this.api,
      'success',
      `Vmax=${fit.vmax.toFixed(2)}, Km=${fit.km.toFixed(3)} (R²=${r2.toFixed(3)}, RMSE=${rmse.toFixed(3)})`,
      `拟合完成：Vmax=${fit.vmax.toFixed(2)}，Km=${fit.km.toFixed(3)}（R²=${r2.toFixed(3)}，RMSE=${rmse.toFixed(3)}）`,
    );
    void mode;
    this.draw();
  }

  private fitReport: { data: FitPoint[]; vmax: number; km: number } | null = null;

  private exportCsv() {
    const p = this.params();
    const rows: Array<Array<number | string>> = [];
    for (const s of DEFAULT_S_SUBSTRATES) {
      rows.push([s, Number(initialRate(p, s).toFixed(5))]);
    }
    if (this.fitReport) {
      for (const d of this.fitReport.data) rows.push([d.s, Number(d.v.toFixed(5))]);
    }
    exportRowsCsv(this.api, 'enzyme-rates', ['substrate', 'v0'], rows);
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    if (!this.hasData) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No initial-rate data',
        titleZh: '尚未加载初速度数据',
        hint: 'Load a substrate, v0 dataset (CSV / TSV / JSON) to fit Vmax & Km, or use the Demo·fit action.',
        hintZh: '载入 substrate,v0 数据（CSV/TSV/JSON）以拟合 Vmax 与 Km，或用「演示·拟合」生成一份可调节的含噪数据。',
      });
      return;
    }
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const zh = this.zh;
    if (this.state.showLb) {
      this.drawLb(g, canvas, zh);
    } else {
      this.drawSaturation(g, canvas, zh);
    }
    this.drawFooter(g, canvas, zh);
  }

  private drawSaturation(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    // All four families plotted on the current substrate axis, so the
    // competition is visible in one frame.
    const p = this.params();
    const sMax = 200;
    const vMax = Math.max(this.state.vmax * 1.08, 1);
    const padL = 54;
    const padR = 18;
    const padT = 46;
    const padB = 44;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const px = (s: number) => x0 + (plotW * s) / sMax;
    const py = (v: number) => y1 - (plotH * v) / vMax;

    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '酶动力学  v = f([S])' : 'Enzyme kinetics  v = f([S])', canvas.width / 2, 20);

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // axes ticks
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    for (let t = 0; t <= vMax; t += vMax / 5) {
      const sy = py(t);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillText(t.toFixed(0), x0 - 6, sy + 4);
    }
    for (let s = 0; s <= sMax; s += 40) {
      const sx = px(s);
      g.textAlign = 'center';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(String(s), sx, y1 + 14);
    }

    const trace = (target: RateParams, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i <= 120; i += 1) {
        const s = (sMax * i) / 120;
        const v = initialRate(target, s);
        const sy = py(v);
        if (i === 0) g.moveTo(px(s), sy);
        else g.lineTo(px(s), sy);
      }
      g.stroke();
    };

    // no-inhibitor reference (white)
    trace({ ...p, inhibitor: 0, mode: 'none' }, 'rgba(235,240,247,0.95)');
    // the four families with current [I]
    const palette: Array<{ mode: InhibitionMode; color: string }> = [
      { mode: 'none', color: 'rgba(160,200,250,0.95)' },
      { mode: 'competitive', color: 'rgba(250,205,120,0.95)' },
      { mode: 'noncompetitive', color: 'rgba(120,220,190,0.95)' },
      { mode: 'uncompetitive', color: 'rgba(240,150,180,0.95)' },
    ];
    for (const it of palette) trace({ ...p, mode: it.mode }, it.color);

    // legend
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let ly = y0 + 2;
    const legend: Array<[string, string]> = [
      ['rgba(235,240,247,0.95)', zh ? '无抑制（参考）' : 'no inhibitor (ref)'],
      ['rgba(160,200,250,0.95)', zh ? '当前抑制' : 'current inhibition'],
      ['rgba(250,205,120,0.95)', zh ? '竞争性' : 'competitive'],
      ['rgba(120,220,190,0.95)', zh ? '非竞争性' : 'non-competitive'],
      ['rgba(240,150,180,0.95)', zh ? '反竞争性' : 'uncompetitive'],
    ];
    for (const [c, label] of legend) {
      g.fillStyle = c;
      g.fillRect(x1 - 150, ly, 16, 4);
      g.fillText(label, x1 - 128, ly + 6);
      ly += 15;
    }

    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(zh ? 'v₀ 速率' : 'v₀ rate', x0 - 6, y0 - 8);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('[S]', x1 - 4, y1 + 26);
  }

  private drawLb(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    // Lineweaver-Burk: 1/v vs 1/[S] straight lines + the actual fitted data.
    const p = this.params();
    const seg = this.segmentData();
    const maxX = Math.max(...DEFAULT_S_SUBSTRATES.map((s) => 1 / s), 2.5);
    const maxY = this.maxLbY();
    const padL = 60;
    const padR = 20;
    const padT = 46;
    const padB = 44;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const px = (v: number) => x0 + (plotW * v) / maxX;
    const py = (u: number) => y1 - (plotH * u) / maxY;

    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? 'Lineweaver-Burk 双倒数图  1/v₀ = 1/[S]' : 'Lineweaver-Burk double-reciprocal  1/v₀ vs 1/[S]', canvas.width / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // gridlines
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    for (let i = 0; i <= 5; i += 1) {
      const xv = (maxX * i) / 5;
      const sx = px(xv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.fillText(xv.toFixed(1), sx, y1 + 14);
    }
    g.textAlign = 'left';
    for (let i = 0; i <= 5; i += 1) {
      const uv = (maxY * i) / 5;
      const sy = py(uv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillText(uv.toFixed(2), x1 + 6, sy + 4);
    }

    // fitted straight lines per family
    const families: Array<{ mode: InhibitionMode; color: string; label: string }> = [
      { mode: 'none', color: 'rgba(235,240,247,0.95)', label: zh ? '无抑制' : 'none' },
      { mode: 'competitive', color: 'rgba(250,205,120,0.95)', label: zh ? '竞争' : 'comp' },
      { mode: 'noncompetitive', color: 'rgba(120,220,190,0.95)', label: zh ? '非竞争' : 'nc' },
      { mode: 'uncompetitive', color: 'rgba(240,150,180,0.95)', label: zh ? '反竞争' : 'unc' },
    ];
    for (const fam of families) {
      const target = { ...p, mode: fam.mode };
      const points = DEFAULT_S_SUBSTRATES.filter((s) => s > 0 && lineweaverBurkY(target, s) < maxY).map((s) => ({
        x: lineweaverBurkX(s),
        y: lineweaverBurkY(target, s),
      }));
      if (points.length < 2) continue;
      const first = points[0]!;
      const last = points[points.length - 1]!;
      g.strokeStyle = fam.color;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(px(first.x), py(first.y));
      g.lineTo(px(last.x), py(last.y));
      g.stroke();
      g.fillStyle = fam.color;
      g.font = '10px Consolas, monospace';
      g.fillText(fam.label, px(first.x) - 4, py(first.y) - 4);
    }

    // fitted data points (vmax/km recovered)
    if (seg && seg.reported) {
      g.fillStyle = 'rgba(255,255,255,0.95)';
      for (const d of seg.data) {
        if (d.s <= 0 || d.v <= 0) continue;
        const uy = 1 / d.v;
        if (uy > maxY) continue;
        g.beginPath();
        g.arc(px(1 / d.s), py(uy), 3, 0, Math.PI * 2);
        g.fill();
      }
    }

    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText('1/v₀', x0 - 6, y0 - 8);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('1/[S]', x1, y1 + 26);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const p = this.params();
    const app = apparentParams(p);
    const fit = this.fitReport;
    const kin = derivedKinetics(fit?.vmax ?? this.state.vmax, fit?.km ?? this.state.km, this.state.enzymeConc);
    const kcat = kin.kcat == null ? '—' : Number(kin.kcat.toFixed(3));
    const eff = kin.efficiency == null ? '—' : Number(kin.efficiency.toFixed(4));

    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = zh
      ? `当前  Vmax=${this.state.vmax.toFixed(1)}  Km=${this.state.km.toFixed(1)}  表观 Vapp=${app.Vapp.toFixed(1)}  Kapp=${app.Kapp.toFixed(2)}`
      : `Current  Vmax=${this.state.vmax.toFixed(1)}  Km=${this.state.km.toFixed(1)}  apparent Vapp=${app.Vapp.toFixed(1)}  Kapp=${app.Kapp.toFixed(2)}`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = fit
      ? zh
        ? `拟合回代  Vmax=${fit.vmax.toFixed(2)}  Km=${fit.km.toFixed(3)}  ·  kcat=${kcat}  kcat/Km=${eff}`
        : `Fit result  Vmax=${fit.vmax.toFixed(2)}  Km=${fit.km.toFixed(3)}  ·  kcat=${kcat}  kcat/Km=${eff}`
      : zh
        ? '按「演示 · 拟合含噪数据」用 Levenberg-Marquardt 反解 Vmax / Km'
        : 'Press "Demo · fit" to recover Vmax / Km from noisy data';
    g.fillText(l2, 54, canvas.height - 14);
  }

  private segmentData() {
    if (!this.fitReport) return null;
    return { data: this.fitReport.data, reported: true };
  }
  private maxLbY(): number {
    const p = this.params();
    const ys = DEFAULT_S_SUBSTRATES.map((s) => lineweaverBurkY(p, s));
    const max = Math.max(...ys.filter((y) => Number.isFinite(y)), 0.1);
    return Math.max(max * 1.15, 0.1);
  }
}

export default function createBioEnzymePlugin(): Plugin {
  return new BioEnzymePlugin();
}