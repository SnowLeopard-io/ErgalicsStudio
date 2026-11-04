// ==========================================================================
// physics-heatengine — heat-engine p-V laboratory (plugin shell)
//
// Draws the quasi-static p-V path of the selected ideal-gas cycle (Otto,
// Diesel, Carnot, Stirling), colouring each branch by its heat exchange,
// numbering the corner states, and publishing eta / eta_analytic / relative
// error / W / Qin / Qout plus the first-law closure residual. Every parameter
// change recomputes the cycle (a few thousand trapezoid evaluations) so the
// view is always live; invalid parameter combinations fall back to a "fix
// the parameters" state instead of a broken plot.
//
// All numerics live in kernel.ts (pure, unit-tested). This file is UI only.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { heatEngineManifest } from './manifest';
import { heatEngineFigurePanels } from './figure';
import { computeCycle, sampleSegment, type EngineCycle, type EngineInput, type EngineResult, type SegmentKind } from './kernel';

export { heatEngineManifest } from './manifest';

const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

const CYCLES: Array<{ value: EngineCycle; en: string; zh: string }> = [
  { value: 'otto', en: 'Otto', zh: '奥托循环（定容加热）' },
  { value: 'diesel', en: 'Diesel', zh: '迪塞尔循环（定压加热）' },
  { value: 'carnot', en: 'Carnot', zh: '卡诺循环' },
  { value: 'stirling', en: 'Stirling', zh: '斯特林循环' },
];

const DEFAULT_INPUT: EngineInput = {
  cycle: 'otto',
  n: 1,
  gamma: 1.4,
  Tcold: 300,
  Thot: 2000,
  ratio: 8,
  cutoff: 2,
  regenerative: false,
  Vmin: 1e-3,
};

