// ==========================================================================
// stats/shared/plugin-base — shared lifecycle for the seven statistics
// plugins.
//
// Each plugin supplies a manifest, a parser/model, a canvas renderer and a
// small set of hooks (metrics, benchmark, CSV export, Figure panels). The
// base class owns the boilerplate: plugin lifecycle, locale switching, CSV /
// Block data loading, action buttons, science-output publication and the
// cached recompute. This keeps every kernel pure and every plugin focused on
// its statistical model instead of host plumbing.
// ==========================================================================

import type {
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
} from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual, type FigurePanelSpec } from '@/core/figure/sheet';
import { drawFootnote, drawHeader, font, prepareCanvas } from '../../shared/cs-utils';
import { CS } from '../../shared/cs-utils';

/** One embedded validation benchmark. */
export interface BenchRow {
  id: string;
  labelEn: string;
  labelZh: string;
  passed: boolean;
  /** Display value, e.g. a relative error or a recovered coefficient. */
  value: string;
  detail: string;
}

/** CSV payload for the "export" action. */
export interface CsvPayload {
  name: string;
  header: Array<string | number>;
  rows: Array<Array<string | number | null | undefined>>;
}

export abstract class StatsPluginBase<S, R> implements Plugin {
  readonly manifest: PluginManifest;
  protected api!: PluginApi;
  protected ctx: ContainerCapabilities | null = null;
  protected zh = false;
  protected state: S;
  protected text: string;
  protected result: R | null = null;
  private dirty = true;

  constructor(manifest: PluginManifest, state: S, defaultText: string) {
    this.manifest = manifest;
    this.state = state;
    this.text = defaultText;
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
  }

  async activate(context: { container: ContainerCapabilities }): Promise<void> {
    this.ctx = context.container;
  }

  async deactivate(): Promise<void> {}

  render(container: ContainerCapabilities): void {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [...this.stateParams(), ...this.commonParams()];
  }

  updateParams(params: Record<string, unknown>): void {
    if (this.updateState(params)) this.dirty = true;
    if (actionFired(params, 'recompute')) this.dirty = true;
    if (this.dirty) this.recompute(false);
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File): Promise<void> {
    const text = await file.text();
    if (!text.trim()) {
      notify(this.api, 'warning', 'The selected file is empty.', '所选文件为空。');
      return;
    }
    this.text = text;
    this.dirty = true;
    this.recompute(false);
    notify(
      this.api,
      'success',
      `Loaded ${file.name}.`,
      `已载入 ${file.name}。`,
    );
  }

  compute(input: unknown): Promise<ComputeResult> {
    if (typeof input === 'string' && input.trim()) this.text = input;
    const out = this.computeResult();
    this.result = out;
    if (out === null) return Promise.resolve({ ok: false, error: 'The input could not be modelled.' });
    this.publish();
    return Promise.resolve({ ok: true, output: out });
  }

  // ---- hooks ---------------------------------------------------------------

  /** Plugin-specific parameter definitions (before the common action buttons). */
  protected abstract stateParams(): ParamDefinition[];

  /** Apply a parameter update; return true when the model must recompute. */
  protected abstract updateState(params: Record<string, unknown>): boolean;

  /** Parse the text and fit the model. */
  protected abstract computeResult(): R | null;

  /** Science-output metrics for the fitted model. */
  protected abstract metrics(result: R): ScienceMetric[];

  /** Embedded validation benchmarks. */
  protected abstract benchmark(): BenchRow[];

  protected abstract csv(result: R): CsvPayload;

  protected abstract figurePanels(result: R): FigurePanelSpec[];

  protected abstract figureTitle(): Bilingual;

  protected abstract figureCaption(result: R): Bilingual;

  /** Canvas title / subtitle / footer. */
  protected abstract title(): string;

  protected abstract subtitle(): string;

  protected abstract footnote(): string;

  /** Draw the model into an already-cleared canvas. */
  protected abstract drawBody(g: CanvasRenderingContext2D, w: number, h: number, result: R | null): void;

  // ---- shared machinery ----------------------------------------------------

