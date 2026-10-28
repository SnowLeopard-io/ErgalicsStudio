// ==========================================================================
// stats-markov — Markov chain & stationary analysis workbench
//
// Three coordinated views on one canvas: the directed transition graph
// (circular layout, curved weighted arrows with probability labels), the
// stationary-distribution bar chart from power iteration, and a seeded
// trajectory strip. Absorbing chains additionally report expected absorption
// times and absorption probabilities. The transition matrix is editable as
// "row;row" text and loadable from CSV/TSV/TXT (with "# labels:" comments).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { statsMarkovManifest } from './manifest';
import { markovFigurePanels } from './figure';
import {
  PRESETS,
  absorbingAnalysis,
  chainPeriod,
  isIrreducible,
  parseInitial,
  parseMatrixText,
  runMarkovBenchmark,
  serializeMatrix,
  simulateChain,
  steadyStateByPower,
  stochasticize,
  type AbsorbingResult,
} from './kernel';

export { statsMarkovManifest } from './manifest';

interface Analysis {
  P: number[][];
  labels: string[];
  n: number;
  steady: { pi: number[]; iterations: number; residual: number; converged: boolean };
  irreducible: boolean;
  period: number | null;
  absorbing: AbsorbingResult | null;
}

interface State {
  matrixText: string;
  labels: string[];
  initialText: string;
  steps: number;
  seed: number;
  preset: string;
  trajectory: number[] | null;
  analysis: Analysis | null;
  error: string | null;
}

const DEFAULT_LABELS = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `S${i + 1}`);

