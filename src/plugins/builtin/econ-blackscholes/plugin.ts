// ==========================================================================
// econ-blackscholes — Black-Scholes-Merton option pricing laboratory
//
// A 2-D scientific workbench: the top panel draws analytic call/put prices
// against the spot; the bottom panel shows the Monte Carlo convergence trace
// (cumulative mean ± 1.96·SE band around the analytic price). Every redraw
// republishes structured scientific outputs (analytic prices, MC price with
// confidence interval, MC-analytic gap in SE units, parity residual), and a
// one-click benchmark runs the four embedded validation checks.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { blackscholesManifest } from './manifest';
import {
  bsGreeks,
  bsPrices,
  DEFAULT_BS_PARAMS,
  mcPrices,
  parityResidual,
  runBlackscholesBenchmark,
  spotCurve,
  type BSParams,
} from './kernel';

export { blackscholesManifest } from './manifest';

interface State {
  S: number;
  K: number;
  r: number;
  q: number;
  sigma: number;
  T: number;
  paths: number;
  seed: number;
}

const PATH_OPTIONS = ['10000', '25000', '50000', '100000', '200000'];

export class BlackscholesPlugin implements Plugin {
  readonly manifest = blackscholesManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    S: DEFAULT_BS_PARAMS.S,
    K: DEFAULT_BS_PARAMS.K,
    r: DEFAULT_BS_PARAMS.r,
    q: DEFAULT_BS_PARAMS.q,
    sigma: DEFAULT_BS_PARAMS.sigma,
    T: DEFAULT_BS_PARAMS.T,
    paths: 50_000,
    seed: 20260922,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
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

  private params(): BSParams {
    return {
      S: this.state.S,
      K: this.state.K,
      r: this.state.r,
      q: this.state.q,
      sigma: this.state.sigma,
      T: this.state.T,
    };
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'S',
        label: 'Spot S',
        labelI18n: { 'zh-CN': '标的价格 S', 'en-US': 'Spot S' },
        type: 'range',
        min: 1,
        max: 400,
        step: 1,
        value: this.state.S,
      },
      {
        key: 'K',
        label: 'Strike K',
        labelI18n: { 'zh-CN': '行权价 K', 'en-US': 'Strike K' },
        type: 'range',
        min: 1,
        max: 400,
        step: 1,
        value: this.state.K,
      },
      {
        key: 'r',
        label: 'Rate r',
        labelI18n: { 'zh-CN': '无风险利率 r', 'en-US': 'Risk-free r' },
        type: 'range',
        min: 0,
        max: 0.2,
        step: 0.005,
        value: this.state.r,
      },
      {
        key: 'q',
        label: 'Dividend q',
        labelI18n: { 'zh-CN': '股息率 q', 'en-US': 'Dividend q' },
        type: 'range',
        min: 0,
        max: 0.15,
        step: 0.005,
        value: this.state.q,
      },
      {
        key: 'sigma',
        label: 'Vol σ',
        labelI18n: { 'zh-CN': '波动率 σ', 'en-US': 'Volatility σ' },
        type: 'range',
        min: 0.01,
        max: 1,
        step: 0.01,
        value: this.state.sigma,
      },
      {
        key: 'T',
        label: 'Maturity T',
        labelI18n: { 'zh-CN': '期限 T（年）', 'en-US': 'Maturity T (y)' },
        type: 'range',
        min: 0.02,
        max: 5,
        step: 0.02,
        value: this.state.T,
      },
      {
        key: 'paths',
        label: 'MC paths',
        labelI18n: { 'zh-CN': 'MC 路径数', 'en-US': 'MC paths' },
        type: 'select',
        options: PATH_OPTIONS.map((v) => ({
          value: v,
          label: v,
          labelI18n: { 'zh-CN': v, 'en-US': v },
        })),
        value: String(this.state.paths),
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'range',
        min: 1,
        max: 999999,
        step: 1,
        value: this.state.seed,
        hint: this.zh ? '固定种子 ⇒ 结果可复现' : 'fixed seed ⇒ reproducible results',
      },
      actionButton('run', 'Run Monte Carlo', '运行蒙特卡洛', 'primary'),
      actionButton('benchmark', 'Run benchmark', '运行基准验证'),
      actionButton('exportCurve', 'Export price curve', '导出价格曲线'),
      actionButton('exportMc', 'Export MC trace', '导出 MC 轨迹'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    const num = (k: string, apply: (n: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        apply(params[k] as number);
      }
    };
    num('S', (n) => {
      this.state.S = Math.max(0.01, n);
      changed = true;
    });
    num('K', (n) => {
      this.state.K = Math.max(0.01, n);
      changed = true;
    });
    num('r', (n) => {
      this.state.r = n;
      changed = true;
    });
    num('q', (n) => {
      this.state.q = n;
      changed = true;
    });
    num('sigma', (n) => {
      this.state.sigma = Math.max(0.005, n);
      changed = true;
    });
    num('T', (n) => {
      this.state.T = Math.max(0.01, n);
      changed = true;
    });
    num('seed', (n) => {
      this.state.seed = Math.max(1, Math.round(n));
      changed = true;
    });
    if (typeof params.paths === 'string' && PATH_OPTIONS.includes(params.paths)) {
      const p = Number(params.paths);
      if (p !== this.state.paths) {
        this.state.paths = p;
        changed = true;
      }
    }

    if (actionFired(params, 'run')) changed = true;
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCurve')) this.exportCurve();
    if (actionFired(params, 'exportMc')) this.exportMc();
    if (changed) this.draw();
  }

