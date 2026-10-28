// ==========================================================================
// neuralviz — Neural Network Visualizer
//
// Teaching MLP with a live network diagram (activations and gradient flow),
// decision-boundary heatmap and loss curve. Deterministic for a fixed seed;
// complements AI Trainer with weight-level transparency.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import {
  CS,
  clamp,
  drawAxes,
  drawCard,
  drawFootnote,
  drawHeader,
  font,
  mix,
  prepareCanvas,
  plotBox,
} from '../../shared/cs-utils';
import { neuralVizFigurePanels } from './figure';
import { neuralVizManifest } from './manifest';
import {
  accuracy,
  activationDerivative,
  backward,
  createMlp,
  decisionGrid,
  exportNetworkJson,
  forward,
  importNetworkJson,
  makeDataset,
  runNeuralBenchmarks,
  train,
  type ActivationId,
  type DatasetId,
  type Mlp,
  type Sample,
  type TrainResult,
} from './kernel';
import type { PlotSpec } from '@/core/plot';

export { neuralVizManifest } from './manifest';

type ViewId = 'network' | 'boundary' | 'loss';
type FlowId = 'forward' | 'backward';

interface State {
  dataset: DatasetId;
  activation: ActivationId;
  hidden: number;
  learningRate: number;
  epochs: number;
  seed: number;
  view: ViewId;
  flow: FlowId;
  sample: number;
}

interface Model {
  mlp: Mlp;
  result: TrainResult;
  data: Sample[];
  key: string;
}

