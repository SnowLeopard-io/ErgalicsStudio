// ==========================================================================
// bio-seqalign — sequence analysis + pairwise alignment workbench (2-D)
//
// Two views of the same data, switched via a param toggle:
//   · "alignment" — the Needleman-Wunsch / Smith-Waterman result rendered as
//     monospace aligned rows with a metric strip (score, identity, gaps).
//   · "gc"        — a sliding-window GC profile of each input, useful for
//     spotting GC-content or isochore structure at a glance.
// Accepts FASTA (first two sequences) and exports the alignment as CSV.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportCanvasPng, exportRowsCsv, notify } from '../shared/enhance';
import { bioSeqalignManifest } from './manifest';
import {
  alignGlobal,
  alignLocal,
  baseStats,
  gcWindow,
  makeMatrix,
  parseBareSequences,
  parseFasta,
  parseSequenceJson,
  parseSequenceTable,
  type AlignResult,
  type MatrixName,
  type SeqEntry,
} from './align';

export { bioSeqalignManifest } from './manifest';

type View = 'alignment' | 'gc';

interface State {
  seqA: string;
  seqB: string;
  matrix: MatrixName;
  mode: 'global' | 'local';
  gapOpen: number;
  gapExtend: number;
  window: number;
  view: View;
}

export class BioSeqalignPlugin implements Plugin {
  readonly manifest = bioSeqalignManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private hasData = false;
  private state: State = {
    seqA: '',
    seqB: '',
    matrix: 'NUC.4.4',
    mode: 'global',
    gapOpen: -10,
    gapExtend: -0.5,
    window: 10,
    view: 'alignment',
  };
  private result: AlignResult | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
    this.run();
  }

  async destroy() {
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.run();
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'seqA',
        label: 'Sequence A',
        labelI18n: { 'zh-CN': '序列 A', 'en-US': 'Sequence A' },
        type: 'text',
        value: this.state.seqA,
        hint: this.zh ? '核苷酸或蛋白质序列（≤120 bp 为宜）' : 'nucleotide or protein sequence',
      },
      {
        key: 'seqB',
        label: 'Sequence B',
        labelI18n: { 'zh-CN': '序列 B', 'en-US': 'Sequence B' },
        type: 'text',
        value: this.state.seqB,
      },
      {
        key: 'matrix',
        label: 'Matrix',
        labelI18n: { 'zh-CN': '打分矩阵', 'en-US': 'Matrix' },
        type: 'select',
        options: [
          { value: 'BLOSUM62', label: 'BLOSUM62', labelI18n: { 'zh-CN': 'BLOSUM62（蛋白质）', 'en-US': 'BLOSUM62' } },
          { value: 'NUC.4.4', label: 'NUC.4.4', labelI18n: { 'zh-CN': 'NUC.4.4（核酸）', 'en-US': 'NUC.4.4 (DNA)' } },
        ],
        value: this.state.matrix,
      },
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '比对方式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'global', label: 'Global', labelI18n: { 'zh-CN': '全局（Needleman-Wunsch）', 'en-US': 'Global (NW)' } },
          { value: 'local', label: 'Local', labelI18n: { 'zh-CN': '局部（Smith-Waterman）', 'en-US': 'Local (SW)' } },
        ],
        value: this.state.mode,
      },
      {
        key: 'gapOpen',
        label: 'Gap open',
        labelI18n: { 'zh-CN': '空位开放罚分', 'en-US': 'Gap open' },
        type: 'range',
        min: -20,
        max: -1,
        step: 0.5,
        value: this.state.gapOpen,
      },
      {
        key: 'gapExtend',
        label: 'Gap extend',
        labelI18n: { 'zh-CN': '空位延伸罚分', 'en-US': 'Gap extend' },
        type: 'range',
        min: -4,
        max: -0.1,
        step: 0.1,
        value: this.state.gapExtend,
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'alignment', label: 'Alignment', labelI18n: { 'zh-CN': '比对结果', 'en-US': 'Alignment' } },
          { value: 'gc', label: 'GC profile', labelI18n: { 'zh-CN': 'GC 滑动窗口', 'en-US': 'GC window' } },
        ],
        value: this.state.view,
      },
      {
        key: 'window',
        label: 'GC window',
        labelI18n: { 'zh-CN': 'GC 窗口大小', 'en-US': 'GC window size' },
        type: 'range',
        min: 5,
        max: 60,
        step: 1,
        value: this.state.window,
      },
      actionButton('exportCsv', 'Export alignment CSV', '导出比对 CSV'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    if (typeof params.seqA === 'string' && params.seqA !== this.state.seqA) {
      this.state.seqA = params.seqA;
      changed = true;
    }
    if (typeof params.seqB === 'string' && params.seqB !== this.state.seqB) {
      this.state.seqB = params.seqB;
      changed = true;
    }
    for (const k of ['gapOpen', 'gapExtend', 'window'] as const) {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v) && v !== this.state[k]) {
        this.state[k] = v;
        changed = true;
      }
    }
    if (typeof params.matrix === 'string' && (params.matrix === 'BLOSUM62' || params.matrix === 'NUC.4.4') && params.matrix !== this.state.matrix) {
      this.state.matrix = params.matrix;
      changed = true;
    }
    if (typeof params.mode === 'string' && (params.mode === 'global' || params.mode === 'local') && params.mode !== this.state.mode) {
      this.state.mode = params.mode;
      changed = true;
    }
    if (typeof params.view === 'string' && (params.view === 'alignment' || params.view === 'gc') && params.view !== this.state.view) {
      this.state.view = params.view;
      changed = true;
    }
    if (actionFired(params, 'align')) changed = true;
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'bio-seqalign');
      return;
    }
    if (changed) {
      this.run();
      this.draw();
    }
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    const isJson = low.endsWith('.json');
    const isFasta = low.endsWith('.fasta') || low.endsWith('.fa');
    const isCsv = low.endsWith('.csv') || low.endsWith('.tsv');
    const isPlain = low.endsWith('.txt');
    if (!isJson && !isFasta && !isCsv && !isPlain) {
      notify(
        this.api,
        'warning',
        'seqalign accepts FASTA, bare sequences, JSON or CSV/TSV.',
        '序列分析接受 FASTA、裸序列、JSON 或 CSV/TSV。',
      );
      return;
    }
    const text = await file.text();
    if (isJson) {
      const entries = parseSequenceJson(text);
      if (!entries || entries.length === 0) {
        notify(this.api, 'warning', 'JSON contains no sequences.', 'JSON 中未找到序列。');
        return;
      }
      this.applyEntry(entries[0]!, 0);
      this.applyEntry(entries[1] ?? entries[0]!, 1);
      this.run();
      notify(this.api, 'success', `Loaded ${entries.length} sequences from JSON.`, `已从 JSON 加载 ${entries.length} 条序列。`);
      this.draw();
      return;
    }
    if (isFasta) {
      const entries = parseFasta(text);
      if (entries.length < 2) {
        notify(this.api, 'warning', 'Need ≥2 FASTA sequences.', '需要至少两条 FASTA 序列。');
        return;
      }
      this.applyEntry(entries[0]!, 0);
      this.applyEntry(entries[1]!, 1);
      this.run();
      notify(this.api, 'success', `Loaded ${entries.length} FASTA entries (first two aligned).`, `已加载 ${entries.length} 条 FASTA（取前两条比对）。`);
      this.draw();
      return;
    }
    if (isCsv) {
      const entries = parseSequenceTable(text);
      if (entries.length < 2) {
        notify(this.api, 'warning', 'Need ≥2 sequence columns in CSV/TSV.', 'CSV/TSV 至少需要两列序列。');
        return;
      }
      this.applyEntry(entries[0]!, 0);
      this.applyEntry(entries[1]!, 1);
      this.run();
      notify(this.api, 'success', 'Loaded two sequences from CSV/TSV.', '已从 CSV/TSV 加载两条序列。');
      this.draw();
      return;
    }
    // Plain text: FASTA-shaped or bare sequences.
    const fasta = parseFasta(text);
    const bare = parseBareSequences(text);
    const entries = fasta.length >= 2 ? fasta : [];
    if (entries.length >= 2) {
      this.applyEntry(entries[0]!, 0);
      this.applyEntry(entries[1]!, 1);
      this.run();
      notify(this.api, 'success', `Loaded ${entries.length} FASTA entries (first two aligned).`, `已加载 ${entries.length} 条 FASTA（取前两条比对）。`);
      this.draw();
      return;
    }
    if (bare.length >= 2) {
      this.applyEntry({ sequence: bare[0]! }, 0);
      this.applyEntry({ sequence: bare[1]! }, 1);
      this.run();
      notify(this.api, 'success', 'Loaded two bare sequences.', '已加载两条裸序列。');
      this.draw();
      return;
    }
    notify(this.api, 'warning', 'Need ≥2 sequences (FASTA, bare or JSON).', '需要至少两条序列（FASTA、裸序列或 JSON）。');
  }

  private applyEntry(e: SeqEntry, index: 0 | 1) {
    const seq = e.sequence.toUpperCase().replace(/\s/g, '').slice(0, 200);
    if (index === 0) this.state.seqA = seq;
    else this.state.seqB = seq;
    if (e.sequence && [...e.sequence].some((c) => !'ATCGNRYSWKMBDHVU'.includes(c.toUpperCase()))) {
      // protein-like input → use BLOSUM62
      if (this.state.matrix !== 'BLOSUM62') this.state.matrix = 'BLOSUM62';
    }
  }

  private run() {
    const matrix = makeMatrix(this.state.matrix);
    const gap = { open: this.state.gapOpen, extend: this.state.gapExtend };
    const a = this.state.seqA.toUpperCase().replace(/\s/g, '');
    const b = this.state.seqB.toUpperCase().replace(/\s/g, '');
    this.hasData = a.length > 0 && b.length > 0;
    this.result = this.state.mode === 'local' ? alignLocal(a, b, matrix, gap) : alignGlobal(a, b, matrix, gap);
  }

  private exportCsv() {
    const r = this.result;
    if (!r) return;
    const rows: Array<Array<string | number>> = [];
    for (let i = 0; i < r.alignedA.length; i += 1) {
      rows.push([i + 1, r.alignedA[i]!, r.alignedB[i]!]);
    }
    exportRowsCsv(this.api, 'seq-alignment', ['pos', 'alignedA', 'alignedB'], rows);
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    if (!this.hasData) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No sequences loaded',
        titleZh: '尚未加载序列',
        hint: 'Load ≥2 sequences via FASTA (.fasta/.fa/.txt), bare text, JSON, or CSV/TSV.',
        hintZh: '载入至少两条序列：FASTA（.fasta/.fa/.txt）、裸序列、JSON 或 CSV/TSV。',
      });
      return;
    }
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (this.state.view === 'gc') this.drawGc(g, canvas);
    else this.drawAlignment(g, canvas);
  }

  private title(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const label =
      this.state.mode === 'local'
        ? this.zh ? 'Smith-Waterman 局部比对（Local）' : 'Smith-Waterman local'
        : this.zh ? 'Needleman-Wunsch 全局比对（Global）' : 'Needleman-Wunsch global';
    g.fillText(`${label} · ${this.state.matrix}`, canvas.width / 2, 20);
  }

  private drawAlignment(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    this.title(g, canvas);
    const r = this.result;
    if (!r) return;

    // metric strip
    const identityPct = (r.identity * 100).toFixed(1);
    const posPct = (r.positive * 100).toFixed(1);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(220,230,244,0.95)';
    g.textAlign = 'left';
    g.fillText(
      zh
        ? `得分 ${r.score} · 一致性 ${identityPct}% · 相似 ${posPct}% · 比对长度 ${r.length} · 空位 ${r.gaps}`
        : `Score ${r.score} · identity ${identityPct}% · similar ${posPct}% · aligned length ${r.length} · gaps ${r.gaps}`,
      54,
      40,
    );

    // alignment text block
    const mono = `12px ${zh ? "Consolas, 'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.font = mono;
    g.textAlign = 'left';
    const cw = g.measureText('M').width || 7.2;
    const cw2 = g.measureText('-').width || 7.2;
    const charW = Math.max(cw, cw2);
    const availW = canvas.width - 108;
    const perLine = Math.max(4, Math.floor(availW / charW));
    const mA = r.alignedA;
    const mB = r.alignedB;
    const linesA: string[] = [];
    const linesB: string[] = [];
    for (let i = 0; i < mA.length; i += perLine) {
      linesA.push(mA.slice(i, i + perLine));
      linesB.push(mB.slice(i, i + perLine));
    }
    const ROW_H = 18;
    const BLOCK_H = 52;
    let y = 74;
    const maxRows = Math.max(1, Math.floor((canvas.height - 100) / BLOCK_H));
    const show = linesA.slice(0, maxRows);
    for (let k = 0; k < show.length; k += 1) {
      const ra = linesA[k]!;
      const rb = linesB[k]!;
      // Residue numbering on its own ruler line above each block, right-aligned
      // to every 10th residue (NCBI-style) instead of overlapping the glyphs.
      g.textAlign = 'right';
      g.fillStyle = 'rgba(120,130,150,0.55)';
      for (let c = 9; c < ra.length; c += 10) {
        g.fillText(String(k * perLine + c + 1), 54 + (c + 1) * charW, y - 16);
      }
      g.textAlign = 'left';
      for (let c = 0; c < ra.length; c += 1) {
        const x = 54 + c * charW;
        const aa = ra[c]!;
        const bb = rb[c]!;
        if (aa === '-') {
          g.fillStyle = 'rgba(150,160,178,0.6)';
          g.fillText('-', x, y);
        } else if (bb === '-') {
          g.fillStyle = 'rgba(150,160,178,0.6)';
          g.fillText('-', x, y);
        } else if (aa === bb) {
          g.fillStyle = 'rgba(120,220,160,0.95)';
          g.fillText(aa, x, y);
          g.fillStyle = 'rgba(120,220,160,0.55)';
          g.fillText(bb, x, y + ROW_H);
        } else {
          g.fillStyle = 'rgba(240,150,130,0.95)';
          g.fillText(aa, x, y);
          g.fillStyle = 'rgba(240,150,130,0.7)';
          g.fillText(bb, x, y + ROW_H);
        }
      }
      g.fillStyle = 'rgba(170,182,200,0.85)';
      g.fillText('A', 54 + ra.length * charW + 10, y);
      g.fillText('B', 54 + ra.length * charW + 10, y + ROW_H);
      y += BLOCK_H;
    }
    if (linesA.length > show.length) {
      g.fillStyle = 'rgba(130,140,160,0.7)';
      g.font = `11px Consolas, monospace`;
      g.fillText(zh ? `… 已截断共 ${linesA.length} 段` : `… truncated ${linesA.length} blocks total`, 54, y + 6);
    }

    // composition footer
    const sa = this.state.seqA.toUpperCase();
    const sb = this.state.seqB.toUpperCase();
    const ga = baseStats(sa);
    const gb = baseStats(sb);
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.fillText(
      zh
        ? `A 长度 ${ga.length} · GC ${(ga.gcFraction * 100).toFixed(0)}%   B 长度 ${gb.length} · GC ${(gb.gcFraction * 100).toFixed(0)}%`
        : `A len ${ga.length} · GC ${(ga.gcFraction * 100).toFixed(0)}%   B len ${gb.length} · GC ${(gb.gcFraction * 100).toFixed(0)}%`,
      54,
      canvas.height - 12,
    );
  }

  private drawGc(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    this.title(g, canvas);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(220,230,244,0.95)';
    g.fillText(zh ? `滑动窗口 GC 含量（窗口 ${this.state.window} bp）` : `Sliding-window GC (window ${this.state.window} bp)`, 54, 38);

    const x0 = 48;
    const x1 = canvas.width - 54;
    const y0 = 52;
    const y1 = canvas.height - 36;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    const plot = (seq: string, color: string, label: string) => {
      const { pos, gc } = gcWindow(seq.toUpperCase(), this.state.window);
      if (pos.length === 0) return;
      const maxX = Math.max(1, pos[pos.length - 1]!);
      const px = (p: number) => x0 + (plotW * p) / maxX;
      const py = (v: number) => y1 - plotH * v;
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let i = 0; i < pos.length; i += 1) {
        const sx = px(pos[i]!);
        const sy = py(gc[i]!);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
      g.fillStyle = color;
      g.font = `10px Consolas, monospace`;
      g.fillText(label, px(maxX * 0.5), y0 + 6);
    };

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    for (let i = 0; i <= 4; i += 1) {
      const gv = i / 4;
      const sy = y1 - plotH * gv;
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(`${(gv * 100).toFixed(0)}%`, x0 - 6, sy + 4);
    }
    plot(this.state.seqA, 'rgba(160,210,250,0.95)', 'A');
    plot(this.state.seqB, 'rgba(240,170,120,0.95)', 'B');

    // axis label
    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(zh ? 'GC (%)' : 'GC (%)', x0 - 6, y0 - 8);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText(zh ? '位置（bp）' : 'position (bp)', x1 - 24, y1 + 18);
  }
}

export default function createBioSeqalignPlugin(): Plugin {
  return new BioSeqalignPlugin();
}