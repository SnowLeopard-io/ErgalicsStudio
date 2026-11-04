// ==========================================================================
// NLP Workbench plugin — main controller.
//
// Wires the pure NLP kernel (tokenization, TF-IDF, LDA, sentiment,
// similarity/clustering, heuristic NER) to the Ergalics Studio plugin
// contract: parameter panel, mode-driven canvas rendering, science outputs,
// CSV export, a seeded throughput benchmark and block-mode compute.
//
// The plugin boots with the embedded deterministic sample corpus already
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
import { nlpManifest } from './manifest';
import { NLP_SAMPLE_TEXT } from './samples';
import {
  checkLdaTopics,
  checkTfidfSanity,
  csvTextToCorpus,
  generateSyntheticCorpus,
  parseCorpus,
  runNlpPipeline,
} from './kernel';
import type { NlpMode, NlpOptions, NlpPipelineResult } from './kernel';

/** Academic low-saturation palette (bars, topic shares, cluster colours). */
const PALETTE = [
  '#7fa8c9', '#6fb3ad', '#a3aebc', '#8f9fc0', '#6da8b8', '#9db4d0', '#7fb8a8', '#b3a3c9',
] as const;

/** Document count of the seeded perf-benchmark corpus (theme word pools). */
const BENCHMARK_DOCS = 300;
/** Benchmark budget: the full pipeline on 300 docs must stay under 2 s. */
const BENCHMARK_BUDGET_MS = 2000;

const MODES: readonly string[] = ['overview', 'topics', 'sentiment', 'similarity', 'entities'];

interface NlpState {
  mode: NlpMode;
  topics: number;
  iterations: number;
  topTerms: number;
  seed: number;
  minTf: number;
}

export class NlpPlugin implements Plugin {
  readonly manifest = nlpManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private text: string;
  private state: NlpState = {
    mode: 'overview',
    topics: 4,
    iterations: 200,
    topTerms: 8,
    seed: 20261029,
    minTf: 1,
  };
  private result: NlpPipelineResult | null = null;
  private dirty = true;
  private running = false;