  // ---- scientific outputs ---------------------------------------------------

  private publishOutputs(): void {
    const p = this.params();
    const an = bsPrices(p);
    const mc = mcPrices(p, this.state.paths, this.state.seed).result;
    const seUnits = mc.call.se > 0 ? (mc.call.mean - an.call) / mc.call.se : 0;
    const parity = parityResidual(p);
    const provenance = this.zh
      ? `MC：${mc.paths} 路径（GBM，固定种子 ${this.state.seed}）`
      : `MC: ${mc.paths} GBM paths (fixed seed ${this.state.seed})`;
    const metrics: ScienceMetric[] = [
      { key: 'bs-call', label: 'BS call', value: fmtMetric(an.call), severity: 'info', hint: this.zh ? 'BSM 解析价' : 'analytic BSM price' },
      { key: 'bs-put', label: 'BS put', value: fmtMetric(an.put), severity: 'info', hint: this.zh ? 'BSM 解析价' : 'analytic BSM price' },
      {
        key: 'mc-call',
        label: 'MC call ± 95% CI',
        value: `${fmtMetric(mc.call.mean)} ± ${fmtMetric(1.959963984540054 * mc.call.se)}`,
        severity: 'info',
        hint: provenance,
      },
      {
        key: 'mc-put',
        label: 'MC put ± 95% CI',
        value: `${fmtMetric(mc.put.mean)} ± ${fmtMetric(1.959963984540054 * mc.put.se)}`,
        severity: 'info',
        hint: provenance,
      },
      {
        key: 'mc-gap-se',
        label: 'MC − analytic',
        value: `${seUnits >= 0 ? '+' : ''}${seUnits.toFixed(2)} SE`,
        severity: Math.abs(seUnits) < 3 ? 'ok' : 'warn',
        hint:
          (this.zh ? '统一口径：|计算−解析|/SE，< 3·SE 为通过' : 'uniform metric: |computed - analytic| / SE, pass if < 3·SE') +
          ` (${fmtMetric(Math.abs(mc.call.mean - an.call))})`,
      },
      {
        key: 'parity',
        label: 'Parity residual',
        value: fmtMetric(Math.abs(parity)),
        severity: Math.abs(parity) < 1e-10 ? 'ok' : 'error',
        hint: this.zh
          ? 'C − P = S·e^{−qT} − K·e^{−rT}（解析侧恒等式）'
          : 'C - P = S·e^{-qT} - K·e^{-rT} (analytic identity)',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const b = runBlackscholesBenchmark();
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-status',
        label: 'Benchmark',
        value: b.pass ? (this.zh ? '全部通过' : 'ALL PASS') : this.zh ? '未通过' : 'FAIL',
        severity: b.pass ? 'ok' : 'error',
        hint: this.zh
          ? '典型参数 S=100,K=100,r=5%,σ=20%,T=1（内置基准，非用户数据）'
          : 'typical params S=100, K=100, r=5%, σ=20%, T=1 (embedded benchmark, not user data)',
      },
      {
        key: 'bench-mc',
        label: 'MC vs analytic',
        value: `${b.mcSeUnits.toFixed(2)} SE`,
        severity: b.mcSeUnits < 3 ? 'ok' : 'warn',
        hint: this.zh
          ? `|MC−解析|=${fmtMetric(b.mcAbsErr)}，判据 < 3·SE（10 万路径，种子 ${20260922}）`
          : `|MC - analytic|=${fmtMetric(b.mcAbsErr)}, criterion < 3·SE (100k paths, seed ${20260922})`,
      },
      {
        key: 'bench-parity',
        label: 'Parity residual',
        value: fmtMetric(b.parity),
        severity: b.parity < 1e-10 ? 'ok' : 'error',
        hint: this.zh ? '判据 < 1e-10' : 'criterion < 1e-10',
      },
      {
        key: 'bench-cdf',
        label: 'N(1.96) error',
        value: fmtMetric(b.cdfErr196),
        severity: b.cdfErr196 < 1e-7 ? 'ok' : 'warn',
        hint: this.zh ? '基准 0.9750021048517795，判据 < 1e-7（A&S 26.2.17）' : 'reference 0.9750021048517795, criterion < 1e-7 (A&S 26.2.17)',
      },
      {
        key: 'bench-delta',
        label: 'Delta FD error',
        value: fmtMetric(b.deltaFdErr),
        severity: b.deltaFdErr < 1e-3 ? 'ok' : 'warn',
        hint: this.zh ? '解析 Delta 对照中心有限差分，判据 < 1e-3' : 'analytic Delta vs central finite difference, criterion < 1e-3',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.pass ? 'success' : 'warning',
      `Benchmark ${b.pass ? 'passed' : 'FAILED'}: MC ${b.mcSeUnits.toFixed(2)}·SE, parity ${fmtMetric(b.parity)}, N(1.96) err ${fmtMetric(b.cdfErr196)}, Δ err ${fmtMetric(b.deltaFdErr)}`,
      `基准验证${b.pass ? '通过' : '未通过'}：MC ${b.mcSeUnits.toFixed(2)}·SE，平价残差 ${fmtMetric(b.parity)}，N(1.96) 误差 ${fmtMetric(b.cdfErr196)}，Δ 误差 ${fmtMetric(b.deltaFdErr)}`,
    );
  }

  // ---- exports ----------------------------------------------------------------

  private exportCurve() {
    const p = this.params();
    const sMin = Math.max(0.5, p.K * 0.5);
    const sMax = p.K * 1.5;
    const rows: Array<Array<number | string>> = spotCurve(p, sMin, sMax, 121).map((pt) => [
      Number(pt.s.toFixed(4)),
      Number(pt.call.toFixed(6)),
      Number(pt.put.toFixed(6)),
    ]);
    exportRowsCsv(this.api, 'bs-price-curve', ['spot', 'call_analytic', 'put_analytic'], rows);
  }

  private exportMc() {
    const p = this.params();
    const { trace } = mcPrices(p, this.state.paths, this.state.seed);
    const rows: Array<Array<number | string>> = trace.map((t) => [
      t.n,
      Number(t.callMean.toFixed(8)),
      Number(t.putMean.toFixed(8)),
    ]);
    exportRowsCsv(this.api, 'bs-mc-trace', ['paths', 'call_cum_mean', 'put_cum_mean'], rows);
  }

  // ---- drawing --------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const an = bsPrices(this.params());
    const mc = mcPrices(this.params(), this.state.paths, this.state.seed);
    this.drawCurvePanel(g, canvas, an);
    this.drawConvergencePanel(g, canvas, an.call, mc);
    this.drawFooter(g, canvas, an);
    this.publishOutputs();
  }

