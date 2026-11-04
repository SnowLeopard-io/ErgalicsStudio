// ==========================================================================
// Model Interpreter (XAI) plugin — main controller.
//
// Wires the pure XAI kernel to the Ergalics Studio plugin contract: a
// method selector (permutation importance / partial dependence / LIME /
// SHAP / counterfactual / fairness), per-method canvas rendering, science
// outputs (held-out accuracy or R², SHAP additivity residual, LIME surrogate
// local R², fairness gaps, runtime), a seeded benchmark on a synthetic
// 2000-row dataset and CSV export. Block/flow-mode compute accepts a CSV
// string or a `{ csv, method, feature }` object.
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
  PluginRenderContext,
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
} from '../../shared/cs-utils';
import { xaiManifest } from './manifest';
import { XAI_SAMPLE_CSV } from './samples';
import {
  counterfactualSearch,
  fairnessMetrics,
  generateAdultLikeSample,
  kernelShap,
  limeExplain,
  mulberry32,
  parseXaiData,
  partialDependence,
  permutationImportance,
  sensitiveColumn,
  trainReference,
} from './kernel';
import type {
  CounterfactualOutcome,
  FairnessOutcome,
  LimeOutcome,
  PdpCurve,
  PermItem,
  ReferenceModel,
  ShapOutcome,
  TrainOutcome,
  XaiData,
  XaiTask,
} from './kernel';

type XaiMethod = 'permutation' | 'pdp' | 'lime' | 'shap' | 'counterfactual' | 'fairness';

const METHODS: readonly string[] = [
  'permutation',
  'pdp',
  'lime',
  'shap',
  'counterfactual',
  'fairness',
];

/** Low-saturation academic palette (positive / negative signed bars). */
const POS = '#7fa8c9';
const NEG = '#c98d8d';

const PERM_REPEATS = 8;
const PDP_POINTS = 40;
const BENCH_ROWS = 2000;

interface XaiState {
  method: XaiMethod;
  /** Focus feature (partial-dependence sweep target). */
  feature: string;
  limeSamples: number;
  shapCoalitions: number;
  /** Designated binary sensitive column ('' = none selected). */
  sensitive: string;
  seed: number;
}

/** Aggregated result of one explanation run (one of the payloads is set). */
interface XaiRunResult {
  method: XaiMethod;
  task: XaiTask;
  testMetric: number;
  rowCount: number;
  testRows: number;
  runtimeMs: number;
  seed: number;
  feature: string | null;
  permutation?: PermItem[];
  pdp?: PdpCurve;
  lime?: LimeOutcome;
  shap?: ShapOutcome;
  cf?: CounterfactualOutcome;
  fairness?: FairnessOutcome;
}

export class XaiPlugin implements Plugin {
  readonly manifest = xaiManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private text: string;
  private columnNames: string[] = [];
  private featureNames: string[] = [];
  private targetName = '';
  private state: XaiState = {
    method: 'permutation',
    feature: '',
    limeSamples: 800,
    shapCoalitions: 512,
    sensitive: '',
    seed: 20261029,
  };
  private result: XaiRunResult | null = null;
  private dirty = false;

  constructor() {
    // The embedded sample is loaded from the start so the first Run works.
    this.text = XAI_SAMPLE_CSV;
    this.applyParsedDefaults();
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

  async activate(context: PluginRenderContext): Promise<void> {
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
      this.select('method', 'Method', '解释方法', this.state.method, [
        { value: 'permutation', en: 'Permutation Importance', zh: '置换重要性' },
        { value: 'pdp', en: 'Partial Dependence', zh: '部分依赖' },
        { value: 'lime', en: 'LIME', zh: 'LIME 局部解释' },
        { value: 'shap', en: 'SHAP', zh: 'SHAP 归因' },
        { value: 'counterfactual', en: 'Counterfactual', zh: '反事实搜索' },
        { value: 'fairness', en: 'Fairness', zh: '公平性指标' },
      ]),
      this.select(
        'feature',
        'Focus Feature',
        '目标特征',
        this.state.feature,
        (this.featureNames.length > 0 ? this.featureNames : ['']).map((f) => ({
          value: f,
          en: f === '' ? '(none)' : f,
          zh: f === '' ? '（无）' : f,
        })),
      ),
      {
        key: 'limeSamples',
        label: 'LIME Samples',
        labelI18n: { 'zh-CN': 'LIME 扰动样本数', 'en-US': 'LIME Samples' },
        type: 'number',
        min: 50,
        max: 20000,
        step: 50,
        value: this.state.limeSamples,
      },
      {
        key: 'shapCoalitions',
        label: 'SHAP Coalitions',
        labelI18n: { 'zh-CN': 'SHAP 联盟采样数', 'en-US': 'SHAP Coalitions' },
        type: 'number',
        min: 8,
        max: 4096,
        step: 8,
        value: this.state.shapCoalitions,
      },
      this.select(
        'sensitive',
        'Sensitive Column',
        '敏感属性列',
        this.state.sensitive,
        [
          { value: '', en: '(none)', zh: '（无）' },
          ...this.columnNames
            .filter((c) => c !== this.targetName)
            .map((c) => ({ value: c, en: c, zh: c })),
        ],
      ),
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'number',
        min: 1,
        step: 1,
        value: this.state.seed,
      },
      actionButton('run', 'Run', '运行', 'primary'),
      actionButton('loadSample', 'Load Sample', '加载示例'),
      actionButton('benchmark', 'Benchmark', '基准测试'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>): void {
    let changed = false;
    const method = params.method;
    if (typeof method === 'string' && METHODS.includes(method) && method !== this.state.method) {
      this.state.method = method as XaiMethod;
      changed = true;
    }
    if (typeof params.feature === 'string' && params.feature !== this.state.feature) {
      this.state.feature = params.feature;
      changed = true;
    }
    if (typeof params.limeSamples === 'number' && Number.isFinite(params.limeSamples)) {
      const v = Math.min(20000, Math.max(50, Math.round(params.limeSamples)));
      if (v !== this.state.limeSamples) {
        this.state.limeSamples = v;
        changed = true;
      }
    }
    if (typeof params.shapCoalitions === 'number' && Number.isFinite(params.shapCoalitions)) {
      const v = Math.min(4096, Math.max(8, Math.round(params.shapCoalitions)));
      if (v !== this.state.shapCoalitions) {
        this.state.shapCoalitions = v;
        changed = true;
      }
    }
    if (typeof params.sensitive === 'string' && params.sensitive !== this.state.sensitive) {
      this.state.sensitive = params.sensitive;
      changed = true;
    }
    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      const v = Math.max(1, Math.round(params.seed));
      if (v !== this.state.seed) {
        this.state.seed = v;
        changed = true;
      }
    }

    if (actionFired(params, 'run')) {
      this.run(true);
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
      this.exportResultCsv();
      return;
    }

    if (this.dirty || changed) {
      this.dirty = false;
      // Re-run without a toast so the canvas stays in sync with the panel.
      this.run(false);
    }
  }

