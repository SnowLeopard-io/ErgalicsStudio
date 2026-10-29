// ==========================================================================
// Vector Store plugin — main controller.
//
// Wires the pure vector-index kernel (hashing-trick text embeddings,
// L2-normalized numeric vectors, brute-force search, simplified HNSW
// approximate index, cosine / Euclidean / inner-product metrics, Recall@K
// evaluation and seeded PCA / exact t-SNE projection) to the Ergalics Studio
// plugin contract: parameter panel, canvas rendering (2-D projection scatter
// with query highlight and ringed top-k neighbours, neighbour table, index
// build stats), science outputs, CSV export, a seeded 5000x32 benchmark and
// block/flow-mode compute.
//
// The plugin boots with the embedded deterministic text sample already
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
import { emit } from '@/core/events';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs } from '@/core/research/scienceOutput';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import {
  CS,
  drawFootnote,
  drawHeader,
  drawLegend,
  font,
  plotBox,
  prepareCanvas,
  type PlotBox,
} from '../../shared/cs-utils';
import { vectordbManifest } from './manifest';
import { VECTORDB_SAMPLE_JSON, VECTORDB_SAMPLE_NUMERIC_CSV } from './samples';
import {
  INDEX_LABELS,
  METRIC_LABELS,
  embedRows,
  embedText,
  parseDocumentsJson,
  parseNumericCsv,
  runVectordb,
  runVectordbBenchmark,
} from './kernel';
import type { IndexKind, Metric, ProjectionKind, VectordbParams, VectordbRunResult } from './kernel';

type DataSource = 'sample-text' | 'sample-numeric' | 'file';

interface VectordbState {
  source: DataSource;
  indexKind: IndexKind;
  metric: Metric;
  m: number;
  efConstruction: number;
  efSearch: number;
  topK: number;
  projection: ProjectionKind;
  queryText: string;
  queryRow: number;
  seed: number;
}

interface InjectedInput {
  vectors: number[][];
  query: number[] | null;
  queryLabel: string;
}

export class VectorDbPlugin implements Plugin {
  readonly manifest = vectordbManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private state: VectordbState = {
    source: 'sample-text',
    indexKind: 'hnsw',
    metric: 'cosine',
    m: 8,
    efConstruction: 100,
    efSearch: 64,
    topK: 10,
    projection: 'tsne',
    queryText: 'telescope galaxy orbit',
    queryRow: 0,
    seed: 20261029,
  };

  /** Raw content of the active source (embedded sample or loaded file). */
  private text: string;
  private mode: 'text' | 'numeric' = 'text';
  private fileText: string | null = null;
  private fileMode: 'text' | 'numeric' = 'text';
  /** Direct { vectors, query } compute input; overrides `text` when set. */
  private injected: InjectedInput | null = null;
  private result: VectordbRunResult | null = null;
  private errorMessage: string | null = null;
  private dirty = true;
  private running = false;

