// ==========================================================================
// math-game — Game Theory Lab
//
// Four canvas modes switched by a select parameter:
//   matrix     — n×n payoff-matrix editing with best-response marks, pure
//                Nash cells, closed-form / enumerated mixed equilibria and
//                iterated strict dominance (kernel.ts does the numerics);
//   replicator — two-population replicator dynamics ẋ_i = x_i(f_i − f̄)
//                integrated with RK4: phase portrait with nullclines plus a
//                component time series, ESS + distance-to-NE diagnostics;
//   tree       — extensive-form game trees solved by backward induction,
//                the subgame-perfect path highlighted on the canvas;
//   auction    — seeded first-price / second-price (VCG) / English-clock
//                simulations with revenue histograms, efficiency and an
//                incentive-compatibility gap.
//
// The science strip reports the current mode's quantitative conclusions;
// the benchmark action publishes the embedded validation suite.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { gameFigurePanels } from './figure';
import { mathGameManifest } from './manifest';
import {
  AUCTION_FORMATS,
  EXAMPLE_TREES,
  SAMPLE_GAMES,
  backwardInduction,
  colBestResponses,
  compareMechanisms,
  eliminateStrictlyDominated,
  essPureStrategies,
  findNash,
  findPureNE,
  formatPayoffText,
  incentiveCompatibilityGap,
  integrateReplicator,
  noDeviationGap,
  parsePayoffText,
  rowBestResponses,
  runGameBenchmarks,
  sampleGameById,
  sampleValuations,
  simulateAuctions,
  treeSampleById,
  type AuctionFormat,
  type GameTreeNode,
  type NormalFormGame,
} from './kernel';

export { mathGameManifest } from './manifest';

/** Palette shared with the other math plugins. */
const C_BLUE = '#6db4ff';
const C_AMBER = '#ffb250';
const C_GREEN = '#4be1c3';
const C_ORANGE = '#f5a623';
const C_RED = '#ff7a7a';

/** Auction valuation domain and English clock tick used everywhere. */
const VAL_MIN = 0;
const VAL_MAX = 10;
const CLOCK_TICK = 0.25;

type Mode = 'matrix' | 'replicator' | 'tree' | 'auction';

interface State {
  mode: Mode;
  /** Selected sample-game id, or 'custom' for hand-edited payoffs. */
  sample: string;
  /** Strategy count of the custom matrix (samples are always 2×2). */
  size: number;
  /** `P1 rows | P2 rows` — rows separated by ';', cells by ','. */
  payoffs: string;
  /** Initial mixture for the replicator run. */
  x0: number;
  y0: number;
  /** RK4 step size and step count of the replicator run. */
  h: number;
  steps: number;
  /** Extensive-form sample id. */
  tree: string;
  /** Highlighted auction format in the stats block. */
  auctionFormat: AuctionFormat;
  bidders: number;
  auctions: number;
  seed: number;
}

const MODE_LABELS: Record<Mode, { zh: string; en: string }> = {
  matrix: { zh: '矩阵纳什均衡', en: 'Matrix Nash Equilibrium' },
  replicator: { zh: '复制者动态相图', en: 'Replicator Dynamics' },
  tree: { zh: '扩展式博弈树', en: 'Extensive-form Game Tree' },
  auction: { zh: '拍卖理论模拟', en: 'Auction Simulation' },
};

const AUCTION_SHORT: Record<AuctionFormat, { zh: string; en: string }> = {
  first: { zh: '一价密封', en: 'First-price' },
  second: { zh: '二价密封 (VCG)', en: 'Second-price (VCG)' },
  english: { zh: '英式钟表', en: 'English clock' },
};

function fmtP(v: number): string {
  return v.toFixed(3);
}

