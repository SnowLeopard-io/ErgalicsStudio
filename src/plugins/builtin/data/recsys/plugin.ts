// ==========================================================================
// Recommender Lab plugin — main controller.
//
// Wires the pure recommender kernel (user-/item-based CF, content-based
// ridge, ALS matrix factorization, hybrid blend, holdout evaluation,
// cold-start accounting) to the Ergalics Studio plugin contract: parameter
// panel, canvas rendering (predicted-vs-actual scatter, training rating
// matrix, metrics table, Top-N recommendations, cold-start note), science
// outputs, CSV export, a seeded throughput benchmark and block-mode compute.
//
// The plugin boots with the embedded deterministic sample ratings already
// loaded, so the first "Run" works without any file interaction.
// ==========================================================================

import type {
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs } from '@/core/research/scienceOutput';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import {
  CS,
  drawAxes,
  drawFootnote,
  drawHeader,
  drawLegend,
  drawTable,
  font,
  mix,
  plotBox,
  prepareCanvas,
  type PlotBox,
} from '../../shared/cs-utils';
import { recsysManifest } from './manifest';
import { RECSYS_SAMPLE_CSV } from './samples';
import {
  ALGORITHM_LABELS,
  computeNdcg,
  generateSyntheticRatings,
  parseRatingsCsv,
  runRecsys,
} from './kernel';
import type { RecsysAlgorithm, RecsysParams, RecsysResult } from './kernel';

/** Academic low-saturation palette (bars, matrix accents). */
const PALETTE = [
  '#7fa8c9', '#6fb3ad', '#a3aebc', '#8f9fc0', '#6da8b8', '#9db4d0', '#7fb8a8', '#b3a3c9',
] as const;

/** Rating-matrix cell colours: low ratings fade into high ratings. */
const MATRIX_LOW = '#33506e';
const MATRIX_HIGH = '#cfe3ee';

/** Dataset size of the seeded perf benchmark (~100 users × 40 items). */
const BENCHMARK_USERS = 100;
const BENCHMARK_ITEMS = 40;
/** Benchmark budget: ALS + evaluation on the synthetic set must stay < 2 s. */
const BENCHMARK_BUDGET_MS = 2000;

const ALGORITHMS: readonly RecsysAlgorithm[] = ['user-cf', 'item-cf', 'content', 'als', 'hybrid'];

interface RecsysState {
  algorithm: RecsysAlgorithm;
  neighbors: number;
  factors: number;
  iterations: number;
  lambda: number;
  topK: number;
  alpha: number;
  holdout: number;
  seed: number;
}

export class RecsysPlugin implements Plugin {
  readonly manifest = recsysManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private text: string;
  private state: RecsysState = {
    algorithm: 'als',
    neighbors: 10,
    factors: 8,
    iterations: 10,
    lambda: 0.1,
    topK: 5,
    alpha: 0.5,
    holdout: 0.2,
    seed: 20261029,
  };
  private result: RecsysResult | null = null;
  private errorMessage: string | null = null;
  private dirty = true;
  private running = false;

  constructor() {
    // The embedded sample is loaded from the start so the first Run works.
    this.text = RECSYS_SAMPLE_CSV;
  }

  async init(api: PluginApi): Promise<void> {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((locale) => {
      this.zh = locale === 'zh-CN';
      this.draw();
    });
  }

  async destroy(): Promise<void> {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
    this.result = null;
  }

  async activate(context: { container: ContainerCapabilities }): Promise<void> {
    this.ctx = context.container;
  }

  async deactivate(): Promise<void> {
    this.ctx = null;
  }

