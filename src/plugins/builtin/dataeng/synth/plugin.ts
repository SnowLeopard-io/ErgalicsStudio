// ==========================================================================
// Synthetic Data Generator plugin — main controller.
//
// Wires the pure-TS synthesis kernel (copula / independent / AR(1) modes,
// ε-DP and k-anonymity privacy) to the Ergalics Studio plugin contract:
// parameter panel with conditional privacy controls, CSV input via openFile,
// canvas rendering (distribution-overlay histograms + quality table + row
// preview), CSV / metrics-JSON exports, science outputs and tracked runs.
//
// The kernel is deterministic: same data + same seed → same synthetic table.
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
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs } from '@/core/research/scienceOutput';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import { usePluginStore } from '@/stores/pluginStore';
import { synthManifest } from './manifest';
import {
  createRng,
  generateSynthetic,
  gaussian,
  parseCsvTable,
  toCsv,
  type PrivacyMode,
  type QualityReport,
  type SynthMode,
  type SynthResult,
  type SynthTable,
} from './kernel';

/** Academic low-saturation palette (no emoji, muted blue/teal on dark). */
const CS = {
  bg: '#0b0f14',
  text: '#d7e2ef',
  dim: '#8fa0b5',
  faint: '#5c6b80',
  grid: 'rgba(140,160,185,0.14)',
  line: 'rgba(140,160,185,0.35)',
  orig: 'rgba(127,168,201,0.55)', // muted blue — original data
  synth: 'rgba(111,179,173,0.55)', // muted teal — synthetic data
  origEdge: 'rgba(127,168,201,0.9)',
  synthEdge: 'rgba(111,179,173,0.9)',
  ok: '#6fb3ad',
  warn: '#c9b47f',
} as const;

const MODES: readonly string[] = ['copula', 'independent', 'timeseries'];
const PRIVACY_MODES: readonly string[] = ['none', 'dp', 'k-anonymity'];
const PARAMS_KEY = 'synth-params';
const HIST_BINS = 22;
const PREVIEW_ROWS = 100;

interface SynthState {
  rows: number;
  seed: number;
  mode: SynthMode;
  privacy: PrivacyMode;
  epsilon: number;
  k: number;
}

/** Deterministic embedded demo: age↔income correlated, categorical + boolean + id. */
function buildSampleCsv(): string {
  const rng = createRng(20261101);
  const cities = ['north', 'south', 'east', 'west'];
  const lines: string[] = ['age,income_k,city,subscribed,customer_id'];
  for (let i = 0; i < 60; i += 1) {
    const age = Math.round(Math.min(70, Math.max(20, 38 + 9 * gaussian(rng))));
    const income = 12 + 0.9 * age + 6 * gaussian(rng);
    const city = cities[Math.min(cities.length - 1, Math.floor(rng() * cities.length))]!;
    const subscribed = rng() < 0.35 ? 'true' : 'false';
    lines.push(`${age},${income.toFixed(1)},${city},${subscribed},C${String(i + 1).padStart(4, '0')}`);
  }
  return lines.join('\n');
}

export class SynthPlugin implements Plugin {
  readonly manifest = synthManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private csvText = '';
  private state: SynthState = {
    rows: 1000,
    seed: 42,
    mode: 'copula',
    privacy: 'none',
    epsilon: 1,
    k: 5,
  };
  private result: SynthResult | null = null;
  private running = false;
  private dirty = true;

