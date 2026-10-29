// ==========================================================================
// sim-des — Discrete-event queueing network studio (2-D canvas).
//
// Views: process flow diagram, queue length over time, performance table with
// M/M/c analytic reference and bottleneck callout, wait-time histogram.
// Templates fully determine the network; runs are seeded and reproducible and
// feed the scienceOutput strip.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { simDesManifest } from './manifest';
import {
  DES_TEMPLATE_LABEL,
  distLabel,
  findBottleneck,
  mmcAnalytic,
  runDes,
  templateNetwork,
  waitHistogram,
  type DesRunResult,
  type DesTemplateId,
  type DistSpec,
  type NetworkSpec,
} from './kernel';

export { simDesManifest } from './manifest';

const PALETTE = ['#6f8fae', '#ae8f6f', '#6fae8f', '#ae6f8f', '#8f6fae', '#a0ae6f', '#6fa0ae', '#ae7f6f'];

type ViewId = 'flow' | 'queue' | 'performance' | 'histogram';

interface State {
  template: DesTemplateId;
  simTime: number;
  seed: number;
  /** Multiplier on the arrival rate (scales inter-arrival mean inversely). */
  arrivalScale: number;
  /** Multiplier on all service-time means. */
  serviceScale: number;
  view: ViewId;
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(3);
  return v.toFixed(a < 10 ? 3 : 1);
}

function scaleDist(d: DistSpec, k: number): DistSpec {
  if (k === 1) return d;
  switch (d.kind) {
    case 'exponential':
      return { ...d, mean: d.mean * k };
    case 'uniform':
      return { ...d, min: d.min * k, max: d.max * k };
    case 'triangular':
      return { ...d, min: d.min * k, mode: d.mode * k, max: d.max * k };
    case 'deterministic':
      return { ...d, value: d.value * k };
    case 'normal':
      return { ...d, mean: d.mean * k, sd: d.sd * k };
  }
}

