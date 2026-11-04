// ==========================================================================
// sim-abm — agent-based modeling workbench (2-D canvas).
//
// Views: agent space (grid heat cells / agent dots), aggregate time series,
// attribute histogram. Batch runs are seeded and deterministic; results feed
// the scienceOutput strip.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { simAbmManifest } from './manifest';
import {
  cellIndex,
  createRng,
  initOpinion,
  initPredatorPrey,
  initSchelling,
  initTraffic,
  runBatch,
  segregationIndex,
  type ABMWorld,
  type Aggregate,
  type TemplateId,
} from './kernel';

export { simAbmManifest } from './manifest';

interface State {
  template: TemplateId;
  cols: number;
  rows: number;
  density: number;
  nPrey: number;
  nPred: number;
  nAgents: number;
  tolerance: number;
  preyReproduce: number;
  predatorReproduce: number;
  predatorEnergyLoss: number;
  confidence: number;
  mu: number;
  interactRadius: number;
  maxSpeed: number;
  pSlow: number;
  steps: number;
  seed: number;
  view: 'space' | 'series' | 'histogram';
}

/** Template-specific parameter keys shown in the panel. */
const TEMPLATE_PARAMS: Record<TemplateId, string[]> = {
  schelling: ['cols', 'rows', 'density', 'tolerance', 'steps', 'seed'],
  'predator-prey': ['nPrey', 'nPred', 'preyReproduce', 'predatorReproduce', 'predatorEnergyLoss', 'steps', 'seed'],
  opinion: ['nAgents', 'confidence', 'mu', 'interactRadius', 'steps', 'seed'],
  traffic: ['density', 'maxSpeed', 'pSlow', 'steps', 'seed'],
};

const PALETTE = ['#6f8fae', '#ae8f6f', '#6fae8f', '#ae6f8f'];
const TEMPLATE_LABEL: Record<TemplateId, { en: string; zh: string }> = {
  schelling: { en: 'Schelling segregation', zh: 'Schelling 隔离模型' },
  'predator-prey': { en: 'Predator-prey (wolf-sheep-grass)', zh: '捕食者-猎物（狼-羊-草）' },
  opinion: { en: 'Opinion dynamics (Deffuant)', zh: '意见动力学（Deffuant）' },
  traffic: { en: 'Traffic flow (Nagel-Schreckenberg)', zh: '交通流（Nagel-Schreckenberg）' },
};

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(3);
  return v.toFixed(a < 10 ? 3 : 1);
}

interface RunResult {
  series: Aggregate[];
  final: ABMWorld;
}

