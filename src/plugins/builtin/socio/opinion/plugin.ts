// ==========================================================================
// socio-opinion — public opinion diffusion workbench
//
// Left canvas panel: the network layout (deterministic seeded circular
// positions; node colour = state: susceptible / adopted / fact-checked,
// initial seeds ring-highlighted, greedy influential seeds dash-ringed).
// Right panel: adoption curves per cascade step plus the mean-opinion line.
// Footer carries the echo-chamber homophily index and verdict. Run/pause
// animates the spread on a timer; every step republishes structured
// scientific outputs (step, adoption fraction, homophily, reach, verdict).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { mulberry32 } from '@/core/repro/random';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { opinionManifest } from './manifest';
import { opinionFigurePanels } from './figure';
import {
  ADOPTED,
  CORRECTED,
  DEFAULT_OPINION_PARAMS,
  SUSCEPTIBLE,
  WS_REWIRE_PROB,
  buildNetwork,
  competingWave,
  drawThresholds,
  expectedReach,
  fixedThresholds,
  greedySeeds,
  icWave,
  initialOpinions,
  ltWave,
  opinionStep,
  opinionSeriesRow,
  pickSeeds,
  runOpinionBenchmark,
  type CascadeModel,
  type NetworkKind,
  type OpinionMode,
  type OpinionParams,
  type SeriesRow,
  type SocialNetwork,
  type ThresholdMode,
} from './kernel';

export { opinionManifest } from './manifest';

// Low-saturation academic palette.
const SUSCEPTIBLE_COLOR = 'rgba(148,163,184,0.78)';
const ADOPTED_COLOR = 'rgba(203,122,114,0.92)';
const CORRECTED_COLOR = 'rgba(96,168,150,0.92)';
const SEED_RING = 'rgba(214,188,120,0.95)';
const EDGE_COLOR = 'rgba(148,163,184,0.16)';
const ADOPT_LINE = '#c07a72';
const CORRECT_LINE = '#5fae97';
const OPINION_LINE = '#7d8fc9';

const NODE_OPTIONS = ['20', '40', '60', '80', '120', '160', '200'];

export class OpinionPlugin implements Plugin {
  readonly manifest = opinionManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  /** Fact-checker seed count (competing cascades only). */
  private factCheckers = 3;