  // ---- data loading --------------------------------------------------------

  async loadData(file: File): Promise<void> {
    const text = await file.text();
    if (!text.trim()) {
      notify(this.api, 'warning', 'The selected file is empty.', '所选文件为空。');
      return;
    }
    let rows: number;
    try {
      rows = parseXaiData(text).rowCount;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(
        this.api,
        'error',
        `Could not use "${file.name}": ${message}`,
        `无法使用「${file.name}」：${message}`,
      );
      return;
    }
    this.text = text;
    this.applyParsedDefaults();
    this.dirty = true;
    this.ctx?.reportDataScale(rows);
    // Refresh the param panel so the feature / sensitive dropdowns update.
    emit('host:params:changed', { pluginId: this.manifest.id });
    this.run(false);
    notify(
      this.api,
      'success',
      `Loaded ${file.name} (${rows} rows).`,
      `已载入 ${file.name}（${rows} 行）。`,
    );
  }

  private loadSample(): void {
    this.text = XAI_SAMPLE_CSV;
    this.applyParsedDefaults();
    this.dirty = true;
    emit('host:params:changed', { pluginId: this.manifest.id });
    this.run(false);
  }

  /** Refresh cached column lists and dropdown defaults from the CSV text. */
  private applyParsedDefaults(): void {
    try {
      const data = parseXaiData(this.text);
      this.columnNames = data.columns.slice();
      this.featureNames = data.featureNames.slice();
      this.targetName = data.targetName;
      if (!data.featureNames.includes(this.state.feature)) {
        this.state.feature = data.featureNames[0] ?? '';
      }
      const sensitiveUsable =
        this.state.sensitive !== '' &&
        data.columns.includes(this.state.sensitive) &&
        this.state.sensitive !== data.targetName &&
        sensitiveColumn(data, this.state.sensitive) !== null;
      if (!sensitiveUsable) {
        this.state.sensitive =
          data.targetName !== 'sex' && data.columns.includes('sex') ? 'sex' : '';
      }
    } catch {
      this.columnNames = [];
      this.featureNames = [];
      this.targetName = '';
    }
  }

  // ---- explanation run -------------------------------------------------------

  /**
   * Core synchronous pipeline: parse → train the reference model → run the
   * selected explanation method. Throws with a bilingual-friendly message on
   * invalid data / configuration.
   */
  private execute(overrides?: { method?: XaiMethod; feature?: string }): XaiRunResult {
    const method = overrides?.method ?? this.state.method;
    const t0 = performance.now();
    const data: XaiData = parseXaiData(this.text);
    const trained: TrainOutcome = trainReference(data, this.state.seed);
    const model: ReferenceModel = trained.model;
    const Xte = trained.split.testIdx.map((i) => data.X[i]!);
    const yte = trained.split.testIdx.map((i) => data.y[i]!);
    const instance = Xte[0]!;
    // Explanation RNG derives from the seed so every run is reproducible.
    const rng = mulberry32((Math.max(1, Math.round(this.state.seed)) ^ 0x5f356495) >>> 0);

    const res: XaiRunResult = {
      method,
      task: data.task,
      testMetric: trained.testMetric,
      rowCount: data.rowCount,
      testRows: Xte.length,
      runtimeMs: 0,
      seed: this.state.seed,
      feature: null,
    };
    switch (method) {
      case 'permutation':
        res.permutation = permutationImportance(model, Xte, yte, PERM_REPEATS, rng);
        break;
      case 'pdp': {
        const wanted = overrides?.feature ?? this.state.feature;
        const idx = Math.max(0, data.featureNames.indexOf(wanted));
        res.feature = data.featureNames[idx] ?? data.featureNames[0] ?? null;
        res.pdp = partialDependence(model, data.X, idx, PDP_POINTS);
        break;
      }
      case 'lime':
        res.lime = limeExplain(model, instance, this.state.limeSamples, rng);
        break;
      case 'shap':
        res.shap = kernelShap(model, model.means.slice(), instance, this.state.shapCoalitions, rng);
        break;
      case 'counterfactual':
        res.cf = counterfactualSearch(model, trained.split.trainIdx.map((i) => data.X[i]!), instance);
        break;
      case 'fairness': {
        if (data.task !== 'classification') {
          throw new Error('fairness metrics need a binary classification target');
        }
        const sens = this.state.sensitive ? sensitiveColumn(data, this.state.sensitive) : null;
        if (!sens) {
          throw new Error(
            this.state.sensitive
              ? `"${this.state.sensitive}" is not a usable binary sensitive column`
              : 'select a binary sensitive column first',
          );
        }
        // Group fairness is audited over the whole dataset (test-split rates
        // are too noisy on small samples to be meaningful).
        res.fairness = fairnessMetrics(model, data.X, data.y, sens.values, sens.groupNames);
        break;
      }
    }
    res.runtimeMs = performance.now() - t0;
    return res;
  }