  constructor() {
    // The embedded text sample is loaded from the start so the first Run works.
    this.text = VECTORDB_SAMPLE_JSON;
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

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      this.select('source', 'Data Source', '数据源', s.source, [
        { value: 'sample-text', en: 'Sample: text documents', zh: '示例：文本文档' },
        { value: 'sample-numeric', en: 'Sample: numeric vectors', zh: '示例：数值向量' },
        { value: 'file', en: 'Loaded file', zh: '已加载文件' },
      ]),
      this.select('indexKind', 'Index', '索引类型', s.indexKind, [
        { value: 'hnsw', en: 'HNSW (approximate)', zh: 'HNSW（近似）' },
        { value: 'brute-force', en: 'Brute force (exact)', zh: '暴力（精确）' },
      ]),
      this.select('metric', 'Distance Metric', '距离度量', s.metric, [
        { value: 'cosine', en: 'Cosine', zh: '余弦' },
        { value: 'euclidean', en: 'Euclidean', zh: '欧氏' },
        { value: 'dot', en: 'Inner product', zh: '内积' },
      ]),
      this.numberParam('m', 'HNSW M (links/node)', 'HNSW 连接数 M', s.m, 2, 32, 1),
      this.numberParam('efConstruction', 'HNSW efConstruction', 'HNSW 建图束宽 efConstruction', s.efConstruction, 8, 400, 10),
      this.numberParam('efSearch', 'HNSW efSearch', 'HNSW 查询束宽 efSearch', s.efSearch, 1, 400, 10),
      this.numberParam('topK', 'Top-K', '返回近邻数 K', s.topK, 1, 20, 1),
      this.select('projection', '2-D Projection', '二维投影', s.projection, [
        { value: 'pca', en: 'PCA', zh: 'PCA 主成分' },
        { value: 'tsne', en: 't-SNE (exact, n<=400)', zh: 't-SNE（精确，n≤400）' },
      ]),
      {
        key: 'queryText',
        label: 'Query Text (text source)',
        labelI18n: { 'zh-CN': '查询文本（文本数据源）', 'en-US': 'Query Text (text source)' },
        type: 'text',
        value: s.queryText,
        placeholder: 'e.g. telescope galaxy orbit',
      },
      this.numberParam('queryRow', 'Query Row Index (numeric source)', '查询行号（数值数据源）', s.queryRow, 0, 100000, 1),
      this.numberParam('seed', 'Seed', '随机种子', s.seed, 1, 999999999, 1),
      actionButton('build', 'Build Index', '构建索引', 'primary'),
      actionButton('search', 'Search', '检索'),
      actionButton('loadSample', 'Load Sample', '加载示例'),
      actionButton('benchmark', 'Benchmark', '基准测试'),
      actionButton('exportCsv', 'Export Results CSV', '导出结果 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>): void {
    let changed = false;
    const s = this.state;

    if (
      (params.source === 'sample-text' || params.source === 'sample-numeric' || params.source === 'file') &&
      params.source !== s.source
    ) {
      this.applySource(params.source);
      return;
    }
    if ((params.indexKind === 'hnsw' || params.indexKind === 'brute-force') && params.indexKind !== s.indexKind) {
      s.indexKind = params.indexKind;
      changed = true;
    }
    if ((params.metric === 'cosine' || params.metric === 'euclidean' || params.metric === 'dot') && params.metric !== s.metric) {
      s.metric = params.metric;
      changed = true;
    }
    if (params.projection === 'pca' || params.projection === 'tsne') {
      const v = params.projection as ProjectionKind;
      if (v !== s.projection) {
        s.projection = v;
        changed = true;
      }
    }
    const clampInt = (raw: unknown, lo: number, hi: number): number | null =>
      typeof raw === 'number' && Number.isFinite(raw) ? Math.min(hi, Math.max(lo, Math.round(raw))) : null;
    const applyInt = (raw: unknown, lo: number, hi: number, set: (v: number) => void): boolean => {
      const v = clampInt(raw, lo, hi);
      if (v !== null) {
        set(v);
        return true;
      }
      return false;
    };
    changed = applyInt(params.m, 2, 32, (v) => (s.m = v)) || changed;
    changed = applyInt(params.efConstruction, 8, 400, (v) => (s.efConstruction = v)) || changed;
    changed = applyInt(params.efSearch, 1, 400, (v) => (s.efSearch = v)) || changed;
    changed = applyInt(params.topK, 1, 20, (v) => (s.topK = v)) || changed;
    changed = applyInt(params.queryRow, 0, 100000, (v) => (s.queryRow = v)) || changed;
    changed = applyInt(params.seed, 1, 999999999, (v) => (s.seed = v)) || changed;
    if (typeof params.queryText === 'string' && params.queryText !== s.queryText) {
      s.queryText = params.queryText;
      changed = true;
    }

    if (actionFired(params, 'build')) {
      void this.runPipeline(true, 'build');
      return;
    }
    if (actionFired(params, 'search')) {
      void this.runPipeline(true, 'search');
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
      this.exportSearchCsv();
      return;
    }

    if (changed) this.dirty = true;
    if (this.dirty) void this.runPipeline(false, 'auto');
  }

  // ---- data loading --------------------------------------------------------

  /** Swap the active raw content when the data-source select changes. */
  private applySource(source: DataSource): void {
    this.state.source = source;
    this.injected = null;
    if (source === 'sample-text') {
      this.text = VECTORDB_SAMPLE_JSON;
      this.mode = 'text';
    } else if (source === 'sample-numeric') {
      this.text = VECTORDB_SAMPLE_NUMERIC_CSV;
      this.mode = 'numeric';
    } else if (this.fileText) {
      this.text = this.fileText;
      this.mode = this.fileMode;
    } else {
      // No file loaded yet: fall back to the text sample.
      this.text = VECTORDB_SAMPLE_JSON;
      this.mode = 'text';
    }
    this.dirty = true;
    // Keep the source select in sync with the fallback above.
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  private loadSample(): void {
    this.injected = null;
    if (this.state.source === 'file' && this.fileText) {
      this.text = this.fileText;
      this.mode = this.fileMode;
      notify(this.api, 'info', 'Loaded file re-parsed.', '已重新解析已加载的文件。');
    } else if (this.state.source === 'sample-numeric') {
      this.text = VECTORDB_SAMPLE_NUMERIC_CSV;
      this.mode = 'numeric';
      notify(this.api, 'info', 'Embedded numeric sample loaded (120 rows x 8 features, 3 clusters).', '已载入内置数值示例（120 行 × 8 特征，3 个簇）。');
    } else {
      if (this.state.source !== 'sample-text') {
        this.state.source = 'sample-text';
        emit('host:params:changed', { pluginId: this.manifest.id });
      }
      this.text = VECTORDB_SAMPLE_JSON;
      this.mode = 'text';
      notify(this.api, 'info', 'Embedded text sample loaded (60 documents, 4 themes).', '已载入内置文本示例（60 篇文档，4 个主题）。');
    }
    this.dirty = true;
    void this.runPipeline(false, 'auto');
  }

  async loadData(file: File): Promise<void> {
    const raw = await file.text();
    const trimmed = raw.trim();
    if (!trimmed) {
      notify(this.api, 'warning', 'The selected file is empty.', '所选文件为空。');
      return;
    }
    try {
      const isJson =
        file.name.toLowerCase().endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[');
      let count = 0;
      if (isJson) {
        count = parseDocumentsJson(trimmed).length;
        this.mode = 'text';
      } else {
        count = parseNumericCsv(trimmed).length;
        this.mode = 'numeric';
      }
      this.fileText = trimmed;
      this.fileMode = this.mode;
      this.text = trimmed;
      this.injected = null;
      if (this.state.source !== 'file') {
        this.state.source = 'file';
        emit('host:params:changed', { pluginId: this.manifest.id });
      }
      this.dirty = true;
      this.api.reportDataScale(count);
      void this.runPipeline(false, 'auto');
      notify(
        this.api,
        'success',
        `Loaded ${file.name} (${count} ${this.mode === 'text' ? 'documents' : 'rows'}).`,
        `已载入 ${file.name}（${count} ${this.mode === 'text' ? '篇文档' : '行向量'}）。`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(
        this.api,
        'error',
        `Could not read "${file.name}" as vector data: ${message}`,
        `无法将「${file.name}」读取为向量数据：${message}`,
      );
    }
  }

  /** Adopt a raw string payload arriving through compute() (JSON or CSV). */
  private adoptText(text: string): void {
    const trimmed = text.trim();
    this.mode = trimmed.startsWith('{') || trimmed.startsWith('[') ? 'text' : 'numeric';
    this.text = trimmed;
    this.fileText = trimmed;
    this.fileMode = this.mode;
    this.injected = null;
    if (this.state.source !== 'file') {
      this.state.source = 'file';
      emit('host:params:changed', { pluginId: this.manifest.id });
    }
  }

  // ---- pipeline ---------------------------------------------------------------

  private kernelParams(): VectordbParams {
    const s = this.state;
    return {
      metric: s.metric,
      indexKind: s.indexKind,
      m: s.m,
      efConstruction: s.efConstruction,
      efSearch: s.efSearch,
      topK: s.topK,
      projection: s.projection,
      seed: s.seed,
    };
  }

  /** Parse the active source into vectors + snippets + a query vector. */
  private prepareData(): {
    vectors: number[][];
    snippets: string[];
    query: number[];
    queryLabel: string;
    queryId: number | null;
  } {
    if (this.injected) {
      const vectors = this.injected.vectors;
      const q = this.injected.query ?? vectors[0]!;
      return {
        vectors,
        snippets: vectors.map((_, i) => `v${i}`),
        query: q,
        queryLabel: this.injected.query ? this.injected.queryLabel : 'v0',
        queryId: this.injected.query ? null : 0,
      };
    }
    if (this.mode === 'text') {
      const docs = parseDocumentsJson(this.text);
      const vectors = docs.map((d) => embedText(d.text));
      const qText = this.state.queryText.trim();
      if (qText) {
        return {
          vectors,
          snippets: docs.map((d) => d.text),
          query: embedText(qText),
          queryLabel: `"${qText.slice(0, 40)}"`,
          queryId: null,
        };
      }
      // Empty query text: use the first document as the self-query.
      return {
        vectors,
        snippets: docs.map((d) => d.text),
        query: vectors[0]!,
        queryLabel: 'doc #0',
        queryId: 0,
      };
    }
    const rows = parseNumericCsv(this.text);
    const vectors = embedRows(rows);
    const qi = Math.min(rows.length - 1, Math.max(0, Math.round(this.state.queryRow)));
    return {
      vectors,
      snippets: rows.map((_, i) => `row ${i}`),
      query: vectors[qi]!,
      queryLabel: `row #${qi}`,
      queryId: qi,
    };
  }

  /** Build + search + project + publish. Returns false on failure. */
  private async runPipeline(explicit: boolean, intent: 'build' | 'search' | 'auto'): Promise<boolean> {
    if (this.running) {
      if (explicit) notify(this.api, 'warning', 'A run is already in progress.', '已有一次运行正在进行。');
      return false;
    }
    if (!this.text.trim() && !this.injected) {
      this.result = null;
      clearScienceOutputs(this.manifest.id);
      this.draw();
      return false;
    }
    this.running = true;
    let ok = false;
    try {
      const prep = this.prepareData();
      const res = runVectordb(prep, this.kernelParams());
      this.result = res;
      this.errorMessage = null;
      this.dirty = false;
      this.publish(res);
      this.api.reportDataScale(res.vectorCount);
      ok = true;
      if (explicit) {
        if (intent === 'build') {
          notify(
            this.api,
            'success',
            `Index built — ${res.vectorCount} vectors x ${res.dims} dims in ${res.buildMs.toFixed(1)} ms.`,
            `索引构建完成 — ${res.vectorCount} 个向量 × ${res.dims} 维，耗时 ${res.buildMs.toFixed(1)} ms。`,
          );
        } else {
          notify(
            this.api,
            'success',
            `Search complete — top-${res.top.length} in ${fmtMetric(res.searchMs, 3)} ms.`,
            `检索完成 — 前 ${res.top.length} 个近邻，耗时 ${fmtMetric(res.searchMs, 3)} ms。`,
          );
        }
      }
    } catch (err) {
      this.result = null;
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.dirty = false;
      clearScienceOutputs(this.manifest.id);
      if (explicit) {
        notify(this.api, 'error', `Run failed: ${this.errorMessage}`, `运行失败：${this.errorMessage}`);
      }
    } finally {
      this.running = false;
      this.draw();
    }
    return ok;
  }

  // ---- science outputs ---------------------------------------------------------

  private publish(res: VectordbRunResult): void {
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'build-ms',
        label: zh ? '索引构建耗时' : 'Index build time',
        value: `${fmtMetric(res.buildMs, 4)} ms`,
        unit: 'ms',
        severity: 'info',
        hint: zh ? INDEX_LABELS[res.indexKind][1] : INDEX_LABELS[res.indexKind][0],
      },
      {
        key: 'vectors',
        label: zh ? '向量数 × 维度' : 'Vectors x dims',
        value: `${res.vectorCount} × ${res.dims}`,
        severity: 'info',
        hint: zh ? '文本经 64 维哈希嵌入，数值行 L2 归一化' : 'text hashed to 64 dims, numeric rows L2-normalized',
      },
      {
        key: 'index-shape',
        label: zh ? '索引结构' : 'Index shape',
        value: res.indexKind === 'hnsw' ? `L${res.layers} · deg ${fmtMetric(res.avgDegree, 2)}` : 'flat',
        severity: 'info',
        hint: zh ? 'HNSW 层数与第 0 层平均出度' : 'HNSW layers and mean layer-0 out-degree',
      },
    ];
    if (res.recall !== null) {
      metrics.push({
        key: 'recall',
        label: `Recall@${res.topK}`,
        value: fmtMetric(res.recall, 4),
        severity: res.recall >= 0.9 ? 'ok' : res.recall >= 0.7 ? 'warn' : 'error',
        hint:
          zh
            ? `HNSW 相对暴力检索的平均重叠率（${res.recallQueries} 个种子自查询）`
            : `mean HNSW vs brute-force overlap over ${res.recallQueries} seeded self-queries`,
      });
    }
    metrics.push(
      {
        key: 'search-ms',
        label: zh ? '检索延迟' : 'Search latency',
        value: `${fmtMetric(res.searchMs, 4)} ms`,
        unit: 'ms',
        severity: 'info',
        hint: zh ? `Top-${res.topK} 单次查询` : `single top-${res.topK} query`,
      },
      {
        key: 'projection',
        label: zh ? '投影方法' : 'Projection',
        value:
          res.projectionMethod === 'pca'
            ? res.projectionFallback
              ? 'PCA (t-SNE fallback)'
              : 'PCA'
            : 't-SNE',
        severity: 'info',
        hint: zh ? '固定种子，确定性结果' : 'seeded and deterministic',
      },
    );
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- benchmark ------------------------------------------------------------------

  /** Seeded benchmark: 5000 x 32 HNSW build + latency + Recall@10 on a 500 subset. */
  private async runBenchmark(): Promise<void> {
    if (this.running) {
      notify(this.api, 'warning', 'A run is already in progress.', '已有一次运行正在进行。');
      return;
    }
    this.running = true;
    try {
      const b = runVectordbBenchmark(this.state.seed);
      this.api.reportDataScale(b.corpus);
      const zh = this.zh;
      setScienceOutputs(this.manifest.id, [
        {
          key: 'bench-corpus',
          label: zh ? '基准语料' : 'Benchmark corpus',
          value: `${b.corpus} × ${b.dims}`,
          severity: 'info',
          hint: zh ? `${b.clusters} 个簇，种子 ${this.state.seed}` : `${b.clusters} clusters, seed ${this.state.seed}`,
        },
        {
          key: 'bench-build',
          label: zh ? 'HNSW 构建耗时' : 'HNSW build time',
          value: `${fmtMetric(b.buildMs, 4)} ms`,
          unit: 'ms',
          severity: 'info',
          hint: zh ? `M=${b.m}，efC=${b.efConstruction}，${b.layers} 层，平均出度 ${fmtMetric(b.avgDegree, 2)}` : `M=${b.m}, efC=${b.efConstruction}, ${b.layers} layers, mean degree ${fmtMetric(b.avgDegree, 2)}`,
        },
        {
          key: 'bench-latency',
          label: zh ? '平均检索延迟' : 'Mean search latency',
          value: `${fmtMetric(b.avgSearchMs, 4)} ms`,
          unit: 'ms',
          severity: 'info',
          hint: zh ? `${b.queries} 次查询（efSearch=${b.efSearch}），最大 ${fmtMetric(b.maxSearchMs, 3)} ms` : `${b.queries} queries (efSearch=${b.efSearch}), max ${fmtMetric(b.maxSearchMs, 3)} ms`,
        },
        {
          key: 'bench-recall',
          label: 'Recall@10',
          value: fmtMetric(b.subsetRecallAt10, 4),
          severity: b.subsetRecallAt10 >= 0.9 ? 'ok' : b.subsetRecallAt10 >= 0.7 ? 'warn' : 'error',
          hint: zh ? `${b.subset} 向量子集上相对暴力检索，${b.subsetQueries} 次查询` : `vs brute force on a ${b.subset}-vector subset, ${b.subsetQueries} queries`,
        },
        {
          key: 'bench-total',
          label: zh ? '基准总耗时' : 'Benchmark total time',
          value: `${fmtMetric(b.totalMs, 4)} ms`,
          unit: 'ms',
          severity: b.withinBudget ? 'ok' : 'warn',
          hint: zh ? `预算 < ${b.budgetMs / 1000} s` : `budget < ${b.budgetMs / 1000} s`,
        },
      ]);
      notify(
        this.api,
        b.withinBudget ? 'success' : 'warning',
        `Benchmark: ${b.corpus}x${b.dims} HNSW built in ${b.buildMs.toFixed(0)} ms, ${fmtMetric(b.avgSearchMs, 3)} ms/query, Recall@10 ${b.subsetRecallAt10.toFixed(2)} (${b.totalMs.toFixed(0)} ms total).`,
        `基准测试：${b.corpus}×${b.dims} HNSW 构建 ${b.buildMs.toFixed(0)} ms，平均 ${fmtMetric(b.avgSearchMs, 3)} ms/次，Recall@10 ${b.subsetRecallAt10.toFixed(2)}（总耗时 ${b.totalMs.toFixed(0)} ms）。`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Benchmark failed: ${message}`, `基准测试失败：${message}`);
    } finally {
      this.running = false;
    }
  }

  // ---- exports ----------------------------------------------------------------

  private exportSearchCsv(): void {
    if (!this.result) {
      notify(this.api, 'warning', 'Run a search before exporting.', '请先运行检索再导出。');
      return;
    }
    const res = this.result;
    const rows = res.top.map((n, i) => [i + 1, n.id, Number(n.distance.toFixed(6)), res.snippets[n.id] ?? '']);
    exportRowsCsv(
      this.api,
      'vectordb-search',
      ['rank', 'id', 'distance', 'snippet'],
      rows,
    );
  }

  // ---- block / flow mode ---------------------------------------------------------

  async compute(
    input: unknown,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<ComputeResult> {
    if (typeof input === 'string' && input.trim()) {
      this.adoptText(input);
    } else if (input && typeof input === 'object') {
      const obj = input as { vectors?: unknown; query?: unknown };
      if (Array.isArray(obj.vectors)) {
        const vectors = (obj.vectors as unknown[]).filter(
          (r): r is number[] => Array.isArray(r) && r.length > 0 && r.every((x) => typeof x === 'number'),
        );
        if (vectors.length >= 2) {
          let query: number[] | null = null;
          let queryLabel = 'v0';
          if (Array.isArray(obj.query) && obj.query.every((x) => typeof x === 'number')) {
            query = obj.query as number[];
            queryLabel = 'input query';
          } else if (typeof obj.query === 'string' && obj.query.trim()) {
            query = embedText(obj.query);
            queryLabel = `"${obj.query.slice(0, 40)}"`;
          }
          this.injected = { vectors, query, queryLabel };
        }
      }
    }
    onProgress?.({ done: 0, total: 2, label: this.state.indexKind });
    const ok = await this.runPipeline(false, 'search');
    onProgress?.({ done: 2, total: 2, label: this.state.indexKind });
    if (!ok || !this.result) {
      return { ok: false, error: this.errorMessage ?? 'vector search failed' };
    }
    const res = this.result;
    return {
      ok: true,
      output: {
        buildMs: res.buildMs,
        recall: res.recall,
        top: res.top.map((n) => ({
          id: n.id,
          distance: Number(n.distance.toFixed(6)),
          snippet: res.snippets[n.id] ?? null,
        })),
        vectorCount: res.vectorCount,
        dims: res.dims,
        searchMs: res.searchMs,
        index: res.indexKind,
        metric: res.metric,
        projection: res.projectionMethod,
      },
    };
  }

  // ---- rendering -----------------------------------------------------------------

  private subtitle(res: VectordbRunResult | null): string {
    const zh = this.zh;
    if (!res) return zh ? '等待运行' : 'awaiting run';
    const idx = zh ? INDEX_LABELS[res.indexKind][1] : INDEX_LABELS[res.indexKind][0];
    const met = zh ? METRIC_LABELS[res.metric][1] : METRIC_LABELS[res.metric][0];
    return `${res.vectorCount} vectors × ${res.dims} dims · ${idx} · ${met} · Top-${res.topK}`;
  }

  private footnote(res: VectordbRunResult): string {
    const zh = this.zh;
    const idxPart =
      res.indexKind === 'hnsw'
        ? zh
          ? `HNSW M=${this.state.m} · efC=${this.state.efConstruction} · efSearch=${this.state.efSearch} · ${res.layers} 层 · 平均出度 ${res.avgDegree.toFixed(1)}`
          : `HNSW M=${this.state.m} · efC=${this.state.efConstruction} · efSearch=${this.state.efSearch} · ${res.layers} layers · mean degree ${res.avgDegree.toFixed(1)}`
        : zh
          ? '暴力精确检索（全库扫描）'
          : 'exact brute-force scan';
    const recallPart =
      res.recall !== null
        ? zh
          ? ` · Recall@${res.topK} ${res.recall.toFixed(2)}（${res.recallQueries} 次自查询）`
          : ` · Recall@${res.topK} ${res.recall.toFixed(2)} (${res.recallQueries} self-queries)`
        : '';
    const projPart = res.projectionMethod === 'pca' ? (res.projectionFallback ? 'PCA (t-SNE fallback)' : 'PCA') : 't-SNE';
    return zh
      ? `${idxPart} · ${res.vectorCount} 向量 × ${res.dims} 维 · 构建 ${fmtMetric(res.buildMs, 3)} ms${recallPart} · 检索 ${fmtMetric(res.searchMs, 3)} ms · 投影 ${projPart}`
      : `${idxPart} · ${res.vectorCount} vectors x ${res.dims} dims · build ${fmtMetric(res.buildMs, 3)} ms${recallPart} · search ${fmtMetric(res.searchMs, 3)} ms · projection ${projPart}`;
  }

  private draw(): void {
    // First render (and after any state change): run once so the canvas is
    // never left empty while a valid dataset is loaded.
    if (this.dirty && !this.running && (this.text.trim() || this.injected)) {
      void this.runPipeline(false, 'auto');
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
      zh ? '向量数据库 · 最近邻检索' : 'Vector Store · Nearest-Neighbor Search',
      this.subtitle(res),
      zh,
    );

    if (!res) {
      if (!this.text.trim() && !this.injected) clearScienceOutputs(this.manifest.id);
      const message = this.errorMessage
        ? `${zh ? '运行失败：' : 'Run failed: '}${this.errorMessage}`
        : zh
          ? '点击「构建索引」或「检索」运行当前向量数据。'
          : 'Press "Build Index" or "Search" to run the current vectors.';
      g.fillStyle = CS.dim;
      g.font = font(zh, 12);
      g.textAlign = 'center';
      g.fillText(message, w / 2, h / 2 - 6);
      g.fillStyle = CS.faint;
      g.font = font(zh, 10.5);
      g.fillText(
        zh
          ? '数据格式：.json {"documents":[...]} 或全数值 .csv；内置示例已就绪。'
          : 'Data format: .json {"documents":[...]} or all-numeric .csv; the embedded sample is ready.',
        w / 2,
        h / 2 + 16,
      );
      drawFootnote(g, w, h, zh ? '左侧：二维投影散点；右侧：近邻表。' : 'Left: 2-D projection scatter; right: neighbour table.', zh);
      return;
    }

    const mainW = Math.round(w * 0.6);
    this.drawProjection(g, h, mainW, res, zh);
    this.drawNeighbors(g, w, h, mainW, res, zh);
    drawFootnote(g, w, h, this.footnote(res), zh);
  }

  /** Main panel: 2-D projection scatter with query highlight and ringed top-k. */
  private drawProjection(
    g: CanvasRenderingContext2D,
    h: number,
    mainW: number,
    res: VectordbRunResult,
    zh: boolean,
  ): void {
    const box: PlotBox = plotBox(mainW, h, 58, 62, 22, 48);
    const projLabel =
      res.projectionMethod === 'pca'
        ? res.projectionFallback
          ? zh
            ? '2D 投影（t-SNE 超限，PCA 回退）'
            : '2-D projection (t-SNE fallback to PCA)'
          : zh
            ? '2D 投影（PCA）'
            : '2-D projection (PCA)'
        : zh
          ? '2D 投影（t-SNE）'
          : '2-D projection (t-SNE)';
    g.fillStyle = CS.dim;
    g.font = font(zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(projLabel, box.x0, box.y0 - 10);

    // Bounds with padding.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of res.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (res.queryPoint) {
      minX = Math.min(minX, res.queryPoint.x);
      maxX = Math.max(maxX, res.queryPoint.x);
      minY = Math.min(minY, res.queryPoint.y);
      maxY = Math.max(maxY, res.queryPoint.y);
    }
    if (!Number.isFinite(minX) || maxX - minX < 1e-9) {
      minX -= 1;
      maxX += 1;
    }
    if (!Number.isFinite(minY) || maxY - minY < 1e-9) {
      minY -= 1;
      maxY += 1;
    }
    const padX = (maxX - minX) * 0.08;
    const padY = (maxY - minY) * 0.08;
    const px = (x: number) => box.x0 + ((x - minX + padX) / (maxX - minX + 2 * padX)) * box.w;
    const py = (y: number) => box.y1 - ((y - minY + padY) / (maxY - minY + 2 * padY)) * box.h;

    // Frame + faint grid.
    g.strokeStyle = CS.axis;
    g.lineWidth = 1;
    g.strokeRect(box.x0, box.y0, box.w, box.h);
    g.strokeStyle = CS.grid;
    for (let i = 1; i <= 4; i += 1) {
      const gx = box.x0 + (box.w * i) / 5;
      const gy = box.y0 + (box.h * i) / 5;
      g.beginPath();
      g.moveTo(gx, box.y0);
      g.lineTo(gx, box.y1);
      g.stroke();
      g.beginPath();
      g.moveTo(box.x0, gy);
      g.lineTo(box.x1, gy);
      g.stroke();
    }

    // Axis labels.
    const xLabel = res.projectionMethod === 'pca' ? 'PC 1' : 't-SNE 1';
    const yLabel = res.projectionMethod === 'pca' ? 'PC 2' : 't-SNE 2';
    g.fillStyle = CS.faint;
    g.font = font(false, 9);
    g.textAlign = 'center';
    g.fillText(xLabel, (box.x0 + box.x1) / 2, box.y1 + 18);
    g.save();
    g.translate(Math.max(14, box.x0 - 40), (box.y0 + box.y1) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(yLabel, 0, 0);
    g.restore();

    // Corpus points.
    g.fillStyle = 'rgba(127,168,201,0.78)';
    for (const p of res.points) {
      g.beginPath();
      g.arc(px(p.x), py(p.y), 3, 0, Math.PI * 2);
      g.fill();
    }

    // Ring the top-k neighbours.
    const topIds = new Set(res.top.map((t) => t.id));
    g.strokeStyle = CS.cyan;
    g.lineWidth = 1.5;
    for (const id of topIds) {
      const p = res.points[id];
      if (!p) continue;
      g.beginPath();
      g.arc(px(p.x), py(p.y), 7, 0, Math.PI * 2);
      g.stroke();
    }

    // Query highlight: ring a self-query point, or draw the projected query.
    g.strokeStyle = CS.amber;
    g.fillStyle = CS.amber;
    if (res.queryId !== null && res.queryId >= 0 && res.queryId < res.points.length) {
      const p = res.points[res.queryId]!;
      g.beginPath();
      g.arc(px(p.x), py(p.y), 4.5, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(px(p.x), py(p.y), 9, 0, Math.PI * 2);
      g.stroke();
    } else if (res.queryPoint) {
      const qx = px(res.queryPoint.x);
      const qy = py(res.queryPoint.y);
      g.save();
      g.translate(qx, qy);
      g.rotate(Math.PI / 4);
      g.fillRect(-4, -4, 8, 8);
      g.restore();
      g.strokeStyle = CS.axis;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(box.x0, qy);
      g.lineTo(box.x1, qy);
      g.moveTo(qx, box.y0);
      g.lineTo(qx, box.y1);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = CS.amber;
    }

    drawLegend(g, Math.max(box.x0 + 8, box.x1 - 210), box.y0 - 10, [
      { label: zh ? '向量' : 'vector', color: 'rgba(127,168,201,0.9)' },
      { label: zh ? 'Top-K 近邻' : 'top-k', color: CS.cyan },
      { label: zh ? '查询' : 'query', color: CS.amber },
    ], zh);
  }

  /** Side panel: neighbour table (rank, id, distance, snippet). */
  private drawNeighbors(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    mainW: number,
    res: VectordbRunResult,
    zh: boolean,
  ): void {
    const tx0 = mainW + 14;
    const tx1 = w - 22;
    g.fillStyle = CS.dim;
    g.font = font(zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(
      zh
        ? `Top-${res.topK} 近邻 · 查询 ${res.queryLabel}`
        : `Top-${res.topK} neighbours · query ${res.queryLabel}`,
      tx0,
      62,
    );

    const colId = tx0 + 8;
    const colDist = tx0 + 52;
    const colSnippet = tx0 + 122;
    const snippetW = tx1 - colSnippet - 4;
    g.font = font(false, 10, '600');
    g.fillStyle = CS.faint;
    g.fillText(zh ? 'ID' : 'ID', colId, 84);
    g.fillText(zh ? '距离' : 'distance', colDist, 84);
    g.fillText(zh ? '片段' : 'snippet', colSnippet, 84);
    g.strokeStyle = CS.axis;
    g.beginPath();
    g.moveTo(tx0, 90);
    g.lineTo(tx1, 90);
    g.stroke();

    if (res.top.length === 0) {
      g.fillStyle = CS.faint;
      g.font = font(zh, 10);
      g.fillText(zh ? '无结果。' : 'no results', tx0, 106);
      return;
    }

    const rowH = 17;
    const maxRows = Math.max(1, Math.floor((h - 140) / rowH));
    res.top.slice(0, maxRows).forEach((n, i) => {
      const y = 108 + i * rowH;
      if (i % 2 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.02)';
        g.fillRect(tx0, y - rowH + 5, tx1 - tx0, rowH);
      }
      g.font = font(false, 10);
      g.fillStyle = i === 0 ? CS.text : CS.dim;
      g.textAlign = 'left';
      g.fillText(String(n.id), colId, y);
      g.fillText(n.distance.toFixed(4), colDist, y);
      const snippet = res.snippets[n.id] ?? '';
      if (snippet) {
        let text = snippet;
        while (text.length > 1 && g.measureText(`${text}…`).width > snippetW) text = text.slice(0, -1);
        g.fillText(text === snippet ? text : `${text}…`, colSnippet, y);
      }
    });
    if (res.top.length > maxRows) {
      g.fillStyle = CS.faint;
      g.font = font(zh, 9.5);
      g.fillText(zh ? `…共 ${res.top.length} 条` : `…${res.top.length} in total`, tx0, 108 + maxRows * rowH + 4);
    }
  }
}

export default function createVectorDbPlugin(): Plugin {
  return new VectorDbPlugin();
}
