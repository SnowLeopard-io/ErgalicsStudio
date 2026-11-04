// ==========================================================================
// complexity — Complexity Analyzer
//
// Fits empirical n/time measurements to O(1), O(log n), O(n), O(n log n),
// O(n²), O(n³) and O(2ⁿ), ranks them by R², and plots both the raw fit and
// the log-log power-law slope. CSV n,time is the Block/Flow entry point.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import {
  CS,
  drawAxes,
  drawFootnote,
  drawHeader,
  drawTable,
  font,
  prepareCanvas,
  plotBox,
} from '../../shared/cs-utils';
import { complexityFigurePanels } from './figure';
import { complexityManifest } from './manifest';
import {
  MODELS,
  MODEL_IDS,
  analyseComplexity,
  fitModel,
  parseMeasurements,
  powerLaw,
  runComplexityBenchmarks,
  syntheticRuns,
  type Analysis,
  type Measurement,
  type ModelId,
  type SyntheticId,
} from './kernel';

export { complexityManifest } from './manifest';

type ViewId = 'fit' | 'loglog' | 'ranking';

function sizesFor(kind: SyntheticId): number[] {
  return kind === 'exponential' ? [8, 10, 12, 14, 16, 18, 20, 22] : [8, 16, 32, 64, 128, 256, 512];
}