  /** The four standard action buttons every statistics plugin exposes. */
  protected commonParams(): ParamDefinition[] {
    return [
      actionButton('recompute', 'Recompute', '重新计算', 'primary'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export results CSV', '导出结果 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  /** A small labelled select — saves repetition in stateParams(). */
  protected select(
    key: string,
    labelEn: string,
    labelZh: string,
    value: string,
    options: Array<{ value: string; en: string; zh: string }>,
  ): ParamDefinition {
    return {
      key,
      label: labelEn,
      labelI18n: { 'zh-CN': labelZh, 'en-US': labelEn },
      type: 'select',
      options: options.map((o) => ({ value: o.value, label: this.zh ? o.zh : o.en, labelI18n: { 'zh-CN': o.zh, 'en-US': o.en } })),
      value,
    };
  }

  protected numberParam(
    key: string,
    labelEn: string,
    labelZh: string,
    value: number,
    min: number,
    max: number,
    step = 1,
    hint?: string,
  ): ParamDefinition {
    return {
      key,
      label: labelEn,
      labelI18n: { 'zh-CN': labelZh, 'en-US': labelEn },
      type: 'number',
      value,
      min,
      max,
      step,
      ...(hint ? { hint } : {}),
    };
  }

  protected rangeParam(
    key: string,
    labelEn: string,
    labelZh: string,
    value: number,
    min: number,
    max: number,
    step = 1,
    hint?: string,
  ): ParamDefinition {
    return { ...this.numberParam(key, labelEn, labelZh, value, min, max, step, hint), type: 'range' } as ParamDefinition;
  }

  protected checkParam(key: string, labelEn: string, labelZh: string, value: boolean): ParamDefinition {
    return {
      key,
      label: labelEn,
      labelI18n: { 'zh-CN': labelZh, 'en-US': labelEn },
      type: 'checkbox',
      value,
    };
  }

  private recompute(explicit: boolean): void {
    this.result = this.computeResult();
    this.dirty = false;
    this.publish();
    if (explicit && this.result) {
      notify(this.api, 'success', 'Model refitted.', '模型已重新拟合。');
    }
    this.draw();
  }

  private publish(): void {
    if (!this.result) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    setScienceOutputs(this.manifest.id, this.metrics(this.result));
  }

  private runBenchmark(): void {
    const rows = this.benchmark();
    const failed = rows.filter((r) => !r.passed);
    const metrics: ScienceMetric[] = rows.map((r) => ({
      key: `bench-${r.id}`,
      label: this.zh ? r.labelZh : r.labelEn,
      value: r.value,
      severity: r.passed ? 'ok' : 'error',
      hint: r.detail,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${rows.length} benchmarks passed.`
        : `${failed.length}/${rows.length} benchmarks failed: ${failed.map((r) => r.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${rows.length} 项基准通过。`
        : `${failed.length}/${rows.length} 项基准未通过：${failed.map((r) => r.id).join(', ')}`,
    );
  }

  private exportCsv(): void {
    if (!this.result) {
      notify(this.api, 'warning', 'Fit a model before exporting.', '请先拟合模型再导出。');
      return;
    }
    const payload = this.csv(this.result);
    exportRowsCsv(this.api, payload.name, payload.header, payload.rows);
  }

  private async sendToFigure(): Promise<void> {
    if (!this.result) {
      notify(this.api, 'warning', 'Fit a model before sending it to Figure Studio.', '请先拟合模型再发送到 Figure Studio。');
      return;
    }
    const panels = this.figurePanels(this.result);
    if (panels.length === 0) {
      notify(this.api, 'warning', 'No figure panels for this result.', '该结果没有可用的图表面板。');
      return;
    }
    await pushPanelsToFigure(this.api, this.figureTitle(), this.figureCaption(this.result), panels);
  }

  protected draw(): void {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    if (this.dirty) {
      this.result = this.computeResult();
      this.dirty = false;
      this.publish();
    }
    drawHeader(frame.g, frame.w, this.title(), this.subtitle(), this.zh);
    this.drawBody(frame.g, frame.w, frame.h, this.result);
    drawFootnote(frame.g, frame.w, frame.h, this.footnote(), this.zh);
  }

  /** Small coloured status chip used by the plugin canvases. */
  protected chip(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    ok: boolean,
  ): number {
    g.font = font(this.zh, 10, '600');
    const width = g.measureText(text).width + 14;
    g.fillStyle = ok ? 'rgba(126,231,135,0.14)' : 'rgba(255,139,134,0.14)';
    g.strokeStyle = ok ? CS.green : CS.red;
    g.beginPath();
    g.roundRect(x, y - 11, width, 17, 4);
    g.fill();
    g.stroke();
    g.fillStyle = ok ? CS.green : CS.red;
    g.textAlign = 'left';
    g.fillText(text, x + 7, y + 1);
    return width;
  }
}
