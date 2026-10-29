// ==========================================================================
// sim-sysdyn — System Dynamics studio (2-D canvas).
//
// Views: behavior over time, stock-flow diagram, causal-loop diagram, loop
// dominance bars. Model spec is an editable JSON document; runs are fully
// deterministic and feed the scienceOutput strip.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { simSdManifest } from './manifest';
import {
  SD_TEMPLATE_LABEL,
  deriveCausalLinks,
  loopDominance,
  simulateSD,
  sweepSD,
  templateModel,
  type SDModel,
  type SDSeries,
  type SDSimSettings,
  type SDTemplateId,
} from './kernel';

export { simSdManifest } from './manifest';

const PALETTE = ['#6f8fae', '#ae8f6f', '#6fae8f', '#ae6f8f', '#8f6fae', '#a0ae6f', '#6fa0ae', '#ae7f6f'];

type ViewId = 'behavior' | 'stockflow' | 'causal' | 'dominance' | 'sweep';

interface State {
  template: SDTemplateId;
  modelText: string;
  tEnd: number;
  dt: number;
  method: 'euler' | 'rk4';
  overridesText: string;
  sweepParam: string;
  sweepValues: string;
  view: ViewId;
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(3);
  return v.toFixed(a < 10 ? 3 : 1);
}

interface RunResult {
  series: SDSeries;
  model: SDModel;
  sweep: SDSeries[] | null;
  sweepValues: number[];
  sweepParam: string;
  dominance: ReturnType<typeof loopDominance>;
}

