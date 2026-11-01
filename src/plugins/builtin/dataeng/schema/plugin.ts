// ==========================================================================
// Schema Inference & Validator plugin — host controller.
//
// Three canvas views (academic, low-saturation, no emoji):
//   1. Schema overview — per-column type / missing / uniqueness / range /
//      categories, primary-key candidates, functional dependencies and
//      correlated numeric pairs.
//   2. JSON Schema — pretty draft-07 JSON with copy / download actions.
//   3. Validation & drift — a second dataset checked against the inferred
//      schema (or the saved contract) with graded violations and schema
//      drift items.
//
// The kernel is pure (see ./kernel); this file only wires data loading,
// run records, science outputs and drawing. Missing-value handling and the
// Row model are reused from `@/core/data-quality` via the kernel.
// ==========================================================================

import type {
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs } from '@/core/research/scienceOutput';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import { usePluginStore } from '@/stores/pluginStore';
import type { Row } from '@/core/data-quality';
import { schemaManifest } from './manifest';
import {
  deserializeContract,
  diffSchemas,
  inferSchema,
  parseDataRows,
  serializeContract,
  suggestContract,
  toJsonSchema,
  validateAgainstSchema,
  validateContract,
} from './kernel';
import type {
  DataContract,
  DriftItem,
  TableSchema,
  ValidationResult,
  ViolationCode,
} from './kernel';

// ---- visual constants (academic, low-saturation) ----------------------------

const CS = {
  bg: '#fbfcfd',
  text: '#3d4657',
  dim: '#6b7686',
  faint: '#9aa4b2',
  line: '#d8dde4',
  headBg: '#eef1f5',
  accent: '#7fa8c9',
  teal: '#6fb3ad',
  ok: '#5f9c94',
  warn: '#c2a068',
  error: '#b98080',
  band: '#f4f6f9',
} as const;

function font(zh: boolean, size = 11, weight = ''): string {
  const family = zh ? "'Microsoft YaHei', 'Noto Sans SC'" : 'Consolas, monospace';
  return `${weight ? `${weight} ` : ''}${size}px ${family}`;
}

// ---- embedded deterministic sample -------------------------------------------

const SAMPLE_CSV = `sample_id,site,depth_m,temperature_c,salinity_psu,collected_at,flag
S-0001,station_a,12,14.2,31.5,2026-03-01,true
S-0002,station_a,12,14.4,31.5,2026-03-01,true
S-0003,station_b,34,9.8,33.1,2026-03-02,false
S-0004,station_b,34,9.9,33.2,2026-03-02,false
S-0005,station_c,58,6.1,34.0,2026-03-03,true
S-0006,station_c,58,6.0,34.0,2026-03-03,true
S-0007,station_a,12,14.3,31.6,2026-03-04,true
S-0008,station_b,,10.1,33.0,2026-03-04,false
S-0009,station_c,58,6.2,34.1,2026-03-05,false
S-0010,station_b,34,10.0,33.1,2026-03-05,false
S-0011,station_a,12,14.5,,2026-03-06,true
S-0012,station_c,58,6.1,34.0,2026-03-06,true`;

// ---- i18n strings (plugin-local, zh/en) ----------------------------------------

