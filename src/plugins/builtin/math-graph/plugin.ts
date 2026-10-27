// ==========================================================================
// math-graph — Graph Theory Visualizer
//
// Renders the loaded graph (adjacency-matrix / edge-list text or one of the
// built-in sample graphs) on a deterministic seeded force layout: weighted
// edges with labels and direction arrows, node discs, and per-step
// highlights (kernel.ts produces the explicit step list, this module drives
// the 上一步 / 下一步 / 播放 controls and a controlled rAF playback loop).
// The science strip reports the numeric conclusions of the selected
// algorithm (distances, MST weight, flow + min-cut, colour count, matching
// size, trail verdicts).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { graphFigurePanels } from './figure';
import { mathGraphManifest } from './manifest';
import {
  bellmanFord,
  bipartiteMatching,
  buildAlgorithmSteps,
  colorGraph,
  detectEuler,
  detectHamilton,
  dijkstra,
  edgeKey,
  floydWarshall,
  getSampleGraph,
  konigVertexCover,
  kruskal,
  layoutGraph,
  maxFlow,
  parseGraph,
  prim,
  runGraphBenchmarks,
  SAMPLE_GRAPHS,
  serializeGraph,
  type AllPairsResult,
  type ColoringResult,
  type EulerResult,
  type FlowResult,
  type Graph,
  type GraphAlgorithm,
  type GraphStep,
  type HamiltonResult,
  type MatchingResult,
  type MstResult,
  type ParseFormat,
  type ParseResult,
  type ShortestPathResult,
} from './kernel';

export { mathGraphManifest } from './manifest';

interface State {
  /** Selected sample id, or 'custom' once the input text is edited. */
  sample: string;
  format: ParseFormat;
  input: string;
  algo: GraphAlgorithm;
  /** Source node label (shortest paths / flow). */
  source: string;
  /** Sink node label (maximum flow). */
  target: string;
  /** Index of the currently shown animation step. */
  step: number;
}

interface Analysis {
  shortest?: ShortestPathResult;
  allPairs?: AllPairsResult;
  mst?: MstResult;
  flow?: FlowResult;
  coloring?: ColoringResult;
  matching?: MatchingResult;
  euler?: EulerResult;
  hamilton?: HamiltonResult;
}

const ALGO_I18N: Record<GraphAlgorithm, { en: string; zh: string }> = {
  dijkstra: { en: 'Dijkstra shortest paths', zh: 'Dijkstra 最短路' },
  'bellman-ford': { en: 'Bellman-Ford shortest paths (negative weights)', zh: 'Bellman-Ford 最短路（负权）' },
  'floyd-warshall': { en: 'Floyd-Warshall all-pairs shortest paths', zh: 'Floyd-Warshall 全对最短路' },
  prim: { en: 'Prim minimum spanning tree', zh: 'Prim 最小生成树' },
  kruskal: { en: 'Kruskal minimum spanning tree', zh: 'Kruskal 最小生成树' },
  'ford-fulkerson': { en: 'Ford-Fulkerson maximum flow (DFS)', zh: 'Ford-Fulkerson 最大流（DFS）' },
  'edmonds-karp': { en: 'Edmonds-Karp maximum flow (BFS)', zh: 'Edmonds-Karp 最大流（BFS）' },
  coloring: { en: 'Greedy graph coloring', zh: '贪心图着色' },
  matching: { en: 'Bipartite matching (König cover)', zh: '二部图最大匹配（König 点覆盖）' },
  euler: { en: 'Euler path detection', zh: '欧拉路径检测' },
  hamilton: { en: 'Hamiltonian path detection', zh: '哈密顿路径检测' },
};

/** Canvas palette: base blue, highlight amber, tree/flow teal, steps orange, cut red. */
const PALETTE = ['#6db4ff', '#ffb250', '#4be1c3', '#f5a623', '#ff7a7a'];

/** Milliseconds between automatic playback steps. */
const PLAY_MS = 650;

function fmtWeight(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return String(Number(v.toPrecision(6)));
}

