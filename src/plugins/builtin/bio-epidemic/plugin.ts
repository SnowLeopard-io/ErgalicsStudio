// ==========================================================================
// bio-epidemic — SIR / SEIR compartment epidemiology workbench (2-D)
//
// Plots the susceptible / exposed / infectious / recovered curves over time,
// overlays R_eff = R₀·S/N (the herd-immunity cross-over) and reports the
// peak infectious load, peak day, final attack rate and the herd-immunity
// threshold. Defaults to a deterministic measles-like SIR demo so the panel
// opens with content; a one-click demo button also burns in an R₀ sensitivity
// overlay illustrating how lowering R₀ suppresses the peak.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportCanvasPng, exportRowsCsv, notify } from '../shared/enhance';
import { bioEpidemicManifest } from './manifest';
import {
  DEFAULT_CONFIG,
  reportEpidemic,
  simulateEpidemic,
  type EpidemicReport,
  type ModelConfig,
} from './epidemic';

export { bioEpidemicManifest } from './manifest';

interface State {
  model: ModelConfig['model'];
  r0: number;
  infectiousDays: number;
  latentDays: number;
  population: number;
  initialInfected: number;
  days: number;
  showSensitivity: boolean;
  logY: boolean;
}

export class BioEpidemicPlugin implements Plugin {
  readonly manifest = bioEpidemicManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    model: DEFAULT_CONFIG.model,
    r0: DEFAULT_CONFIG.r0,
    infectiousDays: DEFAULT_CONFIG.infectiousDays,
    latentDays: DEFAULT_CONFIG.latentDays,
    population: DEFAULT_CONFIG.population,
    initialInfected: DEFAULT_CONFIG.initialInfected,
    days: DEFAULT_CONFIG.days,
    showSensitivity: false,
    logY: false,
  };
  private report: EpidemicReport;
  private trajectories: Array<{ r0: number; lat?: number[]; inc?: number[]; fr?: number[]; rec: number[]; days: number[] }> = [];

  constructor() {
    const cfg = this.config();
    const traj = simulateEpidemic(cfg);
    this.report = reportEpidemic(cfg, traj);
  }

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

  private config(): ModelConfig {
    return {
      model: this.state.model,
      r0: this.state.r0,
      infectiousDays: this.state.infectiousDays,
      latentDays: this.state.latentDays,
      population: this.state.population,
      initialInfected: this.state.initialInfected,
      initialExposed: 0,
      days: this.state.days,
    };
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'model',
        label: 'Model',
        labelI18n: { 'zh-CN': '模型', 'en-US': 'Model' },
        type: 'select',
        options: [
          { value: 'SIR', label: 'SIR', labelI18n: { 'zh-CN': 'SIR（无潜伏期）', 'en-US': 'SIR' } },
          { value: 'SEIR', label: 'SEIR', labelI18n: { 'zh-CN': 'SEIR（含潜伏期）', 'en-US': 'SEIR' } },
        ],
        value: this.state.model,
      },
      {
        key: 'r0',
        label: 'R₀',
        labelI18n: { 'zh-CN': '基本再生数 R₀', 'en-US': 'Basic reproduction R₀' },
        type: 'range',
        min: 0.5,
        max: 8,
        step: 0.1,
        value: this.state.r0,
      },
      {
        key: 'infectiousDays',
        label: 'D_inf',
        labelI18n: { 'zh-CN': '传染期（天）', 'en-US': 'Infectious period (d)' },
        type: 'range',
        min: 1,
        max: 20,
        step: 1,
        value: this.state.infectiousDays,
      },
      {
        key: 'latentDays',
        label: 'D_lat',
        labelI18n: { 'zh-CN': '潜伏期（天，SEIR）', 'en-US': 'Latent period (d, SEIR)' },
        type: 'range',
        min: 1,
        max: 20,
        step: 1,
        value: this.state.latentDays,
      },
      {
        key: 'population',
        label: 'N',
        labelI18n: { 'zh-CN': '总人口 N', 'en-US': 'Population N' },
        type: 'select',
        options: [1e5, 1e6, 1e7, 1e8].map((v) => ({
          value: String(v),
          label: String(v),
          labelI18n: { 'zh-CN': String(v), 'en-US': String(v) },
        })),
        value: String(this.state.population),
      },
      {
        key: 'initialInfected',
        label: 'I₀',
        labelI18n: { 'zh-CN': '初始感染者 I₀', 'en-US': 'Initial infected I₀' },
        type: 'range',
        min: 1,
        max: 2000,
        step: 1,
        value: this.state.initialInfected,
      },
      {
        key: 'days',
        label: 'Days',
        labelI18n: { 'zh-CN': '模拟天数', 'en-US': 'Days' },
        type: 'range',
        min: 30,
        max: 365,
        step: 5,
        value: this.state.days,
      },
      {
        key: 'logY',
        label: 'log scale',
        labelI18n: { 'zh-CN': '对数纵轴（log10）', 'en-US': 'Log y-axis (log10)' },
        type: 'checkbox',
        value: this.state.logY,
      },
      {
        key: 'showSensitivity',
        label: 'R₀ sensitivity',
        labelI18n: { 'zh-CN': 'R₀ 敏感性叠加', 'en-US': 'R₀ sensitivity overlay' },
        type: 'checkbox',
        value: this.state.showSensitivity,
      },
      actionButton('overlay', 'Overlay R₀ curves', '叠加 R₀ 敏感性曲线', 'primary'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportCsv', 'Export CSV', '导出数据 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    const changed = (k: keyof State, v: unknown) => {
      if ((this.state[k] as unknown) !== v) this.state[k] = v as never;
      else return;
      this.recompute();
      this.draw();
    };
    if (typeof params.model === 'string' && (params.model === 'SIR' || params.model === 'SEIR')) changed('model', params.model);
    num('r0', (n) => {
      if (n === this.state.r0) return false;
      this.state.r0 = Math.max(0.1, n);
      this.recompute();
      return true;
    });
    num('infectiousDays', (n) => {
      if (n === this.state.infectiousDays) return false;
      this.state.infectiousDays = Math.max(0.5, n);
      this.recompute();
      return true;
    });
    num('latentDays', (n) => {
      if (n === this.state.latentDays) return false;
      this.state.latentDays = Math.max(0.5, n);
      this.recompute();
      return true;
    });
    if (typeof params.population === 'string' || typeof params.population === 'number') {
      const pv = typeof params.population === 'string' ? Number(params.population) : params.population;
      if (Number.isFinite(pv) && pv !== this.state.population) {
        this.state.population = Math.max(100, pv);
        this.recompute();
        this.draw();
      }
    }
    num('initialInfected', (n) => {
      if (n === this.state.initialInfected) return false;
      this.state.initialInfected = Math.max(1, n);
      this.recompute();
      return true;
    });
    num('days', (n) => {
      if (n === this.state.days) return false;
      this.state.days = Math.max(10, n);
      this.recompute();
      return true;
    });
    if (typeof params.logY === 'boolean' && params.logY !== this.state.logY) {
      this.state.logY = params.logY;
      this.draw();
    }
    if (typeof params.showSensitivity === 'boolean' && params.showSensitivity !== this.state.showSensitivity) {
      this.state.showSensitivity = params.showSensitivity;
      this.draw();
    }
    if (actionFired(params, 'overlay')) {
      this.state.showSensitivity = !this.state.showSensitivity;
      this.draw();
    }
    if (actionFired(params, 'exportPng')) exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'bio-epidemic');
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    if (!file.name.toLowerCase().endsWith('.json')) {
      notify(this.api, 'warning', 'Epidemic accepts model-config .json.', '传染病插件接受模型配置 .json。');
      return;
    }
    try {
      const cfg = JSON.parse(await file.text()) as Partial<ModelConfig>;
      const s = this.state;
      if (typeof cfg.r0 === 'number') s.r0 = cfg.r0;
      if (typeof cfg.infectiousDays === 'number') s.infectiousDays = cfg.infectiousDays;
      if (typeof cfg.latentDays === 'number') s.latentDays = cfg.latentDays;
      if (typeof cfg.population === 'number') s.population = cfg.population;
      if (typeof cfg.initialInfected === 'number') s.initialInfected = cfg.initialInfected;
      if (typeof cfg.days === 'number') s.days = cfg.days;
      if (cfg.model === 'SIR' || cfg.model === 'SEIR') s.model = cfg.model;
      this.recompute();
      notify(this.api, 'success', 'Config loaded.', '已加载模型配置。');
      this.draw();
    } catch {
      notify(this.api, 'error', 'Invalid JSON config.', '无效的 JSON 配置。');
    }
  }

  private recompute() {
    const cfg = this.config();
    const traj = simulateEpidemic(cfg);
    this.report = reportEpidemic(cfg, traj);
    if (this.state.showSensitivity) this.trajectories = this.overlayTrajectories();
  }

  private overlayTrajectories() {
    // R₀ grid overlays I(t) to show how lowering reproduction number
    // suppresses and delays the epidemic peak.
    const base = this.config();
    const out: Array<{ r0: number; inc?: number[]; fro?: number[]; rec: number[]; days: number[] }> = [];
    for (const r0 of [1.5, 2.5, 3.5]) {
      const t = simulateEpidemic({ ...base, r0 });
      out.push({ r0, inc: t.infectious, rec: t.recovered, days: t.days });
    }
    return out;
  }

  private exportCsv() {
    const cfg = this.config();
    const traj = simulateEpidemic(cfg);
    const head: string[] = ['day', 'susceptible', 'infectious', 'recovered'];
    const rows: string[][] = traj.days.map((d, i) => [
      d.toFixed(1),
      Math.round(traj.susceptible[i]!).toString(),
      Math.round(traj.infectious[i]!).toString(),
      Math.round(traj.recovered[i]!).toString(),
    ]);
    if (traj.exposed) {
      head.splice(2, 0, 'exposed');
      for (let i = 0; i < rows.length; i += 1) rows[i]!.splice(2, 0, Math.round(traj.exposed![i]!).toString());
    }
    exportRowsCsv(this.api, 'epidemic-trajectory', head, rows);
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);

    const cfg = this.config();
    const traj = simulateEpidemic(cfg);
    const N = cfg.population;
    this.plotCompartment(g, canvas, traj.days, traj.susceptible, traj.infectious, traj.recovered, traj.exposed ?? null, N);

    if (this.state.showSensitivity) {
      for (const t of this.trajectories.length ? this.trajectories : this.overlayTrajectories()) {
        this.plotOverlay(g, canvas, t.days, t.inc!, N, t.r0);
      }
    }
  }

  private plotCompartment(
    g: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    days: number[],
    sus: number[],
    inf: number[],
    rec: number[],
    exp: number[] | null,
    pop: number,
  ) {
    const zh = this.zh;
    const maxDay = days[days.length - 1]!;
    const maxVal = this.state.logY ? Math.log10(pop * 1.05) : pop * 1.05;
    const padL = 62;
    const padR = 20;
    const padT = 46;
    const padB = 46;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const px = (d: number) => x0 + (plotW * d) / maxDay;
    const py = (v: number) => {
      const vv = this.state.logY ? Math.log10(Math.max(v, 1)) : v;
      return y1 - (plotH * vv) / maxVal;
    };

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? `${this.state.model} 分室模型（种群 N=${pop.toLocaleString()}）` : `${this.state.model} compartment model (N=${pop.toLocaleString()})`, canvas.width / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // grid
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    for (let i = 0; i <= 6; i += 1) {
      const dv = (maxDay * i) / 6;
      const sx = px(dv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.fillText(Math.round(dv) + 'd', sx, y1 + 14);
    }

    const lines = this.state.logY ? [1, 10, 100, 1000, 1e4, 1e5] : [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const yMax = maxVal;
    for (const t of lines) {
      const lo = this.state.logY ? Math.log10(t) : t * maxVal;
      const sy = y1 - (plotH * lo) / yMax;
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(this.state.logY ? String(t) : (t * 100).toFixed(0) + '%', x0 - 6, sy + 4);
    }

    const line = (vals: number[], color: string, width = 2) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (let i = 0; i < vals.length; i += 1) {
        const sx = px(days[i]!);
        const sy = py(vals[i]!);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
    };

    line(sus, 'rgba(120,170,250,0.95)');
    if (exp) line(exp, 'rgba(240,200,90,0.9)', 1.5);
    line(inf, 'rgba(240,110,110,0.95)');
    line(rec, 'rgba(110,210,160,0.95)');

    // legend
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let ly = y0 + 4;
    const legend: Array<[string, string, string]> = [
      ['rgba(120,170,250,0.95)', 'S', zh ? '易感' : 'susceptible'],
      ['rgba(110,210,160,0.95)', 'R', zh ? '康复/免疫' : 'recovered'],
      ['rgba(240,110,110,0.95)', 'I', zh ? '感染' : 'infectious'],
    ];
    if (exp) legend.splice(1, 0, ['rgba(240,200,90,0.9)', 'E', zh ? '暴露' : 'exposed']);
    for (const [c, sym, name] of legend) {
      g.fillStyle = c;
      g.fillRect(x1 - 170, ly, 18, 4);
      g.fillStyle = 'rgba(210,222,238,0.95)';
      g.fillText(`${sym}  ${name}`, x1 - 146, ly + 6);
      ly += 15;
    }

    // axis labels
    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(this.state.logY ? (zh ? '人数（log10）' : 'count (log10)') : zh ? '占比（%）' : 'fraction (%)', x0 - 6, y0 - 8);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText(zh ? '时间（天）' : 'time (days)', x1 - 14, y1 + 30);

    // headline metrics strip
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(232,238,248,0.95)';
    const r = this.report;
    const fmt = (x: number) => (x < 100 ? x.toFixed(0) : x.toLocaleString());
    g.fillText(
      zh
        ? `峰值感染 ${fmt(r.peakInfectious)}（第 ${r.peakDay.toFixed(1)} 天） · 峰占比 ${(r.peakFraction * 100).toFixed(1)}% · 总感染率 ${(r.attackRateFraction * 100).toFixed(1)}% · R₀=${r.r0} · 群体免疫阈值 ${(r.herdImmunityFraction * 100).toFixed(1)}%`
        : `Peak ${fmt(r.peakInfectious)} @ day ${r.peakDay.toFixed(1)} · peak ${(r.peakFraction * 100).toFixed(1)}% · attack ${(r.attackRateFraction * 100).toFixed(1)}% · R₀=${r.r0} · herd ${(r.herdImmunityFraction * 100).toFixed(1)}%`,
      62,
      canvas.height - 16,
    );
  }

  private plotOverlay(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, days: number[], inf: number[], pop: number, r0: number) {
    const zh = this.zh;
    const maxDay = days[days.length - 1]!;
    const maxVal = this.state.logY ? Math.log10(pop * 1.05) : pop * 1.05;
    const x0 = 62;
    const x1 = canvas.width - 20;
    const y0 = 46;
    const y1 = canvas.height - 46;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const px = (d: number) => x0 + (plotW * d) / maxDay;
    const py = (v: number) => {
      const vv = this.state.logY ? Math.log10(Math.max(v, 1)) : v;
      return y1 - (plotH * vv) / maxVal;
    };
    g.strokeStyle = `hsla(${r0 * 40}, 80%, 60%, 0.85)`;
    g.lineWidth = 1.4;
    g.setLineDash([4, 3]);
    g.beginPath();
    for (let i = 0; i < inf.length; i += 1) {
      const sx = px(days[i]!);
      const sy = py(inf[i]!);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = `hsla(${r0 * 40}, 80%, 65%, 1)`;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const lastX = px(days[days.length - 2]!);
    g.fillText(`R₀=${r0.toFixed(1)}`, lastX, py(inf[inf.length - 2]!) - 6);
  }
}

export default function createBioEpidemicPlugin(): Plugin {
  return new BioEpidemicPlugin();
}