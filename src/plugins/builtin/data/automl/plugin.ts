// ==========================================================================
// AutoML Pipeline plugin — main controller.
//
// Wires the pure AutoML kernel (search + cross-validation) to the Ergalics
// Studio plugin contract: parameter panel, canvas rendering (model-comparison
// bar chart on top, per-family best-config table below), science outputs,
// CSV / pipeline exports and block-mode compute.
//
// The plugin boots with the embedded deterministic sample already loaded, so
// the first "Run" works without any file interaction.
// ==========================================================================

import type {
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';
import { emit } from '@/core/events';
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
  plotBox,
  prepareCanvas,
  type PlotBox,
} from '../../shared/cs-utils';
import { automlManifest } from './manifest';
import { AUTOML_SAMPLE_CSV } from './samples';
import { generateSyntheticDataset, parseTable, runAutoML } from './kernel';
import type { AutoMLResult, ModelFamily, SearchStrategy } from './kernel';

/** Academic low-saturation palette for the comparison bars (blue/teal/gray). */
const PALETTE = ['#7fa8c9', '#6fb3ad', '#a3aebc', '#8f9fc0', '#6da8b8'] as const;

/** Time budget for a normal (non-benchmark) search, in milliseconds. */
const RUN_TIME_BUDGET_MS = 4000;
/** Time budget for the ~2000-row benchmark; keeps the action under ~2 s. */
const BENCHMARK_TIME_BUDGET_MS = 1900;
const BENCHMARK_ROWS = 2000;

type FamilySelection = 'auto' | 'all' | ModelFamily;

const FAMILY_SELECTIONS: readonly string[] = ['auto', 'all', 'ridge', 'logistic', 'knn', 'gnb', 'tree'];
const STRATEGIES: readonly string[] = ['grid', 'random', 'bayesian'];

interface AutoMLState {
  strategy: SearchStrategy;
  selection: FamilySelection;
  folds: number;
  seed: number;
  /** '' = default to the last column. */
  target: string;
}

export class AutoMLPlugin implements Plugin {
  readonly manifest = automlManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private text: string;
  private columns: string[] = [];
  private state: AutoMLState = {
    strategy: 'grid',
    selection: 'auto',
    folds: 5,
    seed: 20261029,
    target: '',
  };
  private result: AutoMLResult | null = null;
  private dirty = true;
  private running = false;