export class HeatEnginePlugin implements Plugin {
  readonly manifest = heatEngineManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private input: EngineInput = { ...DEFAULT_INPUT };
  private result: EngineResult | null = null;

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
    this.recompute();
    this.draw();
  }

  async deactivate() {
    // Stateless w.r.t. animation — nothing to stop.
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.recompute();
    this.draw();
  }

  // ---- computation ----------------------------------------------------------

  private recompute(): void {
    this.result = computeCycle(this.input);
    if (this.result) this.publish();
    else setScienceOutputs(this.manifest.id, []);
  }

  // ---- parameter panel ------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.input;
    const zh = this.zh;
    return [
      {
        key: 'cycle',
        label: 'Cycle',
        labelI18n: { 'zh-CN': '循环类型', 'en-US': 'Cycle' },
        type: 'select',
        options: CYCLES.map((c) => ({ value: c.value, label: zh ? c.zh : c.en, labelI18n: { 'zh-CN': c.zh, 'en-US': c.en } })),
        value: s.cycle,
      },
      { key: 'n', label: 'n (mol)', labelI18n: { 'zh-CN': '物质的量 n（mol）', 'en-US': 'n (mol)' }, type: 'range', min: 0.2, max: 5, step: 0.1, value: s.n },
      { key: 'Tcold', label: 'Tcold (K)', labelI18n: { 'zh-CN': '冷端温度 Tcold（K）', 'en-US': 'Tcold (K)' }, type: 'range', min: 200, max: 400, step: 5, value: s.Tcold, hint: zh ? '压缩起始温度' : 'compression-start temperature' },
      { key: 'Thot', label: 'Thot (K)', labelI18n: { 'zh-CN': '热端温度 Thot（K）', 'en-US': 'Thot (K)' }, type: 'range', min: 400, max: 3000, step: 10, value: s.Thot, hint: zh ? '奥托/卡诺/斯特林使用；迪塞尔峰温由截止比决定' : 'used by Otto / Carnot / Stirling; Diesel peak T follows the cutoff ratio' },
      { key: 'ratio', label: 'Ratio r', labelI18n: { 'zh-CN': '体积比 r', 'en-US': 'Ratio r' }, type: 'range', min: 2, max: 20, step: 0.5, value: s.ratio, hint: zh ? 'Vmax/Vmin（卡诺为等温膨胀比）' : 'Vmax/Vmin (Carnot: isothermal expansion ratio)' },
      { key: 'cutoff', label: 'Cutoff rc', labelI18n: { 'zh-CN': '截止比 rc', 'en-US': 'Cutoff rc' }, type: 'range', min: 1.2, max: 4, step: 0.05, value: s.cutoff, hint: zh ? '仅迪塞尔循环：V3/V2' : 'Diesel only: V3/V2' },
      { key: 'gamma', label: 'γ (cp/cv)', labelI18n: { 'zh-CN': '比热比 γ', 'en-US': 'γ (cp/cv)' }, type: 'range', min: 1.2, max: 1.8, step: 0.01, value: s.gamma, hint: zh ? '空气 ≈ 1.4' : 'air ≈ 1.4' },
      { key: 'regenerative', label: 'Perfect regenerator', labelI18n: { 'zh-CN': '完全回热（斯特林）', 'en-US': 'Perfect regenerator (Stirling)' }, type: 'checkbox', value: s.regenerative },
      { key: 'Vmin', label: 'Vmin (m³)', labelI18n: { 'zh-CN': '最小容积 Vmin（m³）', 'en-US': 'Vmin (m³)' }, type: 'number', min: 0.0001, max: 0.01, step: 0.0001, value: s.Vmin },
      actionButton('export', 'Export CSV', '导出 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.input;
    if (typeof params.cycle === 'string' && CYCLES.some((c) => c.value === params.cycle) && params.cycle !== s.cycle) {
      s.cycle = params.cycle as EngineCycle;
    }
    const num = (k: keyof EngineInput, cb: (n: number) => void): void => {
      const v = params[k as string];
      if (typeof v === 'number' && Number.isFinite(v)) cb(v);
    };
    num('n', (v) => { s.n = v; });
    num('Tcold', (v) => { s.Tcold = v; });
    num('Thot', (v) => { s.Thot = v; });
    num('ratio', (v) => { s.ratio = v; });
    num('cutoff', (v) => { s.cutoff = v; });
    num('gamma', (v) => { s.gamma = v; });
    num('Vmin', (v) => { s.Vmin = v; });
    if (typeof params.regenerative === 'boolean' && params.regenerative !== s.regenerative) {
      s.regenerative = params.regenerative;
    }
    this.recompute();
    this.draw();
    if (actionFired(params, 'export')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- scientific outputs ---------------------------------------------------

  private publish(): void {
    const r = this.result;
    if (!r) return;
    const zh = this.zh;
    const err = relErr(r.eta, r.etaAnalytic);
    const metrics: ScienceMetric[] = [
      {
        key: 'eta',
        label: zh ? '热效率 η' : 'Efficiency η',
        value: fmtMetric(r.eta * 100),
        unit: '%',
        severity: err < 1e-4 ? 'ok' : err < 1e-2 ? 'info' : 'warn',
        hint: zh ? 'η = W/Qin，梯形法 ∮p dV' : 'η = W/Qin from the trapezoid ∮p dV',
      },
      {
        key: 'eta-a',
        label: zh ? '解析效率 ηa' : 'Analytic η',
        value: fmtMetric(r.etaAnalytic * 100),
        unit: '%',
        severity: 'info',
        hint: this.analyticFormula(),
      },
      {
        key: 'eta-err',
        label: zh ? 'η 相对误差' : 'η rel err',
        value: fmtMetric(err * 100),
        unit: '%',
        severity: err < 1e-4 ? 'ok' : err < 1e-2 ? 'info' : 'warn',
        hint: zh ? '统一口径 |计算-解析|/|解析|' : 'unified |calc-analytic|/|analytic|',
      },
      { key: 'W', label: zh ? '净功 W' : 'Net work W', value: fmtMetric(r.W), unit: 'J', severity: 'info' },
      { key: 'Qin', label: 'Qin', value: fmtMetric(r.Qin), unit: 'J', severity: 'info', hint: zh ? '自外部热源吸热' : 'heat drawn from the hot reservoir' },
      { key: 'Qout', label: 'Qout', value: fmtMetric(r.Qout), unit: 'J', severity: 'info', hint: zh ? '向冷源放热' : 'heat rejected to the cold reservoir' },
      {
        key: 'closure',
        label: zh ? '第一定律闭合残差' : 'First-law closure',
        value: fmtMetric(r.closure),
        unit: 'J',
        severity: Math.abs(r.closure) < 1e-6 * Math.max(1, Math.abs(r.W)) ? 'ok' : 'warn',
        hint: zh ? 'W − ΣQ（含回热内部配对，应接近机器精度）' : 'W − ΣQ (regenerated pairs cancel; should sit at machine precision)',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private analyticFormula(): string {
    const zh = this.zh;
    switch (this.input.cycle) {
      case 'otto':
        return 'η = 1 − r^(1−γ)';
      case 'diesel':
        return 'η = 1 − r^(1−γ)·(rc^γ − 1)/(γ(rc − 1))';
      case 'carnot':
        return zh ? 'η = 1 − Tc/Th，W = nR(Th−Tc)·ln r' : 'η = 1 − Tc/Th, W = nR(Th−Tc)·ln r';
      case 'stirling':
        return this.input.regenerative
          ? zh ? 'η = 1 − Tc/Th（完全回热）' : 'η = 1 − Tc/Th (perfect regeneration)'
          : zh ? 'η = W/(nR·Th·ln r + n·cv·ΔT)（无回热）' : 'η = W/(nR·Th·ln r + n·cv·ΔT) (no regeneration)';
    }
  }

  // ---- exports --------------------------------------------------------------

  private exportCsv(): void {
    const r = this.result;
    if (!r) {
      notify(this.api, 'warning', 'Fix the parameters first — no valid cycle to export.', '请先修正参数——当前没有可导出的有效循环。');
      return;
    }
    const branchRows = r.segments.map((s, i) => [
      i + 1,
      s.kind,
      Number(s.Va.toPrecision(6)),
      Number(s.Ta.toPrecision(6)),
      Number(s.Vb.toPrecision(6)),
      Number(s.Tb.toPrecision(6)),
      Number(s.W.toPrecision(6)),
      Number(s.Q.toPrecision(6)),
      s.regenerated ? 1 : 0,
    ]);
    exportRowsCsv(
      this.api,
      `heatengine-${r.cycle}-branches`,
      ['branch', 'kind', 'Va_m3', 'Ta_K', 'Vb_m3', 'Tb_K', 'W_J', 'Q_J', 'regenerated'],
      branchRows,
    );
    const stateRows = r.states.map((p) => [
      p.label,
      Number(p.V.toPrecision(6)),
      Number(p.T.toPrecision(6)),
      Number(p.p.toPrecision(6)),
    ]);
    exportRowsCsv(this.api, `heatengine-${r.cycle}-states`, ['state', 'V_m3', 'T_K', 'p_Pa'], stateRows);
  }

  // ---- figure studio push ---------------------------------------------------

  private async sendToFigure(): Promise<void> {
    const r = this.result;
    if (!r) {
      notify(this.api, 'warning', 'No valid cycle — fix the parameters first.', '当前参数无法构成有效循环 — 请先修正参数。');
      return;
    }
    const cyc = CYCLES.find((c) => c.value === r.cycle);
    const caption: Bilingual = {
      zh: `${cyc?.zh ?? r.cycle}：η=${(r.eta * 100).toFixed(2)}%（解析 ${(r.etaAnalytic * 100).toFixed(2)}%），W=${fmtMetric(r.W)} J，Qin=${fmtMetric(r.Qin)} J。`,
      en: `${cyc?.en ?? r.cycle} cycle: η=${(r.eta * 100).toFixed(2)}% (analytic ${(r.etaAnalytic * 100).toFixed(2)}%), W=${fmtMetric(r.W)} J, Qin=${fmtMetric(r.Qin)} J.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '热机循环分析', en: 'Heat-Engine Cycle Analysis' },
      caption,
      heatEngineFigurePanels({ input: this.input, result: r }),
    );
  }

  // ---- drawing --------------------------------------------------------------

  private draw(): void {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    if (this.api?.isActive && !this.api.isActive()) return; // background guard
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const W = canvas.width;
    const H = canvas.height;

    const cyc = CYCLES.find((c) => c.value === this.input.cycle);
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.fillText(
      `${zh ? cyc?.zh ?? this.input.cycle : cyc?.en ?? this.input.cycle} · ${zh ? '理想气体' : 'ideal gas'} · n=${this.input.n} mol · γ=${this.input.gamma}`,
      W / 2,
      20,
    );

    const r = this.result;
    if (!r) {
      g.fillStyle = 'rgba(255,170,140,0.95)';
      g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(
        zh
          ? '当前参数无法构成有效循环：请检查 Thot 是否高于压缩后温度、迪塞尔 1 < rc ≤ r、n/T/V 为正。'
          : 'These parameters form no valid cycle: check Thot above the post-compression temperature, Diesel 1 < rc <= r, and positive n / T / V.',
        W / 2,
        H / 2,
      );
      return;
    }

    const padL = 66;
    const padR = 22;
    const padT = 44;
    const padB = 58;
    const x0 = padL;
    const x1 = W - padR;
    const y0 = padT;
    const y1 = H - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    let vMin = Infinity;
    let vMax = 0;
    for (const s of r.segments) {
      vMin = Math.min(vMin, s.Va, s.Vb);
      vMax = Math.max(vMax, s.Va, s.Vb);
    }
    const vLo = vMin * 0.9;
    const vHi = vMax * 1.08;
    const pHi = r.pMax * 1.08;
    const px = (v: number): number => x0 + (plotW * (Math.log(v) - Math.log(vLo))) / (Math.log(vHi) - Math.log(vLo));
    const py = (p: number): number => y1 - (plotH * p) / pHi;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(x0, y0, plotW, plotH);

    // p ticks (5) + V ticks (5, log-spaced exponents)
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const p = (pHi * i) / 5;
      const sy = py(p);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(fmtMetric(p), x0 - 6, sy + 3);
    }
    g.textAlign = 'center';
    const decades = Math.max(1, Math.round(Math.log10(vHi / vLo)));
    const stepDec = Math.max(1, Math.round(decades / 5));
    for (let e = Math.ceil(Math.log10(vLo)); e <= Math.floor(Math.log10(vHi)); e += stepDec) {
      const v = Math.pow(10, e);
      const sx = px(v);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(fmtMetric(v), sx, y1 + 13);
    }

    // branches, coloured by heat exchange
    for (const s of r.segments) {
      const pts = sampleSegment(s, this.input.n, this.input.gamma, 160);
      g.strokeStyle = this.branchColor(s.kind, s.Q);
      g.lineWidth = 2;
      g.beginPath();
      pts.forEach((q, i) => {
        const sx = px(q.V);
        const sy = py(q.p);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      });
      g.stroke();
    }

    // corner states
    g.font = '10px Consolas, monospace';
    for (const p of r.states) {
      const sx = px(p.V);
      const sy = py(p.p);
      g.beginPath();
      g.arc(sx, sy, 3.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(240,246,252,0.95)';
      g.fill();
      g.strokeStyle = 'rgba(90,110,140,0.9)';
      g.stroke();
      g.fillStyle = 'rgba(230,238,248,0.95)';
      g.fillText(p.label, sx + 9, sy - 7);
    }

    // axis titles + legend + footer
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('V (m³)', x1 - 34, y1 + 26);
    g.textAlign = 'left';
    g.fillText('p (Pa)', x0 + 4, y0 + 12);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const legend = [
      { c: '#ff7d6b', t: zh ? '吸热' : 'heat in' },
      { c: '#6ba6ff', t: zh ? '放热' : 'heat out' },
      { c: '#b48cff', t: zh ? '绝热' : 'adiabat' },
    ];
    legend.forEach((l, i) => {
      const lx = x1 - 150 + i * 50;
      g.strokeStyle = l.c;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(lx, y0 + 12);
      g.lineTo(lx + 16, y0 + 12);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.95)';
      g.fillText(l.t, lx + 20, y0 + 15);
    });
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(
      `eta=${(r.eta * 100).toFixed(3)}%  etaA=${(r.etaAnalytic * 100).toFixed(3)}%  rel=${(relErr(r.eta, r.etaAnalytic) * 100).toExponential(2)}%  W=${fmtMetric(r.W)} J  Qin=${fmtMetric(r.Qin)} J  Qout=${fmtMetric(r.Qout)} J`,
      x0,
      H - 14,
    );
  }

  /** Branch stroke colour: warm for absorbed heat, cool for rejected, violet for adiabats. */
  private branchColor(kind: SegmentKind, q: number): string {
    if (kind === 'adiabatic') return 'rgba(180,140,255,0.95)';
    return q > 0 ? 'rgba(255,125,107,0.95)' : 'rgba(107,166,255,0.95)';
  }
}

export default function createHeatEnginePlugin(): Plugin {
  return new HeatEnginePlugin();
}
