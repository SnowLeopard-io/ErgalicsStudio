// ==========================================================================
// sim-des — discrete-event simulation workbench (2-D canvas)
//
// Panel: pick a built-in template, edit the serializable model JSON, set the
// entity count and PRNG seed, then Run (synchronous — a few thousand entities
// simulate in milliseconds). Four canvas views: process flow map (stations,
// queues as proportional squares, routing arrows, bottleneck highlighted in a
// warm accent), queue-length time series, a per-station performance table and
// an end-to-end wait-time histogram. Scientific outputs publish throughput,
// mean sojourn, the bottleneck and the Little's-law residual; same seed ⇒
// identical results.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { simDesManifest } from './manifest';
import {
  DES_TEMPLATES,
  hashSeed,
  parseDesModel,
  runDES,
  templateById,
  templateJson,
  type DesModel,
  type DesResult,
} from './kernel';

export { simDesManifest } from './manifest';

/** Low-saturation academic palette for per-station curves and boxes. */
const PALETTE = ['#6f8fae', '#ae8f6f', '#6fae8f', '#ae6f8f', '#8f6fae', '#a0ae6f', '#6fa0ae', '#ae7f6f'];
/** Warm accent reserved for the bottleneck highlight. */
const ACCENT = '#c98246';
const TEXT_MAIN = 'rgba(230,238,248,0.95)';
const TEXT_DIM = 'rgba(160,175,195,0.9)';
const GRID = 'rgba(120,140,165,0.16)';

type ViewKind = 'flow' | 'queue' | 'table' | 'histogram';

interface DesState {
  template: string;
  modelText: string;
  entities: string;
  seed: string;
  priority: boolean;
  view: ViewKind;
}

/** Clamp the entity count from its free-text param. */
function clampEntities(text: string): number {
  const n = Math.floor(Number(text));
  if (!Number.isFinite(n)) return 5000;
  return Math.min(200000, Math.max(1, n));
}

/** Seed from text: integer strings map directly, anything else is hashed. */
function parseSeed(text: string): number {
  const t = text.trim();
  if (/^-?\d+$/.test(t)) return Number(t) >>> 0;
  return hashSeed(t.length > 0 ? t : 'ergalics');
}

/** Round a positive maximum up to a readable 1/2/5×10^k axis bound. */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 5, 10]) {
    if (v <= m * base) return m * base;
  }
  return 10 * base;
}

