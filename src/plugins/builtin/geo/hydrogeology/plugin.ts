// ==========================================================================
// geo-hydrogeology — Hydrogeology Workbench
//
// Views
//   theis    Theis and Cooper–Jacob time–drawdown curves
//   cone     radial cone of depression around the pumping well
//   plume    Ogata–Banks contaminant plume with retardation and decay
//   tidal    sea-level tide and the attenuated / lagged well response
//   pumping  Cooper–Jacob straight-line fit of a pumping test
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
import { hydrogeologyManifest } from './manifest';
import { hydroFigurePanels } from './figure';
import {
  EULER_GAMMA,
  arrivalTime,
  coneOfDepression,
  darcyLaw,
  fitCooperJacob,
  jacobDrawdown,
  jacobError,
  jacobValidityTime,
  parsePumpingCsv,
  plumeProfile,
  runHydrogeologyBenchmarks,
  theisCurve,
  theisDrawdown,
  tidalResponse,
  tidalSeries,
  type PumpingFit,
  type PumpingPoint,
  type Well,
} from './kernel';

export { hydrogeologyManifest } from './manifest';

type ViewMode = 'theis' | 'cone' | 'plume' | 'tidal' | 'pumping';

const VIEWS: Array<{ value: ViewMode; en: string; zh: string }> = [
  { value: 'theis', en: 'Theis drawdown', zh: 'Theis 降深' },
  { value: 'cone', en: 'Cone of depression', zh: '降落漏斗' },
  { value: 'plume', en: 'Contaminant transport', zh: '污染物运移' },
  { value: 'tidal', en: 'Tidal response', zh: '潮汐响应' },
  { value: 'pumping', en: 'Pumping-test analysis', zh: '抽水试验分析' },
];

interface State {
  view: ViewMode;
  q: number;
  transmissivity: number;
  storativity: number;
  radius: number;
  timeDays: number;
  velocity: number;
  dispersivity: number;
  retardation: number;
  halfLife: number;
  source: number;
  tideAmplitude: number;
  diffusivity: number;
  depth: number;
}