export class StatsMarkovPlugin implements Plugin {
  readonly manifest = statsMarkovManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    matrixText: serializeMatrix(PRESETS[0]!.rows),
    labels: (PRESETS[0]!.labels as string[] | null) ?? DEFAULT_LABELS(PRESETS[0]!.rows.length),
    initialText: '',
    steps: 120,
    seed: 20261011,
    preset: PRESETS[0]!.id,
    trajectory: null,
    analysis: null,
    error: null,
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
    const zh = this.zh;
    return [
      {
        key: 'preset',
        label: 'Preset',
        labelI18n: { 'zh-CN': '预设矩阵', 'en-US': 'Preset' },
        type: 'select',
        options: PRESETS.map((p) => ({
          value: p.id,
          label: zh ? p.zh : p.en,
          labelI18n: { 'zh-CN': p.zh, 'en-US': p.en },
        })),
        value: this.state.preset,
      },
      {
        key: 'matrix',
        label: 'Matrix P (rows = from)',
        labelI18n: { 'zh-CN': '转移矩阵 P（行=出发态）', 'en-US': 'Matrix P (rows = from)' },
        type: 'text',
        value: this.state.matrixText,
        placeholder: '0.9,0.1 ; 0.45,0.55',
        hint: zh
          ? '行随机方阵；行以「;」或换行分隔，列以「,」分隔'
          : 'row-stochastic square matrix; rows split by ";" or newlines, cells by ","',
      },
      {
        key: 'initial',
        label: 'Initial distribution',
        labelI18n: { 'zh-CN': '初始分布', 'en-US': 'Initial distribution' },
        type: 'text',
        value: this.state.initialText,
        placeholder: zh ? '留空 = 均匀' : 'empty = uniform',
      },
      {
        key: 'steps',
        label: 'Simulation steps',
        labelI18n: { 'zh-CN': '轨迹步数', 'en-US': 'Simulation steps' },
        type: 'range',
        min: 10,
        max: 2000,
        step: 10,
        value: this.state.steps,
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'number',
        min: 0,
        max: 4294967295,
        step: 1,
        value: this.state.seed,
      },
      actionButton('simulate', 'Simulate trajectory', '模拟轨迹', 'primary'),
      actionButton('benchmark', 'Run Markov benchmarks', '运行马尔可夫基准验证'),
      actionButton('exportCsv', 'Export chain CSV', '导出链数据 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let recompute = false;
    if (typeof params.preset === 'string') {
      const preset = PRESETS.find((p) => p.id === params.preset);
      if (preset && preset.id !== this.state.preset) {
        this.state.preset = preset.id;
        this.state.matrixText = serializeMatrix(preset.rows);
        this.state.labels = preset.labels ?? DEFAULT_LABELS(preset.rows.length);
        recompute = true;
      }
    }
    if (typeof params.matrix === 'string' && params.matrix !== this.state.matrixText) {
      this.state.matrixText = params.matrix;
      this.state.preset = '';
      recompute = true;
    }
    if (typeof params.initial === 'string' && params.initial !== this.state.initialText) {
      this.state.initialText = params.initial;
      // Initial distribution only affects the trajectory, not the analysis.
      this.state.trajectory = null;
    }
    if (typeof params.steps === 'number' && Number.isFinite(params.steps)) {
      const steps = Math.min(2000, Math.max(10, Math.round(params.steps / 10) * 10));
      if (steps !== this.state.steps) {
        this.state.steps = steps;
        this.state.trajectory = null;
      }
    }
    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      const seed = Math.min(4294967295, Math.max(0, Math.round(params.seed)));
      if (seed !== this.state.seed) {
        this.state.seed = seed;
        this.state.trajectory = null;
      }
    }
    if (recompute) {
      this.state.trajectory = null;
      this.recompute(false);
    }

    if (actionFired(params, 'simulate')) this.simulate();
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
      notify(
        this.api,
        'warning',
        'Markov plugin accepts CSV/TSV/TXT transition matrices.',
        '马尔可夫插件接受 CSV/TSV/TXT 格式的转移矩阵。',
      );
      return;
    }
    const text = await file.text();
    const parsed = parseMatrixText(text);
    if (!parsed) {
      notify(
        this.api,
        'warning',
        'Could not parse a square transition matrix from the file.',
        '无法从文件解析出方阵转移矩阵。',
      );
      return;
    }
    this.state.matrixText = serializeMatrix(parsed.rows);
    this.state.labels = parsed.labels ?? DEFAULT_LABELS(parsed.rows.length);
    this.state.preset = '';
    this.state.trajectory = null;
    this.recompute(true);
  }

  /** Parse + normalize + analyze the current matrix; publishes science outputs. */
  private recompute(explicit: boolean) {
    const parsed = parseMatrixText(this.state.matrixText);
    if (!parsed) {
      this.state.analysis = null;
      this.state.error = this.zh
        ? '矩阵解析失败：需要 ≥2×2 方阵（行以「;」或换行分隔）'
        : 'matrix parse failed: need a >=2x2 square matrix (rows split by ";" or newlines)';
      clearScienceOutputs(this.manifest.id);
      this.draw();
      if (explicit) notify(this.api, 'warning', this.state.error, this.state.error);
      return;
    }
    const st = stochasticize(parsed.rows);
    if (!st) {
      this.state.analysis = null;
      this.state.error = this.zh ? '矩阵标准化失败' : 'matrix normalisation failed';
      clearScienceOutputs(this.manifest.id);
      this.draw();
      return;
    }
    const steady = steadyStateByPower(st.P);
    const irreducible = isIrreducible(st.P);
    const period = chainPeriod(st.P);
    const absorbing = absorbingAnalysis(st.P);
    this.state.labels = this.state.labels.length === parsed.rows.length ? this.state.labels : DEFAULT_LABELS(parsed.rows.length);
    this.state.error = null;
    this.state.analysis = {
      P: st.P,
      labels: this.state.labels,
      n: st.P.length,
      steady,
      irreducible,
      period,
      absorbing,
    };
    this.publishOutputs(st.maxDeviation, st.danglingRows);
    this.draw();
    if (explicit) {
      notify(
        this.api,
        'success',
        `Stationary law computed in ${steady.iterations} iterations (L1 residual ${steady.residual.toExponential(2)}).`,
        `稳态分布已求得：迭代 ${steady.iterations} 次（L1 残差 ${steady.residual.toExponential(2)}）。`,
      );
    }
  }

  /** Publish steady state, convergence, structure and absorption metrics. */
  private publishOutputs(maxDeviation: number, danglingRows: number) {
    const a = this.state.analysis;
    if (!a) return;
    const zh = this.zh;
    const piShort = a.steady.pi.slice(0, 6).map((v) => Number(v.toFixed(4)));
    const ellipsis = a.steady.pi.length > 6 ? ', …' : '';
    const metrics: ScienceMetric[] = [
      {
        key: 'steady-pi',
        label: zh ? '稳态分布 π' : 'Stationary π',
        value: `[${piShort.join(', ')}${ellipsis}]`,
        severity: 'ok',
        hint: zh ? 'πP = π，行向量约定' : 'pi P = pi (row-vector convention)',
      },
      {
        key: 'iterations',
        label: zh ? '收敛迭代数' : 'Iterations',
        value: `${a.steady.iterations}`,
        severity: a.steady.converged ? 'ok' : 'warn',
        hint: zh
          ? `L1 残差 ${fmtMetric(a.steady.residual)}（阈值 1e-12）`
          : `L1 residual ${fmtMetric(a.steady.residual)} (threshold 1e-12)`,
      },
      {
        key: 'structure',
        label: zh ? '遍历性 / 周期' : 'Irreducible / period',
        value: a.irreducible ? `${zh ? '不可约' : 'irreducible'}${a.period ? ` · d=${a.period}` : ''}` : zh ? '可约（多类）' : 'reducible',
        severity: 'info',
        hint:
          zh
            ? '不可约 = 任意两态互达；周期由 BFS 深度 gcd 求得'
            : 'irreducible = all states communicate; period via gcd of BFS-depth increments',
      },
    ];
    if (a.absorbing) {
      const steps = a.absorbing.expectedSteps
        .map((v, i) => `${a.labels[a.absorbing!.transient[i]!] ?? '?'}=${fmtMetric(v)}`)
        .join(', ');
      metrics.push({
        key: 'absorption',
        label: zh ? '期望吸收步数' : 'Expected absorption',
        value: steps,
        severity: 'info',
        hint: zh
          ? '由基本矩阵 N=(I−Q)⁻¹ 的行和给出（高斯消元求逆）'
          : 'row sums of the fundamental matrix N=(I-Q)^-1 (Gauss-Jordan inverse)',
      });
    }
    if (maxDeviation > 1e-9 || danglingRows > 0) {
      metrics.push({
        key: 'repair',
        label: zh ? '矩阵修复' : 'Matrix repair',
        value: danglingRows > 0 ? `${zh ? '悬挂行→均匀' : 'dangling rows -> uniform'} ×${danglingRows}` : zh ? '行归一化' : 'rows normalised',
        severity: 'warn',
        hint: zh
          ? `输入行和最大偏差 ${fmtMetric(maxDeviation)}，已归一化到 1`
          : `largest input row-sum deviation ${fmtMetric(maxDeviation)}, rows normalised to 1`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Seed a new trajectory from the current matrix and initial distribution. */
  private simulate() {
    const a = this.state.analysis;
    if (!a) {
      // Try to recover once (e.g. user edited the matrix without leaving the field).
      this.recompute(false);
    }
    const cur = this.state.analysis;
    if (!cur) {
      notify(this.api, 'warning', this.state.error ?? 'Fix the matrix first.', this.state.error ?? '请先修正转移矩阵。');
      return;
    }
    const initial = parseInitial(this.state.initialText, cur.n);
    this.state.trajectory = simulateChain(cur.P, initial, this.state.steps, this.state.seed);
    this.draw();
  }

  /** Embedded validation benchmark suite (see kernel.runMarkovBenchmark). */
  private runBenchmark() {
    const b = runMarkovBenchmark();
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-weather',
        label: zh ? '基准① 天气稳态误差' : 'Bench ① weather err',
        value: fmtMetric(b.weatherMaxAbsErr),
        severity: b.weatherMaxAbsErr < 1e-10 ? 'ok' : 'warn',
        hint: zh
          ? `P=[[0.9,0.1],[0.45,0.55]] → π=(9/11, 2/11)，迭代 ${b.weatherIterations} 次`
          : `P=[[0.9,0.1],[0.45,0.55]] -> pi=(9/11, 2/11) in ${b.weatherIterations} iterations`,
      },
      {
        key: 'bench-doubly',
        label: zh ? '基准② 双随机→均匀' : 'Bench ② doubly→uniform',
        value: fmtMetric(b.doublyStochasticMaxAbsErr),
        severity: b.doublyStochasticMaxAbsErr < 1e-12 ? 'ok' : 'warn',
        hint: zh ? '双随机矩阵稳态 = 均匀分布' : 'doubly stochastic stationary law = uniform',
      },
      {
        key: 'bench-ruin',
        label: zh ? '基准③ 吸收链误差' : 'Bench ③ absorption err',
        value: `${fmtMetric(b.ruinStepsMaxAbsErr)} / ${fmtMetric(b.ruinProbMaxAbsErr)}`,
        severity: b.ruinStepsMaxAbsErr < 1e-9 && b.ruinProbMaxAbsErr < 1e-9 ? 'ok' : 'warn',
        hint: zh
          ? '赌徒破产：E[步数]=2、P(破产|$1)=2/3（步数误差 / 概率误差）'
          : "gambler's ruin: E[steps]=2, P(ruin|$1)=2/3 (steps err / prob err)",
      },
      {
        key: 'bench-pagerank',
        label: zh ? '基准④ PageRank 残差' : 'Bench ④ PageRank residual',
        value: fmtMetric(b.pagerankFixedPointResidual),
        severity: b.pagerankFixedPointResidual < 1e-12 && b.pagerankUniformMaxAbsErr < 1e-12 ? 'ok' : 'warn',
        hint: zh
          ? '阻尼 0.85：2 循环→均匀；5 节点网页图不动点 L1 残差（Page & Brin 1998）'
          : 'damping 0.85: 2-cycle -> uniform; 5-node web fixed-point L1 residual (Page & Brin 1998)',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.pass ? 'success' : 'warning',
      b.pass
        ? 'All Markov benchmarks passed (weather < 1e-10, ruin < 1e-9, PageRank < 1e-12).'
        : 'Some Markov benchmarks exceeded their thresholds — see the science strip.',
      b.pass
        ? '马尔可夫基准全部通过（天气 < 1e-10、破产 < 1e-9、PageRank < 1e-12）。'
        : '部分马尔可夫基准超出阈值——详见科研输出条。',
    );
  }

  /** Chain CSV: edge list + stationary law + absorption table. */
  private exportCsv() {
    const a = this.state.analysis;
    if (!a) {
      notify(this.api, 'warning', 'Nothing to export — fix the matrix first.', '暂无可导出内容——请先修正矩阵。');
      return;
    }
    const rows: Array<Array<string | number>> = [];
    for (let i = 0; i < a.n; i += 1) {
      for (let j = 0; j < a.n; j += 1) {
        const p = a.P[i]![j] ?? 0;
        if (p > 0) rows.push(['edge', a.labels[i] ?? `S${i + 1}`, a.labels[j] ?? `S${j + 1}`, Number(p.toFixed(8))]);
      }
    }
    for (let i = 0; i < a.n; i += 1) {
      rows.push(['steady', a.labels[i] ?? `S${i + 1}`, '', Number((a.steady.pi[i] ?? 0).toFixed(10))]);
    }
    if (a.absorbing) {
      a.absorbing.transient.forEach((ti, k) => {
        rows.push([
          'expected_steps',
          a.labels[ti] ?? `S${ti + 1}`,
          '',
          Number((a.absorbing!.expectedSteps[k] ?? 0).toFixed(10)),
        ]);
      });
    }
    exportRowsCsv(this.api, 'stats-markov-chain', ['kind', 'from', 'to', 'value'], rows);
  }

  /** Stream stationary law / convergence / trajectory panels into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    let a = this.state.analysis;
    if (!a) {
      this.recompute(false); // recover once, same as the simulate action
      a = this.state.analysis;
    }
    if (!a) {
      notify(this.api, 'warning', this.state.error ?? 'Fix the matrix first.', this.state.error ?? '请先修正转移矩阵。');
      return;
    }
    const piShort = a.steady.pi.slice(0, 4).map((v) => v.toFixed(4)).join(', ');
    const ellipsis = a.n > 4 ? ', …' : '';
    const absorbTxt = a.absorbing
      ? this.zh
        ? `；吸收态 ${a.absorbing.absorbing.length} 个`
        : `; ${a.absorbing.absorbing.length} absorbing state(s)`
      : '';
    const caption: Bilingual = {
      zh: `马尔可夫链（n=${a.n}）：稳态 π=[${piShort}${ellipsis}]，幂法迭代 ${a.steady.iterations} 次（L1 残差 ${a.steady.residual.toExponential(2)}）${absorbTxt}。`,
      en: `Markov chain (n=${a.n}): stationary π=[${piShort}${ellipsis}], power iteration ${a.steady.iterations} steps (L1 residual ${a.steady.residual.toExponential(2)})${absorbTxt}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '马尔可夫链稳态分析', en: 'Markov Stationary Analysis' },
      caption,
      markovFigurePanels({
        P: a.P,
        labels: a.labels,
        pi: a.steady.pi,
        iterations: a.steady.iterations,
        trajectory: this.state.trajectory,
      }),
    );
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = "13px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(
      this.zh ? '马尔可夫链：转移图 · 稳态分布 · 轨迹' : 'Markov chain: transition graph · stationary law · trajectory',
      canvas.width / 2,
      18,
    );

    const a = this.state.analysis;
    if (!a) {
      g.fillStyle = 'rgba(240,170,150,0.95)';
      g.font = "12px 'Microsoft YaHei', Consolas, monospace";
      g.fillText(
        this.state.error ?? (this.zh ? '无有效矩阵' : 'no valid matrix'),
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }

    this.drawGraph(g, a);
    this.drawBars(g, a);
    this.drawTrajectory(g, canvas, a);
    this.drawFooter(g, canvas, a);
  }

  /** Directed transition graph, circular layout. */
  private drawGraph(g: CanvasRenderingContext2D, a: Analysis) {
    const cx = 210;
    const cy = 215;
    const radius = Math.min(150, Math.max(80, 150 - (a.n - 2) * 8));
    const nodeR = Math.max(12, Math.min(18, 90 / a.n + 8));
    const pos = a.labels.map((_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / a.n;
      return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });

    // edges first (under the nodes)
    for (let i = 0; i < a.n; i += 1) {
      const row = a.P[i]!;
      for (let j = 0; j < a.n; j += 1) {
        const p = row[j] ?? 0;
        if (p <= 0.002) continue;
        const from = pos[i]!;
        const to = pos[j]!;
        g.strokeStyle = `rgba(140,190,250,${0.35 + 0.6 * Math.min(1, p)})`;
        g.lineWidth = 0.8 + 4.2 * Math.min(1, p);
        if (i === j) {
          // self-loop
          const ang = -Math.PI / 2 + (2 * Math.PI * i) / a.n;
          const ox = cx + (radius + nodeR) * Math.cos(ang);
          const oy = cy + (radius + nodeR) * Math.sin(ang);
          g.beginPath();
          g.arc(ox, oy, 9, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = 'rgba(190,214,240,0.9)';
          g.font = '9px Consolas, monospace';
          g.textAlign = 'center';
          g.fillText(p.toFixed(2), ox, oy - 13);
        } else {
          // curved edge with arrowhead
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const mx = (from.x + to.x) / 2 - uy * len * 0.12;
          const my = (from.y + to.y) / 2 + ux * len * 0.12;
          const sx = from.x + ux * nodeR;
          const sy = from.y + uy * nodeR;
          const ex = to.x - ux * (nodeR + 3);
          const ey = to.y - uy * (nodeR + 3);
          g.beginPath();
          g.moveTo(sx, sy);
          g.quadraticCurveTo(mx, my, ex, ey);
          g.stroke();
          // arrowhead along the curve tangent near the end
          const tx = 2 * (mx - ex) + (to.x - ux * nodeR - mx);
          const ty = 2 * (my - ey) + (to.y - uy * nodeR - my);
          const tl = Math.hypot(tx, ty) || 1;
          const ax = tx / tl;
          const ay = ty / tl;
          g.fillStyle = g.strokeStyle;
          g.beginPath();
          g.moveTo(ex, ey);
          g.lineTo(ex - 7 * ax + 3.5 * -ay, ey - 7 * ay + 3.5 * ax);
          g.lineTo(ex - 7 * ax - 3.5 * -ay, ey - 7 * ay - 3.5 * ax);
          g.closePath();
          g.fill();
          // probability label
          g.fillStyle = 'rgba(200,220,245,0.95)';
          g.font = '9px Consolas, monospace';
          g.textAlign = 'center';
          g.fillText(p.toFixed(2), mx + ux * 8, my + uy * 8 + 3);
        }
      }
    }

    // nodes
    g.lineWidth = 1;
    for (let i = 0; i < a.n; i += 1) {
      const p = pos[i]!;
      const pi = a.steady.pi[i] ?? 0;
      g.beginPath();
      g.arc(p.x, p.y, nodeR, 0, Math.PI * 2);
      g.fillStyle = `rgba(${Math.round(40 + 200 * Math.min(1, pi * Math.max(1, a.n / 2)))},${Math.round(120 + 60 * Math.min(1, pi * a.n))},220,0.9)`;
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.stroke();
      g.fillStyle = 'rgba(10,14,20,0.95)';
      g.font = `bold ${Math.max(9, nodeR - 5)}px Consolas, monospace`;
      g.textAlign = 'center';
      g.fillText(a.labels[i] ?? `S${i + 1}`, p.x, p.y + 3);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(160,175,195,0.9)';
    g.font = "10px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(this.zh ? '节点底色 ∝ 稳态概率' : 'node fill ∝ stationary probability', 24, 404);
  }

  /** Stationary distribution bar chart (right top). */
  private drawBars(g: CanvasRenderingContext2D, a: Analysis) {
    const x0 = 400;
    const x1 = 744;
    const y0 = 44;
    const y1 = 208;
    const plotW = x1 - x0;
    const plotH = y1 - y0;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(this.zh ? '稳态分布 π（幂法，L1<1e-12）' : 'Stationary π (power iteration, L1<1e-12)', x0, y0 - 6);

    const piMax = Math.max(...a.steady.pi, 0.01);
    const bw = plotW / a.n;
    for (let i = 0; i < a.n; i += 1) {
      const v = a.steady.pi[i] ?? 0;
      const h = (plotH * v) / (piMax * 1.12);
      g.fillStyle = 'rgba(120,200,190,0.8)';
      g.fillRect(x0 + i * bw + 2, y1 - h, Math.max(2, bw - 4), h);
      g.fillStyle = 'rgba(190,214,240,0.95)';
      g.font = '9px Consolas, monospace';
      g.textAlign = 'center';
      g.fillText((a.labels[i] ?? `S${i + 1}`).slice(0, 6), x0 + i * bw + bw / 2, y1 + 11);
      if (a.n <= 8) g.fillText(v.toFixed(3), x0 + i * bw + bw / 2, y1 - h - 4);
    }
  }

  /** Trajectory staircase strip (right bottom). */
  private drawTrajectory(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, a: Analysis) {
    const x0 = 400;
    const x1 = canvas.width - 18;
    const y0 = 240;
    const y1 = canvas.height - 56;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    const title = this.zh
      ? `轨迹模拟（${this.state.steps} 步，种子 ${this.state.seed}）`
      : `Simulated trajectory (${this.state.steps} steps, seed ${this.state.seed})`;
    g.fillText(title, x0, y0 - 6);

    const traj = this.state.trajectory;
    if (!traj || traj.length < 2) {
      g.fillStyle = 'rgba(140,155,175,0.9)';
      g.font = "11px 'Microsoft YaHei', Consolas, monospace";
      g.textAlign = 'center';
      g.fillText(
        this.zh ? '按「模拟轨迹」生成' : 'press "Simulate trajectory"',
        (x0 + x1) / 2,
        (y0 + y1) / 2,
      );
      return;
    }
    const px = (step: number) => x0 + ((x1 - x0) * step) / (traj.length - 1);
    const py = (state: number) => y1 - ((y1 - y0) * (state + 0.5)) / a.n;
    g.strokeStyle = 'rgba(250,205,130,0.9)';
    g.lineWidth = 1.4;
    g.beginPath();
    for (let s = 0; s < traj.length; s += 1) {
      const st = traj[s] ?? 0;
      if (s === 0) g.moveTo(px(s), py(st));
      else {
        g.lineTo(px(s), py(traj[s - 1] ?? st));
        g.lineTo(px(s), py(st));
      }
    }
    g.stroke();
    g.lineWidth = 1;
    // state labels on the left of the strip
    g.fillStyle = 'rgba(160,175,195,0.9)';
    g.font = '9px Consolas, monospace';
    g.textAlign = 'right';
    for (let i = 0; i < a.n; i += 1) {
      g.fillText(a.labels[i] ?? `S${i + 1}`, x0 - 4, py(i) + 3);
    }
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, a: Analysis) {
    g.textAlign = 'left';
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const zh = this.zh;
    const l1 = zh
      ? `n=${a.n}  ·  ${a.irreducible ? `不可约，周期 d=${a.period ?? 1}` : '可约（多个等价类）'}  ·  ${a.absorbing ? `吸收链：吸收态 ${a.absorbing.absorbing.length} 个` : '无吸收态'}`
      : `n=${a.n}  ·  ${a.irreducible ? `irreducible, period d=${a.period ?? 1}` : 'reducible (several classes)'}  ·  ${a.absorbing ? `absorbing: ${a.absorbing.absorbing.length} absorbing state(s)` : 'no absorbing states'}`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = zh
      ? `稳态 π=[${a.steady.pi.slice(0, 4).map((v) => v.toFixed(4)).join(', ')}${a.n > 4 ? ', …' : ''}]  ·  迭代 ${a.steady.iterations} 次，L1 残差 ${a.steady.residual.toExponential(2)}`
      : `steady π=[${a.steady.pi.slice(0, 4).map((v) => v.toFixed(4)).join(', ')}${a.n > 4 ? ', ...' : ''}]  ·  ${a.steady.iterations} iterations, L1 residual ${a.steady.residual.toExponential(2)}`;
    g.fillText(l2, 54, canvas.height - 14);
  }
}

export default function createStatsMarkovPlugin(): Plugin {
  return new StatsMarkovPlugin();
}
