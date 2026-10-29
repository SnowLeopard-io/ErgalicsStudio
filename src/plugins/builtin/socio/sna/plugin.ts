// ==========================================================================
// socio-sna — social network analyzer workbench
//
// Left canvas panel: deterministic force-directed network layout (nodes
// sized by the chosen centrality, coloured by community, amber highlight on
// cascade-adopted nodes). Right panel: ranked centrality bar chart plus the
// cascade adoption curve while a cascade runs. Every step republishes
// structured scientific outputs (n, m, density, top node, modularity,
// cascade reach, qualitative structural verdict).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { mulberry32 } from '@/core/repro/random';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { snaManifest } from './manifest';
import { snaFigurePanels } from './figure';
import {
  burtConstraint,
  brokerageScore,
  buildGraph,
  classifyStructure,
  computeMeasure,
  degreeCentrality,
  forceLayout,
  girvanNewman,
  graphDensity,
  labelPropagation,
  louvainCommunities,
  makeIndependentCascade,
  makeLinearThreshold,
  modularity,
  parseEdgeList,
  pickCascadeSeed,
  plantedPartitionGraph,
  randomGraph,
  pathGraph,
  runSnaBenchmark,
  starGraph,
  type CascadeKind,
  type CascadeSim,
  type CommunityKind,
  type CommunityResult,
  type GirvanNewmanResult,
  type Graph,
  type LayoutPoint,
  type MeasureKind,
  type RawEdge,
  type SampleKind,
} from './kernel';

export { snaManifest } from './manifest';

const SAMPLE_OPTIONS: SampleKind[] = ['star', 'path', 'planted', 'random'];
const MEASURE_OPTIONS: MeasureKind[] = ['degree', 'betweenness', 'closeness', 'eigenvector', 'pagerank'];
const COMMUNITY_OPTIONS: CommunityKind[] = ['none', 'louvain', 'label-prop', 'girvan-newman'];
const CASCADE_OPTIONS: CascadeKind[] = ['none', 'independent-cascade', 'linear-threshold'];

/** Low-saturation academic palette (community colours). */
const PALETTE = ['#7da7d9', '#8fbf9f', '#b48cff', '#d9b26f', '#c97b7b', '#6fb3b3', '#a98fbf', '#b3a184'];
const ADOPT_COLOR = '#d9b26f';
const EDGE_COLOR = 'rgba(148,163,184,0.28)';
const ACCENT = '#7da7d9';
const SAGE = '#8fbf9f';

const MEASURE_LABEL: Record<MeasureKind, { en: string; zh: string }> = {
  degree: { en: 'degree', zh: '度数' },
  betweenness: { en: 'betweenness', zh: '中介' },
  closeness: { en: 'closeness', zh: '接近' },
  eigenvector: { en: 'eigenvector', zh: '特征向量' },
  pagerank: { en: 'PageRank', zh: 'PageRank' },
};

const TOP_BARS = 10;

export class SnaPlugin implements Plugin {
  readonly manifest = snaManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private params = {
    sample: 'planted' as SampleKind,
    nNodes: 16,
    avgDegree: 3,
    directed: false,
    measure: 'betweenness' as MeasureKind,
    community: 'louvain' as CommunityKind,
    cascade: 'none' as CascadeKind,
    cascadeParam: 0.4,
    seed: 20260922,
  };

