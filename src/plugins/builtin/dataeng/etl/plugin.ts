// ==========================================================================
// ETL Pipeline Builder plugin — main controller.
//
// Wires the pure ETL kernel (src/plugins/builtin/dataeng/etl/kernel.ts) to
// the Ergalics Studio plugin contract:
//   - data source: CSV / JSON via `api.openFile`, or a URL through `fetch`
//     (the API connector address lives in the `apiUrl` text parameter)
//   - an in-DOM visual pipeline editor: vertical step chain, each block
//     editable / removable / movable, executed step-by-step with per-step
//     row-count + wall-clock badges and a ComputeProgress-style report
//   - code export (pandas / R dplyr / SQL) and a flow-mode DAG export
//   - state persistence: step list under `api.setParam('pipeline')`,
//     restored on project load
//   - science outputs (rows/cols/missing-rate deltas, runtime) and
//     plugin-store run records (`data-import` + `compute`) for lineage
//
// Rendering is hand-written DOM + tiny inline SVG connectors in an academic,
// low-saturation palette (no emoji), mirroring the data/automl style.
// ==========================================================================

import type {
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';
import { usePluginStore } from '@/stores/pluginStore';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs } from '@/core/research/scienceOutput';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import { etlManifest } from './manifest';
import {
  applyStep,
  missingCellRate,
  parseTableAuto,
  parseJsonTable,
  runPipeline,
  stepsToFlowGraph,
  toPandasCode,
  toRCode,
  toSqlCode,
} from './kernel';
import type {
  AggFn,
  EtlStep,
  EtlStepKind,
  EtTable,
  FilterOp,
  ImputeMethod,
  NormalizeMethod,
  StepStat,
} from './kernel';

// ---- plugin-scoped i18n (self-contained; the global i18n file is untouched) --

const STRINGS = {
  'en-US': {
    loadData: 'Open CSV/JSON',
    loadJoin: 'Join source',
    fetchUrl: 'Fetch URL',
    loadSample: 'Load sample',
    run: 'Run pipeline',
    running: 'Running',
    exportPandas: 'pandas code',
    exportR: 'R code',
    exportSql: 'SQL code',
    exportFlow: 'Flow JSON',
    stepsTitle: 'Pipeline steps',
    add: 'Add',
    pick: 'Transformation',
    previewTitle: 'Result preview',
    noSource: 'No data loaded — open a CSV/JSON file, fetch a URL, or load the sample.',
    noSteps: 'No steps yet — add transformations to build the pipeline.',
    stale: 'Steps changed — press Run to apply.',
    rows: 'rows',
    cols: 'columns',
    missing: 'missing',
    joinNone: 'no join source',
    kindFilter: 'Filter',
    kindMap: 'Map column',
    kindReduce: 'Reduce',
    kindJoin: 'Join',
    kindGroupBy: 'Group + aggregate',
    kindPivot: 'Pivot',
    kindMelt: 'Melt to long',
    kindImpute: 'Impute',
    kindNormalize: 'Normalize',
    kindCoerce: 'Coerce type',
    fColumn: 'Column / expression',
    fOp: 'Operator',
    fValue: 'Value',
    fName: 'New column',
    fExpr: 'Expression (JS)',
    fFn: 'Aggregate',
    fOn: 'Key column',
    fHow: 'How',
    fKeys: 'Key columns (comma-sep)',
    fIndex: 'Row key',
    fColKey: 'Column key',
    fValueCol: 'Value column',
    fIds: 'Id columns (comma-sep)',
    fMethod: 'Method',
    fConstant: 'Constant',
    fType: 'Type',
  },
  'zh-CN': {
    loadData: '打开 CSV/JSON',
    loadJoin: '连接第二表',
    fetchUrl: '拉取 URL',
    loadSample: '加载示例',
    run: '运行流水线',
    running: '运行中',
    exportPandas: 'pandas 代码',
    exportR: 'R 代码',
    exportSql: 'SQL 代码',
    exportFlow: '流程 JSON',
    stepsTitle: '流水线步骤',
    add: '添加',
    pick: '变换类型',
    previewTitle: '结果预览',
    noSource: '尚未加载数据 — 请打开 CSV/JSON 文件、拉取 URL 或加载示例。',
    noSteps: '尚无步骤 — 添加变换以构建流水线。',
    stale: '步骤已修改 — 点击「运行流水线」生效。',
    rows: '行',
    cols: '列',
    missing: '缺失',
    joinNone: '未设置连接源',
    kindFilter: '筛选',
    kindMap: '映射新列',
    kindReduce: '汇总',
    kindJoin: '连接',
    kindGroupBy: '分组聚合',
    kindPivot: '透视',
    kindMelt: '转长表',
    kindImpute: '缺失填补',
    kindNormalize: '标准化',
    kindCoerce: '类型转换',
    fColumn: '列 / 表达式',
    fOp: '操作符',
    fValue: '值',
    fName: '新列名',
    fExpr: '表达式（JS）',
    fFn: '聚合',
    fOn: '键列',
    fHow: '方式',
    fKeys: '键列（逗号分隔）',
    fIndex: '行键',
    fColKey: '列键',
    fValueCol: '值列',
    fIds: 'Id 列（逗号分隔）',
    fMethod: '方法',
    fConstant: '常量',
    fType: '类型',
  },
} as const;

