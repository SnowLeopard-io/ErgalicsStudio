// ==========================================================================
// sim-montecarlo — Monte Carlo simulation platform (2-D workbench).
//
// Views: output histogram, running-mean convergence chains, tornado
// sensitivity, input-vs-output scatter. All sampling is seeded and
// deterministic; results feed the scienceOutput strip.
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
import { simMontecarloManifest } from './manifest';
import {
  parseCorrMatrix,
  parseInputsTable,
  rankCorrelation,
  runMonteCarlo,
  type Histogram,
  type InputVariable,
  type McRunResult,
  type SamplerKind,
  type TornadoBar,
} from './kernel';

export { simMontecarloManifest } from './manifest';

interface Preset {
  id: string;
  en: string;
  zh: string;
  inputs: string;
  expression: string;
}

const PRESETS: Preset[] = [
  {
    id: 'cost',
    en: 'Project cost estimate',
    zh: '项目成本估算（PERT）',
    inputs: [
      'labor,pert,80,110,180',
      'materials,triangular,40,60,95',
      'risk,uniform,5,25',
      'overhead,normal,30,4',
    ].join('\n'),
    expression: 'labor + materials + risk + overhead',
  },
  {
    id: 'pi',
    en: 'MC integration: pi estimate',
    zh: '蒙特卡洛积分：π 估计',
    inputs: 'x,uniform,0,1\ny,uniform,0,1',
    expression: 'sqrt(x^2 + y^2)',
  },
  {
    id: 'portfolio',
    en: 'Portfolio NPV',
    zh: '投资组合 NPV',
    inputs: 'growth,normal,0.06,0.02\ndiscount,normal,0.04,0.01\ncapex,pert,90,120,200',
    expression: 'capex * (growth / discount - 1)',
  },
  {
    id: 'custom',
    en: 'Custom model',
    zh: '自定义模型',
    inputs: 'a,uniform,0,10\nb,normal,5,2',
    expression: 'a * b',
  },
];

interface State {
  preset: string;
  inputsText: string;
  expression: string;
  n: number;
  sampler: SamplerKind;
  seed: number;
  corrEnabled: boolean;
  corrText: string;
  chains: number;
  sensitivity: boolean;
  view: 'histogram' | 'convergence' | 'tornado' | 'scatter' | 'stats';
  scatterDim: number;
}

/** Low-saturation academic palette. */
const PALETTE = ['#6f8fae', '#ae8f6f', '#6fae8f', '#ae6f8f', '#8f6fae', '#a0ae6f', '#6fa0ae', '#ae7f6f'];

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(3);
  return v.toFixed(a < 10 ? 4 : 2);
}