  private graph: Graph = buildGraph(2, [], false);
  private labels: string[] = ['n0', 'n1'];
  private customEdges: RawEdge[] | null = null;
  private customLabels: string[] | null = null;
  private positions: LayoutPoint[] = [];
  private measures: Record<MeasureKind, number[]> = {
    degree: [],
    betweenness: [],
    closeness: [],
    eigenvector: [],
    pagerank: [],
  };
  private constraint: number[] = [];
  private brokerage: number[] = [];
  private community: CommunityResult | null = null;
  private gn: GirvanNewmanResult | null = null;
  private cascade: CascadeSim | null = null;
  private running = false;
  private timer: number | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    this.rebuild();
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

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const parsed = parseEdgeList(text);
    if (parsed.labels.length < 2 || parsed.edges.length === 0) {
      notify(
        this.api,
        'warning',
        'No valid network data found (need at least 2 nodes and 1 edge).',
        '未找到有效的网络数据（至少需要 2 个节点和 1 条边）。',
      );
      return;
    }
    this.customEdges = parsed.edges;
    this.customLabels = parsed.labels;
    this.labels = parsed.labels;
    this.graph = buildGraph(parsed.labels.length, parsed.edges, this.params.directed);
    this.afterGraphChange();
    notify(
      this.api,
      'success',
      `Loaded network: ${this.graph.n} nodes, ${this.graph.edgeCount} edges.`,
      `已加载网络：${this.graph.n} 个节点、${this.graph.edgeCount} 条边。`,
    );
  }

  getParams(): ParamDefinition[] {
    const opt = (v: string, en: string, zh: string) => ({
      value: v,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
    });
    return [
      {
        key: 'sample',
        label: 'Sample network',
        labelI18n: { 'zh-CN': '示例网络', 'en-US': 'Sample network' },
        type: 'select',
        options: [
          opt('star', 'star', '星形'),
          opt('path', 'path', '路径'),
          opt('planted', 'planted partition', '植入分区'),
          opt('random', 'random (ER)', '随机 (ER)'),
        ],
        value: this.params.sample,
        hint: this.zh ? '加载文件数据后将覆盖示例网络' : 'loading a file overrides the sample network',
      },
      {
        key: 'nNodes',
        label: 'Nodes',
        labelI18n: { 'zh-CN': '节点数', 'en-US': 'Nodes' },
        type: 'range',
        min: 4,
        max: 120,
        step: 1,
        value: this.params.nNodes,
      },
      {
        key: 'avgDegree',
        label: 'Avg degree',
        labelI18n: { 'zh-CN': '平均度', 'en-US': 'Avg degree' },
        type: 'range',
        min: 1,
        max: 10,
        step: 0.5,
        value: this.params.avgDegree,
        hint: this.zh ? '仅随机 (ER) 网络使用' : 'random (ER) networks only',
      },
      {
        key: 'directed',
        label: 'Directed',
        labelI18n: { 'zh-CN': '有向图', 'en-US': 'Directed' },
        type: 'checkbox',
        value: this.params.directed,
      },
      {
        key: 'measure',
        label: 'Centrality',
        labelI18n: { 'zh-CN': '中心性', 'en-US': 'Centrality' },
        type: 'select',
        options: [
          opt('degree', 'degree', '度数'),
          opt('betweenness', 'betweenness (Brandes)', '中介 (Brandes)'),
          opt('closeness', 'closeness', '接近'),
          opt('eigenvector', 'eigenvector', '特征向量'),
          opt('pagerank', 'PageRank', 'PageRank'),
        ],
        value: this.params.measure,
      },
      {
        key: 'community',
        label: 'Communities',
        labelI18n: { 'zh-CN': '社区发现', 'en-US': 'Communities' },
        type: 'select',
        options: [
          opt('none', 'none', '无'),
          opt('louvain', 'Louvain', 'Louvain'),
          opt('label-prop', 'label propagation', '标签传播'),
          opt('girvan-newman', 'Girvan-Newman (small graphs)', 'Girvan-Newman（小图）'),
        ],
        value: this.params.community,
      },
      {
        key: 'cascade',
        label: 'Cascade model',
        labelI18n: { 'zh-CN': '级联模型', 'en-US': 'Cascade model' },
        type: 'select',
        options: [
          opt('none', 'none', '无'),
          opt('independent-cascade', 'independent cascade', '独立级联'),
          opt('linear-threshold', 'linear threshold', '线性阈值'),
        ],
        value: this.params.cascade,
      },
      {
        key: 'cascadeParam',
        label: 'Cascade p / threshold scale',
        labelI18n: { 'zh-CN': '级联概率 / 阈值尺度', 'en-US': 'Cascade p / threshold scale' },
        type: 'range',
        min: 0.01,
        max: 0.95,
        step: 0.01,
        value: this.params.cascadeParam,
        hint: this.zh
          ? '独立级联：每次尝试的传播概率；线性阈值：阈值上界 theta_v ~ U(0, s)'
          : 'independent cascade: per-attempt probability; linear threshold: theta_v ~ U(0, s)',
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
        hint: this.zh ? '固定种子 ⇒ 网络、布局与级联完全可复现' : 'fixed seed ⇒ fully reproducible network, layout and cascade',
      },
      actionButton('stepCascade', 'Step cascade', '级联单步'),
      actionButton('runCascade', 'Run cascade', '运行级联', 'primary'),
      actionButton('stopCascade', 'Pause', '暂停'),
      actionButton('reset', 'Reset', '重置'),
      actionButton('benchmark', 'Run benchmark', '运行基准验证'),
      actionButton('exportCsv', 'Export node metrics CSV', '导出节点指标 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) apply(params[k] as number);
    };
    num('nNodes', (n) => {
      const v = Math.min(120, Math.max(4, Math.round(n)));
      if (v !== this.params.nNodes) {
        this.params.nNodes = v;
        this.customEdges = null;
        this.customLabels = null;
        this.rebuild();
      }
    });
    num('avgDegree', (n) => {
      const v = Math.min(10, Math.max(1, n));
      if (v !== this.params.avgDegree) {
        this.params.avgDegree = v;
        this.customEdges = null;
        this.customLabels = null;
        this.rebuild();
      }
    });
    num('cascadeParam', (n) => {
      const v = Math.min(0.95, Math.max(0.01, n));
      if (v !== this.params.cascadeParam) {
        this.params.cascadeParam = v;
        this.resetCascade();
      }
    });
    num('seed', (n) => {
      const s = Math.min(999999, Math.max(1, Math.round(n)));
      if (s !== this.params.seed) {
        this.params.seed = s;
        this.customEdges = null;
        this.customLabels = null;
        this.rebuild();
      }
    });
    if (typeof params.directed === 'boolean' && params.directed !== this.params.directed) {
      this.params.directed = params.directed;
      this.rebuild();
    }
    if (typeof params.sample === 'string' && (SAMPLE_OPTIONS as string[]).includes(params.sample)) {
      const s = params.sample as SampleKind;
      if (s !== this.params.sample) {
        this.params.sample = s;
        this.customEdges = null;
        this.customLabels = null;
        this.rebuild();
      }
    }
    if (typeof params.measure === 'string' && (MEASURE_OPTIONS as string[]).includes(params.measure)) {
      this.params.measure = params.measure as MeasureKind;
    }
    if (typeof params.community === 'string' && (COMMUNITY_OPTIONS as string[]).includes(params.community)) {
      const c = params.community as CommunityKind;
      if (c !== this.params.community) {
        this.params.community = c;
        this.computeCommunities();
        this.publishOutputs();
      }
    }
    if (typeof params.cascade === 'string' && (CASCADE_OPTIONS as string[]).includes(params.cascade)) {
      const c = params.cascade as CascadeKind;
      if (c !== this.params.cascade) {
        this.params.cascade = c;
        this.stopTimer();
        this.resetCascade();
      }
    }

    if (actionFired(params, 'stepCascade')) {
      this.stopTimer();
      this.stepCascade();
    }
    if (actionFired(params, 'runCascade')) this.startTimer();
    if (actionFired(params, 'stopCascade')) this.stopTimer();
    if (actionFired(params, 'reset')) {
      this.stopTimer();
      this.customEdges = null;
      this.customLabels = null;
      this.rebuild();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    this.draw();
  }

  // ---- graph lifecycle ----------------------------------------------------------

  private rebuild() {
    if (this.customEdges && this.customLabels) {
      // Loaded file data: rebuild under the current directedness.
      this.labels = this.customLabels;
      this.graph = buildGraph(this.customLabels.length, this.customEdges, this.params.directed);
    } else {
      this.labels = Array.from({ length: this.params.nNodes }, (_, i) => `n${i}`);
      const n = this.params.nNodes;
      let edges: RawEdge[];
      switch (this.params.sample) {
        case 'star':
          edges = starGraph(n);
          break;
        case 'path':
          edges = pathGraph(n);
          break;
        case 'planted':
          edges = plantedPartitionGraph(n);
          break;
        case 'random':
        default:
          edges = randomGraph(n, this.params.avgDegree, mulberry32(this.params.seed));
          break;
      }
      this.graph = buildGraph(n, edges, this.params.directed);
    }
    this.afterGraphChange();
  }

  /** Recompute everything that depends on the graph; reset the cascade. */
  private afterGraphChange() {
    const g = this.graph;
    this.positions = forceLayout(g, 560, 380, this.params.seed);
    this.measures.degree = degreeCentrality(g);
    this.measures.betweenness = computeMeasure(g, 'betweenness');
    this.measures.closeness = computeMeasure(g, 'closeness');
    this.measures.eigenvector = computeMeasure(g, 'eigenvector');
    this.measures.pagerank = computeMeasure(g, 'pagerank');
    this.constraint = burtConstraint(g);
    this.brokerage = brokerageScore(g);
    this.computeCommunities();
    this.resetCascade();
    this.publishOutputs();
  }

  private computeCommunities() {
    const kind = this.params.community;
    if (kind === 'none') {
      this.community = null;
      this.gn = null;
      return;
    }
    if (kind === 'louvain') {
      this.gn = null;
      this.community = louvainCommunities(this.graph, this.params.seed);
    } else if (kind === 'label-prop') {
      this.gn = null;
      const labels = labelPropagation(this.graph, this.params.seed);
      let count = 0;
      for (let i = 0; i < labels.length; i += 1) count = Math.max(count, labels[i]! + 1);
      this.community = {
        communityOf: labels,
        communities: count,
        modularity: this.graph.n > 0 ? modularity(this.graph, labels) : 0,
      };
    } else {
      this.community = null;
      this.gn = girvanNewman(this.graph, Math.min(this.graph.edgeCount, 24));
    }
  }

  // ---- cascade control ------------------------------------------------------------

  private resetCascade() {
    if (this.params.cascade === 'none' || this.graph.n === 0) {
      this.cascade = null;
      this.publishOutputs();
      return;
    }
    const seed = pickCascadeSeed(this.graph);
    this.cascade =
      this.params.cascade === 'independent-cascade'
        ? makeIndependentCascade(this.graph, [seed], this.params.cascadeParam, this.params.seed)
        : makeLinearThreshold(this.graph, [seed], this.params.cascadeParam, this.params.seed);
    this.publishOutputs();
  }

  private stepCascade() {
    if (!this.cascade || this.cascade.finished) {
      if (this.cascade?.finished) {
        notify(
          this.api,
          'info',
          `Cascade complete: ${this.cascade.total}/${this.graph.n} nodes adopted.`,
          `级联结束：${this.cascade.total}/${this.graph.n} 个节点采纳。`,
        );
      }
      return;
    }
    this.cascade.step();
    this.publishOutputs();
  }

  private startTimer() {
    if (this.running) return;
    if (!this.cascade || this.cascade.finished) this.resetCascade();
    this.running = true;
    this.timer = window.setInterval(() => {
      if (!this.cascade || this.cascade.finished) {
        this.stopTimer();
        this.draw();
        return;
      }
      this.cascade.step();
      this.publishOutputs();
      this.draw();
    }, 220);
  }

  private stopTimer() {
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---- scientific outputs -----------------------------------------------------------

  private currentMeasure(): number[] {
    return this.measures[this.params.measure];
  }

  private topNodeId(): string {
    const vals = this.currentMeasure();
    let best = 0;
    for (let i = 1; i < vals.length; i += 1) if (vals[i]! > vals[best]!) best = i;
    return this.labels[best] ?? String(best);
  }

  private communityOf(): CommunityResult | null {
    if (this.params.community === 'girvan-newman') {
      if (!this.gn) return null;
      return {
        communityOf: this.gn.communityOf,
        communities: this.gn.communities,
        modularity: this.graph.n > 0 ? modularity(this.graph, this.gn.communityOf) : 0,
      };
    }
    return this.community;
  }

  private publishOutputs() {
    const g = this.graph;
    const vals = this.currentMeasure();
    let sum = 0;
    for (const v of vals) sum += v;
    const maxShare = sum > 0 ? Math.max(...vals) / sum : 0;
    const verdict = classifyStructure(maxShare);
    const comm = this.communityOf();
    const cascadeSeries = this.cascade?.series ?? null;
    const reach = cascadeSeries && g.n > 0 ? (cascadeSeries[cascadeSeries.length - 1] ?? 0) / g.n : 0;
    const ml = MEASURE_LABEL[this.params.measure];
    const metrics: ScienceMetric[] = [
      {
        key: 'size',
        label: this.zh ? '规模' : 'Size',
        value: `n=${g.n}, m=${g.edgeCount}`,
        severity: 'info',
        hint: this.zh ? '节点数 n 与边数 m（无向图每对计一次）' : 'node count n and edge count m (undirected pairs once)',
      },
      {
        key: 'density',
        label: this.zh ? '密度' : 'Density',
        value: fmtMetric(graphDensity(g)),
        severity: 'info',
        hint: this.zh ? '实际边数 / 最大可能边数' : 'actual edges over possible edges',
      },
      {
        key: 'top-node',
        label: this.zh ? `最高${ml.zh}节点` : `Top ${ml.en} node`,
        value: this.topNodeId(),
        severity: 'info',
        hint: this.zh ? '当前中心性度量下得分最高的节点' : 'node with the highest score under the current measure',
      },
      {
        key: 'share',
        label: this.zh ? '首位占比' : 'Top-node share',
        value: fmtMetric(maxShare),
        severity: 'info',
        hint: this.zh ? '最高中心性得分 / 全部中心性总和' : 'max centrality over total centrality mass',
      },
    ];
    if (comm && this.params.community !== 'none') {
      metrics.push({
        key: 'communities',
        label: this.zh ? '社区数' : 'Communities',
        value: String(comm.communities),
        severity: 'info',
        hint: this.zh
          ? `${this.params.community === 'louvain' ? 'Louvain' : this.params.community === 'label-prop' ? '标签传播' : 'Girvan-Newman'} 检测结果`
          : `${this.params.community} detection result`,
      });
      metrics.push({
        key: 'modularity',
        label: this.zh ? '模块度 Q' : 'Modularity Q',
        value: fmtMetric(comm.modularity),
        severity: 'info',
        hint: this.zh ? '加权模块度（Newman）' : 'weighted modularity (Newman)',
      });
    }
    if (this.params.cascade !== 'none' && cascadeSeries) {
      metrics.push({
        key: 'cascade-reach',
        label: this.zh ? '级联到达率' : 'Cascade reach',
        value: `${(reach * 100).toFixed(1)}%`,
        severity: 'info',
        hint: this.zh
          ? `${this.params.cascade === 'independent-cascade' ? '独立级联' : '线性阈值'}：最终采纳节点比例`
          : `${this.params.cascade}: final adopted fraction`,
      });
      metrics.push({
        key: 'cascade-steps',
        label: this.zh ? '级联步数' : 'Cascade steps',
        value: String(Math.max(0, cascadeSeries.length - 1)),
        severity: 'info',
      });
    }
    metrics.push({
      key: 'verdict',
      label: this.zh ? '结构判据' : 'Structure',
      value: this.zh ? verdict.zh : verdict.en,
      severity: verdict.key === 'hub-dominated' ? 'ok' : 'info',
      hint: this.zh
        ? '首位中心性占比的定性分类：≥0.30 中心节点主导；0.12–0.30 异质结构；<0.12 去中心化'
        : 'qualitative classification of the top-node centrality share: >=0.30 hub-dominated; 0.12-0.30 heterogeneous; <0.12 decentralized',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const b = runSnaBenchmark();
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-status',
        label: 'Benchmark',
        value: b.pass ? (this.zh ? '全部通过' : 'ALL PASS') : this.zh ? '未通过' : 'FAIL',
        severity: b.pass ? 'ok' : 'error',
        hint: this.zh ? '内嵌 SNA 验证组（非用户数据）' : 'embedded SNA validation battery (not user data)',
      },
      {
        key: 'bench-star',
        label: this.zh ? '星形中介中心性' : 'Star betweenness',
        value: b.starBetweenness ? (this.zh ? '通过' : 'ok') : this.zh ? '失败' : 'fail',
        severity: b.starBetweenness ? 'ok' : 'error',
        hint: this.zh ? 'K1,7 枢纽 = 15（C(6,2)），叶子 = 0' : 'K1,7 hub = 15 (C(6,2)), leaves = 0',
      },
      {
        key: 'bench-closeness',
        label: this.zh ? '路径接近中心性' : 'Path closeness',
        value: b.pathCloseness ? (this.zh ? '通过' : 'ok') : this.zh ? '失败' : 'fail',
        severity: b.pathCloseness ? 'ok' : 'error',
        hint: this.zh ? 'P5：中心 2/3、端点 0.4、次节点 4/7' : 'P5: centre 2/3, end 0.4, second 4/7',
      },
      {
        key: 'bench-known',
        label: this.zh ? '参考图中介误差' : 'Reference betweenness err',
        value: fmtMetric(b.knownBetweennessErr),
        severity: b.knownBetweennessErr === 0 ? 'ok' : 'warn',
        hint: this.zh ? '6 节点参考图手工中介值对照（期望 0）' : '6-node reference graph hand-computed betweenness (expect 0)',
      },
      {
        key: 'bench-brute',
        label: this.zh ? 'Brandes 交叉验证' : 'Brandes cross-check',
        value: b.brandesMatchesBruteForce ? (this.zh ? '一致' : 'match') : this.zh ? '不一致' : 'mismatch',
        severity: b.brandesMatchesBruteForce ? 'ok' : 'error',
        hint: this.zh ? '与独立的最短路径显式枚举对比' : 'against independent explicit shortest-path enumeration',
      },
      {
        key: 'bench-pagerank',
        label: this.zh ? 'PageRank 归一化' : 'PageRank sum',
        value: b.pagerankSumsTo1 ? (this.zh ? '= 1' : '= 1') : this.zh ? '≠ 1' : '!= 1',
        severity: b.pagerankSumsTo1 ? 'ok' : 'error',
      },
      {
        key: 'bench-louvain',
        label: this.zh ? 'Louvain 植入分区' : 'Louvain planted',
        value: b.louvainPlantedRecovery ? (this.zh ? '恢复' : 'recovered') : this.zh ? '未恢复' : 'missed',
        severity: b.louvainPlantedRecovery ? 'ok' : 'error',
        hint: this.zh ? '16 节点二块植入分区恢复（一致性 ≥ 0.875 且 Q 不低于真值）' : '2-block planted partition of 16 (agreement >= 0.875 and Q >= ground truth)',
      },
      {
        key: 'bench-cascade',
        label: this.zh ? '级联可达界' : 'Cascade bounds',
        value: b.cascadeBounds ? (this.zh ? '满足' : 'ok') : this.zh ? '违反' : 'violated',
        severity: b.cascadeBounds ? 'ok' : 'error',
        hint: this.zh ? 'p=0 停留在种子、p=1 淹没连通分量、序列单调' : 'p=0 stays at seeds, p=1 floods the component, monotone series',
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
      `Benchmark ${b.pass ? 'passed' : 'FAILED'}: betweenness err ${b.knownBetweennessErr}, PageRank sum ${b.pagerankSumsTo1 ? 1 : '!=1'}, determinism ${b.deterministic}.`,
      `基准验证${b.pass ? '通过' : '未通过'}：中介误差 ${b.knownBetweennessErr}、PageRank 归一化 ${b.pagerankSumsTo1}、确定性 ${b.deterministic}。`,
    );
  }

  private exportCsv() {
    const g = this.graph;
    const comm = this.communityOf();
    const rows: Array<Array<number | string>> = [];
    for (let i = 0; i < g.n; i += 1) {
      rows.push([
        this.labels[i] ?? String(i),
        round6(this.measures.degree[i] ?? 0),
        round6(this.measures.betweenness[i] ?? 0),
        round6(this.measures.closeness[i] ?? 0),
        round6(this.measures.eigenvector[i] ?? 0),
        round6(this.measures.pagerank[i] ?? 0),
        comm ? (comm.communityOf[i] ?? -1) : -1,
        round6(this.constraint[i] ?? 0),
        round6(this.brokerage[i] ?? 0),
        this.cascade ? (this.cascade.adoptedStep[i] ?? -1) : -1,
      ]);
    }
    exportRowsCsv(
      this.api,
      'sna-node-metrics',
      ['node_id', 'degree', 'betweenness', 'closeness', 'eigenvector', 'pagerank', 'community', 'burt_constraint', 'brokerage', 'adopted_step'],
      rows,
    );
  }

  private async sendToFigure(): Promise<void> {
    const g = this.graph;
    const vals = this.currentMeasure();
    const ranked = Array.from({ length: g.n }, (_, i) => ({ id: i, value: vals[i] ?? 0 }))
      .sort((a, b) => b.value - a.value || a.id - b.id)
      .slice(0, TOP_BARS);
    const adjacency = new Array<number>(g.n * g.n).fill(0);
    for (let a = 0; a < g.m; a += 1) adjacency[g.sources[a]! * g.n + g.targets[a]!] = g.weights[a]!;
    const comm = this.communityOf();
    const cascadeSeries = this.cascade && this.params.cascade !== 'none' ? this.cascade.series : null;
    const ml = MEASURE_LABEL[this.params.measure];
    const captionFinal = buildCaption(
      g.n,
      g.edgeCount,
      ml,
      ranked.length,
      comm,
      cascadeSeries,
      maxShareOf(vals),
    );
    await pushPanelsToFigure(
      this.api,
      { zh: '社会网络分析', en: 'Social Network Analysis' },
      captionFinal,
      snaFigurePanels({
        labels: this.labels,
        adjacency,
        n: g.n,
        communityOf: comm ? comm.communityOf : null,
        ranked,
        cascadeSeries: cascadeSeries && cascadeSeries.length >= 2 ? cascadeSeries : null,
      }),
    );
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
    const netW = Math.max(120, canvas.width * 0.54);
    this.drawNetwork(g, 54, panelTop, netW, panelBottom - panelTop);
    const rightX = 54 + netW + 28;
    const rightW = canvas.width - rightX - 20;
    const barsH = Math.max(60, (panelBottom - panelTop) * 0.56);
    this.drawBars(g, rightX, panelTop, rightW, barsH);
    this.drawAdoption(g, rightX, panelTop + barsH + 24, rightW, panelBottom - panelTop - barsH - 24);
    this.drawFooter(g, canvas);
  }

  private drawNetwork(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number) {
    const zh = this.zh;
    const graph = this.graph;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh ? `网络布局（节点大小 = ${MEASURE_LABEL[this.params.measure].zh}中心性，颜色 = 社区）` : `Network layout (node size = ${MEASURE_LABEL[this.params.measure].en} centrality, colour = community)`,
      ox + w / 2,
      oy - 8,
    );
    if (graph.n === 0 || this.positions.length !== graph.n) return;

    // Fit positions into the panel with padding.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.positions) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 26;
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
    const px = (x: number): number => ox + pad + (x - minX) * scale + (w - 2 * pad - spanX * scale) / 2;
    const py = (y: number): number => oy + pad + (y - minY) * scale + (h - 2 * pad - spanY * scale) / 2;
    const pts = this.positions.map((p) => ({ x: px(p.x), y: py(p.y) }));

    const comm = this.communityOf();
    const vals = this.currentMeasure();
    const maxV = Math.max(...vals, 1e-12);
    const radius = (i: number): number => 4 + 9 * ((vals[i] ?? 0) / maxV);

    // Edges (with arrowheads when directed).
    g.lineWidth = 1;
    for (let a = 0; a < graph.m; a += 1) {
      const s = graph.sources[a]!;
      const t = graph.targets[a]!;
      if (graph.directed && s > t) continue; // draw each directed arc once
      if (!graph.directed && s > t) continue; // undirected: one stroke per pair
      const a1 = pts[s]!;
      const b1 = pts[t]!;
      g.strokeStyle = EDGE_COLOR;
      g.beginPath();
      g.moveTo(a1.x, a1.y);
      g.lineTo(b1.x, b1.y);
      g.stroke();
      if (graph.directed) {
        const dx = b1.x - a1.x;
        const dy = b1.y - a1.y;
        const d = Math.max(1e-6, Math.hypot(dx, dy));
        const bx = b1.x - (dx / d) * radius(t);
        const by = b1.y - (dy / d) * radius(t);
        const ux = dx / d;
        const uy = dy / d;
        g.fillStyle = EDGE_COLOR;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx - 7 * ux + 3 * uy, by - 7 * uy - 3 * ux);
        g.lineTo(bx - 7 * ux - 3 * uy, by - 7 * uy + 3 * ux);
        g.closePath();
        g.fill();
      }
    }

    // Nodes.
    for (let i = 0; i < graph.n; i += 1) {
      const p = pts[i]!;
      const r = radius(i);
      const adopted = this.cascade?.adopted[i] === 1;
      let color = ACCENT;
      if (adopted) color = ADOPT_COLOR;
      else if (comm) color = PALETTE[(comm.communityOf[i] ?? 0) % PALETTE.length]!;
      g.fillStyle = color;
      g.globalAlpha = adopted ? 1 : 0.92;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      if (adopted) {
        g.strokeStyle = 'rgba(217,178,111,0.85)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        g.stroke();
      }
      if (r >= 7 || graph.n <= 40) {
        g.fillStyle = 'rgba(210,222,236,0.85)';
        g.font = '9px Consolas, monospace';
        g.textAlign = 'center';
        g.fillText(this.labels[i] ?? String(i), p.x, p.y - r - 4);
      }
    }
  }

  private drawBars(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number) {
    const zh = this.zh;
    if (w < 60 || h < 40) return;
    const vals = this.currentMeasure();
    const ranked = Array.from({ length: this.graph.n }, (_, i) => ({ id: i, value: vals[i] ?? 0 }))
      .sort((a, b) => b.value - a.value || a.id - b.id)
      .slice(0, TOP_BARS);
    const maxV = Math.max(...ranked.map((r) => r.value), 1e-12);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh ? `${MEASURE_LABEL[this.params.measure].zh}中心性排名（前 ${ranked.length}）` : `${MEASURE_LABEL[this.params.measure].en} centrality ranking (top ${ranked.length})`,
      ox + w / 2,
      oy - 8,
    );
    const labelW = 34;
    const barW = w - labelW - 46;
    const rowH = Math.min(24, h / Math.max(1, ranked.length));
    g.font = '10px Consolas, monospace';
    ranked.forEach((r, k) => {
      const y = oy + k * rowH + (rowH - 8) / 2;
      g.textAlign = 'right';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(this.labels[r.id] ?? String(r.id), ox + labelW - 6, y + 8);
      const bw = (r.value / maxV) * barW;
      g.fillStyle = this.cascade?.adopted[r.id] === 1 ? ADOPT_COLOR : ACCENT;
      g.fillRect(ox + labelW, y, Math.max(1, bw), 8);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(r.value >= 100 ? r.value.toFixed(0) : r.value.toFixed(3), ox + labelW + Math.max(1, bw) + 4, y + 8);
    });
  }

  private drawAdoption(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number) {
    const zh = this.zh;
    if (w < 60 || h < 40) return;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '级联采纳曲线（采纳比例）' : 'Cascade adoption curve (adopted fraction)', ox + w / 2, oy - 8);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(ox, oy, w, h);
    const series = this.cascade?.series ?? [];
    if (series.length < 2 || this.graph.n === 0) {
      g.fillStyle = 'rgba(150,165,185,0.85)';
      g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(zh ? '选择级联模型后运行' : 'select a cascade model and run', ox + w / 2, oy + h / 2);
      return;
    }
    const n = this.graph.n;
    const steps = series.length - 1;
    const px = (t: number): number => ox + (w * t) / Math.max(1, steps);
    const py = (v: number): number => oy + h - (v / n) * h;
    g.strokeStyle = SAGE;
    g.lineWidth = 1.6;
    g.beginPath();
    series.forEach((v, t) => {
      if (t === 0) g.moveTo(px(t), py(v));
      else g.lineTo(px(t), py(v));
    });
    g.stroke();
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = '10px Consolas, monospace';
    g.textAlign = 'left';
    g.fillText(`0`, ox, oy + h + 12);
    g.fillText(String(steps), ox + w - 14, oy + h + 12);
    g.fillText(`${((series[series.length - 1] ?? 0) / n * 100).toFixed(0)}%`, ox + 4, oy + 12);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const vals = this.currentMeasure();
    let sum = 0;
    for (const v of vals) sum += v;
    const verdict = classifyStructure(sum > 0 ? Math.max(...vals) / sum : 0);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const comm = this.communityOf();
    const l1 = zh
      ? `n=${this.graph.n}  m=${this.graph.edgeCount}  密度=${graphDensity(this.graph).toFixed(3)}  种子=${this.params.seed}  ${this.params.directed ? '有向' : '无向'}  ${this.params.sample === 'random' ? `ER 平均度=${this.params.avgDegree}` : this.params.sample === 'star' ? '星形' : this.params.sample === 'path' ? '路径' : '植入分区'}`
      : `n=${this.graph.n}  m=${this.graph.edgeCount}  density=${graphDensity(this.graph).toFixed(3)}  seed=${this.params.seed}  ${this.params.directed ? 'directed' : 'undirected'}  ${this.params.sample === 'random' ? `ER avg deg=${this.params.avgDegree}` : this.params.sample}`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const cascadeTxt =
      this.cascade && this.params.cascade !== 'none'
        ? zh
          ? `  级联 ${this.cascade.total}/${this.graph.n}`
          : `  cascade ${this.cascade.total}/${this.graph.n}`
        : '';
    const commTxt = comm
      ? zh
        ? `  社区=${comm.communities}  Q=${comm.modularity.toFixed(3)}`
        : `  communities=${comm.communities}  Q=${comm.modularity.toFixed(3)}`
      : '';
    const l2 = zh
      ? `${MEASURE_LABEL[this.params.measure].zh}首位=${this.topNodeId()}${cascadeTxt}${commTxt}  ·  ${verdict.zh}`
      : `top ${MEASURE_LABEL[this.params.measure].en}=${this.topNodeId()}${cascadeTxt}${commTxt}  ·  ${verdict.en}`;
    g.fillText(l2, 54, canvas.height - 14);
  }
}