type StringKey = keyof (typeof STRINGS)['en-US'];

// ---- visual style (academic, low-saturation, dark) ----------------------------

const COLORS = {
  bg: '#0d1218',
  panel: '#121a23',
  panelAlt: '#0f161e',
  border: 'rgba(148,170,195,0.16)',
  borderSoft: 'rgba(148,170,195,0.09)',
  text: '#d7e1ec',
  dim: '#9fb0c2',
  faint: '#6b7c90',
  accent: '#7fa8c9',
  teal: '#6fb3ad',
  warn: '#c9a97f',
  danger: '#c98a7f',
} as const;

const FONT = "'Microsoft YaHei', 'PingFang SC', Consolas, monospace";
const PREVIEW_ROW_CAP = 100;

const STYLE = `
.etl-root { display: flex; flex-direction: column; height: 100%; min-height: 320px; box-sizing: border-box;
  padding: 10px; gap: 8px; background: ${COLORS.bg}; color: ${COLORS.text}; font: 12px ${FONT}; overflow: auto; }
.etl-toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.etl-btn { background: ${COLORS.panel}; color: ${COLORS.text}; border: 1px solid ${COLORS.border};
  border-radius: 4px; padding: 4px 10px; font: 12px ${FONT}; cursor: pointer; }
.etl-btn:hover { border-color: ${COLORS.accent}; }
.etl-btn:disabled { opacity: 0.5; cursor: default; }
.etl-btn-primary { background: rgba(127,168,201,0.18); border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
.etl-btn-group { display: inline-flex; gap: 0; margin-left: 8px; }
.etl-btn-group .etl-btn { border-radius: 0; margin-left: -1px; }
.etl-btn-group .etl-btn:first-child { border-radius: 4px 0 0 4px; margin-left: 0; }
.etl-btn-group .etl-btn:last-child { border-radius: 0 4px 4px 0; }
.etl-url { flex: 1 1 220px; min-width: 180px; background: ${COLORS.panelAlt}; color: ${COLORS.text};
  border: 1px solid ${COLORS.border}; border-radius: 4px; padding: 4px 8px; font: 12px ${FONT}; }
.etl-status { padding: 3px 2px; color: ${COLORS.dim}; font-size: 11.5px; }
.etl-status .etl-warn { color: ${COLORS.warn}; }
.etl-body { display: flex; gap: 12px; align-items: stretch; flex: 1; min-height: 0; }
.etl-steps { flex: 0 0 340px; display: flex; flex-direction: column; gap: 0; min-width: 280px; }
.etl-panel { background: ${COLORS.panel}; border: 1px solid ${COLORS.border}; border-radius: 6px; }
.etl-panel-head { padding: 6px 10px; border-bottom: 1px solid ${COLORS.borderSoft};
  color: ${COLORS.dim}; font-size: 11.5px; letter-spacing: 0.04em; display: flex; gap: 8px; align-items: center; }
.etl-addrow { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid ${COLORS.borderSoft}; }
.etl-addrow select { flex: 1; }
.etl-chain { padding: 8px 10px 12px; display: flex; flex-direction: column; align-items: flex-start; }
.etl-step { width: 100%; box-sizing: border-box; background: ${COLORS.panelAlt};
  border: 1px solid ${COLORS.border}; border-radius: 5px; }
.etl-step-head { display: flex; align-items: center; gap: 6px; padding: 5px 8px; }
.etl-step-kind { color: ${COLORS.accent}; font-weight: 600; }
.etl-step-stat { color: ${COLORS.faint}; font-size: 10.5px; flex: 1; }
.etl-step-stat .etl-err { color: ${COLORS.danger}; }
.etl-icon-btn { background: transparent; border: 1px solid transparent; color: ${COLORS.faint};
  font: 12px ${FONT}; cursor: pointer; padding: 1px 5px; border-radius: 3px; }
.etl-icon-btn:hover { color: ${COLORS.text}; border-color: ${COLORS.border}; }
.etl-step-params { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 8px 8px; }
.etl-field { display: flex; flex-direction: column; gap: 2px; min-width: 120px; flex: 1 1 120px; }
.etl-field-label { color: ${COLORS.faint}; font-size: 10.5px; }
.etl-root input[type="text"], .etl-root select { background: ${COLORS.bg}; color: ${COLORS.text};
  border: 1px solid ${COLORS.border}; border-radius: 3px; padding: 3px 6px; font: 12px ${FONT}; min-width: 0; }
.etl-root input[type="text"]:focus, .etl-root select:focus { outline: none; border-color: ${COLORS.accent}; }
.etl-link { display: block; margin: 2px 0 2px 18px; }
.etl-preview { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.etl-tablewrap { overflow: auto; flex: 1; max-height: 100%; }
.etl-table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 11.5px; }
.etl-table th, .etl-table td { border: 1px solid ${COLORS.borderSoft}; padding: 3px 8px; text-align: left;
  white-space: nowrap; }
.etl-table th { position: sticky; top: 0; background: ${COLORS.panelAlt}; color: ${COLORS.dim};
  font-weight: 600; }
.etl-table td.etl-null { color: ${COLORS.faint}; font-style: italic; }
.etl-hint { padding: 16px 12px; color: ${COLORS.faint}; }
.etl-summary { color: ${COLORS.dim}; }
`;