export class NeuralVizPlugin implements Plugin {
  readonly manifest = neuralVizManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private model: Model | null = null;
  private state: State = {
    dataset: 'xor',
    activation: 'tanh',
    hidden: 8,
    learningRate: 0.3,
    epochs: 600,
    seed: 42,
    view: 'network',
    flow: 'forward',
    sample: 3,
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
    this.model = null;
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
    const s = this.state;
    return [
      {
        key: 'dataset',
        label: 'Dataset',
        labelI18n: { 'zh-CN': '数据集', 'en-US': 'Dataset' },
        type: 'select',
        options: [
          { value: 'xor', label: 'XOR' },
          { value: 'circle', label: this.zh ? '同心圆' : 'Concentric circles' },
          { value: 'spiral', label: this.zh ? '双螺旋' : 'Two spirals' },
        ],
        value: s.dataset,
      },
      {
        key: 'activation',
        label: 'Activation',
        labelI18n: { 'zh-CN': '激活函数', 'en-US': 'Activation' },
        type: 'select',
        options: [
          { value: 'sigmoid', label: 'sigmoid' },
          { value: 'tanh', label: 'tanh' },
          { value: 'relu', label: 'ReLU' },
        ],
        value: s.activation,
      },
      { key: 'hidden', label: 'Hidden units', labelI18n: { 'zh-CN': '隐藏单元', 'en-US': 'Hidden units' }, type: 'range', min: 2, max: 16, step: 1, value: s.hidden },
      { key: 'learningRate', label: 'Learning rate', labelI18n: { 'zh-CN': '学习率', 'en-US': 'Learning rate' }, type: 'range', min: 0.01, max: 1, step: 0.01, value: s.learningRate },
      { key: 'epochs', label: 'Epochs', labelI18n: { 'zh-CN': '训练轮数', 'en-US': 'Epochs' }, type: 'range', min: 20, max: 1200, step: 20, value: s.epochs },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'network', label: this.zh ? '网络与梯度' : 'Network & gradients' },
          { value: 'boundary', label: this.zh ? '决策边界' : 'Decision boundary' },
          { value: 'loss', label: this.zh ? '损失曲线' : 'Loss curve' },
        ],
        value: s.view,
      },
      {
        key: 'flow',
        label: 'Flow',
        labelI18n: { 'zh-CN': '数据流', 'en-US': 'Flow' },
        type: 'select',
        options: [
          { value: 'forward', label: this.zh ? '前向激活' : 'Forward activations' },
          { value: 'backward', label: this.zh ? '反向梯度' : 'Backward gradients' },
        ],
        value: s.flow,
        visibleWhen: { key: 'view', in: ['network'] },
      },
      { key: 'sample', label: 'Sample index', labelI18n: { 'zh-CN': '样本下标', 'en-US': 'Sample index' }, type: 'range', min: 0, max: 119, step: 1, value: s.sample, visibleWhen: { key: 'view', in: ['network'] } },
      actionButton('retrain', 'Retrain network', '重新训练', 'primary'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportJson', 'Export network JSON', '导出网络 JSON'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let invalidate = false;
    if (typeof params.dataset === 'string' && ['xor', 'circle', 'spiral'].includes(params.dataset) && params.dataset !== this.state.dataset) {
      this.state.dataset = params.dataset as DatasetId;
      this.state.sample = params.dataset === 'xor' ? 3 : 0;
      invalidate = true;
    }
    if (typeof params.activation === 'string' && ['sigmoid', 'tanh', 'relu'].includes(params.activation) && params.activation !== this.state.activation) {
      this.state.activation = params.activation as ActivationId;
      invalidate = true;
    }
    for (const key of ['hidden', 'epochs'] as const) {
      if (typeof params[key] === 'number' && Number.isFinite(params[key])) {
        const v = Math.round(params[key] as number);
        if (v !== this.state[key]) {
          this.state[key] = v;
          invalidate = true;
        }
      }
    }
    if (typeof params.learningRate === 'number' && Number.isFinite(params.learningRate)) {
      const v = clamp(params.learningRate, 0.01, 1);
      if (v !== this.state.learningRate) {
        this.state.learningRate = v;
        invalidate = true;
      }
    }
    if (typeof params.seed === 'number' && Number.isFinite(params.seed) && params.seed !== this.state.seed) {
      this.state.seed = Math.trunc(params.seed);
      invalidate = true;
    }
    if (typeof params.view === 'string' && ['network', 'boundary', 'loss'].includes(params.view) && params.view !== this.state.view) {
      this.state.view = params.view as ViewId;
      this.draw();
    }
    if ((params.flow === 'forward' || params.flow === 'backward') && params.flow !== this.state.flow) {
      this.state.flow = params.flow as FlowId;
      this.draw();
    }
    if (typeof params.sample === 'number' && Number.isFinite(params.sample)) {
      const s = Math.round(params.sample);
      if (s !== this.state.sample) {
        this.state.sample = s;
        this.draw();
      }
    }
    if (invalidate) {
      this.model = null;
      this.draw();
    }
    if (actionFired(params, 'retrain')) {
      this.model = null;
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportJson')) this.exportJson();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const imported = importNetworkJson(await file.text());
    if (!imported || imported.data.length === 0) {
      notify(this.api, 'warning', 'This JSON is not an Ergalics neuralviz export.', '该 JSON 不是 Ergalics 神经网络导出文件。');
      return;
    }
    const losses = [0, 0];
    this.model = {
      mlp: imported.mlp,
      data: imported.data,
      result: { losses, accuracy: accuracy(imported.mlp, imported.data), epochs: 0 },
      key: 'imported',
    };
    this.state.sample = 0;
    this.draw();
    notify(
      this.api,
      'success',
      `Loaded a ${imported.mlp.sizes.join('→')} network and ${imported.data.length} samples.`,
      `已载入 ${imported.mlp.sizes.join('→')} 网络与 ${imported.data.length} 个样本。`,
    );
  }

  compute(input: unknown) {
    const data = Array.isArray(input) ? (input as Sample[]) : makeDataset(this.state.dataset);
    const mlp = createMlp({ sizes: [2, this.state.hidden, 1], activation: this.state.activation, seed: this.state.seed });
    const result = train(mlp, data, { epochs: this.state.epochs, learningRate: this.state.learningRate, batchSize: 8, seed: this.state.seed + 1 });
    return Promise.resolve({ ok: true as const, output: { result, sizes: mlp.sizes } });
  }

  // ---- model -----------------------------------------------------------------

  private ensureModel(): Model {
    const key = [this.state.dataset, this.state.activation, this.state.hidden, this.state.learningRate, this.state.epochs, this.state.seed].join('|');
    if (this.model && this.model.key === key) return this.model;
    const data = makeDataset(this.state.dataset, this.state.dataset === 'xor' ? 4 : 120, 7);
    const mlp = createMlp({ sizes: [2, this.state.hidden, 1], activation: this.state.activation, seed: this.state.seed });
    const result = train(mlp, data, {
      epochs: this.state.epochs,
      learningRate: this.state.learningRate,
      batchSize: this.state.dataset === 'xor' ? 4 : 16,
      seed: this.state.seed + 1,
    });
    this.model = { mlp, result, data, key };
    return this.model;
  }

  private selected(model: Model): Sample {
    return model.data[clamp(this.state.sample, 0, model.data.length - 1)] ?? model.data[0]!;
  }

  private runBenchmark() {
    const bench = runNeuralBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: `${b.measured} / ${b.expected}`,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0 ? `All ${bench.length} neural-network benchmarks passed.` : `${failed.length}/${bench.length} benchmarks failed.`,
      failed.length === 0 ? `全部 ${bench.length} 项神经网络基准通过。` : `${failed.length}/${bench.length} 项基准未通过。`,
    );
  }

  private exportJson() {
    const model = this.ensureModel();
    this.api.exportFile('neuralviz-network.json', exportNetworkJson(model.mlp, model.data), 'application/json');
    notify(this.api, 'success', 'Network exported as JSON.', '网络已导出为 JSON。');
  }

  private async sendToFigure() {
    const model = this.ensureModel();
    const caption: Bilingual = {
      zh: `神经网络：${this.state.dataset.toUpperCase()} 数据集，结构 2→${this.state.hidden}→1（${this.state.activation}），训练 ${this.state.epochs} 轮，准确率 ${(model.result.accuracy * 100).toFixed(1)}%，末轮损失 ${model.result.losses.at(-1)?.toFixed(5) ?? '—'}。`,
      en: `Neural network: ${this.state.dataset.toUpperCase()}, architecture 2→${this.state.hidden}→1 (${this.state.activation}), ${this.state.epochs} epochs, accuracy ${(model.result.accuracy * 100).toFixed(1)}%, final loss ${model.result.losses.at(-1)?.toFixed(5) ?? '—'}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '神经网络可视化', en: 'Neural Network Visualization' },
      caption,
      neuralVizFigurePanels({ model: model.mlp, result: model.result, data: model.data, sample: this.selected(model) }),
    );
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    const model = this.ensureModel();
    this.publish(model);
    drawHeader(
      g,
      w,
      this.zh ? '神经网络可视化器' : 'Neural Network Visualizer',
      this.zh
        ? `2→${this.state.hidden}→1 · ${this.state.activation} · ${this.state.dataset.toUpperCase()} · 准确率 ${(model.result.accuracy * 100).toFixed(1)}%`
        : `2→${this.state.hidden}→1 · ${this.state.activation} · ${this.state.dataset.toUpperCase()} · accuracy ${(model.result.accuracy * 100).toFixed(1)}%`,
      this.zh,
    );
    if (this.state.view === 'boundary') this.drawBoundary(g, w, h, model);
    else if (this.state.view === 'loss') this.drawLoss(g, w, h, model);
    else this.drawNetwork(g, w, h, model);
  }

  private publish(model: Model) {
    const loss = model.result.losses.at(-1) ?? 0;
    const sample = this.selected(model);
    const grad = backward(model.mlp, sample);
    const gradNorm = Math.sqrt(grad.weights.flat(2).reduce((s, v) => s + v * v, 0));
    const params = model.mlp.weights.flat(2).length + model.mlp.biases.flat().length;
    let saturating = 0;
    for (const sample of model.data) {
      const { z } = forward(model.mlp, sample.x);
      const last = z.at(-1)?.[0] ?? 0;
      if (Math.abs(activationDerivative(model.mlp.activation, last)) < 0.05) saturating += 1;
    }
    const metrics: ScienceMetric[] = [
      { key: 'loss', label: 'Final training loss', value: fmtMetric(loss), severity: loss < 0.1 ? 'ok' : 'warn', hint: 'mean ½(out − target)²' },
      { key: 'accuracy', label: 'Accuracy', value: `${(model.result.accuracy * 100).toFixed(1)}%`, severity: model.result.accuracy > 0.9 ? 'ok' : 'warn' },
      { key: 'params', label: 'Trainable parameters', value: fmtMetric(params), unit: 'weight', severity: 'info', hint: model.mlp.sizes.join(' → ') },
      { key: 'grad-norm', label: 'Gradient norm (sample)', value: fmtMetric(gradNorm), severity: 'info', hint: `sample #${this.state.sample + 1}` },
      { key: 'saturation', label: 'Saturated outputs', value: `${saturating}/${model.data.length}`, severity: saturating > model.data.length / 2 ? 'warn' : 'ok', hint: '|f′| < 0.05 at the output layer' },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private drawNetwork(g: CanvasRenderingContext2D, w: number, h: number, model: Model) {
    const sample = this.selected(model);
    const { activations } = forward(model.mlp, sample.x);
    const grad = backward(model.mlp, sample);
    const box = plotBox(w, h, 50, 72, 34, 66);
    const layers = model.mlp.sizes;
    const maxNodes = Math.max(...layers);
    const colX = (l: number) => box.x0 + (layers.length === 1 ? 0.5 : l / (layers.length - 1)) * box.w;
    const nodeY = (l: number, i: number) => {
      const count = layers[l]!;
      const spacing = Math.min(58, (box.h - 30) / Math.max(1, maxNodes - 1));
      return box.y0 + box.h / 2 + (i - (count - 1) / 2) * spacing;
    };
    const maxW = Math.max(1e-6, ...model.mlp.weights.flat(2).map((v) => Math.abs(v)));
    const maxG = Math.max(1e-6, ...grad.weights.flat(2).map((v) => Math.abs(v)));
    for (let l = 0; l < model.mlp.weights.length; l += 1) {
      const layer = model.mlp.weights[l]!;
      for (let j = 0; j < layer.length; j += 1) {
        for (let i = 0; i < layer[j]!.length; i += 1) {
          const value = this.state.flow === 'forward' ? layer[j]![i]! : grad.weights[l]![j]![i]!;
          const magnitude = this.state.flow === 'forward' ? Math.abs(layer[j]![i]!) / maxW : Math.abs(grad.weights[l]![j]![i]!) / maxG;
          g.strokeStyle = mix('#58657a', value >= 0 ? CS.blue : CS.red, Math.min(1, 0.18 + magnitude));
          g.lineWidth = 0.5 + magnitude * 2.6;
          g.beginPath();
          g.moveTo(colX(l), nodeY(l, i));
          g.lineTo(colX(l + 1), nodeY(l + 1, j));
          g.stroke();
        }
      }
    }
    layers.forEach((count, l) => {
      for (let i = 0; i < count; i += 1) {
        const x = colX(l);
        const y = nodeY(l, i);
        const a = activations[l]?.[i] ?? 0;
        const intensity = Math.min(1, Math.abs(a));
        g.fillStyle = mix('#151d28', a >= 0 ? CS.cyan : CS.amber, 0.2 + intensity * 0.78);
        g.strokeStyle = l === 0 ? CS.blue : l === layers.length - 1 ? CS.amber : 'rgba(166,180,201,0.6)';
        g.lineWidth = 1.3;
        g.beginPath();
        g.arc(x, y, 13, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = intensity > 0.55 ? '#071016' : CS.text;
        g.font = font(false, 8.5, '700');
        g.textAlign = 'center';
        const label = l === 0 ? (i === 0 ? 'x₁' : 'x₂') : l === layers.length - 1 ? 'ŷ' : String(i + 1);
        g.fillText(label, x, y + 3);
        if (Number.isFinite(a)) {
          g.fillStyle = CS.faint;
          g.font = font(false, 8);
          g.fillText(a.toFixed(2), x, y + 26);
        }
      }
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 9);
      g.textAlign = 'center';
      g.fillText(l === 0 ? 'input' : l === layers.length - 1 ? 'output' : this.zh ? `隐藏 ${l}` : `hidden ${l}`, colX(l), box.y0 - 10);
    });
    const p = activations.at(-1)?.[0] ?? 0;
    const verdict = sample.y === 1 ? 'class 1' : 'class 0';
    drawCard(g, w - 220, 58, 188, 44);
    g.textAlign = 'left';
    g.font = font(this.zh, 9);
    g.fillStyle = CS.faint;
    g.fillText(this.zh ? `样本 #${this.state.sample + 1}` : `sample #${this.state.sample + 1}`, w - 208, 75);
    g.font = font(false, 11, '600');
    g.fillStyle = CS.text;
    g.fillText(`(${sample.x[0].toFixed(2)}, ${sample.x[1].toFixed(2)}) → ${p.toFixed(3)} · ${verdict}`, w - 208, 92);
    drawFootnote(
      g,
      w,
      h,
      this.state.flow === 'forward'
        ? this.zh
          ? '前向：节点色深 = 激活值；边色/粗细 = 权重符号/幅值。'
          : 'Forward: node shade = activation; edge colour/width = weight sign/magnitude.'
        : this.zh
          ? '反向：边色/粗细 = ∂L/∂w 符号/幅值；红色为负梯度。'
          : 'Backward: edge colour/width = ∂L/∂w sign/magnitude; red is negative.',
      this.zh,
    );
  }

  private drawLoss(g: CanvasRenderingContext2D, w: number, h: number, model: Model) {
    const box = plotBox(w, h, 66, 72, 30, 62);
    const losses = model.result.losses;
    const max = Math.max(1e-6, ...losses);
    const xOf = (i: number) => box.x0 + (i / Math.max(1, losses.length - 1)) * box.w;
    const yOf = (v: number) => box.y1 - (v / max) * box.h;
    const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: i / 4, label: ((max * i) / 4).toFixed(max < 1 ? 3 : 2) }));
    const xTicks = Array.from({ length: 5 }, (_, i) => ({ value: i / 4, label: String(Math.round((losses.length * i) / 4)) }));
    drawAxes(g, box, xTicks, yTicks, this.zh ? '轮次' : 'epoch', this.zh ? '损失' : 'loss', this.zh);
    g.strokeStyle = CS.cyan;
    g.lineWidth = 1.8;
    g.beginPath();
    losses.forEach((v, i) => {
      if (i === 0) g.moveTo(xOf(i), yOf(v));
      else g.lineTo(xOf(i), yOf(v));
    });
    g.stroke();
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? `末轮损失 ${losses.at(-1)?.toFixed(5) ?? '—'} · 准确率 ${(model.result.accuracy * 100).toFixed(1)}% · ${losses.length} 轮`
        : `final loss ${losses.at(-1)?.toFixed(5) ?? '—'} · accuracy ${(model.result.accuracy * 100).toFixed(1)}% · ${losses.length} epochs`,
      this.zh,
    );
  }

  private drawBoundary(g: CanvasRenderingContext2D, w: number, h: number, model: Model) {
    const grid = decisionGrid(model.mlp, 48);
    const box = plotBox(w, h, 58, 72, 32, 60);
    const cell = Math.max(1, box.w / grid.resolution);
    for (let iy = 0; iy < grid.resolution; iy += 1) {
      for (let ix = 0; ix < grid.resolution; ix += 1) {
        const p = grid.values[iy * grid.resolution + ix]!;
        const y = box.y1 - (iy + 1) * (box.h / grid.resolution);
        g.fillStyle = mix('#1b2740', '#b06a55', p);
        g.fillRect(box.x0 + ix * cell, y, cell + 0.6, box.h / grid.resolution + 0.6);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.strokeRect(box.x0, box.y0, box.w, box.h);
    const px = (x: number) => box.x0 + ((x - grid.min) / (grid.max - grid.min)) * box.w;
    const py = (y: number) => box.y1 - ((y - grid.min) / (grid.max - grid.min)) * box.h;
    for (const sample of model.data) {
      g.fillStyle = sample.y === 1 ? 'rgba(255,209,102,0.95)' : 'rgba(94,230,208,0.95)';
      g.strokeStyle = 'rgba(8,11,16,0.8)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(px(sample.x[0]), py(sample.x[1]), 3.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    const sel = this.selected(model);
    g.strokeStyle = CS.pink;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(px(sel.x[0]), py(sel.x[1]), 8, 0, Math.PI * 2);
    g.stroke();
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? `48×48 网格上的 P(class 1)：蓝→珊瑚；黄=类别 1，青=类别 0，粉圈=当前样本。`
        : `P(class 1) on a 48×48 grid: blue→coral; amber = class 1, cyan = class 0, pink ring = selected sample.`,
      this.zh,
    );
  }
}

export default function createNeuralVizPlugin(): Plugin {
  return new NeuralVizPlugin();
}

// Re-exported for tests and future extensibility.
export type { PlotSpec };