export class SimSdPlugin implements Plugin {
  readonly manifest = simSdManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    template: 'logistic',
    modelText: JSON.stringify(templateModel('logistic'), null, 2),
    tEnd: 50,
    dt: 0.1,
    method: 'rk4',
    overridesText: '',
    sweepParam: '',
    sweepValues: '',
    view: 'behavior',
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

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      actionButton('run', 'Simulate', '运行仿真', 'primary'),
      {
        key: 'template',
        label: 'Template',
        labelI18n: { 'zh-CN': '模型模板', 'en-US': 'Template' },
        type: 'select',
        options: (Object.keys(SD_TEMPLATE_LABEL) as SDTemplateId[]).map((t) => ({
          value: t,
          label: SD_TEMPLATE_LABEL[t]!.en,
          labelI18n: { 'zh-CN': SD_TEMPLATE_LABEL[t]!.zh, 'en-US': SD_TEMPLATE_LABEL[t]!.en },
        })),
        value: s.template,
      },
      {
        key: 'modelText',
        label: 'Model spec (JSON)',
        labelI18n: { 'zh-CN': '模型规格（JSON）', 'en-US': 'Model spec (JSON)' },
        type: 'text',
        value: s.modelText,
        hint: 'stocks: [{name, initial}], flows: [{name, from?, to?, expr}], auxiliaries: [{name, expr}], parameters: [{name, value}].',
      },
      { key: 'tEnd', label: 'Simulation end t', labelI18n: { 'zh-CN': '仿真终止时间', 'en-US': 'Simulation end t' }, type: 'number', value: s.tEnd },
      { key: 'dt', label: 'Time step dt', labelI18n: { 'zh-CN': '时间步长 dt', 'en-US': 'Time step dt' }, type: 'number', value: s.dt },
      {
        key: 'method',
        label: 'Integration method',
        labelI18n: { 'zh-CN': '积分方法', 'en-US': 'Integration method' },
        type: 'select',
        options: [
          { value: 'euler', label: 'Euler', labelI18n: { 'zh-CN': '欧拉法', 'en-US': 'Euler' } },
          { value: 'rk4', label: 'Runge-Kutta 4', labelI18n: { 'zh-CN': '四阶龙格-库塔', 'en-US': 'Runge-Kutta 4' } },
        ],
        value: s.method,
      },
      {
        key: 'overridesText',
        label: 'Parameter overrides',
        labelI18n: { 'zh-CN': '参数覆盖', 'en-US': 'Parameter overrides' },
        type: 'text',
        value: s.overridesText,
        placeholder: 'r=0.3\nK=800',
        hint: 'One name=value per line.',
      },
      {
        key: 'sweepParam',
        label: 'Sweep parameter',
        labelI18n: { 'zh-CN': '扫描参数', 'en-US': 'Sweep parameter' },
        type: 'text',
        value: s.sweepParam,
        hint: 'Parameter name to sweep (optional).',
      },
      {
        key: 'sweepValues',
        label: 'Sweep values (comma separated)',
        labelI18n: { 'zh-CN': '扫描值（逗号分隔）', 'en-US': 'Sweep values (comma separated)' },
        type: 'text',
        value: s.sweepValues,
        placeholder: '0.2, 0.35, 0.5',
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'behavior', label: 'Behavior over time', labelI18n: { 'zh-CN': '行为随时间变化', 'en-US': 'Behavior over time' } },
          { value: 'stockflow', label: 'Stock-flow diagram', labelI18n: { 'zh-CN': '存量-流量图', 'en-US': 'Stock-flow diagram' } },
          { value: 'causal', label: 'Causal loop diagram', labelI18n: { 'zh-CN': '因果回路图', 'en-US': 'Causal loop diagram' } },
          { value: 'dominance', label: 'Loop dominance', labelI18n: { 'zh-CN': '回路主导性', 'en-US': 'Loop dominance' } },
          { value: 'sweep', label: 'Parameter sweep', labelI18n: { 'zh-CN': '参数扫描叠加', 'en-US': 'Parameter sweep' } },
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
    if (typeof params.template === 'string' && SD_TEMPLATE_LABEL[params.template as SDTemplateId]) {
      s.template = params.template as SDTemplateId;
      s.modelText = JSON.stringify(templateModel(s.template), null, 2);
    }
    if (typeof params.modelText === 'string') s.modelText = params.modelText;
    if (typeof params.tEnd === 'number') s.tEnd = Math.min(Math.max(params.tEnd, 0.1), 10000);
    if (typeof params.dt === 'number') s.dt = Math.min(Math.max(params.dt, 1e-4), 100);
    if (typeof params.method === 'string' && (params.method === 'euler' || params.method === 'rk4')) s.method = params.method;
    if (typeof params.overridesText === 'string') s.overridesText = params.overridesText;
    if (typeof params.sweepParam === 'string') s.sweepParam = params.sweepParam.trim();
    if (typeof params.sweepValues === 'string') s.sweepValues = params.sweepValues;
    if (typeof params.view === 'string') s.view = params.view as ViewId;
    this.run();
  }

  // ---- computation -----------------------------------------------------------

  private parseOverrides(model: SDModel): SDModel {
    const lines = this.state.overridesText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return model;
    const clone: SDModel = JSON.parse(JSON.stringify(model));
    for (const line of lines) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[0-9.eE+]+)$/);
      if (!m) throw new Error(`Invalid override line '${line}' (expected name=value)`);
      const p = clone.parameters.find((q) => q.name === m[1]);
      if (!p) throw new Error(`Unknown parameter '${m[1]}'`);
      p.value = Number(m[2]);
    }
    return clone;
  }

  private run() {
    this.error = null;
    try {
      const s = this.state;
      const model = this.parseOverrides(JSON.parse(s.modelText) as SDModel);
      const settings: SDSimSettings = { tStart: 0, tStop: s.tEnd, dt: s.dt, method: s.method };
      const series = simulateSD(model, settings);
      let sweep: SDSeries[] | null = null;
      let sweepValues: number[] = [];
      if (s.sweepParam && s.sweepValues.trim()) {
        sweepValues = s.sweepValues.split(/[,;\s]+/).filter(Boolean).map(Number);
        if (sweepValues.some((v) => !Number.isFinite(v))) throw new Error('Sweep values must be finite numbers');
        sweep = sweepSD(model, settings, s.sweepParam, sweepValues);
      }
      const dominance = loopDominance(model, settings);
      this.result = { series, model, sweep, sweepValues, sweepParam: s.sweepParam, dominance };
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
    const n = r.series.t.length - 1;
    const metrics: ScienceMetric[] = [
      { key: 'steps', label: this.zh ? '积分步数' : 'Integration steps', value: fmtMetric(n) },
    ];
    for (const [name, arr] of Object.entries(r.series.stocks)) {
      metrics.push({ key: `final_${name}`, label: this.zh ? `${name} 终值` : `Final ${name}`, value: fmtMetric(arr![n]!) });
      metrics.push({ key: `delta_${name}`, label: this.zh ? `${name} 净变化` : `Net change ${name}`, value: fmtMetric(arr![n]! - arr![0]!) });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportCsv() {
    const r = this.result;
    if (!r) {
      notify(this.api, 'warning', 'Run the simulation first.', '请先运行仿真。');
      return;
    }
    const names = [...Object.keys(r.series.stocks), ...Object.keys(r.series.flows), ...Object.keys(r.series.auxiliaries)];
    const header = ['t', ...names];
    const rows = r.series.t.map((t, i) => [String(t), ...names.map((nm) => {
      const arr = r.series.stocks[nm] ?? r.series.flows[nm] ?? r.series.auxiliaries[nm]!;
      return String(arr![i]!);
    })] as Array<string | number>);
    exportRowsCsv(this.api, 'sd-timeseries', header, rows);
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
      drawEmptyCanvas(this.api, canvas, { title: 'System Dynamics Studio', titleZh: '系统动力学工作台', hint: 'Press "Simulate" to integrate the model', hintZh: '点击"运行仿真"对模型积分' });
      return;
    }
    switch (this.state.view) {
      case 'stockflow': this.drawStockFlow(g, canvas); break;
      case 'causal': this.drawCausal(g, canvas); break;
      case 'dominance': this.drawDominance(g, canvas); break;
      case 'sweep': this.drawSweep(g, canvas); break;
      default: this.drawBehavior(g, canvas);
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

  /** Plot one or more named series over t with a shared y-range. */
  private plotSeries(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, title: string, seriesList: SDSeries[], which: 'stocks' | 'flows', maxLegend: number) {
    const s0 = seriesList[0]!;
    const names = Object.keys(s0[which]);
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of seriesList) {
      for (const nm of names) {
        for (const v of s[which][nm]!) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    const f = this.frame(g, canvas, title, 't', which === 'stocks' ? (this.zh ? '存量' : 'Stock') : (this.zh ? '流量' : 'Flow'));
    const t0 = s0.t[0]!;
    const t1 = s0.t[s0.t.length - 1]!;
    const px = (t: number) => f.x0 + ((t - t0) / (t1 - t0 || 1)) * (f.x1 - f.x0);
    const py = (v: number) => f.y1 - ((v - lo) / (hi - lo || 1)) * (f.y1 - f.y0);
    seriesList.forEach((s, si) => {
      names.forEach((nm, ni) => {
        const arr = s[which][nm]!;
        g.strokeStyle = PALETTE[(ni + si * 3) % PALETTE.length]!;
        g.lineWidth = si === 0 ? 1.6 : 1;
        g.globalAlpha = si === 0 ? 1 : 0.55;
        g.beginPath();
        const stride = Math.max(1, Math.floor(arr.length / 600));
        for (let i = 0; i < arr.length; i += stride) {
          const x = px(s.t[i]!);
          const y = py(arr[i]!);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.globalAlpha = 1;
      });
    });
    g.font = '11px system-ui, sans-serif';
    names.slice(0, maxLegend).forEach((nm, ni) => {
      g.fillStyle = PALETTE[ni % PALETTE.length]!;
      g.textAlign = 'left';
      g.fillText(nm, f.x0 + 8 + ni * 110, f.y0 + 14);
    });
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    for (const t of this.ticks(t0, t1, 6)) {
      g.textAlign = 'center';
      g.fillText(fmtNum(t), px(t), f.y1 + 14);
    }
    for (const t of this.ticks(lo, hi, 4)) {
      g.textAlign = 'right';
      g.fillText(fmtNum(t), f.x0 - 6, py(t) + 3);
    }
  }

  private drawBehavior(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    this.plotSeries(g, canvas, this.zh ? '行为随时间变化' : 'Behavior over time', [r.series], 'stocks', 8);
  }

  private drawSweep(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    if (!r.sweep) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'Parameter sweep',
        titleZh: '参数扫描',
        hint: 'Set a sweep parameter and values, then re-run',
        hintZh: '设置扫描参数与取值后重新运行',
      });
      return;
    }
    this.plotSeries(g, canvas, `${this.zh ? '参数扫描' : 'Parameter sweep'}: ${r.sweepParam}`, r.sweep, 'stocks', 0);
  }

  private drawStockFlow(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const model = r.model;
    const f = this.frame(g, canvas, this.zh ? '存量-流量图' : 'Stock-flow diagram', '', '');
    // Layered layout: stocks on a middle row, flows above/below their stock.
    const stocks = model.stocks;
    const flows = model.flows;
    const cx = (f.x0 + f.x1) / 2;
    const stockY = (f.y0 + f.y1) / 2;
    const stockW = Math.min(150, (f.x1 - f.x0 - 60) / Math.max(stocks.length, 1) - 24);
    const stockH = 44;
    const positions = new Map<string, { x: number; y: number }>();
    stocks.forEach((st, i) => {
      const spread = (f.x1 - f.x0 - stockW - 40) / Math.max(stocks.length - 1, 1);
      const x = stocks.length === 1 ? cx : f.x0 + 20 + stockW / 2 + spread * i;
      positions.set(st.name, { x, y: stockY });
    });
    // flow source/target positions
    const flowPos = new Map<string, { x: number; y: number }>();
    flows.forEach((fl, i) => {
      const from = fl.from ? positions.get(fl.from) : undefined;
      const to = fl.to ? positions.get(fl.to) : undefined;
      let x: number;
      let y: number;
      if (from && to) {
        x = (from.x + to.x) / 2;
        y = stockY - stockH - 30 - (i % 2) * 18;
      } else if (from) {
        x = from.x - stockW - 30;
        y = stockY - (i % 3) * 22;
      } else if (to) {
        x = to.x + stockW + 30;
        y = stockY - (i % 3) * 22;
      } else {
        x = f.x0 + 60 + i * 60;
        y = f.y0 + 40;
      }
      flowPos.set(fl.name, { x, y });
    });
    // arrows flow -> stock / stock -> flow
    g.strokeStyle = 'rgba(200,212,224,0.6)';
    g.fillStyle = 'rgba(200,212,224,0.6)';
    const arrow = (x1: number, y1: number, x2: number, y2: number) => {
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
    for (const fl of flows) {
      const fp = flowPos.get(fl.name)!;
      if (fl.from) {
        const sp = positions.get(fl.from)!;
        arrow(sp.x - stockW / 2, sp.y, fp.x + 4, fp.y);
      }
      if (fl.to) {
        const tp = positions.get(fl.to)!;
        arrow(fp.x, fp.y, tp.x + stockW / 2 > fp.x + 8 ? tp.x - stockW / 2 : tp.x + stockW / 2, tp.y);
      }
      // valve box
      g.fillStyle = PALETTE[1]!;
      g.fillRect(fp.x - 22, fp.y - 10, 44, 20);
      g.fillStyle = '#0a0e13';
      g.textAlign = 'center';
      g.fillText(fl.name.slice(0, 7), fp.x, fp.y + 3);
    }
    stocks.forEach((st, i) => {
      const p = positions.get(st.name)!;
      g.fillStyle = PALETTE[i % PALETTE.length]!;
      g.fillRect(p.x - stockW / 2, p.y - stockH / 2, stockW, stockH);
      g.fillStyle = '#0a0e13';
      g.textAlign = 'center';
      g.font = '12px system-ui, sans-serif';
      g.fillText(st.name.slice(0, 14), p.x, p.y - 2);
      g.font = '10px system-ui, sans-serif';
      const arr = r.series.stocks[st.name]!;
      g.fillText(`= ${fmtNum(arr![arr!.length - 1]!)}`, p.x, p.y + 13);
    });
  }

  private drawCausal(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const links = deriveCausalLinks(r.model);
    const f = this.frame(g, canvas, this.zh ? '因果回路图（+ / − 极性）' : 'Causal loop diagram (+ / - polarity)', '', '');
    const nodes = [...new Set(links.flatMap((l) => [l.from, l.to]))];
    const cx = (f.x0 + f.x1) / 2;
    const cy = (f.y0 + f.y1) / 2;
    const R = Math.min(f.x1 - f.x0, f.y1 - f.y0) / 2 - 46;
    const pos = new Map<string, { x: number; y: number }>();
    nodes.forEach((nm, i) => {
      const ang = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
      pos.set(nm, { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) });
    });
    g.font = '11px system-ui, sans-serif';
    for (const l of links) {
      const a = pos.get(l.from)!;
      const b = pos.get(l.to)!;
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // curve towards center for readability
      g.strokeStyle = l.polarity > 0 ? 'rgba(111,174,143,0.75)' : 'rgba(174,111,111,0.75)';
      g.fillStyle = g.strokeStyle;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo(cx + (mx - cx) * 0.55, cy + (my - cy) * 0.55, b.x, b.y);
      g.stroke();
      // polarity marker at midpoint
      g.textAlign = 'center';
      g.fillText(l.polarity > 0 ? '+' : '−', cx + (mx - cx) * 0.55, cy + (my - cy) * 0.55 - 4);
    }
    nodes.forEach((nm) => {
      const p = pos.get(nm)!;
      g.fillStyle = '#8fa0b3';
      g.beginPath();
      g.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c8d4e0';
      g.textAlign = 'center';
      g.fillText(nm.length > 14 ? nm.slice(0, 13) + '…' : nm, p.x, p.y - 8);
    });
  }

  private drawDominance(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const dom = r.dominance;
    if (!dom.length) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'Loop dominance',
        titleZh: '回路主导性',
        hint: 'No feedback loops detected in the causal graph',
        hintZh: '因果图中未检测到反馈回路',
      });
      return;
    }
    const f = this.frame(g, canvas, this.zh ? '回路主导性（一步敏感性启发式）' : 'Loop dominance (one-step sensitivity heuristic)', '', '');
    const bars = dom.slice(0, 8);
    const maxG = Math.max(...bars.flatMap((d) => [d.gain.start, d.gain.mid, d.gain.end]), 1e-12);
    const rowH = (f.y1 - f.y0) / bars.length;
    const groupW = (f.x1 - f.x0 - 160) / 3;
    bars.forEach((d, i) => {
      const yMid = f.y0 + rowH * (i + 0.5);
      g.font = '11px system-ui, sans-serif';
      g.fillStyle = '#c8d4e0';
      g.textAlign = 'right';
      const label = `${d.loop.nodes.join('→').slice(0, 22)} ${d.loop.sign > 0 ? 'R' : 'B'}`;
      g.fillText(label, f.x0 + 150, yMid + 4);
      (['start', 'mid', 'end'] as const).forEach((key, wi) => {
        const val = d.gain[key]! / maxG;
        const x0 = f.x0 + 170 + wi * groupW;
        const h = Math.min(val * (rowH * 0.56), rowH * 0.56);
        g.fillStyle = wi === 0 ? PALETTE[2]! : wi === 1 ? PALETTE[0]! : PALETTE[1]!;
        g.fillRect(x0 + 8, yMid - h / 2, Math.max((groupW - 24) * val, 1), h);
      });
    });
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    (['start', 'mid', 'end'] as const).forEach((key, wi) => {
      g.textAlign = 'center';
      g.fillText(key, f.x0 + 170 + groupW * (wi + 0.5), f.y1 + 14);
    });
  }
}

export default function createSimSdPlugin(): Plugin {
  return new SimSdPlugin();
}
