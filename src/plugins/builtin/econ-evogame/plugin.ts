// ==========================================================================
// econ-evogame — spatial prisoner's dilemma workbench
//
// Left canvas panel: the C/D lattice heatmap (cooperators blue, defectors
// red). Right panel: the cooperation-fraction time series f_C(t). Run/pause
// advances generations on a timer, single-step and reset are one click, and
// every generation republishes structured scientific outputs (f_C, mean
// score, qualitative Nowak-May regime verdict).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { mulberry32 } from '@/core/repro/random';
import { evogameManifest } from './manifest';
import {
  averageScore,
  classifyRegime,
  coopFraction,
  initialGrid,
  makeUniformGrid,
  runEvogameBenchmark,
  stepAsync,
  stepSync,
  type Boundary,
  type EvoParams,
  type Grid,
  type UpdateMode,
} from './kernel';

export { evogameManifest } from './manifest';

const SIZE_OPTIONS = ['32', '48', '64', '96'];
const COOP_COLOR = 'rgba(96,168,255,0.95)';
const DEFECT_COLOR = 'rgba(235,92,92,0.95)';

export class EvogamePlugin implements Plugin {
  readonly manifest = evogameManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private params: EvoParams = {
    b: 1.8,
    w: 64,
    h: 64,
    initCoop: 0.5,
    mutation: 0,
    boundary: 'periodic',
    updateMode: 'sync',
    seed: 20260922,
  };
  private grid: Grid = makeUniformGrid(64, 64, 1);
  private fc: number[] = [];
  private scores: number[] = [];
  private generation = 0;
  private running = false;
  private timer: number | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    this.reset();
  }

  async destroy() {
    this.stopTimer();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stopTimer();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'b',
        label: 'Temptation b',
        labelI18n: { 'zh-CN': '背叛诱惑 b', 'en-US': 'Temptation b' },
        type: 'range',
        min: 1,
        max: 2,
        step: 0.05,
        value: this.params.b,
        hint: this.zh ? '收益矩阵 R=1, S=0, T=b, P=0' : 'payoffs R=1, S=0, T=b, P=0',
      },
      {
        key: 'gridSize',
        label: 'Lattice',
        labelI18n: { 'zh-CN': '网格规模', 'en-US': 'Lattice' },
        type: 'select',
        options: SIZE_OPTIONS.map((v) => ({ value: v, label: `${v}×${v}`, labelI18n: { 'zh-CN': `${v}×${v}`, 'en-US': `${v}×${v}` } })),
        value: String(this.params.w),
      },
      {
        key: 'initCoop',
        label: 'Initial f_C',
        labelI18n: { 'zh-CN': '初始合作比例', 'en-US': 'Initial f_C' },
        type: 'range',
        min: 0.05,
        max: 0.95,
        step: 0.05,
        value: this.params.initCoop,
      },
      {
        key: 'mutation',
        label: 'Mutation',
        labelI18n: { 'zh-CN': '策略突变率', 'en-US': 'Mutation rate' },
        type: 'range',
        min: 0,
        max: 0.05,
        step: 0.001,
        value: this.params.mutation,
      },
      {
        key: 'boundary',
        label: 'Boundary',
        labelI18n: { 'zh-CN': '边界条件', 'en-US': 'Boundary' },
        type: 'select',
        options: [
          { value: 'periodic', label: this.zh ? '周期' : 'periodic', labelI18n: { 'zh-CN': '周期', 'en-US': 'periodic' } },
          { value: 'absorbing', label: this.zh ? '吸收' : 'absorbing', labelI18n: { 'zh-CN': '吸收', 'en-US': 'absorbing' } },
        ],
        value: this.params.boundary,
      },
      {
        key: 'updateMode',
        label: 'Update',
        labelI18n: { 'zh-CN': '更新方式', 'en-US': 'Update' },
        type: 'select',
        options: [
          { value: 'sync', label: this.zh ? '同步' : 'synchronous', labelI18n: { 'zh-CN': '同步', 'en-US': 'synchronous' } },
          { value: 'async', label: this.zh ? '异步（随机扫描）' : 'async (random sweep)', labelI18n: { 'zh-CN': '异步（随机扫描）', 'en-US': 'async (random sweep)' } },
        ],
        value: this.params.updateMode,
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'range',
        min: 1,
        max: 999999,
        step: 1,
        value: this.params.seed,
        hint: this.zh ? '固定种子 ⇒ 演化完全可复现' : 'fixed seed ⇒ fully reproducible evolution',
      },
      actionButton('step', 'Step ×1', '单步 ×1'),
      actionButton('start', 'Run', '运行', 'primary'),
      actionButton('stop', 'Pause', '暂停'),
      actionButton('reset', 'Reset', '重置'),
      actionButton('benchmark', 'Run benchmark', '运行基准验证'),
      actionButton('exportCsv', 'Export f_C series', '导出 f_C 序列'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) apply(params[k] as number);
    };
    num('b', (n) => {
      this.params.b = Math.min(2, Math.max(1, n));
    });
    num('mutation', (n) => {
      this.params.mutation = Math.min(0.05, Math.max(0, n));
    });
    num('seed', (n) => {
      const s = Math.max(1, Math.round(n));
      if (s !== this.params.seed) {
        this.params.seed = s;
        this.reset();
      }
    });
    num('initCoop', (n) => {
      const v = Math.min(0.95, Math.max(0.05, n));
      if (v !== this.params.initCoop) {
        this.params.initCoop = v;
        this.reset();
      }
    });
    if (typeof params.gridSize === 'string' && SIZE_OPTIONS.includes(params.gridSize)) {
      const n = Number(params.gridSize);
      if (n !== this.params.w) {
        this.params.w = n;
        this.params.h = n;
        this.reset();
      }
    }
    if (typeof params.boundary === 'string' && (params.boundary === 'periodic' || params.boundary === 'absorbing')) {
      this.params.boundary = params.boundary as Boundary;
    }
    if (typeof params.updateMode === 'string' && (params.updateMode === 'sync' || params.updateMode === 'async')) {
      this.params.updateMode = params.updateMode as UpdateMode;
    }

    if (actionFired(params, 'step')) {
      this.stopTimer();
      this.stepOnce();
    }
    if (actionFired(params, 'start')) this.startTimer();
    if (actionFired(params, 'stop')) this.stopTimer();
    if (actionFired(params, 'reset')) {
      this.stopTimer();
      this.reset();
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    this.draw();
  }

  // ---- simulation control -----------------------------------------------------

  private reset() {
    this.grid = initialGrid(this.params);
    this.fc = [coopFraction(this.grid)];
    this.scores = [averageScore(this.grid, this.params.b, this.params.boundary)];
    this.generation = 0;
    this.publishOutputs();
  }

  private stepOnce() {
    if (this.params.updateMode === 'async') {
      stepAsync(this.grid, this.params.b, this.params.boundary, this.params.mutation, mulberry32((this.params.seed + this.generation) >>> 0 || 1));
    } else {
      const next = stepSync(this.grid, this.params.b, this.params.boundary, this.params.mutation, mulberry32((this.params.seed + this.generation) >>> 0 || 1));
      this.grid.cells.set(next.cells);
    }
    this.generation += 1;
    this.fc.push(coopFraction(this.grid));
    this.scores.push(averageScore(this.grid, this.params.b, this.params.boundary));
    if (this.fc.length > 20000) {
      this.fc.shift();
      this.scores.shift();
    }
    this.publishOutputs();
  }

  private startTimer() {
    if (this.running) return;
    this.running = true;
    this.timer = window.setInterval(() => {
      this.stepOnce();
      this.draw();
    }, 120);
  }

  private stopTimer() {
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---- scientific outputs -------------------------------------------------------

  private publishOutputs() {
    const fC = this.fc[this.fc.length - 1] ?? 0;
    const score = this.scores[this.scores.length - 1] ?? 0;
    const regime = classifyRegime(fC);
    const metrics: ScienceMetric[] = [
      {
        key: 'generation',
        label: this.zh ? '世代' : 'Generation',
        value: String(this.generation),
        severity: 'info',
        hint: this.zh ? `b=${this.params.b}，${this.params.w}×${this.params.h}，${this.params.boundary}，${this.params.updateMode}` : `b=${this.params.b}, ${this.params.w}×${this.params.h}, ${this.params.boundary}, ${this.params.updateMode}`,
      },
      {
        key: 'fc',
        label: 'f_C',
        value: fmtMetric(fC),
        severity: 'info',
        hint: this.zh ? '当前合作策略频率' : 'current cooperation fraction',
      },
      {
        key: 'avg-score',
        label: this.zh ? '平均得分' : 'Mean score',
        value: fmtMetric(score),
        severity: 'info',
        hint: this.zh ? '全格子平均收益（9 次博弈/格）' : 'lattice mean payoff (9 games per cell)',
      },
      {
        key: 'regime',
        label: this.zh ? '斑图判据' : 'Pattern',
        value: this.zh ? regime.zh : regime.en,
        severity: regime.key === 'mosaic' ? 'ok' : 'info',
        hint: this.zh
          ? '末代合作率的定性分类（Nowak & May 1992）：≥0.5 合作主导；0.02–0.5 空间共存斑图；<0.02 背叛蔓延'
          : 'qualitative classification of the final f_C (Nowak & May 1992): ≥0.5 cooperative dominance; 0.02-0.5 spatial mosaic; <0.02 defection sweep',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const b = runEvogameBenchmark();
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-status',
        label: 'Benchmark',
        value: b.pass ? (this.zh ? '全部通过' : 'ALL PASS') : this.zh ? '未通过' : 'FAIL',
        severity: b.pass ? 'ok' : 'error',
        hint: this.zh ? '内嵌 Nowak-May 验证组（非用户数据）' : 'embedded Nowak-May validation battery (not user data)',
      },
      {
        key: 'bench-fixed-c',
        label: this.zh ? '全 C 不动点' : 'All-C fixed point',
        value: b.allCInvariant ? (this.zh ? '不变' : 'invariant') : this.zh ? '漂移' : 'drifted',
        severity: b.allCInvariant ? 'ok' : 'error',
      },
      {
        key: 'bench-fixed-d',
        label: this.zh ? '全 D 不动点' : 'All-D fixed point',
        value: b.allDInvariant ? (this.zh ? '不变' : 'invariant') : this.zh ? '漂移' : 'drifted',
        severity: b.allDInvariant ? 'ok' : 'error',
      },
      {
        key: 'bench-hand',
        label: this.zh ? '手工算分误差' : 'Hand-score error',
        value: fmtMetric(b.handScoreErr),
        severity: b.handScoreErr === 0 ? 'ok' : 'warn',
        hint: this.zh
          ? '5×5 中心 C、其余 D、b=1.8：中心=1、8 邻域=1.8、远格=0（相对误差 |计算−参考|/max(1,|参考|)）'
          : '5×5 central C among D at b=1.8: centre=1, 8 neighbours=1.8, far cells=0 (relative error |computed - ref| / max(1, |ref|))',
      },
      {
        key: 'bench-collapse',
        label: this.zh ? '3×3 场景塌缩' : 'Scenario collapse',
        value: b.handCollapse ? (this.zh ? '→ 全 D ✓' : '→ all-D ✓') : this.zh ? '未塌缩' : 'no collapse',
        severity: b.handCollapse ? 'ok' : 'warn',
      },
      {
        key: 'bench-determinism',
        label: this.zh ? '固定种子确定性' : 'Seed determinism',
        value: b.deterministic ? (this.zh ? '可复现' : 'reproducible') : this.zh ? '不可复现' : 'irreproducible',
        severity: b.deterministic ? 'ok' : 'error',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.pass ? 'success' : 'warning',
      `Benchmark ${b.pass ? 'passed' : 'FAILED'}: fixed points, hand-score err ${b.handScoreErr}, determinism ${b.deterministic}`,
      `基准验证${b.pass ? '通过' : '未通过'}：不动点、手工算分误差 ${b.handScoreErr}、确定性 ${b.deterministic}`,
    );
  }

  private exportCsv() {
    const rows: Array<Array<number | string>> = this.fc.map((v, i) => [i, Number(v.toFixed(6)), Number((this.scores[i] ?? 0).toFixed(6))]);
    exportRowsCsv(this.api, 'evogame-fc-series', ['generation', 'f_cooperators', 'mean_score'], rows);
  }

  // ---- drawing -------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const panelTop = 42;
    const panelBottom = canvas.height - 52;
    const heatSize = Math.max(60, Math.min(panelBottom - panelTop, canvas.width * 0.56));
    this.drawHeatmap(g, 54, panelTop, heatSize);
    this.drawSeriesPanel(g, 54 + heatSize + 28, panelTop, canvas.width - (54 + heatSize + 28) - 20, panelBottom - panelTop);
    this.drawFooter(g, canvas);
  }

  private drawHeatmap(g: CanvasRenderingContext2D, ox: number, oy: number, size: number) {
    const zh = this.zh;
    const cell = size / Math.max(this.grid.w, this.grid.h);
    const drawW = cell * this.grid.w;
    const drawH = cell * this.grid.h;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '策略格子（蓝=合作 C，红=背叛 D）' : 'Strategy lattice (blue = C, red = D)', ox + drawW / 2, oy - 8);

    for (let y = 0; y < this.grid.h; y += 1) {
      for (let x = 0; x < this.grid.w; x += 1) {
        g.fillStyle = (this.grid.cells[y * this.grid.w + x] ?? 0) === 1 ? COOP_COLOR : DEFECT_COLOR;
        g.fillRect(ox + x * cell, oy + y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1;
    g.strokeRect(ox, oy, drawW, drawH);
  }

  private drawSeriesPanel(
    g: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    w: number,
    h: number,
  ) {
    if (w < 40 || h < 40) return;
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '合作率时间序列 f_C(t)' : 'Cooperation fraction f_C(t)', ox + w / 2, oy - 8);

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(ox, oy, w, h);
    // 0.5 guide
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.moveTo(ox, oy + h / 2);
    g.lineTo(ox + w, oy + h / 2);
    g.stroke();

    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('1.0', ox - 4, oy + 8);
    g.fillText('0.5', ox - 4, oy + h / 2 + 3);
    g.fillText('0.0', ox - 4, oy + h);

    const n = Math.max(this.fc.length, 2);
    const px = (t: number) => ox + (w * t) / (n - 1);
    const py = (v: number) => oy + h - v * h;
    g.strokeStyle = COOP_COLOR;
    g.lineWidth = 1.6;
    g.beginPath();
    this.fc.forEach((v, t) => {
      if (t === 0) g.moveTo(px(t), py(v));
      else g.lineTo(px(t), py(v));
    });
    g.stroke();
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('0', ox, oy + h + 13);
    g.fillText(String(this.fc.length - 1), ox + w - 16, oy + h + 13);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const fC = this.fc[this.fc.length - 1] ?? 0;
    const sc = this.scores[this.scores.length - 1] ?? 0;
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = zh
      ? `世代 ${this.generation}  ·  b=${this.params.b.toFixed(2)}  ${this.params.w}×${this.params.h}  ${this.params.boundary === 'periodic' ? '周期' : '吸收'}边界  ${this.params.updateMode === 'sync' ? '同步' : '异步'}更新  突变=${this.params.mutation.toFixed(3)}`
      : `Generation ${this.generation}  ·  b=${this.params.b.toFixed(2)}  ${this.params.w}×${this.params.h}  ${this.params.boundary} boundary  ${this.params.updateMode} update  mutation=${this.params.mutation.toFixed(3)}`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = zh
      ? `f_C=${fC.toFixed(4)}  平均得分=${sc.toFixed(4)}  ·  ${classifyRegime(fC).zh}`
      : `f_C=${fC.toFixed(4)}  mean score=${sc.toFixed(4)}  ·  ${classifyRegime(fC).en}`;
    g.fillText(l2, 54, canvas.height - 14);
  }
}

export default function createEvogamePlugin(): Plugin {
  return new EvogamePlugin();
}