  constructor() {
    // The embedded sample is loaded from the start so the first Run works.
    this.text = NLP_SAMPLE_TEXT;
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

  /** Small bilingual labelled select, mirroring the sibling data plugins. */
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
    return [
      this.select('mode', 'Mode', '分析模式', this.state.mode, [
        { value: 'overview', en: 'Overview', zh: '总览' },
        { value: 'topics', en: 'Topics (LDA)', zh: '主题（LDA）' },
        { value: 'sentiment', en: 'Sentiment', zh: '情感分析' },
        { value: 'similarity', en: 'Similarity & Clustering', zh: '相似度与聚类' },
        { value: 'entities', en: 'Entities', zh: '实体识别' },
      ]),
      this.numberParam('topics', 'Number of Topics', '主题数', this.state.topics, 2, 8, 1),
      this.numberParam('iterations', 'LDA Iterations', 'LDA 迭代次数', this.state.iterations, 20, 1000, 20),
      this.numberParam('topTerms', 'Top Terms per Topic', '每主题词项数', this.state.topTerms, 3, 15, 1),
      this.numberParam('seed', 'Seed', '随机种子', this.state.seed, 1, 999999999, 1),
      this.numberParam('minTf', 'Min Term Frequency', '最小词频', this.state.minTf, 1, 20, 1),
      actionButton('run', 'Run', '运行', 'primary'),
      actionButton('loadSample', 'Load Sample', '加载示例'),
      actionButton('benchmark', 'Benchmark', '基准测试'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>): void {
    let changed = false;
    const mode = params.mode;
    if (typeof mode === 'string' && MODES.includes(mode) && mode !== this.state.mode) {
      this.state.mode = mode as NlpMode;
      changed = true;
    }
    if (typeof params.topics === 'number' && Number.isFinite(params.topics)) {
      const topics = Math.min(8, Math.max(2, Math.round(params.topics)));
      if (topics !== this.state.topics) {
        this.state.topics = topics;
        changed = true;
      }
    }
    if (typeof params.iterations === 'number' && Number.isFinite(params.iterations)) {
      const iterations = Math.min(1000, Math.max(20, Math.round(params.iterations)));
      if (iterations !== this.state.iterations) {
        this.state.iterations = iterations;
        changed = true;
      }
    }
    if (typeof params.topTerms === 'number' && Number.isFinite(params.topTerms)) {
      const topTerms = Math.min(15, Math.max(3, Math.round(params.topTerms)));
      if (topTerms !== this.state.topTerms) {
        this.state.topTerms = topTerms;
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
    if (typeof params.minTf === 'number' && Number.isFinite(params.minTf)) {
      const minTf = Math.min(20, Math.max(1, Math.round(params.minTf)));
      if (minTf !== this.state.minTf) {
        this.state.minTf = minTf;
        changed = true;
      }
    }

    if (actionFired(params, 'run')) {
      void this.runAnalysis(true);
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
      this.exportCsv();
      return;
    }

    if (changed) this.dirty = true;
    if (this.dirty) {
      // Re-run without a toast so the canvas stays in sync with the panel.
      void this.runAnalysis(false);
    }
  }

  // ---- data loading --------------------------------------------------------

  async loadData(file: File): Promise<void> {
    const text = await file.text();
    if (!text.trim()) {
      notify(this.api, 'warning', 'The selected file is empty.', '所选文件为空。');
      return;
    }
    // .csv files are normalized into the canonical `label\tdoc` corpus text;
    // everything else is treated as one document per line.
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    const corpus = isCsv ? csvTextToCorpus(text) : text;
    const docs = parseCorpus(corpus);
    if (docs.length === 0) {
      notify(
        this.api,
        'error',
        `Could not read "${file.name}" as a text corpus (one document per line).`,
        `无法将「${file.name}」读取为文本语料（每行一篇文档）。`,
      );
      return;
    }
    this.text = corpus;
    this.dirty = true;
    this.api.reportDataScale(docs.length);
    void this.runAnalysis(false);
    notify(
      this.api,
      'success',
      `Loaded ${file.name} (${docs.length} documents).`,
      `已载入 ${file.name}（${docs.length} 篇文档）。`,
    );
  }

  private loadSample(): void {
    this.text = NLP_SAMPLE_TEXT;
    this.dirty = true;
    notify(this.api, 'info', 'Embedded sample corpus loaded.', '已载入内置示例语料。');
    void this.runAnalysis(false);
  }

  // ---- pipeline execution ----------------------------------------------------

  private options(): NlpOptions {
    return {
      mode: this.state.mode,
      topics: this.state.topics,
      iterations: this.state.iterations,
      topTerms: this.state.topTerms,
      seed: this.state.seed,
      minTf: this.state.minTf,
    };
  }

  private async runAnalysis(explicit: boolean): Promise<void> {
    if (this.running) {
      if (explicit) {
        notify(this.api, 'warning', 'An analysis is already running.', '分析正在进行中。');
      }
      return;
    }
    if (!this.text.trim()) {
      this.result = null;
      clearScienceOutputs(this.manifest.id);
      this.draw();
      return;
    }
    this.running = true;
    try {
      const docs = parseCorpus(this.text);
      const started = performance.now();
      const res = runNlpPipeline(docs, this.options());
      const runtimeMs = performance.now() - started;
      if (!res) {
        this.result = null;
        clearScienceOutputs(this.manifest.id);
        this.draw();
        if (explicit) {
          notify(
            this.api,
            'warning',
            'The corpus produced no analysable tokens (check the min term frequency).',
            '语料未产生可分析的词项（请检查最小词频）。',
          );
        }
        return;
      }
      this.result = res;
      this.dirty = false;
      this.publish(res, runtimeMs);
      this.api.reportDataScale(docs.length);
      this.draw();
      if (explicit) {
        notify(
          this.api,
          'success',
          `Analysis finished — ${res.index.docs.length} docs, ${res.index.vocab.length} terms (${runtimeMs.toFixed(0)} ms).`,
          `分析完成 — ${res.index.docs.length} 篇文档，${res.index.vocab.length} 个词项（${runtimeMs.toFixed(0)} ms）。`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.result = null;
      clearScienceOutputs(this.manifest.id);
      this.draw();
      notify(this.api, 'error', `Analysis failed: ${message}`, `分析失败：${message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Re-run the full pipeline (TF-IDF + LDA + sentiment + similarity + NER)
   * on a larger seeded synthetic corpus (~300 documents) and publish
   * throughput plus the two kernel sanity benchmarks as science outputs.
   */
  private async runBenchmark(): Promise<void> {
    if (this.running) {
      notify(this.api, 'warning', 'An analysis is already running.', '分析正在进行中。');
      return;
    }
    this.running = true;
    try {
      const seed = this.state.seed + 7;
      const docs = generateSyntheticCorpus(BENCHMARK_DOCS, seed);
      const started = performance.now();
      const res = runNlpPipeline(docs, { ...this.options(), fullPipeline: true });
      const totalMs = performance.now() - started;
      if (!res) {
        notify(this.api, 'error', 'Benchmark corpus failed to build an index.', '基准语料未能建立索引。');
        return;
      }
      const docsPerSec = docs.length / Math.max(1e-9, totalMs / 1000);
      const sanity = checkTfidfSanity(res.index);
      const topicsOk = checkLdaTopics(res.lda);
      this.api.reportDataScale(docs.length);
      const zh = this.zh;
      setScienceOutputs(this.manifest.id, [
        {
          key: 'bench-docs',
          label: zh ? '基准文档数' : 'Benchmark documents',
          value: String(docs.length),
          severity: 'info',
        },
        {
          key: 'bench-total',
          label: zh ? '基准总耗时' : 'Benchmark total time',
          value: `${fmtMetric(totalMs, 4)} ms`,
          unit: 'ms',
          severity: totalMs < BENCHMARK_BUDGET_MS ? 'ok' : 'warn',
          hint: zh ? `全流水线目标 < ${BENCHMARK_BUDGET_MS / 1000} s` : `full-pipeline target < ${BENCHMARK_BUDGET_MS / 1000} s`,
        },
        {
          key: 'bench-rate',
          label: zh ? '基准吞吐' : 'Benchmark throughput',
          value: `${fmtMetric(docsPerSec, 4)} docs/s`,
          severity: 'info',
          hint: zh
            ? '全流水线：TF-IDF + LDA + 情感 + 相似度 + 实体'
            : 'full pipeline: TF-IDF + LDA + sentiment + similarity + entities',
        },
        {
          key: 'bench-tfidf',
          label: 'tfidf-sanity',
          value: sanity ? 'pass' : 'fail',
          severity: sanity ? 'ok' : 'error',
          hint: zh ? 'TF-IDF 行 L2 范数=1 且 IDF>0' : 'TF-IDF rows are L2-normalized with positive idf',
        },
        {
          key: 'bench-lda',
          label: 'lda-topics',
          value: topicsOk ? 'pass' : 'fail',
          severity: topicsOk ? 'ok' : 'error',
          hint: zh ? '文档-主题混合行和为 1 且主题主词不重复' : 'doc-topic mixtures sum to 1 with distinct lead terms',
        },
      ]);
      notify(
        this.api,
        'success',
        `Benchmark: ${docs.length} docs in ${totalMs.toFixed(0)} ms (${fmtMetric(docsPerSec, 3)} docs/s).`,
        `基准测试：${docs.length} 篇文档，耗时 ${totalMs.toFixed(0)} ms（${fmtMetric(docsPerSec, 3)} 篇/秒）。`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Benchmark failed: ${message}`, `基准测试失败：${message}`);
    } finally {
      this.running = false;
    }
  }

  // ---- science outputs ---------------------------------------------------------

  private publish(res: NlpPipelineResult, runtimeMs: number): void {
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'docs',
        label: zh ? '文档数' : 'Documents',
        value: String(res.index.docs.length),
        severity: 'info',
        hint: zh ? '每行一篇，pos/neg 标签前缀可选' : 'one document per line, optional pos/neg label prefix',
      },
      {
        key: 'vocab',
        label: zh ? '词表大小' : 'Vocabulary size',
        value: String(res.index.vocab.length),
        severity: 'info',
        hint: zh
          ? `总词次 ${res.index.totalTokens}，平均文档长度 ${fmtMetric(res.index.avgDocLen, 2)}`
          : `${res.index.totalTokens} tokens, avg doc length ${fmtMetric(res.index.avgDocLen, 2)}`,
      },
    ];
    if (this.state.mode === 'topics' && res.lda) {
      metrics.push({
        key: 'lda-coherence',
        label: zh ? 'LDA 主题词平均概率' : 'LDA mean top-term prob',
        value: fmtMetric(res.lda.coherenceProxy, 3),
        severity: 'ok',
        hint: zh
          ? '各主题前若干词 p(词|主题) 的均值（一致性代理）'
          : "mean p(term|topic) over each topic's top terms (coherence proxy)",
      });
    }
    if (this.state.mode === 'sentiment') {
      const agreement = res.sentiment.agreementPct;
      metrics.push({
        key: 'sentiment-agreement',
        label: zh ? '情感判定一致率' : 'Sentiment agreement',
        value: agreement === null ? '—' : `${fmtMetric(agreement, 3)}%`,
        unit: agreement === null ? undefined : '%',
        severity: 'info',
        hint: zh
          ? '词典法 vs 朴素贝叶斯（两者均有结论的文档）'
          : 'lexicon vs naive Bayes on documents where both decided',
      });
    }
    metrics.push({
      key: 'runtime',
      label: zh ? '运行耗时' : 'Runtime',
      value: `${fmtMetric(runtimeMs, 4)} ms`,
      unit: 'ms',
      severity: 'info',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- exports ----------------------------------------------------------------

  /** Export the current mode's result table as CSV. */
  private exportCsv(): void {
    const res = this.result;
    if (!res) {
      notify(this.api, 'warning', 'Run an analysis first.', '请先运行分析。');
      return;
    }
    switch (this.state.mode) {
      case 'topics': {
        const lda = res.lda;
        if (!lda) {
          notify(this.api, 'warning', 'No topics were computed in this mode.', '当前模式未计算主题。');
          return;
        }
        const rows = lda.topics.flatMap((topic, k) =>
          topic.map((e, j) => [
            k + 1,
            j === 0 ? Number(((lda.weights[k] ?? 0) * 100).toFixed(3)) : null,
            e.term,
            Number(e.prob.toFixed(6)),
          ]),
        );
        exportRowsCsv(this.api, 'nlp-topics', ['topic', 'weight_pct', 'term', 'p_term_given_topic'], rows);
        return;
      }
      case 'sentiment': {
        const rows = res.sentiment.rows.map((r) => [
          r.index + 1,
          r.label ?? '',
          r.lexScore,
          r.lexClass,
          r.nbPos === null ? null : Number(r.nbPos.toFixed(6)),
          r.nbClass ?? '',
          r.agree === null ? '' : r.agree ? 'yes' : 'no',
        ]);
        exportRowsCsv(
          this.api,
          'nlp-sentiment',
          ['doc', 'label', 'lexicon_score', 'lexicon_class', 'nb_p_pos', 'nb_class', 'agree'],
          rows,
        );
        return;
      }
      case 'similarity': {
        const sim = res.similarity;
        if (!sim) {
          notify(this.api, 'warning', 'No similarity results were computed in this mode.', '当前模式未计算相似度。');
          return;
        }
        const rows = sim.pairs.map((p) => [p.a + 1, p.b + 1, Number(p.sim.toFixed(6))]);
        exportRowsCsv(this.api, 'nlp-similarity', ['doc_a', 'doc_b', 'cosine_similarity'], rows);
        return;
      }
      case 'entities': {
        const rows = res.entities.map((e) => [e.text, e.type, e.count, e.docCount]);
        exportRowsCsv(this.api, 'nlp-entities', ['entity', 'type', 'count', 'doc_count'], rows);
        return;
      }
      default: {
        const rows = res.index.termFreqRows.slice(0, 200).map((r) => [
          r.term,
          r.count,
          r.docs,
          Number(r.idf.toFixed(6)),
        ]);
        exportRowsCsv(this.api, 'nlp-terms', ['term', 'count', 'docs', 'idf'], rows);
      }
    }
  }

  // ---- block / flow mode ---------------------------------------------------------

  async compute(
    input: unknown,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<ComputeResult> {
    if (typeof input === 'string' && input.trim()) {
      this.text = input;
    }
    if (!this.text.trim()) {
      clearScienceOutputs(this.manifest.id);
      return { ok: false, error: 'no corpus loaded' };
    }
    try {
      const docs = parseCorpus(this.text);
      const started = performance.now();
      // NlpProgress is structurally identical to ComputeProgress.
      const res = runNlpPipeline(docs, this.options(), (p) => onProgress?.(p));
      const runtimeMs = performance.now() - started;
      if (!res) {
        clearScienceOutputs(this.manifest.id);
        return { ok: false, error: 'corpus produced no analysable tokens' };
      }
      this.result = res;
      this.dirty = false;
      this.publish(res, runtimeMs);
      this.api.reportDataScale(docs.length);
      return {
        ok: true,
        output: {
          mode: this.state.mode,
          documents: res.index.docs.length,
          vocabulary: res.index.vocab.length,
          tokens: res.index.totalTokens,
          avgDocLength: res.index.avgDocLen,
          topics: res.lda
            ? { k: res.lda.k, coherenceProxy: res.lda.coherenceProxy, weights: res.lda.weights }
            : null,
          sentiment: {
            nbTrained: res.sentiment.nbTrained,
            agreementPct: res.sentiment.agreementPct,
          },
          similarPairs: res.similarity ? res.similarity.pairs.length : 0,
          clusters: res.similarity ? res.similarity.clusters : null,
          entities: res.entities.slice(0, 25),
          runtimeMs,
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
      drawHeader(g, w, zh ? '自然语言处理工作台' : 'NLP Workbench', zh ? '等待运行' : 'awaiting run', zh);
      g.fillStyle = CS.dim;
      g.font = font(zh, 12);
      g.textAlign = 'center';
      g.fillText(
        zh ? '点击「运行」分析当前语料' : 'Press "Run" to analyse the current corpus.',
        w / 2,
        h / 2 - 6,
      );
      g.fillStyle = CS.faint;
      g.font = font(zh, 10.5);
      g.fillText(
        zh
          ? '内置示例语料已就绪；也可载入 .txt / .csv 文件（每行一篇文档，可选 pos/neg 标签前缀）。'
          : 'The embedded sample corpus is ready; load a .txt / .csv file instead (one document per line, optional pos/neg prefix).',
        w / 2,
        h / 2 + 16,
      );
      drawFootnote(
        g,
        w,
        h,
        zh
          ? '流程：分词 → 停用词过滤 → 词干化 → TF-IDF → LDA / 情感 / 相似度 / 实体'
          : 'Pipeline: tokenize → stopword filter → stem → TF-IDF → LDA / sentiment / similarity / entities',
        zh,
      );
      return;
    }

    drawHeader(g, w, zh ? '自然语言处理工作台' : 'NLP Workbench', this.subtitle(res), zh);
    switch (this.state.mode) {
      case 'topics':
        this.drawTopics(g, w, h, res, zh);
        break;
      case 'sentiment':
        this.drawSentiment(g, w, h, res, zh);
        break;
      case 'similarity':
        this.drawSimilarity(g, w, h, res, zh);
        break;
      case 'entities':
        this.drawEntities(g, w, h, res, zh);
        break;
      default:
        this.drawOverview(g, w, h, res, zh);
        break;
    }
    drawFootnote(g, w, h, this.footnote(), zh);
  }

  private subtitle(res: NlpPipelineResult): string {
    const zh = this.zh;
    const idx = res.index;
    const parts = [
      zh ? `${idx.docs.length} 篇文档` : `${idx.docs.length} docs`,
      zh ? `词表 ${idx.vocab.length}` : `vocab ${idx.vocab.length}`,
      zh ? `词次 ${idx.totalTokens}` : `${idx.totalTokens} tokens`,
      `${zh ? '模式' : 'mode'} ${this.state.mode}`,
      `seed ${this.state.seed}`,
    ];
    return parts.join(' · ');
  }

  private footnote(): string {
    const zh = this.zh;
    switch (this.state.mode) {
      case 'topics':
        return zh
          ? '塌缩 Gibbs 采样的 LDA（对称 Dirichlet 先验 α=0.1、β=0.01）；占比为各主题的文档份额。'
          : 'Collapsed-Gibbs LDA with symmetric Dirichlet priors (alpha=0.1, beta=0.01); weight = mean topic share across documents.';
      case 'sentiment':
        return zh
          ? '词典规则打分 vs 多项朴素贝叶斯（拉普拉斯平滑，仅用带标签文档训练）。'
          : 'Rule-based lexicon scoring vs multinomial naive Bayes (Laplace smoothing, trained on labelled documents only).';
      case 'similarity':
        return zh
          ? '左：TF-IDF 向量的二维 PCA 投影（颜色为种子化 K 均值簇）；右：余弦相似度最高的文档对。'
          : 'Left: 2-D PCA of TF-IDF vectors coloured by seeded k-means clusters; right: top cosine-similar document pairs.';
      case 'entities':
        return zh
          ? '启发式方法：大写词串 + 机构/地名后缀模式，并非统计标注器。'
          : 'Heuristic capitalized-run extraction with org/location suffix patterns — not a statistical tagger.';
      default:
        return zh
          ? '上：语料高频词（词干，停用词已过滤）；下：词表统计（频次、文档数、平滑 IDF）。'
          : 'Top: most frequent corpus terms (stemmed, stopwords removed); bottom: vocabulary stats (count, document frequency, smoothed idf).';
    }
  }

  /** Centred mode-level message (used when a mode has no computable output). */
  private drawModeMessage(g: CanvasRenderingContext2D, w: number, h: number, msg: string, zh: boolean): void {
    g.fillStyle = CS.dim;
    g.font = font(zh, 12);
    g.textAlign = 'center';
    g.fillText(msg, w / 2, h / 2);
  }

  /** Overview: top-terms bar chart + vocabulary stats table. */
  private drawOverview(g: CanvasRenderingContext2D, w: number, h: number, res: NlpPipelineResult, zh: boolean): void {
    const rows = res.index.termFreqRows.slice(0, 10);
    if (rows.length === 0) {
      this.drawModeMessage(g, w, h, zh ? '词表为空。' : 'The vocabulary is empty.', zh);
      return;
    }
    const chartH = Math.round(h * 0.48);
    const box: PlotBox = plotBox(w, chartH, 64, 56, 28, 46);
    const maxCount = Math.max(1, ...rows.map((r) => r.count));
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      value: t,
      label: fmtMetric(maxCount - t * maxCount, 3),
    }));
    const xTicks = rows.map((r, i) => ({ value: (i + 0.5) / rows.length, label: r.term }));
    drawAxes(g, box, xTicks, yTicks, zh ? '高频词（词干）' : 'top terms (stemmed)', zh ? '语料频次' : 'corpus count', zh);
    const slot = box.w / rows.length;
    const barW = Math.min(56, slot * 0.62);
    rows.forEach((r, i) => {
      const barH = (r.count / maxCount) * box.h;
      g.fillStyle = PALETTE[i % PALETTE.length]!;
      g.fillRect(box.x0 + i * slot + (slot - barW) / 2, box.y1 - barH, barW, barH);
    });

    const tableTop = chartH + 56;
    g.fillStyle = CS.dim;
    g.font = font(zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(zh ? '词表统计（按频次排序）' : 'vocabulary stats (sorted by count)', 40, tableTop - 8);
    const tableRows = res.index.termFreqRows.slice(0, 8).map((r) => [
      r.term,
      r.count,
      r.docs,
      fmtMetric(r.idf, 3),
    ]);
    drawTable(
      g,
      w,
      h,
      zh ? ['词（词干）', '频次', '文档数', 'IDF'] : ['Term', 'Count', 'Docs', 'IDF'],
      tableRows,
      { top: tableTop, rowHeight: 17 },
    );
  }

  /** Topics: stacked topic-share bar + per-topic top-term table. */
  private drawTopics(g: CanvasRenderingContext2D, w: number, h: number, res: NlpPipelineResult, zh: boolean): void {
    const lda = res.lda;
    if (!lda) {
      this.drawModeMessage(g, w, h, zh ? '当前语料无法构建主题模型。' : 'No topic model could be built for this corpus.', zh);
      return;
    }
    // One stacked bar showing each topic's mean share across documents.
    const barX = 40;
    const barW = w - 40 - 28;
    let cursor = barX;
    lda.weights.forEach((weight, k) => {
      const seg = barW * weight;
      g.fillStyle = PALETTE[k % PALETTE.length]!;
      g.fillRect(cursor, 56, Math.max(1, seg - 1), 12);
      cursor += seg;
    });

    const perTopic = 5;
    const rows: Array<Array<string | number>> = [];
    lda.topics.forEach((topic, k) => {
      topic.slice(0, perTopic).forEach((e, j) => {
        rows.push([
          j === 0 ? `${zh ? '主题' : 'Topic'} ${k + 1}` : '',
          j === 0 ? `${((lda.weights[k] ?? 0) * 100).toFixed(1)}%` : '',
          e.term,
          fmtMetric(e.prob, 3),
        ]);
      });
    });
    drawTable(
      g,
      w,
      h,
      zh ? ['主题', '占比', '词项', 'p(词|主题)'] : ['Topic', 'Weight', 'Term', 'p(term|topic)'],
      rows,
      { top: 88, rowHeight: 17 },
    );
  }

  /** Sentiment: per-document score table with a lexicon-vs-NB summary line. */
  private drawSentiment(g: CanvasRenderingContext2D, w: number, h: number, res: NlpPipelineResult, zh: boolean): void {
    const st = res.sentiment;
    const considered = st.rows.filter((r) => r.agree !== null).length;
    g.fillStyle = CS.dim;
    g.font = font(zh, 10.5, '600');
    g.textAlign = 'left';
    const pct = st.agreementPct === null ? '—' : `${st.agreementPct.toFixed(1)}%`;
    const summary = !st.nbTrained
      ? zh
        ? '语料缺少 pos/neg 标签，朴素贝叶斯未训练；下表仅显示词典打分。'
        : 'The corpus has no pos/neg labels, so naive Bayes was not trained; the table shows lexicon scores only.'
      : zh
        ? `词典法 vs 朴素贝叶斯一致率：${pct}（n=${considered}）`
        : `Lexicon vs naive Bayes agreement: ${pct} (n=${considered})`;
    g.fillText(summary, 40, 78);

    const rows = st.rows.map((r) => [
      r.index + 1,
      r.label ?? '—',
      r.lexScore,
      r.lexClass,
      r.nbPos === null ? '—' : fmtMetric(r.nbPos, 3),
      r.nbClass ?? '—',
      r.agree === null ? '—' : r.agree ? (zh ? '一致' : 'yes') : (zh ? '不一致' : 'no'),
    ]);
    drawTable(
      g,
      w,
      h,
      zh
        ? ['#', '标签', '词典分', '词典判定', 'NB P(pos)', 'NB 判定', '一致']
        : ['#', 'Label', 'Lexicon', 'Lex class', 'NB P(pos)', 'NB class', 'Agree'],
      rows,
      { top: 92, rowHeight: 17 },
    );
  }

  /** Similarity: 2-D PCA scatter with cluster colours + top similar pairs table. */
  private drawSimilarity(g: CanvasRenderingContext2D, w: number, h: number, res: NlpPipelineResult, zh: boolean): void {
    const sim = res.similarity;
    if (!sim || sim.pca.length === 0) {
      this.drawModeMessage(g, w, h, zh ? '至少需要两篇文档才能计算相似度。' : 'Similarity needs at least two documents.', zh);
      return;
    }
    // --- PCA scatter (left panel) ---
    const panelW = Math.round(w * 0.58);
    const box: PlotBox = plotBox(panelW, h, 58, 66, 22, 46);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of sim.pca) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const padX = (maxX - minX) * 0.08 || 0.5;
    const padY = (maxY - minY) * 0.08 || 0.5;
    const loX = minX - padX;
    const hiX = maxX + padX;
    const loY = minY - padY;
    const hiY = maxY + padY;
    const sx = (v: number) => box.x0 + box.w * ((v - loX) / (hiX - loX || 1));
    const sy = (v: number) => box.y1 - box.h * ((v - loY) / (hiY - loY || 1));
    const axisTicks = (lo: number, hi: number) =>
      [0, 0.5, 1].map((t) => ({ value: t, label: fmtMetric(lo + t * (hi - lo), 2) }));
    drawAxes(g, box, axisTicks(loX, hiX), axisTicks(loY, hiY), 'PC 1', 'PC 2', zh);
    sim.pca.forEach((p, i) => {
      const cx = sx(p.x);
      const cy = sy(p.y);
      g.fillStyle = PALETTE[(sim.clusters[i] ?? 0) % PALETTE.length]!;
      g.beginPath();
      g.arc(cx, cy, 4.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = CS.faint;
      g.font = font(false, 8.5);
      g.textAlign = 'center';
      g.fillText(String(i + 1), cx, cy - 8);
    });
    const clusterIds = [...new Set(sim.clusters)].sort((a, b) => a - b);
    drawLegend(
      g,
      box.x0 + 6,
      box.y0 - 10,
      clusterIds.map((c) => ({ label: `${zh ? '簇' : 'C'}${c + 1}`, color: PALETTE[c % PALETTE.length]! })),
      zh,
    );

    // --- top similar pairs table (right panel) ---
    const rows = sim.pairs.map((p, i) => [i + 1, `${p.a + 1} – ${p.b + 1}`, fmtMetric(p.sim, 3)]);
    drawTable(
      g,
      w,
      h,
      zh ? ['序', '文档对', '余弦相似度'] : ['#', 'Doc pair', 'cos sim'],
      rows,
      { left: panelW + 12, right: 24, top: 70, rowHeight: 17 },
    );
  }

  /** Entities: extracted entity table (heuristic capitalized-run NER). */
  private drawEntities(g: CanvasRenderingContext2D, w: number, h: number, res: NlpPipelineResult, zh: boolean): void {
    const ents = res.entities;
    if (ents.length === 0) {
      this.drawModeMessage(g, w, h, zh ? '未发现大写词串形式的实体。' : 'No capitalized-run entities were found.', zh);
      return;
    }
    const rows = ents.slice(0, 16).map((e, i) => [i + 1, e.text, e.type, e.count, e.docCount]);
    drawTable(
      g,
      w,
      h,
      zh ? ['#', '实体', '类型', '出现次数', '文档数'] : ['#', 'Entity', 'Type', 'Count', 'Docs'],
      rows,
      { top: 70, rowHeight: 17 },
    );
  }
}

export default function createNlpPlugin(): Plugin {
  return new NlpPlugin();
}