export class SimAbmPlugin implements Plugin {
  readonly manifest = simAbmManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    template: 'schelling',
    cols: 40,
    rows: 40,
    density: 0.85,
    nPrey: 120,
    nPred: 30,
    nAgents: 400,
    tolerance: 0.5,
    preyReproduce: 0.04,
    predatorReproduce: 0.05,
    predatorEnergyLoss: 0.4,
    confidence: 0.3,
    mu: 0.3,
    interactRadius: 0.1,
    maxSpeed: 5,
    pSlow: 0.3,
    steps: 60,
    seed: 42,
    view: 'space',
  };
  private result: RunResult | null = null;
  private error: string | null = null;

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
    // First open: run the default template so the panel opens with content.
    if (!this.result && !this.error) this.run();
    else this.draw();
  }

  // ---- parameter panel -----------------------------------------------------

  private numParam(key: keyof State, en: string, zh: string, hint?: string): ParamDefinition {
    return {
      key,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
      type: 'number',
      value: this.state[key] as number,
      ...(hint ? { hint } : {}),
    };
  }

  getParams(): ParamDefinition[] {
    const s = this.state;
    const show = (key: keyof State): ParamDefinition['visibleWhen'] => {
      const templates = (Object.keys(TEMPLATE_PARAMS) as TemplateId[]).filter((t) => TEMPLATE_PARAMS[t]!.includes(key as string));
      return templates.length === 4 ? undefined : { key: 'template', in: templates };
    };
    const wrap = (p: ParamDefinition): ParamDefinition => ({ ...p, ...(show(p.key as keyof State) ? { visibleWhen: show(p.key as keyof State) } : {}) });
    return [
      actionButton('run', 'Run batch', '运行批量仿真', 'primary'),
      {
        key: 'template',
        label: 'Template',
        labelI18n: { 'zh-CN': '模型模板', 'en-US': 'Template' },
        type: 'select',
        options: (Object.keys(TEMPLATE_LABEL) as TemplateId[]).map((t) => ({
          value: t,
          label: TEMPLATE_LABEL[t]!.en,
          labelI18n: { 'zh-CN': TEMPLATE_LABEL[t]!.zh, 'en-US': TEMPLATE_LABEL[t]!.en },
        })),
        value: s.template,
      },
      wrap(this.numParam('cols', 'Grid columns', '网格列数')),
      wrap(this.numParam('rows', 'Grid rows', '网格行数')),
      wrap(this.numParam('density', 'Density', '密度', 'Schelling/traffic: fraction of occupied cells.')),
      wrap(this.numParam('tolerance', 'Tolerance', '容忍阈值', 'Minimum same-type neighbor share an agent accepts.')),
      wrap(this.numParam('nPrey', 'Prey count', '猎物数量')),
      wrap(this.numParam('nPred', 'Predator count', '捕食者数量')),
      wrap(this.numParam('preyReproduce', 'Prey reproduce rate', '猎物繁殖率')),
      wrap(this.numParam('predatorReproduce', 'Predator reproduce rate', '捕食者繁殖率')),
      wrap(this.numParam('predatorEnergyLoss', 'Predator energy loss / step', '捕食者每步能量损耗')),
      wrap(this.numParam('nAgents', 'Agent count', '智能体数量')),
      wrap(this.numParam('confidence', 'Confidence bound', '信任阈值', 'Deffuant bounded-confidence threshold.')),
      wrap(this.numParam('mu', 'Convergence speed mu', '收敛速度 mu')),
      wrap(this.numParam('interactRadius', 'Interaction radius', '交互半径')),
      wrap(this.numParam('maxSpeed', 'Max speed', '最大速度')),
      wrap(this.numParam('pSlow', 'Random slowdown p', '随机减速概率')),
      wrap(this.numParam('steps', 'Steps', '仿真步数')),
      wrap(this.numParam('seed', 'Seed', '随机种子')),
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'space', label: 'Agent space', labelI18n: { 'zh-CN': '智能体空间分布', 'en-US': 'Agent space' } },
          { value: 'series', label: 'Time series', labelI18n: { 'zh-CN': '聚合时间序列', 'en-US': 'Time series' } },
          { value: 'histogram', label: 'Attribute histogram', labelI18n: { 'zh-CN': '属性分布直方图', 'en-US': 'Attribute histogram' } },
        ],
        value: s.view,
      },
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    if (actionFired(params, 'run')) {
      this.run();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (typeof params.template === 'string' && TEMPLATE_LABEL[params.template as TemplateId]) s.template = params.template as TemplateId;
    const numKeys: Array<keyof State> = ['cols', 'rows', 'density', 'tolerance', 'nPrey', 'nPred', 'preyReproduce', 'predatorReproduce', 'predatorEnergyLoss', 'nAgents', 'confidence', 'mu', 'interactRadius', 'maxSpeed', 'pSlow', 'steps', 'seed'];
    for (const k of numKeys) {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        (s[k] as number) = v;
      }
    }
    s.cols = Math.min(Math.max(Math.round(s.cols), 4), 200);
    s.rows = Math.min(Math.max(Math.round(s.rows), 4), 200);
    s.nPrey = Math.min(Math.max(Math.round(s.nPrey), 1), 2000);
    s.nPred = Math.min(Math.max(Math.round(s.nPred), 0), 1000);
    s.nAgents = Math.min(Math.max(Math.round(s.nAgents), 10), 4000);
    s.steps = Math.min(Math.max(Math.round(s.steps), 1), 2000);
    s.seed = Math.round(s.seed);
    if (typeof params.view === 'string') s.view = params.view as State['view'];
    this.run();
  }

  // ---- computation -----------------------------------------------------------

  private initWorld(): ABMWorld {
    const s = this.state;
    const rng = createRng(s.seed);
    switch (s.template) {
      case 'schelling': return initSchelling(s.cols, s.rows, s.density, rng);
      case 'predator-prey': return initPredatorPrey(Math.max(s.cols, 20), Math.max(s.rows, 20), s.nPrey, s.nPred, rng);
      case 'opinion': return initOpinion(s.nAgents, rng);
      case 'traffic': return initTraffic(Math.max(s.cols * 4, 100), Math.min(Math.max(s.density, 0.05), 0.6), rng);
    }
  }

  private run() {
    this.error = null;
    try {
      const s = this.state;
      const world = this.initWorld();
      const params: Record<string, number> = {
        tolerance: s.tolerance,
        preyReproduce: s.preyReproduce,
        predatorReproduce: s.predatorReproduce,
        predatorEnergyLoss: s.predatorEnergyLoss,
        confidence: s.confidence,
        mu: s.mu,
        interactRadius: s.interactRadius,
        maxSpeed: s.maxSpeed,
        pSlow: s.pSlow,
      };
      const rng = createRng(s.seed + 1);
      const out = runBatch(world, s.template, s.steps, params, rng);
      this.result = { series: out.series, final: out.final };
      this.setOutputs();
    } catch (e) {
      this.result = null;
      this.error = e instanceof Error ? e.message : String(e);
      clearScienceOutputs(this.manifest.id);
    }
    this.draw();
  }

  private setOutputs() {
    const r = this.result;
    if (!r) return;
    const f = r.series[r.series.length - 1]!;
    const metrics: ScienceMetric[] = [
      { key: 'agents', label: this.zh ? '最终智能体数' : 'Final agents', value: fmtMetric(Object.values(f.counts).reduce((a, b) => a + b, 0)) },
    ];
    for (const [k, v] of Object.entries(f.counts)) metrics.push({ key: k, label: k, value: fmtMetric(v) });
    if (this.state.template === 'schelling') {
      metrics.push({ key: 'seg', label: this.zh ? '隔离指数' : 'Segregation index', value: fmtMetric(segregationIndex(r.final)) });
    }
    if (this.state.template === 'opinion' && f.means['type0.opinion'] !== undefined) {
      const ops = r.final.agents.map((a) => a.attrs.opinion!);
      const mu = ops.reduce((a, b) => a + b, 0) / ops.length;
      const sd = Math.sqrt(ops.reduce((a, b) => a + (b - mu) * (b - mu), 0) / Math.max(ops.length - 1, 1));
      metrics.push({ key: 'opMean', label: this.zh ? '最终意见均值' : 'Final mean opinion', value: fmtMetric(mu) });
      metrics.push({ key: 'opStd', label: this.zh ? '最终意见标准差' : 'Final opinion std', value: fmtMetric(sd) });
    }
    if (this.state.template === 'traffic') {
      const speeds = r.final.agents.map((a) => a.attrs.speed!);
      const meanSpeed = speeds.reduce((a, b) => a + b, 0) / Math.max(speeds.length, 1);
      metrics.push({ key: 'flow', label: this.zh ? '平均速度（通行能力代理）' : 'Mean speed (flow proxy)', value: fmtMetric(meanSpeed) });
    }
    metrics.push({ key: 'steps', label: this.zh ? '仿真步数' : 'Steps run', value: fmtMetric(this.state.steps) });
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportCsv() {
    const r = this.result;
    if (!r) {
      notify(this.api, 'warning', 'Run the batch first.', '请先运行批量仿真。');
      return;
    }
    const keys = Object.keys(r.series[0]!.counts).concat(Object.keys(r.series[0]!.means));
    const header = ['step', ...keys];
    const rows = r.series.map((agg) => [String(agg.step), ...keys.map((k) => String(agg.counts[k] ?? agg.means[k] ?? 0))] as Array<string | number>);
    exportRowsCsv(this.api, 'abm-timeseries', header, rows);
  }

  // ---- drawing ---------------------------------------------------------------

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
    if (this.error) {
      drawEmptyCanvas(this.api, canvas, { title: 'Invalid model', titleZh: '模型无效', hint: this.error, hintZh: this.error });
      return;
    }
    if (!this.result) {
      drawEmptyCanvas(this.api, canvas, { title: 'Agent-Based Modeling', titleZh: '智能体建模框架', hint: 'Press "Run batch" to simulate', hintZh: '点击"运行批量仿真"开始' });
      return;
    }
    switch (this.state.view) {
      case 'series': this.drawSeries(g, canvas); break;
      case 'histogram': this.drawHistogram(g, canvas); break;
      default: this.drawSpace(g, canvas);
    }
  }

  private frame(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, title: string, xLabel: string, yLabel: string) {
    const padL = Math.max(56, g.measureText(yLabel).width + 24);
    const padR = 20;
    const padT = 40;
    const padB = 46;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    g.fillStyle = '#c8d4e0';
    g.font = '15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(title, canvas.width / 2, 20);
    g.font = '11px system-ui, sans-serif';
    g.fillText(xLabel, (x0 + x1) / 2, canvas.height - 14);
    g.save();
    g.translate(14, (y0 + y1) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(yLabel, 0, 0);
    g.restore();
    g.strokeStyle = 'rgba(200,212,224,0.25)';
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    return { x0, x1, y0, y1 };
  }

  private ticks(lo: number, hi: number, count: number): number[] {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo];
    const rawStep = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(v);
    return out;
  }

  private drawSpace(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const w = this.result!.final;
    const s = this.state;
    const label = TEMPLATE_LABEL[s.template]!;
    const f = this.frame(g, canvas, `${this.zh ? label.zh : label.en}（${this.zh ? '第' : 'step '}${s.steps}${this.zh ? '步' : ''}）`, '', '');
    const x0 = f.x0 + 20;
    const y0 = f.y0 + 14;
    const x1 = f.x1 - 20;
    const y1 = f.y1 - 14;
    g.strokeStyle = 'rgba(200,212,224,0.35)';
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (s.template === 'schelling') {
      const cw = (x1 - x0) / w.cols;
      const ch = (y1 - y0) / w.rows;
      const occ = new Map<number, number>();
      for (const a of w.agents) occ.set(cellIndex(w, Math.floor((a.x * w.cols)), Math.floor((a.y * w.rows))), a.type);
      for (const [idx, type] of occ) {
        const cx = idx % w.cols;
        const cy = Math.floor(idx / w.cols);
        g.fillStyle = PALETTE[type]!;
        g.fillRect(x0 + cx * cw, y0 + cy * ch, Math.max(cw - 0.5, 0.5), Math.max(ch - 0.5, 0.5));
      }
      const seg = segregationIndex(w);
      g.fillStyle = '#8fa0b3';
      g.font = '11px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(`${this.zh ? '隔离指数' : 'Segregation index'}: ${seg.toFixed(3)}`, x0 + 6, y1 + 30 > canvas.height - 16 ? y0 + 14 : y1 - 8);
    } else if (s.template === 'predator-prey') {
      const cw = (x1 - x0) / w.cols;
      const ch = (y1 - y0) / w.rows;
      // grass shading
      for (let i = 0; i < w.grass!.length; i++) {
        const gv = w.grass![i]!;
        if (gv >= 0.98) {
          const cx = i % w.cols;
          const cy = Math.floor(i / w.cols);
          g.fillStyle = 'rgba(111,174,143,0.22)';
          g.fillRect(x0 + cx * cw, y0 + cy * ch, cw, ch);
        }
      }
      for (const a of w.agents) {
        const px = x0 + a.x * (x1 - x0);
        const py = y0 + a.y * (y1 - y0);
        g.fillStyle = PALETTE[a.type]!;
        g.beginPath();
        g.arc(px, py, a.type === 1 ? 3.2 : 2.2, 0, Math.PI * 2);
        g.fill();
      }
    } else if (s.template === 'opinion') {
      for (const a of w.agents) {
        const px = x0 + a.x * (x1 - x0);
        const py = y0 + a.y * (y1 - y0);
        // color blends from cool to warm with opinion value
        const v = Math.min(Math.max(a.attrs.opinion!, 0), 1);
        g.fillStyle = v < 0.5 ? `rgba(111,143,174,${0.9 - v * 0.6})` : `rgba(174,111,111,${0.6 + (v - 0.5) * 0.6})`;
        g.beginPath();
        g.arc(px, py, 2.6, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      // traffic: 1-lane ring drawn as a line with car squares
      for (const a of w.agents) {
        const px = x0 + (a.x / w.width) * (x1 - x0);
        const py = (y0 + y1) / 2;
        const sp = Math.min(a.attrs.speed! / Math.max(s.maxSpeed, 1), 1);
        g.fillStyle = sp > 0.66 ? '#6fae8f' : sp > 0.33 ? '#a0ae6f' : '#ae6f6f';
        g.fillRect(px - 3, py - 6, 6, 12);
      }
      g.fillStyle = '#8fa0b3';
      g.font = '11px system-ui, sans-serif';
      g.textAlign = 'left';
      const speeds = w.agents.map((a) => a.attrs.speed!);
      const ms = speeds.reduce((a, b) => a + b, 0) / Math.max(speeds.length, 1);
      g.fillText(`${this.zh ? '平均速度' : 'Mean speed'}: ${ms.toFixed(2)} / ${s.maxSpeed}`, x0 + 6, y1 - 8);
    }
  }

  private drawSeries(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const keys = Object.keys(r.series[0]!.counts);
    let hi = 1;
    for (const agg of r.series) for (const k of keys) hi = Math.max(hi, agg.counts[k] ?? 0);
    const n = r.series.length;
    const f = this.frame(g, canvas, this.zh ? '类型数量时间序列' : 'Type counts over time', this.zh ? '仿真步' : 'Step', this.zh ? '数量' : 'Count');
    const px = (i: number) => f.x0 + (i / Math.max(n - 1, 1)) * (f.x1 - f.x0);
    const py = (v: number) => f.y1 - (v / hi) * (f.y1 - f.y0);
    keys.forEach((k, ki) => {
      g.strokeStyle = PALETTE[ki % PALETTE.length]!;
      g.lineWidth = 1.5;
      g.beginPath();
      r.series.forEach((agg, i) => {
        const x = px(i);
        const y = py(agg.counts[k] ?? 0);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
      const last = r.series[n - 1]!;
      g.fillStyle = PALETTE[ki % PALETTE.length]!;
      g.textAlign = 'left';
      g.fillText(`${k} = ${last.counts[k] ?? 0}`, f.x0 + 8 + ki * 90, f.y0 + 14);
    });
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    for (const t of this.ticks(0, hi, 4)) {
      g.textAlign = 'right';
      g.fillText(fmtNum(t), f.x0 - 6, py(t) + 3);
    }
    for (const t of this.ticks(0, n - 1, 5)) {
      g.textAlign = 'center';
      g.fillText(String(Math.round(t)), px(t), f.y1 + 14);
    }
  }

  private drawHistogram(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const w = r.final;
    // pick the most informative attribute per template
    let values: number[] = [];
    let label = '';
    if (this.state.template === 'opinion') {
      values = w.agents.map((a) => a.attrs.opinion!);
      label = this.zh ? '意见值' : 'Opinion';
    } else if (this.state.template === 'predator-prey') {
      values = w.agents.filter((a) => a.type === 1).map((a) => a.attrs.energy!);
      label = this.zh ? '捕食者能量' : 'Predator energy';
    } else if (this.state.template === 'traffic') {
      values = w.agents.map((a) => a.attrs.speed!);
      label = this.zh ? '车速' : 'Speed';
    } else {
      values = w.agents.map((a) => (a.type === 0 ? 0 : 1));
      label = this.zh ? '类型' : 'Type';
    }
    if (!values.length) values = [0];
    const bins = 20;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const counts = new Array(bins).fill(0);
    for (const v of values) {
      let b = Math.floor(((v - lo) / span) * bins);
      if (b >= bins) b = bins - 1;
      counts[b]!++;
    }
    const maxC = Math.max(...counts, 1);
    const f = this.frame(g, canvas, this.zh ? `属性分布：${label}` : `Attribute distribution: ${label}`, label, this.zh ? '频数' : 'Count');
    const bw = (f.x1 - f.x0) / bins;
    for (let i = 0; i < bins; i++) {
      const x = f.x0 + i * bw;
      const hgt = (counts[i]! / maxC) * (f.y1 - f.y0);
      g.fillStyle = PALETTE[0]!;
      g.fillRect(x, f.y1 - hgt, Math.max(bw - 0.5, 0.5), hgt);
    }
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    for (const t of this.ticks(lo, hi, 5)) {
      const px = f.x0 + ((t - lo) / span) * (f.x1 - f.x0);
      g.textAlign = 'center';
      g.fillText(fmtNum(t), px, f.y1 + 14);
    }
    for (const t of this.ticks(0, maxC, 4)) {
      const py = f.y1 - (t / maxC) * (f.y1 - f.y0);
      g.textAlign = 'right';
      g.fillText(String(Math.round(t)), f.x0 - 6, py + 3);
    }
  }
}

export default function createSimAbmPlugin(): Plugin {
  return new SimAbmPlugin();
}
