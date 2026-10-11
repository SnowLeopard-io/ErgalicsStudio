// ==========================================================================
// stats-zipf — Zipf's-law word-frequency analyser
//
// Main frame: log(rank)–log(freq) scatter of the ranked vocabulary with the
// OLS fit line f = a·r^-s; bottom strip: per-rank fit residuals. Loads raw
// text (English word or CJK character tokenization) or a pre-computed
// "word,count" table, and ships the public-domain opening of Jane Austen's
// Emma (Project Gutenberg #158) as a real-corpus sample. All fits are exact
// closed-form OLS — deterministic, no randomness outside the demo corpus.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { statsZipfManifest } from './manifest';
import {
  analyzeZipf,
  fitZipf,
  parseFrequencyPairs,
  parseZipfUpload,
  rankByFrequency,
  runZipfBenchmark,
  synthZipfText,
  type TokenizerMode,
  type ZipfAnalysis,
} from './kernel';

export { statsZipfManifest } from './manifest';

interface State {
  mode: TokenizerMode;
  dropTop: number;
  fitEnd: number; // 0 = auto (all ranks)
  seed: number;
  text: string | null;
  pairs: boolean;
  source: 'user' | 'demo' | null;
  analysis: ZipfAnalysis | null;
}

export class StatsZipfPlugin implements Plugin {
  readonly manifest = statsZipfManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    mode: 'english',
    dropTop: 0,
    fitEnd: 0,
    seed: 20261011,
    text: null,
    pairs: false,
    source: null,
    analysis: null,
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
    const zh = this.zh;
    return [
      {
        key: 'mode',
        label: 'Language / tokenizer',
        labelI18n: { 'zh-CN': '语言 / 分词方式', 'en-US': 'Language / tokenizer' },
        type: 'select',
        options: [
          {
            value: 'english',
            label: zh ? '英文（按词）' : 'English (words)',
            labelI18n: { 'zh-CN': '英文（按词）', 'en-US': 'English (words)' },
          },
          {
            value: 'cjk',
            label: zh ? '中文（按字）' : 'CJK (characters)',
            labelI18n: { 'zh-CN': '中文（按字）', 'en-US': 'CJK (characters)' },
          },
        ],
        value: this.state.mode,
      },
      {
        key: 'dropTop',
        label: 'Drop top-N headwords',
        labelI18n: { 'zh-CN': '剔除前 N 个高频词', 'en-US': 'Drop top-N headwords' },
        type: 'range',
        min: 0,
        max: 50,
        step: 1,
        value: this.state.dropTop,
        hint: zh ? '仅影响拟合，不影响词表' : 'affects the fit only, not the vocabulary',
      },
      {
        key: 'fitEnd',
        label: 'Fit window last rank (0 = all)',
        labelI18n: { 'zh-CN': '拟合终止秩（0 = 全部）', 'en-US': 'Fit window last rank (0 = all)' },
        type: 'range',
        min: 0,
        max: 5000,
        step: 10,
        value: this.state.fitEnd,
      },
      {
        key: 'seed',
        label: 'Demo seed',
        labelI18n: { 'zh-CN': '演示种子', 'en-US': 'Demo seed' },
        type: 'number',
        min: 0,
        max: 4294967295,
        step: 1,
        value: this.state.seed,
      },
      actionButton('demo', 'Demo · synthetic Zipf(s=1)', '演示 · 合成 Zipf(s=1)'),
      actionButton('benchmark', 'Run Zipf benchmark', '运行 Zipf 基准验证'),
      actionButton('exportCsv', 'Export ranked frequencies', '导出词频排名 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let refit = false;
    if (typeof params.mode === 'string' && (params.mode === 'english' || params.mode === 'cjk')) {
      if (params.mode !== this.state.mode) {
        this.state.mode = params.mode;
        refit = true;
      }
    }
    if (typeof params.dropTop === 'number' && Number.isFinite(params.dropTop)) {
      const v = Math.min(50, Math.max(0, Math.round(params.dropTop)));
      if (v !== this.state.dropTop) {
        this.state.dropTop = v;
        refit = true;
      }
    }
    if (typeof params.fitEnd === 'number' && Number.isFinite(params.fitEnd)) {
      const v = Math.min(5000, Math.max(0, Math.round(params.fitEnd / 10) * 10));
      if (v !== this.state.fitEnd) {
        this.state.fitEnd = v;
        refit = true;
      }
    }
    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      this.state.seed = Math.min(4294967295, Math.max(0, Math.round(params.seed)));
    }
    if (refit) {
      this.analyze(false);
    }

    if (actionFired(params, 'demo')) this.loadDemo();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.txt') && !low.endsWith('.csv') && !low.endsWith('.tsv')) {
      notify(
        this.api,
        'warning',
        'Zipf plugin accepts TXT/CSV/TSV corpora.',
        'Zipf 插件接受 TXT/CSV/TSV 语料。',
      );
      return;
    }
    const text = await file.text();
    const parsed = parseZipfUpload(text);
    this.state.text = parsed.content;
    this.state.pairs = parsed.kind === 'pairs';
    this.state.source = 'user';
    const ok = this.analyze(true);
    if (ok) {
      const a = this.state.analysis;
      notify(
        this.api,
        'success',
        `Loaded ${a ? a.tokens : 0} tokens, vocabulary ${a ? a.vocab : 0}.`,
        `已载入 ${a ? a.tokens : 0} 个词元，词表量 ${a ? a.vocab : 0}。`,
      );
    }
  }

  /** Deterministic synthetic Zipf(s=1) corpus. */
  private loadDemo() {
    this.state.text = synthZipfText(2000, 1.0, 60000, this.state.seed);
    this.state.pairs = false;
    this.state.source = 'demo';
    this.analyze(true);
    notify(
      this.api,
      'success',
      `Synthetic Zipf(s=1) corpus generated (seed=${this.state.seed}).`,
      `已生成合成 Zipf(s=1) 语料（种子=${this.state.seed}）。`,
    );
  }

  /** Re-run tokenize + rank + fit on the current inputs. Returns success. */
  private analyze(explicit: boolean): boolean {
    if (this.state.text === null) {
      this.state.analysis = null;
      clearScienceOutputs(this.manifest.id);
      this.draw();
      return false;
    }
    const opts = { dropTop: this.state.dropTop, fitEnd: this.state.fitEnd };
    if (this.state.pairs) {
      const counts = parseFrequencyPairs(this.state.text);
      if (!counts) {
        this.state.analysis = null;
        clearScienceOutputs(this.manifest.id);
        this.draw();
        if (explicit) {
          notify(this.api, 'warning', 'Could not parse the word,count table.', '无法解析 word,count 词频表。');
        }
        return false;
      }
      const ranked = rankByFrequency(counts);
      const fit = fitZipf(ranked, opts);
      this.state.analysis = {
        mode: this.state.mode,
        tokens: [...counts.values()].reduce((a, v) => a + v, 0),
        vocab: counts.size,
        ranked,
        fit,
        dropTop: opts.dropTop,
      };
    } else {
      this.state.analysis = analyzeZipf(this.state.text, this.state.mode, opts);
    }
    this.publishOutputs();
    this.draw();
    return true;
  }

  /** Publish s ± sigma, R², vocabulary size and the s=1 comparison. */
  private publishOutputs() {
    const a = this.state.analysis;
    if (!a || !a.fit) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const zh = this.zh;
    const fit = a.fit;
    const provenance =
      this.state.source === 'demo'
        ? zh
          ? '来源：内置合成语料（固定种子，s=1）'
          : 'source: built-in synthetic corpus (fixed seed, s=1)'
        : zh
          ? '来源：用户语料'
          : 'source: user corpus';
    const top = a.ranked.slice(0, 3).map((w) => `${w.word}:${w.count}`).join(', ');
    const metrics: ScienceMetric[] = [
      {
        key: 'zipf-s',
        label: 'Zipf s ± σ',
        value: `${fmtMetric(fit.s)} ± ${fmtMetric(fit.sigma)}`,
        severity: 'ok',
        hint: `${provenance} · ${zh ? 'OLS：log f = log a − s·log r，拟合窗口 r ∈ [' + fit.rankStart + ', ' + fit.rankEnd + ']' : 'OLS on log f = log a - s log r, window r in [' + fit.rankStart + ', ' + fit.rankEnd + ']'}`,
      },
      {
        key: 'zipf-r2',
        label: 'R²',
        value: fmtMetric(fit.r2),
        severity: fit.r2 >= 0.95 ? 'ok' : fit.r2 >= 0.8 ? 'info' : 'warn',
        hint: provenance,
      },
      {
        key: 'zipf-ideal',
        label: zh ? '对 s=1 偏差' : 'Deviation from s=1',
        value: fmtMetric((Math.abs(fit.s - 1) / 1) * 100),
        unit: '%',
        severity: Math.abs(fit.s - 1) < 0.1 ? 'ok' : 'info',
        hint: zh
          ? '相对误差 |s−1|/1；自然语言通常 0.9–1.2'
          : 'relative error |s-1|/1; natural language typically 0.9-1.2',
      },
      {
        key: 'zipf-vocab',
        label: zh ? '词表量 / 词元' : 'Vocabulary / tokens',
        value: `${a.vocab} / ${a.tokens}`,
        severity: 'info',
        hint: zh ? `前 3 高频：${top}` : `top 3: ${top}`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Embedded benchmark: synthetic exact-Zipf corpus → s recovery. */
  private runBenchmark() {
    const b = runZipfBenchmark(this.state.seed);
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-s',
        label: zh ? '基准① 回收 s' : 'Bench ① recovered s',
        value: fmtMetric(b.recoveredS),
        severity: b.pass ? 'ok' : 'warn',
        hint: zh
          ? `按 p(r) ∝ r^-1.0 精确合成（V=2000，${b.tokens} 词元，固定种子 ${b.seed}），阈值 |s−1|/1 < 5%`
          : `exact p(r) ∝ r^-1.0 draw (V=2000, ${b.tokens} tokens, seed ${b.seed}); threshold |s-1|/1 < 5%`,
      },
      {
        key: 'bench-s-err',
        label: zh ? '基准① 相对误差' : 'Bench ① rel. error',
        value: fmtMetric(b.relErrS * 100),
        unit: '%',
        severity: b.pass ? 'ok' : 'warn',
        hint: provenanceHint(zh),
      },
      {
        key: 'bench-r2',
        label: 'R² (bench)',
        value: fmtMetric(b.r2),
        severity: 'info',
        hint: zh ? '合成语料在 log-log 下近乎完全线性' : 'the synthetic corpus is near-perfectly log-linear',
      },
      {
        key: 'bench-micro',
        label: zh ? '基准②/③' : 'Bench ②/③',
        value: zh ? '单元测试覆盖' : 'covered by unit tests',
        severity: 'info',
        hint: zh
          ? '微型文本手工词频与 OLS 闭式对照在 vitest 中验证（误差 < 1e-9）'
          : 'micro-text counts and closed-form OLS cross-checks verified in vitest (< 1e-9)',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.pass ? 'success' : 'warning',
      `Zipf benchmark: recovered s=${b.recoveredS.toFixed(4)} from exact s=1 draw (err ${(b.relErrS * 100).toFixed(2)}%).`,
      `Zipf 基准：从精确 s=1 合成语料回收 s=${b.recoveredS.toFixed(4)}（误差 ${(b.relErrS * 100).toFixed(2)}%）。`,
    );
  }

  /** Ranked frequency table with log coordinates and fit residuals. */
  private exportCsv() {
    const a = this.state.analysis;
    if (!a) {
      notify(this.api, 'warning', 'Load or generate a corpus first.', '请先载入或生成语料。');
      return;
    }
    const fit = a.fit;
    const rows: Array<Array<number | string>> = a.ranked.map((w, i) => {
      const rank = i + 1;
      const inWindow = fit !== null && rank >= fit.rankStart && rank <= fit.rankEnd;
      const k = inWindow && fit ? rank - fit.rankStart : -1;
      const residual = fit && k >= 0 ? (fit.residuals[k] ?? 0) : '';
      return [
        rank,
        w.word,
        w.count,
        Number(Math.log(rank).toFixed(6)),
        Number(Math.log(w.count).toFixed(6)),
        typeof residual === 'number' ? Number(residual.toFixed(6)) : '',
      ];
    });
    exportRowsCsv(
      this.api,
      'stats-zipf-frequencies',
      ['rank', 'word', 'count', 'log_rank', 'log_count', 'fit_residual'],
      rows,
    );
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const a = this.state.analysis;
    if (!a || !a.fit) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: this.zh ? '尚未载入语料' : 'No corpus loaded',
        hint: this.zh
          ? '通过「示例数据」载入《Emma》公版文本或自备 TXT/CSV，或点「演示 · 合成 Zipf(s=1)」。'
          : "Load the Emma public-domain sample or your own TXT/CSV, or press Demo · synthetic Zipf(s=1).",
      });
      return;
    }
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    this.drawLogLog(g, canvas, a);
    this.drawResiduals(g, canvas, a);
    this.drawFooter(g, canvas, a);
  }

  /** Main log-log scatter + fit line. */
  private drawLogLog(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, a: ZipfAnalysis) {
    const fit = a.fit!;
    const padL = 56;
    const padR = 18;
    const y0 = 40;
    const y1 = canvas.height - 118;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    const vocab = Math.max(a.vocab, 2);
    const maxCount = Math.max(a.ranked[0]?.count ?? 1, 2);
    const xMax = Math.log(vocab);
    const yMax = Math.log(maxCount);
    const px = (rank: number) => x0 + (plotW * Math.log(rank)) / xMax;
    const py = (count: number) => y1 - (plotH * Math.log(count)) / yMax;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = "13px 'Microsoft YaHei', Consolas, monospace";
    const title = this.zh
      ? `词频–秩 双对数图（${a.mode === 'cjk' ? '按字' : '按词'}，词表 ${a.vocab}）`
      : `Frequency vs rank, log-log (${a.mode === 'cjk' ? 'chars' : 'words'}, vocab ${a.vocab})`;
    g.fillText(title, canvas.width / 2, 20);

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // log ticks on both axes
    g.font = '10px Consolas, monospace';
    const countTicks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].filter(
      (c) => c <= maxCount,
    );
    g.textAlign = 'right';
    for (const c of countTicks) {
      const y = py(c);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(String(c), x0 - 6, y + 3);
    }
    const rankTicks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].filter((r) => r <= vocab);
    g.textAlign = 'center';
    for (const r of rankTicks) {
      const x = px(r);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x, y1);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(String(r), x, y1 + 14);
    }

    // scatter (stride so huge vocabularies stay snappy)
    const stride = a.vocab > 4000 ? Math.ceil(a.vocab / 4000) : 1;
    g.fillStyle = 'rgba(130,180,250,0.75)';
    for (let i = 0; i < a.ranked.length; i += stride) {
      const entry = a.ranked[i];
      if (!entry || entry.count <= 0) continue;
      g.fillRect(px(i + 1) - 1.2, py(entry.count) - 1.2, 2.4, 2.4);
    }

    // fit line across the fitted window
    g.strokeStyle = 'rgba(250,200,110,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px(fit.rankStart), py(Math.exp(fit.fittedLogCounts[0] ?? Math.log(fit.a))));
    g.lineTo(px(fit.rankEnd), py(Math.exp(fit.fittedLogCounts[fit.fittedLogCounts.length - 1] ?? Math.log(fit.a))));
    g.stroke();
    g.lineWidth = 1;

    // legend
    g.textAlign = 'left';
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    let ly = y0 + 14;
    const legend: Array<[string, string]> = [
      ['rgba(130,180,250,0.85)', this.zh ? '词频观测' : 'observed frequencies'],
      ['rgba(250,200,110,0.95)', this.zh ? `OLS 拟合 s=${fit.s.toFixed(3)}±${fit.sigma.toFixed(3)}` : `OLS fit s=${fit.s.toFixed(3)}±${fit.sigma.toFixed(3)}`],
    ];
    for (const [c, label] of legend) {
      g.fillStyle = c;
      g.fillRect(x1 - 200, ly, 16, 4);
      g.fillStyle = 'rgba(200,214,232,0.95)';
      g.fillText(label, x1 - 178, ly + 6);
      ly += 15;
    }
    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText('log f(r)', x0 - 6, y0 - 8);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('log r', x1 - 30, y1 + 26);
  }

  /** Residual strip under the main plot. */
  private drawResiduals(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, a: ZipfAnalysis) {
    const fit = a.fit;
    if (!fit || fit.residuals.length < 2) return;
    const padL = 56;
    const y0 = canvas.height - 96;
    const y1 = canvas.height - 46;
    const x0 = padL;
    const x1 = canvas.width - 18;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    let rMax = 1e-9;
    for (const r of fit.residuals) rMax = Math.max(rMax, Math.abs(r));
    const px = (rank: number) => x0 + (plotW * Math.log(rank)) / Math.max(Math.log(a.vocab), 1e-9);
    const py = (res: number) => (y0 + y1) / 2 - (plotH * 0.45 * res) / rMax;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(x0, (y0 + y1) / 2);
    g.lineTo(x1, (y0 + y1) / 2);
    g.stroke();

    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = "10px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(
      this.zh
        ? `拟合残差 log f − ŷ（窗口 r=${fit.rankStart}–${fit.rankEnd}，R²=${fit.r2.toFixed(4)}）`
        : `fit residuals log f - fitted (window r=${fit.rankStart}-${fit.rankEnd}, R^2=${fit.r2.toFixed(4)})`,
      x0,
      y0 - 4,
    );

    g.fillStyle = 'rgba(150,220,200,0.85)';
    for (let k = 0; k < fit.residuals.length; k += 1) {
      const rank = fit.fittedRanks[k] ?? fit.rankStart + k;
      const res = fit.residuals[k] ?? 0;
      g.fillRect(px(rank) - 0.8, py(res), 1.6, Math.max(1, Math.abs((y0 + y1) / 2 - py(res))));
    }
    g.textAlign = 'right';
    g.fillText(`±${rMax.toFixed(3)}`, x0 - 6, y0 + 8);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, a: ZipfAnalysis) {
    const fit = a.fit;
    if (!fit) return;
    g.textAlign = 'left';
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const top = a.ranked.slice(0, 5).map((w) => w.word).join(' ');
    const l1 = this.zh
      ? `词元 ${a.tokens} · 词表 ${a.vocab} · 前 5 高频：${top}`
      : `tokens ${a.tokens} · vocab ${a.vocab} · top 5: ${top}`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = this.zh
      ? `f = a·r^-s：a=${fmtMetric(fit.a)}，s=${fit.s.toFixed(4)}±${fit.sigma.toFixed(4)}，R²=${fit.r2.toFixed(4)}（理想 Zipf s=1，Zipf 1949）`
      : `f = a*r^-s: a=${fmtMetric(fit.a)}, s=${fit.s.toFixed(4)}±${fit.sigma.toFixed(4)}, R^2=${fit.r2.toFixed(4)} (ideal Zipf s=1, Zipf 1949)`;
    g.fillText(l2, 54, canvas.height - 14);
  }
}

function provenanceHint(zh: boolean): string {
  return zh
    ? '统一相对误差口径 |计算−解析|/|解析|'
    : 'uniform relative-error convention |computed - analytic| / |analytic|';
}

export default function createStatsZipfPlugin(): Plugin {
  return new StatsZipfPlugin();
}
