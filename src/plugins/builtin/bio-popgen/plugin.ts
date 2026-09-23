// ==========================================================================
// bio-popgen — population-genetics workbench (2-D)
//
// Two views switched by a param:
//   · "drift" — Wright-Fisher allele-frequency trajectories, one soft line
//     per replicate with a bold mean curve and a fixation counter.
//   · "hwe"   — observed vs expected genotype bars + the chi² test summary
//     (p-value, χ², HWE / deviation verdict) for user genotype counts.
// Accepts a small CSV (AA,Aa,aa) for the HWE panel and exports the drift
// mean trajectory as CSV.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportCanvasPng, exportRowsCsv, notify } from '../shared/enhance';
import { bioPopgenManifest } from './manifest';
import { DEFAULT_COUNTS, DEFAULT_WF, hweTest, wrightFisher, type WfResult } from './popgen';

export { bioPopgenManifest } from './manifest';

type View = 'drift' | 'hwe';

interface State {
  view: View;
  p0: number;
  diploidN: number;
  generations: number;
  replicates: number;
  selection: number;
  dominance: number;
  seed: number;
  AA: number;
  Aa: number;
  aa: number;
}

export class BioPopgenPlugin implements Plugin {
  readonly manifest = bioPopgenManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    view: 'drift',
    p0: DEFAULT_WF.p0,
    diploidN: DEFAULT_WF.diploidN,
    generations: DEFAULT_WF.generations,
    replicates: DEFAULT_WF.replicates,
    selection: DEFAULT_WF.selection,
    dominance: DEFAULT_WF.dominance,
    seed: DEFAULT_WF.seed,
    AA: DEFAULT_COUNTS.AA,
    Aa: DEFAULT_COUNTS.Aa,
    aa: DEFAULT_COUNTS.aa,
  };
  private wf: WfResult | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
    this.recompute();
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
    this.draw();
  }

  private recompute() {
    this.wf = wrightFisher({
      p0: this.state.p0,
      diploidN: this.state.diploidN,
      generations: this.state.generations,
      replicates: this.state.replicates,
      selection: this.state.selection,
      dominance: this.state.dominance,
      seed: this.state.seed,
    });
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'drift', label: 'Drift', labelI18n: { 'zh-CN': '遗传漂变', 'en-US': 'Drift' } },
          { value: 'hwe', label: 'HWE test', labelI18n: { 'zh-CN': '哈代-温伯格检验', 'en-US': 'Hardy-Weinberg' } },
        ],
        value: this.state.view,
      },
      {
        key: 'p0',
        label: 'p₀',
        labelI18n: { 'zh-CN': '初始等位基因频率 p₀', 'en-US': 'Initial allele freq p₀' },
        type: 'range',
        min: 0.05,
        max: 0.95,
        step: 0.05,
        value: this.state.p0,
      },
      {
        key: 'diploidN',
        label: 'N (2N)',
        labelI18n: { 'zh-CN': '有效群体大小 N（2N 等位基因）', 'en-US': 'Pop size N (2N alleles)' },
        type: 'range',
        min: 4,
        max: 500,
        step: 2,
        value: this.state.diploidN,
      },
      {
        key: 'generations',
        label: 'Gen',
        labelI18n: { 'zh-CN': '世代数', 'en-US': 'Generations' },
        type: 'range',
        min: 10,
        max: 300,
        step: 5,
        value: this.state.generations,
      },
      {
        key: 'replicates',
        label: 'R',
        labelI18n: { 'zh-CN': '重复实验份数', 'en-US': 'Replicates' },
        type: 'range',
        min: 8,
        max: 200,
        step: 4,
        value: this.state.replicates,
      },
      {
        key: 'selection',
        label: 's',
        labelI18n: { 'zh-CN': '选择系数 s', 'en-US': 'Selection s' },
        type: 'range',
        min: 0,
        max: 0.3,
        step: 0.01,
        value: this.state.selection,
      },
      {
        key: 'dominance',
        label: 'h',
        labelI18n: { 'zh-CN': '显性度 h', 'en-US': 'Dominance h' },
        type: 'select',
        options: [
          { value: '0', label: '0 · recessive', labelI18n: { 'zh-CN': '0 · 隐性', 'en-US': '0 · recessive' } },
          { value: '0.5', label: '0.5 · additive', labelI18n: { 'zh-CN': '0.5 · 加性', 'en-US': '0.5 · additive' } },
          { value: '1', label: '1 · dominant', labelI18n: { 'zh-CN': '1 · 显性', 'en-US': '1 · dominant' } },
        ],
        value: String(this.state.dominance),
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Random seed' },
        type: 'number',
        value: this.state.seed,
      },
      {
        key: 'AA',
        label: 'n(AA)',
        labelI18n: { 'zh-CN': '基因型 AA 计数', 'en-US': 'AA genotype count' },
        type: 'number',
        value: this.state.AA,
      },
      {
        key: 'Aa',
        label: 'n(Aa)',
        labelI18n: { 'zh-CN': '基因型 Aa 计数', 'en-US': 'Aa genotype count' },
        type: 'number',
        value: this.state.Aa,
      },
      {
        key: 'aa',
        label: 'n(aa)',
        labelI18n: { 'zh-CN': '基因型 aa 计数', 'en-US': 'aa genotype count' },
        type: 'number',
        value: this.state.aa,
      },
      actionButton('rerun', 'Re-run drift', '重新运行漂变', 'primary'),
      actionButton('exportCsv', 'Export drift CSV', '导出漂变 CSV'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: keyof State, cb: (n: number) => void): void => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (v !== this.state[k]) {
          cb(v);
        }
      }
    };
    let recompute = false;
    const dirty = (): void => {
      recompute = true;
    };
    if (typeof params.view === 'string' && (params.view === 'drift' || params.view === 'hwe') && params.view !== this.state.view) {
      this.state.view = params.view;
    }
    num('p0', (n) => {
      this.state.p0 = Math.min(0.95, Math.max(0.05, n));
      dirty();
    });
    num('diploidN', (n) => {
      this.state.diploidN = Math.max(2, n);
      dirty();
    });
    num('generations', (n) => {
      this.state.generations = Math.max(2, n);
      dirty();
    });
    num('replicates', (n) => {
      this.state.replicates = Math.max(1, n);
      dirty();
    });
    num('selection', (n) => {
      this.state.selection = Math.max(0, n);
      dirty();
    });
    num('seed', (n) => {
      this.state.seed = n >>> 0;
      dirty();
    });
    if (typeof params.dominance === 'string' && ['0', '0.5', '1'].includes(params.dominance)) this.state.dominance = Number(params.dominance);
    num('AA', (n) => {
      this.state.AA = Math.max(0, Math.round(n));
    });
    num('Aa', (n) => {
      this.state.Aa = Math.max(0, Math.round(n));
    });
    num('aa', (n) => {
      this.state.aa = Math.max(0, Math.round(n));
    });
    if (actionFired(params, 'rerun')) recompute = true;
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'bio-popgen');
      return;
    }
    if (recompute) {
      this.recompute();
      this.draw();
    } else {
      this.draw();
    }
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.txt')) {
      notify(this.api, 'warning', 'popgen accepts AA,Aa,aa counts CSV.', '群体遗传学接受 AA,Aa,aa 计数 CSV。');
      return;
    }
    const text = await file.text();
    const nums = text.split(/[,\t\r\n;]+/).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= 0);
    if (nums.length >= 3) {
      this.state.AA = Math.round(nums[0]!);
      this.state.Aa = Math.round(nums[1]!);
      this.state.aa = Math.round(nums[2]!);
      this.state.view = 'hwe';
      notify(this.api, 'success', `Loaded AA=${this.state.AA}, Aa=${this.state.Aa}, aa=${this.state.aa}.`, `已加载 AA=${this.state.AA}，Aa=${this.state.Aa}，aa=${this.state.aa}。`);
      this.draw();
      return;
    }
    notify(this.api, 'warning', 'Need ≥3 numeric columns (AA,Aa,aa).', '需要至少 3 列数值（AA,Aa,aa）。');
  }

  private exportCsv() {
    const wf = this.wf;
    if (!wf) return;
    const rows: Array<Array<string | number>> = [];
    const step = Math.max(1, Math.floor(wf.generations.length / 120));
    for (let g = 0; g < wf.generations.length; g += step) {
      rows.push([g, Number(wf.mean[g]!.toFixed(4))]);
    }
    exportRowsCsv(this.api, 'drift-mean', ['generation', 'mean_p(A)'], rows);
  }

  // ---- drawing -------------------------------------------------------------

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
    if (this.state.view === 'hwe') this.drawHwe(g, canvas);
    else this.drawDrift(g, canvas);
  }

  private drawDrift(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const wf = this.wf;
    if (!wf) return;
    const x0 = 54;
    const x1 = canvas.width - 54;
    const y0 = 46;
    const y1 = canvas.height - 70;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const maxG = wf.generations[wf.generations.length - 1]!;
    const px = (g: number) => x0 + (plotW * g) / maxG;
    const py = (p: number) => y1 - plotH * p;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? `Wright–Fisher 遗传漂变（N=${this.state.diploidN}，${this.state.replicates} 份重复）` : `Wright–Fisher drift (N=${this.state.diploidN}, ${this.state.replicates} replicates)`, canvas.width / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // replicate paths (soft)
    g.lineWidth = 1;
    for (const path of wf.paths) {
      g.strokeStyle = 'rgba(120,200,170,0.16)';
      g.beginPath();
      for (let i = 0; i < path.length; i += 1) {
        const sx = px(i);
        const sy = py(path[i]!);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
    }
    // mean curve
    g.strokeStyle = 'rgba(240,220,130,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < wf.mean.length; i += 1) {
      const sx = px(i);
      const sy = py(wf.mean[i]!);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();

    // frame at p=p0
    g.strokeStyle = 'rgba(150,210,250,0.6)';
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(x0, py(this.state.p0));
    g.lineTo(x1, py(this.state.p0));
    g.stroke();
    g.setLineDash([]);

    // axes ticks
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    for (let i = 0; i <= 5; i += 1) {
      const pv = i / 5;
      const sy = py(pv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillText(pv.toFixed(1), x0 - 6, sy + 4);
    }
    for (let i = 0; i <= 5; i += 1) {
      const gv = (maxG * i) / 5;
      const sx = px(gv);
      g.fillText(String(Math.round(gv)), sx, y1 + 14);
    }
    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(zh ? '等位基因频率 p(A)' : 'p(A)', x0 - 6, y0 - 8);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText(zh ? '世代' : 'generation', x1 - 34, y1 + 26);

    // footer stats
    g.fillStyle = 'rgba(220,230,244,0.95)';
    g.textAlign = 'left';
    const fixTime = wf.meanFixationTime == null ? '—' : wf.meanFixationTime.toFixed(1);
    g.fillText(
      zh
        ? `固定 A：${wf.fixedA} · 丢失 A：${wf.lostA} · 平均固定时间 ${fixTime} 代 · 终末杂合度 2pq`
        : `Fix A: ${wf.fixedA} · lost A: ${wf.lostA} · mean fixation ${fixTime} gen`,
      54,
      canvas.height - 16,
    );
  }

  private drawHwe(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const c = this.state;
    const r = hweTest({ AA: c.AA, Aa: c.Aa, aa: c.aa });
    const x0 = 70;
    const x1 = canvas.width - 90;
    const y0 = 70;
    const y1 = canvas.height - 74;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '哈代–温伯格平衡检验（Hardy-Weinberg）' : 'Hardy-Weinberg equilibrium test', canvas.width / 2, 20);
    g.fillStyle = 'rgba(214,224,240,0.95)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh ? `观测 n=${r.nInd}   p=${r.alleleA.toFixed(3)}  q=${r.alleleB.toFixed(3)}` : `observed n=${r.nInd}   p=${r.alleleA.toFixed(3)}  q=${r.alleleB.toFixed(3)}`,
      canvas.width / 2,
      38,
    );

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    const labels = ['AA', 'Aa', 'aa'];
    const obs = [c.AA, c.Aa, c.aa];
    const exp = [r.expected.AA, r.expected.Aa, r.expected.aa];
    const maxV = Math.max(...obs, ...exp) * 1.1 || 1;
    const band = plotW / 3;
    const barW = band / 3;

    g.textAlign = 'center';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    for (let i = 0; i < 3; i += 1) {
      const cx = x0 + (i + 0.5) * band;
      const drawBar = (v: number, bw: number, color: string, ox: number) => {
        const bh = (v / maxV) * plotH;
        g.fillStyle = color;
        g.fillRect(cx + ox, y1 - bh, bw, bh);
      };
      drawBar(obs[i]!, barW, 'rgba(120,200,170,0.9)', -barW - 2);
      drawBar(exp[i]!, barW, 'rgba(160,210,250,0.85)', 2);
      g.fillStyle = 'rgba(210,222,238,0.95)';
      g.fillText(labels[i]!, cx, y1 + 16);
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.fillText(zh ? `观${obs[i]!} 期${exp[i]!.toFixed(1)}` : `${obs[i]!} / ${exp[i]!.toFixed(1)}`, cx, y1 + 30);
    }

    // y ticks
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    for (let i = 0; i <= 4; i += 1) {
      const vv = (maxV * i) / 4;
      const sy = y1 - (plotH * i) / 4;
      g.fillText(Math.round(vv).toString(), x0 - 6, sy + 4);
    }
    // legend
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    let ly = y0 + 16;
    const leg: Array<[string, string]> = [
      ['rgba(120,200,170,0.9)', zh ? '观测' : 'observed'],
      ['rgba(160,210,250,0.85)', zh ? '期望（HWE）' : 'expected (HWE)'],
    ];
    for (const [col, lab] of leg) {
      g.fillStyle = col;
      g.fillRect(x1 + 8, ly, 18, 4);
      g.fillText(lab, x1 + 30, ly + 6);
      ly += 16;
    }

    // verdict strip
    g.textAlign = 'left';
    g.fillStyle = r.deviates ? 'rgba(244,172,132,0.95)' : 'rgba(120,220,165,0.95)';
    g.fillText(
      zh
        ? `χ²=${r.chi2.toFixed(3)} · df=${r.df} · p=${r.pValue.toFixed(4)} → ${r.deviates ? '偏离 HWE（p<0.05）' : '符合 HWE（p≥0.05）'}`
        : `χ²=${r.chi2.toFixed(3)} · df=${r.df} · p=${r.pValue.toFixed(4)} → ${r.deviates ? 'deviates from HWE (p<0.05)' : 'in HWE (p≥0.05)'}`,
      54,
      canvas.height - 16,
    );
  }
}

export default function createBioPopgenPlugin(): Plugin {
  return new BioPopgenPlugin();
}