  /** Run + publish + draw; `explicit` adds toast notifications. */
  private run(explicit: boolean): XaiRunResult | null {
    if (!this.text.trim()) {
      this.result = null;
      clearScienceOutputs(this.manifest.id);
      this.draw();
      return null;
    }
    try {
      const res = this.execute();
      this.result = res;
      this.dirty = false;
      this.publish(res);
      this.ctx?.reportDataScale(res.rowCount);
      this.draw();
      if (explicit) {
        const metricName =
          res.task === 'classification'
            ? this.zh
              ? '测试准确率'
              : 'test accuracy'
            : this.zh
              ? '测试 R²'
              : 'test R²';
        notify(
          this.api,
          'success',
          `${this.methodLabel(res.method)} finished — ${metricName} ${fmtMetric(res.testMetric, 3)} (${fmtMetric(res.runtimeMs, 4)} ms).`,
          `${this.methodLabel(res.method)}完成 — ${metricName} ${fmtMetric(res.testMetric, 3)}（${fmtMetric(res.runtimeMs, 4)} ms）。`,
        );
      }
      return res;
    } catch (err) {
      this.result = null;
      this.dirty = false;
      clearScienceOutputs(this.manifest.id);
      this.draw();
      const message = err instanceof Error ? err.message : String(err);
      notify(
        this.api,
        'error',
        `Analysis failed: ${message}`,
        `分析失败：${message}`,
      );
      return null;
    }
  }

  private methodLabel(method: XaiMethod): string {
    const zh = this.zh;
    switch (method) {
      case 'permutation':
        return zh ? '置换重要性' : 'Permutation importance';
      case 'pdp':
        return zh ? '部分依赖' : 'Partial dependence';
      case 'lime':
        return zh ? 'LIME 局部解释' : 'LIME';
      case 'shap':
        return zh ? 'SHAP 归因' : 'SHAP';
      case 'counterfactual':
        return zh ? '反事实搜索' : 'Counterfactual search';
      case 'fairness':
        return zh ? '公平性指标' : 'Fairness metrics';
    }
  }

  // ---- benchmark ---------------------------------------------------------------