export class MathGamePlugin implements Plugin {
  readonly manifest = mathGameManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    mode: 'matrix',
    sample: SAMPLE_GAMES[0]!.id,
    size: 2,
    payoffs: formatPayoffText(SAMPLE_GAMES[0]!.rowPayoffs, SAMPLE_GAMES[0]!.colPayoffs),
    x0: 0.5,
    y0: 0.5,
    h: 0.01,
    steps: 1500,
    tree: EXAMPLE_TREES[0]!.id,
    auctionFormat: 'second',
    bidders: 4,
    auctions: 300,
    seed: 20260101,
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
    const modeOptions = (Object.keys(MODE_LABELS) as Mode[]).map((id) => ({
      value: id,
      label: this.zh ? MODE_LABELS[id].zh : MODE_LABELS[id].en,
      labelI18n: { 'zh-CN': MODE_LABELS[id].zh, 'en-US': MODE_LABELS[id].en },
    }));
    const sampleOptions = [
      ...SAMPLE_GAMES.map((g) => ({
        value: g.id,
        label: this.zh ? g.labelZh : g.labelEn,
        labelI18n: { 'zh-CN': g.labelZh, 'en-US': g.labelEn },
      })),
      {
        value: 'custom',
        label: this.zh ? '自定义（编辑下方收益文本）' : 'Custom (edit payoff text below)',
        labelI18n: { 'zh-CN': '自定义（编辑下方收益文本）', 'en-US': 'Custom (edit payoff text below)' },
      },
    ];
    const treeOptions = EXAMPLE_TREES.map((t) => ({
      value: t.id,
      label: this.zh ? t.labelZh : t.labelEn,
      labelI18n: { 'zh-CN': t.labelZh, 'en-US': t.labelEn },
    }));
    const auctionOptions = AUCTION_FORMATS.map((f) => ({
      value: f.id,
      label: this.zh ? f.labelZh : f.labelEn,
      labelI18n: { 'zh-CN': f.labelZh, 'en-US': f.labelEn },
    }));
    return [
      {
        key: 'mode',
        label: 'Drawing mode',
        labelI18n: { 'zh-CN': '绘制模式', 'en-US': 'Drawing mode' },
        type: 'select',
        options: modeOptions,
        value: this.state.mode,
      },
      {
        key: 'sample',
        label: 'Sample game',
        labelI18n: { 'zh-CN': '样本博弈', 'en-US': 'Sample game' },
        type: 'select',
        options: sampleOptions,
        value: this.state.sample,
        visibleWhen: { key: 'mode', in: ['matrix', 'replicator'] },
      },
      {
        key: 'size',
        label: 'Matrix size n',
        labelI18n: { 'zh-CN': '矩阵阶数 n', 'en-US': 'Matrix size n' },
        type: 'range',
        min: 2,
        max: 4,
        step: 1,
        value: this.state.size,
        hint: this.zh ? 'n×n 双人收益矩阵（2–4）；修改时自动补齐/裁剪收益文本' : 'n×n two-player payoff matrix (2–4); the payoff text is padded/cropped on change',
        visibleWhen: { key: 'mode', in: ['matrix', 'replicator'] },
      },
      {
        key: 'payoffs',
        label: 'Payoff text',
        labelI18n: { 'zh-CN': '收益矩阵文本', 'en-US': 'Payoff text' },
        type: 'text',
        value: this.state.payoffs,
        placeholder: '3,0;5,1|3,5;0,1',
        hint: this.zh
          ? 'P1 矩阵 | P2 矩阵，行以 ; 分隔、单元格以 , 分隔，例如 3,0;5,1|3,5;0,1'
          : 'P1 table | P2 table, rows split by ";", cells by ",", e.g. 3,0;5,1|3,5;0,1',
        visibleWhen: { key: 'mode', in: ['matrix', 'replicator'] },
      },
      {
        key: 'x0',
        label: 'Initial x (row-1 frequency)',
        labelI18n: { 'zh-CN': '初始 x（行 1 频率）', 'en-US': 'Initial x (row-1 frequency)' },
        type: 'range',
        min: 0.02,
        max: 0.98,
        step: 0.01,
        value: this.state.x0,
        visibleWhen: { key: 'mode', in: ['replicator'] },
      },
      {
        key: 'y0',
        label: 'Initial y (col-1 frequency)',
        labelI18n: { 'zh-CN': '初始 y（列 1 频率）', 'en-US': 'Initial y (col-1 frequency)' },
        type: 'range',
        min: 0.02,
        max: 0.98,
        step: 0.01,
        value: this.state.y0,
        visibleWhen: { key: 'mode', in: ['replicator'] },
      },
      {
        key: 'h',
        label: 'RK4 step h',
        labelI18n: { 'zh-CN': 'RK4 步长 h', 'en-US': 'RK4 step h' },
        type: 'number',
        min: 0.002,
        max: 0.05,
        step: 0.002,
        value: this.state.h,
        visibleWhen: { key: 'mode', in: ['replicator'] },
      },
      {
        key: 'steps',
        label: 'RK4 steps',
        labelI18n: { 'zh-CN': 'RK4 积分步数', 'en-US': 'RK4 steps' },
        type: 'range',
        min: 100,
        max: 4000,
        step: 100,
        value: this.state.steps,
        visibleWhen: { key: 'mode', in: ['replicator'] },
      },
      {
        key: 'tree',
        label: 'Extensive-form sample',
        labelI18n: { 'zh-CN': '扩展式博弈样本', 'en-US': 'Extensive-form sample' },
        type: 'select',
        options: treeOptions,
        value: this.state.tree,
        visibleWhen: { key: 'mode', in: ['tree'] },
      },
      {
        key: 'auctionFormat',
        label: 'Highlighted auction',
        labelI18n: { 'zh-CN': '重点拍卖格式', 'en-US': 'Highlighted auction' },
        type: 'select',
        options: auctionOptions,
        value: this.state.auctionFormat,
        visibleWhen: { key: 'mode', in: ['auction'] },
      },
      {
        key: 'bidders',
        label: 'Bidders per auction',
        labelI18n: { 'zh-CN': '每场竞拍者数', 'en-US': 'Bidders per auction' },
        type: 'range',
        min: 2,
        max: 8,
        step: 1,
        value: this.state.bidders,
        visibleWhen: { key: 'mode', in: ['auction'] },
      },
      {
        key: 'auctions',
        label: 'Auctions to simulate',
        labelI18n: { 'zh-CN': '模拟场次', 'en-US': 'Auctions to simulate' },
        type: 'range',
        min: 50,
        max: 1000,
        step: 50,
        value: this.state.auctions,
        visibleWhen: { key: 'mode', in: ['auction'] },
      },
      {
        key: 'seed',
        label: 'RNG seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'RNG seed' },
        type: 'number',
        min: 0,
        max: 999999,
        step: 1,
        value: this.state.seed,
        hint: this.zh ? 'mulberry32 带种子随机数，同种子结果完全可复现' : 'seeded mulberry32 — identical samples for identical seeds',
        visibleWhen: { key: 'mode', in: ['auction'] },
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    const num = (k: string, cb: (v: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    num('size', (v) => {
      const x = Math.round(Math.min(4, Math.max(2, v)));
      if (x === s.size) return false;
      const parsed = parsePayoffText(s.payoffs, s.size);
      s.size = x;
      if (parsed) {
        const resize = (t: number[][]): number[][] =>
          Array.from({ length: x }, (_, r) => Array.from({ length: x }, (_, c) => t[r]?.[c] ?? 0));
        s.payoffs = formatPayoffText(resize(parsed.rowPayoffs), resize(parsed.colPayoffs));
        s.sample = 'custom';
      }
      return true;
    });
    num('x0', (v) => {
      const x = Math.min(0.98, Math.max(0.02, v));
      if (x === s.x0) return false;
      s.x0 = x;
      return true;
    });
    num('y0', (v) => {
      const x = Math.min(0.98, Math.max(0.02, v));
      if (x === s.y0) return false;
      s.y0 = x;
      return true;
    });
    num('h', (v) => {
      const x = Math.min(0.05, Math.max(0.002, v));
      if (x === s.h) return false;
      s.h = x;
      return true;
    });
    num('steps', (v) => {
      const x = Math.round(Math.min(4000, Math.max(100, v)));
      if (x === s.steps) return false;
      s.steps = x;
      return true;
    });
    num('bidders', (v) => {
      const x = Math.round(Math.min(8, Math.max(2, v)));
      if (x === s.bidders) return false;
      s.bidders = x;
      return true;
    });
    num('auctions', (v) => {
      const x = Math.round(Math.min(1000, Math.max(50, v)));
      if (x === s.auctions) return false;
      s.auctions = x;
      return true;
    });
    num('seed', (v) => {
      const x = Math.round(Math.min(999999, Math.max(0, v)));
      if (x === s.seed) return false;
      s.seed = x;
      return true;
    });
    if (typeof params.mode === 'string' && params.mode !== s.mode) {
      s.mode = params.mode as Mode;
      this.draw();
    }
    if (typeof params.tree === 'string' && params.tree !== s.tree) {
      s.tree = params.tree;
      this.draw();
    }
    if (typeof params.auctionFormat === 'string' && params.auctionFormat !== s.auctionFormat) {
      s.auctionFormat = params.auctionFormat as AuctionFormat;
      this.draw();
    }
    if (typeof params.sample === 'string' && params.sample !== s.sample) {
      s.sample = params.sample;
      const sample = sampleGameById(params.sample);
      if (sample) {
        s.payoffs = formatPayoffText(sample.rowPayoffs, sample.colPayoffs);
        s.size = 2;
      }
      this.draw();
    }
    if (typeof params.payoffs === 'string' && params.payoffs !== s.payoffs) {
      s.payoffs = params.payoffs;
      s.sample = 'custom';
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- actions ---------------------------------------------------------------

  /** Run the embedded validation suite and publish one metric per benchmark. */
  private runBenchmark() {
    const bench = runGameBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: this.zh ? b.detailZh : b.detailEn,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} game-theory benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项博弈论基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  /** Build replicator + auction panels and push them into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    const cur = this.currentGame();
    if (!cur.game) {
      notify(
        this.api,
        'warning',
        'Cannot parse the payoff text — fix it first.',
        '收益矩阵文本无法解析——请先修正。',
      );
      return;
    }
    const pure = findPureNE(cur.game);
    const mixed = findNash(cur.game).filter((e) => e.kind === 'mixed');
    const { sims } = this.auctionData();
    const caption: Bilingual = {
      zh: `博弈论实验室（${cur.name}）：纯策略均衡 ${pure.length} 个、混合均衡 ${mixed.length} 个；复制者动态自 (x, y) = (${this.state.x0}, ${this.state.y0})，RK4 h = ${this.state.h}、T = ${(this.state.h * this.state.steps).toFixed(2)}；拍卖抽样 seed = ${this.state.seed}，${this.state.bidders} 位竞拍者 × ${this.state.auctions} 场，均值收益一价 ${fmtMetric(sims.first.meanRevenue)}、二价 (VCG) ${fmtMetric(sims.second.meanRevenue)}、英式 ${fmtMetric(sims.english.meanRevenue)}。`,
      en: `Game Theory Lab (${cur.name}): ${pure.length} pure / ${mixed.length} mixed Nash equilibria; replicator run from (x, y) = (${this.state.x0}, ${this.state.y0}) with RK4 h = ${this.state.h}, T = ${(this.state.h * this.state.steps).toFixed(2)}; auction sample seed = ${this.state.seed}, ${this.state.bidders} bidders × ${this.state.auctions} rounds, mean revenue first ${fmtMetric(sims.first.meanRevenue)}, second (VCG) ${fmtMetric(sims.second.meanRevenue)}, English ${fmtMetric(sims.english.meanRevenue)}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '博弈论实验室', en: 'Game Theory Lab' },
      caption,
      gameFigurePanels({
        game: cur.game,
        replicator: { x0: this.state.x0, y0: this.state.y0, h: this.state.h, steps: this.state.steps },
        auction: { first: sims.first.revenues, second: sims.second.revenues, english: sims.english.revenues },
      }),
    );
  }

  // ---- shared helpers ----------------------------------------------------------

  private currentGame(): { game: NormalFormGame | null; error: string | null; name: string } {
    const sample = sampleGameById(this.state.sample);
    if (sample) {
      return {
        game: {
          rowPayoffs: sample.rowPayoffs,
          colPayoffs: sample.colPayoffs,
          rowLabels: this.zh ? sample.rowLabelsZh : sample.rowLabelsEn,
          colLabels: this.zh ? sample.colLabelsZh : sample.colLabelsEn,
        },
        error: null,
        name: this.zh ? sample.labelZh : sample.labelEn,
      };
    }
    const parsed = parsePayoffText(this.state.payoffs, this.state.size);
    if (!parsed) {
      return {
        game: null,
        error: this.zh
          ? `需 ${this.state.size}×${this.state.size} 个数，以 ; 分行、| 分隔两名玩家`
          : `expected ${this.state.size}×${this.state.size} numbers, rows by ";", players by "|"`,
        name: this.zh ? '自定义博弈' : 'Custom game',
      };
    }
    const m = parsed.rowPayoffs.length;
    const n = parsed.rowPayoffs[0]?.length ?? 0;
    return {
      game: {
        rowPayoffs: parsed.rowPayoffs,
        colPayoffs: parsed.colPayoffs,
        rowLabels: Array.from({ length: m }, (_, i) => (this.zh ? `行${i + 1}` : `Row ${i + 1}`)),
        colLabels: Array.from({ length: n }, (_, j) => (this.zh ? `列${j + 1}` : `Col ${j + 1}`)),
      },
      error: null,
      name: this.zh ? '自定义博弈' : 'Custom game',
    };
  }

  private labelsOf(game: NormalFormGame): { row: string[]; col: string[] } {
    const m = game.rowPayoffs.length;
    const n = game.rowPayoffs[0]?.length ?? 0;
    return {
      row: game.rowLabels ?? Array.from({ length: m }, (_, i) => (this.zh ? `行${i + 1}` : `Row ${i + 1}`)),
      col: game.colLabels ?? Array.from({ length: n }, (_, j) => (this.zh ? `列${j + 1}` : `Col ${j + 1}`)),
    };
  }

  /** `(Row, Col)` text of a pure equilibrium. */
  private profileText(game: NormalFormGame, eq: { row: number[]; col: number[] }): string {
    const labels = this.labelsOf(game);
    let bi = 0;
    let bj = 0;
    eq.row.forEach((v, i) => {
      if (v > eq.row[bi]!) bi = i;
    });
    eq.col.forEach((v, j) => {
      if (v > eq.col[bj]!) bj = j;
    });
    return `(${labels.row[bi] ?? '?'}, ${labels.col[bj] ?? '?'})`;
  }

  private auctionData() {
    const valuations = sampleValuations({
      nBidders: this.state.bidders,
      nAuctions: this.state.auctions,
      min: VAL_MIN,
      max: VAL_MAX,
      seed: this.state.seed,
    });
    const sims = simulateAuctions(valuations, ['first', 'second', 'english'], CLOCK_TICK);
    const comparison = compareMechanisms(valuations);
    const icSample = valuations.slice(0, Math.min(200, valuations.length));
    let icGap = 0;
    for (const vals of icSample) icGap = Math.max(icGap, incentiveCompatibilityGap(vals));
    return { valuations, sims, comparison, icGap };
  }

  private frame(g: CanvasRenderingContext2D, W: number, H: number, title: string, zhFooter: string, enFooter: string) {
    g.font = `13px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(240,244,250,0.92)';
    g.fillText(title, W / 2, 18);
    g.font = `11px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(zhFooter, 24, H - 24);
    g.fillText(enFooter, 24, H - 9);
  }

  // ---- mode: payoff matrix --------------------------------------------------------

  private drawMatrix(g: CanvasRenderingContext2D, W: number, H: number, game: NormalFormGame, name: string) {
    const zh = this.zh;
    const m = game.rowPayoffs.length;
    const n = game.rowPayoffs[0]?.length ?? 0;
    const labels = this.labelsOf(game);
    const pure = findPureNE(game);
    const nash = findNash(game);
    const mixed = nash.filter((e) => e.kind === 'mixed');
    const dom = eliminateStrictlyDominated(game);

    // Best-response flags per cell.
    const rowBR: boolean[][] = Array.from({ length: m }, () => new Array<boolean>(n).fill(false));
    const colBR: boolean[][] = Array.from({ length: m }, () => new Array<boolean>(n).fill(false));
    for (let j = 0; j < n; j += 1) for (const i of rowBestResponses(game, labels.col.map((_, k) => (k === j ? 1 : 0)))) rowBR[i]![j] = true;
    for (let i = 0; i < m; i += 1) for (const j of colBestResponses(game, labels.row.map((_, k) => (k === i ? 1 : 0)))) colBR[i]![j] = true;
    const isNE = (i: number, j: number): boolean => pure.some((e) => e.row[i] === 1 && e.col[j] === 1);

    // Geometry: header band + grid + summary lines.
    const top = 40;
    const labelW = 76;
    const labelH = 30;
    const ox = 40 + labelW;
    const oy = top + labelH;
    const cw = Math.min((W - ox - 40) / n, (H - 120 - oy) / m);
    const gridH = cw * m;

    // Column headers.
    g.font = `bold 12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(235,240,247,0.95)';
    for (let j = 0; j < n; j += 1) {
      g.fillText(labels.col[j] ?? `C${j + 1}`, ox + j * cw + cw / 2, oy - 10);
    }
    // Row labels.
    g.textAlign = 'right';
    for (let i = 0; i < m; i += 1) {
      g.fillText(labels.row[i] ?? `R${i + 1}`, ox - 12, oy + i * cw + cw / 2 + 4);
    }

    // Cells.
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const cx = ox + j * cw;
        const cy = oy + i * cw;
        const ne = isNE(i, j);
        g.fillStyle = ne ? 'rgba(75,225,195,0.10)' : 'rgba(255,255,255,0.02)';
        g.fillRect(cx, cy, cw, cw);
        g.strokeStyle = ne ? C_GREEN : 'rgba(200,210,225,0.30)';
        g.lineWidth = ne ? 2 : 1;
        g.strokeRect(cx + 0.5, cy + 0.5, cw - 1, cw - 1);

        const u1 = game.rowPayoffs[i]![j]!;
        const u2 = game.colPayoffs[i]![j]!;
        const small = cw < 56;
        const font = `${small ? 10 : 12}px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
        // Row player payoff (top-left), bold when it is a best response to column j.
        g.textAlign = 'left';
        g.font = rowBR[i]![j] ? `bold ${font}` : font;
        g.fillStyle = rowBR[i]![j] ? C_GREEN : C_BLUE;
        g.fillText(fmtMetric(u1), cx + 6, cy + (small ? 13 : 17));
        // Column player payoff (bottom-right), bold when best responding to row i.
        g.textAlign = 'right';
        g.font = colBR[i]![j] ? `bold ${font}` : font;
        g.fillStyle = colBR[i]![j] ? C_GREEN : C_AMBER;
        g.fillText(fmtMetric(u2), cx + cw - 6, cy + cw - (small ? 5 : 8));
        if (ne) {
          g.font = `bold ${small ? 9 : 10}px Consolas, monospace`;
          g.fillStyle = C_GREEN;
          g.fillText('NE', cx + cw - 6, cy + (small ? 12 : 15));
        }
      }
    }

    // Summary lines below the grid.
    let sy = oy + gridH + 22;
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(235,240,247,0.92)';
    const pureTxt = pure.length
      ? pure
          .slice(0, 4)
          .map((e) => `${this.profileText(game, e)} → (${fmtMetric(e.u1)}, ${fmtMetric(e.u2)})`)
          .join('   ')
      : zh
        ? '无'
        : 'none';
    g.fillText(`${zh ? '纯策略均衡' : 'Pure NE'} (${pure.length}): ${pureTxt}`, 40, sy);
    sy += 18;
    const mixedTxt = mixed.length
      ? mixed
          .slice(0, 3)
          .map(
            (e) =>
              `p=(${e.row.map(fmtP).join(', ')}) q=(${e.col.map(fmtP).join(', ')}) → (${fmtMetric(e.u1)}, ${fmtMetric(e.u2)})`,
          )
          .join('   ')
      : zh
        ? '无'
        : 'none';
    g.fillStyle = 'rgba(235,240,247,0.92)';
    g.fillText(`${zh ? '混合策略均衡' : 'Mixed NE'} (${mixed.length}): ${mixedTxt}`, 40, sy);
    sy += 18;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const rowDom = dom.rows.map((i) => labels.row[i] ?? `R${i + 1}`).join(', ');
    const colDom = dom.cols.map((j) => labels.col[j] ?? `C${j + 1}`).join(', ');
    g.fillText(
      zh
        ? `优势剔除存活：行 [${rowDom}]  列 [${colDom}]`
        : `Surviving strict dominance: rows [${rowDom}]  cols [${colDom}]`,
      40,
      sy,
    );

    this.frame(
      g,
      W,
      H,
      `${name} · ${MODE_LABELS.matrix.zh} · ${MODE_LABELS.matrix.en}`,
      zh
        ? `蓝=P1 收益  橙=P2 收益  加粗绿=最佳响应  绿框=纯纳什  ${m}×${n} 矩阵`
        : `blue = P1 payoff, amber = P2 payoff, bold green = best response, green box = pure Nash cell, ${m}×${n} matrix`,
      `pure NE = ${pure.length}, mixed NE = ${mixed.length} (support enumeration); solve: mutual best responses + indifference`,
    );

    // Science outputs.
    const metrics: ScienceMetric[] = [
      {
        key: 'pure-ne',
        label: zh ? '纯策略均衡数' : 'Pure NE count',
        value: String(pure.length),
        severity: pure.length > 0 ? 'ok' : 'info',
        hint: zh ? '按相互最佳响应枚举全部单元格' : 'enumerated over all cells via mutual best responses',
      },
    ];
    pure.slice(0, 3).forEach((e, k) => {
      metrics.push({
        key: `pure-${k}`,
        label: zh ? `纯均衡 #${k + 1}` : `Pure NE #${k + 1}`,
        value: `${this.profileText(game, e)} → (${fmtMetric(e.u1)}, ${fmtMetric(e.u2)})`,
        severity: 'ok',
        hint: zh ? '偏离无利可图（纳什无偏离条件）' : 'no profitable unilateral deviation (Nash no-deviation condition)',
      });
    });
    mixed.slice(0, 2).forEach((e, k) => {
      metrics.push({
        key: `mixed-${k}`,
        label: zh ? `混合均衡 #${k + 1}` : `Mixed NE #${k + 1}`,
        value: `p=(${e.row.map(fmtP).join(', ')}) q=(${e.col.map(fmtP).join(', ')})`,
        severity: 'ok',
        hint: zh
          ? `期望收益 (${fmtMetric(e.u1)}, ${fmtMetric(e.u2)})，无偏离间隙 ${noDeviationGap(game, e).toExponential(2)}`
          : `expected payoffs (${fmtMetric(e.u1)}, ${fmtMetric(e.u2)}), no-deviation gap ${noDeviationGap(game, e).toExponential(2)}`,
      });
    });
    metrics.push({
      key: 'dominance',
      label: zh ? '优势策略存活' : 'Surviving dominance',
      value: zh ? `行[${rowDom}] 列[${colDom}]` : `rows[${rowDom}] cols[${colDom}]`,
      severity: 'info',
      hint: zh ? '迭代剔除严格（纯）优势策略后的剩余策略集' : 'remaining strategies after iterated elimination of strictly dominated ones',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- mode: replicator dynamics ----------------------------------------------------

  private drawReplicator(g: CanvasRenderingContext2D, W: number, H: number, game: NormalFormGame, name: string) {
    const zh = this.zh;
    const m = game.rowPayoffs.length;
    const n = game.rowPayoffs[0]?.length ?? 0;
    if (m !== 2 || n !== 2) {
      setScienceOutputs(this.manifest.id, [
        {
          key: 'replicator',
          label: zh ? '复制者动态' : 'Replicator dynamics',
          value: zh ? '需要 2×2 博弈' : '2×2 game required',
          severity: 'warn',
          hint: zh ? '相图与轨迹仅针对 2×2 正规型博弈绘制' : 'the phase portrait is drawn for 2×2 normal-form games only',
        },
      ]);
      this.frame(
        g,
        W,
        H,
        `${name} · ${MODE_LABELS.replicator.zh} · ${MODE_LABELS.replicator.en}`,
        zh ? '复制者动态相图仅支持 2×2 收益矩阵（将矩阵阶数调回 2）' : 'the replicator phase portrait supports 2×2 payoff matrices only (set matrix size back to 2)',
        'two-population replicator: dx_i = x_i (f_i - fbar), integrated with RK4',
      );
      return;
    }

    const nash = findNash(game);
    const ess = essPureStrategies(game);
    const A = game.rowPayoffs;
    const B = game.colPayoffs;

    // ---- left: phase portrait on the unit square -------------------------------
    const sq = Math.min(H - 110, W * 0.42);
    const ox = 52;
    const oy = 44;
    const px = (x: number) => ox + x * sq;
    const py = (y: number) => oy + (1 - y) * sq;

    g.strokeStyle = 'rgba(200,210,225,0.35)';
    g.lineWidth = 1;
    g.strokeRect(px(0) + 0.5, py(1) + 0.5, sq - 1, sq - 1);
    g.font = `10px Consolas, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.textAlign = 'center';
    for (const t of [0, 0.5, 1]) {
      g.fillText(String(t), px(t), py(0) + 16);
      g.textAlign = 'right';
      g.fillText(String(t), ox - 8, py(t) + 3);
      g.textAlign = 'center';
    }
    g.fillText('x', px(0.5), py(0) + 30);
    g.textAlign = 'left';
    g.fillText('y', ox - 20, py(1) + 4);

    // Nullclines: ẋ = 0 horizontal, ẏ = 0 vertical.
    const yStar = (() => {
      const den = A[0]![0]! - A[1]![0]! - (A[0]![1]! - A[1]![1]!);
      return Math.abs(den) < 1e-12 ? NaN : (A[1]![1]! - A[0]![1]!) / den;
    })();
    const xStar = (() => {
      const den = B[0]![0]! - B[0]![1]! - (B[1]![0]! - B[1]![1]!);
      return Math.abs(den) < 1e-12 ? NaN : (B[1]![1]! - B[1]![0]!) / den;
    })();
    g.setLineDash([5, 4]);
    g.lineWidth = 1.4;
    if (Number.isFinite(yStar) && yStar >= 0 && yStar <= 1) {
      g.strokeStyle = C_ORANGE;
      g.beginPath();
      g.moveTo(px(0), py(yStar));
      g.lineTo(px(1), py(yStar));
      g.stroke();
    }
    if (Number.isFinite(xStar) && xStar >= 0 && xStar <= 1) {
      g.strokeStyle = C_RED;
      g.beginPath();
      g.moveTo(px(xStar), py(0));
      g.lineTo(px(xStar), py(1));
      g.stroke();
    }
    g.setLineDash([]);

    // Trajectories from corner/edge seeds.
    const seeds: Array<[number, number]> = [
      [0.1, 0.1],
      [0.1, 0.9],
      [0.5, 0.1],
      [0.5, 0.9],
      [0.9, 0.1],
      [0.9, 0.9],
    ];
    g.lineWidth = 1.5;
    g.globalAlpha = 0.9;
    for (let k = 0; k < seeds.length; k += 1) {
      const [sx, sy] = seeds[k]!;
      const traj = integrateReplicator(game, [sx, 1 - sx], [sy, 1 - sy], this.state.h, this.state.steps);
      if (traj.length < 2) continue;
      g.strokeStyle = k % 2 === 0 ? C_BLUE : '#b48cff';
      g.beginPath();
      traj.forEach((p, idx) => {
        const X = px(p.x[0]!);
        const Y = py(p.y[0]!);
        if (idx === 0) g.moveTo(X, Y);
        else g.lineTo(X, Y);
      });
      g.stroke();
    }
    g.globalAlpha = 1;

    // Equilibria markers: green circle = pure, amber diamond = mixed.
    for (const eq of nash) {
      const X = px(eq.row[0]!);
      const Y = py(eq.col[0]!);
      g.lineWidth = 2;
      if (eq.kind === 'pure') {
        g.strokeStyle = C_GREEN;
        g.fillStyle = 'rgba(75,225,195,0.25)';
        g.beginPath();
        g.arc(X, Y, 6, 0, 2 * Math.PI);
        g.fill();
        g.stroke();
      } else {
        g.strokeStyle = C_AMBER;
        g.fillStyle = 'rgba(255,178,80,0.25)';
        g.beginPath();
        g.moveTo(X, Y - 7);
        g.lineTo(X + 7, Y);
        g.lineTo(X, Y + 7);
        g.lineTo(X - 7, Y);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }

    // ---- right: component time series --------------------------------------------
    const rx = ox + sq + 64;
    const rw = Math.max(90, W - rx - 30);
    const ry = 56;
    const rh = H - ry - 76;
    const T = Math.max(this.state.h, (this.state.steps + 1) * this.state.h);
    const tx = (t: number) => rx + (t / T) * rw;
    const ty = (v: number) => ry + (1 - v) * rh;
    g.strokeStyle = 'rgba(200,210,225,0.35)';
    g.lineWidth = 1;
    g.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    g.font = `10px Consolas, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.textAlign = 'right';
    for (const t of [0, 0.5, 1]) g.fillText(String(t), rx - 6, ty(t) + 3);
    g.textAlign = 'center';
    g.fillText('t', rx + rw / 2, ry + rh + 16);
    g.fillText(`T = ${T.toFixed(1)}`, rx + rw, ry + rh + 16);

    const run = integrateReplicator(
      game,
      [this.state.x0, 1 - this.state.x0],
      [this.state.y0, 1 - this.state.y0],
      this.state.h,
      this.state.steps,
    );
    g.lineWidth = 1.8;
    g.strokeStyle = C_BLUE;
    g.beginPath();
    run.forEach((p, idx) => {
      const X = tx(p.t);
      const Y = ty(p.x[0]!);
      if (idx === 0) g.moveTo(X, Y);
      else g.lineTo(X, Y);
    });
    g.stroke();
    g.strokeStyle = C_AMBER;
    g.beginPath();
    run.forEach((p, idx) => {
      const X = tx(p.t);
      const Y = ty(p.y[0]!);
      if (idx === 0) g.moveTo(X, Y);
      else g.lineTo(X, Y);
    });
    g.stroke();

    const last = run[run.length - 1]!;
    let nearest = Infinity;
    for (const eq of nash) {
      nearest = Math.min(nearest, Math.abs(eq.row[0]! - last.x[0]!) + Math.abs(eq.col[0]! - last.y[0]!));
    }
    const essTxt = ess.length
      ? ess.map((i) => (this.labelsOf(game).row[i] ?? `R${i + 1}`)).join(', ')
      : zh
        ? '无纯 ESS（内部混合 ESS）'
        : 'no pure ESS (interior mixed ESS)';

    this.frame(
      g,
      W,
      H,
      `${name} · ${MODE_LABELS.replicator.zh} · ${MODE_LABELS.replicator.en}`,
      zh
        ? `ẋ_i = x_i(f_i − f̄)  初始 (${this.state.x0}, ${this.state.y0})  h=${this.state.h}  T=${T.toFixed(1)}  终点 (${fmtP(last.x[0]!)}, ${fmtP(last.y[0]!)})`
        : `ẋ_i = x_i (f_i - f̄), start (${this.state.x0}, ${this.state.y0}), h = ${this.state.h}, T = ${T.toFixed(1)}, end (${fmtP(last.x[0]!)}, ${fmtP(last.y[0]!)})`,
      `blue/amber = x(t), y(t); orange dashed = ẋ = 0 nullcline, red dashed = ẏ = 0; circle = pure NE, diamond = mixed NE`,
    );

    setScienceOutputs(this.manifest.id, [
      {
        key: 'rep-final',
        label: zh ? '复制者动态终点' : 'Replicator endpoint',
        value: `(${fmtP(last.x[0]!)}, ${fmtP(last.y[0]!)})`,
        severity: 'ok',
        hint: zh ? `RK4 h = ${this.state.h}，T = ${T.toFixed(2)}，初值 (${this.state.x0}, ${this.state.y0})` : `RK4 h = ${this.state.h}, T = ${T.toFixed(2)}, start (${this.state.x0}, ${this.state.y0})`,
      },
      {
        key: 'rep-dist',
        label: zh ? '到最近均衡的 L1 距离' : 'L1 distance to nearest NE',
        value: Number.isFinite(nearest) ? fmtMetric(nearest) : '—',
        severity: Number.isFinite(nearest) && nearest < 1e-3 ? 'ok' : 'info',
        hint: zh ? '轨迹终点到各纳什均衡策略剖面的最小 L1 距离' : 'smallest L1 distance from the endpoint to any Nash profile',
      },
      {
        key: 'rep-ess',
        label: zh ? '演化稳定策略 (ESS)' : 'Evolutionarily stable strategy',
        value: essTxt,
        severity: ess.length > 0 ? 'ok' : 'info',
        hint: zh
          ? 'Maynard Smith 判据：对自身严格最优，或打平且对抗对方更优'
          : 'Maynard Smith criterion: strict best reply to itself, or ties and beats the rival against it',
      },
    ]);
  }

  // ---- mode: extensive-form tree ------------------------------------------------------

  private drawTree(g: CanvasRenderingContext2D, W: number, H: number) {
    const zh = this.zh;
    const sample = treeSampleById(this.state.tree) ?? EXAMPLE_TREES[0]!;
    const result = backwardInduction(sample.root);

    // Layout: leaves get consecutive slots, internal nodes centre on children.
    interface Placed {
      node: GameTreeNode;
      u: number;
      depth: number;
    }
    const placed = new Map<GameTreeNode, Placed>();
    let leafSlot = 0;
    let maxDepth = 0;
    const walk = (node: GameTreeNode, depth: number): number => {
      maxDepth = Math.max(maxDepth, depth);
      const kids = node.children ?? [];
      let u: number;
      if (kids.length === 0) {
        u = leafSlot;
        leafSlot += 1;
      } else {
        const xs = kids.map((e) => walk(e.child, depth + 1));
        u = (Math.min(...xs) + Math.max(...xs)) / 2;
      }
      placed.set(node, { node, u, depth });
      return u;
    };
    walk(sample.root, 0);
    const leaves = leafSlot;
    const xOf = (u: number) => (leaves > 1 ? 90 + (u * (W - 180)) / (leaves - 1) : W / 2);
    const top = 56;
    const bottom = H - 56;
    const yOf = (d: number) => (maxDepth > 0 ? top + (d * (bottom - top)) / maxDepth : (top + bottom) / 2);

    // Map chosen child indices by node id (path-independent).
    const chosenById = new Map<string, number>();
    for (const c of result.chosen) chosenById.set(c.nodeId, c.childIndex);
    const onPath = new Set(result.pathNodeIds);

    const drawEdge = (from: GameTreeNode, edge: { labelEn: string; labelZh: string; child: GameTreeNode }, idx: number) => {
      const a = placed.get(from)!;
      const b = placed.get(edge.child)!;
      const x1 = xOf(a.u);
      const y1 = yOf(a.depth);
      const x2 = xOf(b.u);
      const y2 = yOf(b.depth);
      const isChosen = chosenById.get(from.id) === idx;
      g.strokeStyle = isChosen ? C_AMBER : 'rgba(150,165,190,0.55)';
      g.lineWidth = isChosen ? 2.5 : 1.2;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      const mx = x1 + (x2 - x1) * 0.5;
      const my = y1 + (y2 - y1) * 0.5 - 6;
      g.font = `${isChosen ? 'bold ' : ''}${isChosen ? 11 : 10}px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillStyle = isChosen ? C_AMBER : 'rgba(170,182,200,0.85)';
      g.textAlign = 'center';
      g.fillText(zh ? edge.labelZh : edge.labelEn, mx, my);
    };

    for (const [node, info] of placed) {
      const kids = node.children ?? [];
      kids.forEach((edge, idx) => drawEdge(node, edge, idx));
      const x = xOf(info.u);
      const y = yOf(info.depth);
      const chosen = onPath.has(node.id);
      if (kids.length === 0) {
        // Terminal: green dot + payoff pair.
        g.fillStyle = C_GREEN;
        g.beginPath();
        g.arc(x, y, 5, 0, 2 * Math.PI);
        g.fill();
        const u = node.payoff ?? [0, 0];
        g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
        g.fillStyle = chosen ? C_AMBER : 'rgba(235,240,247,0.92)';
        g.textAlign = 'left';
        g.fillText(`(${fmtMetric(u[0])}, ${fmtMetric(u[1])})`, x + 12, y + 4);
      } else {
        // Decision node: player disc.
        g.fillStyle = chosen ? 'rgba(255,178,80,0.18)' : 'rgba(8,12,17,0.95)';
        g.strokeStyle = chosen ? C_AMBER : C_BLUE;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 14, 0, 2 * Math.PI);
        g.fill();
        g.stroke();
        g.font = `bold 10px Consolas, monospace`;
        g.fillStyle = chosen ? C_AMBER : C_BLUE;
        g.textAlign = 'center';
        g.fillText(`P${(node.player ?? 0) + 1}`, x, y + 3);
      }
    }

    const zhPath = result.path.length
      ? `${result.path.map((e) => e.labelZh).join(' → ')} → (${fmtMetric(result.payoffs[0])}, ${fmtMetric(result.payoffs[1])})`
      : zh
        ? '（空树）'
        : '(empty tree)';
    const enPath = result.path.length
      ? `${result.path.map((e) => e.labelEn).join(' → ')} → (${fmtMetric(result.payoffs[0])}, ${fmtMetric(result.payoffs[1])})`
      : '(empty tree)';
    this.frame(
      g,
      W,
      H,
      `${zh ? sample.labelZh : sample.labelEn} · ${MODE_LABELS.tree.zh} · ${MODE_LABELS.tree.en}`,
      zh ? `子博弈精炼均衡（逆向归纳）：${zhPath}` : `Subgame-perfect equilibrium (backward induction): ${enPath}`,
      `subgame-perfect path: ${enPath}; amber = solution path, blue = decision nodes (P1/P2), green = terminals`,
    );

    setScienceOutputs(this.manifest.id, [
      {
        key: 'tree-path',
        label: zh ? '子博弈精炼路径' : 'Subgame-perfect path',
        value: zhPath,
        severity: 'ok',
        hint: zh ? '自终端节点逆向求解，每个子博弈取最优动作' : 'solved from the terminals backwards, best action in every subgame',
      },
      {
        key: 'tree-payoff',
        label: zh ? '均衡收益 (P1, P2)' : 'Equilibrium payoffs (P1, P2)',
        value: `(${fmtMetric(result.payoffs[0])}, ${fmtMetric(result.payoffs[1])})`,
        severity: 'ok',
        hint: zh
          ? `路径包含 ${result.chosen.length} 个决策节点，均无可单方偏离增益`
          : `${result.chosen.length} decision nodes on the path, each with no profitable deviation`,
      },
    ]);
  }

  // ---- mode: auctions --------------------------------------------------------------------

  private drawAuction(g: CanvasRenderingContext2D, W: number, H: number) {
    const zh = this.zh;
    const { sims, comparison, icGap } = this.auctionData();
    const formats: AuctionFormat[] = ['first', 'second', 'english'];
    const colors: Record<AuctionFormat, string> = { first: C_BLUE, second: C_AMBER, english: C_GREEN };

    const all = formats.flatMap((f) => sims[f].revenues);
    const lo = all.length ? Math.min(...all) : 0;
    const hi = all.length ? Math.max(...all) : 1;
    const span = hi - lo > 1e-12 ? hi - lo : 1;
    const bins = 12;

    // ---- histogram (left) ---------------------------------------------------------
    const ax = 56;
    const ay = 52;
    const aw = Math.max(160, W * 0.52 - ax);
    const ah = H - ay - 66;
    const counts: Record<AuctionFormat, number[]> = {
      first: new Array<number>(bins).fill(0),
      second: new Array<number>(bins).fill(0),
      english: new Array<number>(bins).fill(0),
    };
    for (const f of formats) {
      for (const v of sims[f].revenues) {
        const idx = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / span) * bins)));
        counts[f][idx] = (counts[f][idx] ?? 0) + 1;
      }
    }
    const maxCount = Math.max(1, ...formats.flatMap((f) => counts[f]));
    g.strokeStyle = 'rgba(200,210,225,0.35)';
    g.lineWidth = 1;
    g.strokeRect(ax + 0.5, ay + 0.5, aw, ah);
    const binW = aw / bins;
    const barW = (binW - 4) / formats.length;
    for (let b = 0; b < bins; b += 1) {
      formats.forEach((f, k) => {
        const c = counts[f][b]!;
        const h = (c / maxCount) * (ah - 4);
        g.fillStyle = colors[f];
        g.globalAlpha = this.state.auctionFormat === f ? 0.95 : 0.6;
        g.fillRect(ax + b * binW + 2 + k * barW, ay + ah - h, Math.max(1, barW - 1), h);
      });
    }
    g.globalAlpha = 1;
    g.font = `10px Consolas, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.textAlign = 'center';
    for (const t of [0, 0.5, 1]) {
      const v = lo + t * span;
      g.fillText(fmtMetric(v), ax + t * aw, ay + ah + 15);
    }
    g.fillText(zh ? '单场收益' : 'revenue per auction', ax + aw / 2, ay + ah + 32);
    g.textAlign = 'left';
    g.fillText(String(maxCount), ax + 4, ay + 12);
    // Legend.
    formats.forEach((f, k) => {
      const lx = ax + k * (aw / 3);
      g.fillStyle = colors[f];
      g.fillRect(lx, ay - 16, 10, 10);
      g.fillStyle = 'rgba(235,240,247,0.92)';
      g.textAlign = 'left';
      g.fillText(zh ? AUCTION_SHORT[f].zh : AUCTION_SHORT[f].en, lx + 14, ay - 7);
    });

    // ---- stats block (right) --------------------------------------------------------
    const sx = ax + aw + 34;
    const stats: Array<{ text: string; color: string }> = [];
    for (const f of formats) {
      const s = sims[f];
      const active = this.state.auctionFormat === f;
      stats.push({
        text: `${zh ? AUCTION_SHORT[f].zh : AUCTION_SHORT[f].en}: μ=${fmtMetric(s.meanRevenue)} [${fmtMetric(s.minRevenue)}, ${fmtMetric(s.maxRevenue)}] eff=${(s.efficiency * 100).toFixed(0)}%`,
        color: active ? C_ORANGE : 'rgba(235,240,247,0.92)',
      });
    }
    stats.push({
      text: zh
        ? `一价 − VCG 收益差: ${fmtMetric(comparison.revenueGap)}`
        : `first-price − VCG gap: ${fmtMetric(comparison.revenueGap)}`,
      color: 'rgba(235,240,247,0.92)',
    });
    stats.push({
      text: zh ? `激励相容间隙 (IC): ${fmtMetric(icGap)}` : `incentive-compatibility gap: ${fmtMetric(icGap)}`,
      color: icGap < 1e-9 ? C_GREEN : C_RED,
    });
    stats.push({
      text: zh
        ? `配置效率: 赢家=最高估值者`
        : `allocation: winner = highest-value bidder`,
      color: 'rgba(170,182,200,0.95)',
    });
    stats.forEach((line, k) => {
      g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillStyle = line.color;
      g.textAlign = 'left';
      g.fillText(line.text, sx, ay + 14 + k * 20);
    });

    this.frame(
      g,
      W,
      H,
      `${MODE_LABELS.auction.zh} · ${MODE_LABELS.auction.en}`,
      zh
        ? `带种子 mulberry32：seed=${this.state.seed}  ${this.state.bidders} 位竞拍者 × ${this.state.auctions} 场  估值 ~ U[${VAL_MIN}, ${VAL_MAX}]  时钟步长 ${CLOCK_TICK}`
        : `seeded mulberry32: seed = ${this.state.seed}, ${this.state.bidders} bidders × ${this.state.auctions} rounds, valuations ~ U[${VAL_MIN}, ${VAL_MAX}], clock tick ${CLOCK_TICK}`,
      `first-price pays own bid, second-price (= single-item VCG) pays the runner-up value, English clock stops at the second-highest valuation`,
    );

    const metrics: ScienceMetric[] = formats.map((f) => ({
      key: `rev-${f}`,
      label: zh
        ? `${AUCTION_SHORT[f].zh} 均值收益`
        : `${AUCTION_SHORT[f].en} mean revenue`,
      value: fmtMetric(sims[f].meanRevenue),
      severity: f === this.state.auctionFormat ? 'ok' : 'info',
      hint: zh
        ? `范围 [${fmtMetric(sims[f].minRevenue)}, ${fmtMetric(sims[f].maxRevenue)}]，配置效率 ${(sims[f].efficiency * 100).toFixed(0)}%`
        : `range [${fmtMetric(sims[f].minRevenue)}, ${fmtMetric(sims[f].maxRevenue)}], allocation efficiency ${(sims[f].efficiency * 100).toFixed(0)}%`,
    }));
    metrics.push({
      key: 'vcg-gap',
      label: zh ? '一价 − VCG 收益差' : 'First-price − VCG revenue gap',
      value: fmtMetric(comparison.revenueGap),
      severity: 'info',
      hint: zh
        ? `一价均值 ${fmtMetric(comparison.meanFirstPriceRevenue)}，VCG 均值 ${fmtMetric(comparison.meanVcgRevenue)}（真报占优 → VCG 可实施）`
        : `first-price mean ${fmtMetric(comparison.meanFirstPriceRevenue)}, VCG mean ${fmtMetric(comparison.meanVcgRevenue)} (truthful bidding is dominant → VCG implementable)`,
    });
    metrics.push({
      key: 'ic-gap',
      label: zh ? '激励相容间隙' : 'Incentive-compatibility gap',
      value: fmtMetric(icGap),
      severity: icGap < 1e-9 ? 'ok' : 'error',
      hint: zh
        ? '二价/VCG 中任意偏离报价的最大增益（0 = 真报为弱占优策略），在报价网格上扫描'
        : 'largest gain from any bid deviation in the second-price/VCG rule (0 = truthful bidding weakly dominant), scanned on a bid grid',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing ------------------------------------------------------------------------

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

    if (this.state.mode === 'tree') {
      this.drawTree(g, W, H);
      return;
    }
    const cur = this.currentGame();
    if (!cur.game) {
      clearScienceOutputs(this.manifest.id);
      g.fillStyle = 'rgba(255,140,140,0.95)';
      g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(
        zh ? `收益矩阵文本无法解析：${cur.error}` : `Cannot parse payoff text: ${cur.error}`,
        W / 2,
        H / 2,
      );
      return;
    }
    switch (this.state.mode) {
      case 'matrix':
        this.drawMatrix(g, W, H, cur.game, cur.name);
        break;
      case 'replicator':
        this.drawReplicator(g, W, H, cur.game, cur.name);
        break;
      case 'auction':
        this.drawAuction(g, W, H);
        break;
      default:
        break;
    }
  }
}

export default function createMathGamePlugin(): Plugin {
  return new MathGamePlugin();
}
