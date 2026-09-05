// AI Training plugin — main controller. Wires the data layer, models, trainer
// and renderers to the Ergalics Studio plugin contract.

import type {
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
  ParamDefinition,
  ComputeProgress,
  ComputeResult,
} from '@/types/plugin';
import { emit } from '@/core/events';

import type { TF, LayersModel, Tensor } from './tf';
import type {
  Hyperparams,
  ModelKind,
  RawDataset,
  TrainingStatus,
  DecisionPoint,
  ScatterPoint,
} from './types';
import {
  parseCsv,
  parseMnistCsv,
  normalizeRows,
  columnMean,
  flattenImages,
} from './data';
import { MODEL_SPECS, makeOptimizer } from './models';
import { trainModel } from './trainer';
import * as viz from './render';
import { loadTf } from './tf';

export const aiTrainingManifest: PluginManifest = {
  id: 'example.ai-training',
  name: 'AI Trainer',
  nameI18n: { 'zh-CN': 'AI 训练', 'en-US': 'AI Trainer' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Train regression / classification models (TF.js) with live loss curves.',
  descriptionI18n: {
    'zh-CN': '基于 TF.js 训练回归/分类模型，实时显示损失曲线与可视化。',
    'en-US': 'Train regression / classification models with TF.js; live loss curve & visualizations.',
  },
  license: 'MIT',
  entry: 'example.ai-training',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON (MNIST)' },
  ],
};

const ZH = (api: PluginApi | undefined, en: string, zh: string) =>
  api?.locale === 'zh-CN' ? zh : en;

export class AITrainingPlugin implements Plugin {
  readonly manifest = aiTrainingManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private tf: TF | null = null;
  private dataset: RawDataset | null = null;
  private model: LayersModel | null = null;
  private stopRequested = false;

  // Normalization stats + label mapping, reused for partial-dependence plots.
  private normMeans: number[] | null = null;
  private normStds: number[] | null = null;
  private labelMap: Map<number, number> = new Map();

  private status: TrainingStatus = {
    phase: 'idle',
    currentEpoch: 0,
    totalEpochs: 0,
    currentLoss: 0,
    currentAccuracy: null,
    history: [],
    message: '',
  };
  private weightsJson: string | null = null;

  // Visualization cache (rebuilt after each training run).
  private viz: {
    scatter?: ScatterPoint[];
    line?: { x: number[]; y: number[] } | null;
    decision?: { points: DecisionPoint[]; fn: (x: number, y: number) => number };
    mnist?: { images: number[][][]; preds: number[]; trues: number[] };
  } = {};

  private kind: ModelKind = 'linear';
  private hyper: Hyperparams = { ...MODEL_SPECS.linear.defaults };
  private targetColumn: string | null = null;

  async init(api: PluginApi): Promise<void> {
    this.api = api;
  }