  private params: OpinionParams = { ...DEFAULT_OPINION_PARAMS };
  private net: SocialNetwork = { n: 0, edges: [], adj: [] };
  private opinions = new Float64Array(0);
  private thresholds = new Float64Array(0);
  private state = new Uint8Array(0);
  private aFrontier: number[] = [];
  private bFrontier: number[] = [];
  private seedSet: number[] = [];
  private factSet: number[] = [];
  private influential: number[] | null = null;
  private positions: Array<{ x: number; y: number }> = [];
  private series: SeriesRow[] = [];
  private step = 0;
  private saturated = false;
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
        key: 'model',
        label: 'Model',
        labelI18n: { 'zh-CN': '传播模型', 'en-US': 'Model' },
        type: 'select',
        options: [
          { value: 'independent-cascade', label: this.zh ? '独立级联' : 'independent cascade', labelI18n: { 'zh-CN': '独立级联', 'en-US': 'independent cascade' } },
          { value: 'linear-threshold', label: this.zh ? '线性阈值' : 'linear threshold', labelI18n: { 'zh-CN': '线性阈值', 'en-US': 'linear threshold' } },
          { value: 'competing-cascades', label: this.zh ? '竞争级联（谣言 vs 核查）' : 'competing cascades', labelI18n: { 'zh-CN': '竞争级联（谣言 vs 核查）', 'en-US': 'competing cascades' } },
        ],
        value: this.params.model,
      },
      {
        key: 'network',
        label: 'Network',
        labelI18n: { 'zh-CN': '网络结构', 'en-US': 'Network' },
        type: 'select',
        options: [
          { value: 'random', label: this.zh ? '随机图' : 'random', labelI18n: { 'zh-CN': '随机图', 'en-US': 'random' } },
          { value: 'small-world', label: this.zh ? '小世界' : 'small-world', labelI18n: { 'zh-CN': '小世界', 'en-US': 'small-world' } },
          { value: 'echo-chamber', label: this.zh ? '回音室' : 'echo-chamber', labelI18n: { 'zh-CN': '回音室', 'en-US': 'echo-chamber' } },
        ],
        value: this.params.network,
      },
      {
        key: 'nNodes',
        label: 'Nodes',
        labelI18n: { 'zh-CN': '节点数', 'en-US': 'Nodes' },
        type: 'select',
        options: NODE_OPTIONS.map((v) => ({ value: v, label: v, labelI18n: { 'zh-CN': v, 'en-US': v } })),
        value: String(this.params.nNodes),
      },
      {
        key: 'avgDegree',
        label: 'Mean degree',
        labelI18n: { 'zh-CN': '平均度', 'en-US': 'Mean degree' },
        type: 'range',
        min: 2,
        max: 12,
        step: 1,
        value: this.params.avgDegree,
      },
      {
        key: 'homophily',
        label: 'Homophily',
        labelI18n: { 'zh-CN': '同质化强度', 'en-US': 'Homophily' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        value: this.params.homophily,
        hint: this.zh ? '回音室网络的同质化重连强度；小世界网络使用固定 0.15 重连率' : 'echo-chamber rewiring strength; small-world uses a fixed 0.15 rewire rate',
      },
      {
        key: 'spreadProb',
        label: 'Spread p',
        labelI18n: { 'zh-CN': '传播概率 p', 'en-US': 'Spread p' },
        type: 'range',
        min: 0.05,
        max: 1,
        step: 0.05,
        value: this.params.spreadProb,
        hint: this.zh ? '逐边采纳概率（有效概率 = p × 边权）' : 'per-edge adoption probability (effective = p x edge weight)',
      },
      {
        key: 'correctionProb',
        label: 'Correction p',
        labelI18n: { 'zh-CN': '核查纠正概率', 'en-US': 'Correction p' },
        type: 'range',
        min: 0.05,
        max: 1,
        step: 0.05,
        value: this.params.correctionProb,
        visibleWhen: { key: 'model', in: ['competing-cascades'] },
      },
      {
        key: 'factCheckers',
        label: 'Fact-checkers',
        labelI18n: { 'zh-CN': '事实核查节点数', 'en-US': 'Fact-checkers' },
        type: 'range',
        min: 0,
        max: 8,
        step: 1,
        value: this.factCheckers,
        visibleWhen: { key: 'model', in: ['competing-cascades'] },
        hint: this.zh ? '初始核查种子数量（纠正已采纳节点用同一概率）' : 'initial fact-checker seeds (same probability corrects adopted nodes)',
      },
      {
        key: 'seedCount',
        label: 'Seeds k',
        labelI18n: { 'zh-CN': '种子数 k', 'en-US': 'Seeds k' },
        type: 'range',
        min: 1,
        max: 8,
        step: 1,
        value: this.params.seedCount,
        hint: this.zh ? '初始采纳种子数，也是影响最大化的预算' : 'initial adopter seeds, also the influence-maximization budget',
      },
      {
        key: 'randomSeeds',
        label: 'Random seeds',
        labelI18n: { 'zh-CN': '随机选种', 'en-US': 'Random seeds' },
        type: 'checkbox',
        value: this.params.randomSeeds,
        hint: this.zh ? '开：按种子随机选初始节点；关：取编号最小的节点' : 'on: seeded random nodes; off: lowest indices',
      },
      {
        key: 'thresholdMode',
        label: 'Thresholds',
        labelI18n: { 'zh-CN': '阈值方式', 'en-US': 'Thresholds' },
        type: 'select',
        options: [
          { value: 'seeded', label: this.zh ? '随机抽取' : 'seeded draw', labelI18n: { 'zh-CN': '随机抽取', 'en-US': 'seeded draw' } },
          { value: 'fixed', label: this.zh ? '固定值' : 'fixed', labelI18n: { 'zh-CN': '固定值', 'en-US': 'fixed' } },
        ],
        value: this.params.thresholdMode,
        visibleWhen: { key: 'model', in: ['linear-threshold'] },
      },
      {
        key: 'threshold',
        label: 'Threshold',
        labelI18n: { 'zh-CN': '固定阈值', 'en-US': 'Threshold' },
        type: 'range',
        min: 0.05,
        max: 0.95,
        step: 0.05,
        value: this.params.threshold,
        visibleWhen: { key: 'model', in: ['linear-threshold'] },
        hint: this.zh ? '仅在阈值方式 = 固定值时生效' : 'applies when threshold mode = fixed',
      },
      {
        key: 'opinionMode',
        label: 'Opinion dynamics',
        labelI18n: { 'zh-CN': '观点动力学', 'en-US': 'Opinion dynamics' },
        type: 'select',
        options: [
          { value: 'static', label: this.zh ? '静态' : 'static', labelI18n: { 'zh-CN': '静态', 'en-US': 'static' } },
          { value: 'average', label: this.zh ? 'DeGroot 平均' : 'DeGroot average', labelI18n: { 'zh-CN': 'DeGroot 平均', 'en-US': 'DeGroot average' } },
          { value: 'bounded', label: this.zh ? '有界置信平均' : 'bounded confidence', labelI18n: { 'zh-CN': '有界置信平均', 'en-US': 'bounded confidence' } },
        ],
        value: this.params.opinionMode,
        hint: this.zh ? '每步观点更新方式（影响均值/方差与同质化指标）' : 'per-step opinion update (drives mean/variance and homophily)',
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
        hint: this.zh ? '固定种子 ⇒ 网络与级联完全可复现' : 'fixed seed ⇒ fully reproducible network and cascades',
      },
      actionButton('step', 'Step ×1', '单步 ×1'),
      actionButton('run', 'Run', '运行', 'primary'),
      actionButton('pause', 'Pause', '暂停'),
      actionButton('reset', 'Reset', '重置'),
      actionButton('findSeeds', 'Find influential seeds', '搜索影响力种子'),
      actionButton('benchmark', 'Run benchmark', '运行基准验证'),
      actionButton('exportCsv', 'Export adoption series', '导出采纳序列'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) apply(params[k] as number);
    };
    num('avgDegree', (n) => {
      const v = Math.min(12, Math.max(2, Math.round(n)));
      if (v !== this.params.avgDegree) {
        this.params.avgDegree = v;
        this.reset();
      }
    });
    num('homophily', (n) => {
      const v = Math.min(1, Math.max(0, n));
      if (v !== this.params.homophily) {
        this.params.homophily = v;
        this.reset();
      }
    });
    num('spreadProb', (n) => {
      this.params.spreadProb = Math.min(1, Math.max(0.05, n));
    });
    num('correctionProb', (n) => {
      this.params.correctionProb = Math.min(1, Math.max(0.05, n));
    });
    num('factCheckers', (n) => {
      const v = Math.min(8, Math.max(0, Math.round(n)));
      if (v !== this.factCheckers) {
        this.factCheckers = v;
        this.reset();
      }
    });
    num('seedCount', (n) => {
      const v = Math.min(8, Math.max(1, Math.round(n)));
      if (v !== this.params.seedCount) {
        this.params.seedCount = v;
        this.reset();
      }
    });
    num('threshold', (n) => {
      this.params.threshold = Math.min(0.95, Math.max(0.05, n));
    });
    num('seed', (n) => {
      const s = Math.max(1, Math.round(n));
      if (s !== this.params.seed) {
        this.params.seed = s;
        this.reset();
      }
    });
    if (typeof params.model === 'string' && ['independent-cascade', 'linear-threshold', 'competing-cascades'].includes(params.model)) {
      if (params.model !== this.params.model) {
        this.params.model = params.model as CascadeModel;
        this.reset();
      }
    }
    if (typeof params.network === 'string' && ['random', 'small-world', 'echo-chamber'].includes(params.network)) {
      if (params.network !== this.params.network) {
        this.params.network = params.network as NetworkKind;
        this.reset();
      }
    }
    if (typeof params.nNodes === 'string' && NODE_OPTIONS.includes(params.nNodes)) {
      const n = Number(params.nNodes);
      if (n !== this.params.nNodes) {
        this.params.nNodes = n;
        this.reset();
      }
    }
    if (typeof params.thresholdMode === 'string' && (params.thresholdMode === 'seeded' || params.thresholdMode === 'fixed')) {
      if (params.thresholdMode !== this.params.thresholdMode) {
        this.params.thresholdMode = params.thresholdMode as ThresholdMode;
        this.reset();
      }
    }
    if (typeof params.opinionMode === 'string' && ['static', 'average', 'bounded'].includes(params.opinionMode)) {
      this.params.opinionMode = params.opinionMode as OpinionMode;
    }
    if (typeof params.randomSeeds === 'boolean' && params.randomSeeds !== this.params.randomSeeds) {
      this.params.randomSeeds = params.randomSeeds;
      this.reset();
    }

    if (actionFired(params, 'step')) {
      this.stopTimer();
      this.stepOnce();
    }
    if (actionFired(params, 'run')) this.startTimer();
    if (actionFired(params, 'pause')) this.stopTimer();
    if (actionFired(params, 'reset')) {
      this.stopTimer();
      this.reset();
    }
    if (actionFired(params, 'findSeeds')) this.findSeeds();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    this.draw();
  }

  // ---- simulation control -----------------------------------------------------

  private reset() {
    const p = this.params;
    const rand = mulberry32(p.seed >>> 0 || 1);
    this.opinions = initialOpinions(p.nNodes, rand);
    this.net = buildNetwork(p, this.opinions, rand);
    this.thresholds = p.thresholdMode === 'fixed' ? fixedThresholds(this.net, p.threshold) : drawThresholds(this.net, rand);
    this.seedSet = pickSeeds(this.net.n, p.seedCount, p.randomSeeds, rand);
    const exclude = new Set(this.seedSet);
    this.factSet = p.model === 'competing-cascades' ? pickSeeds(this.net.n, this.factCheckers, p.randomSeeds, rand, exclude) : [];
    this.state = new Uint8Array(this.net.n);
    for (const s of this.seedSet) this.state[s] = ADOPTED;
    for (const s of this.factSet) this.state[s] = CORRECTED;
    this.aFrontier = this.seedSet.slice().sort((a, b) => a - b);
    this.bFrontier = this.factSet.slice().sort((a, b) => a - b);
    this.influential = null;
    this.series = [opinionSeriesRow(this.net, this.state, this.opinions)];
    this.step = 0;
    this.saturated = false;
    this.layoutPositions();
    this.publishOutputs();
  }

  /** Deterministic seeded circular layout with radius jitter, in [0, 1]^2. */
  private layoutPositions() {
    const rand = mulberry32(((this.params.seed ^ 0x51ed270b) >>> 0) || 1);
    const n = Math.max(1, this.net.n);
    this.positions = [];
    for (let i = 0; i < this.net.n; i += 1) {
      const a = (2 * Math.PI * i) / n + (rand() - 0.5) * 0.6;
      const r = 0.72 + 0.26 * rand();
      this.positions.push({ x: 0.5 + 0.5 * r * Math.cos(a), y: 0.5 + 0.5 * r * Math.sin(a) });
    }
  }

  private stepOnce() {
    if (this.saturated || this.net.n === 0) return;
    const p = this.params;
    const rand = mulberry32(((p.seed + this.step * 0x9e3779b1) >>> 0) || 1);
    let aNew: number[] = [];
    let bNew: number[] = [];
    if (p.model === 'linear-threshold') {
      aNew = ltWave(this.net, this.state, this.thresholds);
    } else if (p.model === 'competing-cascades') {
      const r = competingWave(this.net, this.state, this.aFrontier, this.bFrontier, p.spreadProb, p.correctionProb, rand);
      aNew = r.aNew;
      bNew = r.bNew;
    } else {
      aNew = icWave(this.net, this.state, this.aFrontier, p.spreadProb, rand);
    }
    this.aFrontier = aNew;
    this.bFrontier = bNew;
    if (p.opinionMode !== 'static') this.opinions = opinionStep(this.net, this.opinions, p.opinionMode);
    this.step += 1;
    this.series.push(opinionSeriesRow(this.net, this.state, this.opinions));
    if (this.series.length > 20000) this.series.shift();
    this.saturated = aNew.length === 0 && bNew.length === 0;
    this.publishOutputs();
    if (this.saturated) this.stopTimer();
  }

  private startTimer() {
    if (this.running || this.saturated) return;
    this.running = true;
    this.timer = window.setInterval(() => {
      this.stepOnce();
      this.draw();
    }, 160);
  }

  private stopTimer() {
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---- influence maximization ----------------------------------------------------

  private findSeeds() {
    if (this.net.n === 0) return;
    const base = (this.params.seed ^ 0x6a09e667) >>> 0 || 1;
    const seeds = greedySeeds(this.net, this.params.seedCount, this.params.spreadProb, 16, base);
    this.influential = seeds;
    const reach = expectedReach(this.net, seeds, this.params.spreadProb, 16, base);
    notify(
      this.api,
      'success',
      `Greedy (CELF) seeds [${seeds.join(', ')}] reach ~${reach.toFixed(2)} nodes with k=${this.params.seedCount} (dashed gold rings).`,
      `贪心种子 [${seeds.join(', ')}] 期望到达 ~${reach.toFixed(2)} 个节点（k=${this.params.seedCount}，CELF 惰性贪心，虚线金圈标注）。`,
    );
    this.publishOutputs();
  }

  // ---- scientific outputs -------------------------------------------------------

  private echoVerdict(): { zh: string; en: string; severity: 'ok' | 'warn' | 'info' } {
    const h = this.series[this.series.length - 1]?.homophily ?? 0;
    if (h >= 0.7) {
      return { zh: '强回音室（H ≥ 0.7）', en: 'strong echo chamber (H >= 0.7)', severity: 'warn' };
    }
    if (h >= 0.4) {
      return { zh: '中度同质化（0.4 ≤ H < 0.7）', en: 'moderate homophily (0.4 <= H < 0.7)', severity: 'info' };
    }
    return { zh: '观点曝光多样（H < 0.4）', en: 'diverse exposure (H < 0.4)', severity: 'ok' };
  }

  private publishOutputs() {
    const row = this.series[this.series.length - 1] ?? { adopted: 0, corrected: 0, meanOpinion: 0.5, opinionVar: 0, homophily: 0 };
    const reach = row.adopted + row.corrected;
    const verdict = this.echoVerdict();
    const verdictValue = this.zh ? verdict.zh : verdict.en;
    const metrics: ScienceMetric[] = [
      {
        key: 'step',
        label: this.zh ? '级联步' : 'Cascade step',
        value: String(this.step),
        severity: 'info',
        hint: this.zh
          ? `${this.params.model}，${this.params.network}，n=${this.net.n}，⟨k⟩=${this.params.avgDegree}`
          : `${this.params.model}, ${this.params.network}, n=${this.net.n}, mean degree=${this.params.avgDegree}`,
      },
      {
        key: 'adoption',
        label: this.zh ? '采纳比例' : 'Adoption',
        value: fmtMetric(row.adopted),
        severity: 'info',
        hint: this.zh ? '当前处于采纳（谣言传播）状态的节点比例' : 'fraction of nodes currently in the adopted (rumour) state',
      },
      {
        key: 'reach',
        label: this.zh ? '总到达' : 'Reach',
        value: fmtMetric(reach),
        severity: 'info',
        hint: this.zh ? '采纳 + 已核查纠正的节点比例（竞争级联下两部分相加）' : 'adopted + corrected fraction (competing cascades)',
      },
      {
        key: 'homophily',
        label: this.zh ? '同质化指数 H' : 'Homophily H',
        value: fmtMetric(row.homophily),
        severity: 'info',
        hint: this.zh ? '同观点边（|观点差| ≤ 0.15）占全部边的比例' : 'fraction of edges whose endpoints share an opinion (|diff| <= 0.15)',
      },
      {
        key: 'echo-verdict',
        label: this.zh ? '回音室判据' : 'Echo chamber',
        value: verdictValue,
        severity: verdict.severity,
        hint: this.zh ? '过滤气泡判据（改述自相关文献）：H ≥ 0.7 警示' : 'filter-bubble verdict (paraphrased literature): warn when H >= 0.7',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const b = runOpinionBenchmark();
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-status',
        label: 'Benchmark',
        value: b.pass ? (this.zh ? '全部通过' : 'ALL PASS') : this.zh ? '未通过' : 'FAIL',
        severity: b.pass ? 'ok' : 'error',
        hint: this.zh ? '内嵌级联验证组（非用户数据）：cascade-exact-small' : 'embedded cascade validation battery (not user data): cascade-exact-small',
      },
      {
        key: 'bench-chain',
        label: this.zh ? '4 节点链精确结果' : '4-node chain exact',
        value: b.chainExact ? (this.zh ? '一致' : 'exact') : this.zh ? '不一致' : 'mismatch',
        severity: b.chainExact ? 'ok' : 'error',
        hint: this.zh ? '给定逐边概率（含 0 概率断边）的级联结果与手算一致' : 'cascade outcomes match hand computation for given edge probabilities (incl. a zero-probability cut edge)',
      },
      {
        key: 'bench-mean',
        label: this.zh ? '链期望到达误差' : 'Chain mean-reach err',
        value: fmtMetric(b.chainMeanErr),
        severity: b.chainMeanErr <= 0.08 ? 'ok' : 'warn',
        hint: this.zh ? 'p=0.5 链的 |E[reach] − (1+p+p²+p³)|，蒙特卡洛容差 0.08' : '|E[reach] - (1+p+p^2+p^3)| for the p=0.5 chain, Monte Carlo tolerance 0.08',
      },
      {
        key: 'bench-lt',
        label: this.zh ? '阈值不动点' : 'LT fixed point',
        value: b.ltFixedPoint ? (this.zh ? '稳定' : 'stable') : this.zh ? '漂移' : 'unstable',
        severity: b.ltFixedPoint ? 'ok' : 'error',
      },
      {
        key: 'bench-greedy',
        label: this.zh ? '贪心 vs 穷举' : 'Greedy vs exhaustive',
        value: b.greedyMatchesExhaustive ? `${b.greedySpread} = ${b.exhaustiveSpread}` : `${b.greedySpread} != ${b.exhaustiveSpread}`,
        severity: b.greedyMatchesExhaustive ? 'ok' : 'error',
      },
      {
        key: 'bench-homophily',
        label: this.zh ? '同质化指标界' : 'Homophily bounds',
        value: b.homophilyBounds ? (this.zh ? '有界且方向正确' : 'bounded, correct direction') : this.zh ? '越界' : 'out of bounds',
        severity: b.homophilyBounds ? 'ok' : 'error',
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
      `Benchmark ${b.pass ? 'passed' : 'FAILED'}: chain exact, mean err ${b.chainMeanErr.toFixed(4)}, LT fixed point ${b.ltFixedPoint}, greedy ${b.greedySpread}, determinism ${b.deterministic}`,
      `基准验证${b.pass ? '通过' : '未通过'}：链式精确结果、期望误差 ${b.chainMeanErr.toFixed(4)}、阈值不动点 ${b.ltFixedPoint}、贪心 ${b.greedySpread}、确定性 ${b.deterministic}`,
    );
  }

  private exportCsv() {
    const rows: Array<Array<number | string>> = this.series.map((r, i) => [
      i,
      Number(r.adopted.toFixed(6)),
      Number(r.corrected.toFixed(6)),
      Number(r.meanOpinion.toFixed(6)),
      Number(r.opinionVar.toFixed(6)),
      Number(r.homophily.toFixed(6)),
    ]);
    exportRowsCsv(
      this.api,
      'opinion-adoption-series',
      ['step', 'adopted_fraction', 'corrected_fraction', 'mean_opinion', 'opinion_variance', 'homophily_index'],
      rows,
    );
  }

  private async sendToFigure(): Promise<void> {
    const row = this.series[this.series.length - 1] ?? { adopted: 0, corrected: 0, meanOpinion: 0.5, opinionVar: 0, homophily: 0 };
    const modelName = this.zh
      ? ({ 'independent-cascade': '独立级联', 'linear-threshold': '线性阈值', 'competing-cascades': '竞争级联' }[this.params.model] ?? this.params.model)
      : this.params.model;
    const caption: Bilingual = {
      zh: `舆论传播（${modelName}，${this.params.network} 网络，n=${this.net.n}，⟨k⟩=${this.params.avgDegree}，p=${this.params.spreadProb.toFixed(2)}）：第 ${this.step} 步，采纳=${row.adopted.toFixed(4)}，同质化指数=${row.homophily.toFixed(4)}，${this.echoVerdict().zh}。`,
      en: `Opinion diffusion (${modelName}, ${this.params.network} network, n=${this.net.n}, mean degree=${this.params.avgDegree}, p=${this.params.spreadProb.toFixed(2)}): step ${this.step}, adopted=${row.adopted.toFixed(4)}, homophily=${row.homophily.toFixed(4)}, ${this.echoVerdict().en}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '舆论传播模型', en: 'Public Opinion Diffusion' },
      caption,
      opinionFigurePanels({
        adopted: this.series.map((r) => r.adopted),
        corrected: this.series.map((r) => r.corrected),
        meanOpinion: this.series.map((r) => r.meanOpinion),
        homophily: this.series.map((r) => r.homophily),
        opinions: Array.from(this.opinions),
        competing: this.params.model === 'competing-cascades',
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
    const netSize = Math.max(60, Math.min(panelBottom - panelTop, canvas.width * 0.5));
    this.drawNetwork(g, 54, panelTop, netSize);
    this.drawSeriesPanel(g, 54 + netSize + 28, panelTop, canvas.width - (54 + netSize + 28) - 20, panelBottom - panelTop);
    this.drawFooter(g, canvas);
  }

  private drawNetwork(g: CanvasRenderingContext2D, ox: number, oy: number, size: number) {
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '网络状态（灰=未采纳，红=采纳，绿=已核查；金圈=种子）' : 'Network state (grey = susceptible, red = adopted, green = corrected; gold ring = seed)', ox + size / 2, oy - 8);

    const r = this.net.n <= 60 ? 5 : this.net.n <= 120 ? 4 : 3;
    const px = (i: number): number => ox + (this.positions[i]?.x ?? 0.5) * size;
    const py = (i: number): number => oy + (this.positions[i]?.y ?? 0.5) * size;

    g.strokeStyle = EDGE_COLOR;
    g.lineWidth = 1;
    g.beginPath();
    for (const e of this.net.edges) {
      const x1 = px(e.u);
      const y1 = py(e.u);
      const x2 = px(e.v);
      const y2 = py(e.v);
      if (Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)) {
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
      }
    }
    g.stroke();

    for (let i = 0; i < this.net.n; i += 1) {
      const x = px(i);
      const y = py(i);
      const s = this.state[i] ?? SUSCEPTIBLE;
      g.beginPath();
      g.arc(x, y, r, 0, 2 * Math.PI);
      g.fillStyle = s === ADOPTED ? ADOPTED_COLOR : s === CORRECTED ? CORRECTED_COLOR : SUSCEPTIBLE_COLOR;
      g.fill();
    }
    // Initial seeds: solid gold ring; greedy influential seeds: dashed gold ring.
    for (const i of this.seedSet) {
      g.beginPath();
      g.arc(px(i), py(i), r + 2.5, 0, 2 * Math.PI);
      g.strokeStyle = SEED_RING;
      g.lineWidth = 1.6;
      g.stroke();
    }
    if (this.influential) {
      g.setLineDash([3, 2]);
      for (const i of this.influential) {
        g.beginPath();
        g.arc(px(i), py(i), r + 5, 0, 2 * Math.PI);
        g.strokeStyle = SEED_RING;
        g.lineWidth = 1.2;
        g.stroke();
      }
      g.setLineDash([]);
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(ox, oy, size, size);
  }

  private drawSeriesPanel(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number) {
    if (w < 40 || h < 40) return;
    const zh = this.zh;
    const competing = this.params.model === 'competing-cascades';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '采纳曲线与观点均值（每步）' : 'Adoption curves and mean opinion (per step)', ox + w / 2, oy - 8);

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(ox, oy, w, h);
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

    const adopted = this.series.map((r) => r.adopted);
    const corrected = this.series.map((r) => r.corrected);
    const meanOp = this.series.map((r) => r.meanOpinion);
    const n = Math.max(adopted.length, 2);
    const px = (t: number) => ox + (w * t) / (n - 1);
    const py = (v: number) => oy + h - Math.min(1, Math.max(0, v)) * h;
    const line = (values: number[], color: string, dash?: number[]): void => {
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      if (dash) g.setLineDash(dash);
      g.beginPath();
      values.forEach((v, t) => {
        if (t === 0) g.moveTo(px(t), py(v));
        else g.lineTo(px(t), py(v));
      });
      g.stroke();
      if (dash) g.setLineDash([]);
    };
    line(adopted, ADOPT_LINE);
    if (competing) line(corrected, CORRECT_LINE);
    line(meanOp, OPINION_LINE, [4, 2]);

    // Legend (top-right inside the panel).
    const legend: Array<{ color: string; label: string; dash?: number[] }> = [
      { color: ADOPT_LINE, label: zh ? '采纳' : 'adopted' },
    ];
    if (competing) legend.push({ color: CORRECT_LINE, label: zh ? '已核查' : 'corrected' });
    legend.push({ color: OPINION_LINE, label: zh ? '观点均值' : 'mean opinion', dash: [4, 2] });
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    legend.forEach((item, idx) => {
      const ly = oy + 12 + idx * 14;
      g.strokeStyle = item.color;
      g.lineWidth = 2;
      if (item.dash) g.setLineDash(item.dash);
      g.beginPath();
      g.moveTo(ox + w - 96, ly - 3);
      g.lineTo(ox + w - 76, ly - 3);
      g.stroke();
      if (item.dash) g.setLineDash([]);
      g.fillStyle = 'rgba(190,200,215,0.95)';
      g.fillText(item.label, ox + w - 70, ly);
    });

    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('0', ox, oy + h + 13);
    g.fillText(String(adopted.length - 1), ox + w - 16, oy + h + 13);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const row = this.series[this.series.length - 1] ?? { adopted: 0, corrected: 0, meanOpinion: 0.5, opinionVar: 0, homophily: 0 };
    const verdict = this.echoVerdict();
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const factPart = this.params.model === 'competing-cascades' ? `  ${zh ? '核查' : 'fact-checkers'}=${this.factSet.length}(q=${this.params.correctionProb.toFixed(2)})` : '';
    const ltPart = this.params.model === 'linear-threshold' ? `  ${zh ? '阈值' : 'thresholds'}=${this.params.thresholdMode}` : '';
    const l1 = zh
      ? `第 ${this.step} 步  ·  ${this.params.model}  ${this.params.network}  n=${this.net.n}  ⟨k⟩=${this.params.avgDegree}  p=${this.params.spreadProb.toFixed(2)}  同质化重连=${this.params.homophily.toFixed(2)}${this.params.network === 'small-world' ? '(小世界固定 0.15)' : ''}${factPart}${ltPart}`
      : `Step ${this.step}  ·  ${this.params.model}  ${this.params.network}  n=${this.net.n}  mean deg=${this.params.avgDegree}  p=${this.params.spreadProb.toFixed(2)}  homophily rewire=${this.params.homophily.toFixed(2)}${this.params.network === 'small-world' ? ` (WS rewire ${WS_REWIRE_PROB})` : ''}${factPart}${ltPart}`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = zh
      ? `采纳=${row.adopted.toFixed(4)}  已核查=${row.corrected.toFixed(4)}  观点均值=${row.meanOpinion.toFixed(4)}  方差=${row.opinionVar.toFixed(4)}  H=${row.homophily.toFixed(4)}  ·  ${verdict.zh}`
      : `adopted=${row.adopted.toFixed(4)}  corrected=${row.corrected.toFixed(4)}  mean opinion=${row.meanOpinion.toFixed(4)}  var=${row.opinionVar.toFixed(4)}  H=${row.homophily.toFixed(4)}  ·  ${verdict.en}`;
    g.fillText(l2, 54, canvas.height - 14);
  }
}

export default function createOpinionPlugin(): Plugin {
  return new OpinionPlugin();
}