  /**
   * Seeded benchmark: permutation importance + KernelSHAP (+ LIME for the
   * lime-recovery check) on a synthetic 2000-row dataset, publishing
   * throughput and timing as info science outputs. Stays under ~2 s.
   */
  private async runBenchmark(): Promise<void> {
    try {
      const seed = (Math.max(1, Math.round(this.state.seed)) + 11) >>> 0;
      const csv = generateAdultLikeSample(BENCH_ROWS, seed);
      const t0 = performance.now();
      const data = parseXaiData(csv);
      const trained = trainReference(data, seed);
      const Xte = trained.split.testIdx.map((i) => data.X[i]!);
      const yte = trained.split.testIdx.map((i) => data.y[i]!);
      const instance = Xte[0]!;
      const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
      permutationImportance(trained.model, Xte, yte, 4, rng);
      const shap = kernelShap(trained.model, trained.model.means.slice(), instance, 256, rng);
      const lime = limeExplain(trained.model, instance, 400, rng);
      const totalMs = performance.now() - t0;
      const rowsPerSec = BENCH_ROWS / Math.max(1e-9, totalMs / 1000);
      this.ctx?.reportDataScale(BENCH_ROWS);
      const zh = this.zh;
      const additivityOk = Math.abs(shap.residual) <= 1e-6 * (Math.abs(shap.fX) + 1);
      setScienceOutputs(this.manifest.id, [
        {
          key: 'bench-rows',
          label: zh ? '基准数据行数' : 'Benchmark rows',
          value: String(BENCH_ROWS),
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
          label: zh ? '解释吞吐' : 'Explanation throughput',
          value: `${fmtMetric(rowsPerSec, 4)} rows/s`,
          severity: 'info',
          hint:
            zh
              ? '置换重要性 + KernelSHAP + LIME（含模型训练与留出评估）'
              : 'permutation importance + KernelSHAP + LIME (incl. model training and held-out evaluation)',
        },
        {
          key: 'bench-shap-residual',
          label: zh ? 'SHAP 可加性残差' : 'SHAP additivity residual',
          value: fmtMetric(shap.residual),
          severity: additivityOk ? 'ok' : 'warn',
          hint: zh ? 'f(x) − (基值 + Σφᵢ)，应接近 0' : 'f(x) − (base + Σφᵢ), should be ≈ 0',
        },
        {
          key: 'bench-lime-r2',
          label: zh ? 'LIME 局部 R²' : 'LIME surrogate local R²',
          value: fmtMetric(lime.localR2),
          severity: 'info',
        },
      ]);
      notify(
        this.api,
        'success',
        `Benchmark: ${BENCH_ROWS} rows in ${totalMs.toFixed(0)} ms (${fmtMetric(rowsPerSec, 4)} rows/s).`,
        `基准测试：${BENCH_ROWS} 行，耗时 ${totalMs.toFixed(0)} ms（${fmtMetric(rowsPerSec, 4)} 行/秒）。`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Benchmark failed: ${message}`, `基准测试失败：${message}`);
    }
  }

  // ---- science outputs -------------------------------------------------------

  private publish(res: XaiRunResult): void {
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'model-metric',
        label:
          res.task === 'classification'
            ? zh
              ? '测试准确率'
              : 'Test accuracy'
            : zh
              ? '测试 R²'
              : 'Test R²',
        value: fmtMetric(res.testMetric),
        severity: 'ok',
        hint: zh ? `留出集 ${res.testRows} 行 · seed ${res.seed}` : `held-out ${res.testRows} rows · seed ${res.seed}`,
      },
    ];
    switch (res.method) {
      case 'permutation': {
        const top = (res.permutation ?? [])
          .slice()
          .sort((a, b) => b.meanDrop - a.meanDrop)[0];
        if (top) {
          metrics.push({
            key: 'perm-top',
            label: zh ? '最重要特征' : 'Top feature',
            value: `${top.feature} (${fmtMetric(top.meanDrop, 3)})`,
            severity: 'info',
            hint: zh ? `${PERM_REPEATS} 次重排的平均指标下降` : `mean metric drop over ${PERM_REPEATS} shuffles`,
          });
        }
        break;
      }
      case 'pdp': {
        if (res.pdp) {
          const lo = Math.min(...res.pdp.preds);
          const hi = Math.max(...res.pdp.preds);
          metrics.push({
            key: 'pdp-range',
            label: zh ? 'PDP 输出范围' : 'PDP output range',
            value: `${fmtMetric(lo, 3)} – ${fmtMetric(hi, 3)}`,
            severity: 'info',
            hint: zh ? `特征 ${res.pdp.feature}，其余特征取均值` : `feature ${res.pdp.feature}, others at mean`,
          });
        }
        break;
      }
      case 'lime': {
        if (res.lime) {
          metrics.push({
            key: 'lime-r2',
            label: zh ? 'LIME 局部 R²' : 'LIME surrogate local R²',
            value: fmtMetric(res.lime.localR2),
            severity: res.lime.localR2 >= 0.5 ? 'ok' : 'warn',
            hint: zh ? '加权岭代理模型在扰动集上的拟合优度' : 'weighted ridge surrogate fit on the perturbation set',
          });
          const top = res.lime.weights[0];
          if (top) {
            metrics.push({
              key: 'lime-top',
              label: zh ? '主要局部驱动' : 'Top local driver',
              value: `${top.feature} (${fmtMetric(top.weight, 3)})`,
              severity: 'info',
            });
          }
        }
        break;
      }
      case 'shap': {
        if (res.shap) {
          const ok = Math.abs(res.shap.residual) <= 1e-6 * (Math.abs(res.shap.fX) + 1);
          metrics.push(
            {
              key: 'shap-residual',
              label: zh ? 'SHAP 可加性残差' : 'SHAP additivity residual',
              value: fmtMetric(res.shap.residual),
              severity: ok ? 'ok' : 'warn',
              hint: zh ? 'f(x) − (基值 + Σφᵢ)，验证局部准确性' : 'f(x) − (base + Σφᵢ), local-accuracy check',
            },
            {
              key: 'shap-base',
              label: zh ? '基值 → f(x)' : 'Base → f(x)',
              value: `${fmtMetric(res.shap.base, 3)} → ${fmtMetric(res.shap.fX, 3)}`,
              severity: 'info',
              hint: zh ? `${res.shap.coalitions} 个联盟（含空/全联盟锚点）` : `${res.shap.coalitions} coalitions (incl. empty/full anchors)`,
            },
          );
        }
        break;
      }
      case 'counterfactual': {
        if (res.cf) {
          metrics.push({
            key: 'cf-cost',
            label: zh ? '反事实 L2 代价' : 'Counterfactual L2 cost',
            value: fmtMetric(res.cf.costL2, 3),
            severity: 'info',
            hint: zh
              ? res.cf.flipped
                ? `L1 ${fmtMetric(res.cf.costL1, 3)} · 预测 ${fmtMetric(res.cf.predOriginal, 3)} → ${fmtMetric(res.cf.predCf, 3)}`
                : '搜索范围内未找到可翻转的反事实'
              : res.cf.flipped
                ? `L1 ${fmtMetric(res.cf.costL1, 3)} · prediction ${fmtMetric(res.cf.predOriginal, 3)} → ${fmtMetric(res.cf.predCf, 3)}`
                : 'no flipping counterfactual found within the search range',
          });
        }
        break;
      }
      case 'fairness': {
        const f = res.fairness;
        if (f) {
          const num = (v: number): string => (Number.isFinite(v) ? fmtMetric(v, 3) : '—');
          metrics.push(
            {
              key: 'fair-dp',
              label: zh ? '人口平等差异' : 'Demographic parity diff',
              value: num(f.dpDiff),
              severity: Math.abs(f.dpDiff) > 0.1 ? 'warn' : 'ok',
              hint: zh ? 'P(ŷ=1|G1) − P(ŷ=1|G0)' : 'P(ŷ=1|G1) − P(ŷ=1|G0)',
            },
            {
              key: 'fair-tpr',
              label: zh ? 'TPR 差距' : 'TPR gap',
              value: num(f.tprGap),
              severity: Number.isFinite(f.tprGap) && f.tprGap > 0.1 ? 'warn' : 'ok',
              hint: zh ? '均等化几率（真正率）差距' : 'equalized odds (true-positive-rate) gap',
            },
            {
              key: 'fair-fpr',
              label: zh ? 'FPR 差距' : 'FPR gap',
              value: num(f.fprGap),
              severity: Number.isFinite(f.fprGap) && f.fprGap > 0.1 ? 'warn' : 'ok',
              hint: zh ? '均等化几率（假正率）差距' : 'equalized odds (false-positive-rate) gap',
            },
            {
              key: 'fair-di',
              label: zh ? '差别影响比率' : 'Disparate impact ratio',
              value: num(f.diRatio),
              severity: Number.isFinite(f.diRatio) && f.diRatio < 0.8 ? 'warn' : 'ok',
              hint: zh ? 'min/max 组间正预测率，< 0.8 常视为不利' : 'min/max positive-prediction ratio; < 0.8 commonly adverse',
            },
          );
        }
        break;
      }
    }
    metrics.push({
      key: 'runtime',
      label: zh ? '运行耗时' : 'Runtime',
      value: `${fmtMetric(res.runtimeMs, 4)} ms`,
      unit: 'ms',
      severity: 'info',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- exports ----------------------------------------------------------------

  private exportResultCsv(): void {
    const res = this.result;
    if (!res) {
      notify(this.api, 'warning', 'Run an analysis first.', '请先运行分析。');
      return;
    }
    const num = (v: number | undefined): number | null =>
      v !== undefined && Number.isFinite(v) ? v : null;
    switch (res.method) {
      case 'permutation':
        exportRowsCsv(
          this.api,
          'xai-permutation',
          ['feature', 'mean_metric_drop', 'std'],
          (res.permutation ?? []).map((p) => [p.feature, num(p.meanDrop), num(p.std)]),
        );
        break;
      case 'pdp':
        if (res.pdp) {
          exportRowsCsv(
            this.api,
            'xai-pdp',
            ['grid_value', 'prediction'],
            res.pdp.grid.map((v, i) => [v, num(res.pdp?.preds[i])]),
          );
        }
        break;
      case 'lime':
        if (res.lime) {
          exportRowsCsv(
            this.api,
            'xai-lime',
            ['feature', 'local_weight'],
            res.lime.weights.map((wt) => [wt.feature, num(wt.weight)]),
          );
        }
        break;
      case 'shap':
        if (res.shap) {
          exportRowsCsv(
            this.api,
            'xai-shap',
            ['feature', 'phi'],
            res.shap.phis.map((p) => [p.feature, num(p.phi)]),
          );
        }
        break;
      case 'counterfactual':
        if (res.cf) {
          exportRowsCsv(
            this.api,
            'xai-counterfactual',
            ['feature', 'original', 'counterfactual', 'changed'],
            res.cf.featureNames.map((f, j) => [
              f,
              num(res.cf?.original[j]),
              num(res.cf?.cf[j]),
              res.cf?.changed[j] ? 1 : 0,
            ]),
          );
        }
        break;
      case 'fairness': {
        const f = res.fairness;
        if (f) {
          const g0 = f.groups[0]!;
          const g1 = f.groups[1]!;
          exportRowsCsv(
            this.api,
            'xai-fairness',
            ['metric', `group0_${g0.name}`, `group1_${g1.name}`, 'gap'],
            [
              ['P(pred=1)', num(g0.rate), num(g1.rate), num(f.dpDiff)],
              ['TPR', num(g0.tpr), num(g1.tpr), num(f.tprGap)],
              ['FPR', num(g0.fpr), num(g1.fpr), num(f.fprGap)],
              ['disparate_impact_ratio', null, null, num(f.diRatio)],
              ['support', g0.support, g1.support, g0.support + g1.support],
            ],
          );
        }
        break;
      }
    }
  }

  // ---- block / flow mode -------------------------------------------------------

  async compute(
    input: unknown,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<ComputeResult> {
    const overrides: { method?: XaiMethod; feature?: string } = {};
    if (typeof input === 'string' && input.trim()) {
      this.text = input;
      this.applyParsedDefaults();
      emit('host:params:changed', { pluginId: this.manifest.id });
    } else if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      if (typeof obj.csv === 'string' && obj.csv.trim()) {
        this.text = obj.csv;
        this.applyParsedDefaults();
        emit('host:params:changed', { pluginId: this.manifest.id });
      }
      if (typeof obj.method === 'string' && METHODS.includes(obj.method)) {
        overrides.method = obj.method as XaiMethod;
      }
      if (typeof obj.feature === 'string' && obj.feature) overrides.feature = obj.feature;
    }
    if (!this.text.trim()) {
      return { ok: false, error: 'no data loaded' };
    }
    onProgress?.({ done: 0, total: 1, label: 'xai-explain' });
    try {
      const res = this.execute(overrides);
      this.result = res;
      this.dirty = false;
      this.publish(res);
      this.ctx?.reportDataScale(res.rowCount);
      this.draw();
      onProgress?.({ done: 1, total: 1, label: 'xai-explain' });
      return { ok: true, output: this.summary(res) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Flat machine-readable summary of one run for the compute bus. */
  private summary(res: XaiRunResult): Record<string, unknown> {
    const out: Record<string, unknown> = {
      method: res.method,
      task: res.task,
      metric: res.task === 'classification' ? 'accuracy' : 'r2',
      testMetric: res.testMetric,
      rows: res.rowCount,
      testRows: res.testRows,
      runtimeMs: res.runtimeMs,
      seed: res.seed,
      feature: res.feature,
    };
    if (res.permutation) {
      out.topFeatures = res.permutation
        .slice()
        .sort((a, b) => b.meanDrop - a.meanDrop)
        .slice(0, 3);
    }
    if (res.pdp) {
      out.pdpRange = { min: Math.min(...res.pdp.preds), max: Math.max(...res.pdp.preds) };
    }
    if (res.lime) out.localR2 = res.lime.localR2;
    if (res.shap) out.shapResidual = res.shap.residual;
    if (res.cf) {
      out.counterfactual = {
        flipped: res.cf.flipped,
        costL1: res.cf.costL1,
        costL2: res.cf.costL2,
      };
    }
    if (res.fairness) {
      out.fairness = {
        dpDiff: res.fairness.dpDiff,
        tprGap: res.fairness.tprGap,
        fprGap: res.fairness.fprGap,
        diRatio: res.fairness.diRatio,
      };
    }
    return out;
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
      drawHeader(g, w, zh ? '模型解释器' : 'Model Interpreter', zh ? '等待运行' : 'awaiting run', zh);
      g.fillStyle = CS.dim;
      g.font = font(zh, 12);
      g.textAlign = 'center';
      g.fillText(
        zh
          ? '点击「运行」解释当前数据的参考模型'
          : 'Press "Run" to explain the reference model on the current data.',
        w / 2,
        h / 2 - 6,
      );
      g.fillStyle = CS.faint;
      g.font = font(zh, 10.5);
      g.fillText(
        zh
          ? '内置示例已就绪；也可拖入 CSV 文件（最后一列为目标）。'
          : 'The embedded sample is ready; drop a CSV file to use your own data (last column = target).',
        w / 2,
        h / 2 + 16,
      );
      drawFootnote(
        g,
        w,
        h,
        zh
          ? '方法：置换重要性 · 部分依赖 · LIME · SHAP · 反事实 · 公平性'
          : 'Methods: permutation importance · partial dependence · LIME · SHAP · counterfactual · fairness',
        zh,
      );
      return;
    }
    switch (res.method) {
      case 'permutation':
        this.drawPermutation(g, w, h, res, zh);
        break;
      case 'pdp':
        this.drawPdp(g, w, h, res, zh);
        break;
      case 'lime':
        this.drawLime(g, w, h, res, zh);
        break;
      case 'shap':
        this.drawShap(g, w, h, res, zh);
        break;
      case 'counterfactual':
        this.drawCounterfactual(g, w, h, res, zh);
        break;
      case 'fairness':
        this.drawFairness(g, w, h, res, zh);
        break;
    }
  }

  private subtitle(res: XaiRunResult): string {
    const zh = this.zh;
    const task =
      res.task === 'classification'
        ? zh
          ? '二分类'
          : 'binary classification'
        : zh
          ? '回归'
          : 'regression';
    return `${res.rowCount} ${zh ? '行' : 'rows'} · ${zh ? '留出集' : 'held-out'} ${res.testRows} · ${task} · seed ${res.seed}`;
  }

  /** Horizontal bar chart of the mean metric drop per feature. */
  private drawPermutation(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    res: XaiRunResult,
    zh: boolean,
  ): void {
    drawHeader(
      g,
      w,
      zh ? '置换特征重要性' : 'Permutation Importance',
      this.subtitle(res),
      zh,
    );
    const box = plotBox(w, h, 122, 64, 36, 52);
    g.strokeStyle = CS.axis;
    g.lineWidth = 1;
    g.strokeRect(box.x0, box.y0, box.w, box.h);
    const items = (res.permutation ?? [])
      .slice()
      .sort((a, b) => b.meanDrop - a.meanDrop);
    const n = Math.max(1, items.length);
    const maxDrop = Math.max(...items.map((i) => i.meanDrop + i.std), 1e-9);
    const slot = box.h / n;
    const barH = Math.min(16, slot * 0.55);
    items.forEach((it, i) => {
      const cy = box.y0 + slot * (i + 0.5);
      const c = (Math.max(0, it.meanDrop) / maxDrop) * box.w;
      const e = (it.std / maxDrop) * box.w;
      g.fillStyle = POS;
      g.fillRect(box.x0, cy - barH / 2, Math.max(0, c), barH);
      g.strokeStyle = CS.dim;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(box.x0 + c - e, cy);
      g.lineTo(box.x0 + c + e, cy);
      g.stroke();
      g.fillStyle = CS.dim;
      g.font = font(zh, 10);
      g.textAlign = 'right';
      g.fillText(it.feature, box.x0 - 8, cy + 3.5);
      g.fillStyle = CS.text;
      g.font = font(false, 9.5);
      g.textAlign = 'left';
      g.fillText(fmtMetric(it.meanDrop, 3), box.x0 + c + e + 6, cy + 3.5);
    });
    drawFootnote(
      g,
      w,
      h,
      zh
        ? `条形为指标下降均值（${res.task === 'classification' ? '准确率' : 'R²'}），误差线为 ±1 标准差，${PERM_REPEATS} 次重排。`
        : `Bars: mean metric drop (${res.task === 'classification' ? 'accuracy' : 'R²'}); whiskers: ±1 std over ${PERM_REPEATS} shuffles.`,
      zh,
    );
  }

  /** Line chart of the partial-dependence curve. */
  private drawPdp(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    res: XaiRunResult,
    zh: boolean,
  ): void {
    const curve = res.pdp;
    if (!curve) return;
    drawHeader(g, w, zh ? '部分依赖分析' : 'Partial Dependence', this.subtitle(res), zh);
    const box = plotBox(w, h, 66, 64, 30, 58);
    let lo = Math.min(...curve.preds);
    let hi = Math.max(...curve.preds);
    if (res.task === 'classification') {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 1);
    }
    const pad = (hi - lo) * 0.08 || 0.1;
    lo -= pad;
    hi += pad;
    // t.value is the normalized position (1 = top of the box) mapping to the
    // actual prediction range [lo, hi].
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      value: t,
      label: fmtMetric(lo + t * (hi - lo), 3),
    }));
    const gLo = curve.grid[0] ?? 0;
    const gHi = curve.grid[curve.grid.length - 1] ?? 1;
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      value: t,
      label: fmtMetric(gLo + t * (gHi - gLo), 3),
    }));
    drawAxes(g, box, xTicks, yTicks, curve.feature, zh ? '模型输出' : 'model output', zh);
    const px = (v: number): number =>
      box.x0 + ((v - gLo) / Math.max(1e-12, gHi - gLo)) * box.w;
    const py = (v: number): number =>
      box.y1 - ((v - lo) / Math.max(1e-12, hi - lo)) * box.h;

    // Soft area fill under the curve.
    g.beginPath();
    curve.grid.forEach((v, i) => {
      const X2 = px(v);
      const Y = py(curve.preds[i] ?? 0);
      if (i === 0) g.moveTo(X2, Y);
      else g.lineTo(X2, Y);
    });
    g.lineTo(px(curve.grid[curve.grid.length - 1] ?? gHi), box.y1);
    g.lineTo(px(gLo), box.y1);
    g.closePath();
    g.fillStyle = 'rgba(127,168,201,0.14)';
    g.fill();

    g.beginPath();
    curve.grid.forEach((v, i) => {
      const X2 = px(v);
      const Y = py(curve.preds[i] ?? 0);
      if (i === 0) g.moveTo(X2, Y);
      else g.lineTo(X2, Y);
    });
    g.strokeStyle = POS;
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = POS;
    for (let i = 0; i < curve.grid.length; i += 1) {
      g.beginPath();
      g.arc(px(curve.grid[i]!), py(curve.preds[i] ?? 0), 2, 0, Math.PI * 2);
      g.fill();
    }
    drawLegend(
      g,
      box.x0,
      box.y0 - 10,
      [{ label: `PDP · ${curve.feature}`, color: POS }],
      zh,
    );
    drawFootnote(
      g,
      w,
      h,
      zh
        ? '其余特征固定为均值；曲线为模型输出随目标特征扫动的趋势。'
        : 'Other features held at their mean; the curve shows the model output across the feature sweep.',
      zh,
    );
  }

  /** Shared signed-bar renderer for LIME weights and SHAP attributions. */
  private drawSignedBars(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    res: XaiRunResult,
    entries: Array<{ label: string; value: number }>,
    note: string,
    zh: boolean,
  ): void {
    drawHeader(
      g,
      w,
      res.method === 'shap'
        ? zh
          ? 'SHAP 归因'
          : 'SHAP Attribution'
        : zh
          ? 'LIME 局部解释'
          : 'LIME Local Explanation',
      this.subtitle(res),
      zh,
    );
    const box = plotBox(w, h, 122, 64, 36, 52);
    g.strokeStyle = CS.axis;
    g.lineWidth = 1;
    g.strokeRect(box.x0, box.y0, box.w, box.h);
    const n = Math.max(1, entries.length);
    const maxAbs = Math.max(...entries.map((e) => Math.abs(e.value)), 1e-12);
    const half = box.w / 2;
    const cxMid = box.x0 + half;
    const slot = box.h / n;
    const barH = Math.min(16, slot * 0.55);
    g.strokeStyle = CS.axis;
    g.beginPath();
    g.moveTo(cxMid, box.y0);
    g.lineTo(cxMid, box.y1);
    g.stroke();
    entries.forEach((en, i) => {
      const cy = box.y0 + slot * (i + 0.5);
      const len = (Math.abs(en.value) / maxAbs) * half;
      const pos = en.value >= 0;
      g.fillStyle = pos ? POS : NEG;
      g.fillRect(pos ? cxMid : cxMid - len, cy - barH / 2, Math.max(1, len), barH);
      g.fillStyle = CS.dim;
      g.font = font(zh, 10);
      g.textAlign = 'right';
      g.fillText(en.label, box.x0 - 8, cy + 3.5);
      g.fillStyle = CS.text;
      g.font = font(false, 9.5);
      if (pos) {
        g.textAlign = 'left';
        g.fillText(fmtMetric(en.value, 3), cxMid + len + 5, cy + 3.5);
      } else {
        g.textAlign = 'right';
        g.fillText(fmtMetric(en.value, 3), cxMid - len - 5, cy + 3.5);
      }
    });
    drawFootnote(g, w, h, note, zh);
  }

  private drawLime(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    res: XaiRunResult,
    zh: boolean,
  ): void {
    const lime = res.lime;
    if (!lime) return;
    const entries = lime.weights.map((wt) => ({ label: wt.feature, value: wt.weight }));
    const note = zh
      ? `实例预测 ${fmtMetric(lime.instancePred, 4)} · 代理局部 R² ${fmtMetric(lime.localR2, 3)} · 核宽 ${fmtMetric(lime.kernelWidth, 2)}（标准差单位）· ${lime.samples} 个扰动样本`
      : `instance prediction ${fmtMetric(lime.instancePred, 4)} · surrogate local R² ${fmtMetric(lime.localR2, 3)} · kernel width ${fmtMetric(lime.kernelWidth, 2)} (std units) · ${lime.samples} perturbation samples`;
    this.drawSignedBars(g, w, h, res, entries, note, zh);
  }

  private drawShap(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    res: XaiRunResult,
    zh: boolean,
  ): void {
    const shap = res.shap;
    if (!shap) return;
    const entries = shap.phis
      .slice()
      .sort((a, b) => Math.abs(b.phi) - Math.abs(a.phi))
      .map((p) => ({ label: p.feature, value: p.phi }));
    const ok = Math.abs(shap.residual) <= 1e-6 * (Math.abs(shap.fX) + 1);
    const note = zh
      ? `f(x) ${fmtMetric(shap.fX, 4)} = 基值 ${fmtMetric(shap.base, 4)} + Σφ · 可加性残差 ${fmtMetric(shap.residual, 3)}（${ok ? '通过' : '超差'}，${shap.coalitions} 个联盟）`
      : `f(x) ${fmtMetric(shap.fX, 4)} = base ${fmtMetric(shap.base, 4)} + Σφ · additivity residual ${fmtMetric(shap.residual, 3)} (${ok ? 'pass' : 'off'}, ${shap.coalitions} coalitions)`;
    this.drawSignedBars(g, w, h, res, entries, note, zh);
  }

  /** Original vs counterfactual table with changed cells highlighted. */
  private drawCounterfactual(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    res: XaiRunResult,
    zh: boolean,
  ): void {
    const cf = res.cf;
    if (!cf) return;
    drawHeader(g, w, zh ? '反事实搜索' : 'Counterfactual Search', this.subtitle(res), zh);
    const left = 52;
    const right = 28;
    const top = 68;
    const tableW = w - left - right;
    const colW = [tableW * 0.34, tableW * 0.22, tableW * 0.26, tableW * 0.18];
    const header = [
      zh ? '特征' : 'feature',
      zh ? '原始值' : 'original',
      zh ? '反事实值' : 'counterfactual',
      zh ? '变化' : 'changed',
    ];
    g.font = font(false, 10.5, '600');
    g.textAlign = 'left';
    g.fillStyle = CS.dim;
    let cx = left;
    header.forEach((htext, j) => {
      g.fillText(htext, cx, top);
      cx += colW[j]!;
    });
    g.strokeStyle = CS.axis;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(left, top + 8);
    g.lineTo(w - right, top + 8);
    g.stroke();

    const rows: Array<{ cells: string[]; changed: boolean[]; strong: boolean }> = [
      ...cf.featureNames.map((f, j) => ({
        cells: [
          f,
          fmtMetric(cf.original[j] ?? 0, 4),
          fmtMetric(cf.cf[j] ?? 0, 4),
          cf.changed[j] ? (zh ? '是' : 'yes') : '—',
        ],
        changed: [false, false, Boolean(cf.changed[j]), Boolean(cf.changed[j])],
        strong: false,
      })),
      {
        cells: [
          zh ? '模型输出' : 'model output',
          fmtMetric(cf.predOriginal, 4),
          fmtMetric(cf.predCf, 4),
          cf.flipped ? (zh ? '已翻转' : 'flipped') : zh ? '未找到' : 'not found',
        ],
        changed: [false, false, true, true],
        strong: true,
      },
    ];
    const rowH = Math.max(16, Math.min(24, (h - top - 56) / Math.max(1, rows.length + 1)));
    rows.forEach((row, i) => {
      const y = top + 26 + i * rowH;
      if (y > h - 36) return;
      if (i % 2 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.018)';
        g.fillRect(left - 4, y - rowH + 5, tableW + 8, rowH);
      }
      let x = left;
      row.cells.forEach((cell, j) => {
        if (row.changed[j]) {
          g.fillStyle = 'rgba(255,209,102,0.13)';
          g.fillRect(x - 3, y - rowH + 6, colW[j]! - 4, rowH - 2);
        }
        g.font = font(false, 10.5, row.strong && j === 0 ? '600' : '');
        g.fillStyle = row.changed[j] ? CS.amber : j === 0 ? CS.text : CS.dim;
        g.fillText(cell, x, y);
        x += colW[j]!;
      });
    });
    drawFootnote(
      g,
      w,
      h,
      zh
        ? `L1 代价 ${fmtMetric(cf.costL1, 3)} · L2 代价 ${fmtMetric(cf.costL2, 3)} · 阈值 ${fmtMetric(cf.threshold, 3)}（最小化扰动使预测翻转）`
        : `L1 cost ${fmtMetric(cf.costL1, 3)} · L2 cost ${fmtMetric(cf.costL2, 3)} · threshold ${fmtMetric(cf.threshold, 3)} (minimal perturbation flipping the prediction)`,
      zh,
    );
  }

  /** Grouped fairness metric table. */
  private drawFairness(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    res: XaiRunResult,
    zh: boolean,
  ): void {
    const f = res.fairness;
    if (!f) return;
    drawHeader(g, w, zh ? '公平性指标' : 'Fairness Metrics', this.subtitle(res), zh);
    const g0 = f.groups[0]!;
    const g1 = f.groups[1]!;
    const num = (v: number): string => (Number.isFinite(v) ? fmtMetric(v, 3) : '—');
    const header = [
      zh ? '指标' : 'metric',
      `G0 = ${g0.name}`,
      `G1 = ${g1.name}`,
      zh ? '差距 / 差值' : 'gap / diff',
    ];
    const rows = [
      ['P(pred=1)', num(g0.rate), num(g1.rate), num(f.dpDiff)],
      ['TPR', num(g0.tpr), num(g1.tpr), num(f.tprGap)],
      ['FPR', num(g0.fpr), num(g1.fpr), num(f.fprGap)],
      ['DI ratio', '—', '—', num(f.diRatio)],
      [zh ? '组样本数' : 'group support', String(g0.support), String(g1.support), String(g0.support + g1.support)],
    ];
    drawTable(g, w, h, header, rows, { top: 76, rowHeight: 24, left: 56 });
    drawFootnote(
      g,
      w,
      h,
      zh
        ? 'DP 差值 = P(ŷ=1|G1) − P(ŷ=1|G0)；TPR/FPR 差距构成均等化几率；DI 比率 < 0.8 常被视为不利。'
        : 'DP diff = P(ŷ=1|G1) − P(ŷ=1|G0); TPR/FPR gaps form equalized odds; DI ratio < 0.8 is commonly adverse.',
      zh,
    );
  }
}

export default function createXaiPlugin(): Plugin {
  return new XaiPlugin();
}
