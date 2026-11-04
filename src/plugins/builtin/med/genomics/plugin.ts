// ==========================================================================
// med-genomics — Genomics Visualizer (2-D canvas, five analysis modes)
//
// Mode 1  GWAS    — Manhattan plot (alternating chromosome colours, pixel
//                   binning of 20k+ variants, genome-wide/suggestive lines,
//                   switchable -log10 axis) beside a QQ plot with the 95%
//                   confidence band and genomic-inflation lambda.
// Mode 2  Volcano — log2FC vs -log10(padj) with adjustable thresholds,
//                   top-N gene labels and up/down counts.
// Mode 3  LD      — r² heatmap from a square matrix or a long table, colour
//                   scale 0..1, largest high-LD block outlined.
// Mode 4  GSEA    — preranked running enrichment score with a fixed-seed
//                   permutation null (nominal p, NES, FDR-style q).
// Mode 5  Circos  — outer chromosome ring plus quadratic-Bézier chords for
//                   rearrangement anchors (chrA,posA -> chrB,posB,type).
// Plus:  CSV export per mode and mode-specific scientific outputs.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, PluginRenderContext } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { medGenomicsManifest } from './manifest';
import {
  GENOMEWIDE_P,
  GSEA_DEFAULT_SEED,
  SUGGESTIVE_P,
  circosSummary,
  compareChr,
  gwasSummary,
  ldSummary,
  maxLdBlock,
  parseGwasCsv,
  parseLdCsv,
  parseRearrangements,
  parseRankedCsv,
  parseVolcanoCsv,
  qqPlotData,
  runGsea,
  topHitIndices,
  topVolcanoIndices,
  volcanoSummary,
  type CircosData,
  type GseaResult,
  type GwasData,
  type LdData,
  type RankedList,
  type VolcanoData,
} from './genomics';

type Mode = 'gwas' | 'volcano' | 'ld' | 'gsea' | 'circos';

const MODES: Mode[] = ['gwas', 'volcano', 'ld', 'gsea', 'circos'];

const MODE_TITLES: Record<Mode, { en: string; zh: string }> = {
  gwas: { en: 'GWAS', zh: 'GWAS' },
  volcano: { en: 'Volcano', zh: '火山图' },
  ld: { en: 'LD heatmap', zh: 'LD 热图' },
  gsea: { en: 'GSEA', zh: 'GSEA 富集' },
  circos: { en: 'Circos', zh: 'Circos 重排' },
};

const MODE_HINTS: Record<Mode, { en: string; zh: string }> = {
  gwas: {
    en: 'Expected columns: chr, pos, p (optional beta/OR and label).',
    zh: '期望列：chr、pos、p（可选 beta/OR、label）。',
  },
  volcano: {
    en: 'Expected columns: gene, log2fc, padj (padj falls back to a p column).',
    zh: '期望列：gene、log2fc、padj（padj 可回退到 p 列）。',
  },
  ld: {
    en: 'Expected an r2 square matrix (header optional) or a long table pos_i, pos_j, r2.',
    zh: '期望 r2 方阵（表头可选）或长表 pos_i、pos_j、r2。',
  },
  gsea: {
    en: 'Expected columns: gene, score (log2fc / stat / t also accepted).',
    zh: '期望列：gene、score（也接受 log2fc / stat / t）。',
  },
  circos: {
    en: 'Expected columns: chrA, posA, chrB, posB, type.',
    zh: '期望列：chrA、posA、chrB、posB、type。',
  },
};

/** Chord / legend colours for the known rearrangement types. */
const TYPE_COLORS: Record<string, string> = {
  deletion: 'rgba(235,100,100,0.95)',
  duplication: 'rgba(110,170,250,0.95)',
  inversion: 'rgba(240,200,90,0.95)',
  translocation: 'rgba(175,130,240,0.95)',
  'tandem-duplication': 'rgba(100,210,160,0.95)',
  fusion: 'rgba(245,150,90,0.95)',
  insertion: 'rgba(110,220,220,0.95)',
  rearrangement: 'rgba(180,190,205,0.95)',
};
const FALLBACK_COLORS = [
  'rgba(120,200,220,0.95)',
  'rgba(230,140,200,0.95)',
  'rgba(170,220,120,0.95)',
  'rgba(250,170,120,0.95)',
  'rgba(140,150,250,0.95)',
];

function typeColor(type: string): string {
  const known = TYPE_COLORS[type.toLowerCase()];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < type.length; i += 1) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]!;
}

const CHR_A = 'rgba(96,150,255,0.92)';
const CHR_B = 'rgba(70,200,190,0.92)';