// ---- module-scope helpers -----------------------------------------------------------

function round6(v: number): number {
  return Number(v.toFixed(6));
}

function maxShareOf(vals: number[]): number {
  let sum = 0;
  for (const v of vals) sum += v;
  return sum > 0 ? Math.max(...vals) / sum : 0;
}

function buildCaption(
  n: number,
  m: number,
  measure: { en: string; zh: string },
  topCount: number,
  comm: CommunityResult | null,
  cascadeSeries: number[] | null,
  share: number,
): Bilingual {
  const verdict = classifyStructure(share);
  const reach =
    cascadeSeries && cascadeSeries.length >= 2 && n > 0
      ? (cascadeSeries[cascadeSeries.length - 1] ?? 0) / n
      : null;
  const zhParts = [
    `社会网络分析（n=${n}，m=${m}）：${measure.zh}中心性 Top-${topCount} 排名`,
    comm ? `${comm.communities} 个社区，模块度 Q=${comm.modularity.toFixed(4)}` : null,
    reach !== null ? `级联到达率 ${(reach * 100).toFixed(1)}%` : null,
    verdict.zh,
  ].filter(Boolean);
  const enParts = [
    `Social network analysis (n=${n}, m=${m}): ${measure.en} centrality top-${topCount} ranking`,
    comm ? `${comm.communities} communities, modularity Q=${comm.modularity.toFixed(4)}` : null,
    reach !== null ? `cascade reach ${(reach * 100).toFixed(1)}%` : null,
    verdict.en,
  ].filter(Boolean);
  return {
    zh: `${zhParts.join('；')}。`,
    en: `${enParts.join('; ')}.`,
  };
}

export default function createSnaPlugin(): Plugin {
  return new SnaPlugin();
}
