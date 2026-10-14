// ==========================================================================
// chem-reaction-order — reaction-order determination & Arrhenius analysis
//
// Data-driven: load a two-column table (t,c kinetics or T,k Arrhenius —
// header keywords decide) and the kernel screens the three integrated
// rate-law linearisations by R², cross-checks with the half-life method and
// (for k(T) data) fits the Arrhenius regression. The canvas shows the three
// small-multiple linearisations with the winner highlighted, R² bars and
// the verdict (order, k ± σ, t½, Ea ± σ). Embedded seeded benchmarks replay
// the textbook truths (k=0.0231 min⁻¹ first order, k=0.5 L/(mol·min) second
// order, Ea=50 kJ/mol) as an in-plugin validation.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { chemReactionOrderManifest } from './manifest';
import { reactionOrderFigurePanels } from './figure';
import {
  analyzeOrder,
  arrheniusFit,
  halfLifeCheck,
  ORDER_TRANSFORMS,
  parseTwoColumn,
  rateConstantUnit,
  synthArrhenius,
  synthKinetics,
  transformY,
  type ArrheniusFit,
  type ArrheniusPoint,
  type OrderAnalysis,
  type SeriesPoint,
  type TableKind,
} from './kernel';

export { chemReactionOrderManifest } from './manifest';

const DEMO_SEED = 20260922;

type Mode = TableKind;

interface KineticsReport {
  data: SeriesPoint[];
  analysis: OrderAnalysis;
  half: ReturnType<typeof halfLifeCheck>;
  /** Time unit inferred from the header when present ('s' default). */
  timeUnit: string;
}

interface ArrheniusReport {
  data: ArrheniusPoint[];
  fit: ArrheniusFit;
}