/** Clip a footer string to a pixel budget (appends an ellipsis when cut). */
function clipText(g: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (g.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Draw a small label box (edge weight / flow caption) centred at (x, y). */
function drawTag(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  g.font = '10px Consolas, monospace';
  const w = g.measureText(text).width;
  g.fillStyle = 'rgba(9,12,17,0.85)';
  g.fillRect(x - w / 2 - 3, y - 8, w + 6, 13);
  g.fillStyle = 'rgba(206,220,240,0.98)';
  g.textAlign = 'center';
  g.fillText(text, x, y + 2);
}

export class MathGraphPlugin implements Plugin {
  readonly manifest = mathGraphManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    sample: SAMPLE_GRAPHS[0]!.id,
    format: SAMPLE_GRAPHS[0]!.format,
    input: serializeGraph(SAMPLE_GRAPHS[0]!.graph, SAMPLE_GRAPHS[0]!.format),
    algo: SAMPLE_GRAPHS[0]!.defaultAlgo,
    source: SAMPLE_GRAPHS[0]!.graph.labels[SAMPLE_GRAPHS[0]!.source]!,
    target: SAMPLE_GRAPHS[0]!.graph.labels[SAMPLE_GRAPHS[0]!.target]!,
    step: 0,
  };

  // ---- animation playback ----------------------------------------------------
  private playing = false;
  private raf = 0;
  private lastTs = 0;

  // ---- computed cache (rebuilt only when inputs change) ----------------------
  private cacheKey = '';
  private parsed: ParseResult = { ok: false, error: 'not computed yet' };
  private graph: Graph | null = null;
  private steps: GraphStep[] = [];
  private analysis: Analysis = {};
  private sourceIdx = 0;
  private targetIdx = 0;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.stopPlayback();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stopPlayback();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  // ---- parameters --------------------------------------------------------------

  getParams(): ParamDefinition[] {
    this.ensureComputed();
    const zh = this.zh;
    const sampleOptions = [
      ...SAMPLE_GRAPHS.map((s) => ({
        value: s.id,
        label: zh ? s.labelZh : s.labelEn,
        labelI18n: { 'zh-CN': s.labelZh, 'en-US': s.labelEn },
      })),
      {
        value: 'custom',
        label: zh ? '自定义（编辑下方输入）' : 'Custom (edit the input below)',
        labelI18n: { 'zh-CN': '自定义（编辑下方输入）', 'en-US': 'Custom (edit the input below)' },
      },
    ];
    const formatOptions = [
      { value: 'matrix', label: zh ? '邻接矩阵' : 'Adjacency matrix', labelI18n: { 'zh-CN': '邻接矩阵', 'en-US': 'Adjacency matrix' } },
      { value: 'edges', label: zh ? '边列表' : 'Edge list', labelI18n: { 'zh-CN': '边列表', 'en-US': 'Edge list' } },
    ];
    const algoOptions = (Object.keys(ALGO_I18N) as GraphAlgorithm[]).map((id) => ({
      value: id,
      label: zh ? ALGO_I18N[id].zh : ALGO_I18N[id].en,
      labelI18n: { 'zh-CN': ALGO_I18N[id].zh, 'en-US': ALGO_I18N[id].en },
    }));
    const nodeOptions = this.graph
      ? this.graph.labels.map((l) => ({ value: l, label: l, labelI18n: { 'zh-CN': l, 'en-US': l } }))
      : [{ value: '', label: '—', labelI18n: { 'zh-CN': '—', 'en-US': '—' } }];
    const maxStep = Math.max(0, this.steps.length - 1);
    return [
      {
        key: 'sample',
        label: 'Sample graph',
        labelI18n: { 'zh-CN': '样本图', 'en-US': 'Sample graph' },
        type: 'select',
        options: sampleOptions,
        value: this.state.sample,
        hint: zh ? '内置带权有向 / 无向样本图，选择后写入下方输入框' : 'Built-in weighted directed / undirected graphs; the selection fills the input below',
      },
      {
        key: 'format',
        label: 'Input format',
        labelI18n: { 'zh-CN': '输入格式', 'en-US': 'Input format' },
        type: 'select',
        options: formatOptions,
        value: this.state.format,
      },
      {
        key: 'input',
        label: 'Graph input',
        labelI18n: { 'zh-CN': '图输入', 'en-US': 'Graph input' },
        type: 'text',
        value: this.state.input,
        placeholder: zh ? '0 1 2; 1 0 3; 2 3 0  或  A B 7; A C 9' : '0 1 2; 1 0 3; 2 3 0  or  A B 7; A C 9',
        hint: zh
          ? '条目以 ; 或换行分隔；# 开头为指令（# directed、# undirected、# labels a b c）；矩阵中 0 表示无边，边列表支持 u v w 与 u -> v w'
          : 'Entries separated by ";" or newline; "#" segments are directives (# directed, # undirected, # labels a b c); 0 means no edge in a matrix; the edge list accepts u v w and u -> v w',
      },
      {
        key: 'algo',
        label: 'Algorithm',
        labelI18n: { 'zh-CN': '算法', 'en-US': 'Algorithm' },
        type: 'select',
        options: algoOptions,
        value: this.state.algo,
      },
      {
        key: 'source',
        label: 'Source node',
        labelI18n: { 'zh-CN': '源节点', 'en-US': 'Source node' },
        type: 'select',
        options: nodeOptions,
        value: this.state.source,
      },
      {
        key: 'target',
        label: 'Sink node',
        labelI18n: { 'zh-CN': '汇节点', 'en-US': 'Sink node' },
        type: 'select',
        options: nodeOptions,
        value: this.state.target,
        hint: zh ? '用于最大流算法' : 'Used by the maximum-flow algorithms',
      },
      {
        key: 'step',
        label: 'Step',
        labelI18n: { 'zh-CN': '步骤', 'en-US': 'Step' },
        type: 'range',
        min: 0,
        max: maxStep,
        step: 1,
        value: Math.min(this.state.step, maxStep),
        hint: zh ? `当前算法共 ${this.steps.length} 步` : `${this.steps.length} steps for the selected algorithm`,
      },
      actionButton('prevStep', 'Previous step', '上一步'),
      actionButton('nextStep', 'Next step', '下一步'),
      actionButton('play', 'Play / pause animation', '播放 / 暂停动画'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (v: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    if (typeof params.sample === 'string' && params.sample !== this.state.sample) {
      this.state.sample = params.sample;
      const sample = getSampleGraph(params.sample);
      if (sample) {
        this.state.format = sample.format;
        this.state.input = serializeGraph(sample.graph, sample.format);
        this.state.algo = sample.defaultAlgo;
        this.state.source = sample.graph.labels[sample.source] ?? this.state.source;
        this.state.target = sample.graph.labels[sample.target] ?? this.state.target;
      }
      this.state.step = 0;
      this.stopPlayback();
      this.draw();
    }
    if (typeof params.format === 'string' && params.format !== this.state.format) {
      this.state.format = params.format === 'matrix' ? 'matrix' : 'edges';
      const sample = getSampleGraph(this.state.sample);
      if (sample) this.state.input = serializeGraph(sample.graph, this.state.format);
      this.state.step = 0;
      this.stopPlayback();
      this.draw();
    }
    if (typeof params.input === 'string' && params.input !== this.state.input) {
      this.state.input = params.input;
      this.state.sample = 'custom';
      this.state.step = 0;
      this.stopPlayback();
      this.draw();
    }
    if (typeof params.algo === 'string' && params.algo !== this.state.algo) {
      this.state.algo = params.algo as GraphAlgorithm;
      this.state.step = 0;
      this.stopPlayback();
      this.draw();
    }
    if (typeof params.source === 'string' && params.source !== this.state.source) {
      this.state.source = params.source;
      this.draw();
    }
    if (typeof params.target === 'string' && params.target !== this.state.target) {
      this.state.target = params.target;
      this.draw();
    }
    num('step', (v) => {
      const x = Math.round(v);
      if (x === this.state.step) return false;
      this.state.step = x;
      this.stopPlayback();
      return true;
    });
    if (actionFired(params, 'prevStep')) {
      this.stopPlayback();
      this.state.step = Math.max(0, this.state.step - 1);
      this.draw();
    }
    if (actionFired(params, 'nextStep')) {
      this.stopPlayback();
      this.state.step = Math.min(Math.max(0, this.steps.length - 1), this.state.step + 1);
      this.draw();
    }
    if (actionFired(params, 'play')) this.togglePlay();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- actions -------------------------------------------------------------------

  /** Run the embedded validation suite and publish one metric per benchmark. */
  private runBenchmark() {
    const bench = runGraphBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? ('ok' as const) : ('error' as const),
      hint: this.zh ? b.detailZh : b.detailEn,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} graph benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项图论基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  /** Build distance / flow / MST panels and push them into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    this.ensureComputed();
    const g = this.graph;
    if (!g) {
      notify(this.api, 'warning', 'Cannot parse the graph input — fix it first.', '图输入无法解析 — 请先修正。');
      return;
    }
    const shortest = this.analysis.shortest ?? dijkstra(g, this.sourceIdx);
    const settle = this.state.algo === 'dijkstra' ? shortest.settle : undefined;
    const flows =
      this.state.algo === 'ford-fulkerson' || this.state.algo === 'edmonds-karp' ? this.analysis.flow?.flow : undefined;
    const mstEdges = this.state.algo === 'prim' || this.state.algo === 'kruskal' ? this.analysis.mst?.edges : undefined;
    const name = (i: number): string => g.labels[i] ?? String(i);

    const partsZh: string[] = [];
    const partsEn: string[] = [];
    if (this.analysis.shortest) {
      const d = this.analysis.shortest.dist[this.targetIdx]!;
      partsZh.push(`源 ${name(this.sourceIdx)} 到汇 ${name(this.targetIdx)} 距离 ${fmtMetric(d)}`);
      partsEn.push(`source ${name(this.sourceIdx)} to sink ${name(this.targetIdx)} = ${fmtMetric(d)}`);
    }
    if (this.analysis.allPairs) {
      let maxD = 0;
      for (const row of this.analysis.allPairs.dist) for (const v of row) if (Number.isFinite(v)) maxD = Math.max(maxD, v);
      partsZh.push(`全对最大距离 ${fmtMetric(maxD)}`);
      partsEn.push(`max all-pairs distance ${fmtMetric(maxD)}`);
    }
    if (this.analysis.mst) {
      partsZh.push(`MST 总权 ${fmtMetric(this.analysis.mst.total)}（${this.analysis.mst.edges.length} 条边）`);
      partsEn.push(`MST total weight ${fmtMetric(this.analysis.mst.total)} (${this.analysis.mst.edges.length} edges)`);
    }
    if (this.analysis.flow) {
      partsZh.push(`最大流 ${fmtMetric(this.analysis.flow.value)}，最小割容量 ${fmtMetric(this.analysis.flow.cutCapacity)}`);
      partsEn.push(`max flow ${fmtMetric(this.analysis.flow.value)}, min-cut capacity ${fmtMetric(this.analysis.flow.cutCapacity)}`);
    }
    if (this.analysis.coloring) {
      partsZh.push(`贪心着色使用 ${this.analysis.coloring.used} 色`);
      partsEn.push(`greedy coloring uses ${this.analysis.coloring.used} colours`);
    }
    if (this.analysis.matching) {
      partsZh.push(
        this.analysis.matching.bipartite ? `最大匹配 ${this.analysis.matching.size}` : '图非二部图，匹配不适用',
      );
      partsEn.push(
        this.analysis.matching.bipartite ? `maximum matching ${this.analysis.matching.size}` : 'graph is not bipartite',
      );
    }
    if (this.analysis.euler) {
      partsZh.push(`欧拉轨迹：${this.analysis.euler.kind === 'none' ? '不存在' : this.analysis.euler.kind === 'circuit' ? '回路' : '路径'}`);
      partsEn.push(`Euler trail: ${this.analysis.euler.kind}`);
    }
    if (this.analysis.hamilton) {
      partsZh.push(`哈密顿路径：${this.analysis.hamilton.exists ? '存在' : '不存在'}`);
      partsEn.push(`Hamiltonian path: ${this.analysis.hamilton.exists ? 'exists' : 'none'}`);
    }

    const caption: Bilingual = {
      zh: `图论可视化（${ALGO_I18N[this.state.algo].zh}；${g.n} 节点 / ${g.edges.length} 边，${g.directed ? '有向' : '无向'}）：${partsZh.join('；') || '当前算法无标量结论'}。`,
      en: `Graph theory visualizer (${ALGO_I18N[this.state.algo].en}; ${g.n} nodes / ${g.edges.length} edges, ${g.directed ? 'directed' : 'undirected'}): ${partsEn.join('; ') || 'no scalar conclusion for this algorithm'}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '图论算法结果', en: 'Graph Algorithm Results' },
      caption,
      graphFigurePanels({
        graph: g,
        source: this.sourceIdx,
        distances: shortest.dist,
        settle,
        flows,
        mstEdges,
      }),
    );
  }

  // ---- playback -------------------------------------------------------------------

  private togglePlay() {
    if (this.playing) {
      this.stopPlayback();
      this.draw();
      return;
    }
    if (this.steps.length === 0) return;
    if (this.state.step >= this.steps.length - 1) this.state.step = 0;
    this.playing = true;
    this.lastTs = 0;
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    this.draw();
  }

  private tick = (ts: number) => {
    this.raf = 0;
    if (!this.playing) return;
    if (this.lastTs === 0) this.lastTs = ts;
    if (ts - this.lastTs >= PLAY_MS) {
      this.lastTs = ts;
      if (this.state.step < this.steps.length - 1) {
        this.state.step += 1;
        this.draw();
      } else {
        this.playing = false;
      }
    }
    if (this.playing) this.raf = requestAnimationFrame(this.tick);
  };

  private stopPlayback() {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ---- computation ------------------------------------------------------------------

  private ensureComputed(): void {
    const key = [
      this.state.format,
      this.state.input,
      this.state.algo,
      this.state.source,
      this.state.target,
    ].join('\u0000');
    if (key === this.cacheKey) return;

    const parsed = parseGraph(this.state.input, this.state.format);
    this.parsed = parsed;
    if (!parsed.ok) {
      this.graph = null;
      this.steps = [];
      this.analysis = {};
      this.state.step = 0;
      this.cacheKey = key;
      return;
    }
    const g = parsed.graph;
    this.graph = g;
    const resolve = (label: string, fallback: number): number => {
      const i = g.labels.indexOf(label);
      return i >= 0 ? i : Math.min(Math.max(fallback, 0), Math.max(0, g.n - 1));
    };
    this.sourceIdx = resolve(this.state.source, 0);
    this.targetIdx = resolve(this.state.target, g.n - 1);
    this.state.source = g.labels[this.sourceIdx] ?? '';
    this.state.target = g.labels[this.targetIdx] ?? '';
    this.steps = buildAlgorithmSteps(g, this.state.algo, { source: this.sourceIdx, target: this.targetIdx });
    this.analysis = this.analyze(g);
    this.state.step = Math.min(Math.max(0, this.state.step), Math.max(0, this.steps.length - 1));
    this.cacheKey = [this.state.format, this.state.input, this.state.algo, this.state.source, this.state.target].join(
      '\u0000',
    );
  }

  private analyze(g: Graph): Analysis {
    const a: Analysis = {};
    switch (this.state.algo) {
      case 'dijkstra':
        a.shortest = dijkstra(g, this.sourceIdx);
        break;
      case 'bellman-ford':
        a.shortest = bellmanFord(g, this.sourceIdx);
        break;
      case 'floyd-warshall':
        a.allPairs = floydWarshall(g, undefined, this.sourceIdx);
        break;
      case 'prim':
        a.mst = prim(g, this.sourceIdx);
        break;
      case 'kruskal':
        a.mst = kruskal(g);
        break;
      case 'ford-fulkerson':
        a.flow = maxFlow(g, this.sourceIdx, this.targetIdx, 'dfs');
        break;
      case 'edmonds-karp':
        a.flow = maxFlow(g, this.sourceIdx, this.targetIdx, 'bfs');
        break;
      case 'coloring':
        a.coloring = colorGraph(g);
        break;
      case 'matching':
        a.matching = bipartiteMatching(g);
        break;
      case 'euler':
        a.euler = detectEuler(g);
        break;
      case 'hamilton':
        a.hamilton = detectHamilton(g);
        break;
    }
    return a;
  }

  /** Reconstruct the source → node path from the predecessor array. */
  private pathText(r: ShortestPathResult, node: number): string {
    const g = this.graph;
    if (!g) return '—';
    const chain: number[] = [];
    let cur = node;
    let guard = 0;
    while (cur >= 0 && guard < 512) {
      chain.unshift(cur);
      cur = r.prev[cur]!;
      guard += 1;
    }
    if (chain[0] !== r.source) return '—';
    return chain.map((k) => g.labels[k] ?? String(k)).join(' → ');
  }

  private publishScience(g: Graph): void {
    const zh = this.zh;
    const a = this.analysis;
    const name = (i: number): string => g.labels[i] ?? String(i);
    const metrics: ScienceMetric[] = [];
    switch (this.state.algo) {
      case 'dijkstra':
      case 'bellman-ford': {
        const r = a.shortest;
        if (!r) break;
        for (let i = 0; i < g.n; i += 1) {
          const d = r.dist[i]!;
          metrics.push({
            key: `dist-${i}`,
            label: `d(${name(i)})`,
            value: fmtMetric(d),
            severity: Number.isFinite(d) ? 'ok' : 'info',
            hint: Number.isFinite(d)
              ? zh
                ? `路径：${this.pathText(r, i)}`
                : `path: ${this.pathText(r, i)}`
              : zh
                ? '从源点不可达'
                : 'unreachable from the source',
          });
        }
        if (r.negativeCycle) {
          metrics.push({
            key: 'neg-cycle',
            label: zh ? '负权环' : 'Negative cycle',
            value: zh ? '存在' : 'detected',
            severity: 'error',
            hint: zh ? '从源点可达的负环使最短路无定义' : 'a source-reachable negative cycle makes distances undefined',
          });
        }
        break;
      }
      case 'floyd-warshall': {
        const d = a.allPairs?.dist;
        if (!d) break;
        let reachable = 0;
        let maxD = 0;
        for (let i = 0; i < g.n; i += 1) {
          for (let j = 0; j < g.n; j += 1) {
            if (i === j) continue;
            const v = d[i]![j]!;
            if (Number.isFinite(v)) {
              reachable += 1;
              maxD = Math.max(maxD, v);
            }
          }
        }
        metrics.push({
          key: 'pairs',
          label: zh ? '可达顶点对' : 'Reachable pairs',
          value: `${reachable}`,
          severity: 'ok',
          hint: zh ? `n³ = ${g.n * g.n * g.n} 次松弛（Floyd-Warshall 动态规划）` : `n³ = ${g.n * g.n * g.n} relaxations (Floyd-Warshall DP)`,
        });
        metrics.push({
          key: 'max-dist',
          label: zh ? '最大最短距离' : 'Max shortest distance',
          value: fmtMetric(maxD),
          severity: 'info',
          hint: zh ? `节点下方显示 ${name(this.sourceIdx)} 所在行` : `node overlays show the row of ${name(this.sourceIdx)}`,
        });
        break;
      }
      case 'prim':
      case 'kruskal': {
        const m = a.mst;
        if (!m) break;
        metrics.push({
          key: 'mst-total',
          label: zh ? 'MST 总权' : 'MST total weight',
          value: fmtMetric(m.total),
          severity: m.connected ? 'ok' : 'warn',
          hint: zh
            ? `${m.edges.length} 条边；${m.connected ? '生成树覆盖全部节点' : '图不连通，结果为生成森林'}`
            : `${m.edges.length} edges; ${m.connected ? 'spanning tree covers every node' : 'graph disconnected — spanning forest'}`,
        });
        metrics.push({
          key: 'mst-edges',
          label: zh ? '树边数' : 'Tree edges',
          value: `${m.edges.length} / ${Math.max(0, g.n - 1)}`,
          severity: 'info',
          hint: zh ? '无向视角下的 Kruskal/Prim 边选择' : 'edge selection on the undirected view of the graph',
        });
        break;
      }
      case 'ford-fulkerson':
      case 'edmonds-karp': {
        const f = a.flow;
        if (!f) break;
        const method = this.state.algo === 'edmonds-karp' ? 'Edmonds-Karp (BFS)' : 'Ford-Fulkerson (DFS)';
        metrics.push({
          key: 'max-flow',
          label: zh ? '最大流' : 'Maximum flow',
          value: fmtMetric(f.value),
          severity: 'ok',
          hint: zh ? `${method}：${f.augmentations} 次增广` : `${method}: ${f.augmentations} augmentations`,
        });
        const cut = g.edges.filter((e) => f.reachable[e.u] && !f.reachable[e.v]);
        metrics.push({
          key: 'min-cut',
          label: zh ? '最小割容量' : 'Min-cut capacity',
          value: fmtMetric(f.cutCapacity),
          severity: Math.abs(f.cutCapacity - f.value) < 1e-9 ? 'ok' : 'warn',
          hint: zh
            ? `割边：${cut.map((e) => `${name(e.u)}→${name(e.v)}`).join(', ') || '—'}（max-flow min-cut 定理）`
            : `cut edges: ${cut.map((e) => `${name(e.u)}→${name(e.v)}`).join(', ') || '—'} (max-flow min-cut theorem)`,
        });
        break;
      }
      case 'coloring': {
        const c = a.coloring;
        if (!c) break;
        metrics.push({
          key: 'colors',
          label: zh ? '着色数（贪心上界）' : 'Colors used (greedy bound)',
          value: `${c.used}`,
          severity: 'ok',
          hint: zh
            ? `顺序 ${c.order.map(name).join(' → ')}；着色 ${c.colors.map((x, i) => `${name(i)}=c${x + 1}`).join(', ')}`
            : `order ${c.order.map(name).join(' → ')}; colours ${c.colors.map((x, i) => `${name(i)}=c${x + 1}`).join(', ')}`,
        });
        metrics.push({
          key: 'proper',
          label: zh ? '相邻不同色' : 'Proper coloring',
          value: zh ? '是' : 'yes',
          severity: 'ok',
          hint: zh ? '贪心首着色保证每条边两端颜色不同' : 'first-fit guarantees distinct colours on every edge',
        });
        break;
      }
      case 'matching': {
        const m = a.matching;
        if (!m) break;
        if (!m.bipartite) {
          metrics.push({
            key: 'bipartite',
            label: zh ? '二部图判定' : 'Bipartite test',
            value: zh ? '否' : 'no',
            severity: 'warn',
            hint: zh ? '存在奇环，二部图匹配不适用' : 'an odd cycle exists — bipartite matching does not apply',
          });
          break;
        }
        metrics.push({
          key: 'matching',
          label: zh ? '最大匹配' : 'Maximum matching',
          value: `${m.size}`,
          severity: 'ok',
          hint: zh ? '匈牙利算法增广路径搜索' : 'Hungarian augmenting-path search',
        });
        const cover = konigVertexCover(g, m.side, m.partner);
        metrics.push({
          key: 'cover',
          label: zh ? '最小点覆盖（König）' : 'Min vertex cover (König)',
          value: `${cover.length}`,
          severity: cover.length === m.size ? 'ok' : 'warn',
          hint: zh
            ? `覆盖集 {${cover.map(name).join(', ')}；与最大匹配相等，验证 König 定理`
            : `cover {${cover.map(name).join(', ')}} equals the maximum matching — König theorem`,
        });
        break;
      }
      case 'euler': {
        const e = a.euler;
        if (!e) break;
        const kindText = e.kind === 'circuit' ? (zh ? '欧拉回路' : 'circuit') : e.kind === 'path' ? (zh ? '欧拉路径' : 'path') : zh ? '不存在' : 'none';
        metrics.push({
          key: 'euler',
          label: zh ? '欧拉轨迹' : 'Euler trail',
          value: kindText,
          severity: e.kind !== 'none' ? 'ok' : 'info',
          hint: zh
            ? `奇度节点 ${e.odd.length} 个；${e.connected ? '含边顶点连通' : '不连通'}`
            : `${e.odd.length} odd-degree node(s); vertices with edges are ${e.connected ? 'connected' : 'disconnected'}`,
        });
        if (e.path.length > 0) {
          metrics.push({
            key: 'euler-path',
            label: zh ? '轨迹序列' : 'Trail',
            value: e.path.slice(0, 8).map(name).join(' → ') + (e.path.length > 8 ? ' …' : ''),
            severity: 'ok',
            hint: zh ? `Hierholzer 算法，共 ${Math.max(0, e.path.length - 1)} 条边` : `Hierholzer algorithm, ${Math.max(0, e.path.length - 1)} edges`,
          });
        }
        break;
      }
      case 'hamilton': {
        const h = a.hamilton;
        if (!h) break;
        metrics.push({
          key: 'hamilton',
          label: zh ? '哈密顿路径' : 'Hamiltonian path',
          value: h.exists ? (zh ? (h.cycle ? '回路存在' : '路径存在') : h.cycle ? 'cycle exists' : 'path exists') : zh ? '不存在' : 'none',
          severity: h.exists ? 'ok' : 'info',
          hint: h.exists
            ? h.path.map(name).join(' → ')
            : zh
              ? '回溯搜索穷尽所有分支后未找到'
              : 'backtracking exhausted every branch without success',
        });
        break;
      }
    }
    if (metrics.length === 0) clearScienceOutputs(this.manifest.id);
    else setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing ----------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = this.zh;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, W, H);

    this.ensureComputed();
    const graph = this.graph;
    if (!graph) {
      clearScienceOutputs(this.manifest.id);
      const err = this.parsed.ok ? 'unknown parse error' : this.parsed.error;
      g.fillStyle = 'rgba(255,140,140,0.95)';
      g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(zh ? `图输入无法解析：${err}` : `Cannot parse graph input: ${err}`, W / 2, H / 2);
      return;
    }
    this.publishScience(graph);

    const algoName = zh ? ALGO_I18N[this.state.algo].zh : ALGO_I18N[this.state.algo].en;
    const graphTitle = zh
      ? `${graph.n} 节点 / ${graph.edges.length} 边 · ${graph.directed ? '有向' : '无向'}`
      : `${graph.n} nodes / ${graph.edges.length} edges · ${graph.directed ? 'directed' : 'undirected'}`;

    if (graph.n === 0 || graph.edges.length === 0) {
      g.fillStyle = 'rgba(235,240,247,0.92)';
      g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(`${algoName} · ${graphTitle}`, W / 2, 18);
      g.fillStyle = 'rgba(160,175,195,0.9)';
      g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(zh ? '图中没有边 — 请输入非零权重或添加边' : 'graph has no edges — enter non-zero weights or add edges', W / 2, H / 2);
      return;
    }

    // ---- deterministic layout region (title above, two footer lines below) ----
    const TOP = 30;
    const BOTTOM = 44;
    const localH = Math.max(60, H - TOP - BOTTOM);
    const pts = layoutGraph(graph, W, localH);
    const R = 15;
    const px = (i: number): number => pts[i]!.x;
    const py = (i: number): number => pts[i]!.y + TOP;

    const stepIdx = Math.min(this.state.step, Math.max(0, this.steps.length - 1));
    const step = this.steps[stepIdx];
    const hiEdges = new Set((step?.edges ?? []).map(([a, b]) => edgeKey(a, b)));
    const hiNodes = new Set(step?.nodes ?? []);
    const overlays = step?.labels;
    const flowRun =
      this.state.algo === 'ford-fulkerson' || this.state.algo === 'edmonds-karp' ? this.analysis.flow : undefined;

    // ---- edges: line + arrowhead + weight (or flow/weight) caption ------------
    for (let idx = 0; idx < graph.edges.length; idx += 1) {
      const e = graph.edges[idx]!;
      const ax = px(e.u);
      const ay = py(e.u);
      const bx = px(e.v);
      const by = py(e.v);
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const sx = ax + ux * (R + 2);
      const sy = ay + uy * (R + 2);
      const ex = bx - ux * (R + 6);
      const ey = by - uy * (R + 6);
      const flowVal = flowRun ? Math.abs(flowRun.flow[idx]!) : 0;
      const isHi = hiEdges.has(edgeKey(e.u, e.v));
      const color = isHi ? '#f5a623' : flowVal > 1e-9 ? '#4be1c3' : 'rgba(136,152,178,0.8)';
      g.strokeStyle = color;
      g.lineWidth = isHi ? 2.8 : 1.6;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(ex, ey);
      g.stroke();
      if (graph.directed) {
        const s = 8;
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(ex, ey);
        g.lineTo(ex - s * ux - s * 0.45 * uy, ey - s * uy + s * 0.45 * ux);
        g.lineTo(ex - s * ux + s * 0.45 * uy, ey - s * uy - s * 0.45 * ux);
        g.closePath();
        g.fill();
      }
      const caption = flowRun ? `${fmtWeight(flowVal)}/${fmtWeight(e.w)}` : fmtWeight(e.w);
      drawTag(g, caption, (ax + bx) / 2, (ay + by) / 2);
    }

    // ---- nodes: disc + label + optional overlay (distance / colour / partner) --
    for (let i = 0; i < graph.n; i += 1) {
      const x = px(i);
      const y = py(i);
      const tag = overlays?.[i] ?? '';
      const colorIdx = /^c(\d+)$/.exec(tag);
      const isHi = hiNodes.has(i);
      let fill = '#141b26';
      let stroke = '#6db4ff';
      let text = '#e8eef7';
      if (colorIdx) {
        fill = PALETTE[(Number(colorIdx[1]) - 1) % PALETTE.length]!;
        stroke = 'rgba(240,244,250,0.9)';
        text = '#10151c';
      } else if (isHi) {
        fill = '#ffb250';
        stroke = '#ffd9a0';
        text = '#151a21';
      }
      g.lineWidth = isHi ? 3 : 2;
      g.strokeStyle = stroke;
      g.fillStyle = fill;
      g.beginPath();
      g.arc(x, y, R, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
      g.fillStyle = text;
      g.font = `bold 12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(graph.labels[i] ?? String(i), x, y);
      g.textBaseline = 'alphabetic';
      if (tag) {
        g.font = '10px Consolas, monospace';
        g.fillStyle = 'rgba(206,220,240,0.95)';
        g.fillText(tag, x, y + R + 11);
      }
    }

    // ---- title + footers --------------------------------------------------------
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(240,244,250,0.92)';
    g.fillText(`${algoName} · ${graphTitle}`, W / 2, 18);

    const sample = getSampleGraph(this.state.sample);
    const sampleName = sample ? (zh ? sample.labelZh : sample.labelEn) : zh ? '自定义输入' : 'custom input';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const desc = step ? (zh ? step.descZh : step.descEn) : zh ? '无步骤' : 'no steps';
    const prefix = this.steps.length > 0 ? `${zh ? '步骤' : 'step'} ${stepIdx + 1}/${this.steps.length}` : '';
    const running = this.playing ? (zh ? '播放中' : 'playing') : '';
    const left = [running, prefix, desc].filter((s) => s.length > 0).join(' · ');
    g.fillText(clipText(g, left, W - 40 - g.measureText(sampleName).width), 12, H - 26);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(150,163,182,0.95)';
    g.fillText(clipText(g, sampleName, 220), W - 12, H - 26);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(150,163,182,0.95)';
    g.fillText(
      zh
        ? '图例：橙 = 当前步骤节点，黄 = 当前步骤边，青 = 有流量的边，c1…ck = 着色结果；布局使用固定种子确定性力导向'
        : 'legend: amber = step nodes, yellow = step edges, teal = edges carrying flow, c1…ck = colouring; layout is a deterministic seeded force layout',
      12,
      H - 9,
    );
  }
}

export default function createMathGraphPlugin(): Plugin {
  return new MathGraphPlugin();
}