export class HydrogeologyPlugin implements Plugin {
  readonly manifest = hydrogeologyManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private points: PumpingPoint[] = [];
  private fit: PumpingFit | null = null;
  private dataName = '';
  private state: State = {
    view: 'theis',
    q: 800,
    transmissivity: 1200,
    storativity: 2e-4,
    radius: 60,
    timeDays: 2,
    velocity: 0.4,
    dispersivity: 12,
    retardation: 1.6,
    halfLife: 180,
    source: 100,
    tideAmplitude: 1.2,
    diffusivity: 1000,
    depth: 30,
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
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: VIEWS.map((v) => ({ value: v.value, label: this.zh ? v.zh : v.en, labelI18n: { 'zh-CN': v.zh, 'en-US': v.en } })),
        value: s.view,
      },
      {
        key: 'q',
        label: 'Pumping rate Q (m³/d)',
        labelI18n: { 'zh-CN': '抽水量 Q (m³/d)', 'en-US': 'Pumping rate Q (m³/d)' },
        type: 'number',
        min: 1,
        max: 20000,
        step: 10,
        value: s.q,
        visibleWhen: { key: 'view', in: ['theis', 'cone', 'pumping'] },
      },
      {
        key: 'transmissivity',
        label: 'Transmissivity T (m²/d)',
        labelI18n: { 'zh-CN': '导水系数 T (m²/d)', 'en-US': 'Transmissivity T (m²/d)' },
        type: 'number',
        min: 1,
        max: 50000,
        step: 10,
        value: s.transmissivity,
        visibleWhen: { key: 'view', in: ['theis', 'cone', 'pumping'] },
      },
      {
        key: 'storativity',
        label: 'Storativity S (–)',
        labelI18n: { 'zh-CN': '储水系数 S (–)', 'en-US': 'Storativity S (–)' },
        type: 'number',
        min: 1e-6,
        max: 0.5,
        step: 1e-5,
        value: s.storativity,
        visibleWhen: { key: 'view', in: ['theis', 'cone', 'pumping'] },
      },
      {
        key: 'radius',
        label: 'Observation radius r (m)',
        labelI18n: { 'zh-CN': '观测半径 r (m)', 'en-US': 'Observation radius r (m)' },
        type: 'number',
        min: 0.1,
        max: 5000,
        step: 1,
        value: s.radius,
        visibleWhen: { key: 'view', in: ['theis', 'cone'] },
      },
      {
        key: 'timeDays',
        label: 'Elapsed time t (d)',
        labelI18n: { 'zh-CN': '抽水历时 t (d)', 'en-US': 'Elapsed time t (d)' },
        type: 'number',
        min: 0.001,
        max: 2000,
        step: 0.01,
        value: s.timeDays,
        visibleWhen: { key: 'view', in: ['theis', 'cone', 'plume'] },
      },
      {
        key: 'velocity',
        label: 'Seepage velocity (m/d)',
        labelI18n: { 'zh-CN': '渗流速度 (m/d)', 'en-US': 'Seepage velocity (m/d)' },
        type: 'number',
        min: 0.001,
        max: 20,
        step: 0.01,
        value: s.velocity,
        visibleWhen: { key: 'view', in: ['plume'] },
      },
      {
        key: 'dispersivity',
        label: 'Longitudinal dispersivity (m)',
        labelI18n: { 'zh-CN': '纵向弥散度 (m)', 'en-US': 'Longitudinal dispersivity (m)' },
        type: 'number',
        min: 0.1,
        max: 500,
        step: 0.5,
        value: s.dispersivity,
        visibleWhen: { key: 'view', in: ['plume'] },
      },
      {
        key: 'retardation',
        label: 'Retardation factor R',
        labelI18n: { 'zh-CN': '阻滞因子 R', 'en-US': 'Retardation factor R' },
        type: 'number',
        min: 1,
        max: 20,
        step: 0.1,
        value: s.retardation,
        visibleWhen: { key: 'view', in: ['plume'] },
      },
      {
        key: 'halfLife',
        label: 'Half-life (d, 0 = conservative)',
        labelI18n: { 'zh-CN': '半衰期 (d，0 = 保守)', 'en-US': 'Half-life (d, 0 = conservative)' },
        type: 'number',
        min: 0,
        max: 5000,
        step: 5,
        value: s.halfLife,
        visibleWhen: { key: 'view', in: ['plume'] },
      },
      {
        key: 'source',
        label: 'Source concentration (mg/L)',
        labelI18n: { 'zh-CN': '源浓度 (mg/L)', 'en-US': 'Source concentration (mg/L)' },
        type: 'number',
        min: 0.1,
        max: 10000,
        step: 1,
        value: s.source,
        visibleWhen: { key: 'view', in: ['plume'] },
      },
      {
        key: 'tideAmplitude',
        label: 'Tide amplitude (m)',
        labelI18n: { 'zh-CN': '潮汐振幅 (m)', 'en-US': 'Tide amplitude (m)' },
        type: 'number',
        min: 0.1,
        max: 5,
        step: 0.1,
        value: s.tideAmplitude,
        visibleWhen: { key: 'view', in: ['tidal'] },
      },
      {
        key: 'diffusivity',
        label: 'Aquifer diffusivity T/S (m²/d)',
        labelI18n: { 'zh-CN': '含水层扩散率 T/S (m²/d)', 'en-US': 'Aquifer diffusivity T/S (m²/d)' },
        type: 'number',
        min: 10,
        max: 1e6,
        step: 10,
        value: s.diffusivity,
        visibleWhen: { key: 'view', in: ['tidal'] },
      },
      {
        key: 'depth',
        label: 'Observation depth (m)',
        labelI18n: { 'zh-CN': '观测点深度 (m)', 'en-US': 'Observation depth (m)' },
        type: 'number',
        min: 1,
        max: 500,
        step: 1,
        value: s.depth,
        visibleWhen: { key: 'view', in: ['tidal'] },
      },
      actionButton('run', 'Recompute', '重新计算', 'primary'),
      actionButton('demo', 'Demo · Theis well (Q=800 m³/d)', '演示 · Theis 抽水井 (Q=800 m³/d)'),
      actionButton('benchmark', 'Run hydrogeology benchmarks', '运行水文地质基准'),
      actionButton('exportCsv', 'Export current series CSV', '导出当前序列 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, min: number, max: number, apply: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        const v = Math.min(max, Math.max(min, params[k] as number));
        if (apply(v)) this.draw();
      }
    };
    if (typeof params.view === 'string' && VIEWS.some((v) => v.value === params.view) && params.view !== this.state.view) {
      this.state.view = params.view as ViewMode;
      this.draw();
    }
    num('q', 1, 20000, (v) => this.set('q', v));
    num('transmissivity', 1, 50000, (v) => this.set('transmissivity', v));
    num('storativity', 1e-6, 0.5, (v) => this.set('storativity', v));
    num('radius', 0.1, 5000, (v) => this.set('radius', v));
    num('timeDays', 0.001, 2000, (v) => this.set('timeDays', v));
    num('velocity', 0.001, 20, (v) => this.set('velocity', v));
    num('dispersivity', 0.1, 500, (v) => this.set('dispersivity', v));
    num('retardation', 1, 20, (v) => this.set('retardation', v));
    num('halfLife', 0, 5000, (v) => this.set('halfLife', v));
    num('source', 0.1, 10000, (v) => this.set('source', v));
    num('tideAmplitude', 0.1, 5, (v) => this.set('tideAmplitude', v));
    num('diffusivity', 10, 1e6, (v) => this.set('diffusivity', v));
    num('depth', 1, 500, (v) => this.set('depth', v));

    if (actionFired(params, 'run')) this.runNow();
    if (actionFired(params, 'demo')) this.runDemo();
    if (actionFired(params, 'benchmark')) this.runBenchmarks();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv') && !low.endsWith('.txt')) {
      notify(
        this.api,
        'warning',
        'Pumping-test data must be CSV / TSV / TXT with time_days (or time_min) and drawdown_m columns.',
        '抽水试验数据须为含 time_days（或 time_min）与 drawdown_m 列的 CSV / TSV / TXT。',
      );
      return;
    }
    const pts = parsePumpingCsv(await file.text());
    if (pts.length < 2) {
      notify(
        this.api,
        'warning',
        'No usable time–drawdown pairs found.',
        '未找到可用的时间-降深数据对。',
      );
      return;
    }
    this.points = pts;
    this.dataName = file.name;
    const fit = fitCooperJacob(pts, this.state.q, this.state.radius);
    this.fit = fit;
    if (fit.transmissivity > 0) this.state.transmissivity = fit.transmissivity;
    if (fit.storativity > 0 && fit.storativity < 1) this.state.storativity = fit.storativity;
    this.state.view = 'pumping';
    this.publish();
    notify(
      this.api,
      'success',
      `Loaded ${pts.length} pumping-test points; T=${fit.transmissivity.toFixed(1)} m²/d, S=${fit.storativity.toExponential(2)}, R²=${fit.r2.toFixed(4)}.`,
      `已载入 ${pts.length} 个抽水试验点；T=${fit.transmissivity.toFixed(1)} m²/d，S=${fit.storativity.toExponential(2)}，R²=${fit.r2.toFixed(4)}。`,
    );
    this.draw();
  }

  // ---- helpers -------------------------------------------------------------

  private set<K extends keyof State>(key: K, value: State[K]): boolean {
    if (this.state[key] === value) return false;
    this.state[key] = value;
    return true;
  }

  private well(): Well {
    return {
      id: 'PW-1',
      x: 0,
      y: 0,
      q: this.state.q,
      radius: 0.15,
      startTime: 0,
    };
  }

  private runNow() {
    const pt = theisDrawdown({
      q: this.state.q,
      t: this.state.transmissivity,
      s: this.state.storativity,
      r: this.state.radius,
      time: this.state.timeDays,
    });
    this.publish();
    notify(
      this.api,
      'success',
      `Theis drawdown at r=${this.state.radius} m, t=${this.state.timeDays} d: ${pt.drawdownM.toFixed(3)} m (u=${pt.u.toExponential(2)}, W=${pt.wellFunction.toFixed(4)}).`,
      `r=${this.state.radius} m、t=${this.state.timeDays} d 的 Theis 降深：${pt.drawdownM.toFixed(3)} m（u=${pt.u.toExponential(2)}，W=${pt.wellFunction.toFixed(4)}）。`,
    );
    this.draw();
  }

  private runDemo() {
    this.state.view = 'theis';
    this.state.q = 800;
    this.state.transmissivity = 1200;
    this.state.storativity = 2e-4;
    this.state.radius = 60;
    this.state.timeDays = 2;
    this.publish();
    notify(this.api, 'success', 'Loaded the Theis demonstration well.', '已载入 Theis 演示抽水井。');
    this.draw();
  }

  private runBenchmarks() {
    const out = runHydrogeologyBenchmarks();
    const metrics: ScienceMetric[] = out.map((b) => ({
      key: `bench-${b.id}`,
      label: `Bench · ${b.id}`,
      value: b.pass ? 'pass' : 'FAIL',
      severity: b.pass ? 'ok' : 'warn',
      hint: b.detail,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      out.every((b) => b.pass) ? 'success' : 'warning',
      `Hydrogeology benchmarks: ${out.map((b) => `${b.id}=${b.pass ? 'pass' : 'FAIL'}`).join(', ')}`,
      `水文地质基准：${out.map((b) => `${b.id}=${b.pass ? '通过' : '未通过'}`).join('，')}`,
    );
    this.draw();
  }

  private exportCsv() {
    const s = this.state;
    const rows: Array<Array<number | string>> = [];
    switch (s.view) {
      case 'plume': {
        const profile = plumeProfile({
          velocity: s.velocity,
          dispersivity: s.dispersivity,
          retardation: s.retardation,
          halfLifeDays: s.halfLife,
          source: s.source,
          time: s.timeDays,
          maxDistance: Math.max(200, s.velocity * s.timeDays * 2.5),
        });
        for (const p of profile) rows.push([Number(p.x.toFixed(2)), Number(p.relative.toFixed(6)), Number(p.concentration.toFixed(4))]);
        exportRowsCsv(this.api, 'hydrogeology-plume', ['distance_m', 'relative_c', 'concentration_mg_l'], rows);
        return;
      }
      case 'tidal': {
        const series = tidalSeries(
          { amplitude: s.tideAmplitude, omega: (2 * Math.PI) / 0.5175, diffusivity: s.diffusivity, depth: s.depth },
          3,
          180,
        );
        for (const p of series) rows.push([Number(p.timeDays.toFixed(4)), Number(p.seaLevelM.toFixed(4)), Number(p.wellLevelM.toFixed(4))]);
        exportRowsCsv(this.api, 'hydrogeology-tidal', ['time_days', 'sea_level_m', 'well_level_m'], rows);
        return;
      }
      case 'cone': {
        const profile = coneOfDepression(this.well(), s.transmissivity, s.storativity, s.timeDays);
        for (const p of profile) rows.push([Number(p.distanceM.toFixed(2)), Number(p.drawdownM.toFixed(5))]);
        exportRowsCsv(this.api, 'hydrogeology-cone', ['distance_m', 'drawdown_m'], rows);
        return;
      }
      case 'pumping': {
        if (!this.fit || this.points.length === 0) {
          notify(this.api, 'warning', 'Load a pumping test first.', '请先载入抽水试验数据。');
          return;
        }
        for (const p of this.points) {
          const fitted = this.fit.slope * Math.log10(p.timeDays) + this.fit.intercept;
          rows.push([Number(p.timeDays.toFixed(6)), Number(p.drawdownM.toFixed(4)), Number(fitted.toFixed(4))]);
        }
        exportRowsCsv(this.api, 'hydrogeology-pumping-fit', ['time_days', 'drawdown_m', 'cooper_jacob_fit_m'], rows);
        return;
      }
      default: {
        const times: number[] = [];
        for (let k = 0; k <= 60; k += 1) times.push(10 ** (-4 + (k / 60) * 5));
        const curve = theisCurve({ q: s.q, t: s.transmissivity, s: s.storativity, r: s.radius }, times);
        for (const p of curve) rows.push([Number(p.timeDays.toExponential(6)), Number(p.drawdownM.toFixed(5))]);
        exportRowsCsv(this.api, 'hydrogeology-theis', ['time_days', 'drawdown_m'], rows);
      }
    }
  }

  private async sendToFigure(): Promise<void> {
    const s = this.state;
    const caption: Bilingual = {
      zh: `水文地质模型：Q=${s.q} m³/d、T=${s.transmissivity} m²/d、S=${s.storativity}、r=${s.radius} m、t=${s.timeDays} d。污染物运移取 v=${s.velocity} m/d、弥散度 ${s.dispersivity} m、R=${s.retardation}、半衰期 ${s.halfLife} d。`,
      en: `Hydrogeology model: Q=${s.q} m³/d, T=${s.transmissivity} m²/d, S=${s.storativity}, r=${s.radius} m, t=${s.timeDays} d. Transport uses v=${s.velocity} m/d, dispersivity ${s.dispersivity} m, R=${s.retardation}, half-life ${s.halfLife} d.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '水文地质井流与污染物运移', en: 'Hydrogeology Well Hydraulics & Transport' },
      caption,
      hydroFigurePanels({
        well: this.well(),
        transmissivity: s.transmissivity,
        storativity: s.storativity,
        timeDays: s.timeDays,
        plume: {
          velocity: s.velocity,
          dispersivity: s.dispersivity,
          retardation: s.retardation,
          halfLifeDays: s.halfLife,
          source: s.source,
          time: s.timeDays,
          maxDistance: Math.max(200, s.velocity * s.timeDays * 2.5),
        },
        tidal: {
          amplitude: s.tideAmplitude,
          omega: (2 * Math.PI) / 0.5175,
          diffusivity: s.diffusivity,
          depth: s.depth,
        },
      }),
    );
  }

  private publish() {
    const s = this.state;
    const pt = theisDrawdown({ q: s.q, t: s.transmissivity, s: s.storativity, r: s.radius, time: s.timeDays });
    const err = jacobError({ q: s.q, t: s.transmissivity, s: s.storativity, r: s.radius, time: s.timeDays });
    const validAt = jacobValidityTime({ q: s.q, t: s.transmissivity, s: s.storativity, r: s.radius }, 0.01);
    const darcy = darcyLaw({ k: 5, dh: -1, dl: 100, porosity: 0.25 });
    const arrival = arrivalTime(1000, s.velocity, s.retardation);
    const tide = tidalResponse({ amplitude: s.tideAmplitude, omega: (2 * Math.PI) / 0.5175, diffusivity: s.diffusivity, depth: s.depth });
    const metrics: ScienceMetric[] = [
      {
        key: 'theis-drawdown',
        label: 'Theis drawdown',
        value: fmtMetric(pt.drawdownM),
        unit: 'm',
        severity: 'info',
        hint: `u=${pt.u.toExponential(2)}, W(u)=${pt.wellFunction.toFixed(5)}; s=Q·W(u)/(4πT)`,
      },
      {
        key: 'theis-u',
        label: 'Well-function argument u',
        value: pt.u.toExponential(3),
        severity: pt.u < 0.01 ? 'ok' : 'info',
        hint: `Cooper–Jacob validity (u<0.01) reached at t ≈ ${validAt.toFixed(3)} d; current error ${(err * 100).toFixed(3)}%`,
      },
      {
        key: 'darcy',
        label: 'Darcy reference flux',
        value: fmtMetric(darcy.darcyVelocity),
        unit: 'm/d',
        severity: 'info',
        hint: `K=5 m/d, dh/dl=0.01, n=0.25 → seepage velocity ${darcy.seepageVelocity.toFixed(3)} m/d (reference column)`,
      },
      {
        key: 'plume-arrival',
        label: 'Arrival at 1000 m',
        value: fmtMetric(arrival),
        unit: 'd',
        severity: 'info',
        hint: `retarded front: t = x·R/v (R=${s.retardation}, v=${s.velocity} m/d)`,
      },
      {
        key: 'tidal',
        label: 'Tidal amplitude ratio',
        value: fmtMetric(tide.amplitudeRatio),
        severity: 'info',
        hint: `phase lag ${tide.phaseLagHours.toFixed(2)} h at ${s.depth} m depth (T/S=${s.diffusivity} m²/d)`,
      },
      {
        key: 'gamma',
        label: 'Euler–Mascheroni γ',
        value: EULER_GAMMA.toFixed(6),
        severity: 'info',
        hint: `Cooper–Jacob uses s ≈ Q/(4πT)·(−γ − ln u)`,
      },
    ];
    if (this.fit) {
      metrics.push({
        key: 'pumping-fit',
        label: 'Pumping-test fit',
        value: `${fmtMetric(this.fit.transmissivity)} m²/d`,
        severity: this.fit.r2 > 0.99 ? 'ok' : 'info',
        hint: `S=${this.fit.storativity.toExponential(3)}, R²=${this.fit.r2.toFixed(5)}, n=${this.fit.points}${this.dataName ? ` (${this.dataName})` : ''}`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 860;
    canvas.height = canvas.clientHeight || 520;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const title = VIEWS.find((v) => v.value === this.state.view);
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(zh ? title?.zh ?? '' : title?.en ?? '', 18, 26);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(160,175,195,0.9)';
    g.textAlign = 'right';
    g.fillText(`Q=${this.state.q} m³/d · T=${this.state.transmissivity} m²/d · S=${this.state.storativity}`, canvas.width - 18, 26);
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.beginPath();
    g.moveTo(18, 36);
    g.lineTo(canvas.width - 18, 36);
    g.stroke();

    switch (this.state.view) {
      case 'cone':
        this.drawCone(g, canvas, zh);
        break;
      case 'plume':
        this.drawPlume(g, canvas, zh);
        break;
      case 'tidal':
        this.drawTidal(g, canvas, zh);
        break;
      case 'pumping':
        this.drawPumping(g, canvas, zh);
        break;
      default:
        this.drawTheis(g, canvas, zh);
    }
  }

  private plotFrame(canvas: HTMLCanvasElement, padT = 64, padB = 54, padL = 68, padR = 26) {
    return { x0: padL, y0: padT, x1: canvas.width - padR, y1: canvas.height - padB };
  }

  private axes(
    g: CanvasRenderingContext2D,
    frame: { x0: number; y0: number; x1: number; y1: number },
    xLabel: string,
    yLabel: string,
    xLog = false,
  ) {
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.strokeRect(frame.x0, frame.y0, frame.x1 - frame.x0, frame.y1 - frame.y0);
    g.fillStyle = 'rgba(170,185,205,0.9)';
    g.font = '10px Consolas, monospace';
    for (let k = 0; k <= 5; k += 1) {
      const y = frame.y0 + ((frame.y1 - frame.y0) * k) / 5;
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(frame.x0, y);
      g.lineTo(frame.x1, y);
      g.stroke();
    }
    g.textAlign = 'right';
    g.fillText(yLabel, frame.x0 - 8, frame.y0 + 10);
    g.textAlign = 'center';
    g.fillText(xLabel, (frame.x0 + frame.x1) / 2, frame.y1 + 34);
    if (xLog) {
      g.fillStyle = 'rgba(150,165,185,0.8)';
      g.fillText('log scale', frame.x1 - 40, frame.y0 - 8);
    }
  }

  private drawTheis(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const s = this.state;
    const frame = this.plotFrame(canvas);
    const tMin = 1e-4;
    const tMax = Math.max(10, s.timeDays * 10);
    const times: number[] = [];
    for (let k = 0; k <= 100; k += 1) times.push(10 ** (Math.log10(tMin) + (k / 100) * (Math.log10(tMax) - Math.log10(tMin))));
    const curve = theisCurve({ q: s.q, t: s.transmissivity, s: s.storativity, r: s.radius }, times);
    const jac = times.map((time) => jacobDrawdown({ q: s.q, t: s.transmissivity, s: s.storativity, r: s.radius, time }));
    const sMax = Math.max(...curve.map((p) => p.drawdownM), 1e-6) * 1.08;
    const X = (t: number) => frame.x0 + ((Math.log10(t) - Math.log10(tMin)) / (Math.log10(tMax) - Math.log10(tMin))) * (frame.x1 - frame.x0);
    const Y = (v: number) => frame.y1 - (v / sMax) * (frame.y1 - frame.y0);
    this.axes(g, frame, zh ? '时间 t (d)' : 'time t (d)', zh ? '降深 s (m)' : 'drawdown s (m)', true);

    g.fillStyle = 'rgba(170,185,205,0.85)';
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) g.fillText(((sMax * k) / 4).toFixed(2), frame.x0 - 5, Y((sMax * k) / 4) + 3);

    const drawSeries = (vals: number[], color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      vals.forEach((v, k) => {
        const x = X(times[k]!);
        const y = Y(v);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
      g.lineWidth = 1;
    };
    drawSeries(curve.map((p) => p.drawdownM), 'rgba(122,215,255,0.95)');
    g.setLineDash([5, 4]);
    drawSeries(jac, 'rgba(255,209,102,0.95)');
    g.setLineDash([]);

    const now = theisDrawdown({ q: s.q, t: s.transmissivity, s: s.storativity, r: s.radius, time: s.timeDays });
    const px = X(Math.max(tMin, Math.min(tMax, s.timeDays)));
    const py = Y(Math.min(now.drawdownM, sMax));
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px, frame.y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#ffd166';
    g.beginPath();
    g.arc(px, py, 4, 0, Math.PI * 2);
    g.fill();

    g.textAlign = 'left';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = '#7ad7ff';
    g.fillText(zh ? 'Theis 精确解' : 'Theis exact', frame.x0 + 10, frame.y0 + 18);
    g.fillStyle = '#ffd166';
    g.fillText(zh ? 'Cooper–Jacob 近似' : 'Cooper–Jacob', frame.x0 + 10, frame.y0 + 34);
    g.fillStyle = 'rgba(220,230,240,0.95)';
    g.textAlign = 'center';
    g.fillText(
      `s(${s.radius} m, ${s.timeDays} d) = ${now.drawdownM.toFixed(3)} m   ·   u = ${now.u.toExponential(2)}   ·   W(u) = ${now.wellFunction.toFixed(4)}`,
      canvas.width / 2,
      canvas.height - 14,
    );
  }

  private drawCone(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const s = this.state;
    const frame = this.plotFrame(canvas, 60, 58);
    const profile = coneOfDepression(this.well(), s.transmissivity, s.storativity, s.timeDays);
    const maxR = profile[profile.length - 1]?.distanceM ?? 1000;
    const sMax = Math.max(...profile.map((p) => p.drawdownM), 1e-6) * 1.1;
    const X = (r: number) => frame.x0 + (r / maxR) * (frame.x1 - frame.x0);
    this.axes(g, frame, zh ? '径向距离 r (m)' : 'radial distance r (m)', zh ? '降深 s (m)' : 'drawdown s (m)');

    // land surface and pre-pumping water table
    const wt = frame.y0 + 16;
    g.strokeStyle = 'rgba(122,215,255,0.5)';
    g.setLineDash([6, 4]);
    g.beginPath();
    g.moveTo(frame.x0, wt);
    g.lineTo(frame.x1, wt);
    g.stroke();
    g.setLineDash([]);

    g.beginPath();
    g.moveTo(X(0), wt);
    profile.forEach((p) => {
      const depth = (p.drawdownM / sMax) * (frame.y1 - wt) * 0.72;
      g.lineTo(X(p.distanceM), wt + depth);
    });
    g.strokeStyle = 'rgba(140,230,176,0.95)';
    g.lineWidth = 2;
    g.stroke();
    g.lineWidth = 1;

    // Well casing.
    g.fillStyle = 'rgba(220,230,240,0.85)';
    g.fillRect(X(0) - 5, frame.y0, 10, frame.y1 - frame.y0);
    g.fillStyle = 'rgba(255,209,102,0.95)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(zh ? '抽水井' : 'pumping well', X(0) + 10, frame.y0 + 20);

    g.fillStyle = 'rgba(170,185,205,0.85)';
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      const y = frame.y1 - (k / 4) * (frame.y1 - frame.y0);
      g.fillText(((sMax * k) / 4).toFixed(2), frame.x0 - 5, y + 3);
    }

    g.textAlign = 'center';
    g.fillStyle = 'rgba(220,230,240,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `t=${s.timeDays} d 时降落漏斗：井壁降深 ${profile[0]?.drawdownM.toFixed(2)} m，影响半径约 ${maxR.toFixed(0)} m`
        : `Cone at t=${s.timeDays} d: ${profile[0]?.drawdownM.toFixed(2)} m at the well, radius of influence ≈ ${maxR.toFixed(0)} m`,
      canvas.width / 2,
      canvas.height - 14,
    );
  }

  private drawPlume(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const s = this.state;
    const frame = this.plotFrame(canvas);
    const maxDistance = Math.max(200, s.velocity * s.timeDays * 2.5);
    const profile = plumeProfile({
      velocity: s.velocity,
      dispersivity: s.dispersivity,
      retardation: s.retardation,
      halfLifeDays: s.halfLife,
      source: s.source,
      time: s.timeDays,
      maxDistance,
    });
    const X = (x: number) => frame.x0 + (x / maxDistance) * (frame.x1 - frame.x0);
    const Y = (c: number) => frame.y1 - (c / Math.max(s.source, 1e-9)) * (frame.y1 - frame.y0);
    this.axes(g, frame, zh ? '距离 x (m)' : 'distance x (m)', zh ? '浓度 C (mg/L)' : 'concentration C (mg/L)');

    g.beginPath();
    g.moveTo(X(0), frame.y1);
    profile.forEach((p) => g.lineTo(X(p.x), Y(p.concentration)));
    g.lineTo(X(maxDistance), frame.y1);
    g.closePath();
    g.fillStyle = 'rgba(255,143,171,0.16)';
    g.fill();

    g.beginPath();
    profile.forEach((p, k) => {
      const x = X(p.x);
      const y = Y(p.concentration);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.strokeStyle = 'rgba(255,143,171,0.95)';
    g.lineWidth = 2;
    g.stroke();
    g.lineWidth = 1;

    const front = (s.velocity / Math.max(1, s.retardation)) * s.timeDays;
    const fx = X(Math.min(front, maxDistance));
    g.strokeStyle = 'rgba(122,215,255,0.7)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(fx, frame.y0);
    g.lineTo(fx, frame.y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(220,230,240,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(
      zh
        ? `t=${s.timeDays} d：阻滞锋面 x≈${front.toFixed(0)} m，R=${s.retardation}，半衰期 ${s.halfLife} d`
        : `t=${s.timeDays} d: retarded front x≈${front.toFixed(0)} m, R=${s.retardation}, half-life ${s.halfLife} d`,
      canvas.width / 2,
      canvas.height - 14,
    );
  }

  private drawTidal(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const s = this.state;
    const frame = this.plotFrame(canvas);
    const input = { amplitude: s.tideAmplitude, omega: (2 * Math.PI) / 0.5175, diffusivity: s.diffusivity, depth: s.depth };
    const series = tidalSeries(input, 3, 240);
    const resp = tidalResponse(input);
    const yMax = Math.max(...series.map((p) => Math.abs(p.seaLevelM)), ...series.map((p) => Math.abs(p.wellLevelM)), 1e-6) * 1.15;
    const X = (t: number) => frame.x0 + (t / 3) * (frame.x1 - frame.x0);
    const Y = (v: number) => (frame.y0 + frame.y1) / 2 - (v / yMax) * ((frame.y1 - frame.y0) / 2);
    this.axes(g, frame, zh ? '时间 t (d)' : 'time t (d)', zh ? '水位 (m)' : 'water level (m)');
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.beginPath();
    g.moveTo(frame.x0, Y(0));
    g.lineTo(frame.x1, Y(0));
    g.stroke();

    const draw = (vals: number[], color: string, dash: boolean) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      if (dash) g.setLineDash([5, 4]);
      g.beginPath();
      series.forEach((p, k) => {
        const x = X(p.timeDays);
        const y = Y(vals[k]!);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 1;
    };
    draw(series.map((p) => p.seaLevelM), 'rgba(122,215,255,0.95)', true);
    draw(series.map((p) => p.wellLevelM), 'rgba(255,209,102,0.95)', false);

    g.textAlign = 'left';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = '#7ad7ff';
    g.fillText(zh ? '海潮' : 'sea tide', frame.x0 + 10, frame.y0 + 18);
    g.fillStyle = '#ffd166';
    g.fillText(zh ? '井水位响应' : 'well response', frame.x0 + 10, frame.y0 + 34);
    g.fillStyle = 'rgba(220,230,240,0.95)';
    g.textAlign = 'center';
    g.fillText(
      zh
        ? `振幅比 ${resp.amplitudeRatio.toFixed(3)}，相位滞后 ${resp.phaseLagHours.toFixed(2)} h（${s.depth} m 深，T/S=${s.diffusivity} m²/d）`
        : `Amplitude ratio ${resp.amplitudeRatio.toFixed(3)}, phase lag ${resp.phaseLagHours.toFixed(2)} h at ${s.depth} m (T/S=${s.diffusivity} m²/d)`,
      canvas.width / 2,
      canvas.height - 14,
    );
  }

  private drawPumping(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    if (this.points.length < 2 || !this.fit) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No pumping test loaded',
        titleZh: '尚未载入抽水试验',
        hint: 'Load a CSV with time_days (or time_min) and drawdown_m columns.',
        hintZh: '请载入含 time_days（或 time_min）与 drawdown_m 列的 CSV。',
      });
      return;
    }
    const fit = this.fit;
    const frame = this.plotFrame(canvas);
    const xs = this.points.map((p) => Math.log10(p.timeDays));
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMax = Math.max(...this.points.map((p) => p.drawdownM), 1e-6) * 1.12;
    const X = (t: number) => frame.x0 + ((Math.log10(t) - xMin) / Math.max(xMax - xMin, 1e-9)) * (frame.x1 - frame.x0);
    const Y = (v: number) => frame.y1 - (v / yMax) * (frame.y1 - frame.y0);
    this.axes(g, frame, zh ? '时间 t (d)' : 'time t (d)', zh ? '降深 s (m)' : 'drawdown s (m)', true);

    this.points.forEach((p) => {
      g.fillStyle = '#7ad7ff';
      g.beginPath();
      g.arc(X(p.timeDays), Y(p.drawdownM), 2.5, 0, Math.PI * 2);
      g.fill();
    });
    g.strokeStyle = '#ffd166';
    g.lineWidth = 2;
    g.beginPath();
    this.points.forEach((p, k) => {
      const fitted = fit.slope * Math.log10(p.timeDays) + fit.intercept;
      const x = X(p.timeDays);
      const y = Y(fitted);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
    g.lineWidth = 1;

    g.fillStyle = 'rgba(220,230,240,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(
      zh
        ? `Cooper–Jacob 拟合：T=${fit.transmissivity.toFixed(1)} m²/d，S=${fit.storativity.toExponential(2)}，R²=${fit.r2.toFixed(4)}（n=${fit.points}）`
        : `Cooper–Jacob fit: T=${fit.transmissivity.toFixed(1)} m²/d, S=${fit.storativity.toExponential(2)}, R²=${fit.r2.toFixed(4)} (n=${fit.points})`,
      canvas.width / 2,
      canvas.height - 14,
    );
  }
}

export default function createHydrogeologyPlugin(): Plugin {
  return new HydrogeologyPlugin();
}