  async destroy(): Promise<void> {
    this.model?.dispose();
    this.model = null;
    this.ctx = null;
    this.dataset = null;
    this.viz = {};
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

  getParams(): ParamDefinition[] {
    const p: ParamDefinition[] = [
      {
        key: 'modelType',
        label: 'Model',
        labelI18n: { 'zh-CN': '模型', 'en-US': 'Model' },
        type: 'select',
        value: this.kind,
        options: [
          { value: 'linear', label: 'Linear Regression', labelI18n: { 'zh-CN': '线性回归', 'en-US': 'Linear Regression' } },
          { value: 'nonlinear-nn', label: 'Neural Net (Regression)', labelI18n: { 'zh-CN': '神经网络（回归）', 'en-US': 'Neural Net (Regression)' } },
          { value: 'logistic', label: 'Logistic Regression', labelI18n: { 'zh-CN': '逻辑回归', 'en-US': 'Logistic Regression' } },
          { value: 'mnist', label: 'MNIST CNN', labelI18n: { 'zh-CN': 'MNIST 分类', 'en-US': 'MNIST CNN' } },
        ],
      },
      {
        key: 'learningRate',
        label: 'Learning Rate',
        labelI18n: { 'zh-CN': '学习率', 'en-US': 'Learning Rate' },
        type: 'number',
        min: 0.0001,
        max: 0.1,
        step: 0.001,
        value: this.hyper.learningRate,
      },
      {
        key: 'epochs',
        label: 'Epochs',
        labelI18n: { 'zh-CN': '迭代次数', 'en-US': 'Epochs' },
        type: 'number',
        min: 1,
        max: MODEL_SPECS[this.kind].maxEpochs,
        step: this.kind === 'mnist' ? 1 : 10,
        value: this.hyper.epochs,
      },
      {
        key: 'batchSize',
        label: 'Batch Size',
        labelI18n: { 'zh-CN': '批次大小', 'en-US': 'Batch Size' },
        type: 'number',
        min: 8,
        max: 256,
        step: 8,
        value: this.hyper.batchSize,
      },
    ];

    if (this.kind !== 'mnist') {
      p.push({
        key: 'targetColumn',
        label: 'Target Column',
        labelI18n: { 'zh-CN': '目标列', 'en-US': 'Target Column' },
        type: 'select',
        value: this.targetColumn ?? '',
        options: this.dataset
          ? this.dataset.columnNames.map((c) => ({ value: c, label: c }))
          : [],
      });
    }

    const btn = (key: string, label: string, labelZh: string, variant: 'primary' | 'danger' | 'default', action: string): ParamDefinition => ({
      key,
      label,
      labelI18n: { 'zh-CN': labelZh, 'en-US': label },
      type: 'button',
      variant,
      action,
    });
    p.push(btn('train', 'Train', '开始训练', 'primary', 'train'));
    p.push(btn('stop', 'Stop', '停止', 'danger', 'stop'));
    p.push(btn('export', 'Export Weights', '导出权重', 'default', 'export'));
    return p;
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  updateParams(params: Record<string, unknown>): void {
    const actionOf = (k: string): string | undefined => {
      const v = params[k];
      if (v && typeof v === 'object' && 'action' in v) return (v as { action: string }).action;
      return undefined;
    };

    if (typeof params.modelType === 'string' && params.modelType !== this.kind) {
      // Each model has its own workable step size / epoch budget; carrying the
      // previous model's numbers over would either stall training or hang the tab.
      this.setKind(params.modelType as ModelKind);
    }
    if (typeof params.learningRate === 'number') this.hyper.learningRate = params.learningRate;
    if (typeof params.epochs === 'number') this.hyper.epochs = Math.max(1, Math.floor(params.epochs));
    if (typeof params.batchSize === 'number') this.hyper.batchSize = Math.max(1, Math.floor(params.batchSize));
    if (typeof params.targetColumn === 'string') this.targetColumn = params.targetColumn;

    if (actionOf('train') === 'train') void this.runTraining();
    else if (actionOf('stop') === 'stop') this.requestStop();
    else if (actionOf('export') === 'export') this.exportWeights();
  }

  /** Pick the model kind from the file name (sample hints) or the column
   *  count, so a sample loaded from the data dialog selects the right model. */
  private inferKind(name: string, text: string): ModelKind | null {
    const n = name.toLowerCase();
    if (n.includes('mnist')) return 'mnist';
    if (n.includes('logistic')) return 'logistic';
    if (n.includes('nonlinear')) return 'nonlinear-nn';
    if (n.includes('linear')) return 'linear';
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    const cols = first.split(/[\s,]+/).filter(Boolean).length;
    if (cols === 785) return 'mnist';
    if (cols === 3) return 'logistic';
    if (cols === 2) return 'linear';
    return null;
  }

  /** Switch the active model, adopting its starting hyperparameters and
   *  refreshing the param panel (epoch bounds, target column). */
  private setKind(kind: ModelKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.hyper = { ...MODEL_SPECS[kind].defaults };
    this.resetTraining();
    emit('host:params:changed', { pluginId: this.manifest.id });
    this.draw();
  }

  async loadData(file: File): Promise<void> {
    const text = await file.text();
    const trimmed = text.trim();
    const inferred = this.inferKind(file.name, trimmed);
    if (inferred && inferred !== this.kind) this.setKind(inferred);

    if (this.kind === 'mnist') {
      // MNIST ships as JSON {images,labels} or a 785-column CSV (label,p0..p783).
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed) as { images?: unknown; labels?: unknown };
          if (Array.isArray(parsed?.images) && Array.isArray(parsed?.labels)) {
            this.dataset = {
              columnNames: ['pixel'],
              rows: [],
              isImage: true,
              images: parsed.images as number[][][],
              labels: parsed.labels as number[],
            };
            this.finishLoad();
            return;
          }
        } catch {
          /* fall through to CSV */
        }
      }
      const ds = parseMnistCsv(text);
      if (ds.images && ds.images.length > 0) {
        this.dataset = ds;
        this.finishLoad();
        return;
      }
      this.api.notify('warning', ZH(this.api, 'Could not parse MNIST data', '无法解析 MNIST 数据'));
      return;
    }