export class DesPlugin implements Plugin {
  readonly manifest = simDesManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: DesState = {
    template: DES_TEMPLATES[0]!.id,
    modelText: templateJson(DES_TEMPLATES[0]!.id),
    entities: '5000',
    seed: '42',
    priority: true,
    view: 'flow',
  };
  private model: DesModel | null = null;
  private modelError: string | null = null;
  private result: DesResult | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.publishScience();
      this.draw();
    });
    // Open with the default template already simulated.
    this.recompute();
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.draw();
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  // ---- parameters ----------------------------------------------------------

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'template',
        label: 'Template',
        labelI18n: { 'zh-CN': '内置模板', 'en-US': 'Template' },
        type: 'select',
        options: DES_TEMPLATES.map((t) => ({
          value: t.id,
          label: t.name,
          labelI18n: { 'zh-CN': t.nameZh, 'en-US': t.name },
        })),
        value: this.state.template,
      },
      {
        key: 'modelText',
        label: 'Model JSON',
        labelI18n: { 'zh-CN': '模型定义（JSON）', 'en-US': 'Model JSON' },
        type: 'text',
        value: this.state.modelText,
        placeholder: '{"source":{...},"stations":[...]}',
        hint: 'source (arrival, entityLimit) + stations (servers, queueDiscipline, serviceTime, routing: next | exit | probabilities | rework). Entities enter the first station.',
      },
      {
        key: 'entities',
        label: 'Entities',
        labelI18n: { 'zh-CN': '实体数量', 'en-US': 'Entities' },
        type: 'text',
        value: this.state.entities,
        hint: 'Total entities the source creates (overrides model JSON). Finite cap guarantees termination.',
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'text',
        value: this.state.seed,
        hint: 'Same seed + model ⇒ identical, reproducible run.',
      },
      {
        key: 'priority',
        label: 'Priority queues',
        labelI18n: { 'zh-CN': '优先级排队', 'en-US': 'Priority queues' },
        type: 'checkbox',
        value: this.state.priority,
        hint: 'Honor "priority" disciplines (high-priority entities first). Off = FIFO everywhere.',
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'flow', label: 'Process flow', labelI18n: { 'zh-CN': '流程图', 'en-US': 'Process flow' } },
          { value: 'queue', label: 'Queue length', labelI18n: { 'zh-CN': '队列长度时序', 'en-US': 'Queue length' } },
          { value: 'table', label: 'Performance table', labelI18n: { 'zh-CN': '性能指标表', 'en-US': 'Performance table' } },
          { value: 'histogram', label: 'Wait distribution', labelI18n: { 'zh-CN': '等待时间分布', 'en-US': 'Wait distribution' } },
        ],
        value: this.state.view,
      },
      actionButton('run', 'Run simulation', '运行仿真', 'primary'),
      actionButton('exportCsv', 'Export CSV', '导出指标 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.template === 'string' && templateById(params.template) && params.template !== this.state.template) {
      this.state.template = params.template;
      this.state.modelText = templateJson(params.template);
      this.recompute();
    }
    if (typeof params.modelText === 'string' && params.modelText !== this.state.modelText) {
      this.state.modelText = params.modelText;
      // Keep the select aligned when the JSON matches a built-in template.
      const match = DES_TEMPLATES.find((t) => JSON.stringify(t.model) === JSON.stringify(safeParse(params.modelText)));
      if (match) this.state.template = match.id;
      this.recompute();
    }
    if (typeof params.entities === 'string' && params.entities !== this.state.entities) {
      this.state.entities = params.entities;
      this.recompute();
    }
    if (typeof params.seed === 'string' && params.seed !== this.state.seed) {
      this.state.seed = params.seed;
      this.recompute();
    }
    if (typeof params.priority === 'boolean' && params.priority !== this.state.priority) {
      this.state.priority = params.priority;
      this.recompute();
    }
    if (
      typeof params.view === 'string' &&
      (params.view === 'flow' || params.view === 'queue' || params.view === 'table' || params.view === 'histogram') &&
      params.view !== this.state.view
    ) {
      this.state.view = params.view;
      this.draw();
    }
    if (actionFired(params, 'run')) {
      this.recompute();
      if (this.result) {
        const r = this.result;
        notify(
          this.api,
          'success',
          `Simulated ${r.entitiesExited}/${r.entitiesCreated} entities in ${r.simTime.toFixed(1)} tu; bottleneck "${this.bottleneckLabel()}".`,
          `已仿真 ${r.entitiesExited}/${r.entitiesCreated} 个实体，耗时 ${r.simTime.toFixed(1)} tu；瓶颈工站「${this.bottleneckLabel()}」。`,
        );
      }
    }
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  // ---- computation ---------------------------------------------------------

  /** Clone the parsed model, apply the priority toggle and entity override. */
  private effectiveModel(): DesModel | null {
    const parsed = parseDesModel(this.state.modelText);
    if (!parsed.ok) {
      this.modelError = parsed.error;
      return null;
    }
    const model = JSON.parse(JSON.stringify(parsed.model)) as DesModel;
    model.source.entityLimit = clampEntities(this.state.entities);
    if (!this.state.priority) {
      for (const s of model.stations) {
        if (s.queueDiscipline === 'priority') s.queueDiscipline = 'fifo';
      }
    }
    this.modelError = null;
    return model;
  }

  private recompute(): void {
    const model = this.effectiveModel();
    if (!model) {
      this.model = null;
      this.result = null;
      this.publishScience();
      this.draw();
      return;
    }
    this.model = model;
    this.result = runDES(model, { seed: parseSeed(this.state.seed), buckets: 200 });
    this.publishScience();
    this.draw();
  }

  private bottleneckLabel(): string {
    const r = this.result;
    if (!r) return '—';
    const st = r.stations.find((s) => s.id === r.bottleneckId);
    const name = st ? (this.zh && st.nameZh ? st.nameZh : st.name) : r.bottleneckId;
    return `${name} ${(r.bottleneckUtilization * 100).toFixed(1)}%`;
  }

  private publishScience(): void {
    const r = this.result;
    if (!r) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'throughput',
        label: zh ? '吞吐率' : 'Throughput',
        value: fmtMetric(r.throughput),
        unit: zh ? '实体/tu' : 'entities/tu',
        hint: zh ? '单位时间离开系统的实体数（出口吞吐 = λ 实测）' : 'Entities leaving the system per time unit (measured λ)',
      },
      {
        key: 'sojourn',
        label: zh ? '平均逗留时间' : 'Mean sojourn',
        value: fmtMetric(r.meanSojourn),
        unit: 'tu',
        hint: zh ? '端到端在系统平均时间 W（含全部排队与服务）' : 'End-to-end time in system W (all queues + services)',
      },
      {
        key: 'bottleneck',
        label: zh ? '瓶颈工站' : 'Bottleneck',
        value: this.bottleneckLabel(),
        severity: 'warn',
        hint: zh ? '按时间平均利用率排序，最高者即瓶颈' : 'Highest time-averaged utilization station',
      },
      {
        key: 'littles',
        label: zh ? 'Little 定律残差' : "Little's law residual",
        value: fmtMetric(r.littlesResidual),
        severity: r.littlesResidual < 0.05 ? 'ok' : 'warn',
        hint: zh ? '|L − λW|/L：实测 L、λ、W 的相容性检验（<0.05 为佳）' : '|L − λW|/L: consistency of measured L, λ, W (<0.05 is good)',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportCsv(): void {
    const r = this.result;
    if (!r) {
      notify(this.api, 'warning', 'Run a simulation first.', '请先运行一次仿真。');
      return;
    }
    const header = [
      'station',
      'servers',
      'utilization',
      'avg_queue',
      'max_queue',
      'avg_wait',
      'max_wait',
      'avg_service',
      'arrivals',
      'departures',
      'revisits',
      'little_residual',
    ];
    const rows = r.stations.map((s) => [
      s.id,
      s.servers,
      s.utilization.toFixed(4),
      s.avgQueue.toFixed(4),
      String(s.maxQueue),
      s.avgWait.toFixed(4),
      s.maxWait.toFixed(4),
      s.avgService.toFixed(4),
      String(s.arrivals),
      String(s.departures),
      String(s.revisits),
      s.littleResidual.toFixed(4),
    ]);
    exportRowsCsv(this.api, 'des-station-metrics', header, rows);
  }

  // ---- drawing -------------------------------------------------------------

  private font(size: number): string {
    return `${size}px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  }

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

    if (this.modelError) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'Model JSON invalid',
        titleZh: '模型 JSON 无效',
        hint: this.modelError,
        hintZh: this.modelError,
      });
      return;
    }
    if (!this.result || !this.model) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No simulation yet',
        titleZh: '尚未运行仿真',
        hint: 'Pick a template (or edit the model JSON) and press Run.',
        hintZh: '选择模板（或编辑模型 JSON）后点击「运行仿真」。',
      });
      return;
    }
    if (this.state.view === 'flow') this.drawFlow(g, canvas);
    else if (this.state.view === 'queue') this.drawSeries(g, canvas);
    else if (this.state.view === 'table') this.drawTable(g, canvas);
    else this.drawHistogram(g, canvas);
  }

  /** View title in the canvas corner. */
  private viewTitle(g: CanvasRenderingContext2D, en: string, zh: string): void {
    g.textAlign = 'left';
    g.fillStyle = TEXT_DIM;
    g.font = this.font(12);
    g.fillText(this.zh ? zh : en, 16, 22);
  }

  private roundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rad = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }

  /** Straight arrow with head and optional mid-label. */
  private arrow(
    g: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    dashed = false,
    label?: string,
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 6) return;
    const ux = dx / len;
    const uy = dy / len;
    const ex = x1 - ux * 9;
    const ey = y1 - uy * 9;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 1.4;
    g.setLineDash(dashed ? [5, 4] : []);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(ex, ey);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(ex - uy * 4.5, ey + ux * 4.5);
    g.lineTo(ex + uy * 4.5, ey - ux * 4.5);
    g.closePath();
    g.fill();
    if (label) {
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      g.font = this.font(10);
      const w = g.measureText(label).width;
      g.fillStyle = 'rgba(10,14,19,0.85)';
      g.fillRect(mx - w / 2 - 3, my - 8, w + 6, 14);
      g.fillStyle = TEXT_DIM;
      g.textAlign = 'center';
      g.fillText(label, mx, my + 3);
      g.textAlign = 'left';
    }
  }

  /** Station boxes + routing arrows + proportional queue squares. */
  private drawFlow(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const r = this.result!;
    const model = this.model!;
    const n = model.stations.length;
    const W = canvas.width;
    const H = canvas.height;
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(n))));
    const rows = Math.ceil(n / cols);
    const left = 118;
    const cellW = Math.max(bwMin(W, cols), 140);
    const bw = Math.min(176, cellW - 40);
    const cellH = Math.max(96, (H - 70) / rows);
    const bh = Math.min(58, cellH - 38);
    const bx = (i: number): number => left + (i % cols) * cellW + (cellW - bw) / 2;
    const by = (i: number): number => 46 + Math.floor(i / cols) * cellH + (cellH - bh) / 2 - 6;
    const idIndex = new Map<string, number>();
    model.stations.forEach((s, i) => idIndex.set(s.id, i));

    this.viewTitle(g, `Process flow — ${this.templateName()}`, `流程图 — ${this.templateName(true)}`);

    const hasExit = (i: number): boolean => {
      const rt = model.stations[i]!.routing;
      if (rt.kind === 'exit') return true;
      if (rt.kind === 'probabilities') return rt.options.some((o) => o.id === 'exit');
      return false;
    };

    // Arrows first; boxes painted afterwards cover the line ends.
    const sourceY = by(0) + bh / 2;
    this.arrow(g, 100, sourceY, bx(0) + 1, sourceY, TEXT_DIM, false, undefined);
    for (let i = 0; i < n; i += 1) {
      const rt = model.stations[i]!.routing;
      const x0 = bx(i) + bw / 2;
      const y0 = by(i) + bh / 2;
      const targets: Array<{ id: string; p?: number; dashed: boolean }> = [];
      if (rt.kind === 'next') targets.push({ id: rt.id, dashed: false });
      else if (rt.kind === 'rework') targets.push({ id: rt.id, dashed: true });
      else if (rt.kind === 'probabilities') {
        for (const o of rt.options) {
          if (o.id !== 'exit') targets.push({ id: o.id, p: o.p, dashed: false });
        }
      }
      for (const tg of targets) {
        const j = idIndex.get(tg.id);
        if (j === undefined) continue;
        const label =
          tg.p === undefined ? (tg.dashed ? (this.zh ? '返工' : 'rework') : undefined) : `${Math.round(tg.p * 100)}%`;
        this.arrow(g, x0, y0, bx(j) + bw / 2, by(j) + bh / 2, tg.dashed ? ACCENT : TEXT_DIM, tg.dashed, label);
      }
      if (hasExit(i)) {
        const ex = bx(i) + bw + 30;
        this.arrow(g, bx(i) + bw, y0, ex, y0, TEXT_DIM);
        g.fillStyle = TEXT_DIM;
        g.beginPath();
        g.arc(ex + 5, y0, 3, 0, Math.PI * 2);
        g.fill();
        g.font = this.font(10);
        g.textAlign = 'center';
        g.fillStyle = TEXT_DIM;
        g.fillText(this.zh ? '出口' : 'exit', ex + 5, y0 + 16);
        g.textAlign = 'left';
      }
    }

    // Source box.
    g.fillStyle = 'rgba(111,143,174,0.14)';
    g.strokeStyle = PALETTE[0]!;
    g.lineWidth = 1.2;
    this.roundedRect(g, 20, sourceY - 18, 80, 36, 6);
    g.fill();
    g.stroke();
    g.fillStyle = TEXT_MAIN;
    g.font = this.font(11);
    g.textAlign = 'center';
    g.fillText(this.zh ? '源' : 'Source', 60, sourceY - 2);
    g.fillStyle = TEXT_DIM;
    g.font = this.font(9);
    g.fillText(model.source.entityLimit > 0 ? `N=${model.source.entityLimit}` : '', 60, sourceY + 11);
    g.textAlign = 'left';

    // Station boxes.
    for (let i = 0; i < n; i += 1) {
      const s = model.stations[i]!;
      const st = r.stations[i]!;
      const isBn = s.id === r.bottleneckId;
      const x = bx(i);
      const y = by(i);
      g.fillStyle = 'rgba(111,143,174,0.16)';
      g.strokeStyle = isBn ? ACCENT : PALETTE[i % PALETTE.length]!;
      g.lineWidth = isBn ? 2 : 1.2;
      this.roundedRect(g, x, y, bw, bh, 6);
      g.fill();
      g.stroke();
      g.textAlign = 'center';
      g.fillStyle = TEXT_MAIN;
      g.font = this.font(12);
      const name = this.zh && s.nameZh ? s.nameZh : (s.name ?? s.id);
      g.fillText(truncate(g, name, bw - 12), x + bw / 2, y + 18);
      g.fillStyle = isBn ? ACCENT : TEXT_DIM;
      g.font = this.font(10);
      g.fillText(`c=${st.servers}  util ${(st.utilization * 100).toFixed(1)}%`, x + bw / 2, y + 35);
      g.fillText(`Wq ${st.avgWait.toFixed(2)} tu`, x + bw / 2, y + 49);
      if (isBn) {
        g.fillStyle = ACCENT;
        g.font = this.font(10);
        g.fillText(this.zh ? '瓶颈' : 'bottleneck', x + bw / 2, y - 6);
      }
      // Queue squares proportional to the time-averaged queue length.
      const k = Math.min(24, Math.round(st.avgQueue));
      const qx = x;
      const qy = y + bh + 10;
      g.fillStyle = PALETTE[i % PALETTE.length]!;
      for (let q = 0; q < k; q += 1) {
        g.globalAlpha = 0.75;
        g.fillRect(qx + q * 9, qy, 7, 7);
        g.globalAlpha = 1;
      }
      g.fillStyle = TEXT_DIM;
      g.font = this.font(10);
      g.textAlign = 'left';
      g.fillText(`q=${st.avgQueue.toFixed(2)}`, qx + k * 9 + (k > 0 ? 6 : 0), qy + 7);
    }
    g.textAlign = 'left';
  }

  private templateName(zh = false): string {
    const t = templateById(this.state.template);
    if (!t) return this.zh ? '自定义' : 'custom';
    return zh ? t.nameZh : t.name;
  }

  /** Per-station queue-length lines over time buckets. */
  private drawSeries(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const r = this.result!;
    const model = this.model!;
    const s = r.series;
    const x0 = 56;
    const y0 = 44;
    const x1 = canvas.width - 18;
    const y1 = canvas.height - 34;
    let yMax = 0.5;
    for (const row of s.queueLen) {
      for (const v of row) if (v > yMax) yMax = v;
    }
    yMax = niceCeil(yMax);
    const px = (b: number): number => x0 + ((x1 - x0) * (b + 0.5)) / s.count;
    const py = (v: number): number => y1 - ((y1 - y0) * v) / yMax;

    this.viewTitle(g, 'Queue length over time (time-averaged)', '队列长度时序（时间加权）');

    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.fillStyle = TEXT_DIM;
    g.font = this.font(10);
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      const v = (yMax * k) / 4;
      const y = py(v);
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillText(formatCount(v), x0 - 6, y + 3);
    }
    g.textAlign = 'center';
    for (let k = 0; k <= 5; k += 1) {
      const b = Math.round((k * (s.count - 1)) / 5);
      g.fillText(formatTime((b + 1) * s.width), px(b), y1 + 16);
    }
    g.textAlign = 'left';
    g.fillText(this.zh ? '时间 (tu)' : 'time (tu)', x1 - 58, y1 + 30);

    for (let i = 0; i < s.queueLen.length; i += 1) {
      const row = s.queueLen[i]!;
      g.strokeStyle = model.stations[i]!.id === r.bottleneckId ? ACCENT : PALETTE[i % PALETTE.length]!;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let b = 0; b < row.length; b += 1) {
        const x = px(b);
        const y = py(row[b]!);
        if (b === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }

    // Legend.
    g.font = this.font(10);
    let ly = y0 - 8;
    for (let i = 0; i < s.queueLen.length; i += 1) {
      const st = r.stations[i]!;
      const name = this.zh && st.nameZh ? st.nameZh : st.name;
      const isBn = st.id === r.bottleneckId;
      g.fillStyle = isBn ? ACCENT : PALETTE[i % PALETTE.length]!;
      g.fillRect(x1 - 118, ly - 8, 8, 8);
      g.fillStyle = TEXT_DIM;
      g.textAlign = 'left';
      g.fillText(truncate(g, name, 104), x1 - 106, ly);
      ly += 14;
    }
  }

  /** Aligned per-station performance table rendered as text columns. */
  private drawTable(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const r = this.result!;
    const W = canvas.width;
    const H = canvas.height;
    this.viewTitle(g, 'Performance table', '性能指标表');
    const cols: Array<{ label: string; labelZh: string; x: number; align: 'left' | 'right' }> = [
      { label: 'Station', labelZh: '工站', x: 0.04, align: 'left' },
      { label: 'c', labelZh: 'c', x: 0.3, align: 'right' },
      { label: 'Util %', labelZh: '利用率%', x: 0.42, align: 'right' },
      { label: 'q avg', labelZh: '平均队长', x: 0.53, align: 'right' },
      { label: 'q max', labelZh: '最大队长', x: 0.64, align: 'right' },
      { label: 'Wait', labelZh: '平均等待', x: 0.77, align: 'right' },
      { label: 'Svc', labelZh: '平均服务', x: 0.9, align: 'right' },
    ];
    const rowH = Math.min(24, Math.max(16, (H - 130) / Math.max(1, r.stations.length)));
    const top = 58;
    g.font = this.font(11);
    for (const c of cols) {
      const x = c.x * W;
      g.fillStyle = TEXT_DIM;
      g.textAlign = c.align;
      g.fillText(this.zh ? c.labelZh : c.label, x, top);
    }
    g.strokeStyle = GRID;
    g.beginPath();
    g.moveTo(0.03 * W, top + 6);
    g.lineTo(0.97 * W, top + 6);
    g.stroke();
    for (let i = 0; i < r.stations.length; i += 1) {
      const st = r.stations[i]!;
      const y = top + 24 + i * rowH;
      const isBn = st.id === r.bottleneckId;
      const name = this.zh && st.nameZh ? st.nameZh : st.name;
      g.fillStyle = isBn ? ACCENT : TEXT_MAIN;
      g.font = this.font(11);
      g.textAlign = 'left';
      g.fillText(`${isBn ? '▲ ' : ''}${truncate(g, name, 0.26 * W)}`, 0.04 * W, y);
      g.textAlign = 'right';
      g.fillStyle = TEXT_DIM;
      g.fillText(String(st.servers), 0.3 * W, y);
      g.fillText((st.utilization * 100).toFixed(1), 0.42 * W, y);
      g.fillText(st.avgQueue.toFixed(2), 0.53 * W, y);
      g.fillText(String(st.maxQueue), 0.64 * W, y);
      g.fillText(st.avgWait.toFixed(2), 0.77 * W, y);
      g.fillText(st.avgService.toFixed(2), 0.9 * W, y);
    }
    // Run summary.
    const sy = Math.min(H - 46, top + 30 + r.stations.length * rowH + 16);
    g.textAlign = 'left';
    g.fillStyle = TEXT_DIM;
    g.font = this.font(11);
    const line1 = `T=${r.simTime.toFixed(1)}tu  exited ${r.entitiesExited}/${r.entitiesCreated}  X=${r.throughput.toFixed(3)}/tu  W=${r.meanSojourn.toFixed(2)}tu  L=${r.meanInSystem.toFixed(2)}`;
    const line2 = this.zh
      ? `瓶颈 ${this.bottleneckLabel()}  |L−λW|/L=${r.littlesResidual.toFixed(4)}`
      : `Bottleneck ${this.bottleneckLabel()}  |L−λW|/L=${r.littlesResidual.toFixed(4)}`;
    g.fillText(line1, 0.04 * W, sy);
    g.fillText(line2, 0.04 * W, sy + 18);
  }

  /** Histogram of per-entity end-to-end queue wait. */
  private drawHistogram(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const r = this.result!;
    const waits = r.queueWaits;
    if (waits.length === 0) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No exited entities',
        titleZh: '没有离开系统的实体',
        hint: 'Increase the entity count or lower the load.',
        hintZh: '增大实体数量或降低负载。',
      });
      return;
    }
    const bins = 30;
    let max = 0;
    for (const w of waits) if (w > max) max = w;
    max = max > 0 ? max : 1;
    const counts = new Array<number>(bins).fill(0);
    for (const w of waits) {
      const b = Math.min(bins - 1, Math.floor((w / max) * bins));
      counts[b]! += 1;
    }
    let cMax = 1;
    for (const c of counts) if (c > cMax) cMax = c;
    const x0 = 56;
    const y0 = 44;
    const x1 = canvas.width - 18;
    const y1 = canvas.height - 34;
    const px = (v: number): number => x0 + ((x1 - x0) * v) / max;
    const py = (c: number): number => y1 - ((y1 - y0) * c) / cMax;

    this.viewTitle(g, 'End-to-end queue wait distribution', '端到端排队等待分布');

    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.fillStyle = TEXT_DIM;
    g.font = this.font(10);
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      const c = (cMax * k) / 4;
      const y = py(c);
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillText(formatCount(c), x0 - 6, y + 3);
    }
    const bw = (x1 - x0) / bins;
    g.fillStyle = 'rgba(111,143,174,0.55)';
    g.strokeStyle = PALETTE[0]!;
    for (let b = 0; b < bins; b += 1) {
      const x = x0 + b * bw;
      const y = py(counts[b]!);
      g.fillRect(x, y, Math.max(1, bw - 1), y1 - y);
      g.strokeRect(x, y, Math.max(1, bw - 1), y1 - y);
    }
    g.textAlign = 'center';
    for (let k = 0; k <= 5; k += 1) {
      const v = (max * k) / 5;
      g.fillText(v.toFixed(max < 10 ? 1 : 0), px(v), y1 + 16);
    }
    g.textAlign = 'left';
    g.fillText(this.zh ? '等待 (tu)' : 'wait (tu)', x1 - 56, y1 + 30);
    // Mean marker.
    const m = r.meanQueueWait;
    g.strokeStyle = ACCENT;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(px(m), y0);
    g.lineTo(px(m), y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = ACCENT;
    g.fillText(`${this.zh ? '均值' : 'mean'} ${m.toFixed(2)}`, px(m) + 5, y0 + 10);
  }
}

function bwMin(W: number, cols: number): number {
  return (W - 158) / cols;
}

function truncate(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0 || g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function formatCount(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return a >= 10 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1);
}

function formatTime(v: number): string {
  if (v >= 1000) return v.toFixed(0);
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function safeParse(text: unknown): unknown {
  try {
    return JSON.parse(typeof text === 'string' ? text : '');
  } catch {
    return null;
  }
}

export default function createDesPlugin(): Plugin {
  return new DesPlugin();
}