/** Piecewise colour ramp for r²: deep navy -> steel -> teal -> green -> gold. */
function ldColor(v: number): string {
  const stops: Array<[number, number, number, number]> = [
    [0, 13, 24, 46],
    [0.4, 36, 94, 140],
    [0.6, 64, 158, 170],
    [0.8, 140, 208, 140],
    [1, 255, 214, 90],
  ];
  const t = Math.min(Math.max(v, 0), 1);
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (t >= a[0] && t <= b[0]) {
      const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
      const r = Math.round(a[1] + (b[1] - a[1]) * f);
      const g = Math.round(a[2] + (b[2] - a[2]) * f);
      const bl = Math.round(a[3] + (b[3] - a[3]) * f);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return 'rgb(255,214,90)';
}

/** "Nice" tick step near `range / 5` on a 1 / 2 / 5 / 10 magnitude. */
function niceStep(range: number): number {
  const raw = Math.max(range, 1e-12) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

interface State {
  mode: Mode;
  negLog: boolean;
  fcThresh: number;
  padjThresh: number;
  topN: number;
  geneSetText: string;
}

interface Panel {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class MedGenomicsPlugin implements Plugin {
  readonly manifest = medGenomicsManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private rawText: string | null = null;
  private fileName = '';
  private cache: Partial<Record<Mode, unknown>> = {};
  private gseaKey = '';
  private gseaMemo: GseaResult | null = null;

  private state: State = {
    mode: 'gwas',
    negLog: true,
    fcThresh: 1,
    padjThresh: 0.05,
    topN: 5,
    geneSetText: '',
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.publish();
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: PluginRenderContext) {
    this.ctx = context.container;
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  // ---- parameters ---------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '视图模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'gwas', label: 'GWAS (Manhattan + QQ)', labelI18n: { 'zh-CN': 'GWAS（曼哈顿 + QQ）', 'en-US': 'GWAS (Manhattan + QQ)' } },
          { value: 'volcano', label: 'Volcano', labelI18n: { 'zh-CN': '火山图', 'en-US': 'Volcano' } },
          { value: 'ld', label: 'LD heatmap', labelI18n: { 'zh-CN': '连锁不平衡热图', 'en-US': 'LD heatmap' } },
          { value: 'gsea', label: 'GSEA', labelI18n: { 'zh-CN': '基因集富集 GSEA', 'en-US': 'Gene-set enrichment (GSEA)' } },
          { value: 'circos', label: 'Circos', labelI18n: { 'zh-CN': 'Circos 重排图', 'en-US': 'Circos rearrangements' } },
        ],
        value: s.mode,
      },
      {
        key: 'negLog',
        label: '-log10(p) axis',
        labelI18n: { 'zh-CN': '纵轴取 −log10(p)', 'en-US': '-log10(p) axis' },
        type: 'checkbox',
        value: s.negLog,
        visibleWhen: { key: 'mode', in: ['gwas'] },
      },
      {
        key: 'fcThresh',
        label: '|log2FC| cutoff',
        labelI18n: { 'zh-CN': '|log2FC| 阈值', 'en-US': '|log2FC| cutoff' },
        type: 'range',
        min: 0.2,
        max: 4,
        step: 0.1,
        value: s.fcThresh,
        visibleWhen: { key: 'mode', in: ['volcano'] },
      },
      {
        key: 'padjThresh',
        label: 'Adjusted-p cutoff',
        labelI18n: { 'zh-CN': '校正 p 阈值', 'en-US': 'Adjusted-p cutoff' },
        type: 'select',
        options: ['0.1', '0.05', '0.01', '0.001', '0.0001'].map((v) => ({
          value: v,
          label: v === '0.0001' ? '1e-4' : v,
          labelI18n: { 'zh-CN': v === '0.0001' ? '1e-4' : v, 'en-US': v === '0.0001' ? '1e-4' : v },
        })),
        value: String(s.padjThresh),
        visibleWhen: { key: 'mode', in: ['volcano'] },
      },
      {
        key: 'topN',
        label: 'Top-N labels',
        labelI18n: { 'zh-CN': 'Top-N 标注数量', 'en-US': 'Top-N labels' },
        type: 'range',
        min: 0,
        max: 20,
        step: 1,
        value: s.topN,
        visibleWhen: [{ key: 'mode', in: ['volcano'] }, { key: 'mode', in: ['gwas'] }],
      },
      {
        key: 'geneSetText',
        label: 'Gene set',
        labelI18n: { 'zh-CN': '基因集（逗号/空格分隔）', 'en-US': 'Gene set (comma/space separated)' },
        type: 'text',
        value: s.geneSetText,
        placeholder: 'e.g. TP53 BRCA1 EGFR ...',
        visibleWhen: { key: 'mode', in: ['gsea'] },
      },
      actionButton('exportCsv', 'Export CSV', '导出 CSV', 'primary'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    if (typeof params.mode === 'string' && (MODES as string[]).includes(params.mode) && params.mode !== this.state.mode) {
      this.state.mode = params.mode as Mode;
      changed = true;
    }
    if (typeof params.negLog === 'boolean' && params.negLog !== this.state.negLog) {
      this.state.negLog = params.negLog;
      changed = true;
    }
    if (typeof params.fcThresh === 'number' && Number.isFinite(params.fcThresh) && params.fcThresh !== this.state.fcThresh) {
      this.state.fcThresh = Math.min(Math.max(params.fcThresh, 0.1), 10);
      changed = true;
    }
    if ((typeof params.padjThresh === 'string' || typeof params.padjThresh === 'number')) {
      const q = Number(params.padjThresh);
      if (Number.isFinite(q) && q > 0 && q <= 1 && q !== this.state.padjThresh) {
        this.state.padjThresh = q;
        changed = true;
      }
    }
    if (typeof params.topN === 'number' && Number.isFinite(params.topN) && params.topN !== this.state.topN) {
      this.state.topN = Math.round(Math.min(Math.max(params.topN, 0), 50));
      changed = true;
    }
    if (typeof params.geneSetText === 'string' && params.geneSetText !== this.state.geneSetText) {
      this.state.geneSetText = params.geneSetText;
      changed = true;
    }
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (changed) {
      this.publish();
      this.draw();
    }
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- data intake --------------------------------------------------------

  async loadData(file: File) {
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      notify(
        this.api,
        'warning',
        'Genomics Visualizer loads CSV / TSV tables (or plain text with one table).',
        '基因组可视化器接受 CSV/TSV 表格（或含单张表的纯文本）。',
      );
      return;
    }
    const text = await file.text();
    this.rawText = text;
    this.fileName = file.name;
    this.cache = {};
    this.gseaKey = '';
    this.gseaMemo = null;
    // Try the current mode first, then auto-detect: probe every mode's
    // parser and switch to the first one that recognizes the columns, so
    // loading an example for another mode never dead-ends with a warning.
    let parsed = this.ensureData(this.state.mode);
    let switched = false;
    if (!parsed) {
      const others = MODES.filter((m) => m !== this.state.mode);
      for (const m of others) {
        const probed = this.ensureData(m);
        if (probed) {
          this.state.mode = m;
          parsed = probed;
          switched = true;
          break;
        }
      }
    }
    if (!parsed) {
      notify(
        this.api,
        'warning',
        `No columns in ${file.name} match any analysis mode (GWAS, volcano, LD, GSEA, circos).`,
        `${file.name} 中没有任何数据列匹配分析模式（GWAS、火山图、LD、GSEA、Circos）。`,
      );
      this.draw();
      return;
    }
    const count = this.state.mode === 'ld' ? (parsed as LdData).n : (parsed as { n: number }).n;
    notify(
      this.api,
      'success',
      `Loaded ${count} ${this.state.mode === 'ld' ? 'loci' : 'records'} from ${file.name}${switched ? `, switched to ${MODE_TITLES[this.state.mode].en} mode` : ''}.`,
      `已从 ${file.name} 载入 ${count} 条${this.state.mode === 'ld' ? '位点' : '记录'}${switched ? `，已切换到「${MODE_TITLES[this.state.mode].zh}」模式` : ''}。`,
    );
    this.publish();
    this.draw();
  }

  /** Lazy per-mode parse with a one-shot cache; reports data scale on success. */
  private ensureData(mode: Mode): unknown | null {
    const cached = this.cache[mode];
    if (cached !== undefined) return cached;
    if (!this.rawText) return null;
    let parsed: unknown = null;
    switch (mode) {
      case 'gwas':
        parsed = parseGwasCsv(this.rawText);
        break;
      case 'volcano':
        parsed = parseVolcanoCsv(this.rawText);
        break;
      case 'ld':
        parsed = parseLdCsv(this.rawText);
        break;
      case 'gsea':
        parsed = parseRankedCsv(this.rawText);
        break;
      case 'circos':
        parsed = parseRearrangements(this.rawText);
        break;
    }
    this.cache[mode] = parsed;
    if (parsed) this.api.reportDataScale(this.scaleOf(mode, parsed));
    return parsed;
  }

  private scaleOf(mode: Mode, data: unknown): number {
    if (mode === 'ld') {
      const d = data as LdData;
      return d.n * d.n;
    }
    return (data as { n: number }).n;
  }

  private gwas(): GwasData | null {
    return (this.ensureData('gwas') as GwasData | null) ?? null;
  }

  private volcano(): VolcanoData | null {
    return (this.ensureData('volcano') as VolcanoData | null) ?? null;
  }

  private ld(): LdData | null {
    return (this.ensureData('ld') as LdData | null) ?? null;
  }

  private ranked(): RankedList | null {
    return (this.ensureData('gsea') as RankedList | null) ?? null;
  }

  private circos(): CircosData | null {
    return (this.ensureData('circos') as CircosData | null) ?? null;
  }

  /** Built-in demo set: every other gene over the top quarter of the ranking. */
  private builtInSet(ranked: RankedList): string[] {
    const span = Math.max(10, Math.floor(ranked.n * 0.25));
    const out: string[] = [];
    for (let i = 0; i < span && i < ranked.n; i += 2) out.push(ranked.gene[i]!);
    return out;
  }

  /** Memoized GSEA run keyed by file, list size and gene-set text. */
  private gseaResult(): GseaResult | null {
    const ranked = this.ranked();
    if (!ranked) return null;
    const text = this.state.geneSetText.trim();
    const setList = text ? text.split(/[,;\s]+/).filter(Boolean) : this.builtInSet(ranked);
    if (setList.length === 0) return null;
    const key = `${this.fileName}|${ranked.n}|${setList.join('|')}`;
    if (this.gseaKey === key && this.gseaMemo) return this.gseaMemo;
    const res = runGsea(ranked, setList);
    this.gseaKey = key;
    this.gseaMemo = res;
    return res;
  }

  // ---- scientific outputs -------------------------------------------------

  private publish() {
    const id = this.manifest.id;
    const metrics = this.rawText ? this.buildMetrics() : null;
    if (!metrics) {
      clearScienceOutputs(id);
      return;
    }
    setScienceOutputs(id, metrics);
  }

  /** Per-mode metric set; null when the loaded columns do not match the mode. */
  private buildMetrics(): ScienceMetric[] | null {
    const zh = this.zh;
    switch (this.state.mode) {
      case 'gwas': {
        const d = this.gwas();
        if (!d) return null;
        const s = gwasSummary(d);
        const lambdaDev = Math.abs(s.lambda - 1);
        return [
          {
            key: 'lambda',
            label: 'lambda (GC)',
            value: fmtMetric(s.lambda),
            severity: lambdaDev <= 0.1 ? 'ok' : lambdaDev <= 0.2 ? 'warn' : 'error',
            hint: zh
              ? '基因组膨胀因子 λ = median(χ²₁)/0.4549，>1 提示群体分层或批次效应（渐近近似）'
              : 'genomic inflation lambda = median(chi2_1)/0.4549; >1 suggests stratification/batch effects (asymptotic)',
          },
          {
            key: 'min-p',
            label: 'min p',
            value: fmtMetric(s.minP),
            severity: s.genomeWideHits > 0 ? 'ok' : 'info',
            hint: zh ? '全基因组最小 p 值' : 'smallest p-value across the scan',
          },
          {
            key: 'gw-hits',
            label: 'GW hits',
            value: String(s.genomeWideHits),
            hint: zh ? 'p ≤ 5e-8 的位点数' : 'variants at p <= 5e-8',
          },
          {
            key: 'sugg-hits',
            label: 'suggestive',
            value: String(s.suggestiveHits),
            hint: zh ? '5e-8 < p ≤ 1e-5 的位点数' : 'variants at 5e-8 < p <= 1e-5',
          },
          {
            key: 'bonferroni',
            label: 'Bonferroni',
            value: fmtMetric(s.bonferroni),
            hint: zh ? `FWER 阈值 0.05/n，n=${s.n}` : `family-wise threshold 0.05/n with n=${s.n}`,
          },
        ];
      }
      case 'volcano': {
        const v = this.volcano();
        if (!v) return null;
        const s = volcanoSummary(v, this.state.fcThresh, this.state.padjThresh);
        return [
          { key: 'up', label: 'up-regulated', value: String(s.up), severity: s.up > 0 ? 'ok' : 'info', hint: zh ? `log2FC ≥ ${s.fcThresh} 且 padj ≤ ${s.qThresh}` : `log2FC >= ${s.fcThresh} and padj <= ${s.qThresh}` },
          { key: 'down', label: 'down-regulated', value: String(s.down), severity: s.down > 0 ? 'ok' : 'info', hint: zh ? `log2FC ≤ -${s.fcThresh} 且 padj ≤ ${s.qThresh}` : `log2FC <= -${s.fcThresh} and padj <= ${s.qThresh}` },
          { key: 'ns', label: 'not significant', value: String(s.ns), hint: zh ? '未过双阈值的基因数' : 'genes passing neither threshold' },
          { key: 'min-padj', label: 'min padj', value: fmtMetric(s.minPadj), hint: zh ? '最小校正 p 值' : 'smallest adjusted p-value' },
          { key: 'max-lfc', label: 'max |log2FC|', value: fmtMetric(s.maxAbsLog2fc), hint: zh ? '最大绝对 log2 倍数变化' : 'largest absolute log2 fold change' },
        ];
      }
      case 'ld': {
        const d = this.ld();
        if (!d) return null;
        const s = ldSummary(d);
        const block = maxLdBlock(d, 0.5);
        const metrics: ScienceMetric[] = [
          {
            key: 'max-r2',
            label: 'max r2',
            value: fmtMetric(s.maxR2),
            severity: s.maxR2 >= 0.8 ? 'warn' : 'info',
            hint: zh ? `最强 LD 对：位点 ${d.ids[s.maxI]} – ${d.ids[s.maxJ]}` : `strongest LD pair: loci ${d.ids[s.maxI]} - ${d.ids[s.maxJ]}`,
          },
          { key: 'mean-r2', label: 'mean r2', value: fmtMetric(s.meanR2), hint: zh ? '非对角 r² 均值（上三角）' : 'mean off-diagonal r2 (upper triangle)' },
          { key: 'loci', label: 'loci', value: String(s.n), hint: zh ? '矩阵中的位点数' : 'loci in the matrix' },
        ];
        if (block) {
          metrics.push({
            key: 'max-block',
            label: 'max block',
            value: `${block.start + 1}-${block.end}`,
            hint: zh
              ? `最大全成对 r²≥0.5 连续区块：${block.start + 1} 到 ${block.end}（${block.size} 个位点）`
              : `largest contiguous window with all pairwise r2 >= 0.5: loci ${block.start + 1} to ${block.end} (${block.size} loci)`,
          });
        }
        return metrics;
      }
      case 'gsea': {
        const res = this.gseaResult();
        if (!res) return null;
        return [
          {
            key: 'es',
            label: 'ES',
            value: fmtMetric(res.es),
            severity: Math.abs(res.nes) >= 1.5 ? 'ok' : 'info',
            hint: zh ? '加权 Kolmogorov-Smirnov 运行和的极值（weight=1）' : 'extremum of the weighted running-sum enrichment score (weight=1)',
          },
          {
            key: 'nes',
            label: 'NES',
            value: fmtMetric(res.nes),
            hint: zh ? 'ES / mean|ES_null|（置换零分布标准化）' : 'ES divided by mean |ES_null| over the permutation null',
          },
          {
            key: 'nominal-p',
            label: 'nominal p',
            value: fmtMetric(res.nominalP),
            hint: zh ? `(1 + #{|ES_null| ≥ |ES|}) / (k+1)，k=${res.permutations}` : `(1 + #{|ES_null| >= |ES|}) / (k+1) with k=${res.permutations}`,
          },
          {
            key: 'fdr-q',
            label: 'FDR q',
            value: fmtMetric(res.qValue),
            severity: res.qValue <= 0.25 ? 'ok' : 'info',
            hint: zh ? `池化零分布 NES 的 FDR 近似，k=${res.permutations}` : `FDR-style q from the pooled null NES, k=${res.permutations}`,
          },
          { key: 'set-size', label: 'set size', value: String(res.setSize), hint: zh ? `基因集命中数 / 排序列表长度 ${res.n}` : `gene-set hits within a ranked list of ${res.n}` },
        ];
      }
      case 'circos': {
        const d = this.circos();
        if (!d) return null;
        const s = circosSummary(d);
        return [
          { key: 'events', label: 'events', value: String(s.total), hint: zh ? '重排锚点事件总数' : 'total rearrangement anchor events' },
          {
            key: 'cross-chr',
            label: 'cross-chr',
            value: String(s.crossChromosome),
            hint: zh ? '跨染色体事件数（易位/融合）' : 'events spanning two chromosomes (translocations/fusions)',
          },
          { key: 'types', label: 'types', value: String(s.byType ? Object.keys(s.byType).length : 0), hint: zh ? '重排类型数' : 'distinct rearrangement types' },
          { key: 'chromosomes', label: 'chromosomes', value: String(s.chromosomes), hint: zh ? '涉及的染色体数' : 'chromosomes involved' },
        ];
      }
    }
  }

  // ---- CSV export ---------------------------------------------------------

  private mismatchNotice(): void {
    notify(
      this.api,
      'warning',
      `Loaded columns do not match the ${MODE_TITLES[this.state.mode].en} mode.`,
      `已载入的数据列与「${MODE_TITLES[this.state.mode].zh}」模式不匹配。`,
    );
  }

  private exportCsv() {
    if (!this.rawText) {
      notify(this.api, 'warning', 'Load a data file first.', '请先加载数据文件。');
      return;
    }
    switch (this.state.mode) {
      case 'gwas': {
        const d = this.gwas();
        if (!d) return this.mismatchNotice();
        const head: string[] = ['chr', 'pos', 'p', 'negLog10P'];
        if (d.effect) head.push(d.effectKind === 'or' ? 'lnOR' : 'beta');
        if (d.labels) head.push('label');
        const rows = topHitIndices(d, 100).map((i) => {
          const row: Array<string | number | null> = [
            d.chrNames[d.chrIdx[i]!]!,
            d.pos[i]!,
            d.p[i]!,
            -Math.log10(Math.max(d.p[i]!, 1e-300)),
          ];
          if (d.effect) row.push(Number.isFinite(d.effect[i]!) ? d.effect[i]! : null);
          if (d.labels) row.push(d.labels[i] || null);
          return row;
        });
        exportRowsCsv(this.api, 'med-genomics-gwas-top-hits', head, rows);
        return;
      }
      case 'volcano': {
        const v = this.volcano();
        if (!v) return this.mismatchNotice();
        const s = volcanoSummary(v, this.state.fcThresh, this.state.padjThresh);
        const idx: number[] = [];
        for (let i = 0; i < v.n; i += 1) {
          if (v.padj[i]! <= s.qThresh && Math.abs(v.log2fc[i]!) >= s.fcThresh) idx.push(i);
        }
        idx.sort((a, b) => v.padj[a]! - v.padj[b]!);
        const rows = idx.slice(0, 5000).map((i) => [
          v.gene[i]!,
          v.log2fc[i]!,
          v.padj[i]!,
          v.log2fc[i]! >= s.fcThresh ? 'up' : 'down',
        ]);
        exportRowsCsv(this.api, 'med-genomics-volcano-de', ['gene', 'log2fc', 'padj', 'class'], rows);
        return;
      }
      case 'ld': {
        const d = this.ld();
        if (!d) return this.mismatchNotice();
        const pairs: Array<[number, number, number]> = [];
        for (let i = 0; i < d.n; i += 1) {
          for (let j = i + 1; j < d.n; j += 1) pairs.push([i, j, d.r2[i * d.n + j]!]);
        }
        pairs.sort((a, b) => b[2] - a[2]);
        const rows = pairs.slice(0, 20000).map(([i, j, r2]) => [d.ids[i]!, d.ids[j]!, r2]);
        exportRowsCsv(this.api, 'med-genomics-ld-pairs', ['id_i', 'id_j', 'r2'], rows);
        return;
      }
      case 'gsea': {
        const ranked = this.ranked();
        const res = this.gseaResult();
        if (!ranked || !res) return this.mismatchNotice();
        const hit = new Uint8Array(ranked.n);
        for (const i of res.hits) hit[i] = 1;
        const rows: Array<Array<string | number>> = [];
        for (let i = 0; i < ranked.n; i += 1) {
          rows.push([i + 1, ranked.gene[i]!, ranked.score[i]!, res.runningEs[i]!, hit[i]!]);
        }
        exportRowsCsv(this.api, 'med-genomics-gsea-running-es', ['rank', 'gene', 'score', 'runningES', 'hit'], rows);
        return;
      }
      case 'circos': {
        const d = this.circos();
        if (!d) return this.mismatchNotice();
        const rows = d.events.map((e) => [e.chrA, e.posA, e.chrB, e.posB, e.type]);
        exportRowsCsv(this.api, 'med-genomics-circos-events', ['chrA', 'posA', 'chrB', 'posB', 'type'], rows);
        return;
      }
    }
  }

  // ---- drawing ------------------------------------------------------------

  private uiFont(px: number, bold = false): string {
    return `${bold ? 'bold ' : ''}${px}px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (!this.rawText) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No genomics data',
        titleZh: '尚未加载基因组数据',
        hint: MODE_HINTS[this.state.mode].en,
        hintZh: MODE_HINTS[this.state.mode].zh,
      });
      return;
    }
    const data = this.ensureData(this.state.mode);
    if (!data) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'Columns do not match this mode',
        titleZh: '数据列与当前模式不匹配',
        hint: MODE_HINTS[this.state.mode].en,
        hintZh: MODE_HINTS[this.state.mode].zh,
      });
      return;
    }
    this.publish();
    switch (this.state.mode) {
      case 'gwas':
        this.drawGwas(g, canvas, data as GwasData);
        break;
      case 'volcano':
        this.drawVolcano(g, canvas, data as VolcanoData);
        break;
      case 'ld':
        this.drawLd(g, canvas, data as LdData);
        break;
      case 'gsea':
        this.drawGsea(g, canvas, data as RankedList);
        break;
      case 'circos':
        this.drawCircos(g, canvas, data as CircosData);
        break;
    }
  }

  private footer(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string): void {
    g.font = this.uiFont(10);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(175,190,210,0.92)';
    g.fillText(text, 14, canvas.height - 6);
  }

  /** Draw stacked value labels (top-to-bottom) with a simple collision gap. */
  private placeLabels(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, items: Array<{ x: number; y: number; text: string }>): void {
    if (items.length === 0) return;
    items.sort((a, b) => a.y - b.y);
    g.font = this.uiFont(10);
    let lastY = -Infinity;
    for (const it of items) {
      let y = it.y - 4;
      if (y - lastY < 12) y = lastY + 12;
      lastY = y;
      const flip = it.x > canvas.width - 110;
      g.textAlign = flip ? 'right' : 'left';
      g.fillStyle = 'rgba(240,244,252,0.96)';
      g.fillText(it.text, flip ? it.x - 5 : it.x + 5, y);
    }
  }

  private frame(g: CanvasRenderingContext2D, p: Panel): void {
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 1;
    g.strokeRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
  }

  // ---- mode 1: GWAS (Manhattan + QQ) -------------------------------------

  private drawGwas(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, d: GwasData): void {
    const zh = this.zh;
    const split = Math.floor(canvas.width * 0.62);
    const left: Panel = { x0: 0, y0: 0, x1: split - 6, y1: canvas.height };
    const right: Panel = { x0: split + 6, y0: 0, x1: canvas.width, y1: canvas.height };
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.moveTo(split, 8);
    g.lineTo(split, canvas.height - 8);
    g.stroke();
    this.drawManhattan(g, canvas, left, d);
    this.drawQq(g, right, d);

    const s = gwasSummary(d);
    this.footer(
      g,
      canvas,
      zh
        ? `${s.n} 个位点 · λ=${fmtMetric(s.lambda)} · 全显著(p≤5e-8) ${s.genomeWideHits} · 提示(p≤1e-5) ${s.suggestiveHits} · Bonferroni p<${fmtMetric(s.bonferroni)}（${s.bonferroniHits}）`
        : `${s.n} variants · lambda=${fmtMetric(s.lambda)} · genome-wide ${s.genomeWideHits} · suggestive ${s.suggestiveHits} · Bonferroni p<${fmtMetric(s.bonferroni)} (${s.bonferroniHits})`,
    );
  }

  private drawManhattan(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, region: Panel, d: GwasData): void {
    const zh = this.zh;
    const negLog = this.state.negLog;
    const padL = 44;
    const padR = 12;
    const padT = 26;
    const padB = 30;
    const p: Panel = {
      x0: region.x0 + padL,
      y0: region.y0 + padT,
      x1: Math.max(region.x1 - padR, region.x0 + padL + 40),
      y1: Math.max(region.y1 - padB, region.y0 + padT + 40),
    };
    const plotW = p.x1 - p.x0;
    const plotH = p.y1 - p.y0;

    // cumulative chromosome offsets (chrIdx slots are already rank-sorted)
    const chrCount = d.chrNames.length;
    const chrMax = new Float64Array(chrCount);
    for (let i = 0; i < d.n; i += 1) {
      const c = d.chrIdx[i]!;
      const pos = d.pos[i]!;
      if (pos > chrMax[c]!) chrMax[c] = pos;
    }
    const offset = new Float64Array(chrCount);
    let total = 0;
    for (let c = 0; c < chrCount; c += 1) {
      offset[c] = total;
      total += Math.max(chrMax[c]!, 1);
    }

    // pixel-column binning: keep the smallest p per column
    const bins = Math.max(1, Math.floor(plotW));
    const binP = new Float32Array(bins).fill(1);
    const binChr = new Int16Array(bins).fill(-1);
    for (let i = 0; i < d.n; i += 1) {
      const c = d.chrIdx[i]!;
      const coord = offset[c]! + Math.min(d.pos[i]!, Math.max(chrMax[c]!, 1));
      let bin = Math.floor((coord / Math.max(total, 1)) * bins);
      if (bin < 0) bin = 0;
      if (bin >= bins) bin = bins - 1;
      const pv = d.p[i]!;
      if (pv < binP[bin]!) {
        binP[bin] = pv;
        binChr[bin] = c;
      }
    }

    let maxVal = 0;
    for (let b = 0; b < bins; b += 1) {
      if (binP[b]! < 1) {
        const v = -Math.log10(Math.max(binP[b]!, 1e-300));
        if (v > maxVal) maxVal = v;
      }
    }
    const yMax = negLog ? Math.max(8, Math.ceil(maxVal * 1.05)) : 1;
    const pyLog = (v: number) => p.y1 - (v / yMax) * plotH;
    const pyLin = (pv: number) => p.y0 + pv * plotH;
    const px = (x: number) => p.x0 + x;

    this.frame(g, p);

    // gridlines + y ticks
    g.font = this.uiFont(10);
    g.textAlign = 'right';
    if (negLog) {
      const step = Math.max(1, Math.ceil(yMax / 6));
      for (let v = 0; v <= yMax; v += step) {
        const y = pyLog(v);
        g.strokeStyle = 'rgba(255,255,255,0.05)';
        g.beginPath();
        g.moveTo(p.x0, y);
        g.lineTo(p.x1, y);
        g.stroke();
        g.fillStyle = 'rgba(170,182,200,0.9)';
        g.fillText(String(v), p.x0 - 5, y + 3);
      }
    } else {
      for (let k = 0; k <= 5; k += 1) {
        const pv = k / 5;
        const y = pyLin(pv);
        g.strokeStyle = 'rgba(255,255,255,0.05)';
        g.beginPath();
        g.moveTo(p.x0, y);
        g.lineTo(p.x1, y);
        g.stroke();
        g.fillStyle = 'rgba(170,182,200,0.9)';
        g.fillText(pv.toFixed(1), p.x0 - 5, y + 3);
      }
    }

    // threshold lines
    const thrY = (pv: number) => (negLog ? pyLog(-Math.log10(pv)) : pyLin(pv));
    g.setLineDash([5, 4]);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(240,110,110,0.85)';
    g.beginPath();
    g.moveTo(p.x0, thrY(GENOMEWIDE_P));
    g.lineTo(p.x1, thrY(GENOMEWIDE_P));
    g.stroke();
    g.strokeStyle = 'rgba(240,190,80,0.8)';
    g.beginPath();
    g.moveTo(p.x0, thrY(SUGGESTIVE_P));
    g.lineTo(p.x1, thrY(SUGGESTIVE_P));
    g.stroke();
    g.setLineDash([]);
    const yGw = thrY(GENOMEWIDE_P);
    const ySg = thrY(SUGGESTIVE_P);
    g.font = this.uiFont(10);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(240,110,110,0.95)';
    g.fillText('5e-8', p.x1 - 4, yGw - 3);
    g.fillStyle = 'rgba(240,190,80,0.95)';
    g.fillText('1e-5', p.x1 - 4, ySg - 3 + (Math.abs(yGw - ySg) < 10 ? 12 : 0));

    // binned points
    for (let b = 0; b < bins; b += 1) {
      const pv = binP[b]!;
      if (pv >= 1) continue;
      const c = binChr[b]!;
      g.fillStyle = c >= 0 && (c & 1) === 0 ? CHR_A : CHR_B;
      const y = negLog ? pyLog(-Math.log10(Math.max(pv, 1e-300))) : pyLin(pv);
      g.fillRect(px(b + 0.5) - 1, y - 1, 2, 2);
    }

    // chromosome labels + alternating tint strip
    g.font = this.uiFont(10);
    g.textAlign = 'center';
    for (let c = 0; c < chrCount; c += 1) {
      const mid = (offset[c]! + Math.max(chrMax[c]!, 1) / 2) / Math.max(total, 1);
      const x = px(mid * plotW);
      g.fillStyle = (c & 1) === 0 ? 'rgba(96,150,255,0.85)' : 'rgba(70,200,190,0.85)';
      g.fillText(d.chrNames[c]!, x, p.y1 + 14);
    }

    // axis titles + panel title
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.textAlign = 'right';
    g.fillText(negLog ? '−log10(p)' : 'p', p.x0 - 5, p.y0 - 8);
    g.textAlign = 'left';
    g.fillText(zh ? '染色体' : 'chromosome', p.x1 - 76, p.y1 + 27);
    g.font = this.uiFont(12, true);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.fillText(
      zh ? `曼哈顿图（${d.n} 位点）` : `Manhattan (${d.n} variants)`,
      region.x0 + padL,
      region.y0 + 15,
    );

    // top-N hit labels
    const topN = this.state.topN;
    if (topN > 0) {
      const items = topHitIndices(d, topN).map((i) => ({
        x: px(((offset[d.chrIdx[i]!]! + Math.min(d.pos[i]!, Math.max(chrMax[d.chrIdx[i]!]!, 1))) / Math.max(total, 1)) * plotW),
        y: negLog
          ? pyLog(-Math.log10(Math.max(d.p[i]!, 1e-300)))
          : pyLin(d.p[i]!),
        text: d.labels && d.labels[i] ? d.labels[i]! : `${d.chrNames[d.chrIdx[i]!]}:${Math.round(d.pos[i]!)}`,
      }));
      this.placeLabels(g, canvas, items);
    }
  }

  private drawQq(g: CanvasRenderingContext2D, region: Panel, d: GwasData): void {
    const zh = this.zh;
    const qq = qqPlotData(d);
    if (!qq) {
      g.font = this.uiFont(11);
      g.textAlign = 'center';
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.fillText(zh ? 'QQ 图需要至少 2 个位点' : 'QQ plot needs at least 2 variants', (region.x0 + region.x1) / 2, (region.y0 + region.y1) / 2);
      return;
    }
    const padL = 40;
    const padR = 12;
    const padT = 26;
    const padB = 30;
    const p: Panel = {
      x0: region.x0 + padL,
      y0: region.y0 + padT,
      x1: Math.max(region.x1 - padR, region.x0 + padL + 40),
      y1: Math.max(region.y1 - padB, region.y0 + padT + 40),
    };
    const plotW = p.x1 - p.x0;
    const plotH = p.y1 - p.y0;
    const n = qq.n;
    let maxY = 0;
    for (let i = 0; i < n; i += 1) if (qq.observed[i]! > maxY) maxY = qq.observed[i]!;
    const top = Math.max(qq.expected[n - 1]!, maxY) * 1.05 || 1;
    const px = (v: number) => p.x0 + (v / top) * plotW;
    const py = (v: number) => p.y1 - (v / top) * plotH;

    this.frame(g, p);

    // 95% confidence band (upper edge first, lower edge back)
    g.fillStyle = 'rgba(120,170,250,0.16)';
    g.beginPath();
    for (let i = 0; i < n; i += 1) {
      const x = px(qq.expected[i]!);
      const y = py(qq.bandHi[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    for (let i = n - 1; i >= 0; i -= 1) g.lineTo(px(qq.expected[i]!), py(qq.bandLo[i]!));
    g.closePath();
    g.fill();

    // diagonal reference
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(px(0), py(0));
    g.lineTo(px(top), py(top));
    g.stroke();
    g.setLineDash([]);

    // observed points
    g.strokeStyle = 'rgba(245,125,110,0.95)';
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i < n; i += 1) {
      const x = px(qq.expected[i]!);
      const y = py(qq.observed[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // axis ticks (single corner labels keep the small panel readable)
    g.font = this.uiFont(10);
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'right';
    g.fillText('0', p.x0 - 5, p.y1 + 3);
    g.fillText(top.toFixed(1), p.x0 - 5, p.y0 + 8);
    g.textAlign = 'left';
    g.fillText(`−log10(p)  max ${top.toFixed(1)}`, p.x0 + 4, p.y1 + 15);

    // lambda + panel title
    g.font = this.uiFont(12, true);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.fillText('QQ plot', region.x0 + 10, region.y0 + 15);
    g.font = this.uiFont(11);
    g.fillStyle = 'rgba(245,200,120,0.96)';
    g.fillText(`λ = ${fmtMetric(qq.lambda)}`, region.x1 - 92, region.y0 + 15);
    g.font = this.uiFont(10);
    g.fillStyle = 'rgba(200,214,232,0.9)';
    g.textAlign = 'right';
    g.fillText(zh ? '预期 −log10(p)' : 'expected −log10(p)', p.x1, p.y1 + 27);
    g.textAlign = 'left';
    g.fillText(zh ? '观测' : 'observed', p.x0 - 34, p.y0 - 8);
  }

  // ---- mode 2: Volcano ----------------------------------------------------

  private drawVolcano(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, v: VolcanoData): void {
    const zh = this.zh;
    const fc = this.state.fcThresh;
    const q = this.state.padjThresh;
    const s = volcanoSummary(v, fc, q);
    const padL = 48;
    const padR = 18;
    const padT = 28;
    const padB = 30;
    const p: Panel = {
      x0: padL,
      y0: padT,
      x1: canvas.width - padR,
      y1: canvas.height - padB,
    };
    const plotW = p.x1 - p.x0;
    const plotH = p.y1 - p.y0;
    const maxX = Math.max(s.maxAbsLog2fc * 1.08, fc * 1.4, 1);
    const maxY = Math.max(-Math.log10(Math.max(s.minPadj, 1e-300)) * 1.06, -Math.log10(q) + 1, 2);
    const px = (x: number) => p.x0 + plotW / 2 + (x / maxX) * (plotW / 2);
    const py = (y: number) => p.y1 - (y / maxY) * plotH;

    this.frame(g, p);

    // grid + ticks
    g.font = this.uiFont(10);
    const stepX = niceStep(maxX * 2);
    for (let t = -Math.ceil(maxX / stepX) * stepX; t <= maxX; t += stepX) {
      const x = px(t);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x, p.y0);
      g.lineTo(x, p.y1);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.textAlign = 'center';
      g.fillText(String(Number(t.toPrecision(3))), x, p.y1 + 14);
    }
    const stepY = niceStep(maxY);
    for (let t = 0; t <= maxY; t += stepY) {
      const y = py(t);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(p.x0, y);
      g.lineTo(p.x1, y);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.textAlign = 'right';
      g.fillText(String(Number(t.toPrecision(3))), p.x0 - 5, y + 3);
    }

    // threshold guides
    g.setLineDash([5, 4]);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(240,200,90,0.8)';
    for (const side of [-1, 1]) {
      const x = px(side * fc);
      g.beginPath();
      g.moveTo(x, p.y0);
      g.lineTo(x, p.y1);
      g.stroke();
    }
    g.strokeStyle = 'rgba(240,110,110,0.8)';
    g.beginPath();
    g.moveTo(p.x0, py(-Math.log10(q)));
    g.lineTo(p.x1, py(-Math.log10(q)));
    g.stroke();
    g.setLineDash([]);

    // points
    const upCol = 'rgba(235,90,90,0.88)';
    const downCol = 'rgba(90,150,240,0.88)';
    const nsCol = 'rgba(150,162,182,0.5)';
    for (let i = 0; i < v.n; i += 1) {
      const pv = v.padj[i]!;
      const lfc = v.log2fc[i]!;
      const sig = pv <= q;
      g.fillStyle = sig && lfc >= fc ? upCol : sig && lfc <= -fc ? downCol : nsCol;
      g.fillRect(px(lfc) - 1, py(-Math.log10(Math.max(pv, 1e-300))) - 1, 2, 2);
    }

    // axis titles + title
    g.font = this.uiFont(10);
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.textAlign = 'right';
    g.fillText('−log10(padj)', p.x0 - 5, p.y0 - 8);
    g.textAlign = 'left';
    g.fillText(zh ? 'log2 倍数变化' : 'log2 fold change', p.x1 - 130, p.y1 + 26);
    g.font = this.uiFont(13, true);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.fillText(
      zh
        ? `火山图：上调 ${s.up} · 下调 ${s.down} · 不显著 ${s.ns}（|log2FC|≥${fc}，padj≤${q}）`
        : `Volcano: ${s.up} up · ${s.down} down · ${s.ns} ns (|log2FC|>=${fc}, padj<=${q})`,
      canvas.width / 2,
      17,
    );

    // top-N labels (significant first)
    const topN = this.state.topN;
    if (topN > 0) {
      const cand = topVolcanoIndices(v, topN * 3);
      const isSig = (i: number) => v.padj[i]! <= q && Math.abs(v.log2fc[i]!) >= fc;
      const pick = cand.filter(isSig).slice(0, topN);
      if (pick.length < topN) {
        for (const i of cand) {
          if (pick.length >= topN) break;
          if (!pick.includes(i)) pick.push(i);
        }
      }
      const items = pick.map((i) => ({
        x: px(v.log2fc[i]!),
        y: py(-Math.log10(Math.max(v.padj[i]!, 1e-300))),
        text: v.gene[i]!,
      }));
      this.placeLabels(g, canvas, items);
    }

    this.footer(
      g,
      canvas,
      zh
        ? `${s.total} 个基因 · 最小 padj ${fmtMetric(s.minPadj)} · 最大 |log2FC| ${fmtMetric(s.maxAbsLog2fc)} · 红/蓝为双阈值显著`
        : `${s.total} genes · min padj ${fmtMetric(s.minPadj)} · max |log2FC| ${fmtMetric(s.maxAbsLog2fc)} · red/blue pass both cutoffs`,
    );
  }

  // ---- mode 3: LD heatmap -------------------------------------------------

  private drawLd(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, d: LdData): void {
    const zh = this.zh;
    const n = d.n;
    const s = ldSummary(d);
    const block = maxLdBlock(d, 0.5);
    const padL = 56;
    const padT = 34;
    const padB = 34;
    const padR = 96;
    const size = Math.min(canvas.height - padT - padB, canvas.width - padL - padR);
    if (size < 40) {
      g.font = this.uiFont(11);
      g.textAlign = 'center';
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.fillText(zh ? '画布过小，无法绘制 LD 热图' : 'Canvas too small for the LD heatmap', canvas.width / 2, canvas.height / 2);
      return;
    }
    const lx = padL;
    const ly = padT;
    const cell = size / n;

    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        g.fillStyle = ldColor(d.r2[i * n + j]!);
        g.fillRect(lx + j * cell, ly + i * cell, cell + 0.5, cell + 0.5);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 1;
    g.strokeRect(lx, ly, size, size);

    // locus labels every k-th, rotated on top / plain on the left
    const k = Math.max(1, Math.ceil(n / 10));
    g.font = this.uiFont(9);
    g.fillStyle = 'rgba(190,204,224,0.95)';
    for (let i = 0; i < n; i += k) {
      const c = lx + (i + 0.5) * cell;
      g.save();
      g.translate(c, ly - 5);
      g.rotate(-Math.PI / 4);
      g.textAlign = 'left';
      g.fillText(d.ids[i]!, 0, 0);
      g.restore();
      g.textAlign = 'right';
      g.fillText(d.ids[i]!, lx - 6, ly + (i + 0.5) * cell + 3);
    }

    // largest high-LD block outline
    if (block && block.size >= 2) {
      g.setLineDash([4, 3]);
      g.strokeStyle = 'rgba(120,230,230,0.95)';
      g.lineWidth = 1.4;
      g.strokeRect(
        lx + block.start * cell,
        ly + block.start * cell,
        (block.end - block.start) * cell,
        (block.end - block.start) * cell,
      );
      g.setLineDash([]);
      g.font = this.uiFont(9);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(120,230,230,0.95)';
      g.fillText(
        zh ? `最大 LD 区块（${block.size} 位点）` : `max block (${block.size} loci)`,
        lx + block.start * cell,
        Math.min(ly + block.end * cell + 11, ly + size + 44),
      );
    }

    // colour bar
    const cbX = lx + size + 18;
    const cbW = 14;
    const steps = 96;
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      g.fillStyle = ldColor(t);
      const y = ly + (1 - t) * (size - size / steps);
      g.fillRect(cbX, y, cbW, size / steps + 0.6);
    }
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.strokeRect(cbX, ly, cbW, size);
    g.font = this.uiFont(9);
    g.fillStyle = 'rgba(190,204,224,0.95)';
    g.textAlign = 'left';
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      g.fillText(t.toFixed(2), cbX + cbW + 4, ly + (1 - t) * size + 3);
    }

    g.font = this.uiFont(13, true);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.fillText(
      zh ? `连锁不平衡热图（r²，${n} 个位点）` : `LD heatmap (r², ${n} loci)`,
      14,
      19,
    );
    this.footer(
      g,
      canvas,
      zh
        ? `最大 r² ${fmtMetric(s.maxR2)}（${d.ids[s.maxI]}–${d.ids[s.maxJ]}） · 平均 r² ${fmtMetric(s.meanR2)} · r²≥0.5 连续区块 ${block ? `${block.start + 1}-${block.end}` : '—'}`
        : `max r2 ${fmtMetric(s.maxR2)} (${d.ids[s.maxI]}-${d.ids[s.maxJ]}) · mean r2 ${fmtMetric(s.meanR2)} · r2>=0.5 block ${block ? `${block.start + 1}-${block.end}` : '—'}`,
    );
  }

  // ---- mode 4: GSEA -------------------------------------------------------

  private drawGsea(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ranked: RankedList): void {
    const zh = this.zh;
    const res = this.gseaResult();
    if (!res) {
      g.font = this.uiFont(12);
      g.textAlign = 'center';
      g.fillStyle = 'rgba(230,238,248,0.95)';
      g.fillText(zh ? '基因集与排序列表无交集' : 'Gene set does not overlap the ranked list', canvas.width / 2, canvas.height / 2 - 8);
      g.font = this.uiFont(11);
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.fillText(
        zh ? '请在参数面板输入以逗号/空格分隔的基因名' : 'Enter gene names separated by commas or spaces in the parameter panel',
        canvas.width / 2,
        canvas.height / 2 + 14,
      );
      return;
    }
    const padL = 52;
    const padR = 18;
    const padT = 30;
    const padB = 48;
    const p: Panel = {
      x0: padL,
      y0: padT,
      x1: canvas.width - padR,
      y1: canvas.height - padB,
    };
    const plotW = p.x1 - p.x0;
    const plotH = p.y1 - p.y0;
    const n = ranked.n;
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i += 1) {
      const v = res.runningEs[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = Math.max(hi - lo, 1e-6);
    lo -= span * 0.08;
    hi += span * 0.08;
    const px = (i: number) => p.x0 + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const py = (v: number) => p.y1 - ((v - lo) / (hi - lo)) * plotH;

    this.frame(g, p);

    // gridlines
    g.font = this.uiFont(10);
    const step = niceStep(hi - lo);
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
      const y = py(t);
      g.strokeStyle = Math.abs(t) < step * 0.01 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(p.x0, y);
      g.lineTo(p.x1, y);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.textAlign = 'right';
      g.fillText(Number(t.toPrecision(3)).toString(), p.x0 - 5, y + 3);
    }

    // running-ES curve
    g.strokeStyle = 'rgba(90,180,250,0.95)';
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i < n; i += 1) {
      const x = px(i);
      const y = py(res.runningEs[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // ES line
    const esY = py(res.es);
    g.setLineDash([5, 4]);
    g.strokeStyle = 'rgba(240,120,120,0.9)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(p.x0, esY);
    g.lineTo(p.x1, esY);
    g.stroke();
    g.setLineDash([]);
    g.font = this.uiFont(10);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(240,150,150,0.96)';
    g.fillText(`ES = ${fmtMetric(res.es)}`, p.x0 + 6, esY - 4);

    // hit rug under the axis
    g.fillStyle = 'rgba(95,225,180,0.95)';
    for (const i of res.hits) g.fillRect(px(i), p.y1 + 5, 1.4, 9);

    // x ticks: rank positions
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'center';
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const i = Math.round(f * (n - 1));
      g.fillText(String(i + 1), px(i), p.y1 + 30);
    }
    g.textAlign = 'right';
    g.fillText(zh ? '基因排序（rank）' : 'gene rank', p.x1, p.y1 + 42);
    g.textAlign = 'right';
    g.fillText(zh ? '运行 ES' : 'running ES', p.x0 - 5, p.y0 - 9);

    // title + set info
    const setName = this.state.geneSetText.trim()
      ? (this.state.geneSetText.trim().length > 36 ? `${this.state.geneSetText.trim().slice(0, 36)}…` : this.state.geneSetText.trim())
      : zh
        ? '内置示例集（前四分之一隔位取样）'
        : 'built-in demo set (every other gene in top quarter)';
    g.font = this.uiFont(13, true);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.fillText(
      zh ? `GSEA：${setName}（${res.setSize}/${n} 命中）` : `GSEA: ${setName} (${res.setSize}/${n} hits)`,
      14,
      19,
    );

    this.footer(
      g,
      canvas,
      zh
        ? `ES ${fmtMetric(res.es)} · NES ${fmtMetric(res.nes)} · 名义 p ${fmtMetric(res.nominalP)} · FDR q ${fmtMetric(res.qValue)} · 置换 ${res.permutations} 次 · 种子 ${GSEA_DEFAULT_SEED}`
        : `ES ${fmtMetric(res.es)} · NES ${fmtMetric(res.nes)} · nominal p ${fmtMetric(res.nominalP)} · FDR q ${fmtMetric(res.qValue)} · ${res.permutations} permutations · seed ${GSEA_DEFAULT_SEED}`,
    );
  }

  // ---- mode 5: Circos -----------------------------------------------------

  private drawCircos(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, d: CircosData): void {
    const zh = this.zh;
    const s = circosSummary(d);
    const cx = canvas.width / 2 - 30;
    const cy = canvas.height / 2 + 4;
    const R = Math.min(canvas.width, canvas.height) / 2 - 34;
    if (R < 50) {
      g.font = this.uiFont(11);
      g.textAlign = 'center';
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.fillText(zh ? '画布过小，无法绘制 Circos 图' : 'Canvas too small for the Circos map', canvas.width / 2, canvas.height / 2);
      return;
    }
    const midR = R - 9;
    const names = Object.keys(d.lengths).sort(compareChr);
    const totalLen = names.reduce((acc, k) => acc + Math.max(d.lengths[k]!, 1), 0);
    const gap = 0.02;
    const usable = Math.max(2 * Math.PI - gap * names.length, 0.1);
    const starts: number[] = [];
    const spans: number[] = [];
    let ang = -Math.PI / 2 + gap / 2;
    for (const name of names) {
      const span = (Math.max(d.lengths[name]!, 1) / totalLen) * usable;
      starts.push(ang);
      spans.push(span);
      ang += span + gap;
    }
    const slot = new Map<string, number>();
    names.forEach((name, i) => slot.set(name, i));
    const angleAt = (chr: string, pos: number): number => {
      const i = slot.get(chr) ?? 0;
      const len = Math.max(d.lengths[chr] ?? 1, 1);
      const frac = Math.min(Math.max(pos / len, 0), 1);
      return starts[i]! + frac * spans[i]!;
    };
    const at = (a: number, r: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];

    // chords first (under the ring)
    g.lineCap = 'round';
    for (const e of d.events) {
      const [x1, y1] = at(angleAt(e.chrA, e.posA), midR);
      const [x2, y2] = at(angleAt(e.chrB, e.posB), midR);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const qx = cx + (mx - cx) * 0.35;
      const qy = cy + (my - cy) * 0.35;
      g.strokeStyle = typeColor(e.type);
      g.globalAlpha = 0.55;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x1, y1);
      g.quadraticCurveTo(qx, qy, x2, y2);
      g.stroke();
    }
    g.globalAlpha = 1;

    // chromosome ring
    for (let i = 0; i < names.length; i += 1) {
      g.beginPath();
      g.arc(cx, cy, midR, starts[i]!, starts[i]! + spans[i]!);
      g.strokeStyle = (i & 1) === 0 ? CHR_A : CHR_B;
      g.lineWidth = 16;
      g.stroke();
      // label outside at the arc midpoint
      const mid = starts[i]! + spans[i]! / 2;
      const [lx, ly] = at(mid, R + 13);
      g.font = this.uiFont(10);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(215,226,242,0.96)';
      g.fillText(names[i]!, lx, ly);
      g.textBaseline = 'alphabetic';
    }

    // legend (known types, first 8)
    const types = s.byType ? Object.keys(s.byType).sort((a, b) => (s.byType[b] ?? 0) - (s.byType[a] ?? 0)) : [];
    const shown = types.slice(0, 8);
    let ly = 40;
    g.font = this.uiFont(10);
    g.textAlign = 'left';
    for (const t of shown) {
      g.fillStyle = typeColor(t);
      g.fillRect(canvas.width - 138, ly - 8, 12, 8);
      g.fillStyle = 'rgba(210,222,238,0.96)';
      const label = `${t}${s.byType ? ` ×${s.byType[t]}` : ''}`;
      g.fillText(label.length > 22 ? `${label.slice(0, 22)}…` : label, canvas.width - 122, ly);
      ly += 15;
    }
    if (types.length > shown.length) {
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(`+${types.length - shown.length}`, canvas.width - 138, ly);
    }

    g.font = this.uiFont(13, true);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.fillText(
      zh ? `Circos 重排图：${s.total} 个事件，涉及 ${s.chromosomes} 条染色体` : `Circos rearrangements: ${s.total} events across ${s.chromosomes} chromosomes`,
      14,
      19,
    );
    this.footer(
      g,
      canvas,
      zh
        ? `跨染色体 ${s.crossChromosome} / ${s.total} · 弦按类型着色 · 外圈弧长按各染色体最大锚点位置比例绘制`
        : `cross-chromosome ${s.crossChromosome} / ${s.total} · chords coloured by type · ring arcs scaled by each chromosome's largest anchor`,
    );
  }
}

export default function createMedGenomicsPlugin(): Plugin {
  return new MedGenomicsPlugin();
}