const STR = {
  title: { en: 'Schema Inference & Validator', zh: 'Schema 推断与校验' },
  awaiting: { en: 'awaiting data', zh: '等待数据' },
  hintIdle: {
    en: 'Open a CSV/JSON file or load the sample to infer a schema.',
    zh: '打开 CSV/JSON 文件或加载示例以推断 Schema。',
  },
  hintIdle2: {
    en: 'Workflow: infer schema → inspect → export JSON Schema → validate a second batch.',
    zh: '流程：推断 Schema → 检视 → 导出 JSON Schema → 校验第二批数据。',
  },
  viewOverview: { en: 'Schema overview', zh: 'Schema 概览' },
  viewJson: { en: 'JSON Schema', zh: 'JSON Schema 生成' },
  viewValidate: { en: 'Validation & drift', zh: '校验与漂移' },
  paramView: { en: 'View', zh: '视图' },
  paramTolerance: { en: 'Range drift tolerance', zh: '范围漂移容差' },
  btnOpen: { en: 'Open Data File', zh: '打开数据文件' },
  btnSample: { en: 'Load Sample', zh: '加载示例' },
  btnCopy: { en: 'Copy JSON Schema', zh: '复制 JSON Schema' },
  btnDownload: { en: 'Download JSON Schema', zh: '下载 JSON Schema' },
  btnSecond: { en: 'Open Comparison Data', zh: '打开比对数据' },
  btnContract: { en: 'Save Contract', zh: '保存契约' },
  colColumn: { en: 'column', zh: '列名' },
  colType: { en: 'type', zh: '类型' },
  colMissing: { en: 'missing', zh: '缺失率' },
  colUnique: { en: 'unique', zh: '唯一率' },
  colRange: { en: 'range', zh: '范围' },
  colCats: { en: 'categories', zh: '类别数' },
  colPattern: { en: 'pattern', zh: '模式' },
  colPk: { en: 'key', zh: '主键' },
  fdTitle: { en: 'Functional dependencies', zh: '函数依赖' },
  corrTitle: { en: 'Correlated numeric pairs', zh: '相关数值列' },
  noFd: { en: 'none detected', zh: '未检测到' },
  violationsTitle: { en: 'Violations', zh: '违例' },
  driftTitle: { en: 'Schema drift', zh: 'Schema 漂移' },
  colRow: { en: 'row', zh: '行号' },
  colSeverity: { en: 'severity', zh: '级别' },
  colCode: { en: 'code', zh: '代码' },
  colValue: { en: 'actual', zh: '实际值' },
  colKind: { en: 'kind', zh: '类型' },
  colDetail: { en: 'detail', zh: '说明' },
  noViolations: { en: 'no violations', zh: '无违例' },
  noDrift: { en: 'no drift', zh: '无漂移' },
  noSecond: {
    en: 'Open comparison data to validate against this schema.',
    zh: '打开比对数据以针对当前 Schema 校验。',
  },
  noSchema: { en: 'no schema inferred yet', zh: '尚未推断 Schema' },
  // science outputs
  soColumns: { en: 'Columns', zh: '列数' },
  soRows: { en: 'Rows', zh: '行数' },
  soMissing: { en: 'Overall missing rate', zh: '总体缺失率' },
  soPk: { en: 'Primary-key candidates', zh: '主键候选数' },
  soFd: { en: 'Functional dependencies', zh: '函数依赖数' },
  soViolatingRows: { en: 'Violating-row ratio', zh: '违例行占比' },
  soDrift: { en: 'Drift items', zh: '漂移项数' },
  soViolations: { en: 'Violations (errors / warnings)', zh: '违例数（错/警）' },
  // notifications
  loadedOk: { en: 'Data loaded and schema inferred.', zh: '数据已载入，Schema 已推断。' },
  loadFail: { en: 'Could not parse the file as CSV/JSON records.', zh: '无法将文件解析为 CSV/JSON 记录。' },
  secondOk: { en: 'Comparison data validated.', zh: '比对数据校验完成。' },
  secondFail: { en: 'Could not parse the comparison file as CSV/JSON records.', zh: '无法将比对文件解析为 CSV/JSON 记录。' },
  needSchemaFirst: { en: 'Infer a schema first.', zh: '请先推断 Schema。' },
  copied: { en: 'JSON Schema copied to clipboard.', zh: 'JSON Schema 已复制到剪贴板。' },
  copyFail: { en: 'Clipboard unavailable; use Download instead.', zh: '剪贴板不可用，请改用下载。' },
  downloaded: { en: 'JSON Schema exported.', zh: 'JSON Schema 已导出。' },
  contractSaved: { en: 'Data contract saved to the project.', zh: '数据契约已保存到项目。' },
  contractRestored: { en: 'Saved data contract restored.', zh: '已恢复保存的数据契约。' },
  runInfer: { en: 'infer-schema', zh: '推断 Schema' },
  runValidate: { en: 'validate-drift', zh: '校验与漂移' },
  runImport: { en: 'data-import', zh: '数据导入' },
} as const;

type StrKey = keyof typeof STR;
function t(key: StrKey, zh: boolean): string {
  return zh ? STR[key].zh : STR[key].en;
}

// violation code → locale text (kernel codes stay stable)
const CODE_TEXT: Record<ViolationCode, { en: string; zh: string }> = {
  MISSING_REQUIRED: { en: 'missing required value', zh: '缺失必填值' },
  TYPE_MISMATCH: { en: 'type mismatch', zh: '类型不符' },
  OUT_OF_RANGE: { en: 'out of observed range', zh: '超出观测范围' },
  INVALID_CATEGORY: { en: 'unknown category', zh: '类别域之外' },
  PATTERN_MISMATCH: { en: 'pattern mismatch', zh: '模式不符' },
  OUTLIER_3SIGMA: { en: 'outlier (>3 sigma)', zh: '离群值（>3σ）' },
  UNKNOWN_COLUMN: { en: 'column not in schema', zh: 'Schema 外的列' },
  UNIQUE_KEY_VIOLATION: { en: 'duplicate key', zh: '唯一键重复' },
};