export class ComplexityPlugin implements Plugin {
  readonly manifest = complexityManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private data: Measurement[] = syntheticRuns('quadratic', sizesFor('quadratic'), 0.03, 11);
  private state = {
    view: 'fit' as ViewId,
    synthetic: 'quadratic' as SyntheticId,
    noise: 0.03,
    model: 'auto' as ModelId | 'auto',
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
    const s = this.state;
    return [
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'fit', label: this.zh ? '拟合曲线' : 'Fit curve' },
          { value: 'loglog', label: this.zh ? '双对数' : 'Log-log' },
          { value: 'ranking', label: this.zh ? '模型排名' : 'Model ranking' },
        ],
        value: s.view,
      },
      {
        key: 'synthetic',
        label: 'Synthetic dataset',
        labelI18n: { 'zh-CN': '合成数据集', 'en-US': 'Synthetic dataset' },
        type: 'select',
        options: [
          { value: 'constant', label: 'O(1)' },
          { value: 'linear', label: 'O(n)' },
          { value: 'nlogn', label: 'O(n log n)' },
          { value: 'quadratic', label: 'O(n²)' },
          { value: 'cubic', label: 'O(n³)' },
          { value: 'exponential', label: 'O(2ⁿ)' },
        ],
        value: s.synthetic,
      },
      { key: 'noise', label: 'Noise (fraction)', labelI18n: { 'zh-CN': '噪声（比例）', 'en-US': 'Noise (fraction)' }, type: 'range', min: 0, max: 0.2, step: 0.005, value: s.noise },
      {
        key: 'model',
        label: 'Overlay model',
        labelI18n: { 'zh-CN': '叠加模型', 'en-US': 'Overlay model' },
        type: 'select',
        options: [{ value: 'auto', label: this.zh ? '自动（最佳）' : 'auto (best)' }, ...MODEL_IDS.map((id) => ({ value: id, label: `${MODELS[id].latex} ${this.zh ? MODELS[id].zh : MODELS[id].en}` }))],
        value: s.model,
        visibleWhen: { key: 'view', in: ['fit', 'loglog'] },
      },
      actionButton('generate', 'Regenerate synthetic data', '重新生成合成数据', 'primary'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export fit CSV', '导出拟合 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let regenerate = false;
    if (typeof params.view === 'string' && ['fit', 'loglog', 'ranking'].includes(params.view) && params.view !== this.state.view) {
      this.state.view = params.view as ViewId;
      this.draw();
    }
    if (typeof params.synthetic === 'string' && ['constant', 'linear', 'nlogn', 'quadratic', 'cubic', 'exponential'].includes(params.synthetic) && params.synthetic !== this.state.synthetic) {
      this.state.synthetic = params.synthetic as SyntheticId;
      regenerate = true;
    }
    if (typeof params.noise === 'number' && Number.isFinite(params.noise)) {
      const noise = Math.min(0.2, Math.max(0, params.noise));
      if (noise !== this.state.noise) {
        this.state.noise = noise;
        regenerate = true;
      }
    }
    if (params.model === 'auto' || (typeof params.model === 'string' && MODEL_IDS.includes(params.model as ModelId))) {
      if (params.model !== this.state.model) {
        this.state.model = params.model as ModelId | 'auto';
        this.draw();
      }
    }
    if (regenerate) this.regenerate();
    if (actionFired(params, 'generate')) this.regenerate();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const data = parseMeasurements(await file.text());
    if (data.length < 3) {
      notify(this.api, 'warning', 'Need at least three n,time rows.', '至少需要三行 n,time 数据。');
      return;
    }
    this.data = data;
    this.state.view = 'fit';
    this.draw();
    notify(this.api, 'success', `Loaded ${data.length} measurements from ${file.name}.`, `已从 ${file.name} 载入 ${data.length} 个测量点。`);
  }

  compute(input: unknown) {
    const data = Array.isArray(input) ? (input as Measurement[]) : this.data;
    return Promise.resolve({ ok: true as const, output: analyseComplexity(data) });
  }

  // ---- model -----------------------------------------------------------------

  private analysis(): Analysis {
    return analyseComplexity(this.data);
  }

  private regenerate() {
    this.data = syntheticRuns(this.state.synthetic, sizesFor(this.state.synthetic), this.state.noise, 11);
    this.draw();
  }

  private overlay(): { id: ModelId; label: string } {
    const analysis = this.analysis();
    const id = this.state.model === 'auto' ? analysis.best.id : this.state.model;
    return { id, label: `${MODELS[id].latex} ${this.zh ? MODELS[id].zh : MODELS[id].en}` };
  }

  private runBenchmark() {
    const bench = runComplexityBenchmarks();
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
      failed.length === 0 ? `All ${bench.length} complexity benchmarks passed.` : `${failed.length}/${bench.length} benchmarks failed.`,
      failed.length === 0 ? `全部 ${bench.length} 项复杂度基准通过。` : `${failed.length}/${bench.length} 项基准未通过。`,
    );
  }

  private exportCsv() {
    const analysis = this.analysis();
    exportRowsCsv(
      this.api,
      'complexity-fit',
      ['model', 'scale', 'r2', 'rmse', 'predictions'],
      analysis.fits.map((f) => [MODELS[f.id].latex, Number(f.scale.toPrecision(8)), Number(f.r2.toPrecision(8)), Number(f.rmse.toPrecision(8)), f.predictions.map((v) => Number(v.toPrecision(6))).join(' ')]),
    );
  }

  private async sendToFigure() {
    const analysis = this.analysis();
    const best = analysis.best;
    const caption: Bilingual = {
      zh: `复杂度分析：${this.data.length} 个测量点；最佳模型 ${MODELS[best.id].latex}（R²=${best.r2.toFixed(5)}，RMSE=${best.rmse.toPrecision(3)}），双对数斜率 ${analysis.exponent.toFixed(3)}。`,
      en: `Complexity analysis: ${this.data.length} measurements; best ${MODELS[best.id].latex} (R²=${best.r2.toFixed(5)}, RMSE=${best.rmse.toPrecision(3)}), log-log slope ${analysis.exponent.toFixed(3)}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '复杂度分析', en: 'Complexity Analysis' },
      caption,
      complexityFigurePanels({ data: this.data, analysis, overlay: this.overlay().id }),
    );
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    const analysis = this.analysis();
    this.publish(analysis);
    drawHeader(
      g,
      w,
      this.zh ? '复杂度分析器' : 'Complexity Analyzer',
      this.zh
        ? `${this.data.length} 个测量点 · 最佳 ${MODELS[analysis.best.id].latex} · R² ${analysis.best.r2.toFixed(5)} · 斜率 ${analysis.exponent.toFixed(3)}`
        : `${this.data.length} measurements · best ${MODELS[analysis.best.id].latex} · R² ${analysis.best.r2.toFixed(5)} · slope ${analysis.exponent.toFixed(3)}`,
      this.zh,
    );
    if (this.state.view === 'ranking') this.drawRanking(g, w, h, analysis);
    else if (this.state.view === 'loglog') this.drawLogLog(g, w, h, analysis);
    else this.drawFit(g, w, h, analysis);
  }

  private publish(analysis: Analysis) {
    const best = analysis.best;
    const metrics: ScienceMetric[] = [
      { key: 'best-model', label: 'Best model', value: MODELS[best.id].latex, severity: 'ok', hint: this.zh ? MODELS[best.id].zh : MODELS[best.id].en },
      { key: 'r2', label: 'R²', value: fmtMetric(best.r2), severity: best.r2 > 0.98 ? 'ok' : best.r2 > 0.9 ? 'warn' : 'error', hint: 'ordinary least squares, one scale factor' },
      { key: 'rmse', label: 'RMSE', value: fmtMetric(best.rmse), unit: 'ms', severity: 'info' },
      { key: 'exponent', label: 'Log-log exponent', value: fmtMetric(analysis.exponent), severity: 'info', hint: `power-law R² ${analysis.powerR2.toFixed(4)}` },
      { key: 'points', label: 'Measurements', value: String(this.data.length), unit: 'point', severity: 'info' },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private drawFit(g: CanvasRenderingContext2D, w: number, h: number, _analysis: Analysis) {
    const box = plotBox(w, h, 68, 72, 30, 62);
    const overlay = this.overlay();
    const fit = fitModel(overlay.id, this.data);
    const all = [...this.data.map((d) => d.time), ...fit.predictions];
    const maxY = Math.max(1e-9, ...all);
    const maxX = Math.max(1, ...this.data.map((d) => d.n));
    const xOf = (n: number) => box.x0 + (n / maxX) * box.w;
    const yOf = (v: number) => box.y1 - (v / maxY) * box.h;
    const xTicks = Array.from({ length: 6 }, (_, i) => ({ value: i / 5, label: String(Math.round((maxX * i) / 5)) }));
    const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: i / 4, label: (maxY * i / 4).toPrecision(2) }));
    drawAxes(g, box, xTicks, yTicks, 'n', this.zh ? '运行时间 (ms)' : 'runtime (ms)', this.zh);
    const ordered = [...this.data].sort((a, b) => a.n - b.n);
    g.strokeStyle = CS.cyan;
    g.lineWidth = 2;
    g.beginPath();
    ordered.forEach((d, i) => {
      const modelIndex = this.data.indexOf(d);
      const x = xOf(d.n);
      const y = yOf(fit.predictions[modelIndex] ?? 0);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
    for (const d of this.data) {
      g.fillStyle = CS.amber;
      g.beginPath();
      g.arc(xOf(d.n), yOf(d.time), 4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 10);
    g.textAlign = 'left';
    g.fillText(`${overlay.label} · R²=${fit.r2.toFixed(4)} · RMSE=${fit.rmse.toPrecision(3)}`, box.x0, box.y0 - 12);
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? '黄点=实测；青线=单尺度最小二乘拟合。浏览器计时有噪声，模型排名仅作启发式证据。'
        : 'Amber points = measurements; cyan line = one-scale least-squares fit. Browser timing is noisy, so the ranking is heuristic evidence.',
      this.zh,
    );
  }

  private drawLogLog(g: CanvasRenderingContext2D, w: number, h: number, analysis: Analysis) {
    const box = plotBox(w, h, 68, 72, 30, 62);
    const points = this.data.filter((d) => d.n > 0 && d.time > 0).map((d) => ({ x: Math.log2(d.n), y: Math.log2(d.time) }));
    if (points.length < 2) {
      drawFootnote(g, w, h, this.zh ? '需要至少两个正测量点。' : 'Need at least two positive measurements.', this.zh);
      return;
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padX = Math.max(0.2, (maxX - minX) * 0.08);
    const padY = Math.max(0.2, (maxY - minY) * 0.08);
    const xOf = (x: number) => box.x0 + ((x - minX + padX) / (maxX - minX + 2 * padX)) * box.w;
    const yOf = (y: number) => box.y1 - ((y - minY + padY) / (maxY - minY + 2 * padY)) * box.h;
    const xTicks = Array.from({ length: 5 }, (_, i) => {
      const value = minX - padX + ((maxX - minX + 2 * padX) * i) / 4;
      return { value: i / 4, label: `2^${value.toFixed(1)}` };
    });
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const value = minY - padY + ((maxY - minY + 2 * padY) * i) / 4;
      return { value: i / 4, label: `2^${value.toFixed(1)}` };
    });
    drawAxes(g, box, xTicks, yTicks, 'log₂ n', 'log₂ time', this.zh);
    const power = powerLaw(this.data);
    g.strokeStyle = 'rgba(255,209,102,0.5)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(xOf(minX - padX), yOf(power.slope * (minX - padX) + power.intercept));
    g.lineTo(xOf(maxX + padX), yOf(power.slope * (maxX + padX) + power.intercept));
    g.stroke();
    g.setLineDash([]);
    for (const p of points) {
      g.fillStyle = CS.blue;
      g.beginPath();
      g.arc(xOf(p.x), yOf(p.y), 4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = CS.amber;
    g.font = font(this.zh, 10);
    g.textAlign = 'left';
    g.fillText(`slope = ${analysis.exponent.toFixed(4)} · R² = ${analysis.powerR2.toFixed(4)}`, box.x0, box.y0 - 12);
    drawFootnote(
      g,
      w,
      h,
      this.zh ? '双对数坐标：幂律呈直线，斜率即拟合指数；虚线为最小二乘回归。' : 'Log-log axes: a power law is a straight line; the dashed line is the OLS regression.',
      this.zh,
    );
  }

  private drawRanking(g: CanvasRenderingContext2D, w: number, h: number, analysis: Analysis) {
    drawTable(
      g,
      w,
      h,
      [this.zh ? '排名' : 'rank', this.zh ? '模型' : 'model', 'R²', 'RMSE', this.zh ? '尺度' : 'scale'],
      analysis.ranked.map((f, i) => [i + 1, MODELS[f.id].latex, f.r2.toFixed(6), f.rmse.toPrecision(4), f.scale.toPrecision(4)]),
      { top: 70, highlight: 0, rowHeight: 27 },
    );
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? '按 R² 降序、RMSE 升序排列；R² 接近 1 仅表示拟合，不证明算法本身的渐近复杂度。'
        : 'Sorted by descending R², then ascending RMSE; R² near 1 indicates fit quality, not a proof of the algorithm’s asymptotics.',
      this.zh,
    );
  }
}

export default function createComplexityPlugin(): Plugin {
  return new ComplexityPlugin();
}