export class SimMontecarloPlugin implements Plugin {
  readonly manifest = simMontecarloManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    preset: 'cost',
    inputsText: PRESETS[0]!.inputs,
    expression: PRESETS[0]!.expression,
    n: 20000,
    sampler: 'lhs',
    seed: 42,
    corrEnabled: false,
    corrText: '',
    chains: 4,
    sensitivity: true,
    view: 'histogram',
    scatterDim: 0,
  };
  private result: McRunResult | null = null;
  private error: string | null = null;
  /** Cached input samples per scatter view. */
  private scatterCols: number[][] = [];

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
    // First open: run the default preset so the panel opens with content.
    if (!this.result && !this.error) this.run();
    else this.draw();
  }

  // ---- parameter panel -----------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      actionButton('run', 'Run simulation', '运行仿真', 'primary'),
      {
        key: 'preset',
        label: 'Preset',
        labelI18n: { 'zh-CN': '预设模型', 'en-US': 'Preset' },
        type: 'select',
        options: PRESETS.map((p) => ({ value: p.id, label: p.en, labelI18n: { 'zh-CN': p.zh, 'en-US': p.en } })),
        value: s.preset,
      },
      {
        key: 'inputsText',
        label: 'Inputs (name,dist,p1,p2,p3)',
        labelI18n: { 'zh-CN': '输入变量（名称,分布,参数…）', 'en-US': 'Inputs (name,dist,p1,p2,p3)' },
        type: 'text',
        value: s.inputsText,
        placeholder: 'labor,pert,80,110,180\nmaterials,triangular,40,60,95',
        hint: 'Distributions: uniform(a,b), normal(mu,sigma), triangular(low,mode,high), pert(low,mode,high[,lambda]), beta(alpha,beta), empirical(samples separated by ;). One variable per line.',
      },
      {
        key: 'expression',
        label: 'Output expression',
        labelI18n: { 'zh-CN': '输出表达式', 'en-US': 'Output expression' },
        type: 'text',
        value: s.expression,
        placeholder: 'labor + materials + risk + overhead',
        hint: 'Arithmetic over input names; functions min max abs sqrt exp ln log pow sin cos tan.',
      },
      {
        key: 'n',
        label: 'Samples N',
        labelI18n: { 'zh-CN': '样本数 N', 'en-US': 'Samples N' },
        type: 'number',
        value: s.n,
      },
      {
        key: 'sampler',
        label: 'Sampler',
        labelI18n: { 'zh-CN': '抽样方法', 'en-US': 'Sampler' },
        type: 'select',
        options: [
          { value: 'random', label: 'Simple random', labelI18n: { 'zh-CN': '简单随机', 'en-US': 'Simple random' } },
          { value: 'lhs', label: 'Latin hypercube', labelI18n: { 'zh-CN': '拉丁超立方', 'en-US': 'Latin hypercube' } },
          { value: 'sobol', label: 'Sobol sequence', labelI18n: { 'zh-CN': 'Sobol 序列', 'en-US': 'Sobol sequence' } },
        ],
        value: s.sampler,
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'number',
        value: s.seed,
      },
      {
        key: 'corrEnabled',
        label: 'Input correlations',
        labelI18n: { 'zh-CN': '输入变量相关结构', 'en-US': 'Input correlations' },
        type: 'checkbox',
        value: s.corrEnabled,
      },
      {
        key: 'corrText',
        label: 'Correlation matrix',
        labelI18n: { 'zh-CN': '相关系数矩阵', 'en-US': 'Correlation matrix' },
        type: 'text',
        value: s.corrText,
        placeholder: '1 0.5\n0.5 1',
        hint: 'k x k symmetric matrix, whitespace or comma separated, diagonal 1 (Gaussian copula).',
        visibleWhen: { key: 'corrEnabled', in: [true] },
      },
      {
        key: 'chains',
        label: 'Chains (R-hat)',
        labelI18n: { 'zh-CN': '独立链数（R-hat）', 'en-US': 'Chains (R-hat)' },
        type: 'number',
        value: s.chains,
        hint: '>= 2 runs independent chains and reports the Gelman-Rubin statistic.',
        visibleWhen: { key: 'view', in: ['convergence'] },
      },
      {
        key: 'sensitivity',
        label: 'Sensitivity analysis',
        labelI18n: { 'zh-CN': '敏感性分析', 'en-US': 'Sensitivity analysis' },
        type: 'checkbox',
        value: s.sensitivity,
        visibleWhen: { key: 'view', in: ['tornado'] },
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'histogram', label: 'Histogram', labelI18n: { 'zh-CN': '输出直方图', 'en-US': 'Histogram' } },
          { value: 'convergence', label: 'Running mean', labelI18n: { 'zh-CN': '收敛诊断（滑动均值）', 'en-US': 'Running mean' } },
          { value: 'tornado', label: 'Tornado chart', labelI18n: { 'zh-CN': '龙卷风图', 'en-US': 'Tornado chart' } },
          { value: 'scatter', label: 'Input vs output', labelI18n: { 'zh-CN': '输入-输出散点', 'en-US': 'Input vs output' } },
          { value: 'stats', label: 'Statistics table', labelI18n: { 'zh-CN': '统计量表', 'en-US': 'Statistics table' } },
        ],
        value: s.view,
      },
      {
        key: 'scatterDim',
        label: 'Scatter input',
        labelI18n: { 'zh-CN': '散点输入变量', 'en-US': 'Scatter input' },
        type: 'select',
        options: this.result
          ? this.result.inputNames.map((nm, i) => ({ value: String(i), label: nm, labelI18n: { 'zh-CN': nm, 'en-US': nm } }))
          : [{ value: '0', label: '0', labelI18n: { 'zh-CN': '0', 'en-US': '0' } }],
        value: String(Math.min(s.scatterDim, Math.max((this.result?.inputNames.length ?? 1) - 1, 0))),
        visibleWhen: { key: 'view', in: ['scatter'] },
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
    if (typeof params.preset === 'string' && params.preset !== s.preset) {
      const p = PRESETS.find((q) => q.id === params.preset);
      if (p) {
        s.preset = p.id;
        s.inputsText = p.inputs;
        s.expression = p.expression;
      }
    }
    if (typeof params.inputsText === 'string') s.inputsText = params.inputsText;
    if (typeof params.expression === 'string') s.expression = params.expression;
    if (typeof params.n === 'number') s.n = Math.min(Math.max(Math.round(params.n), 100), 200000);
    if (typeof params.sampler === 'string') s.sampler = params.sampler as SamplerKind;
    if (typeof params.seed === 'number') s.seed = Math.round(params.seed);
    if (typeof params.corrEnabled === 'boolean') s.corrEnabled = params.corrEnabled;
    if (typeof params.corrText === 'string') s.corrText = params.corrText;
    if (typeof params.chains === 'number') s.chains = Math.min(Math.max(Math.round(params.chains), 0), 8);
    if (typeof params.sensitivity === 'boolean') s.sensitivity = params.sensitivity;
    if (typeof params.view === 'string') s.view = params.view as State['view'];
    if (typeof params.scatterDim === 'string') s.scatterDim = Number(params.scatterDim) || 0;
    this.run();
  }

  // ---- computation -----------------------------------------------------------

  private run() {
    this.error = null;
    try {
      const inputs: InputVariable[] = parseInputsTable(this.state.inputsText);
      if (!inputs.length) throw new Error(this.zh ? '至少需要一个输入变量' : 'At least one input variable is required');
      if (inputs.length > 16) throw new Error(this.zh ? '输入变量最多 16 个（Sobol 限制）' : 'At most 16 input variables (Sobol limit)');
      const corr = this.state.corrEnabled ? parseCorrMatrix(this.state.corrText, inputs.length) : null;
      this.result = runMonteCarlo({
        inputs,
        expression: this.state.expression,
        n: this.state.n,
        sampler: this.state.sampler,
        seed: this.state.seed,
        corr,
        chains: this.state.chains,
        computeSensitivity: this.state.sensitivity,
      });
      // Cache raw input columns for the scatter view.
      this.scatterCols = inputs.map((_, j) => this.result!.samples.map((r) => r[j]!));
      this.setOutputs();
    } catch (e) {
      this.result = null;
      this.scatterCols = [];
      this.error = e instanceof Error ? e.message : String(e);
      clearScienceOutputs(this.manifest.id);
    }
    this.draw();
  }

  private setOutputs() {
    const r = this.result;
    if (!r) return;
    const metrics: ScienceMetric[] = [
      { key: 'mean', label: this.zh ? '均值' : 'Mean', value: fmtMetric(r.stats.mean) },
      { key: 'std', label: this.zh ? '标准差' : 'Std dev', value: fmtMetric(r.stats.std) },
      { key: 'ci95', label: this.zh ? '均值 95% 置信区间' : '95% CI of mean', value: `[${fmtMetric(r.stats.ci95Lo)}, ${fmtMetric(r.stats.ci95Hi)}]` },
      { key: 'p5', label: 'P5', value: fmtMetric(r.stats.p5) },
      { key: 'p50', label: this.zh ? '中位数' : 'Median', value: fmtMetric(r.stats.p50) },
      { key: 'p95', label: 'P95', value: fmtMetric(r.stats.p95) },
    ];
    if (r.rhat !== null) {
      metrics.push({ key: 'rhat', label: 'Gelman-Rubin R-hat', value: fmtMetric(r.rhat) });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportCsv() {
    const r = this.result;
    if (!r) {
      notify(this.api, 'warning', 'Run the simulation first.', '请先运行仿真。');
      return;
    }
    const header = ['statistic', 'value'];
    const rows: Array<[string, number]> = [
      ['n', r.stats.n],
      ['mean', r.stats.mean],
      ['std', r.stats.std],
      ['skewness', r.stats.skewness],
      ['min', r.stats.min],
      ['p5', r.stats.p5],
      ['median', r.stats.p50],
      ['p95', r.stats.p95],
      ['max', r.stats.max],
      ['ci95_lo', r.stats.ci95Lo],
      ['ci95_hi', r.stats.ci95Hi],
    ];
    if (r.rhat !== null) rows.push(['gelman_rubin_rhat', r.rhat]);
    for (const c of r.correlations) rows.push([`spearman_${c.name}`, c.spearman]);
    exportRowsCsv(this.api, 'montecarlo-summary', header, rows);
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
      drawEmptyCanvas(this.api, canvas, {
        title: 'Invalid model',
        titleZh: '模型无效',
        hint: this.error,
        hintZh: this.error,
      });
      return;
    }
    if (!this.result) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'Monte Carlo Simulation',
        titleZh: '蒙特卡洛仿真平台',
        hint: 'Press "Run simulation" to start sampling',
        hintZh: '点击"运行仿真"开始抽样',
      });
      return;
    }
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    switch (this.state.view) {
      case 'convergence': this.drawConvergence(g, canvas); break;
      case 'tornado': this.drawTornado(g, canvas); break;
      case 'scatter': this.drawScatter(g, canvas); break;
      case 'stats': this.drawStats(g, canvas); break;
      default: this.drawHistogram(g, canvas);
    }
  }

  /** Shared plot frame: title, axes with padded labels, returns mapping. */
  private frame(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, title: string, xLabel: string, yLabel: string) {
    const padL = Math.max(56, g.measureText(yLabel).width + 24);
    const padR = 20;
    const padT = 40;
    const padB = 46;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    g.fillStyle = this.zh ? '#c8d4e0' : '#c8d4e0';
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

  /** Nice tick values covering [lo, hi]. */
  private ticks(lo: number, hi: number, count: number): number[] {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo];
    const span = hi - lo;
    const rawStep = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(v);
    return out;
  }

  private drawHistogram(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const hist: Histogram = r.histogram;
    const counts = hist.counts;
    const edges = hist.binEdges;
    const maxC = Math.max(...counts, 1);
    const f = this.frame(
      g, canvas,
      this.zh ? '输出分布直方图' : 'Output distribution',
      this.zh ? '输出值' : 'Output value',
      this.zh ? '频数' : 'Count',
    );
    const lo = edges[0]!;
    const hi = edges[edges.length - 1]!;
    const px = (v: number) => f.x0 + ((v - lo) / (hi - lo || 1)) * (f.x1 - f.x0);
    const py = (c: number) => f.y1 - (c / maxC) * (f.y1 - f.y0);
    const bw = (f.x1 - f.x0) / counts.length;
    g.fillStyle = PALETTE[0]!;
    for (let i = 0; i < counts.length; i++) {
      const x = px(edges[i]!);
      const y = py(counts[i]!);
      g.fillRect(x, y, Math.max(bw - 0.5, 0.5), f.y1 - y);
    }
    g.strokeStyle = '#ae8f6f';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(px(r.stats.p50), f.y0);
    g.lineTo(px(r.stats.p50), f.y1);
    g.stroke();
    g.fillStyle = '#ae8f6f';
    g.textAlign = 'left';
    g.fillText(this.zh ? '中位数' : 'median', px(r.stats.p50) + 4, f.y0 + 12);
    // axis ticks
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    for (const t of this.ticks(lo, hi, 6)) {
      g.textAlign = 'center';
      g.fillText(fmtNum(t), px(t), f.y1 + 14);
    }
    for (const t of this.ticks(0, maxC, 4)) {
      g.textAlign = 'right';
      g.fillText(String(Math.round(t)), f.x0 - 6, py(t) + 3);
    }
  }

  private drawConvergence(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const chains = r.chainRunningMeans ?? [];
    if (!chains.length) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'Convergence',
        titleZh: '收敛诊断',
        hint: 'Set chains >= 2 to view multi-chain convergence',
        hintZh: '将链数设为 ≥2 以查看多链收敛',
      });
      return;
    }
    const n = chains[0]!.length;
    const all = chains.flat();
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of all) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    const f = this.frame(
      g, canvas,
      this.zh ? `收敛诊断：滑动均值（R-hat = ${r.rhat !== null ? r.rhat.toFixed(4) : '—'}）` : `Convergence: running mean (R-hat = ${r.rhat !== null ? r.rhat.toFixed(4) : '-'})`,
      this.zh ? '样本序号' : 'Sample index',
      this.zh ? '滑动均值' : 'Running mean',
    );
    const px = (i: number) => f.x0 + (i / Math.max(n - 1, 1)) * (f.x1 - f.x0);
    const py = (v: number) => f.y1 - ((v - lo) / (hi - lo || 1)) * (f.y1 - f.y0);
    chains.forEach((c, ci) => {
      g.strokeStyle = PALETTE[ci % PALETTE.length]!;
      g.lineWidth = 1.2;
      g.beginPath();
      const stride = Math.max(1, Math.floor(n / 400));
      for (let i = 0; i < n; i += stride) {
        const x = px(i);
        const y = py(c[i]!);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    });
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    for (const t of this.ticks(lo, hi, 4)) {
      g.textAlign = 'right';
      g.fillText(fmtNum(t), f.x0 - 6, py(t) + 3);
    }
  }

  private drawTornado(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const bars: TornadoBar[] = this.result!.tornado;
    if (!bars.length) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'Tornado chart',
        titleZh: '龙卷风图',
        hint: 'Enable sensitivity analysis and re-run',
        hintZh: '勾选"敏感性分析"后重新运行',
      });
      return;
    }
    const maxSpan = Math.max(...bars.map((b) => Math.max(Math.abs(b.high - b.base), Math.abs(b.low - b.base))), 1e-12);
    const f = this.frame(
      g, canvas,
      this.zh ? '敏感性分析：P10/P90 龙卷风图' : 'Sensitivity: P10/P90 tornado',
      this.zh ? '输出相对中位数基准的偏移' : 'Output deviation from median baseline',
      '',
    );
    const rowH = (f.y1 - f.y0) / bars.length;
    const zeroX = f.x0 + (f.x1 - f.x0) / 2;
    const scale = ((f.x1 - f.x0) / 2 - 30) / maxSpan;
    g.font = '11px system-ui, sans-serif';
    bars.forEach((b, i) => {
      const yMid = f.y0 + rowH * (i + 0.5);
      const xLo = zeroX + (b.low - b.base) * scale;
      const xHi = zeroX + (b.high - b.base) * scale;
      g.fillStyle = PALETTE[i % PALETTE.length]!;
      g.fillRect(Math.min(xLo, xHi), yMid - rowH * 0.28, Math.abs(xHi - xLo), rowH * 0.56);
      g.strokeStyle = 'rgba(200,212,224,0.5)';
      g.strokeRect(Math.min(xLo, xHi), yMid - rowH * 0.28, Math.abs(xHi - xLo), rowH * 0.56);
      g.fillStyle = '#c8d4e0';
      g.textAlign = 'right';
      g.fillText(b.name, f.x0 - 6, yMid + 4);
    });
    g.strokeStyle = 'rgba(200,212,224,0.4)';
    g.beginPath();
    g.moveTo(zeroX, f.y0);
    g.lineTo(zeroX, f.y1);
    g.stroke();
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    for (const t of this.ticks(-maxSpan, maxSpan, 6)) {
      g.textAlign = 'center';
      g.fillText(fmtNum(t), zeroX + t * scale, f.y1 + 14);
    }
  }

  private drawScatter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const dim = Math.min(this.state.scatterDim, r.inputNames.length - 1);
    const xs = this.scatterCols[dim] ?? [];
    const ys = r.outputs;
    let xlo = Infinity;
    let xhi = -Infinity;
    let ylo = Infinity;
    let yhi = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i]! < xlo) xlo = xs[i]!;
      if (xs[i]! > xhi) xhi = xs[i]!;
      if (ys[i]! < ylo) ylo = ys[i]!;
      if (ys[i]! > yhi) yhi = ys[i]!;
    }
    if (!Number.isFinite(xlo) || !Number.isFinite(ylo)) return;
    const f = this.frame(
      g, canvas,
      this.zh ? `输入-输出相关性：${r.inputNames[dim]}（Spearman ρ = ${rankCorrelation(xs, ys).toFixed(3)}）` : `Input-output correlation: ${r.inputNames[dim]} (Spearman rho = ${rankCorrelation(xs, ys).toFixed(3)})`,
      r.inputNames[dim] ?? '',
      this.zh ? '输出值' : 'Output',
    );
    const px = (v: number) => f.x0 + ((v - xlo) / (xhi - xlo || 1)) * (f.x1 - f.x0);
    const py = (v: number) => f.y1 - ((v - ylo) / (yhi - ylo || 1)) * (f.y1 - f.y0);
    g.fillStyle = PALETTE[0]!;
    const stride = Math.max(1, Math.floor(xs.length / 4000));
    for (let i = 0; i < xs.length; i += stride) {
      g.fillRect(px(xs[i]!) - 1, py(ys[i]!) - 1, 2.4, 2.4);
    }
    g.fillStyle = '#8fa0b3';
    g.font = '10px system-ui, sans-serif';
    for (const t of this.ticks(xlo, xhi, 5)) {
      g.textAlign = 'center';
      g.fillText(fmtNum(t), px(t), f.y1 + 14);
    }
    for (const t of this.ticks(ylo, yhi, 4)) {
      g.textAlign = 'right';
      g.fillText(fmtNum(t), f.x0 - 6, py(t) + 3);
    }
  }

  private drawStats(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const r = this.result!;
    const f = this.frame(g, canvas, this.zh ? '输出统计量' : 'Output statistics', '', '');
    const rows: Array<[string, string]> = [
      [this.zh ? '样本数' : 'Samples', String(r.stats.n)],
      [this.zh ? '均值' : 'Mean', fmtNum(r.stats.mean)],
      [this.zh ? '标准差' : 'Std dev', fmtNum(r.stats.std)],
      [this.zh ? '偏度' : 'Skewness', fmtNum(r.stats.skewness)],
      [this.zh ? '最小值' : 'Min', fmtNum(r.stats.min)],
      ['P5', fmtNum(r.stats.p5)],
      [this.zh ? '中位数' : 'Median', fmtNum(r.stats.p50)],
      ['P95', fmtNum(r.stats.p95)],
      [this.zh ? '最大值' : 'Max', fmtNum(r.stats.max)],
      [this.zh ? '95% 置信区间' : '95% CI of mean', `[${fmtNum(r.stats.ci95Lo)}, ${fmtNum(r.stats.ci95Hi)}]`],
      ...(r.rhat !== null ? [['Gelman-Rubin R-hat', r.rhat.toFixed(4)] as [string, string]] : []),
    ];
    const colX = f.x0 + 30;
    const rowH = Math.min(22, (f.y1 - f.y0) / rows.length);
    g.font = '12px system-ui, sans-serif';
    rows.forEach(([k, v], i) => {
      const y = f.y0 + rowH * (i + 0.7);
      g.fillStyle = '#8fa0b3';
      g.textAlign = 'left';
      g.fillText(k, colX, y);
      g.fillStyle = '#c8d4e0';
      g.textAlign = 'right';
      g.fillText(v, f.x1 - 30, y);
    });
  }
}

export default function createSimMontecarloPlugin(): Plugin {
  return new SimMontecarloPlugin();
}