const DRIFT_TEXT: Record<DriftItem['kind'], { en: string; zh: string }> = {
  'added-column': { en: 'added column', zh: '新增列' },
  'removed-column': { en: 'removed column', zh: '删除列' },
  'type-changed': { en: 'type change', zh: '类型变更' },
  'nullable-changed': { en: 'nullability change', zh: '可空性变化' },
  'category-expanded': { en: 'category expansion', zh: '类别域扩张' },
  'category-contracted': { en: 'category contraction', zh: '类别域收缩' },
  'range-drift': { en: 'range drift', zh: '范围漂移' },
};

const TYPE_TEXT: Record<TableSchema['columns'][number]['type'], { en: string; zh: string }> = {
  integer: { en: 'integer', zh: '整数' },
  number: { en: 'number', zh: '数值' },
  boolean: { en: 'boolean', zh: '布尔' },
  date: { en: 'date', zh: '日期' },
  datetime: { en: 'datetime', zh: '日期时间' },
  string: { en: 'string', zh: '字符串' },
  categorical: { en: 'categorical', zh: '类别' },
};

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x: number): string {
  if (Number.isInteger(x)) return String(x);
  return Math.abs(x) >= 100 ? x.toFixed(1) : x.toFixed(3);
}

// ---- plugin ------------------------------------------------------------------

type ViewKind = 'overview' | 'json' | 'validate';
const VIEW_VALUES: readonly string[] = ['overview', 'json', 'validate'];

export class SchemaPlugin implements Plugin {
  readonly manifest = schemaManifest;
  private api!: PluginApi;
  private zh = false;