  render(container: ContainerCapabilities): void {
    this.ctx = container;
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameter panel ---------------------------------------------------

  /** Small bilingual labelled select, mirroring the sibling data plugins. */
  private select(
    key: string,
    en: string,
    zh: string,
    value: string,
    options: Array<{ value: string; en: string; zh: string }>,
  ): ParamDefinition {
    return {
      key,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
      type: 'select',
      value,
      options: options.map((o) => ({
        value: o.value,
        label: this.zh ? o.zh : o.en,
        labelI18n: { 'zh-CN': o.zh, 'en-US': o.en },
      })),
    };
  }

  private numberParam(
    key: string,
    en: string,
    zh: string,
    value: number,
    min: number,
    max: number,
    step: number,
  ): ParamDefinition {
    return {
      key,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
      type: 'number',
      min,
      max,
      step,
      value,
    };
  }

  private rangeParam(
    key: string,
    en: string,
    zh: string,
    value: number,
    min: number,
    max: number,
    step: number,
  ): ParamDefinition {
    return {
      key,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
      type: 'range',
      min,
      max,
      step,
      value,
    };
  }

  getParams(): ParamDefinition[] {
    return [
      this.select('algorithm', 'Algorithm', '算法', this.state.algorithm, ALGORITHMS.map((a) => ({
        value: a,
        en: ALGORITHM_LABELS[a][0],
        zh: ALGORITHM_LABELS[a][1],
      }))),
      this.numberParam('neighbors', 'CF Neighbors (k)', '协同过滤近邻数 k', this.state.neighbors, 1, 50, 1),
      this.numberParam('factors', 'ALS Factors', 'ALS 隐因子数', this.state.factors, 2, 32, 1),
      this.numberParam('iterations', 'ALS Iterations', 'ALS 迭代次数', this.state.iterations, 1, 50, 1),
      this.numberParam('lambda', 'ALS Lambda (L2)', 'ALS 正则系数 λ', this.state.lambda, 0.001, 5, 0.05),
      this.numberParam('topK', 'Top-K', '推荐列表长度 K', this.state.topK, 1, 20, 1),
      this.rangeParam('alpha', 'Hybrid Alpha (MF weight)', '混合系数 α（MF 权重）', this.state.alpha, 0, 1, 0.05),
      this.rangeParam('holdout', 'Holdout Ratio', '保留集比例', this.state.holdout, 0.05, 0.5, 0.05),
      this.numberParam('seed', 'Seed', '随机种子', this.state.seed, 1, 999999999, 1),
      actionButton('run', 'Run', '运行', 'primary'),
      actionButton('loadSample', 'Load Sample', '加载示例'),
      actionButton('benchmark', 'Benchmark', '基准测试'),
      actionButton('exportCsv', 'Export Metrics CSV', '导出指标 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>): void {
    let changed = false;

    if (
      typeof params.algorithm === 'string' &&
      (ALGORITHMS as readonly string[]).includes(params.algorithm) &&
      params.algorithm !== this.state.algorithm
    ) {
      this.state.algorithm = params.algorithm as RecsysAlgorithm;
      changed = true;
    }
    const clampInt = (raw: unknown, lo: number, hi: number): number | null =>
      typeof raw === 'number' && Number.isFinite(raw) ? Math.min(hi, Math.max(lo, Math.round(raw))) : null;
    const neighbors = clampInt(params.neighbors, 1, 50);
    if (neighbors !== null && neighbors !== this.state.neighbors) {
      this.state.neighbors = neighbors;
      changed = true;
    }
    const factors = clampInt(params.factors, 2, 32);
    if (factors !== null && factors !== this.state.factors) {
      this.state.factors = factors;
      changed = true;
    }
    const iterations = clampInt(params.iterations, 1, 50);
    if (iterations !== null && iterations !== this.state.iterations) {
      this.state.iterations = iterations;
      changed = true;
    }
    const topK = clampInt(params.topK, 1, 20);
    if (topK !== null && topK !== this.state.topK) {
      this.state.topK = topK;
      changed = true;
    }
    if (typeof params.lambda === 'number' && Number.isFinite(params.lambda)) {
      const lambda = Math.min(5, Math.max(0.001, params.lambda));
      if (lambda !== this.state.lambda) {
        this.state.lambda = lambda;
        changed = true;
      }
    }
    if (typeof params.alpha === 'number' && Number.isFinite(params.alpha)) {
      const alpha = Math.min(1, Math.max(0, params.alpha));
      if (alpha !== this.state.alpha) {
        this.state.alpha = alpha;
        changed = true;
      }
    }
    if (typeof params.holdout === 'number' && Number.isFinite(params.holdout)) {
      const holdout = Math.min(0.5, Math.max(0.05, params.holdout));
      if (holdout !== this.state.holdout) {
        this.state.holdout = holdout;
        changed = true;
      }
    }
    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      const seed = Math.max(1, Math.round(params.seed));
      if (seed !== this.state.seed) {
        this.state.seed = seed;
        changed = true;
      }
    }

    if (actionFired(params, 'run')) {
      void this.runAnalysis(true);
      return;
    }
    if (actionFired(params, 'loadSample')) {
      this.loadSample();
      return;
    }
    if (actionFired(params, 'benchmark')) {
      void this.runBenchmark();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }

    if (changed) this.dirty = true;
    if (this.dirty) {
      // Re-run without a toast so the canvas stays in sync with the panel.
      void this.runAnalysis(false);
    }
  }

  // ---- data loading --------------------------------------------------------

  async loadData(file: File): Promise<void> {
    const text = await file.text();
    if (!text.trim()) {
      notify(this.api, 'warning', 'The selected file is empty.', '所选文件为空。');
      return;
    }
    try {
      const ds = parseRatingsCsv(text);
      this.text = text;
      this.dirty = true;
      this.api.reportDataScale(ds.ratings.length);
      void this.runAnalysis(false);
      notify(
        this.api,
        'success',
        `Loaded ${file.name} (${ds.userCount} users × ${ds.itemCount} items, ${ds.ratings.length} ratings).`,
        `已载入 ${file.name}（${ds.userCount} 个用户 × ${ds.itemCount} 个物品，${ds.ratings.length} 条评分）。`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(
        this.api,
        'error',
        `Could not read "${file.name}" as ratings: ${message}`,
        `无法将「${file.name}」读取为评分数据：${message}`,
      );
    }
  }

  private loadSample(): void {
    this.text = RECSYS_SAMPLE_CSV;
    this.dirty = true;
    notify(this.api, 'info', 'Embedded sample ratings loaded.', '已载入内置示例评分数据。');
    void this.runAnalysis(false);
  }

  // ---- run / evaluation -------------------------------------------------------

  private params(): RecsysParams {
    return {
      algorithm: this.state.algorithm,
      neighbors: this.state.neighbors,
      factors: this.state.factors,
      iterations: this.state.iterations,
      lambda: this.state.lambda,
      topK: this.state.topK,
      alpha: this.state.alpha,
      holdout: this.state.holdout,
      seed: this.state.seed,
    };
  }

  /** Synchronous train + evaluate + publish. Returns false on failure. */
  private runSync(): boolean {
    try {
      const res = runRecsys(this.text, this.params());
      this.result = res;
      this.errorMessage = null;
      this.dirty = false;
      this.publish(res);
      this.api.reportDataScale(res.ratingCount);
      return true;
    } catch (err) {
      this.result = null;
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.dirty = false;
      clearScienceOutputs(this.manifest.id);
      return false;
    }
  }

  private async runAnalysis(explicit: boolean): Promise<void> {
    if (this.running) {
      if (explicit) {
        notify(this.api, 'warning', 'A run is already in progress.', '已有一次运行正在进行。');
      }
      return;
    }
    if (!this.text.trim()) {
      this.result = null;
      clearScienceOutputs(this.manifest.id);
      this.draw();
      return;
    }
    this.running = true;
    try {
      const ok = this.runSync();
      this.draw();
      if (explicit) {
        if (ok && this.result) {
          const res = this.result;
          notify(
            this.api,
            'success',
            `Run complete — ${res.algorithmLabel}, RMSE ${fmtMetric(res.metrics.rmse, 3)}, NDCG@${res.topK} ${fmtMetric(res.metrics.ndcg, 3)} (${res.runtimeMs.toFixed(0)} ms).`,
            `运行完成 — ${ALGORITHM_LABELS[res.algorithm][1]}，RMSE ${fmtMetric(res.metrics.rmse, 3)}，NDCG@${res.topK} ${fmtMetric(res.metrics.ndcg, 3)}（${res.runtimeMs.toFixed(0)} ms）。`,
          );
        } else {
          notify(
            this.api,
            'error',
            `Run failed: ${this.errorMessage ?? 'unknown error'}`,
            `运行失败：${this.errorMessage ?? '未知错误'}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  // ---- science outputs ---------------------------------------------------------

  private publish(res: RecsysResult): void {
    const zh = this.zh;
    const m = res.metrics;
    const metrics: ScienceMetric[] = [
      {
        key: 'rmse',
        label: 'RMSE',
        value: fmtMetric(m.rmse, 4),
        severity: m.rmse < 1 ? 'ok' : 'info',
        hint: zh
          ? `保留集（${(res.holdout * 100).toFixed(0)}%）上的均方根误差，${res.testCount} 个测试评分`
          : `root-mean-square error on the ${(res.holdout * 100).toFixed(0)}% holdout, ${res.testCount} test ratings`,
      },
      {
        key: 'ndcg',
        label: `NDCG@${res.topK}`,
        value: fmtMetric(m.ndcg, 4),
        severity: 'ok',
        hint: zh
          ? `排序质量：${res.rankUsers} 个有相关物品的用户（评分 ≥ ${res.relevantThreshold}）`
          : `ranking quality over ${res.rankUsers} users with a relevant item (rating ≥ ${res.relevantThreshold})`,
      },
      {
        key: 'precision',
        label: `Precision@${res.topK}`,
        value: fmtMetric(m.precision, 4),
        severity: 'ok',
        hint: zh ? `Top-${res.topK} 命中率（Recall@K ${fmtMetric(m.recall, 3)}，MAP ${fmtMetric(m.map, 3)}）` : `Top-${res.topK} hit rate (Recall@K ${fmtMetric(m.recall, 3)}, MAP ${fmtMetric(m.map, 3)})`,
      },
      {
        key: 'cold-coverage',
        label: zh ? '冷启动回退占比' : 'Cold-start fallback coverage',
        value: `${fmtMetric(res.coldStart.coveragePct, 3)}%`,
        unit: '%',
        severity: 'info',
        hint: zh
          ? `排名候选中由回退策略服务的比例：新物品 ${res.coldStart.newItemFallbacks}，冷用户 ${res.coldStart.coldUserFallbacks}`
          : `share of ranked candidates served by a fallback: ${res.coldStart.newItemFallbacks} new-item, ${res.coldStart.coldUserFallbacks} cold-user`,
      },
      {
        key: 'runtime',
        label: zh ? '运行耗时' : 'Runtime',
        value: `${fmtMetric(res.runtimeMs, 4)} ms`,
        unit: 'ms',
        severity: 'info',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- benchmark ------------------------------------------------------------------

  /**
   * Train ALS and run the full holdout evaluation on a seeded synthetic
   * ~100 users × 40 items dataset, publishing throughput plus the two
   * kernel sanity benchmarks (NDCG implementation check, ALS beats the
   * global-mean baseline) as science outputs.
   */
  private async runBenchmark(): Promise<void> {
    if (this.running) {
      notify(this.api, 'warning', 'A run is already in progress.', '已有一次运行正在进行。');
      return;
    }
    this.running = true;
    try {
      const csv = generateSyntheticRatings(BENCHMARK_USERS, BENCHMARK_ITEMS, this.state.seed + 7, {
        missing: 0.2,
      });
      const started = performance.now();
      const res = runRecsys(csv, { ...this.params(), algorithm: 'als' });
      const totalMs = performance.now() - started;
      const ratingsPerSec = res.ratingCount / Math.max(1e-9, totalMs / 1000);

      // Sanity 1: the exported NDCG implementation against hand-computed values.
      const ndcgOk =
        Math.abs(computeNdcg([true], 1) - 1) < 1e-9 &&
        Math.abs(computeNdcg([false, true], 2) - 1 / Math.log2(3)) < 1e-9 &&
        computeNdcg([false, false], 5) === 0;
      // Sanity 2: ALS must beat predicting the global mean everywhere.
      let baselineSe = 0;
      for (const p of res.scatter) baselineSe += (p.actual - res.coldStart.globalMean) ** 2;
      const baselineRmse = res.scatter.length > 0 ? Math.sqrt(baselineSe / res.scatter.length) : 0;
      const alsBetter = res.metrics.rmse > 0 && res.metrics.rmse < baselineRmse;

      this.api.reportDataScale(res.ratingCount);
      const zh = this.zh;
      setScienceOutputs(this.manifest.id, [
        {
          key: 'bench-users',
          label: zh ? '基准数据规模' : 'Benchmark dataset',
          value: `${res.userCount} × ${res.itemCount}`,
          severity: 'info',
          hint: zh ? `${res.ratingCount} 条合成评分（聚类结构，种子 ${this.state.seed + 7}）` : `${res.ratingCount} synthetic ratings (cluster-structured, seed ${this.state.seed + 7})`,
        },
        {
          key: 'bench-total',
          label: zh ? '基准总耗时' : 'Benchmark total time',
          value: `${fmtMetric(totalMs, 4)} ms`,
          unit: 'ms',
          severity: totalMs < BENCHMARK_BUDGET_MS ? 'ok' : 'warn',
          hint: zh ? `ALS 训练 + 评估目标 < ${BENCHMARK_BUDGET_MS / 1000} s` : `ALS train + evaluate target < ${BENCHMARK_BUDGET_MS / 1000} s`,
        },
        {
          key: 'bench-rate',
          label: zh ? '基准吞吐' : 'Benchmark throughput',
          value: `${fmtMetric(ratingsPerSec, 4)} ratings/s`,
          severity: 'info',
        },
        {
          key: 'bench-ndcg-sanity',
          label: 'ndcg-sanity',
          value: ndcgOk ? 'pass' : 'fail',
          severity: ndcgOk ? 'ok' : 'error',
          hint: zh ? 'NDCG@K 与手算值逐位一致' : 'NDCG@K matches hand-computed values exactly',
        },
        {
          key: 'bench-als-convergence',
          label: 'als-convergence',
          value: alsBetter ? 'pass' : 'fail',
          severity: alsBetter ? 'ok' : 'error',
          hint: zh
            ? `RMSE ${fmtMetric(res.metrics.rmse, 3)} 优于全局均值基线 ${fmtMetric(baselineRmse, 3)}`
            : `RMSE ${fmtMetric(res.metrics.rmse, 3)} beats the global-mean baseline ${fmtMetric(baselineRmse, 3)}`,
        },
      ]);
      const allOk = ndcgOk && alsBetter && totalMs < BENCHMARK_BUDGET_MS;
      notify(
        this.api,
        allOk ? 'success' : 'warning',
        `Benchmark: ${res.userCount}×${res.itemCount} (${res.ratingCount} ratings) ALS in ${totalMs.toFixed(0)} ms (${fmtMetric(ratingsPerSec, 3)} ratings/s).`,
        `基准测试：${res.userCount}×${res.itemCount}（${res.ratingCount} 条评分）ALS 耗时 ${totalMs.toFixed(0)} ms（${fmtMetric(ratingsPerSec, 3)} 条/秒）。`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Benchmark failed: ${message}`, `基准测试失败：${message}`);
    } finally {
      this.running = false;
    }
  }

  // ---- exports ----------------------------------------------------------------

  /** Export one metric row per algorithm (all five fitted with current params). */
  private exportCsv(): void {
    if (!this.text.trim()) {
      notify(this.api, 'warning', 'Load data before exporting.', '请先加载数据再导出。');
      return;
    }
    try {
      const rows = ALGORITHMS.map((algo) => {
        const r = runRecsys(this.text, { ...this.params(), algorithm: algo });
        return [
          ALGORITHM_LABELS[algo][0],
          Number(r.metrics.precision.toFixed(6)),
          Number(r.metrics.recall.toFixed(6)),
          Number(r.metrics.ndcg.toFixed(6)),
          Number(r.metrics.map.toFixed(6)),
          Number(r.metrics.rmse.toFixed(6)),
          Number(r.coldStart.coveragePct.toFixed(3)),
          Number(r.runtimeMs.toFixed(3)),
        ];
      });
      exportRowsCsv(
        this.api,
        'recsys-metrics',
        [
          'algorithm',
          `precision_at_${this.state.topK}`,
          `recall_at_${this.state.topK}`,
          `ndcg_at_${this.state.topK}`,
          'map',
          'rmse',
          'cold_start_coverage_pct',
          'runtime_ms',
        ],
        rows,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Export failed: ${message}`, `导出失败：${message}`);
    }
  }

  // ---- block / flow mode ---------------------------------------------------------

  async compute(
    input: unknown,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<ComputeResult> {
    if (typeof input === 'string' && input.trim()) {
      this.text = input;
      this.dirty = true;
    }
    if (!this.text.trim()) {
      clearScienceOutputs(this.manifest.id);
      return { ok: false, error: 'no ratings data loaded' };
    }
    onProgress?.({ done: 0, total: 1, label: this.state.algorithm });
    const ok = this.runSync();
    this.draw();
    onProgress?.({ done: 1, total: 1, label: this.state.algorithm });
    if (!ok || !this.result) {
      return { ok: false, error: this.errorMessage ?? 'run failed' };
    }
    const res = this.result;
    return {
      ok: true,
      output: {
        algorithm: res.algorithm,
        algorithmLabel: res.algorithmLabel,
        users: res.userCount,
        items: res.itemCount,
        ratings: res.ratingCount,
        train: res.trainCount,
        test: res.testCount,
        topK: res.topK,
        metrics: {
          precisionAtK: res.metrics.precision,
          recallAtK: res.metrics.recall,
          ndcgAtK: res.metrics.ndcg,
          map: res.metrics.map,
          rmse: res.metrics.rmse,
        },
        coldStartCoveragePct: res.coldStart.coveragePct,
        rankUsers: res.rankUsers,
        runtimeMs: res.runtimeMs,
      },
    };
  }

  // ---- rendering -----------------------------------------------------------------

  private subtitle(res: RecsysResult | null): string {
    const zh = this.zh;
    if (!res) {
      return zh ? '等待运行' : 'awaiting run';
    }
    const parts = [
      zh
        ? `${res.userCount} 用户 × ${res.itemCount} 物品 · ${res.ratingCount} 条评分`
        : `${res.userCount} users × ${res.itemCount} items · ${res.ratingCount} ratings`,
      zh ? `训练 ${res.trainCount} / 测试 ${res.testCount}` : `train ${res.trainCount} / test ${res.testCount}`,
      zh ? ALGORITHM_LABELS[res.algorithm][1] : res.algorithmLabel,
      `K=${res.topK}`,
      `seed ${res.seed}`,
    ];
    return parts.join(' · ');
  }

  private footnote(): string {
    const zh = this.zh;
    return zh
      ? '上左：保留集预测 vs 真实评分（虚线为完美预测）；上右：训练评分矩阵；中：Top-K 排序与评分指标；下：Top-N 推荐与冷启动回退统计。'
      : 'Top left: holdout predictions vs true ratings (dashed = perfect prediction); top right: training rating matrix; middle: Top-K ranking and rating metrics; bottom: Top-N recommendations and cold-start fallback accounting.';
  }

  private draw(): void {
    // First render (and after any state change): run once so the canvas is
    // never left empty while a valid dataset is loaded.
    if (this.dirty && !this.running && this.text.trim()) {
      void this.runAnalysis(false);
      return;
    }
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    const zh = this.zh;
    const res = this.result;

    drawHeader(
      g,
      w,
      zh ? '推荐系统模拟器' : 'Recommender System Simulator',
      this.subtitle(res),
      zh,
    );

    if (!res) {
      if (!this.text.trim()) clearScienceOutputs(this.manifest.id);
      const message = this.errorMessage
        ? `${zh ? '运行失败：' : 'Run failed: '}${this.errorMessage}`
        : zh
          ? '点击「运行」训练并评估当前评分数据。'
          : 'Press "Run" to train and evaluate the current ratings.';
      g.fillStyle = CS.dim;
      g.font = font(zh, 12);
      g.textAlign = 'center';
      g.fillText(message, w / 2, h / 2 - 6);
      g.fillStyle = CS.faint;
      g.font = font(zh, 10.5);
      g.fillText(
        zh
          ? '数据格式：user,item,rating 长表 CSV（可附加数值物品特征列）；内置示例已就绪。'
          : 'Data format: long-format user,item,rating CSV (optional numeric item-feature columns); the embedded sample is ready.',
        w / 2,
        h / 2 + 16,
      );
      drawFootnote(g, w, h, this.footnote(), zh);
      return;
    }

    const topH = Math.round(h * 0.4);
    this.drawScatter(g, w, topH, res, zh);
    this.drawMatrix(g, w, topH, res, zh);
    const midTop = topH + 16;
    this.drawMetricsTable(g, w, h, midTop, res, zh);
    this.drawTopN(g, w, midTop, res, zh);
    this.drawColdStart(g, w, h, topH, res, zh);
    drawFootnote(g, w, h, this.footnote(), zh);
  }

  /** Top-left: held-out predictions vs actual ratings with the ideal diagonal. */
  private drawScatter(g: CanvasRenderingContext2D, w: number, topH: number, res: RecsysResult, zh: boolean): void {
    const panelW = Math.round(w * 0.56);
    const box: PlotBox = plotBox(panelW, topH, 58, 62, 20, 44);
    const ticks = [1, 2, 3, 4, 5].map((v) => ({ value: (v - 1) / 4, label: String(v) }));
    drawAxes(
      g,
      box,
      ticks,
      ticks,
      zh ? '实际评分' : 'actual rating',
      zh ? '预测评分' : 'predicted rating',
      zh,
    );
    const sx = (v: number) => box.x0 + box.w * ((v - 1) / 4);
    const sy = (v: number) => box.y1 - box.h * ((v - 1) / 4);
    // Ideal line y = x.
    g.strokeStyle = CS.amber;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(sx(1), sy(1));
    g.lineTo(sx(5), sy(5));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(120,200,255,0.5)';
    for (const p of res.scatter) {
      g.beginPath();
      g.arc(sx(p.actual), sy(p.pred), 2.4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = CS.dim;
    g.font = font(zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(
      zh ? `预测 vs 实际（${res.scatter.length} 个保留评分）` : `predicted vs actual (${res.scatter.length} holdout ratings)`,
      box.x0,
      52,
    );
    drawLegend(
      g,
      Math.max(box.x0 + 8, box.x1 - 148),
      52,
      [
        { label: zh ? '预测' : 'prediction', color: CS.blue },
        { label: zh ? '理想' : 'ideal', color: CS.amber, dash: true },
      ],
      zh,
    );
  }

  /** Top-right: heat strip of the dense training rating matrix. */
  private drawMatrix(g: CanvasRenderingContext2D, w: number, topH: number, res: RecsysResult, zh: boolean): void {
    const m = res.matrix;
    const x0 = Math.round(w * 0.58) + 6;
    const x1 = w - 24;
    const y0 = 58;
    const y1 = topH - 20;
    const showU = Math.min(m.userCount, 40);
    const showI = Math.min(m.itemCount, 30);
    const truncated = showU < m.userCount || showI < m.itemCount;
    const cw = Math.max(2, (x1 - x0) / showI);
    const ch = Math.max(2, (y1 - y0) / showU);
    g.strokeStyle = CS.axis;
    g.lineWidth = 1;
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    for (let u = 0; u < showU; u += 1) {
      for (let i = 0; i < showI; i += 1) {
        const v = m.values[u * m.itemCount + i] ?? null;
        g.fillStyle = v === null ? 'rgba(255,255,255,0.05)' : mix(MATRIX_LOW, MATRIX_HIGH, (v - 1) / 4);
        g.fillRect(x0 + i * cw, y0 + u * ch, Math.max(1, cw - 1), Math.max(1, ch - 1));
      }
    }
    g.fillStyle = CS.dim;
    g.font = font(zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(
      zh ? `训练评分矩阵${truncated ? '（截断）' : ''}` : `training rating matrix${truncated ? ' (truncated)' : ''}`,
      x0,
      52,
    );
    g.fillStyle = CS.faint;
    g.font = font(false, 9);
    g.fillText('1', x0, y1 + 12);
    g.textAlign = 'right';
    g.fillText('5', x1, y1 + 12);
    g.textAlign = 'left';
    g.fillText(zh ? '空格 = 未评分' : 'blank = unrated', x0, y1 + 24);
  }

  /** Middle-left: the holdout metric table. */
  private drawMetricsTable(g: CanvasRenderingContext2D, w: number, h: number, top: number, res: RecsysResult, zh: boolean): void {
    const panelW = Math.round(w * 0.52);
    const m = res.metrics;
    g.fillStyle = CS.dim;
    g.font = font(zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(
      zh
        ? `评估指标 · K=${res.topK} · 排序用户 ${res.rankUsers}（相关 ≥ ${res.relevantThreshold}）`
        : `evaluation metrics · K=${res.topK} · ranking users ${res.rankUsers} (relevant ≥ ${res.relevantThreshold})`,
      40,
      top,
    );
    const rows: Array<Array<string | number>> = [
      [`Precision@${res.topK}`, fmtMetric(m.precision, 4)],
      [`Recall@${res.topK}`, fmtMetric(m.recall, 4)],
      [`NDCG@${res.topK}`, fmtMetric(m.ndcg, 4)],
      ['MAP', fmtMetric(m.map, 4)],
      ['RMSE', fmtMetric(m.rmse, 4)],
    ];
    drawTable(g, panelW, h, [zh ? '指标' : 'Metric', zh ? '值' : 'Value'], rows, {
      top: top + 16,
      rowHeight: 16,
      left: 40,
      right: 16,
    });
  }

  /** Middle-right: Top-N recommendations for the most active training user. */
  private drawTopN(g: CanvasRenderingContext2D, w: number, top: number, res: RecsysResult, zh: boolean): void {
    const x0 = Math.round(w * 0.54) + 6;
    const x1 = w - 26;
    const entries = res.topN.entries;
    g.fillStyle = CS.dim;
    g.font = font(zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(
      res.topN.user
        ? zh
          ? `Top-${res.topK} 推荐 · 用户 ${res.topN.user}（最活跃）`
          : `Top-${res.topK} recommendations · user ${res.topN.user} (most active)`
        : zh
          ? `Top-${res.topK} · 冷启动热门榜（新用户）`
          : `Top-${res.topK} · cold-start popularity list (new user)`,
      x0,
      top,
    );
    if (entries.length === 0) {
      g.fillStyle = CS.faint;
      g.font = font(zh, 10);
      g.fillText(zh ? '该用户已评分所有物品。' : 'This user has rated every item.', x0, top + 22);
      return;
    }
    let maxScore = 1e-9;
    for (const e of entries) if (e.score > maxScore) maxScore = e.score;
    const labelW = 44;
    const barX = x0 + labelW + 6;
    const barMax = Math.max(20, x1 - 40 - barX);
    const rowH = 16;
    entries.forEach((e, i) => {
      const y = top + 18 + i * rowH;
      const label = e.item.length > 7 ? `${e.item.slice(0, 6)}…` : e.item;
      g.fillStyle = CS.dim;
      g.font = font(false, 10);
      g.textAlign = 'right';
      g.fillText(label, x0 + labelW, y + 10);
      const len = Math.max(2, (e.score / maxScore) * barMax);
      g.fillStyle = PALETTE[i % PALETTE.length]!;
      g.fillRect(barX, y + 2, len, 9);
      g.fillStyle = CS.faint;
      g.font = font(false, 9.5);
      g.textAlign = 'left';
      g.fillText(e.score.toFixed(2), barX + len + 4, y + 10);
    });
  }

  /** Bottom strip: cold-start fallback accounting + the plain-language note. */
  private drawColdStart(g: CanvasRenderingContext2D, w: number, h: number, topH: number, res: RecsysResult, zh: boolean): void {
    // Never let the strip climb into the metric table on short canvases.
    const y0 = Math.max(Math.round(h * 0.72), topH + 148);
    const cardH = Math.max(46, h - y0 - 28);
    g.strokeStyle = CS.grid;
    g.lineWidth = 1;
    g.strokeRect(32, y0, w - 64, cardH);
    const cs = res.coldStart;
    const sparse = Math.max(0, cs.fallbackCount - cs.newItemFallbacks - cs.coldUserFallbacks);
    g.textAlign = 'left';
    g.fillStyle = CS.dim;
    g.font = font(zh, 10, '600');
    g.fillText(
      zh
        ? `冷启动回退覆盖率 ${fmtMetric(cs.coveragePct, 3)}% · 全局均值 ${fmtMetric(cs.globalMean, 3)} · 候选 ${cs.candidateCount}`
        : `cold-start fallback coverage ${fmtMetric(cs.coveragePct, 3)}% · global mean ${fmtMetric(cs.globalMean, 3)} · candidates ${cs.candidateCount}`,
      44,
      y0 + 16,
    );
    g.fillStyle = CS.faint;
    g.font = font(zh, 10);
    g.fillText(
      zh
        ? `新物品回退 ${cs.newItemFallbacks} · 冷用户回退 ${cs.coldUserFallbacks} · 稀疏回退 ${sparse}`
        : `new-item fallbacks ${cs.newItemFallbacks} · cold-user fallbacks ${cs.coldUserFallbacks} · sparse fallbacks ${sparse}`,
      44,
      y0 + 32,
    );
    g.fillText(
      zh
        ? '新用户收到贝叶斯收缩后的热门榜；冷启动用户/新物品依次回退到物品均值、用户均值与全局均值。'
        : 'New users receive the Bayesian-shrunk popularity list; cold users and new items fall back to item mean, user mean, then the global mean.',
      44,
      y0 + 48,
    );
  }
}

export default function createRecsysPlugin(): Plugin {
  return new RecsysPlugin();
}