  private drawCurvePanel(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, an: { call: number; put: number }) {
    const zh = this.zh;
    const W = canvas.width;
    const H = canvas.height;
    const x0 = 56;
    const x1 = W - 132;
    const y0 = 40;
    const y1 = Math.floor(H * 0.52);
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? 'BSM 期权价格 vs 标的价格（解析）' : 'BSM option price vs spot (analytic)', (x0 + x1) / 2, 22);

    const p = this.params();
    const sMin = Math.max(0.5, p.K * 0.5);
    const sMax = p.K * 1.5;
    const pts = spotCurve(p, sMin, sMax, 121);
    const yMax = Math.max(pts[pts.length - 1]!.call, an.call * 1.3, 0.5) * 1.08;
    const px = (s: number) => x0 + (plotW * (s - sMin)) / (sMax - sMin);
    const py = (v: number) => y1 - (plotH * v) / yMax;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    for (let i = 0; i <= 4; i += 1) {
      const v = (yMax * i) / 4;
      const sy = py(v);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(v.toFixed(1), x0 - 5, sy + 3);
    }
    g.textAlign = 'center';
    for (let i = 0; i <= 4; i += 1) {
      const s = sMin + ((sMax - sMin) * i) / 4;
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(s.toFixed(0), px(s), y1 + 13);
    }