  constructor() {
    // The embedded sample is loaded from the start so the first Run works.
    this.text = AUTOML_SAMPLE_CSV;
    this.refreshColumns();
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

  /** Small bilingual labelled select, mirroring the stats plugin helpers. */
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

  getParams(): ParamDefinition[] {
    return [
      this.select('strategy', 'Search Strategy', '搜索策略', this.state.strategy, [
        { value: 'grid', en: 'Grid', zh: '网格搜索' },
        { value: 'random', en: 'Random', zh: '随机搜索' },
        { value: 'bayesian', en: 'Bayesian-ish', zh: '贝叶斯式搜索' },
      ]),
      this.select('model', 'Model Family', '模型家族', this.state.selection, [
        { value: 'auto', en: 'Auto (all applicable)', zh: '自动（全部适用模型）' },
        { value: 'all', en: 'All', zh: '全部' },
        { value: 'ridge', en: 'Ridge Regression', zh: '岭回归' },
        { value: 'logistic', en: 'Logistic Regression', zh: '逻辑回归' },
        { value: 'knn', en: 'k-NN', zh: 'K 近邻' },
        { value: 'gnb', en: 'Gaussian Naive Bayes', zh: '高斯朴素贝叶斯' },
        { value: 'tree', en: 'Decision Tree', zh: '决策树' },
      ]),
      {
        key: 'folds',
        label: 'CV Folds',
        labelI18n: { 'zh-CN': '交叉验证折数', 'en-US': 'CV Folds' },
        type: 'number',
        min: 2,
        max: 10,
        step: 1,
        value: this.state.folds,
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'number',
        min: 1,
        step: 1,
        value: this.state.seed,
      },
      this.select('target', 'Target Column', '目标列', this.state.target, [
        { value: '', en: '(last column)', zh: '（最后一列）' },
        ...this.columns.map((c) => ({ value: c, en: c, zh: c })),
      ]),
      actionButton('run', 'Run', '运行', 'primary'),
      actionButton('loadSample', 'Load Sample', '加载示例'),
      actionButton('benchmark', 'Benchmark', '基准测试'),
      actionButton('exportPipeline', 'Export Pipeline JSON', '导出流水线 JSON'),
      actionButton('exportCsv', 'Export Metrics CSV', '导出指标 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>): void {
    let changed = false;
    const strategy = params.strategy;
    if (typeof strategy === 'string' && STRATEGIES.includes(strategy) && strategy !== this.state.strategy) {
      this.state.strategy = strategy as SearchStrategy;
      changed = true;
    }
    const selection = params.model;
    if (typeof selection === 'string' && FAMILY_SELECTIONS.includes(selection) && selection !== this.state.selection) {
      this.state.selection = selection as FamilySelection;
      changed = true;
    }
    if (typeof params.folds === 'number' && Number.isFinite(params.folds)) {
      const folds = Math.min(10, Math.max(2, Math.round(params.folds)));
      if (folds !== this.state.folds) {
        this.state.folds = folds;
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
    if (typeof params.target === 'string' && params.target !== this.state.target) {
      this.state.target = params.target;
      changed = true;
    }

    if (actionFired(params, 'run')) {
      void this.runPipeline(true);
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
    if (actionFired(params, 'exportPipeline')) {
      this.exportPipeline();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportComparisonCsv();
      return;
    }

    if (changed) {
      this.dirty = true;
    }
    if (this.dirty) {
      // Re-run without a toast so the canvas stays in sync with the panel.
      void this.runPipeline(false);
    }
  }

  // ---- data loading --------------------------------------------------------

  async loadData(file: File): Promise<void> {
    const text = await file.text();
    if (!text.trim()) {
      notify(this.api, 'warning', 'The selected file is empty.', '所选文件为空。');
      return;
    }
    const table = parseTable(text);
    if (!table || table.rows.length < 8) {
      notify(
        this.api,
        'error',
        `Could not parse "${file.name}" as tabular CSV (need at least 8 data rows).`,
        `无法将「${file.name}」解析为表格 CSV（至少需要 8 行数据）。`,
      );
      return;
    }
    this.text = text;
    this.refreshColumns();
    this.state.target = '';
    this.dirty = true;
    this.api.reportDataScale(table.rows.length);
    // Refresh the param panel so the target-column dropdown is populated.
    emit('host:params:changed', { pluginId: this.manifest.id });
    void this.runPipeline(false);
    notify(this.api, 'success', `Loaded ${file.name} (${table.rows.length} rows).`, `已载入 ${file.name}（${table.rows.length} 行）。`);
  }

  private loadSample(): void {
    this.text = AUTOML_SAMPLE_CSV;
    this.refreshColumns();
    this.state.target = '';
    this.dirty = true;
    emit('host:params:changed', { pluginId: this.manifest.id });
    void this.runPipeline(false);
  }

  private refreshColumns(): void {
    const table = parseTable(this.text);
    this.columns = table ? table.columns : [];
  }

  // ---- pipeline execution ---------------------------------------------------

  private async runPipeline(explicit: boolean): Promise<void> {
    if (this.running) {
      if (explicit) {
        notify(this.api, 'warning', 'A search is already running.', '搜索正在进行中。');
      }
      return;
    }
    if (!this.text.trim()) {
      clearScienceOutputs(this.manifest.id);
      this.draw();
      return;
    }
    this.running = true;
    try {
      const res = runAutoML(this.text, {
        strategy: this.state.strategy,
        selection: this.state.selection,
        folds: this.state.folds,
        seed: this.state.seed,
        targetColumn: this.state.target || null,
        timeBudgetMs: RUN_TIME_BUDGET_MS,
      });
      this.result = res;
      this.dirty = false;
      this.publish(res);
      this.api.reportDataScale(res.rowCount);
      this.draw();
      if (explicit) {
        const value = `${fmtMetric(res.best.mean)} ± ${fmtMetric(res.best.std)}`;
        notify(
          this.api,
          'success',
          `Search finished — best: ${res.best.model} (${res.metricName} ${value}).`,
          `搜索完成 — 最优模型：${res.best.model}（${res.metricName} ${value}）。`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.result = null;
      this.dirty = false;
      clearScienceOutputs(this.manifest.id);
      this.draw();
      notify(this.api, 'error', `Search failed: ${message}`, `搜索失败：${message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Re-run the full search on a larger seeded synthetic dataset (~2000 rows)
   * under a tight time budget and publish throughput as science outputs.
   */
  private async runBenchmark(): Promise<void> {
    if (this.running) {
      notify(this.api, 'warning', 'A search is already running.', '搜索正在进行中。');
      return;
    }
    this.running = true;
    try {
      const seed = this.state.seed + 7;
      const csv = generateSyntheticDataset(BENCHMARK_ROWS, seed);
      const started = performance.now();
      const res = runAutoML(csv, {
        strategy: this.state.strategy,
        selection: this.state.selection,
        folds: Math.min(this.state.folds, 5),
        seed,
        targetColumn: null,
        timeBudgetMs: BENCHMARK_TIME_BUDGET_MS,
      });
      const totalMs = performance.now() - started;
      const rowsPerSec = res.rowCount / Math.max(1e-9, totalMs / 1000);
      this.api.reportDataScale(res.rowCount);
      const zh = this.zh;
      setScienceOutputs(this.manifest.id, [
        {
          key: 'bench-rows',
          label: zh ? '基准数据行数' : 'Benchmark rows',
          value: String(res.rowCount),
          severity: 'info',
        },
        {
          key: 'bench-total',
          label: zh ? '基准总耗时' : 'Benchmark total time',
          value: `${fmtMetric(totalMs, 4)} ms`,
          unit: 'ms',
          severity: 'info',
        },
        {
          key: 'bench-rate',
          label: zh ? '搜索吞吐' : 'Search throughput',
          value: `${fmtMetric(rowsPerSec, 4)} rows/s`,
          severity: 'info',
          hint: zh ? `策略 ${this.state.strategy}，${res.folds} 折交叉验证` : `${this.state.strategy} strategy, ${res.folds}-fold CV`,
        },
        {
          key: 'bench-best',
          label: zh ? '基准最优模型' : 'Benchmark best model',
          value: res.best.model,
          severity: 'info',
          hint: res.truncated
            ? zh
              ? '达到时间预算，搜索被截断'
              : 'search truncated at the time budget'
            : zh
              ? `完整搜索，${res.metricName} ${fmtMetric(res.best.mean)}`
              : `full search, ${res.metricName} ${fmtMetric(res.best.mean)}`,
        },
      ]);
      notify(
        this.api,
        'success',
        `Benchmark: ${res.rowCount} rows in ${totalMs.toFixed(0)} ms (${fmtMetric(rowsPerSec, 4)} rows/s).`,
        `基准测试：${res.rowCount} 行，耗时 ${totalMs.toFixed(0)} ms（${fmtMetric(rowsPerSec, 4)} 行/秒）。`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Benchmark failed: ${message}`, `基准测试失败：${message}`);
    } finally {
      this.running = false;
    }
  }

  // ---- science outputs -------------------------------------------------------

  private publish(res: AutoMLResult): void {
    const zh = this.zh;
    const primaryLabel =
      res.metricName === 'accuracy' ? (zh ? 'CV 准确率' : 'CV accuracy') : zh ? 'CV RMSE' : 'CV RMSE';
    const metrics: ScienceMetric[] = [
      {
        key: 'best-model',
        label: zh ? '最优模型' : 'Best model',
        value: res.best.model,
        severity: 'info',
        hint: zh ? `${res.folds} 折交叉验证，策略 ${this.state.strategy}` : `${res.folds}-fold CV, ${this.state.strategy} strategy`,
      },
      {
        key: 'cv-primary',
        label: primaryLabel,
        value: `${fmtMetric(res.best.mean)} ± ${fmtMetric(res.best.std)}`,
        severity: 'ok',
        hint: zh ? '折间均值 ± 标准差' : 'mean ± std across folds',
      },
    ];
    if (res.best.aux !== null && res.auxName) {
      const auxLabel =
        res.auxName === 'auc' ? 'CV AUC' : res.auxName === 'macro_f1' ? (zh ? 'CV 宏 F1' : 'CV macro-F1') : 'CV R²';
      metrics.push({
        key: 'cv-aux',
        label: auxLabel,
        value: fmtMetric(res.best.aux),
        severity: 'info',
        hint: zh
          ? res.task === 'classification'
            ? '二分类为 AUC，多分类为宏 F1'
            : '决定系数 R²'
          : res.task === 'classification'
            ? 'AUC for binary, macro-F1 for multiclass'
            : 'coefficient of determination',
      });
    }
    metrics.push(
      {
        key: 'features',
        label: zh ? '入选特征数' : 'Selected features',
        value: `${res.selectedFeatureCount} / ${res.rawFeatureCount}`,
        severity: 'info',
        hint:
          res.droppedColumns.length > 0
            ? `${zh ? '剔除' : 'dropped'}: ${res.droppedColumns.join(', ')}`
            : zh
              ? '方差阈值 + 相关性排序'
              : 'variance threshold + correlation ranking',
      },
      {
        key: 'runtime',
        label: zh ? '运行耗时' : 'Runtime',
        value: `${fmtMetric(res.runtimeMs, 4)} ms`,
        unit: 'ms',
        severity: 'info',
      },
    );
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- exports ----------------------------------------------------------------

  private exportPipeline(): void {
    if (!this.result) {
      notify(this.api, 'warning', 'Run a search first.', '请先运行搜索。');
      return;
    }
    const jsonText = JSON.stringify(this.result.pipeline, null, 2);
    this.api.exportFile('automl-pipeline.json', jsonText, 'application/json');
    notify(this.api, 'success', 'Pipeline descriptor exported.', '流水线描述已导出。');
  }

  private exportComparisonCsv(): void {
    const res = this.result;
    if (!res) {
      notify(this.api, 'warning', 'Run a search first.', '请先运行搜索。');
      return;
    }
    const rows = res.families.map((f) => [
      f.model,
      Object.keys(f.params)
        .sort()
        .map((k) => `${k}=${f.params[k]}`)
        .join('; '),
      res.metricName,
      Number(f.mean.toFixed(6)),
      Number(f.std.toFixed(6)),
      f.aux === null ? null : Number(f.aux.toFixed(6)),
    ]);
    exportRowsCsv(
      this.api,
      'automl-comparison',
      ['model', 'params', 'metric', 'cv_mean', 'cv_std', res.auxName ?? 'aux'],
      rows,
    );
  }

  // ---- block / flow mode -------------------------------------------------------

  async compute(
    input: unknown,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<ComputeResult> {
    if (typeof input === 'string' && input.trim()) {
      this.text = input;
      this.refreshColumns();
      this.state.target = '';
    }
    if (!this.text.trim()) {
      return { ok: false, error: 'no data loaded' };
    }
    onProgress?.({ done: 0, total: 1, label: 'automl-search' });
    try {
      const res = runAutoML(this.text, {
        strategy: this.state.strategy,
        selection: this.state.selection,
        folds: this.state.folds,
        seed: this.state.seed,
        targetColumn: this.state.target || null,
        timeBudgetMs: RUN_TIME_BUDGET_MS,
      });
      this.result = res;
      this.dirty = false;
      this.publish(res);
      onProgress?.({ done: 1, total: 1, label: 'automl-search' });
      return {
        ok: true,
        output: {
          bestModel: res.best.model,
          task: res.task,
          metric: res.metricName,
          cvMean: res.best.mean,
          cvStd: res.best.std,
          aux: res.best.aux,
          selectedFeatures: res.selectedFeatureCount,
          rows: res.rowCount,
          runtimeMs: res.runtimeMs,
          truncated: res.truncated,
          comparison: res.families,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---- rendering -----------------------------------------------------------------

  private draw(): void {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    const zh = this.zh;
    const res = this.result;
    if (!res) {
      if (!this.text.trim()) clearScienceOutputs(this.manifest.id);
      drawHeader(g, w, zh ? 'AutoML 流水线' : 'AutoML Pipeline', zh ? '等待运行' : 'awaiting run', zh);
      g.fillStyle = CS.dim;
      g.font = font(zh, 12);
      g.textAlign = 'center';
      g.fillText(
        zh ? '点击「运行」在当前数据上搜索并交叉验证模型' : 'Press "Run" to search and cross-validate models on the current data.',
        w / 2,
        h / 2 - 6,
      );
      g.fillStyle = CS.faint;
      g.font = font(zh, 10.5);
      g.fillText(
        zh ? '内置示例已就绪；也可拖入 CSV 文件。' : 'The embedded sample is ready; drop a CSV file to use your own data.',
        w / 2,
        h / 2 + 16,
      );
      drawFootnote(
        g,
        w,
        h,
        zh ? '流程：预处理 → 特征筛选 → 超参数搜索 → K 折交叉验证' : 'Pipeline: preprocess → feature selection → hyperparameter search → K-fold CV',
        zh,
      );
      return;
    }

    drawHeader(g, w, zh ? 'AutoML 流水线' : 'AutoML Pipeline', this.subtitle(res), zh);
    const chartH = Math.round(h * 0.52);
    this.drawComparison(g, w, chartH, res, zh);
    this.drawDetailTable(g, w, h, chartH, res, zh);
    drawFootnote(
      g,
      w,
      h,
      zh
        ? '上：各模型家族的交叉验证比较（柱高为均值，误差线为 ±1 标准差，青色描边为最优）；下：各家族最优超参数。'
        : 'Top: cross-validated comparison per family (bar = mean, whisker = ±1 std, cyan outline = best); bottom: best hyperparameters per family.',
      zh,
    );
  }

  private subtitle(res: AutoMLResult): string {
    const zh = this.zh;
    const parts = [
      zh ? `${res.rowCount} 行` : `${res.rowCount} rows`,
      zh ? `特征 ${res.selectedFeatureCount}/${res.rawFeatureCount}` : `features ${res.selectedFeatureCount}/${res.rawFeatureCount}`,
      res.task === 'classification'
        ? zh
          ? `分类（${res.nClasses} 类）`
          : `classification (${res.nClasses} classes)`
        : zh
          ? '回归'
          : 'regression',
      `${this.state.strategy}`,
      `${res.folds}-fold`,
      `seed ${res.seed}`,
    ];
    if (res.truncated) parts.push(zh ? '已按时间预算截断' : 'time-budget truncated');
    return parts.join(' · ');
  }

  /** Top panel: bar chart of the primary CV metric, best config per family. */
  private drawComparison(g: CanvasRenderingContext2D, w: number, chartH: number, res: AutoMLResult, zh: boolean): void {
    const box: PlotBox = plotBox(w, chartH, 74, 56, 28, 46);
    const fams = res.families;
    const n = Math.max(1, fams.length);
    const maxVal = Math.max(...fams.map((f) => f.mean), 0);
    const yMin = 0;
    const yMax = Math.max(
      res.higherBetter ? Math.min(1, maxVal) : maxVal * 1.15,
      yMin + 1e-6,
    );

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      value: t,
      label: fmtMetric(yMax - t * (yMax - yMin), 3),
    }));
    drawAxes(g, box, [], yTicks, '', res.metricName, zh);

    const slot = box.w / n;
    const barW = Math.min(64, slot * 0.55);
    fams.forEach((f, i) => {
      const cx = box.x0 + slot * (i + 0.5);
      const vh = Math.max(0, ((f.mean - yMin) / (yMax - yMin)) * box.h);
      const y = box.y1 - vh;
      g.fillStyle = PALETTE[i % PALETTE.length]!;
      g.globalAlpha = i === 0 ? 1 : 0.78;
      g.fillRect(cx - barW / 2, y, barW, vh);
      g.globalAlpha = 1;
      if (i === 0) {
        g.strokeStyle = CS.cyan;
        g.lineWidth = 1.5;
        g.strokeRect(cx - barW / 2, y, barW, vh);
      }
      const sdH = Math.max(0, (f.std / (yMax - yMin)) * box.h);
      g.strokeStyle = CS.dim;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx, y - sdH);
      g.lineTo(cx, y + sdH);
      g.stroke();
      g.fillStyle = CS.text;
      g.font = font(false, 9.5);
      g.textAlign = 'center';
      g.fillText(fmtMetric(f.mean, 3), cx, Math.max(box.y0 + 8, y - sdH - 5));
      g.fillStyle = CS.dim;
      g.fillText(f.model, cx, box.y1 + 14);
    });

    drawLegend(
      g,
      box.x0,
      box.y0 - 10,
      [{ label: zh ? '各家族最优配置（按均值排序）' : 'best config per family (ranked)', color: PALETTE[0]! }],
      zh,
    );
  }

  /** Bottom panel: best config per family with params and CV mean ± std. */
  private drawDetailTable(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    chartH: number,
    res: AutoMLResult,
    zh: boolean,
  ): void {
    const header = [
      zh ? '模型' : 'model',
      'params',
      zh ? '均值' : 'mean',
      zh ? '标准差' : 'std',
      'metric',
    ];
    const rows = res.families.map((f) => [
      f.model,
      Object.keys(f.params)
        .sort()
        .map((k) => `${k}=${f.params[k]}`)
        .join('; '),
      fmtMetric(f.mean, 4),
      fmtMetric(f.std, 4),
      res.metricName,
    ]);
    drawTable(g, w, h, header, rows, {
      top: chartH + 30,
      rowHeight: 18,
      left: 40,
      highlight: 0,
    });
  }
}

export default function createAutoMLPlugin(): Plugin {
  return new AutoMLPlugin();
}