export class SimDesPlugin implements Plugin {
  readonly manifest = simDesManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    template: 'bank',
    simTime: 480,
    seed: 42,
    arrivalScale: 1,
    serviceScale: 1,
    view: 'flow',
  };
  private result: DesRunResult | null = null;
  private spec: NetworkSpec | null = null;
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
    if (!this.result && !this.error) this.run();
    else this.draw();
  }

  // ---- parameter panel -----------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      actionButton('run', 'Simulate', '运行仿真', 'primary'),
      {
        key: 'template',
        label: 'Template',
        labelI18n: { 'zh-CN': '系统模板', 'en-US': 'Template' },
        type: 'select',
        options: (Object.keys(DES_TEMPLATE_LABEL) as DesTemplateId[]).map((t) => ({
          value: t,
          label: DES_TEMPLATE_LABEL[t]!.en,
          labelI18n: { 'zh-CN': DES_TEMPLATE_LABEL[t]!.zh, 'en-US': DES_TEMPLATE_LABEL[t]!.en },
        })),
        value: s.template,
      },
      { key: 'simTime', label: 'Simulation horizon', labelI18n: { 'zh-CN': '仿真时长', 'en-US': 'Simulation horizon' }, type: 'number', value: s.simTime, hint: 'Model time units.' },
      { key: 'seed', label: 'Random seed', labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Random seed' }, type: 'number', value: s.seed, hint: 'Same seed reproduces the run exactly.' },
      { key: 'arrivalScale', label: 'Arrival rate x', labelI18n: { 'zh-CN': '到达率倍率', 'en-US': 'Arrival rate x' }, type: 'number', value: s.arrivalScale, hint: 'Scales the arrival rate (1 = template default).' },
      { key: 'serviceScale', label: 'Service time x', labelI18n: { 'zh-CN': '服务时间倍率', 'en-US': 'Service time x' }, type: 'number', value: s.serviceScale, hint: 'Scales all service-time means (1 = template default).' },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'flow', label: 'Process flow', labelI18n: { 'zh-CN': '流程图', 'en-US': 'Process flow' } },
          { value: 'queue', label: 'Queue length over time', labelI18n: { 'zh-CN': '队列长度随时间变化', 'en-US': 'Queue length over time' } },
          { value: 'performance', label: 'Performance table', labelI18n: { 'zh-CN': '性能指标表', 'en-US': 'Performance table' } },
          { value: 'histogram', label: 'Wait-time histogram', labelI18n: { 'zh-CN': '等待时间直方图', 'en-US': 'Wait-time histogram' } },
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
    if (typeof params.template === 'string' && DES_TEMPLATE_LABEL[params.template as DesTemplateId]) s.template = params.template as DesTemplateId;
    if (typeof params.simTime === 'number') s.simTime = Math.min(Math.max(params.simTime, 1), 100000);
    if (typeof params.seed === 'number') s.seed = Math.floor(params.seed);
    if (typeof params.arrivalScale === 'number') s.arrivalScale = Math.min(Math.max(params.arrivalScale, 0.05), 10);
    if (typeof params.serviceScale === 'number') s.serviceScale = Math.min(Math.max(params.serviceScale, 0.05), 10);
    if (typeof params.view === 'string') s.view = params.view as ViewId;
    this.run();
  }

  // ---- computation -----------------------------------------------------------

  private run() {
    this.error = null;
    try {
      const s = this.state;
      const spec = templateNetwork(s.template);
      // Arrival scale k multiplies the rate, i.e. divides the inter-arrival mean.
      spec.arrival = scaleDist(spec.arrival, 1 / Math.max(s.arrivalScale, 1e-9));
      spec.stations = spec.stations.map((st) => ({ ...st, service: scaleDist(st.service, s.serviceScale) }));
      this.spec = spec;
      this.result = runDes(spec, { simTime: s.simTime, seed: s.seed });
      this.setOutputs();
    } catch (e) {
      this.result = null;
      this.spec = null;
      this.error = e instanceof Error ? e.message : String(e);
      clearScienceOutputs(this.manifest.id);
    }
    this.draw();
  }

  private setOutputs() {
    const r = this.result;
    const spec = this.spec;
    if (!r || !spec) return;
    const meanService = spec.stations.reduce((a, st) => a + meanOf(st.service), 0) / spec.stations.length;
    const metrics: ScienceMetric[] = [
      { key: 'arrivals', label: this.zh ? '到达总数' : 'Total arrivals', value: fmtNum(r.totalArrivals) },
      { key: 'completed', label: this.zh ? '完成作业' : 'Completed jobs', value: fmtNum(r.completed) },
      { key: 'throughput', label: this.zh ? '吞吐量' : 'Throughput', value: `${fmtNum(r.throughput)} / t` },
      { key: 'meanSojourn', label: this.zh ? '平均逗留时间' : 'Mean sojourn', value: fmtNum(r.sojournTimes.reduce((a, v) => a + v, 0) / Math.max(r.completed, 1)) },
      { key: 'littleL', label: this.zh ? '系统内平均作业数 L' : 'Mean jobs in system L', value: fmtNum(r.meanJobsInSystem) },
      { key: 'blocked', label: this.zh ? '阻塞/丢失' : 'Blocked / lost', value: fmtNum(r.blockedTotal) },
      { key: 'meanService', label: this.zh ? '平均服务时间' : 'Mean service time', value: fmtNum(meanService) },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportCsv() {
    const r = this.result;
    if (!r) return;
    const header = ['station', 'servers', 'utilization', 'meanQueueLength', 'maxQueueLength', 'meanWait', 'served', 'blocked', 'meanVisits'];
    const rows = r.stations.map((st) => [st.name, String(st.servers), fmtNum(st.utilization), fmtNum(st.meanQueueLength), String(st.maxQueueLength), fmtNum(st.meanWait), String(st.served), String(st.blocked), fmtNum(st.meanVisits)]);
    rows.push(['TOTAL', '', '', '', '', '', String(r.completed), String(r.blockedTotal), '']);
    void import('@/core/plugin-tools/enhance').then(({ exportRowsCsv }) => {
      exportRowsCsv(this.api, 'des-station-metrics', header, rows);
    });
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
      drawEmptyCanvas(this.api, canvas, { title: 'Simulation error', titleZh: '仿真错误', hint: this.error, hintZh: this.error });
      return;
    }
    if (!this.result) {
      drawEmptyCanvas(this.api, canvas, { title: 'Discrete Event Simulator', titleZh: '离散事件仿真', hint: 'Press "Simulate" to run the queueing network', hintZh: '点击"运行仿真"执行排队网络' });
      return;
    }
    switch (this.state.view) {
      case 'queue': this.drawQueue(g, canvas); break;
      case 'performance': this.drawPerformance(g, canvas); break;
      case 'histogram': this.drawHistogram(g, canvas); break;
      default: this.drawFlow(g, canvas);
    }
  }

  private frame(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, title: string, xLabel: string, yLabel: string) {
    const padL = Math.max(56, g.measureText(yLabel).width + 24);
    const x0 = padL;
    const x1 = canvas.width - 20;
    const y0 = 40;
    const y1 = canvas.height - 46;
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

  // ---- view: process flow ------------------------------------------------------

  private drawFlow(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const spec = this.spec!;
    const f = this.frame(g, canvas, this.zh ? '流程图（瓶颈以红框标出）' : 'Process flow (bottleneck outlined)', '', '');
    const bottleneck = findBottleneck(r.stations);
    const n = spec.stations.length;
    const boxW = Math.min(150, (f.x1 - f.x0 - 80) / Math.max(n, 1) - 20);
    const boxH = 64;
    const yMid = (f.y0 + f.y1) / 2;
    // Chain layout by station index; rework routes drawn as curved arcs below.
    const positions = spec.stations.map((_, i) => {
      const spread = (f.x1 - f.x0 - boxW - 40) / Math.max(n - 1, 1);
      const x = n === 1 ? (f.x0 + f.x1) / 2 : f.x0 + 20 + boxW / 2 + spread * i;
      return { x, y: yMid };
    });
    const arrow = (x1: number, y1: number, x2: number, y2: number, style: string) => {
      g.strokeStyle = style;
      g.fillStyle = style;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      const ang = Math.atan2(y2 - y1, x2 - x1);
      g.beginPath();
      g.moveTo(x2, y2);
      g.lineTo(x2 - 7 * Math.cos(ang - 0.4), y2 - 7 * Math.sin(ang - 0.4));
      g.lineTo(x2 - 7 * Math.cos(ang + 0.4), y2 - 7 * Math.sin(ang + 0.4));
      g.closePath();
      g.fill();
    };
    g.font = '11px system-ui, sans-serif';
    // Straight edges along the chain.
    for (let i = 0; i + 1 < n; i++) {
      const a = positions[i]!;
      const b = positions[i + 1]!;
      arrow(a.x + boxW / 2, a.y, b.x - boxW / 2, b.y, 'rgba(200,212,224,0.6)');
    }
    // Rework / skip edges as arcs under the chain.
    for (const rt of spec.routing) {
      if (rt.to === null || rt.to === rt.from + 1) continue;
      const a = positions[rt.from]!;
      const b = positions[rt.to]!;
      const lift = 46 + Math.abs(rt.to - rt.from) * 12;
      g.strokeStyle = rt.prob >= 1 ? 'rgba(174,143,111,0.7)' : 'rgba(174,143,111,0.55)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(a.x, a.y + boxH / 2);
      g.quadraticCurveTo((a.x + b.x) / 2, a.y + boxH / 2 + lift, b.x, b.y + boxH / 2);
      g.stroke();
      g.fillStyle = 'rgba(174,143,111,0.9)';
      g.textAlign = 'center';
      g.fillText(`${(rt.prob * 100).toFixed(0)}%`, (a.x + b.x) / 2, a.y + boxH / 2 + lift * 0.62);
    }
    // Station boxes.
    r.stations.forEach((st, i) => {
      const p = positions[i]!;
      const isBottleneck = bottleneck?.index === i;
      g.fillStyle = isBottleneck ? 'rgba(174,111,111,0.28)' : PALETTE[i % PALETTE.length]!;
      g.fillRect(p.x - boxW / 2, p.y - boxH / 2, boxW, boxH);
      if (isBottleneck) {
        g.strokeStyle = '#ae6f6f';
        g.lineWidth = 2;
        g.strokeRect(p.x - boxW / 2, p.y - boxH / 2, boxW, boxH);
      }
      g.fillStyle = '#0a0e13';
      g.textAlign = 'center';
      g.font = '12px system-ui, sans-serif';
      g.fillText(st.name.slice(0, 14), p.x, p.y - boxH / 2 + 16);
      g.font = '10px system-ui, sans-serif';
      g.fillText(`c=${st.servers}  ${distLabel(spec.stations[i]!.service).slice(0, 16)}`, p.x, p.y - boxH / 2 + 30);
      g.fillText(`${this.zh ? '利用率' : 'util'} ${fmtNum(st.utilization)}`, p.x, p.y - boxH / 2 + 44);
      g.fillText(`${this.zh ? '队长' : 'Lq'} ${fmtNum(st.meanQueueLength)}`, p.x, p.y - boxH / 2 + 57);
    });
    // Source arrow.
    if (n > 0) {
      const first = positions[0]!;
      arrow(f.x0 + 4, first.y, first.x - boxW / 2 - 2, first.y, 'rgba(111,174,143,0.8)');
      g.fillStyle = 'rgba(111,174,143,0.9)';
      g.textAlign = 'left';
      g.font = '10px system-ui, sans-serif';
      g.fillText(distLabel(spec.arrival), f.x0 + 6, first.y - 8);
    }
    if (bottleneck) {
      g.fillStyle = '#ae6f6f';
      g.textAlign = 'left';
      g.font = '11px system-ui, sans-serif';
      g.fillText(`${this.zh ? '瓶颈' : 'Bottleneck'}: ${bottleneck.name} (${fmtNum(bottleneck.utilization)})`, f.x0 + 8, f.y1 - 10);
    }
  }

  // ---- view: queue length over time ---------------------------------------------

  private drawQueue(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const series = r.queueSeries;
    if (series.length < 2) {
      drawEmptyCanvas(this.api, canvas, { title: 'Queue length', titleZh: '队列长度', hint: 'Not enough events recorded', hintZh: '记录的事件不足' });
      return;
    }
    const nSt = series[0]!.lengths.length;
    let hi = 1;
    for (const s of series) for (const v of s.lengths) if (v > hi) hi = v;
    hi = Math.ceil(hi);
    const f = this.frame(g, canvas, this.zh ? '各工位队列长度（事件采样）' : 'Queue length per station (event-sampled)', 't', this.zh ? '队列长度' : 'Jobs waiting');
    const t0 = series[0]!.t;
    const t1 = series[series.length - 1]!.t;
    const px = (t: number) => f.x0 + ((t - t0) / (t1 - t0 || 1)) * (f.x1 - f.x0);
    const py = (v: number) => f.y1 - (v / hi) * (f.y1 - f.y0);
    for (let s = 0; s < nSt; s++) {
      g.strokeStyle = PALETTE[s % PALETTE.length]!;
      g.lineWidth = 1.4;
      g.beginPath();
      let started = false;
      for (const point of series) {
        const v = point.lengths[s] ?? 0;
        const x = px(point.t);
        const y = py(v);
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.font = '11px system-ui, sans-serif';
    for (let s = 0; s < nSt; s++) {
      g.fillStyle = PALETTE[s % PALETTE.length]!;
      g.textAlign = 'left';
      g.fillText(r.stations[s]!.name.slice(0, 14), f.x0 + 8 + s * 110, f.y0 + 14);
    }
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    for (const t of this.ticks(t0, t1, 6)) {
      g.textAlign = 'center';
      g.fillText(fmtNum(t), px(t), f.y1 + 14);
    }
    for (const v of this.ticks(0, hi, 4)) {
      g.textAlign = 'right';
      g.fillText(fmtNum(v), f.x0 - 6, py(v) + 3);
    }
  }

  // ---- view: performance table ----------------------------------------------------

  private drawPerformance(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const spec = this.spec!;
    const f = this.frame(g, canvas, this.zh ? '性能指标表' : 'Performance table', '', '');
    const cols = [
      this.zh ? '工位' : 'Station',
      'c',
      this.zh ? '利用率' : 'Util',
      this.zh ? '平均队长' : 'Lq',
      this.zh ? '最大队长' : 'Lq max',
      this.zh ? '平均等待' : 'Wq',
      this.zh ? '服务数' : 'Served',
      this.zh ? '阻塞' : 'Blocked',
    ];
    const colX = [f.x0 + 10, f.x0 + 140, f.x0 + 170, f.x0 + 240, f.x0 + 320, f.x0 + 400, f.x0 + 470, f.x0 + 540];
    const rowH = 22;
    let y = f.y0 + 18;
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = '#8fa0b3';
    g.textAlign = 'left';
    cols.forEach((c, i) => g.fillText(c, colX[Math.min(i, colX.length - 1)]!, y));
    y += rowH;
    g.textAlign = 'left';
    const bottleneck = findBottleneck(r.stations);
    r.stations.forEach((st, i) => {
      const vals = [st.name, String(st.servers), fmtNum(st.utilization), fmtNum(st.meanQueueLength), String(st.maxQueueLength), fmtNum(st.meanWait), String(st.served), String(st.blocked)];
      g.fillStyle = bottleneck?.index === i ? '#c98f8f' : '#c8d4e0';
      vals.forEach((v, ci) => g.fillText(v, colX[Math.min(ci, colX.length - 1)]!, y));
      y += rowH;
    });
    y += 8;
    g.fillStyle = '#8fa0b3';
    const rows: [string, string][] = [
      [this.zh ? '到达总数' : 'Total arrivals', String(r.totalArrivals)],
      [this.zh ? '完成作业' : 'Completed', String(r.completed)],
      [this.zh ? '吞吐量（作业/单位时间）' : 'Throughput (jobs / time unit)', fmtNum(r.throughput)],
      [this.zh ? '系统内平均作业数 L' : 'Mean jobs in system L', fmtNum(r.meanJobsInSystem)],
      [this.zh ? '平均逗留时间 W' : 'Mean sojourn W', fmtNum(r.completed > 0 ? r.sojournTimes.reduce((a, v) => a + v, 0) / r.completed : NaN)],
      [this.zh ? '平均等待 Wq（全体作业）' : 'Mean wait Wq (all jobs)', fmtNum(r.waitTimes.length > 0 ? r.waitTimes.reduce((a, v) => a + v, 0) / r.waitTimes.length : NaN)],
      [this.zh ? '阻塞/丢失总数' : 'Blocked / lost', String(r.blockedTotal)],
      [`${this.zh ? 'Little 定律核验' : 'Little\u2019s law check'}: L = λW → ${fmtNum(r.throughput * (r.completed > 0 ? r.sojournTimes.reduce((a, v) => a + v, 0) / r.completed : 0))}`, `vs L = ${fmtNum(r.meanJobsInSystem)}`],
    ];
    for (const [k, v] of rows) {
      g.fillText(k, f.x0 + 10, y);
      g.fillStyle = '#c8d4e0';
      g.fillText(v, f.x0 + 320, y);
      g.fillStyle = '#8fa0b3';
      y += rowH;
    }
    // Analytic M/M/c reference for single-station networks.
    if (spec.stations.length === 1) {
      const st = spec.stations[0]!;
      const meanIat = meanOf(spec.arrival);
      const meanSvc = meanOf(st.service);
      const lambda = 1 / meanIat;
      const mu = 1 / meanSvc;
      const an = mmcAnalytic(lambda, mu, st.servers);
      y += 6;
      g.fillStyle = '#6fae8f';
      g.fillText(`${this.zh ? 'M/M/c 解析参照' : 'M/M/c analytic reference'} (${st.name}, λ=${fmtNum(lambda)}, μ=${fmtNum(mu)}, c=${st.servers})`, f.x0 + 10, y);
      y += rowH;
      g.fillStyle = '#8fa0b3';
      g.fillText(`${this.zh ? '解析' : 'Analytic'}: ρ=${fmtNum(an.rho)}, ErlangC=${fmtNum(an.erlangC)}, Wq=${fmtNum(an.Wq)}, Lq=${fmtNum(an.Lq)}${an.stable ? '' : ` — ${this.zh ? '不稳定 (ρ ≥ 1)' : 'unstable (rho >= 1)'}`}`, f.x0 + 10, y);
    }
  }

  // ---- view: wait-time histogram ----------------------------------------------------

  private drawHistogram(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    if (r.waitTimes.length < 2) {
      drawEmptyCanvas(this.api, canvas, { title: 'Wait-time histogram', titleZh: '等待时间直方图', hint: 'No completed jobs recorded', hintZh: '没有已完成的作业' });
      return;
    }
    const bins = 24;
    const h = waitHistogram(r.waitTimes, bins);
    const maxCount = Math.max(...h.counts, 1);
    const f = this.frame(g, canvas, this.zh ? '排队等待时间分布（已完成作业）' : 'Queue wait distribution (completed jobs)', this.zh ? '总等待时间' : 'Total wait', this.zh ? '频数' : 'Count');
    const bw = (f.x1 - f.x0) / bins;
    h.counts.forEach((c, i) => {
      const bh = (c / maxCount) * (f.y1 - f.y0);
      g.fillStyle = PALETTE[0]!;
      g.fillRect(f.x0 + i * bw + 1, f.y1 - bh, bw - 2, bh);
    });
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    for (const v of this.ticks(0, h.binWidth * bins, 6)) {
      const x = f.x0 + (v / (h.binWidth * bins)) * (f.x1 - f.x0);
      g.textAlign = 'center';
      g.fillText(fmtNum(v), x, f.y1 + 14);
    }
    for (const v of this.ticks(0, maxCount, 4)) {
      const y = f.y1 - (v / maxCount) * (f.y1 - f.y0);
      g.textAlign = 'right';
      g.fillText(fmtNum(v), f.x0 - 6, y + 3);
    }
    const mean = r.waitTimes.reduce((a, v) => a + v, 0) / r.waitTimes.length;
    g.fillStyle = '#c8d4e0';
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(`n=${r.waitTimes.length}  mean=${fmtNum(mean)}  max=${fmtNum(Math.max(...r.waitTimes))}`, f.x0 + 8, f.y0 + 14);
  }
}

/** Arithmetic mean of a distribution spec's support (for analytic rates). */
function meanOf(d: DistSpec): number {
  switch (d.kind) {
    case 'exponential':
      return d.mean;
    case 'uniform':
      return (d.min + d.max) / 2;
    case 'triangular':
      return (d.min + d.mode + d.max) / 3;
    case 'deterministic':
      return d.value;
    case 'normal':
      return d.mean;
  }
}

export default function createSimDesPlugin(): Plugin {
  return new SimDesPlugin();
}