  async init(api: PluginApi): Promise<void> {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((locale) => {
      this.zh = locale === 'zh-CN';
      this.draw();
    });
    // Restore persisted parameters for this project (api.setParam on change).
    const saved = api.getParam(PARAMS_KEY) as Partial<SynthState> | null;
    if (saved && typeof saved === 'object') this.applySaved(saved);
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
    if (this.dirty && !this.running && this.csvText.trim()) void this.runGeneration(false);
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameter panel -----------------------------------------------------

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
      {
        key: 'rows',
        label: 'Rows to Generate',
        labelI18n: { 'zh-CN': '生成行数', 'en-US': 'Rows to Generate' },
        type: 'number',
        min: 10,
        max: 100000,
        step: 10,
        value: this.state.rows,
      },
      {
        key: 'seed',
        label: 'Random Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Random Seed' },
        type: 'number',
        min: 0,
        step: 1,
        value: this.state.seed,
      },
      this.select('mode', 'Generation Mode', '生成模式', this.state.mode, [
        { value: 'copula', en: 'Gaussian Copula (keeps correlations)', zh: '高斯 Copula（保持相关性）' },
        { value: 'independent', en: 'Independent Marginals', zh: '独立边缘分布' },
        { value: 'timeseries', en: 'AR(1) Time Series', zh: 'AR(1) 时序' },
      ]),
      this.select('privacy', 'Privacy Mode', '隐私模式', this.state.privacy, [
        { value: 'none', en: 'None', zh: '不启用' },
        { value: 'dp', en: 'Differential Privacy (Laplace, epsilon)', zh: '差分隐私（Laplace，ε）' },
        { value: 'k-anonymity', en: 'k-Anonymity (bin + suppress)', zh: 'k-匿名（泛化 + 抑制）' },
      ]),
      {
        key: 'epsilon',
        label: 'Epsilon (privacy budget)',
        labelI18n: { 'zh-CN': 'ε（隐私预算）', 'en-US': 'Epsilon (privacy budget)' },
        type: 'number',
        min: 0.01,
        max: 10,
        step: 0.1,
        value: this.state.epsilon,
        visibleWhen: { key: 'privacy', in: ['dp'] },
      },
      {
        key: 'k',
        label: 'k (min equivalence class)',
        labelI18n: { 'zh-CN': 'k（最小等价类）', 'en-US': 'k (min equivalence class)' },
        type: 'number',
        min: 1,
        max: 1000,
        step: 1,
        value: this.state.k,
        visibleWhen: { key: 'privacy', in: ['k-anonymity'] },
      },
      actionButton('open', 'Open CSV', '打开 CSV'),
      actionButton('loadSample', 'Load Sample', '加载示例'),
      actionButton('run', 'Generate', '生成', 'primary'),
      actionButton('exportCsv', 'Export Synthetic CSV', '导出合成 CSV'),
      actionButton('exportMetrics', 'Export Quality Metrics JSON', '导出质量指标 JSON'),
    ];
  }

  private applySaved(saved: Partial<SynthState>): void {
    if (typeof saved.rows === 'number' && Number.isFinite(saved.rows)) {
      this.state.rows = Math.min(100000, Math.max(10, Math.round(saved.rows)));
    }
    if (typeof saved.seed === 'number' && Number.isFinite(saved.seed)) {
      this.state.seed = Math.max(0, Math.round(saved.seed));
    }
    if (typeof saved.mode === 'string' && MODES.includes(saved.mode)) this.state.mode = saved.mode as SynthMode;
    if (typeof saved.privacy === 'string' && PRIVACY_MODES.includes(saved.privacy)) {
      this.state.privacy = saved.privacy as PrivacyMode;
    }
    if (typeof saved.epsilon === 'number' && Number.isFinite(saved.epsilon)) {
      this.state.epsilon = Math.min(10, Math.max(0.01, saved.epsilon));
    }
    if (typeof saved.k === 'number' && Number.isFinite(saved.k)) {
      this.state.k = Math.min(1000, Math.max(1, Math.round(saved.k)));
    }
  }

  private persistParams(): void {
    this.api.setParam(PARAMS_KEY, { ...this.state });
  }

  updateParams(params: Record<string, unknown>): void {
    let changed = false;
    if (typeof params.rows === 'number' && Number.isFinite(params.rows)) {
      const rows = Math.min(100000, Math.max(10, Math.round(params.rows)));
      if (rows !== this.state.rows) {
        this.state.rows = rows;
        changed = true;
      }
    }
    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      const seed = Math.max(0, Math.round(params.seed));
      if (seed !== this.state.seed) {
        this.state.seed = seed;
        changed = true;
      }
    }
    if (typeof params.mode === 'string' && MODES.includes(params.mode) && params.mode !== this.state.mode) {
      this.state.mode = params.mode as SynthMode;
      changed = true;
    }
    if (typeof params.privacy === 'string' && PRIVACY_MODES.includes(params.privacy) && params.privacy !== this.state.privacy) {
      this.state.privacy = params.privacy as PrivacyMode;
      changed = true;
    }
    if (typeof params.epsilon === 'number' && Number.isFinite(params.epsilon)) {
      const eps = Math.min(10, Math.max(0.01, params.epsilon));
      if (eps !== this.state.epsilon) {
        this.state.epsilon = eps;
        changed = true;
      }
    }
    if (typeof params.k === 'number' && Number.isFinite(params.k)) {
      const k = Math.min(1000, Math.max(1, Math.round(params.k)));
      if (k !== this.state.k) {
        this.state.k = k;
        changed = true;
      }
    }

    if (actionFired(params, 'open')) {
      void this.openData();
      return;
    }
    if (actionFired(params, 'loadSample')) {
      this.loadSample();
      return;
    }
    if (actionFired(params, 'run')) {
      void this.runGeneration(true);
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (actionFired(params, 'exportMetrics')) {
      this.exportMetrics();
      return;
    }

    if (changed) {
      this.dirty = true;
      this.persistParams();
      if (!this.running && this.csvText.trim()) void this.runGeneration(false);
    }
  }

  // ---- data loading ----------------------------------------------------------

  private async openData(): Promise<void> {
    try {
      const file = await this.api.openFile('.csv');
      if (!file) return;
      await this.loadData(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Could not open file: ${message}`, `无法打开文件：${message}`);
    }
  }

  private ingest(text: string, label: string): boolean {
    const table = parseCsvTable(text);
    if (!table || table.rows.length < 5) {
      notify(
        this.api,
        'error',
        `Could not parse "${label}" as tabular CSV (need at least 5 data rows).`,
        `无法将「${label}」解析为表格 CSV（至少需要 5 行数据）。`,
      );
      return false;
    }
    this.csvText = text;
    this.dirty = true;
    this.api.reportDataScale(table.rows.length);
    emit('host:params:changed', { pluginId: this.manifest.id });
    void this.runGeneration(false);
    return true;
  }

  async loadData(file: File): Promise<void> {
    const text = await file.text();
    if (!text.trim()) {
      notify(this.api, 'warning', 'The selected file is empty.', '所选文件为空。');
      return;
    }
    if (this.ingest(text, file.name)) {
      notify(this.api, 'success', `Loaded ${file.name} (${parseCsvTable(text)?.rows.length ?? 0} rows).`, `已载入 ${file.name}（${parseCsvTable(text)?.rows.length ?? 0} 行）。`);
    }
  }

  private loadSample(): void {
    if (this.ingest(buildSampleCsv(), 'sample')) {
      notify(this.api, 'success', 'Sample dataset loaded.', '示例数据已载入。');
    }
  }

  // ---- generation --------------------------------------------------------------

  private async runGeneration(explicit: boolean): Promise<void> {
    if (this.running) {
      if (explicit) notify(this.api, 'warning', 'A generation run is already in progress.', '生成正在进行中。');
      return;
    }
    if (!this.csvText.trim()) {
      clearScienceOutputs(this.manifest.id);
      this.draw();
      return;
    }
    const original = parseCsvTable(this.csvText);
    if (!original || original.rows.length < 5) {
      notify(this.api, 'error', 'No valid source table loaded.', '尚未载入有效的源数据表。');
      return;
    }
    this.running = true;
    const store = usePluginStore.getState();
    const runId = store.beginRun({
      pluginId: this.manifest.id,
      kind: 'compute',
      label: 'synth-generate',
      detail: { rows: this.state.rows, seed: this.state.seed, mode: this.state.mode, privacy: this.state.privacy },
    });
    try {
      const res = generateSynthetic(original, {
        rows: this.state.rows,
        seed: this.state.seed,
        mode: this.state.mode,
        privacy: this.state.privacy,
        epsilon: this.state.epsilon,
        k: this.state.k,
      });
      this.result = res;
      this.dirty = false;
      this.api.reportDataScale(res.table.rows.length);
      this.publish(res);
      this.draw();
      if (explicit) {
        notify(
          this.api,
          'success',
          `Generated ${res.table.rows.length} rows (similarity ${fmtMetric(res.report.overall, 3)}).`,
          `已生成 ${res.table.rows.length} 行（相似度 ${fmtMetric(res.report.overall, 3)}）。`,
        );
      }
      store.finishRun(runId, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.result = null;
      this.dirty = false;
      clearScienceOutputs(this.manifest.id);
      this.draw();
      store.finishRun(runId, false, message);
      notify(this.api, 'error', `Generation failed: ${message}`, `生成失败：${message}`);
    } finally {
      this.running = false;
    }
  }

  // ---- science outputs -------------------------------------------------------------

  private publish(res: SynthResult): void {
    const zh = this.zh;
    const rep = res.report;
    const privacyLabel =
      res.privacy.mode === 'dp'
        ? `ε = ${fmtMetric(res.privacy.epsilon ?? 0, 3)}`
        : res.privacy.mode === 'k-anonymity'
          ? `k = ${res.privacy.k ?? 0}`
          : zh
            ? '未启用'
            : 'off';
    const metrics: ScienceMetric[] = [
      {
        key: 'similarity',
        label: zh ? '总体相似度' : 'Overall similarity',
        value: fmtMetric(rep.overall, 4),
        severity: rep.overall >= 0.8 ? 'ok' : rep.overall >= 0.6 ? 'info' : 'warn',
        hint: zh ? '数值列 1−KS、类别列 1−TVD、相关与缺失差异的均值' : 'mean of 1−KS, 1−TVD, correlation and missing-rate components',
      },
      {
        key: 'mean-ks',
        label: zh ? '平均 KS 统计量' : 'Mean KS statistic',
        value: rep.meanKs === null ? '—' : fmtMetric(rep.meanKs, 4),
        severity: (rep.meanKs ?? 0) < 0.15 ? 'ok' : 'warn',
        hint: zh ? '逐数值列双样本 KS 的均值' : 'mean two-sample KS over numeric columns',
      },
      {
        key: 'mean-tvd',
        label: zh ? '平均总变差 TVD' : 'Mean TVD',
        value: rep.meanTvd === null ? '—' : fmtMetric(rep.meanTvd, 4),
        severity: (rep.meanTvd ?? 0) < 0.1 ? 'ok' : 'warn',
        hint: zh ? '类别/布尔列频率总变差的均值' : 'mean total-variation distance over categorical columns',
      },
      {
        key: 'corr-diff',
        label: zh ? '相关保持差' : 'Correlation drift',
        value: rep.corrAbsDiff === null ? '—' : fmtMetric(rep.corrAbsDiff, 4),
        severity: (rep.corrAbsDiff ?? 0) < 0.15 ? 'ok' : 'warn',
        hint: zh ? '数值列 Pearson 相关矩阵的平均绝对差' : 'mean |Δ Pearson| over numeric column pairs',
      },
      {
        key: 'privacy',
        label: zh ? '隐私参数' : 'Privacy budget',
        value: privacyLabel,
        severity: 'info',
        hint:
          res.privacy.mode === 'dp'
            ? zh
              ? 'Laplace 机制：计数敏感度 1，均值敏感度 (max−min)/n'
              : 'Laplace mechanism: sensitivity 1 for counts, (max−min)/n for means'
            : res.privacy.mode === 'k-anonymity'
              ? zh
                ? `抑制 ${res.privacy.suppressed ?? 0} 行，最小等价类 ${res.privacy.minClassSize ?? 0}`
                : `${res.privacy.suppressed ?? 0} rows suppressed, min class ${res.privacy.minClassSize ?? 0}`
              : zh
                ? '原始拟合发布，未加隐私保护'
                : 'direct fit release, no privacy guard',
      },
      {
        key: 'runtime',
        label: zh ? '生成耗时' : 'Generation time',
        value: `${fmtMetric(res.runtimeMs, 4)} ms`,
        unit: 'ms',
        severity: 'info',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- exports --------------------------------------------------------------------

  private exportCsv(): void {
    const res = this.result;
    if (!res || res.table.rows.length === 0) {
      notify(this.api, 'warning', 'Generate a synthetic table first.', '请先生成合成数据。');
      return;
    }
    const csv = toCsv(res.table);
    this.api.exportFile('synthetic-data.csv', csv, 'text/csv');
    notify(this.api, 'success', `Exported ${res.table.rows.length} synthetic rows.`, `已导出 ${res.table.rows.length} 行合成数据。`);
  }

  private exportMetrics(): void {
    const res = this.result;
    if (!res) {
      notify(this.api, 'warning', 'Generate a synthetic table first.', '请先生成合成数据。');
      return;
    }
    const doc = {
      plugin: this.manifest.id,
      version: this.manifest.version,
      generatedAt: new Date().toISOString(),
      seed: res.seed,
      mode: res.mode,
      rows: res.table.rows.length,
      requestedRows: res.requestedRows,
      privacy: res.privacy,
      runtimeMs: res.runtimeMs,
      report: res.report,
      skippedColumns: res.skipped,
    };
    this.api.exportFile('synth-quality-metrics.json', JSON.stringify(doc, null, 2), 'application/json');
    notify(this.api, 'success', 'Quality metrics exported.', '质量指标已导出。');
  }

  // ---- block / flow mode ------------------------------------------------------------

  async compute(input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    if (typeof input === 'string' && input.trim()) {
      this.csvText = input;
    }
    const original = parseCsvTable(this.csvText);
    if (!original || original.rows.length < 5) {
      return { ok: false, error: 'no valid CSV table loaded (need at least 5 rows)' };
    }
    onProgress?.({ done: 0, total: 1, label: 'synth-generate' });
    try {
      const res = generateSynthetic(original, {
        rows: this.state.rows,
        seed: this.state.seed,
        mode: this.state.mode,
        privacy: this.state.privacy,
        epsilon: this.state.epsilon,
        k: this.state.k,
      });
      this.result = res;
      this.dirty = false;
      this.publish(res);
      onProgress?.({ done: 1, total: 1, label: 'synth-generate' });
      return {
        ok: true,
        output: {
          rows: res.table.rows.length,
          columns: res.table.columns,
          mode: res.mode,
          seed: res.seed,
          privacy: res.privacy,
          overall: res.report.overall,
          meanKs: res.report.meanKs,
          meanTvd: res.report.meanTvd,
          corrAbsDiff: res.report.corrAbsDiff,
          skipped: res.skipped,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---- canvas helpers -----------------------------------------------------------------

  private prepare(canvas: HTMLCanvasElement | null | undefined): { g: CanvasRenderingContext2D; w: number; h: number } | null {
    if (!canvas) return null;
    canvas.width = canvas.clientWidth || 860;
    canvas.height = canvas.clientHeight || 520;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = CS.bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    return { g, w: canvas.width, h: canvas.height };
  }

  private draw(): void {
    const frame = this.prepare(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    const zh = this.zh;
    const res = this.result;
    const title = zh ? '合成数据生成器' : 'Synthetic Data Generator';
    if (!res) {
      if (!this.csvText.trim()) clearScienceOutputs(this.manifest.id);
      g.fillStyle = CS.dim;
      g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(
        zh ? '点击「打开 CSV」或「加载示例」，然后「生成」' : 'Press "Open CSV" or "Load Sample", then "Generate".',
        w / 2,
        h / 2 - 8,
      );
      g.fillStyle = CS.faint;
      g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(
        zh ? '内核为纯 TS 确定性实现：同一种子与数据可逐位复现。' : 'Pure-TS deterministic kernel: same seed + data replays bit-for-bit.',
        w / 2,
        h / 2 + 16,
      );
      return;
    }

    g.textAlign = 'left';
    g.fillStyle = CS.text;
    g.font = `bold 14px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(title, 16, 22);
    const sub = [
      `${res.table.rows.length} / ${res.requestedRows} ${zh ? '行' : 'rows'}`,
      `${res.table.columns.length} ${zh ? '列' : 'cols'}`,
      `mode=${res.mode}`,
      `privacy=${res.privacy.mode}${res.privacy.mode === 'dp' ? ` (ε=${fmtMetric(res.privacy.epsilon ?? 0, 2)})` : res.privacy.mode === 'k-anonymity' ? ` (k=${res.privacy.k ?? 0})` : ''}`,
      `seed=${res.seed}`,
    ].join(' · ');
    g.fillStyle = CS.dim;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(sub, 16, 38);

    const histH = Math.round(h * 0.34);
    this.drawHistograms(g, w, histH, res, zh);
    const qualTop = histH + 34;
    const qualH = Math.round(h * 0.27);
    this.drawQualityTable(g, w, qualH, qualTop, res, zh);
    this.drawPreview(g, w, h, qualTop + qualH + 30, res, zh);
  }

  /** Overlay histograms (original vs synthetic, two translucent colours). */
  private drawHistograms(g: CanvasRenderingContext2D, w: number, height: number, res: SynthResult, zh: boolean): void {
    const original = parseCsvTable(this.csvText);
    if (!original) return;
    const numericCols = res.table.columns.filter((c) => {
      const a = original.columns.includes(c);
      if (!a) return false;
      const idx = res.table.columns.indexOf(c);
      const col = res.table.rows.slice(0, 200).map((r) => r[idx]);
      return col.some((v) => typeof v === 'number');
    });
    if (numericCols.length === 0) {
      g.fillStyle = CS.faint;
      g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(zh ? '无数值列可绘制分布对比' : 'No shared numeric columns to compare.', w / 2, 66);
      g.textAlign = 'left';
      return;
    }
    const shown = numericCols.slice(0, 3);
    const panelW = (w - 32 - (shown.length - 1) * 16) / shown.length;
    shown.forEach((name, p) => {
      const x0 = 16 + p * (panelW + 16);
      const y0 = 48;
      const pw = panelW;
      const ph = height - 48;
      const origVals = numericValuesOf(original, name);
      const synVals = numericValuesOf(res.table, name);
      drawOverlayHistogram(g, x0, y0, pw, ph, origVals, synVals, name, zh);
    });
  }

  /** Per-column KS / TVD quality table. */
  private drawQualityTable(g: CanvasRenderingContext2D, w: number, height: number, top: number, res: SynthResult, zh: boolean): void {
    const rep: QualityReport = res.report;
    g.fillStyle = CS.dim;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(zh ? '质量指标（原 vs 合成）' : 'Quality metrics (original vs synthetic)', 16, top + 10);

    const cols = [
      zh ? '列' : 'column',
      zh ? '类型' : 'kind',
      'KS',
      'TVD',
      zh ? '相似度' : 'similarity',
    ];
    const colX = [16, 150, 300, 410, 520];
    const rowH = 16;
    const maxRows = Math.max(1, Math.floor((height - 44) / rowH));
    const rows = rep.perColumn.slice(0, maxRows);
    g.font = `10.5px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    cols.forEach((c, i) => g.fillText(c, colX[i] ?? 16, top + 26));
    g.strokeStyle = CS.line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(16, top + 31);
    g.lineTo(w - 16, top + 31);
    g.stroke();
    rows.forEach((d, r) => {
      const y = top + 44 + r * rowH;
      g.fillStyle = CS.text;
      g.fillText(d.column, colX[0] ?? 16, y);
      g.fillStyle = CS.dim;
      g.fillText(d.kind, colX[1] ?? 150, y);
      g.fillStyle = d.ks !== undefined && d.ks < 0.15 ? CS.ok : CS.warn;
      g.fillText(d.ks !== undefined ? fmtMetric(d.ks, 3) : '—', colX[2] ?? 300, y);
      g.fillStyle = d.tvd !== undefined && d.tvd < 0.1 ? CS.ok : CS.warn;
      g.fillText(d.tvd !== undefined ? fmtMetric(d.tvd, 3) : '—', colX[3] ?? 410, y);
      g.fillStyle = CS.text;
      g.fillText(fmtMetric(d.similarity, 3), colX[4] ?? 520, y);
    });
    const extra = rep.perColumn.length - rows.length;
    if (extra > 0) {
      g.fillStyle = CS.faint;
      g.fillText(`… +${extra}`, colX[0] ?? 16, top + 44 + rows.length * rowH);
    }
    // Summary line on the right.
    g.textAlign = 'right';
    g.fillStyle = CS.text;
    g.font = `bold 12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      `${zh ? '总体相似度' : 'overall'} ${fmtMetric(rep.overall, 4)}`,
      w - 16,
      top + 10,
    );
    g.fillStyle = CS.dim;
    g.font = `10.5px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      `${zh ? '平均 KS' : 'mean KS'} ${rep.meanKs === null ? '—' : fmtMetric(rep.meanKs, 3)} · ${zh ? '平均 TVD' : 'mean TVD'} ${rep.meanTvd === null ? '—' : fmtMetric(rep.meanTvd, 3)} · Δcorr ${rep.corrAbsDiff === null ? '—' : fmtMetric(rep.corrAbsDiff, 3)} · ${zh ? '缺失差' : 'missing Δ'} ${rep.missingRateDiff === null ? '—' : fmtMetric(rep.missingRateDiff, 3)}`,
      w - 16,
      top + 26,
    );
    g.textAlign = 'left';
  }

  /** Result preview: the first `PREVIEW_ROWS` rows (as many as fit are drawn). */
  private drawPreview(g: CanvasRenderingContext2D, w: number, h: number, top: number, res: SynthResult, zh: boolean): void {
    const preview = res.table.rows.slice(0, PREVIEW_ROWS);
    if (top + 20 >= h) return;
    g.fillStyle = CS.dim;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    const note = res.skipped.length > 0 ? ` · ${zh ? '跳过列' : 'skipped'}: ${res.skipped.map((s) => s.column).join(', ')}` : '';
    g.fillText(
      `${zh ? '结果预览（前 100 行）' : 'Result preview (first 100 rows)'} · ${preview.length} ${zh ? '行' : 'rows shown'}${note}`,
      16,
      top + 10,
    );
    const cols = res.table.columns.slice(0, 8);
    const colW = Math.max(64, (w - 32) / cols.length);
    const rowH = 15;
    const maxRows = Math.max(0, Math.floor((h - top - 34) / rowH));
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    cols.forEach((c, i) => {
      g.fillStyle = CS.text;
      g.fillText(truncateCell(c, colW), 16 + i * colW, top + 24);
    });
    g.strokeStyle = CS.line;
    g.beginPath();
    g.moveTo(16, top + 29);
    g.lineTo(16 + cols.length * colW, top + 29);
    g.stroke();
    preview.slice(0, maxRows).forEach((row, r) => {
      const y = top + 42 + r * rowH;
      cols.forEach((_, i) => {
        const v = row[i];
        g.fillStyle = v === null ? CS.faint : CS.dim;
        g.fillText(truncateCell(v === null ? '—' : String(v), colW), 16 + i * colW, y);
      });
    });
  }
}

// ---- module-level draw helpers -------------------------------------------------

/** Non-missing numeric values of one column (typed cells or numeric strings). */
function numericValuesOf(table: SynthTable, name: string): number[] {
  const idx = table.columns.indexOf(name);
  if (idx < 0) return [];
  const out: number[] = [];
  for (const row of table.rows) {
    const v = row[idx];
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (typeof v === 'string') {
      const n = Number(v);
      if (v.trim() !== '' && Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

/** Truncate a cell label to the available column width (monospace, ~6.2 px/char). */
function truncateCell(s: string, widthPx: number): string {
  const max = Math.max(4, Math.floor(widthPx / 6.2) - 1);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * One histogram panel: original (muted blue) and synthetic (muted teal)
 * counts over shared equal-width bins, drawn as translucent overlays.
 */
function drawOverlayHistogram(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  orig: number[],
  syn: number[],
  label: string,
  zh: boolean,
): void {
  g.fillStyle = CS.dim;
  g.font = '10.5px Consolas, monospace';
  g.textAlign = 'center';
  g.fillText(truncateCell(label, w), x + w / 2, y - 4);
  g.textAlign = 'left';

  if (orig.length === 0 || syn.length === 0) {
    g.fillStyle = CS.faint;
    g.textAlign = 'center';
    g.fillText(zh ? '数据不足' : 'insufficient data', x + w / 2, y + h / 2);
    g.textAlign = 'left';
    return;
  }
  const lo = Math.min(...orig, ...syn);
  const hi = Math.max(...orig, ...syn);
  const span = hi > lo ? hi - lo : 1;
  const bins = HIST_BINS;
  const countsO = new Array<number>(bins).fill(0);
  const countsS = new Array<number>(bins).fill(0);
  for (const v of orig) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / span) * bins)));
    countsO[k]! += 1;
  }
  for (const v of syn) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / span) * bins)));
    countsS[k]! += 1;
  }
  const maxCount = Math.max(...countsO, ...countsS, 1);
  const plotH = h - 18;
  const barW = w / bins;
  // Baseline.
  g.strokeStyle = CS.line;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x, y + plotH + 0.5);
  g.lineTo(x + w, y + plotH + 0.5);
  g.stroke();
  for (let k = 0; k < bins; k += 1) {
    const hO = (countsO[k]! / maxCount) * plotH;
    const hS = (countsS[k]! / maxCount) * plotH;
    if (hO > 0) {
      g.fillStyle = CS.orig;
      g.fillRect(x + k * barW + 0.5, y + plotH - hO, Math.max(1, barW - 1), hO);
    }
    if (hS > 0) {
      g.fillStyle = CS.synth;
      g.fillRect(x + k * barW + 0.5, y + plotH - hS, Math.max(1, barW - 1), hS);
    }
  }
  // Range ticks (min / max) and edge hint.
  g.fillStyle = CS.faint;
  g.font = '9px Consolas, monospace';
  g.fillText(fmtMetric(lo, 3), x, y + h - 4);
  g.textAlign = 'right';
  g.fillText(fmtMetric(hi, 3), x + w, y + h - 4);
  g.textAlign = 'left';
}

export default function createSynthPlugin(): Plugin {
  return new SynthPlugin();
}