    const line = (key: 'call' | 'put', color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      pts.forEach((pt, i) => {
        if (i === 0) g.moveTo(px(pt.s), py(pt[key]));
        else g.lineTo(px(pt.s), py(pt[key]));
      });
      g.stroke();
    };
    line('put', 'rgba(250,180,110,0.95)');
    line('call', 'rgba(110,190,255,0.95)');

    // current spot marker
    const sx = px(p.S);
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(sx, y0);
    g.lineTo(sx, y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(sx, py(an.call), 3.5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(sx, py(an.put), 3.5, 0, Math.PI * 2);
    g.fill();

    // legend
    const legend: Array<[string, string]> = [
      ['rgba(110,190,255,0.95)', zh ? '看涨 C(S)' : 'call C(S)'],
      ['rgba(250,180,110,0.95)', zh ? '看跌 P(S)' : 'put P(S)'],
      ['rgba(255,255,255,0.95)', zh ? '当前 S' : 'current S'],
    ];
    g.textAlign = 'left';
    let ly = y0 + 4;
    for (const [c, label] of legend) {
      g.fillStyle = c;
      g.fillRect(x1 + 10, ly, 14, 3);
      g.fillText(label, x1 + 28, ly + 6);
      ly += 15;
    }
  }

  private drawConvergencePanel(
    g: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    analytic: number,
    mc: ReturnType<typeof mcPrices>,
  ) {
    const zh = this.zh;
    const W = canvas.width;
    const H = canvas.height;
    const x0 = 56;
    const x1 = W - 132;
    const y0 = Math.floor(H * 0.52) + 20;
    const y1 = H - 48;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const se = mc.result.call.se;
    const span = Math.max(3.2 * se, Math.abs(analytic) * 0.06, 0.2);
    const yMin = analytic - span;
    const yMax = analytic + span;
    const n = mc.result.paths;
    const px = (k: number) => x0 + (plotW * k) / n;
    const py = (v: number) => y1 - (plotH * (v - yMin)) / (yMax - yMin);

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh ? `蒙特卡洛收敛（call 累计均值 ± 1.96·SE，${n} 路径）` : `Monte Carlo convergence (call cumulative mean ± 1.96·SE, ${n} paths)`,
      (x0 + x1) / 2,
      y0 - 6,
    );

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // ±1.96·SE band around the analytic reference
    const bandTop = py(analytic + 1.959963984540054 * se);
    const bandBot = py(analytic - 1.959963984540054 * se);
    g.fillStyle = 'rgba(110,190,255,0.10)';
    g.fillRect(x0, bandTop, plotW, Math.max(bandBot - bandTop, 1));
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(x0, py(analytic));
    g.lineTo(x1, py(analytic));
    g.stroke();
    g.setLineDash([]);

    // cumulative mean trace
    g.strokeStyle = 'rgba(110,190,255,0.95)';
    g.lineWidth = 1.5;
    g.beginPath();
    mc.trace.forEach((t, i) => {
      if (i === 0) g.moveTo(px(t.n), py(t.callMean));
      else g.lineTo(px(t.n), py(t.callMean));
    });
    g.stroke();

    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    for (let i = 0; i <= 4; i += 1) {
      const v = yMin + ((yMax - yMin) * i) / 4;
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(v.toFixed(2), x0 - 5, py(v) + 3);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('0', x0, y1 + 13);
    g.fillText(String(n), x1 - 24, y1 + 13);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(zh ? '解析价' : 'analytic', x1, py(analytic) - 5);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, an: { call: number; put: number }) {
    const gr = bsGreeks(this.params());
    g.textAlign = 'left';
    g.font = `11px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = `S=${this.state.S}  K=${this.state.K}  r=${this.state.r.toFixed(3)}  q=${this.state.q.toFixed(3)}  σ=${this.state.sigma.toFixed(2)}  T=${this.state.T.toFixed(2)}`;
    g.fillText(l1, 56, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = `C=${an.call.toFixed(4)}  P=${an.put.toFixed(4)}  Δ=${gr.deltaCall.toFixed(4)}  Γ=${gr.gamma.toFixed(5)}  Vega=${gr.vega.toFixed(3)}  θ=${gr.thetaCall.toFixed(3)}`;
    g.fillText(l2, 56, canvas.height - 14);
  }
}

export default function createBlackscholesPlugin(): Plugin {
  return new BlackscholesPlugin();
}