// ---- embedded deterministic sample -------------------------------------------

const SAMPLE_ETL_CSV = `region,product,units,price,launched
North,Alpha,120,9.5,2025-01-15
North,Beta,80,12.0,2025-02-20
South,Alpha,60,9.5,2025-01-15
South,Beta,140,12.0,
East,Alpha,200,10.5,2025-03-05
East,Beta,90,12.0,2025-03-18
West,Alpha,150,9.5,2025-04-02
West,Beta,110,12.0,2025-04-22
North,Alpha,70,9.5,2025-05-11
South,Alpha,30,9.5,2025-05-19
East,Beta,50,12.0,
West,Beta,95,12.0,2025-06-01`;

const STEP_KINDS: readonly EtlStepKind[] = [
  'filter',
  'map',
  'reduce',
  'join',
  'groupBy',
  'pivot',
  'melt',
  'impute',
  'normalize',
  'coerceType',
];

const FILTER_OPS: readonly FilterOp[] = ['==', '!=', '>', '>=', '<', '<=', 'contains', 'startsWith', 'isMissing', 'notMissing'];
const AGG_FNS: readonly AggFn[] = ['sum', 'mean', 'min', 'max', 'count'];
const IMPUTE_METHODS: readonly ImputeMethod[] = ['mean', 'median', 'mode', 'constant'];
const NORMALIZE_METHODS: readonly NormalizeMethod[] = ['minmax', 'zscore'];
const COLUMN_TYPES: readonly string[] = ['number', 'string', 'boolean', 'date', 'unknown'];
const JOIN_HOWS: readonly string[] = ['inner', 'left'];

/** Default parameters for a freshly added step of each kind. */
function defaultStep(kind: EtlStepKind, columns: readonly string[]): EtlStep {
  const c0 = columns[0] ?? '';
  const c1 = columns[1] ?? c0;
  switch (kind) {
    case 'filter':
      return { kind, column: c0, op: '==', value: '' };
    case 'map':
      return { kind, name: 'computed', expression: '' };
    case 'reduce':
      return { kind, column: c0, fn: 'sum' };
    case 'join':
      return { kind, on: c0, how: 'left' };
    case 'groupBy':
      return { kind, keys: [c0], column: c1, fn: 'sum' };
    case 'pivot':
      return { kind, index: c0, columns: c1, value: c1, fn: 'sum' };
    case 'melt':
      return { kind, idColumns: [c0] };
    case 'impute':
      return { kind, column: c0, method: 'mean', value: '0' };
    case 'normalize':
      return { kind, column: c0, method: 'minmax' };
    case 'coerceType':
      return { kind, column: c0, type: 'number' };
  }
}

// ---- tiny DOM helpers -----------------------------------------------------------

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Small downward arrow connecting two chain blocks. */
function connector(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'etl-link');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 12 18');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M6 0 V11 M2 8 L6 13 L10 8');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', COLORS.faint);
  path.setAttribute('stroke-width', '1.2');
  svg.appendChild(path);
  return svg;
}

// ==================================================================================

export class EtlPlugin implements Plugin {
  readonly manifest = etlManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  // persisted state
  private steps: EtlStep[] = [];
  private apiUrl = '';

  // runtime state
  private source: EtTable | null = null;
  private sourceName = '';
  private joinTable: EtTable | null = null;
  private joinName = '';
  private result: EtTable | null = null;
  private stats: StepStat[] = [];
  private totalMs = 0;
  private stepError: { index: number; message: string } | null = null;
  private dirty = false;
  private running = false;

  // cached DOM handles (rebuilt on every draw)
  private statusEl: HTMLElement | null = null;
  private urlInput: HTMLInputElement | null = null;

  async init(api: PluginApi): Promise<void> {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((locale) => {
      this.zh = locale === 'zh-CN';
      this.draw();
    });
    this.restoreFromParams();
  }