export class ChemReactionOrderPlugin implements Plugin {
  readonly manifest = chemReactionOrderManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private mode: Mode = 'kinetics';
  private showAll = true;
  private kinetics: KineticsReport | null = null;
  private arrhenius: ArrheniusReport | null = null;

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
    this.kinetics = null;
    this.arrhenius = null;
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
        label: 'Data mode',
        labelI18n: { 'zh-CN': '数据类型', 'en-US': 'Data mode' },
        type: 'select',
        options: [
          {
            value: 'kinetics',
            label: zh ? '动力学 [A]–t（判定级数）' : 'Kinetics [A]–t (order)',
            labelI18n: { 'zh-CN': '动力学 [A]–t（判定级数）', 'en-US': 'Kinetics [A]–t (order)' },
          },
          {
            value: 'arrhenius',
            label: zh ? 'Arrhenius k–T（活化能）' : 'Arrhenius k–T (Ea)',
            labelI18n: { 'zh-CN': 'Arrhenius k–T（活化能）', 'en-US': 'Arrhenius k–T (Ea)' },
          },
        ],
        value: this.mode,
        hint: zh ? '列头含 T/k 判读为 Arrhenius，t/c 判读为动力学；也可手动指定' : 'T/k headers → Arrhenius, t/c → kinetics; manual override available',
      },
      {
        key: 'showAll',
        label: 'Show all 3 fits',
        labelI18n: { 'zh-CN': '显示三种线性化对比', 'en-US': 'Show all three linearisations' },
        type: 'checkbox',
        value: this.showAll,
      },
      actionButton('analyze', 'Re-analyze data', '重新分析数据', 'primary'),
      actionButton('demo', 'Demo · seeded first-order data', '演示 · 固定种子一级数据'),
      actionButton('benchmark', 'Run embedded benchmarks', '运行内嵌基准验证'),
      actionButton('exportCsv', 'Export data CSV', '导出数据 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    if (typeof params.mode === 'string' && (params.mode === 'kinetics' || params.mode === 'arrhenius')) {
      if (params.mode !== this.mode) {
        this.mode = params.mode;
        changed = true;
        this.publish();
      }
    }
    if (typeof params.showAll === 'boolean' && params.showAll !== this.showAll) {
      this.showAll = params.showAll;
      changed = true;
    }
    if (actionFired(params, 'analyze')) {
      changed = true;
      this.publish();
      notify(this.api, 'info', 'Data re-analysed.', '已重新分析数据。');
    }
    if (actionFired(params, 'demo')) this.loadDemo();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    if (changed) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    const ok = low.endsWith('.csv') || low.endsWith('.tsv') || low.endsWith('.txt') || low.endsWith('.dat');
    if (!ok) {
      notify(this.api, 'warning', 'Reaction-order plugin accepts CSV/TSV/DAT/TXT two-column tables.', '本插件接受 CSV/TSV/DAT/TXT 两列表格。');
      return;
    }
    const text = await file.text();
    const parsed = parseTwoColumn(text, this.mode);
    const pts = parsed.kind === 'kinetics' ? parsed.kinetics : parsed.arrhenius;
    if (pts.length < 3) {
      notify(this.api, 'warning', 'Need ≥3 usable two-column rows.', '至少需要 3 行可用的两列数据。');
      return;
    }
    if (parsed.kind === 'kinetics') {
      this.kinetics = { data: pts as SeriesPoint[], analysis: analyzeOrder(pts as SeriesPoint[])!, half: halfLifeCheck(pts as SeriesPoint[]), timeUnit: 's' };
      this.arrhenius = null;
      this.mode = 'kinetics';
    } else {
      const fit = arrheniusFit(pts as ArrheniusPoint[]);
      if (!fit) {
        notify(this.api, 'warning', 'Arrhenius fit needs ≥3 rows with T,k > 0.', 'Arrhenius 拟合至少需要 3 行 T,k>0 数据。');
        return;
      }
      this.arrhenius = { data: pts as ArrheniusPoint[], fit };
      this.kinetics = null;
      this.mode = 'arrhenius';
    }
    notify(
      this.api,
      'success',
      `Loaded ${pts.length} rows (${parsed.kind}); header ${parsed.headerDetected ? 'detected' : 'not found — used current mode'}.`,
      `已加载 ${pts.length} 行（${parsed.kind === 'kinetics' ? '动力学' : 'Arrhenius'}）；${parsed.headerDetected ? '已识别列头' : '未识别列头——按当前数据类型解析'}。`,
    );
    this.publish();
    this.draw();
  }

  /** Seeded demo: first-order decay, k = 0.0231 min⁻¹ with 1% noise. */
  private loadDemo() {
    const data = synthKinetics({ order: 1, c0: 0.8, k: 0.0231, tMax: 150, n: 31, noise: 0.01, seed: DEMO_SEED });
    this.mode = 'kinetics';
    this.arrhenius = null;
    this.kinetics = { data, analysis: analyzeOrder(data)!, half: halfLifeCheck(data), timeUnit: 'min' };
    notify(
      this.api,
      'success',
      'Demo data generated: first order, k=0.0231 min⁻¹, 1% noise, fixed seed.',
      '演示数据已生成：一级 k=0.0231 min⁻¹、1% 噪声、固定种子。',
    );
    this.publish();
    this.draw();
  }

  // ---- analysis & scientific outputs -----------------------------------------

  private publish() {
    if (this.mode === 'kinetics' && this.kinetics) {
      this.publishKinetics(this.kinetics);
    } else if (this.mode === 'arrhenius' && this.arrhenius) {
      this.publishArrhenius(this.arrhenius);
    } else {
      clearScienceOutputs(this.manifest.id);
    }
  }

  private publishKinetics(rep: KineticsReport) {
    const a = rep.analysis;
    const tu = rep.timeUnit;
    const name = ORDER_TRANSFORMS.find((t) => t.order === a.best)!;
    const unit = rateConstantUnit(a.best, tu);
    const half = rep.half;
    const metrics: ScienceMetric[] = [
      {
        key: 'order',
        label: this.zh ? '判定级数 n' : 'Determined order n',
        value: `${a.best}（${this.zh ? name.zh : name.en}）`,
        severity: 'ok',
        hint: this.zh ? '三级数线性化 R² 最大者' : 'highest-R² integrated-rate-law linearisation',
      },
      {
        key: 'k',
        label: 'k ± σ',
        value: `${fmtMetric(a.k)} ± ${fmtMetric(a.kSe)}`,
        unit,
        severity: a.r2 >= 0.99 ? 'ok' : a.r2 >= 0.95 ? 'info' : 'warn',
        hint: this.zh ? '最优线性化斜率（正值化）及其 OLS 标准误' : 'winning linearisation slope (sign-normalised) with OLS standard error',
      },
      {
        key: 'r2',
        label: 'R² (best)',
        value: fmtMetric(a.r2),
        severity: a.r2 >= 0.99 ? 'ok' : a.r2 >= 0.95 ? 'info' : 'warn',
      },
      {
        key: 'half-life',
        label: this.zh ? '半衰期法级数' : 'Half-life order',
        value: half.order == null ? '—' : fmtMetric(half.order),
        severity: half.order == null ? 'info' : Math.abs(half.order - a.best) < 0.35 ? 'ok' : 'warn',
        hint:
          this.zh
            ? `逐段半衰期 ln t½–ln c₀ 斜率交叉验证（${half.pairs.length} 段）`
            : `successive-half-life ln t½–ln c₀ slope cross-check (${half.pairs.length} segments)`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private publishArrhenius(rep: ArrheniusReport) {
    const f = rep.fit;
    const metrics: ScienceMetric[] = [
      {
        key: 'ea',
        label: 'Ea ± σ',
        value: `${fmtMetric(f.ea)} ± ${fmtMetric(f.eaSe)}`,
        unit: 'kJ/mol',
        severity: f.r2 >= 0.99 ? 'ok' : f.r2 >= 0.95 ? 'info' : 'warn',
        hint: this.zh ? 'ln k–1/T 回归斜率 = −Ea/R' : 'ln k–1/T regression slope = −Ea/R',
      },
      {
        key: 'a-factor',
        label: 'A',
        value: fmtMetric(f.a),
        unit: 'as k',
        severity: 'info',
        hint: this.zh ? '指前因子 exp(截距)' : 'pre-exponential factor exp(intercept)',
      },
      {
        key: 'r2',
        label: 'R²',
        value: fmtMetric(f.r2),
        severity: f.r2 >= 0.99 ? 'ok' : f.r2 >= 0.95 ? 'info' : 'warn',
      },
      {
        key: 'n-points',
        label: this.zh ? '数据点数' : 'Points',
        value: String(f.n),
        severity: 'info',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Embedded benchmarks: seeded truths → kernels → recovery errors. */
  private runBenchmark() {
    // 1. First order: k = 0.0231 min⁻¹, 1% seeded noise.
    const d1 = synthKinetics({ order: 1, c0: 0.8, k: 0.0231, tMax: 150, n: 31, noise: 0.01, seed: DEMO_SEED });
    const a1 = analyzeOrder(d1)!;
    const e1 = Math.abs(a1.k - 0.0231) / 0.0231;
    // 2. Second order: k = 0.5 L/(mol·min), 1% seeded noise.
    const d2 = synthKinetics({ order: 2, c0: 1.0, k: 0.5, tMax: 20, n: 41, noise: 0.01, seed: DEMO_SEED + 7 });
    const a2 = analyzeOrder(d2)!;
    const e2 = Math.abs(a2.k - 0.5) / 0.5;
    // 3. Arrhenius: Ea = 50 kJ/mol, exact three-point recovery.
    const d3 = synthArrhenius({ eaKJ: 50, a: 1e8, temperatures: [300, 320, 350], noise: 0, seed: DEMO_SEED + 13 });
    const f3 = arrheniusFit(d3)!;
    const e3 = Math.abs(f3.ea - 50) / 50;
    const ok1 = a1.best === 1 && e1 < 0.01;
    const ok2 = a2.best === 2 && e2 < 0.05;
    const ok3 = e3 < 0.005;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-order1',
        label: this.zh ? '基准 · 一级判定与 k 误差' : 'Bench · 1st order & k err',
        value: `n=${a1.best}, ${fmtMetric(e1 * 100)}%`,
        severity: ok1 ? 'ok' : 'warn',
        hint: this.zh ? '真值 k=0.0231 min⁻¹，1% 种子噪声，阈值 1%' : 'truth k=0.0231 min⁻¹, 1% seeded noise, threshold 1%',
      },
      {
        key: 'bench-order2',
        label: this.zh ? '基准 · 二级判定与 k 误差' : 'Bench · 2nd order & k err',
        value: `n=${a2.best}, ${fmtMetric(e2 * 100)}%`,
        severity: ok2 ? 'ok' : 'warn',
        hint: this.zh ? '真值 k=0.5 L/(mol·min)，1% 种子噪声' : 'truth k=0.5 L/(mol·min), 1% seeded noise',
      },
      {
        key: 'bench-arrhenius',
        label: this.zh ? '基准 · Ea 回收误差' : 'Bench · Ea recovery err',
        value: fmtMetric(e3 * 100),
        unit: '%',
        severity: ok3 ? 'ok' : 'warn',
        hint: this.zh ? '真值 Ea=50 kJ/mol，三点精确回收，阈值 0.5%' : 'truth Ea=50 kJ/mol, exact 3-point recovery, threshold 0.5%',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      ok1 && ok2 && ok3 ? 'success' : 'warning',
      `Benchmarks: n=${a1.best}/${a2.best}, k err ${(e1 * 100).toFixed(2)}%/${(e2 * 100).toFixed(2)}%, Ea err ${(e3 * 100).toFixed(4)}%`,
      `基准对拍：级数 ${a1.best}/${a2.best}，k 误差 ${(e1 * 100).toFixed(2)}%/${(e2 * 100).toFixed(2)}%，Ea 误差 ${(e3 * 100).toFixed(4)}%`,
    );
  }

  private exportCsv() {
    if (this.mode === 'kinetics' && this.kinetics) {
      const rows: Array<Array<number | string>> = this.kinetics.data.map((d) => [d.t, Number(d.c.toPrecision(8))]);
      exportRowsCsv(this.api, 'reaction-kinetics', ['t', 'c'], rows);
    } else if (this.mode === 'arrhenius' && this.arrhenius) {
      const rows: Array<Array<number | string>> = this.arrhenius.data.map((d) => [d.T, Number(d.k.toPrecision(8))]);
      exportRowsCsv(this.api, 'arrhenius-data', ['T_K', 'k'], rows);
    } else {
      notify(this.api, 'warning', 'No data to export yet.', '暂无可导出的数据。');
    }
  }

  private async sendToFigure(): Promise<void> {
    if (this.mode === 'kinetics' && this.kinetics) {
      const rep = this.kinetics;
      const a = rep.analysis;
      const name = ORDER_TRANSFORMS.find((t) => t.order === a.best)!;
      const caption: Bilingual = {
        zh: `反应级数判定：${name.zh}反应，k=${a.k.toPrecision(4)} ± ${a.kSe.toExponential(2)} ${rateConstantUnit(a.best, rep.timeUnit)}，R²=${a.r2.toFixed(5)}。`,
        en: `Reaction-order determination: ${name.en} reaction, k=${a.k.toPrecision(4)} ± ${a.kSe.toExponential(2)} ${rateConstantUnit(a.best, rep.timeUnit)}, R²=${a.r2.toFixed(5)}.`,
      };
      await pushPanelsToFigure(
        this.api,
        { zh: '反应级数判定', en: 'Reaction-Order Analysis' },
        caption,
        reactionOrderFigurePanels({ mode: 'kinetics', kinetics: rep, arrhenius: null }),
      );
      return;
    }
    if (this.mode === 'arrhenius' && this.arrhenius) {
      const f = this.arrhenius.fit;
      const caption: Bilingual = {
        zh: `Arrhenius 分析：Ea=${f.ea.toFixed(2)} ± ${f.eaSe.toFixed(3)} kJ/mol，A=${f.a.toExponential(3)}，R²=${f.r2.toFixed(5)}。`,
        en: `Arrhenius analysis: Ea=${f.ea.toFixed(2)} ± ${f.eaSe.toFixed(3)} kJ/mol, A=${f.a.toExponential(3)}, R²=${f.r2.toFixed(5)}.`,
      };
      await pushPanelsToFigure(
        this.api,
        { zh: 'Arrhenius 分析', en: 'Arrhenius Analysis' },
        caption,
        reactionOrderFigurePanels({ mode: 'arrhenius', kinetics: null, arrhenius: this.arrhenius }),
      );
      return;
    }
    notify(this.api, 'warning', 'No kinetics / Arrhenius data yet — load a dataset or run the demo first.', '暂无动力学 / Arrhenius 数据 — 请先载入数据或运行演示。');
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const hasData = this.mode === 'kinetics' ? this.kinetics != null : this.arrhenius != null;
    if (!hasData) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No kinetics / Arrhenius data',
        titleZh: '尚未加载动力学或 Arrhenius 数据',
        hint: 'Load a two-column CSV (t,c or T,k) via the sample-data bar, or press the demo action.',
        hintZh: '通过示例数据栏或「打开文件」载入两列数据（t,c 或 T,k），或点击演示按钮生成固定种子数据。',
      });
      return;
    }
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.fillText(
      this.mode === 'kinetics'
        ? zh ? '反应级数判定 · 积分法三线性化对比' : 'Reaction order · integrated-method linearisations'
        : zh ? 'Arrhenius 分析 · ln k vs 1/T' : 'Arrhenius analysis · ln k vs 1/T',
      canvas.width / 2,
      20,
    );
    if (this.mode === 'kinetics' && this.kinetics) {
      this.drawKinetics(g, canvas, this.kinetics, zh);
    } else if (this.arrhenius) {
      this.drawArrhenius(g, canvas, this.arrhenius, zh);
    }
  }

  /** Three small multiples (zero/first/second linearisation), best highlighted. */
  private drawKinetics(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, rep: KineticsReport, zh: boolean) {
    const a = rep.analysis;
    const pts = rep.data.filter((d) => d.c > 0);
    const padT = 40;
    const gap = 12;
    const panelH = canvas.height * 0.5;
    const panelW = (canvas.width - 2 * gap - 56) / 3;
    const colors = ['rgba(150,170,195,0.9)', 'rgba(120,200,255,0.95)', 'rgba(150,220,170,0.9)'];

    ORDER_TRANSFORMS.forEach((info, idx) => {
      const fit = a.fits[info.order];
      const x0 = 56 + idx * (panelW + gap);
      const y0 = padT;
      const y1 = y0 + panelH;
      const isBest = info.order === a.best;
      // panel frame — winner gets a bright border
      g.strokeStyle = isBest ? 'rgba(255,215,120,0.9)' : 'rgba(255,255,255,0.12)';
      g.lineWidth = isBest ? 2 : 1;
      g.strokeRect(x0, y0, panelW, panelH);
      g.lineWidth = 1;
      if (pts.length < 2) return;
      const ys = pts.map((d) => transformY(info.order, d.c));
      const xmin = Math.min(...pts.map((d) => d.t));
      const xmax = Math.max(...pts.map((d) => d.t));
      const ymin = Math.min(...ys);
      const ymax = Math.max(...ys);
      const spanX = Math.max(xmax - xmin, 1e-12);
      const spanY = Math.max(ymax - ymin, 1e-12);
      const px = (t: number) => x0 + 8 + ((panelW - 16) * (t - xmin)) / spanX;
      const py = (v: number) => y1 - 8 - ((panelH - 24) * (v - ymin)) / spanY;
      // OLS line
      g.strokeStyle = colors[idx]!;
      g.lineWidth = isBest ? 2 : 1.5;
      g.beginPath();
      g.moveTo(px(xmin), py(fit.intercept + fit.slope * xmin));
      g.lineTo(px(xmax), py(fit.intercept + fit.slope * xmax));
      g.stroke();
      // scatter
      g.fillStyle = isBest ? 'rgba(255,255,255,0.95)' : 'rgba(200,214,232,0.7)';
      for (const d of pts) {
        g.beginPath();
        g.arc(px(d.t), py(transformY(info.order, d.c)), isBest ? 3 : 2, 0, Math.PI * 2);
        g.fill();
      }
      // labels
      g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillStyle = isBest ? 'rgba(255,215,120,0.98)' : 'rgba(180,195,214,0.9)';
      g.fillText(
        `${zh ? info.zh : info.en}${isBest ? (zh ? ' ★最优' : ' ★best') : ''}`,
        x0 + panelW / 2,
        y0 + 14,
      );
      g.fillStyle = 'rgba(160,175,195,0.9)';
      g.fillText(`R²=${fit.r2.toFixed(5)}`, x0 + panelW / 2, y1 - 4);
      g.textAlign = 'left';
      g.fillText(info.yLabel, x0 + 4, y0 + 28);
      g.textAlign = 'center';
      g.fillText('t', x0 + panelW / 2, y1 + 12);
      g.lineWidth = 1;
    });

    // R² bars
    const barsY = padT + panelH + 34;
    const barsH = Math.max(canvas.height - barsY - 58, 18);
    const maxR2 = Math.max(...ORDER_TRANSFORMS.map((i) => a.fits[i.order].r2), 1);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    ORDER_TRANSFORMS.forEach((info, idx) => {
      const r2 = a.fits[info.order].r2;
      const by = barsY + idx * (barsH + 6);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(56, by, canvas.width - 80, barsH);
      g.fillStyle = info.order === a.best ? 'rgba(120,200,255,0.7)' : 'rgba(150,170,195,0.4)';
      g.fillRect(56, by, (canvas.width - 80) * (r2 / maxR2), barsH);
      g.fillStyle = 'rgba(225,232,242,0.95)';
      g.fillText(`${zh ? info.zh : info.en}  R²=${r2.toFixed(6)}`, 64, by + barsH - 5);
    });

    // verdict footer
    const tu = rep.timeUnit;
    const tHalf1 = rep.data.length > 1 ? this.firstHalfLife(rep.data) : null;
    const halfTxt =
      rep.half.order == null
        ? '—'
        : `n(half-life)≈${rep.half.order.toFixed(2)} (${rep.half.pairs.length}${zh ? ' 段' : ' seg'})`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = zh
      ? `结论：${ORDER_TRANSFORMS.find((i) => i.order === a.best)!.zh}反应  k=${a.k.toPrecision(4)} ± ${a.kSe.toExponential(2)} ${rateConstantUnit(a.best, tu)}  R²=${a.r2.toFixed(5)}`
      : `Verdict: ${ORDER_TRANSFORMS.find((i) => i.order === a.best)!.en} reaction  k=${a.k.toPrecision(4)} ± ${a.kSe.toExponential(2)} ${rateConstantUnit(a.best, tu)}  R²=${a.r2.toFixed(5)}`;
    g.fillText(l1, 56, canvas.height - 28);
    const l2 = zh
      ? `半衰期交叉验证：${halfTxt}${tHalf1 != null ? `  t½(c₀)=${tHalf1.toPrecision(3)} ${tu}` : ''}  ·  N=${rep.data.length} 点`
      : `Half-life cross-check: ${halfTxt}${tHalf1 != null ? `  t½(c₀)=${tHalf1.toPrecision(3)} ${tu}` : ''}  ·  N=${rep.data.length} points`;
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(l2, 56, canvas.height - 12);
  }

  /** Interpolated time for the first c → c/2 fall (display only). */
  private firstHalfLife(data: SeriesPoint[]): number | null {
    const pts = data.filter((d) => d.c > 0).sort((a, b) => a.t - b.t);
    if (pts.length < 2) return null;
    const c0 = pts[0]!.c;
    for (let j = 1; j < pts.length; j += 1) {
      if (pts[j]!.c <= c0 / 2) {
        const prev = pts[j - 1]!;
        const cur = pts[j]!;
        if (cur.c === prev.c) return cur.t;
        return prev.t + ((prev.c - c0 / 2) / (prev.c - cur.c)) * (cur.t - prev.t);
      }
    }
    return null;
  }

  private drawArrhenius(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, rep: ArrheniusReport, zh: boolean) {
    const f = rep.fit;
    const pts = rep.data.filter((d) => d.T > 0 && d.k > 0);
    const padL = 64;
    const padR = 20;
    const padT = 46;
    const padB = 46;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB - 30;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const xs = pts.map((d) => 1 / d.T);
    const ys = pts.map((d) => Math.log(d.k));
    const xmin = Math.min(...xs);
    const xmax = Math.max(...xs);
    const ymin = Math.min(...ys);
    const ymax = Math.max(...ys);
    const spanX = Math.max(xmax - xmin, 1e-12);
    const spanY = Math.max(ymax - ymin, 1e-12);
    const px = (v: number) => x0 + 8 + ((plotW - 16) * (v - xmin)) / spanX;
    const py = (v: number) => y1 - 8 - ((plotH - 16) * (v - ymin)) / spanY;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // fit line
    g.strokeStyle = 'rgba(255,180,110,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px(xmin), py(f.lnA + (-f.ea * 1000 / 8.314462618) * xmin));
    g.lineTo(px(xmax), py(f.lnA + (-f.ea * 1000 / 8.314462618) * xmax));
    g.stroke();
    // scatter
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (const d of pts) {
      g.beginPath();
      g.arc(px(1 / d.T), py(Math.log(d.k)), 3.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(200,214,232,0.85)';
      g.font = '10px Consolas, monospace';
      g.textAlign = 'center';
      g.fillText(`${Math.round(d.T)}K`, px(1 / d.T), py(Math.log(d.k)) - 8);
      g.fillStyle = 'rgba(255,255,255,0.95)';
    }
    g.lineWidth = 1;

    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText('ln k', x0 - 8, y0 - 8);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.font = `11px Consolas, monospace`;
    g.fillText('1/T (K⁻¹)', (x0 + x1) / 2, y1 + 16);

    // annotation box
    g.textAlign = 'left';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(255,210,150,0.98)';
    g.fillText(
      zh
        ? `Ea = ${f.ea.toFixed(2)} ± ${f.eaSe.toFixed(3)} kJ/mol   A = ${f.a.toExponential(3)}   R² = ${f.r2.toFixed(6)}   n=${f.n}`
        : `Ea = ${f.ea.toFixed(2)} ± ${f.eaSe.toFixed(3)} kJ/mol   A = ${f.a.toExponential(3)}   R² = ${f.r2.toFixed(6)}   n=${f.n}`,
      56,
      canvas.height - 34,
    );
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh ? 'ln k = ln A − Ea/(R·T)，斜率 = −Ea/R（自实现 OLS，含斜率标准误）' : 'ln k = ln A − Ea/(R·T), slope = −Ea/R (self-implemented OLS with slope SE)',
      56,
      canvas.height - 16,
    );
  }
}

export default function createChemReactionOrderPlugin(): Plugin {
  return new ChemReactionOrderPlugin();
}