  private ctx: ContainerCapabilities | null = null;
  private rows: Row[] = [];
  private dataName = '';
  private schema: TableSchema | null = null;
  private jsonSchemaText = '';
  private secondRows: Row[] | null = null;
  private validationResult: ValidationResult | null = null;
  private drift: DriftItem[] | null = null;
  private contract: DataContract | null = null;
  private view: ViewKind = 'overview';
  private tolerance = 0.05;

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
  }

  async onProjectLoad(): Promise<void> {
    const raw = this.api.getParam('contract');
    if (typeof raw === 'string' && raw.trim()) {
      try {
        this.contract = deserializeContract(raw);
        this.schema = this.contract.schema;
        this.jsonSchemaText = JSON.stringify(toJsonSchema(this.schema), null, 2);
        notify(this.api, 'info', t('contractRestored', false), t('contractRestored', true));
        this.publishInference();
      } catch {
        // A stale or incompatible contract must not break loading.
        this.contract = null;
      }
    }
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameter panel -------------------------------------------------------

  private select(
    key: string,
    labelKey: StrKey,
    value: string,
    options: Array<{ value: string; labelKey: StrKey | null; raw?: string }>,
  ): ParamDefinition {
    return {
      key,
      label: t(labelKey, false),
      labelI18n: { 'zh-CN': t(labelKey, true), 'en-US': t(labelKey, false) },
      type: 'select',
      value,
      options: options.map((o) => ({
        value: o.value,
        label: o.raw ?? (o.labelKey ? t(o.labelKey, this.zh) : o.value),
        labelI18n: o.raw
          ? { 'zh-CN': o.raw, 'en-US': o.raw }
          : o.labelKey
            ? { 'zh-CN': t(o.labelKey, true), 'en-US': t(o.labelKey, false) }
            : undefined,
      })),
    };
  }

  getParams(): ParamDefinition[] {
    return [
      this.select('view', 'paramView', this.view, [
        { value: 'overview', labelKey: 'viewOverview' },
        { value: 'json', labelKey: 'viewJson' },
        { value: 'validate', labelKey: 'viewValidate' },
      ]),
      {
        key: 'tolerance',
        label: t('paramTolerance', false),
        labelI18n: { 'zh-CN': t('paramTolerance', true), 'en-US': t('paramTolerance', false) },
        type: 'number',
        min: 0,
        max: 0.5,
        step: 0.01,
        value: this.tolerance,
      },
      actionButton('openData', t('btnOpen', false), t('btnOpen', true), 'primary'),
      actionButton('loadSample', t('btnSample', false), t('btnSample', true)),
      actionButton('copyJson', t('btnCopy', false), t('btnCopy', true)),
      actionButton('downloadJson', t('btnDownload', false), t('btnDownload', true)),
      actionButton('openSecond', t('btnSecond', false), t('btnSecond', true)),
      actionButton('saveContract', t('btnContract', false), t('btnContract', true)),
    ];
  }

  updateParams(params: Record<string, unknown>): void {
    if (typeof params.view === 'string' && VIEW_VALUES.includes(params.view)) {
      this.view = params.view as ViewKind;
      this.draw();
    }
    if (typeof params.tolerance === 'number' && Number.isFinite(params.tolerance)) {
      this.tolerance = Math.min(0.5, Math.max(0, params.tolerance));
    }
    if (actionFired(params, 'openData')) {
      void this.openPrimary();
      return;
    }
    if (actionFired(params, 'loadSample')) {
      this.loadSample();
      return;
    }
    if (actionFired(params, 'copyJson')) {
      this.copyJsonSchema();
      return;
    }
    if (actionFired(params, 'downloadJson')) {
      this.downloadJsonSchema();
      return;
    }
    if (actionFired(params, 'openSecond')) {
      void this.openSecond();
      return;
    }
    if (actionFired(params, 'saveContract')) {
      this.saveContract();
      return;
    }
  }

  // ---- data loading ------------------------------------------------------------

  async loadData(file: File): Promise<void> {
    const text = await file.text();
    this.ingest(text, file.name.endsWith('.json') ? 'json' : 'csv', file.name, true);
  }

  private async openPrimary(): Promise<void> {
    const file = await this.api.openFile('.csv,.json');
    if (!file) return;
    const text = await this.api.readText(file);
    this.ingest(text, file.name.endsWith('.json') ? 'json' : 'csv', file.name, true);
  }

  private async openSecond(): Promise<void> {
    if (!this.schema) {
      notify(this.api, 'warning', t('needSchemaFirst', false), t('needSchemaFirst', true));
      return;
    }
    const file = await this.api.openFile('.csv,.json');
    if (!file) return;
    const text = await this.api.readText(file);
    const format = file.name.endsWith('.json') ? 'json' : 'csv';
    try {
      const rows = parseDataRows(text, format);
      this.secondRows = rows;
      this.runValidation();
      notify(
        this.api,
        'success',
        `${t('secondOk', false)} (${rows.length} rows)`,
        `${t('secondOk', true)}（${rows.length} 行）`,
      );
    } catch {
      this.secondRows = null;
      this.validationResult = null;
      this.drift = null;
      notify(this.api, 'error', t('secondFail', false), t('secondFail', true));
    }
    this.view = 'validate';
    this.draw();
  }

  private loadSample(): void {
    this.ingest(SAMPLE_CSV, 'csv', 'sample.csv', false);
  }

  private ingest(text: string, format: 'csv' | 'json', name: string, fromFile: boolean): void {
    const store = usePluginStore.getState();
    const runId = store.beginRun({
      pluginId: this.manifest.id,
      kind: 'data-import',
      label: `${t('runImport', this.zh)}: ${name}`,
      detail: { format, bytes: text.length },
    });
    try {
      const rows = parseDataRows(text, format);
      this.rows = rows;
      this.dataName = name;
      this.secondRows = null;
      this.validationResult = null;
      this.drift = null;
      this.view = 'overview';
      usePluginStore.getState().finishRun(runId, true);
      this.runInference();
      if (fromFile) {
        notify(
          this.api,
          'success',
          `${t('loadedOk', false)} (${rows.length} rows)`,
          `${t('loadedOk', true)}（${rows.length} 行）`,
        );
      }
    } catch {
      usePluginStore.getState().finishRun(runId, false, 'parse error');
      this.schema = null;
      this.rows = [];
      this.publishInference();
      this.draw();
      notify(this.api, 'error', t('loadFail', false), t('loadFail', true));
    }
  }

  // ---- runs ----------------------------------------------------------------------

  private runInference(): void {
    const store = usePluginStore.getState();
    const runId = store.beginRun({
      pluginId: this.manifest.id,
      kind: 'compute',
      label: t('runInfer', this.zh),
      detail: { rows: this.rows.length, mode: 'inference' },
    });
    try {
      this.schema = inferSchema(this.rows);
      this.jsonSchemaText = JSON.stringify(toJsonSchema(this.schema), null, 2);
      usePluginStore.getState().finishRun(runId, true);
      this.publishInference();
    } catch (err) {
      usePluginStore.getState().finishRun(runId, false, err instanceof Error ? err.message : String(err));
      this.schema = null;
      this.publishInference();
    }
    this.api.reportDataScale(this.rows.length);
    this.draw();
  }

  private runValidation(): void {
    if (!this.schema || !this.secondRows) return;
    const store = usePluginStore.getState();
    const runId = store.beginRun({
      pluginId: this.manifest.id,
      kind: 'compute',
      label: t('runValidate', this.zh),
      detail: {
        rows: this.secondRows.length,
        mode: this.contract ? 'contract' : 'schema',
      },
    });
    try {
      this.validationResult = this.contract
        ? validateContract(this.secondRows, this.contract, { outlierSigma: 3 })
        : validateAgainstSchema(this.secondRows, this.schema, { outlierSigma: 3 });
      this.drift = diffSchemas(this.schema, inferSchema(this.secondRows), {
        rangeTolerance: this.tolerance,
      });
      usePluginStore.getState().finishRun(runId, true);
    } catch (err) {
      usePluginStore.getState().finishRun(runId, false, err instanceof Error ? err.message : String(err));
      this.validationResult = null;
      this.drift = null;
    }
    this.publishValidation();
  }

  // ---- actions ---------------------------------------------------------------------

  private copyJsonSchema(): void {
    if (!this.jsonSchemaText) {
      notify(this.api, 'warning', t('needSchemaFirst', false), t('needSchemaFirst', true));
      return;
    }
    const text = this.jsonSchemaText;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => notify(this.api, 'success', t('copied', false), t('copied', true)))
        .catch(() => notify(this.api, 'warning', t('copyFail', false), t('copyFail', true)));
    } else {
      notify(this.api, 'warning', t('copyFail', false), t('copyFail', true));
    }
  }

  private downloadJsonSchema(): void {
    if (!this.jsonSchemaText) {
      notify(this.api, 'warning', t('needSchemaFirst', false), t('needSchemaFirst', true));
      return;
    }
    this.api.exportFile('schema.json', this.jsonSchemaText, 'application/json');
    notify(this.api, 'success', t('downloaded', false), t('downloaded', true));
  }

  private saveContract(): void {
    if (!this.schema) {
      notify(this.api, 'warning', t('needSchemaFirst', false), t('needSchemaFirst', true));
      return;
    }
    this.contract = suggestContract(this.schema, { rangeTolerance: this.tolerance });
    this.api.setParam('contract', serializeContract(this.contract));
    notify(this.api, 'success', t('contractSaved', false), t('contractSaved', true));
  }

  // ---- science outputs ---------------------------------------------------------------

  private publishInference(): void {
    const zh = this.zh;
    const schema = this.schema;
    if (!schema || schema.columns.length === 0) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    let missingCells = 0;
    let totalCells = 0;
    for (const col of schema.columns) {
      totalCells += schema.rowCount;
      missingCells += col.missingRatio * schema.rowCount;
    }
    const metrics: ScienceMetric[] = [
      { key: 'rows', label: t('soRows', zh), value: String(schema.rowCount), severity: 'info' },
      { key: 'columns', label: t('soColumns', zh), value: String(schema.columns.length), severity: 'info' },
      {
        key: 'missing',
        label: t('soMissing', zh),
        value: pct(totalCells > 0 ? missingCells / totalCells : 0),
        severity: missingCells / Math.max(1, totalCells) > 0.1 ? 'warn' : 'info',
      },
      {
        key: 'pk',
        label: t('soPk', zh),
        value: String(schema.columns.filter((c) => c.primaryKeyCandidate).length),
        severity: 'info',
      },
      {
        key: 'fd',
        label: t('soFd', zh),
        value: String(schema.functionalDependencies.length),
        severity: 'info',
        hint: schema.functionalDependencies
          .slice(0, 3)
          .map((fd) => `${fd.determinant} → ${fd.dependent}`)
          .join('; '),
      },
    ];
    if (this.validationResult) {
      const vr = this.validationResult;
      metrics.push(
        {
          key: 'violating-rows',
          label: t('soViolatingRows', zh),
          value: pct(vr.violatingRowRatio),
          severity: vr.errorCount > 0 ? 'error' : vr.warningCount > 0 ? 'warn' : 'ok',
        },
        {
          key: 'violations',
          label: t('soViolations', zh),
          value: `${vr.errorCount} / ${vr.warningCount}`,
          severity: vr.errorCount > 0 ? 'error' : vr.warningCount > 0 ? 'warn' : 'ok',
        },
      );
    }
    if (this.drift) {
      const breaking = this.drift.filter((d) => d.severity === 'error').length;
      metrics.push({
        key: 'drift',
        label: t('soDrift', zh),
        value: String(this.drift.length),
        severity: breaking > 0 ? 'error' : this.drift.length > 0 ? 'warn' : 'ok',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private publishValidation(): void {
    // Validation metrics ride on the inference metric set; refresh it.
    this.publishInference();
  }

  // ---- block / flow mode ---------------------------------------------------------------

  async compute(input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    if (typeof input !== 'string' || !input.trim()) {
      return { ok: false, error: 'expected CSV/JSON text input' };
    }
    onProgress?.({ done: 0, total: 2, label: 'schema-inference' });
    try {
      const rows = parseDataRows(input, 'csv');
      const schema = inferSchema(rows);
      onProgress?.({ done: 1, total: 2, label: 'schema-inference' });
      const jsonSchema = toJsonSchema(schema);
      onProgress?.({ done: 2, total: 2, label: 'schema-inference' });
      return {
        ok: true,
        output: {
          rows: schema.rowCount,
          columns: schema.columns.length,
          primaryKeyCandidates: schema.columns.filter((c) => c.primaryKeyCandidate).map((c) => c.name),
          functionalDependencies: schema.functionalDependencies,
          correlations: schema.correlations,
          jsonSchema,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---- rendering ---------------------------------------------------------------------------

  render(container: ContainerCapabilities): void {
    this.ctx = container;
    this.draw();
  }

  async activate(context: { container: ContainerCapabilities }): Promise<void> {
    this.ctx = context.container;
    this.draw();
  }

  async deactivate(): Promise<void> {
    this.ctx = null;
  }

  private draw(): void {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 880;
    canvas.height = canvas.clientHeight || 500;
    const g = canvas.getContext('2d');
    if (!g) return;
    const w = canvas.width;
    const h = canvas.height;
    const zh = this.zh;
    g.fillStyle = CS.bg;
    g.fillRect(0, 0, w, h);
    g.textBaseline = 'alphabetic';

    const schema = this.schema;
    const subtitle = schema
      ? `${this.dataName || 'data'} · ${schema.rowCount} × ${schema.columns.length}${this.contract ? ' · contract' : ''}`
      : t('awaiting', zh);
    g.fillStyle = CS.text;
    g.font = font(zh, 14, '600');
    g.textAlign = 'left';
    g.fillText(t('title', zh), 24, 30);
    g.fillStyle = CS.dim;
    g.font = font(zh, 11);
    g.fillText(subtitle, 24, 48);
    g.strokeStyle = CS.line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(24, 58);
    g.lineTo(w - 24, 58);
    g.stroke();

    if (!schema) {
      g.fillStyle = CS.faint;
      g.font = font(zh, 12);
      g.textAlign = 'center';
      g.fillText(t('hintIdle', zh), w / 2, h / 2 - 8);
      g.fillText(t('hintIdle2', zh), w / 2, h / 2 + 14);
      return;
    }

    const top = 74;
    if (this.view === 'overview') this.drawOverview(g, w, h, top, schema);
    else if (this.view === 'json') this.drawJson(g, w, h, top);
    else this.drawValidate(g, w, h, top);
  }

  /** Column-width helper: distribute width proportional to weights. */
  private columnWidths(w: number, left: number, right: number, weights: number[]): number[] {
    const usable = w - left - right;
    const total = weights.reduce((s, x) => s + x, 0);
    return weights.map((x) => (x / total) * usable);
  }

  private truncate(g: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (g.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s}…`;
  }

  private drawTable(
    g: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    width: number,
    headers: string[],
    rows: string[][],
    rowColors?: Array<string | null>,
    rowHeight = 20,
  ): number {
    const weights = headers.map(() => 1);
    const widths = this.columnWidths(width, 0, 0, weights);
    const cellPad = 6;
    const drawRow = (cells: string[], y: number, isHead: boolean, color: string | null): void => {
      g.fillStyle = isHead ? CS.headBg : color ?? 'transparent';
      g.fillRect(x0, y, width, rowHeight);
      g.fillStyle = isHead ? CS.dim : color ?? CS.text;
      g.font = font(this.zh, isHead ? 10.5 : 10.5, isHead ? '600' : '');
      g.textAlign = 'left';
      let cx = x0;
      cells.forEach((cell, i) => {
        const wCell = widths[i] ?? 40;
        g.fillText(this.truncate(g, cell, wCell - cellPad * 2), cx + cellPad, y + rowHeight - 6);
        cx += wCell;
      });
      g.strokeStyle = CS.line;
      g.lineWidth = 0.5;
      g.beginPath();
      g.moveTo(x0, y + rowHeight);
      g.lineTo(x0 + width, y + rowHeight);
      g.stroke();
    };
    let y = y0;
    drawRow(headers, y, true, null);
    y += rowHeight;
    rows.forEach((cells, i) => {
      drawRow(cells, y, false, rowColors?.[i] ?? (i % 2 === 1 ? CS.band : null));
      y += rowHeight;
    });
    return y;
  }

  private drawOverview(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    top: number,
    schema: TableSchema,
  ): void {
    const zh = this.zh;
    const headers = [
      t('colColumn', zh),
      t('colType', zh),
      t('colMissing', zh),
      t('colUnique', zh),
      t('colRange', zh),
      t('colCats', zh),
      t('colPattern', zh),
      t('colPk', zh),
    ];
    const widths = this.columnWidths(w - 48, 0, 0, [2, 1.4, 1.1, 1.1, 2.2, 1, 1.6, 0.8]);
    const cellPad = 6;
    const rowHeight = 20;

    const drawRow = (cells: string[], y: number, isHead: boolean, pk: boolean): void => {
      g.fillStyle = isHead ? CS.headBg : 'transparent';
      g.fillRect(24, y, w - 48, rowHeight);
      g.fillStyle = isHead ? CS.dim : CS.text;
      g.font = font(zh, 10.5, isHead ? '600' : '');
      g.textAlign = 'left';
      let cx = 24;
      cells.forEach((cell, i) => {
        const wc = widths[i] ?? 40;
        g.fillStyle = isHead
          ? CS.dim
          : i === 7 && cell === '+'
            ? CS.teal
            : i === 0
              ? CS.text
              : CS.dim;
        g.fillText(this.truncate(g, cell, wc - cellPad * 2), cx + cellPad, y + rowHeight - 6);
        cx += wc;
      });
      if (pk && !isHead) {
        g.fillStyle = CS.teal;
        g.fillRect(24, y + rowHeight - 2, w - 48, 2);
      }
      g.strokeStyle = CS.line;
      g.lineWidth = 0.5;
      g.beginPath();
      g.moveTo(24, y + rowHeight);
      g.lineTo(w - 24, y + rowHeight);
      g.stroke();
    };

    let y = top;
    drawRow(headers, y, true, false);
    y += rowHeight;
    for (const col of schema.columns) {
      const range =
        col.min !== undefined && col.max !== undefined
          ? `[${typeof col.min === 'number' ? fmtNum(col.min) : col.min}, ${typeof col.max === 'number' ? fmtNum(col.max) : col.max}]`
          : '-';
      const cells = [
        col.name,
        TYPE_TEXT[col.type][zh ? 'zh' : 'en'],
        pct(col.missingRatio),
        pct(col.uniqueRatio),
        range,
        col.categories ? String(col.categories.length) : '-',
        col.pattern ?? '-',
        col.primaryKeyCandidate ? '+' : '',
      ];
      drawRow(cells, y, false, col.primaryKeyCandidate);
      y += rowHeight;
      if (y > h - 90) break;
    }

    // Functional dependencies + correlations
    y += 8;
    g.fillStyle = CS.dim;
    g.font = font(zh, 11, '600');
    g.textAlign = 'left';
    g.fillText(`${t('fdTitle', zh)}:`, 24, y);
    g.font = font(zh, 10.5);
    g.fillStyle = CS.text;
    const fds = schema.functionalDependencies.length
      ? schema.functionalDependencies.map((fd) => `${fd.determinant} → ${fd.dependent}`).join('   ')
      : t('noFd', zh);
    g.fillText(this.truncate(g, fds, w - 48 - g.measureText(`${t('fdTitle', zh)}:   `).width - 24), 24 + 130, y);
    y += 18;
    g.fillStyle = CS.dim;
    g.font = font(zh, 11, '600');
    g.fillText(`${t('corrTitle', zh)}:`, 24, y);
    g.font = font(zh, 10.5);
    g.fillStyle = CS.text;
    const corrs = schema.correlations.length
      ? schema.correlations
          .map((c) => `${c.a} ~ ${c.b} (r=${c.r.toFixed(2)})`)
          .join('   ')
      : t('noFd', zh);
    g.fillText(this.truncate(g, corrs, w - 48 - 130), 24 + 130, y);
  }

  private drawJson(g: CanvasRenderingContext2D, w: number, h: number, top: number): void {
    const lines = this.jsonSchemaText ? this.jsonSchemaText.split('\n') : [];
    const maxLines = Math.floor((h - top - 40) / 16);
    g.font = font(false, 10.5);
    g.textAlign = 'left';
    let y = top + 14;
    lines.slice(0, maxLines).forEach((line) => {
      g.fillStyle = line.trimStart().startsWith('"') ? CS.text : CS.dim;
      g.fillText(this.truncate(g, line, w - 60), 30, y);
      y += 16;
    });
    if (lines.length > maxLines) {
      g.fillStyle = CS.faint;
      g.font = font(this.zh, 10);
      g.fillText(
        this.zh ? `共 ${lines.length} 行，已截断 — 可复制或下载完整 JSON` : `${lines.length} lines total, truncated — copy or download the full JSON`,
        30,
        h - 22,
      );
    }
    if (!lines.length) {
      g.fillStyle = CS.faint;
      g.font = font(this.zh, 11);
      g.fillText(t('noSchema', this.zh), 30, top + 20);
    }
  }

  private drawValidate(g: CanvasRenderingContext2D, w: number, _h: number, top: number): void {
    const zh = this.zh;
    const sevColor = (s: 'error' | 'warning' | 'info'): string =>
      s === 'error' ? CS.error : s === 'warning' ? CS.warn : CS.dim;
    let y = top;

    g.fillStyle = CS.dim;
    g.font = font(zh, 11.5, '600');
    g.textAlign = 'left';
    const vr = this.validationResult;
    const head = vr
      ? `${t('violationsTitle', zh)} — ${vr.errorCount} / ${vr.warningCount} · ${pct(vr.violatingRowRatio)}`
      : t('noSecond', zh);
    g.fillText(head, 24, y + 12);
    y += 20;

    if (vr) {
      const rows = vr.violations.slice(0, 14).map((v) => [
        v.row >= 0 ? String(v.row + 1) : '-',
        v.column,
        v.severity === 'error' ? (zh ? '错误' : 'error') : zh ? '警告' : 'warning',
        CODE_TEXT[v.code][zh ? 'zh' : 'en'],
        v.actual === null || v.actual === undefined ? '-' : String(v.actual),
      ]);
      const colors = vr.violations.slice(0, 14).map((v) => sevColor(v.severity));
      y = this.drawTable(g, 24, y, w - 48, [t('colRow', zh), t('colColumn', zh), t('colSeverity', zh), t('colCode', zh), t('colValue', zh)], rows, colors, 19);
      if (vr.violations.length > 14) {
        g.fillStyle = CS.faint;
        g.font = font(zh, 10);
        g.fillText(
          zh ? `共 ${vr.violations.length} 条违例，仅显示前 14 条` : `${vr.violations.length} violations total, showing first 14`,
          24,
          y + 12,
        );
        y += 16;
      }
    }

    y += 14;
    g.fillStyle = CS.dim;
    g.font = font(zh, 11.5, '600');
    const drift = this.drift ?? [];
    g.fillText(
      this.secondRows ? `${t('driftTitle', zh)} — ${drift.length}` : t('noSecond', zh),
      24,
      y + 12,
    );
    y += 20;

    if (this.secondRows) {
      if (drift.length === 0) {
        g.fillStyle = CS.ok;
        g.font = font(zh, 11);
        g.fillText(t('noDrift', zh), 24, y + 12);
        return;
      }
      const rows = drift.slice(0, 14).map((d) => [
        DRIFT_TEXT[d.kind][zh ? 'zh' : 'en'],
        d.column,
        d.severity === 'error' ? (zh ? '破坏性' : 'error') : d.severity === 'warning' ? (zh ? '警告' : 'warning') : zh ? '信息' : 'info',
        d.detail,
      ]);
      const colors = drift.slice(0, 14).map((d) => sevColor(d.severity));
      this.drawTable(g, 24, y, w - 48, [t('colKind', zh), t('colColumn', zh), t('colSeverity', zh), t('colDetail', zh)], rows, colors, 19);
    }
  }
}

export default function createSchemaPlugin(): Plugin {
  const plugin = new SchemaPlugin();
  return plugin;
}