  async destroy(): Promise<void> {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
    this.statusEl = null;
    this.urlInput = null;
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

  // ---- state persistence -----------------------------------------------------

  private restoreFromParams(): void {
    const savedSteps = this.api.getParam('pipeline');
    if (Array.isArray(savedSteps)) {
      this.steps = savedSteps.filter(
        (s): s is EtlStep => s !== null && typeof s === 'object' && STEP_KINDS.includes((s as EtlStep).kind),
      );
    }
    const savedUrl = this.api.getParam('apiUrl');
    if (typeof savedUrl === 'string') this.apiUrl = savedUrl;
  }

  private persist(): void {
    this.dirty = true;
    try {
      this.api.setParam('pipeline', this.steps);
      this.api.setParam('apiUrl', this.apiUrl);
    } catch {
      // Project store not mounted (e.g. detached tests) — state stays in memory.
    }
    this.refreshStatus();
  }

  onProjectSave(): void {
    try {
      this.api.setParam('pipeline', this.steps);
      this.api.setParam('apiUrl', this.apiUrl);
    } catch {
      // same guard as persist()
    }
  }

  onProjectLoad(): void {
    this.restoreFromParams();
    this.result = null;
    this.stats = [];
    this.stepError = null;
    this.dirty = false;
    this.draw();
  }

  // ---- parameter panel ---------------------------------------------------------

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'apiUrl',
        label: 'API URL',
        labelI18n: { 'zh-CN': 'API 地址', 'en-US': 'API URL' },
        type: 'text',
        value: this.apiUrl,
        placeholder: 'https://example.org/data.json',
      },
      actionButton('run', 'Run pipeline', '运行流水线', 'primary'),
      actionButton('loadData', 'Open CSV/JSON', '打开 CSV/JSON'),
      actionButton('fetchUrl', 'Fetch URL', '拉取 URL'),
      actionButton('loadSample', 'Load sample', '加载示例'),
      actionButton('exportPandas', 'Export pandas', '导出 pandas'),
      actionButton('exportR', 'Export R', '导出 R'),
      actionButton('exportSql', 'Export SQL', '导出 SQL'),
      actionButton('exportFlow', 'Export flow JSON', '导出流程 JSON'),
    ];
  }

  updateParams(params: Record<string, unknown>): void {
    if (typeof params.apiUrl === 'string' && params.apiUrl !== this.apiUrl) {
      this.apiUrl = params.apiUrl;
      if (this.urlInput) this.urlInput.value = this.apiUrl;
    }
    if (actionFired(params, 'run')) {
      void this.runPipeline(true);
      return;
    }
    if (actionFired(params, 'loadData')) {
      void this.openDataFile(false);
      return;
    }
    if (actionFired(params, 'fetchUrl')) {
      void this.fetchUrl();
      return;
    }
    if (actionFired(params, 'loadSample')) {
      this.loadSample();
      return;
    }
    if (actionFired(params, 'exportPandas')) {
      this.exportCode('pandas');
      return;
    }
    if (actionFired(params, 'exportR')) {
      this.exportCode('r');
      return;
    }
    if (actionFired(params, 'exportSql')) {
      this.exportCode('sql');
      return;
    }
    if (actionFired(params, 'exportFlow')) {
      this.exportFlow();
    }
  }

  // ---- data loading ------------------------------------------------------------

  /** Host file route (drag-drop / example dialog). */
  async loadData(file: File): Promise<void> {
    const text = await this.api.readText(file);
    const store = usePluginStore.getState();
    const runId = store.beginRun({
      pluginId: this.manifest.id,
      kind: 'data-import',
      label: file.name,
      detail: { bytes: file.size },
    });
    if (this.ingestText(text, file.name, false)) store.finishRun(runId, true);
    else store.finishRun(runId, false, 'parse failed');
  }

  private async openDataFile(isJoin: boolean): Promise<void> {
    const file = await this.api.openFile('.csv,.json');
    if (!file) return;
    const text = await this.api.readText(file);
    const store = usePluginStore.getState();
    const runId = store.beginRun({
      pluginId: this.manifest.id,
      kind: 'data-import',
      label: file.name,
      detail: { bytes: file.size, role: isJoin ? 'join' : 'source' },
    });
    if (this.ingestText(text, file.name, isJoin)) store.finishRun(runId, true);
    else store.finishRun(runId, false, 'parse failed');
  }

  /** API connector: fetch a CSV/JSON document from the URL text parameter. */
  private async fetchUrl(): Promise<void> {
    const url = this.apiUrl.trim();
    if (url === '') {
      notify(this.api, 'warning', 'Enter an API URL first.', '请先填写 API 地址。');
      return;
    }
    if (typeof fetch !== 'function') {
      notify(this.api, 'error', 'fetch is unavailable in this context.', '当前环境不支持 fetch。');
      return;
    }
    const store = usePluginStore.getState();
    const runId = store.beginRun({ pluginId: this.manifest.id, kind: 'data-import', label: url });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      store.finishRun(runId, true);
      this.ingestText(text, url, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.finishRun(runId, false, message);
      notify(this.api, 'error', `Fetch failed: ${message}`, `拉取失败：${message}`);
    }
  }

  private loadSample(): void {
    this.ingestText(SAMPLE_ETL_CSV, 'etl-sample.csv', false);
  }

  /** Parse and set the source/join table; returns false on failure. */
  private ingestText(text: string, name: string, isJoin: boolean): boolean {
    if (!text.trim()) {
      notify(this.api, 'warning', 'The data source is empty.', '数据源为空。');
      return false;
    }
    try {
      const table = /\.json$/i.test(name) ? parseJsonTable(text) : parseTableAuto(text);
      if (table.rows.length === 0) throw new Error('no data rows found');
      if (isJoin) {
        this.joinTable = table;
        this.joinName = name;
      } else {
        this.source = table;
        this.sourceName = name;
        this.result = null;
        this.stats = [];
        this.stepError = null;
        this.api.reportDataScale(table.rows.length);
      }
      if (!isJoin && this.steps.length > 0) this.runPipeline(false);
      else this.draw();
      notify(
        this.api,
        'success',
        `Loaded ${name} (${table.rows.length} rows).`,
        `已载入 ${name}（${table.rows.length} 行）。`,
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Could not load "${name}": ${message}`, `无法载入「${name}」：${message}`);
      return false;
    }
  }

  // ---- pipeline execution --------------------------------------------------------

  private runPipeline(explicit: boolean): void {
    if (this.running) return;
    if (!this.source) {
      if (explicit) notify(this.api, 'warning', 'Load a data source first.', '请先加载数据源。');
      return;
    }
    this.running = true;
    this.api.setStatus('computing');
    const store = usePluginStore.getState();
    const runId = store.beginRun({
      pluginId: this.manifest.id,
      kind: 'compute',
      label: 'etl-pipeline',
      detail: { steps: this.steps.length, source: this.sourceName },
    });

    const started = performance.now();
    let table = this.source;
    const stats: StepStat[] = [];
    let failure: { index: number; message: string } | null = null;
    for (let i = 0; i < this.steps.length; i += 1) {
      const step = this.steps[i]!;
      const t0 = performance.now();
      try {
        table = applyStep(table, step, { joinTable: this.joinTable ?? undefined });
        stats.push({ rows: table.rows.length, ms: performance.now() - t0 });
      } catch (err) {
        failure = { index: i, message: err instanceof Error ? err.message : String(err) };
        break;
      }
    }
    const totalMs = performance.now() - started;

    store.finishRun(runId, failure === null, failure?.message);
    this.running = false;
    this.api.setStatus('ready');

    this.stats = stats;
    this.totalMs = totalMs;
    this.stepError = failure;
    this.result = failure === null ? table : null;
    this.dirty = false;
    this.publishMetrics();
    this.draw();

    if (explicit) {
      if (failure) {
        notify(
          this.api,
          'error',
          `Step ${failure.index + 1} failed: ${failure.message}`,
          `第 ${failure.index + 1} 步失败：${failure.message}`,
        );
      } else {
        notify(
          this.api,
          'success',
          `Pipeline finished — ${table.rows.length} rows in ${fmtMetric(totalMs, 4)} ms.`,
          `流水线完成 — ${table.rows.length} 行，耗时 ${fmtMetric(totalMs, 4)} ms。`,
        );
      }
    }
  }

  /** Publish the run's scientific conclusions to the shared output bus. */
  private publishMetrics(): void {
    if (!this.source) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const zh = this.zh;
    const inRate = missingCellRate(this.source) * 100;
    const outRate = this.result ? missingCellRate(this.result) * 100 : null;
    const metrics: ScienceMetric[] = [
      {
        key: 'rows-in',
        label: zh ? '输入行数' : 'Input rows',
        value: String(this.source.rows.length),
        severity: 'info',
      },
      {
        key: 'rows-out',
        label: zh ? '输出行数' : 'Output rows',
        value: this.result ? String(this.result.rows.length) : '—',
        severity: this.result ? 'ok' : 'error',
        hint: this.stepError ? `${zh ? '第' : 'step '}${this.stepError.index + 1}${zh ? '步失败' : ' failed'}` : undefined,
      },
      {
        key: 'cols',
        label: zh ? '列数变化' : 'Columns',
        value: `${this.source.columns.length} → ${this.result ? this.result.columns.length : '—'}`,
        severity: 'info',
      },
      {
        key: 'missing-rate',
        label: zh ? '缺失率变化' : 'Missing-cell rate',
        value: `${fmtMetric(inRate, 3)}% → ${outRate === null ? '—' : `${fmtMetric(outRate, 3)}%`}`,
        severity: 'info',
        hint: zh ? '缺失单元格占全部单元格的比例' : 'missing cells over all cells',
      },
      {
        key: 'runtime',
        label: zh ? '执行耗时' : 'Runtime',
        value: `${fmtMetric(this.totalMs, 4)} ms`,
        unit: 'ms',
        severity: 'info',
        hint: zh ? `${this.steps.length} 个步骤` : `${this.steps.length} steps`,
      },
    ];
    if (this.stepError) {
      metrics.push({
        key: 'step-error',
        label: zh ? '步骤错误' : 'Step error',
        value: `#${this.stepError.index + 1}: ${this.stepError.message}`,
        severity: 'error',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- exports ---------------------------------------------------------------------

  private exportCode(lang: 'pandas' | 'r' | 'sql'): void {
    if (this.steps.length === 0) {
      notify(this.api, 'warning', 'No steps to export yet.', '尚无可导出的步骤。');
      return;
    }
    const opts = {
      source: this.sourceName || 'data.csv',
      joinSource: this.joinName || 'join.csv',
      table: this.sourceName || 'source',
      joinTable: this.joinName || 'source2',
    };
    const code =
      lang === 'pandas'
        ? toPandasCode(this.steps, opts)
        : lang === 'r'
          ? toRCode(this.steps, opts)
          : toSqlCode(this.steps, opts);
    const ext = lang === 'pandas' ? 'py' : lang === 'r' ? 'R' : 'sql';
    this.api.exportFile(`etl-pipeline.${ext}`, code, 'text/plain');
    notify(
      this.api,
      'success',
      `${lang.toUpperCase()} code exported.`,
      `${lang.toUpperCase()} 代码已导出。`,
    );
  }

  private exportFlow(): void {
    if (this.steps.length === 0) {
      notify(this.api, 'warning', 'No steps to export yet.', '尚无可导出的步骤。');
      return;
    }
    const graph = stepsToFlowGraph(this.steps, { source: this.sourceName || 'data.csv' });
    this.api.exportFile('etl-flow.json', JSON.stringify(graph, null, 2), 'application/json');
    notify(this.api, 'success', 'Flow-mode DAG exported.', '流程模式 DAG 已导出。');
  }

  // ---- block / flow mode compute ------------------------------------------------------

  async compute(input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    if (typeof input === 'string' && input.trim()) {
      try {
        this.source = parseTableAuto(input);
        this.sourceName = 'input';
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    if (!this.source) return { ok: false, error: 'no data loaded' };
    const total = Math.max(1, this.steps.length);
    onProgress?.({ done: 0, total, label: 'etl-pipeline' });
    const started = performance.now();
    try {
      const res = runPipeline(this.source, this.steps, { joinTable: this.joinTable ?? undefined });
      const totalMs = performance.now() - started;
      this.result = res.table;
      this.stats = res.stats;
      this.totalMs = totalMs;
      this.stepError = null;
      this.dirty = false;
      this.publishMetrics();
      onProgress?.({ done: total, total, label: 'etl-pipeline' });
      return {
        ok: true,
        output: {
          rows: res.table.rows.length,
          columns: res.table.columns.length,
          steps: res.stats.map((s, i) => ({ index: i + 1, kind: this.steps[i]?.kind, ...s })),
          missingRate: missingCellRate(res.table),
          runtimeMs: totalMs,
          preview: res.table.rows.slice(0, 5),
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---- rendering ------------------------------------------------------------------------

  private t(key: StringKey): string {
    return (this.zh ? STRINGS['zh-CN'] : STRINGS['en-US'])[key];
  }

  private kindLabel(kind: EtlStepKind): string {
    const map: Record<EtlStepKind, StringKey> = {
      filter: 'kindFilter',
      map: 'kindMap',
      reduce: 'kindReduce',
      join: 'kindJoin',
      groupBy: 'kindGroupBy',
      pivot: 'kindPivot',
      melt: 'kindMelt',
      impute: 'kindImpute',
      normalize: 'kindNormalize',
      coerceType: 'kindCoerce',
    };
    return this.t(map[kind]);
  }

  private columnNames(): string[] {
    return (this.source?.columns ?? []).map((c) => c.name);
  }

  private draw(): void {
    const dom = this.ctx?.dom;
    if (!dom) return;
    dom.replaceChildren();
    const root = el('div', 'etl-root');
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    root.appendChild(this.buildToolbar());
    this.statusEl = this.buildStatus();
    root.appendChild(this.statusEl);

    const body = el('div', 'etl-body');
    body.appendChild(this.buildStepsPanel());
    body.appendChild(this.buildPreviewPanel());
    root.appendChild(body);

    dom.appendChild(root);
  }

  private button(label: string, primary: boolean, onClick: () => void, disabled = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `etl-btn${primary ? ' etl-btn-primary' : ''}`;
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private buildToolbar(): HTMLElement {
    const bar = el('div', 'etl-toolbar');
    bar.appendChild(this.button(this.t('loadData'), false, () => void this.openDataFile(false)));
    bar.appendChild(this.button(this.t('loadJoin'), false, () => void this.openDataFile(true)));

    const url = document.createElement('input');
    url.type = 'text';
    url.className = 'etl-url';
    url.placeholder = 'https://example.org/data.json';
    url.value = this.apiUrl;
    url.addEventListener('input', () => {
      this.apiUrl = url.value;
      try {
        this.api.setParam('apiUrl', this.apiUrl);
      } catch {
        // detached context
      }
    });
    this.urlInput = url;
    bar.appendChild(url);
    bar.appendChild(this.button(this.t('fetchUrl'), false, () => void this.fetchUrl()));
    bar.appendChild(this.button(this.t('loadSample'), false, () => this.loadSample()));

    const runBtn = this.button(this.t('run'), true, () => void this.runPipeline(true), this.running);
    runBtn.textContent = this.running ? this.t('running') : this.t('run');
    bar.appendChild(runBtn);

    const group = el('span', 'etl-btn-group');
    group.appendChild(this.button(this.t('exportPandas'), false, () => this.exportCode('pandas')));
    group.appendChild(this.button(this.t('exportR'), false, () => this.exportCode('r')));
    group.appendChild(this.button(this.t('exportSql'), false, () => this.exportCode('sql')));
    group.appendChild(this.button(this.t('exportFlow'), false, () => this.exportFlow()));
    bar.appendChild(group);
    return bar;
  }

  private buildStatus(): HTMLElement {
    const status = el('div', 'etl-status');
    this.refreshStatusInto(status);
    return status;
  }

  private refreshStatus(): void {
    if (this.statusEl) this.refreshStatusInto(this.statusEl);
  }

  private refreshStatusInto(target: HTMLElement): void {
    const parts: string[] = [];
    if (this.source) {
      parts.push(
        `${this.sourceName} · ${this.source.rows.length} ${this.t('rows')} · ${this.source.columns.length} ${this.t('cols')}`,
      );
      parts.push(
        `${this.t('loadJoin')}: ${this.joinTable ? `${this.joinName} (${this.joinTable.rows.length} ${this.t('rows')})` : this.t('joinNone')}`,
      );
    }
    if (this.stepError) {
      parts.push(`#${this.stepError.index + 1} — ${this.stepError.message}`);
    } else if (this.result) {
      parts.push(
        `${this.result.rows.length} ${this.t('rows')} · ${fmtMetric(this.totalMs, 3)} ms`,
      );
    }
    if (this.dirty) parts.push(this.t('stale'));
    target.replaceChildren();
    parts.forEach((part, i) => {
      if (i > 0) target.appendChild(document.createTextNode('  |  '));
      const span = el('span', this.stepError && i === parts.length - 1 ? 'etl-warn' : undefined, part);
      target.appendChild(span);
    });
    if (parts.length === 0) target.textContent = this.t('noSource');
  }

  private buildStepsPanel(): HTMLElement {
    const panel = el('div', 'etl-panel etl-steps');
    const head = el('div', 'etl-panel-head', this.t('stepsTitle'));
    panel.appendChild(head);

    // shared datalist so column inputs autocomplete the source columns
    const datalist = document.createElement('datalist');
    datalist.id = 'etl-col-options';
    for (const name of this.columnNames()) {
      const opt = document.createElement('option');
      opt.value = name;
      datalist.appendChild(opt);
    }
    panel.appendChild(datalist);

    const addRow = el('div', 'etl-addrow');
    const select = document.createElement('select');
    STEP_KINDS.forEach((kind) => {
      const opt = document.createElement('option');
      opt.value = kind;
      opt.textContent = this.kindLabel(kind);
      select.appendChild(opt);
    });
    addRow.appendChild(select);
    addRow.appendChild(
      this.button(this.t('add'), false, () => {
        this.steps.push(defaultStep(select.value as EtlStepKind, this.columnNames()));
        this.persist();
        this.draw();
      }),
    );
    panel.appendChild(addRow);

    const chain = el('div', 'etl-chain');
    if (this.steps.length === 0) {
      chain.appendChild(el('div', 'etl-hint', this.t('noSteps')));
    }
    this.steps.forEach((step, index) => {
      if (index > 0) chain.appendChild(connector());
      chain.appendChild(this.buildStepBlock(step, index));
    });
    panel.appendChild(chain);
    return panel;
  }

  private buildStepBlock(step: EtlStep, index: number): HTMLElement {
    const block = el('div', 'etl-step');
    const head = el('div', 'etl-step-head');
    head.appendChild(el('span', 'etl-step-kind', `${index + 1}. ${this.kindLabel(step.kind)}`));

    const stat = el('span', 'etl-step-stat');
    const stepStat = this.stats[index];
    if (this.stepError && this.stepError.index === index) {
      const err = el('span', 'etl-err', this.stepError.message);
      stat.appendChild(err);
    } else if (stepStat) {
      stat.textContent = `${stepStat.rows} ${this.t('rows')} · ${fmtMetric(stepStat.ms, 3)} ms`;
    }
    head.appendChild(stat);

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'etl-icon-btn';
    up.textContent = '↑';
    up.title = 'move up';
    up.disabled = index === 0;
    up.addEventListener('click', () => this.moveStep(index, -1));
    head.appendChild(up);

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'etl-icon-btn';
    down.textContent = '↓';
    down.title = 'move down';
    down.disabled = index === this.steps.length - 1;
    down.addEventListener('click', () => this.moveStep(index, 1));
    head.appendChild(down);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'etl-icon-btn';
    remove.textContent = '×';
    remove.title = 'remove';
    remove.addEventListener('click', () => {
      this.steps.splice(index, 1);
      this.persist();
      this.draw();
    });
    head.appendChild(remove);
    block.appendChild(head);

    const params = el('div', 'etl-step-params');
    this.buildStepParams(params, step, index);
    block.appendChild(params);
    return block;
  }

  /** One localized labelled field wrapping a control. */
  private field(label: string, control: HTMLElement): HTMLElement {
    const wrap = el('div', 'etl-field');
    wrap.appendChild(el('span', 'etl-field-label', label));
    wrap.appendChild(control);
    return wrap;
  }

  private textInput(value: string, onInput: (v: string) => void, list = false): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    if (list) input.setAttribute('list', 'etl-col-options');
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }

  private selectInput(options: readonly string[], value: string, onChange: (v: string) => void): HTMLSelectElement {
    const select = document.createElement('select');
    options.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      select.appendChild(option);
    });
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  private moveStep(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.steps.length) return;
    const [moved] = this.steps.splice(index, 1);
    if (!moved) return;
    this.steps.splice(target, 0, moved);
    this.persist();
  }

  private updateStep(index: number, patch: Record<string, unknown>): void {
    const current = this.steps[index];
    if (!current) return;
    this.steps[index] = { ...current, ...patch } as EtlStep;
    this.persist();
  }

  private buildStepParams(container: HTMLElement, step: EtlStep, index: number): void {
    const t = (key: StringKey) => this.t(key);
    const on = (key: string) => (v: string) => this.updateStep(index, { [key]: v });
    const colInput = (key: 'column' | 'on' | 'index' | 'columns' | 'value') =>
      this.textInput(String((step as unknown as Record<string, unknown>)[key] ?? ''), on(key), true);

    switch (step.kind) {
      case 'filter':
        container.appendChild(this.field(t('fColumn'), colInput('column')));
        container.appendChild(this.field(t('fOp'), this.selectInput(FILTER_OPS, step.op, on('op'))));
        container.appendChild(this.field(t('fValue'), this.textInput(step.value, on('value'))));
        break;
      case 'map':
        container.appendChild(this.field(t('fName'), this.textInput(step.name, on('name'))));
        container.appendChild(this.field(t('fExpr'), this.textInput(step.expression, on('expression'))));
        break;
      case 'reduce':
        container.appendChild(this.field(t('fColumn'), colInput('column')));
        container.appendChild(this.field(t('fFn'), this.selectInput(AGG_FNS, step.fn, on('fn'))));
        break;
      case 'join':
        container.appendChild(this.field(t('fOn'), colInput('on')));
        container.appendChild(this.field(t('fHow'), this.selectInput(JOIN_HOWS, step.how, on('how'))));
        break;
      case 'groupBy': {
        const keys = this.textInput(step.keys.join(', '), (v) =>
          this.updateStep(index, { keys: v.split(',').map((s) => s.trim()).filter((s) => s !== '') }),
        );
        keys.setAttribute('list', 'etl-col-options');
        container.appendChild(this.field(t('fKeys'), keys));
        container.appendChild(this.field(t('fValueCol'), colInput('column')));
        container.appendChild(this.field(t('fFn'), this.selectInput(AGG_FNS, step.fn, on('fn'))));
        break;
      }
      case 'pivot':
        container.appendChild(this.field(t('fIndex'), colInput('index')));
        container.appendChild(this.field(t('fColKey'), colInput('columns')));
        container.appendChild(this.field(t('fValueCol'), colInput('value')));
        container.appendChild(this.field(t('fFn'), this.selectInput(AGG_FNS, step.fn, on('fn'))));
        break;
      case 'melt': {
        const ids = this.textInput(step.idColumns.join(', '), (v) =>
          this.updateStep(index, { idColumns: v.split(',').map((s) => s.trim()).filter((s) => s !== '') }),
        );
        ids.setAttribute('list', 'etl-col-options');
        container.appendChild(this.field(t('fIds'), ids));
        break;
      }
      case 'impute':
        container.appendChild(this.field(t('fColumn'), colInput('column')));
        container.appendChild(this.field(t('fMethod'), this.selectInput(IMPUTE_METHODS, step.method, on('method'))));
        container.appendChild(this.field(t('fConstant'), this.textInput(step.value, on('value'))));
        break;
      case 'normalize':
        container.appendChild(this.field(t('fColumn'), colInput('column')));
        container.appendChild(this.field(t('fMethod'), this.selectInput(NORMALIZE_METHODS, step.method, on('method'))));
        break;
      case 'coerceType':
        container.appendChild(this.field(t('fColumn'), colInput('column')));
        container.appendChild(this.field(t('fType'), this.selectInput(COLUMN_TYPES, step.type, on('type'))));
        break;
    }
  }

  private buildPreviewPanel(): HTMLElement {
    const panel = el('div', 'etl-panel etl-preview');
    const table = this.result ?? this.source;
    const summary = table
      ? `${table.rows.length} ${this.t('rows')} · ${table.columns.length} ${this.t('cols')} · ${fmtMetric(missingCellRate(table) * 100, 3)}% ${this.t('missing')}`
      : '';
    const head = el('div', 'etl-panel-head');
    head.appendChild(el('span', undefined, this.t('previewTitle')));
    if (summary) head.appendChild(el('span', 'etl-summary', summary));
    panel.appendChild(head);

    if (!table) {
      panel.appendChild(el('div', 'etl-hint', this.t('noSource')));
      return panel;
    }
    const wrap = el('div', 'etl-tablewrap');
    const tbl = document.createElement('table');
    tbl.className = 'etl-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of table.columns) {
      const th = document.createElement('th');
      th.textContent = col.name;
      th.title = `${col.name} · ${col.type}`;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of table.rows.slice(0, PREVIEW_ROW_CAP)) {
      const tr = document.createElement('tr');
      for (const col of table.columns) {
        const td = document.createElement('td');
        const value = row[col.name];
        if (value === null || value === undefined) {
          td.className = 'etl-null';
          td.textContent = '—';
        } else {
          td.textContent = String(value);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    panel.appendChild(wrap);
    return panel;
  }
}

export default function createEtlPlugin(): Plugin {
  return new EtlPlugin();
}