    const { columnNames, rows } = parseCsv(text);
    if (rows.length < 4) {
      this.api.notify('warning', ZH(this.api, 'Could not parse enough numeric rows', '未能解析出足够的数值行'));
      return;
    }
    this.dataset = { columnNames, rows, isImage: false };
    this.finishLoad();
  }

  private finishLoad(): void {
    this.targetColumn =
      this.kind === 'mnist' ? null : this.dataset!.columnNames[this.dataset!.columnNames.length - 1]!;
    this.resetTraining();
    this.api.reportDataScale(this.dataset!.rows.length || this.dataset!.images?.length || 0);
    // Refresh the param panel so the target-column dropdown is populated.
    emit('host:params:changed', { pluginId: this.manifest.id });
    this.draw();
    this.api.notify('success', ZH(this.api, 'Data loaded', '数据已加载'));
  }

  async compute(
    _input: unknown,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<ComputeResult> {
    if (!this.dataset || (this.dataset.rows.length === 0 && this.dataset.images?.length === 0)) {
      return { ok: false, error: 'no data' };
    }
    await this.runTraining(onProgress);
    return {
      ok: this.status.phase !== 'error',
      output: { loss: this.status.currentLoss, accuracy: this.status.currentAccuracy },
    };
  }

  // ---- Training ---------------------------------------------------------

  private requestStop(): void {
    if (this.status.phase === 'training') {
      this.stopRequested = true;
      this.api.notify('info', ZH(this.api, 'Stopping after current epoch', '将在本轮结束后停止'));
    }
  }

  private resetTraining(): void {
    this.model?.dispose();
    this.model = null;
    this.status = {
      phase: 'idle',
      currentEpoch: 0,
      totalEpochs: 0,
      currentLoss: 0,
      currentAccuracy: null,
      history: [],
      message: '',
    };
    this.weightsJson = null;
    this.viz = {};
    this.normMeans = null;
    this.normStds = null;
    this.labelMap = new Map();
  }

  private async ensureTf(): Promise<TF> {
    if (!this.tf) this.tf = await loadTf();
    return this.tf;
  }

  private async runTraining(onProgress?: (p: ComputeProgress) => void): Promise<void> {
    // The old guard only rejected *empty* datasets, so leaving a CSV loaded
    // while switching the model to MNIST sailed straight through and crashed
    // on `this.dataset.images!` being undefined. Validate per model kind.
    const hasRows = (this.dataset?.rows.length ?? 0) > 0;
    const hasImages =
      (this.dataset?.images?.length ?? 0) > 0 && (this.dataset?.labels?.length ?? 0) > 0;
    if (!this.dataset || (!hasRows && !hasImages)) {
      this.api.notify('warning', ZH(this.api, 'Load data first (drop a file or Load Sample)', '请先加载数据（拖入文件或点击加载示例）'));
      return;
    }
    if (this.kind === 'mnist' && !hasImages) {
      this.api.notify('warning', ZH(this.api, 'The MNIST model needs image data — load the MNIST sample or choose another model', 'MNIST 模型需要图像数据——请加载 MNIST 示例或选择其他模型'));
      return;
    }
    if (this.kind !== 'mnist' && !hasRows) {
      this.api.notify('warning', ZH(this.api, 'This model needs tabular data — load a CSV sample or choose the MNIST model', '该模型需要表格数据——请加载 CSV 示例或选择 MNIST 模型'));
      return;
    }
    if (this.status.phase === 'training') return;

    const tf = await this.ensureTf();
    this.stopRequested = false;
    const spec = MODEL_SPECS[this.kind];
    this.status.phase = 'training';
    this.status.history = [];
    this.status.totalEpochs = this.hyper.epochs;

    // ---- Prepare tensors ----
    let xs: Tensor;
    let ys: Tensor;
    let inputShape: number[];
    let rawXs: number[][] = [];
    let rawYs: number[] = [];

    if (this.kind === 'mnist') {
      const imgs = this.dataset.images!;
      const labels = this.dataset.labels!;
      xs = tf.tidy(() => tf.tensor4d(flattenImages(imgs), [imgs.length, 28, 28, 1]));
      ys = tf.tidy(() => tf.oneHot(tf.tensor1d(labels, 'int32'), 10));
      inputShape = [28, 28, 1];
      this.viz = {};
    } else {
      const names = this.dataset.columnNames;
      const targetIdx = Math.max(
        0,
        this.targetColumn ? names.indexOf(this.targetColumn) : names.length - 1,
      );
      const featCols = names.map((_, i) => i).filter((i) => i !== targetIdx);
      rawXs = this.dataset.rows.map((r) => featCols.map((i) => r[i]!));
      rawYs = this.dataset.rows.map((r) => r[targetIdx]!);

      if (spec.needsNormalization) {
        const { norm, means, stds } = normalizeRows(rawXs);
        this.normMeans = means;
        this.normStds = stds;
        xs = tf.tensor2d(norm);
      } else {
        xs = tf.tensor2d(rawXs);
      }

      if (spec.task === 'regression') {
        ys = tf.tensor2d(rawYs.map((y) => [y]));
        inputShape = [featCols.length];
      } else {
        const uniq = [...new Set(rawYs)].sort((a, b) => a - b);
        this.labelMap = new Map(uniq.map((v, i) => [v, i]));
        const bin = rawYs.map((y) => this.labelMap.get(y) ?? 0);
        ys = tf.tensor2d(bin.map((y) => [y]));
        inputShape = [featCols.length];
      }

      // Seed the bottom view with raw data so it animates during training.
      if (spec.task === 'regression') {
        this.viz.scatter = rawXs.map((r, i) => ({ x: r[0]!, y: rawYs[i]! }));
        this.viz.line = null;
      } else if ((rawXs[0]?.length ?? 0) >= 2) {
        this.viz.decision = {
          points: rawXs.map((r, i) => ({ x: r[0]!, y: r[1]!, label: this.labelMap.get(rawYs[i]!) ?? 0 })),
          fn: () => 0.5,
        };
      }
    }

    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    const model = spec.build(tf, inputShape);
    model.compile({
      loss: spec.loss,
      optimizer: makeOptimizer(tf, spec.optimizer, this.hyper.learningRate),
      metrics: spec.metrics,
    });
    this.model = model;

    const total = Math.max(1, Math.floor(this.hyper.epochs));
    const throttle = Math.max(1, Math.floor(total / 40));
    let lastDraw = 0;

    // xs/ys live on the WebGL heap, not the JS GC. Run training in a try so a
    // thrown error still releases them — otherwise repeated runs exhaust VRAM.
    let trainResult: Awaited<ReturnType<typeof trainModel>>;
    try {
      trainResult = await trainModel(
        model,
        xs,
        ys,
        this.hyper,
        (rec) => {
          this.status.currentEpoch = rec.epoch;
          this.status.currentLoss = rec.loss;
          this.status.currentAccuracy = rec.accuracy ?? null;
          onProgress?.({ done: rec.epoch, total, label: spec.label });
          if (rec.epoch - lastDraw >= throttle || rec.epoch === total) {
            lastDraw = rec.epoch;
            this.draw();
          }
        },
        () => this.stopRequested,
      );
    } finally {
      xs.dispose();
      ys.dispose();
    }

    this.computeViz(tf, spec, rawXs, rawYs);
    this.status.phase = this.stopRequested ? 'stopped' : 'done';
    const lastRec = trainResult.history.at(-1);
    this.status.currentEpoch = lastRec ? lastRec.epoch : total;
    this.weightsJson = this.serializeWeights(model);

    const accTxt =
      this.status.currentAccuracy != null
        ? ` | acc ${(this.status.currentAccuracy * 100).toFixed(1)}%`
        : '';
    this.api.notify(
      this.status.phase === 'done' ? 'success' : 'info',
      ZH(
        this.api,
        `${this.status.phase === 'done' ? 'Training complete' : 'Training stopped'} — loss ${this.status.currentLoss.toFixed(4)}${accTxt}`,
        `${this.status.phase === 'done' ? '训练完成' : '已停止'} — 损失 ${this.status.currentLoss.toFixed(4)}${accTxt}`,
      ),
    );
    this.draw();
  }

  /** Build the model-specific view (fit line / decision surface / MNIST grid). */
  private computeViz(
    tf: TF,
    spec: (typeof MODEL_SPECS)[ModelKind],
    rawXs: number[][],
    rawYs: number[],
  ): void {
    if (!this.model) return;

    if (spec.task === 'regression') {
      const xsCol = rawXs.map((r) => r[0]!);
      const minX = Math.min(...xsCol);
      const maxX = Math.max(...xsCol);
      const n = 60;
      const gx: number[] = [];
      const gy: number[] = [];
      const meanVec = rawXs[0]?.map((_, j) => columnMean(rawXs, j)) ?? null;
      const norm = spec.needsNormalization && this.normMeans && this.normStds;
      for (let i = 0; i < n; i += 1) {
        const x = minX + ((maxX - minX) * i) / (n - 1);
        let feat: number[];
        if (rawXs[0]?.length === 1) feat = [x];
        else feat = rawXs[0]!.map((_, j) => (j === 0 ? x : meanVec![j]!));
        if (norm) feat = feat.map((v, j) => (v - this.normMeans![j]!) / this.normStds![j]!);
        const t = tf.tensor2d([feat]);
        const p = (this.model.predict(t) as Tensor).dataSync()[0]!;
        t.dispose();
        gx.push(x);
        gy.push(p);
      }
      this.viz.scatter = rawXs.map((r, i) => ({ x: r[0]!, y: rawYs[i]! }));
      this.viz.line = { x: gx, y: gy };
      return;
    }

    if (spec.kind === 'logistic') {
      if ((rawXs[0]?.length ?? 0) >= 2) {
        const meanVec = rawXs[0]!.map((_, j) => columnMean(rawXs, j));
        const norm = this.normMeans && this.normStds;
        const fn = (x: number, y: number): number => {
          let feat: number[] = rawXs[0]!.map((_, j) => (j === 0 ? x : j === 1 ? y : meanVec[j]!));
          if (norm) feat = feat.map((v, j) => (v - this.normMeans![j]!) / this.normStds![j]!);
          const t = tf.tensor2d([feat]);
          const p = (this.model!.predict(t) as Tensor).dataSync()[0]!;
          t.dispose();
          return p;
        };
        this.viz.decision = {
          points: rawXs.map((r, i) => ({ x: r[0]!, y: r[1]!, label: this.labelMap.get(rawYs[i]!) ?? 0 })),
          fn,
        };
      }
      return;
    }

    if (spec.kind === 'mnist') {
      const imgs = this.dataset!.images!;
      const labels = this.dataset!.labels!;
      const m = Math.min(24, imgs.length);
      const batch = tf.tidy(() => tf.tensor4d(flattenImages(imgs.slice(0, m)), [m, 28, 28, 1]));
      const predsTensor = this.model.predict(batch) as Tensor;
      const preds = Array.from(predsTensor.argMax(-1).dataSync());
      batch.dispose();
      predsTensor.dispose();
      this.viz.mnist = { images: imgs.slice(0, m), preds, trues: labels.slice(0, m) };
    }
  }

  private serializeWeights(model: LayersModel): string {
    const ws = model.getWeights() as unknown as Array<{
      name: string;
      shape: number[];
      dataSync: () => Float32Array;
    }>;
    const payload = {
      model: this.kind,
      weights: ws.map((w) => ({
        name: w.name,
        shape: w.shape,
        data: Array.from(w.dataSync()),
      })),
    };
    return JSON.stringify(payload);
  }

  private exportWeights(): void {
    if (!this.weightsJson) {
      this.api.notify('warning', ZH(this.api, 'Train a model first', '请先训练模型'));
      return;
    }
    const blob = new Blob([this.weightsJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.kind}-weights.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.api.notify('success', ZH(this.api, 'Weights exported', '权重已导出'));
  }

  // ---- Rendering --------------------------------------------------------

  private draw(): void {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const locale = this.api?.locale ?? 'zh-CN';
    const W = canvas.clientWidth || 400;
    const H = canvas.clientHeight || 300;
    // Only resize when needed; resizing resets the context transform.
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const g = canvas.getContext('2d');
    if (!g) return;

    if (!this.dataset && this.status.history.length === 0) {
      viz.drawMessage(g, canvas, { x: 0, y: 0, w: W, h: H }, ZH(this.api, 'Drop a CSV/JSON file or click "Load Sample"', '拖入 CSV/JSON 文件或点击「加载示例」'));
      return;
    }

    const lossH = Math.round(H * 0.42);
    viz.drawLossCurve(g, canvas, { x: 0, y: 0, w: W, h: lossH }, this.status.history, locale);

    const bottom: viz.Rect = { x: 0, y: lossH + 8, w: W, h: H - lossH - 8 };

    if (this.status.phase === 'training') {
      viz.drawMessage(
        g,
        canvas,
        bottom,
        ZH(this.api, `Training… epoch ${this.status.currentEpoch}/${this.status.totalEpochs}`, `训练中… 第 ${this.status.currentEpoch}/${this.status.totalEpochs} 轮`),
      );
    } else if (this.viz.mnist) {
      viz.drawMnistGrid(g, canvas, bottom, this.viz.mnist.images, this.viz.mnist.preds, this.viz.mnist.trues, locale);
    } else if (this.viz.decision) {
      viz.drawDecisionBoundary(g, canvas, bottom, this.viz.decision.points, this.viz.decision.fn, locale);
    } else if (this.viz.scatter || this.viz.line) {
      viz.drawScatterFit(g, canvas, bottom, this.viz.scatter ?? [], this.viz.line ?? null, locale);
    } else {
      viz.drawMessage(g, canvas, bottom, ZH(this.api, 'Results appear after training', '训练完成后显示结果'));
    }

    const acc = this.status.currentAccuracy != null ? ` | acc ${(this.status.currentAccuracy * 100).toFixed(1)}%` : '';
    viz.drawHud(
      g,
      canvas,
      `phase: ${this.status.phase} | epoch: ${this.status.currentEpoch}/${this.status.totalEpochs} | loss: ${this.status.currentLoss.toFixed(4)}${acc}`,
    );
  }
}

export default function createAITrainingPlugin(): Plugin {
  return new AITrainingPlugin();
}
