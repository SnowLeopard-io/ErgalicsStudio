// ==========================================================================
// geo-soilwater — van Genuchten soil water characteristic curve workbench
//
// Loads θ(h) retention data (columns h, theta), fits the van Genuchten (1980)
// constrained-m model with Levenberg-Marquardt (box bounds, covariance
// standard errors), and draws the semi-log retention curve with the data
// points plus a residual strip. Scientific outputs publish θr/θs/α/n with
// their standard errors and the RMSE; derived quantities (specific moisture
// capacity C(h), effective saturation, Young-Laplace equivalent pore radius)
// are shown in the canvas footer. The seeded sand-parameter recovery
// benchmark and the C(h) derivative consistency check are one click away.
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
import { soilWaterManifest } from './manifest';
import {
  VG_SAND_1980,
  benchmarkCapacityDerivative,
  benchmarkParameterRecovery,
  benchmarkRmseConvergence,
  equivalentPoreRadiusCm,
  fitVanGenuchten,
  logSpacedHeads,
  parseRetentionData,
  syntheticRetention,
  vgCapacity,
  vgSe,
  vgTheta,
  vgBounds,
  type BoundsPreset,
  type ParsedRetention,
  type RetentionPoint,
  type VGFitResult,
} from './kernel';

export { soilWaterManifest } from './manifest';

interface State {
  thr0: number;
  ths0: number;
  alpha0: number;
  n0: number;
  maxIter: number;
  boundsPreset: BoundsPreset;
}

export class SoilWaterPlugin implements Plugin {
  readonly manifest = soilWaterManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private data: RetentionPoint[] | null = null;
  private dataName = '';
  private fit: VGFitResult | null = null;
  private state: State = {
    thr0: 0.05,
    ths0: 0.4,
    alpha0: 0.05,
    n0: 1.8,
    maxIter: 200,
    boundsPreset: 'standard',
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
    const s = this.state;
    return [
      {
        key: 'thr0',
        label: 'θr init',
        labelI18n: { 'zh-CN': '初值 θr', 'en-US': 'θr init' },
        type: 'number',
        min: 0,
        max: 0.3,
        step: 0.005,
        value: s.thr0,
      },
      {
        key: 'ths0',
        label: 'θs init',
        labelI18n: { 'zh-CN': '初值 θs', 'en-US': 'θs init' },
        type: 'number',
        min: 0.1,
        max: 0.7,
        step: 0.01,
        value: s.ths0,
      },
      {
        key: 'alpha0',
        label: 'α init (1/cm)',
        labelI18n: { 'zh-CN': '初值 α (1/cm)', 'en-US': 'α init (1/cm)' },
        type: 'number',
        min: 0.0001,
        max: 1,
        step: 0.005,
        value: s.alpha0,
      },
      {
        key: 'n0',
        label: 'n init',
        labelI18n: { 'zh-CN': '初值 n', 'en-US': 'n init' },
        type: 'number',
        min: 1.01,
        max: 6,
        step: 0.05,
        value: s.n0,
      },
      {
        key: 'boundsPreset',
        label: 'Bounds',
        labelI18n: { 'zh-CN': '参数上下界', 'en-US': 'Parameter bounds' },
        type: 'select',
        options: [
          {
            value: 'standard',
            label: this.zh ? '标准（θr≤0.25, θs∈[0.2,0.6], α≤1, n≤5）' : 'Standard (θr≤0.25, θs∈[0.2,0.6], α≤1, n≤5)',
          },
          {
            value: 'loose',
            label: this.zh ? '宽松（θr≤0.4, θs∈[0.1,0.9], α≤10, n≤10）' : 'Loose (θr≤0.4, θs∈[0.1,0.9], α≤10, n≤10)',
          },
        ],
        value: s.boundsPreset,
      },
      {
        key: 'maxIter',
        label: 'Max iterations',
        labelI18n: { 'zh-CN': '最大迭代次数', 'en-US': 'Max iterations' },
        type: 'range',
        min: 20,
        max: 500,
        step: 10,
        value: s.maxIter,
      },
      actionButton('fit', 'Fit van Genuchten', '拟合 van Genuchten', 'primary'),
      actionButton('demo', 'Demo · seeded sand data', '演示 · 种子砂土数据'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export fit CSV', '导出拟合 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (apply(params[k] as number)) this.draw();
      }
    };
    num('thr0', (n) => {
      if (n === this.state.thr0) return false;
      this.state.thr0 = Math.min(0.3, Math.max(0, n));
      return true;
    });
    num('ths0', (n) => {
      if (n === this.state.ths0) return false;
      this.state.ths0 = Math.min(0.7, Math.max(0.1, n));
      return true;
    });
    num('alpha0', (n) => {
      if (n === this.state.alpha0) return false;
      this.state.alpha0 = Math.min(1, Math.max(0.0001, n));
      return true;
    });
    num('n0', (n) => {
      if (n === this.state.n0) return false;
      this.state.n0 = Math.min(6, Math.max(1.01, n));
      return true;
    });
    num('maxIter', (n) => {
      if (n === this.state.maxIter) return false;
      this.state.maxIter = Math.round(Math.min(500, Math.max(20, n)));
      return true;
    });
    if (typeof params.boundsPreset === 'string' && (params.boundsPreset === 'standard' || params.boundsPreset === 'loose')) {
      if (params.boundsPreset !== this.state.boundsPreset) {
        this.state.boundsPreset = params.boundsPreset as BoundsPreset;
        this.draw();
      }
    }
    if (actionFired(params, 'fit')) this.fitNow('user');
    if (actionFired(params, 'demo')) this.runDemo();
    if (actionFired(params, 'benchmark')) this.runBenchmarks();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv') && !low.endsWith('.txt')) {
      notify(this.api, 'warning', 'Retention data must be CSV / TSV / TXT with h,theta columns.', '持水数据须为含 h,theta 列的 CSV / TSV / TXT。');
      return;
    }
    const text = await file.text();
    const parsed: ParsedRetention = parseRetentionData(text);
    if (parsed.points.length < 5) {
      notify(this.api, 'warning', 'Need ≥5 h,theta rows.', '至少需要 5 行 h,theta 数据。');
      return;
    }
    this.data = parsed.points;
    this.dataName = file.name + (parsed.percentScaled ? ' (percent → cm³/cm³)' : '');
    this.fitNow('load');
    notify(
      this.api,
      'success',
      `Loaded ${parsed.points.length} retention points${parsed.percentScaled ? ' (percent → cm³/cm³)' : ''}.`,
      `已载入 ${parsed.points.length} 个持水数据点${parsed.percentScaled ? '（百分数 → cm³/cm³）' : ''}。`,
    );
  }

  private fitNow(source: 'user' | 'load' | 'demo') {
    const data = this.data;
    if (!data || data.length < 5) {
      notify(this.api, 'warning', 'Load θ(h) data first (h,theta columns).', '请先载入 θ(h) 数据（h,theta 列）。');
      return;
    }
    const fit = fitVanGenuchten(data, {
      init: { thr: this.state.thr0, ths: this.state.ths0, alpha: this.state.alpha0, n: this.state.n0 },
      bounds: vgBounds(this.state.boundsPreset),
      maxIter: this.state.maxIter,
    });
    if (!fit) {
      notify(this.api, 'warning', 'Fit failed — data cannot constrain the model.', '拟合失败——数据无法约束模型。');
      return;
    }
    this.fit = fit;
    this.publishFit(source);
    const p = fit.params;
    notify(
      this.api,
      'success',
      `Fit: θr=${p.thr.toFixed(4)}, θs=${p.ths.toFixed(4)}, α=${p.alpha.toFixed(4)} 1/cm, n=${p.n.toFixed(3)} (RMSE=${fit.rmse.toFixed(5)}, ${fit.iterations} iters)`,
      `拟合完成：θr=${p.thr.toFixed(4)}，θs=${p.ths.toFixed(4)}，α=${p.alpha.toFixed(4)} 1/cm，n=${p.n.toFixed(3)}（RMSE=${fit.rmse.toFixed(5)}，${fit.iterations} 次迭代）`,
    );
    this.draw();
  }

  private publishFit(source: 'user' | 'load' | 'demo') {
    const fit = this.fit;
    if (!fit) return;
    const p = fit.params;
    const se = fit.stderr;
    const provenance =
      source === 'demo'
        ? this.zh
          ? '数据来源：内置种子合成砂土数据（非实测）'
          : 'source: built-in seeded synthetic sand data (not measured)'
        : this.zh
          ? `数据来源：${this.dataName || '用户数据集'}`
          : `source: ${this.dataName || 'user dataset'}`;
    const fmt = (v: number, e: number | undefined): string =>
      e == null ? fmtMetric(v) : `${fmtMetric(v)} ± ${fmtMetric(e)}`;
    const metrics: ScienceMetric[] = [
      {
        key: 'vg-thr',
        label: 'θr',
        value: fmt(p.thr, se?.thr),
        unit: 'cm³/cm³',
        severity: 'info',
        hint: provenance,
      },
      {
        key: 'vg-ths',
        label: 'θs',
        value: fmt(p.ths, se?.ths),
        unit: 'cm³/cm³',
        severity: 'info',
        hint: provenance,
      },
      {
        key: 'vg-alpha',
        label: 'α',
        value: fmt(p.alpha, se?.alpha),
        unit: '1/cm',
        severity: 'info',
        hint: provenance,
      },
      {
        key: 'vg-n',
        label: 'n',
        value: fmt(p.n, se?.n),
        severity: 'info',
        hint: provenance,
      },
      {
        key: 'vg-rmse',
        label: 'RMSE',
        value: fmtMetric(fit.rmse),
        unit: 'cm³/cm³',
        severity: fit.rmse < 0.01 ? 'ok' : 'warn',
        hint: this.zh ? `${fit.iterations} 次迭代，收敛=${fit.converged ? '是' : '否'}` : `${fit.iterations} iterations, converged=${fit.converged}`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runDemo() {
    const heads = logSpacedHeads(1, 15000, 24);
    this.data = syntheticRetention(VG_SAND_1980, heads, 0.01, 20260922);
    this.dataName = this.zh ? '种子合成砂土数据（van Genuchten 1980 表 1 参数）' : 'seeded synthetic sand data (van Genuchten 1980 Table 1 params)';
    this.fitNow('demo');
  }

  private runBenchmarks() {
    const outcomes = [benchmarkParameterRecovery(), benchmarkCapacityDerivative(), benchmarkRmseConvergence()];
    const metrics: ScienceMetric[] = outcomes.map((o) => ({
      key: `bench-${o.name}`,
      label: `Bench · ${o.name}`,
      value: o.passed ? (o.relErr == null ? 'ok' : `${(o.relErr * 100).toFixed(3)}%`) : 'FAIL',
      severity: o.passed ? 'ok' : 'warn',
      hint: o.detail,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    const allOk = outcomes.every((o) => o.passed);
    notify(
      this.api,
      allOk ? 'success' : 'warning',
      `Benchmarks: ${outcomes.map((o) => `${o.name}=${o.passed ? 'pass' : 'FAIL'}`).join(', ')}`,
      `基准验证：${outcomes.map((o) => `${o.name}=${o.passed ? '通过' : '未通过'}`).join('，')}`,
    );
    this.draw();
  }

  private exportCsv() {
    if (!this.data || !this.fit) {
      notify(this.api, 'warning', 'Run a fit first.', '请先运行一次拟合。');
      return;
    }
    const rows: Array<Array<number | string>> = this.data.map((d, i) => {
      const se = vgSe(d.h, this.fit!.params);
      const cap = vgCapacity(d.h, this.fit!.params);
      const r = equivalentPoreRadiusCm(d.h);
      return [
        Number(d.h.toFixed(3)),
        Number(d.theta.toFixed(6)),
        Number(this.fit!.fitted[i]!.toFixed(6)),
        Number(this.fit!.residuals[i]!.toFixed(6)),
        Number(se.toFixed(5)),
        Number(cap.toExponential(4)),
        Number(r.toExponential(4)),
      ];
    });
    exportRowsCsv(
      this.api,
      'vg-retention-fit',
      ['h_cm', 'theta_obs', 'theta_fit', 'residual', 'se_effective', 'capacity_1_over_cm', 'pore_radius_cm'],
      rows,
    );
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
    if (!this.data || this.data.length === 0) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No retention data',
        titleZh: '尚未载入持水数据',
        hint: 'Load θ(h) data (CSV columns h, theta) via the sample-data bar or Open File, or use the seeded demo action.',
        hintZh: '请通过示例数据栏或「打开文件」载入 θ(h) 数据（CSV 列：h, theta），或使用种子演示数据。',
      });
      return;
    }
    const zh = this.zh;
    this.drawRetention(g, canvas, zh);
    this.drawResiduals(g, canvas, zh);
    this.drawFooter(g, canvas, zh);
  }

  private drawRetention(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const data = this.data!;
    const fit = this.fit;
    const mainBottom = canvas.height * 0.68;
    const padL = 56;
    const padR = 20;
    const padT = 42;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = mainBottom;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    // Semi-log x axis: suction (cm) from slightly below min to above max.
    const hMin = Math.min(...data.map((d) => d.h));
    const hMax = Math.max(...data.map((d) => d.h));
    const logMin = Math.log10(Math.max(hMin * 0.7, 0.1));
    const logMax = Math.log10(hMax * 1.4);
    let thMax = Math.max(...data.map((d) => d.theta));
    if (fit) thMax = Math.max(thMax, fit.params.ths);
    const thMin = Math.min(...data.map((d) => d.theta), fit ? fit.params.thr : 1);
    const thLo = Math.max(0, thMin - 0.03);
    const thHi = Math.min(1, thMax + 0.03);

    const px = (h: number) => x0 + ((Math.log10(Math.max(h, 1e-3)) - logMin) / (logMax - logMin)) * plotW;
    const py = (t: number) => y1 - ((t - thLo) / (thHi - thLo)) * plotH;

    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(
      zh ? 'van Genuchten 持水曲线拟合（半对数）' : 'van Genuchten retention fit (semi-log)',
      canvas.width / 2,
      20,
    );
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // x ticks at decades
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = '11px Consolas, monospace';
    for (let d = Math.ceil(logMin); d <= Math.floor(logMax); d += 1) {
      const sx = px(Math.pow(10, d));
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.textAlign = 'center';
      g.fillText(`1e${d}`, sx, y1 + 14);
    }
    for (let i = 0; i <= 4; i += 1) {
      const t = thLo + ((thHi - thLo) * i) / 4;
      const sy = py(t);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillText(t.toFixed(2), x0 - 6, sy + 4);
    }

    // fitted curve
    if (fit) {
      g.strokeStyle = 'rgba(140,190,250,0.95)';
      g.lineWidth = 2;
      g.beginPath();
      const n = 200;
      for (let i = 0; i <= n; i += 1) {
        const h = Math.pow(10, logMin + ((logMax - logMin) * i) / n);
        const sy = py(vgTheta(h, fit.params));
        if (i === 0) g.moveTo(px(h), sy);
        else g.lineTo(px(h), sy);
      }
      g.stroke();
      g.lineWidth = 1;
    }

    // data points
    g.fillStyle = 'rgba(235,240,247,0.95)';
    for (const d of data) {
      g.beginPath();
      g.arc(px(d.h), py(d.theta), 3.2, 0, Math.PI * 2);
      g.fill();
    }

    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('θ (cm³/cm³)', x0 + 6, y0 + 14);
    g.textAlign = 'right';
    g.fillText(zh ? '吸力 |h| (cm)' : 'suction |h| (cm)', x1, y1 + 28);
  }

  private drawResiduals(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const data = this.data!;
    const fit = this.fit;
    const y0 = canvas.height * 0.68 + 12;
    const y1 = canvas.height - 44;
    if (y1 - y0 < 24) return;
    const padL = 56;
    const padR = 20;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    const hMin = Math.min(...data.map((d) => d.h));
    const hMax = Math.max(...data.map((d) => d.h));
    const logMin = Math.log10(Math.max(hMin * 0.7, 0.1));
    const logMax = Math.log10(hMax * 1.4);
    const residuals = fit ? fit.residuals : data.map(() => 0);
    const maxAbs = Math.max(Math.max(...residuals.map((r) => Math.abs(r))), 1e-6);
    const px = (h: number) => x0 + ((Math.log10(Math.max(h, 1e-3)) - logMin) / (logMax - logMin)) * plotW;
    const py = (r: number) => y1 - ((r + maxAbs) / (2 * maxAbs)) * plotH;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.moveTo(x0, py(0));
    g.lineTo(x1, py(0));
    g.stroke();

    if (!fit) {
      g.fillStyle = 'rgba(150,165,185,0.85)';
      g.font = '11px Consolas, monospace';
      g.textAlign = 'center';
      g.fillText(zh ? '未拟合：点击「拟合 van Genuchten」' : 'not fitted: press "Fit van Genuchten"', (x0 + x1) / 2, (y0 + y1) / 2);
      return;
    }
    g.fillStyle = 'rgba(250,205,120,0.95)';
    for (let i = 0; i < data.length; i += 1) {
      g.beginPath();
      g.arc(px(data[i]!.h), py(residuals[i]!), 2.6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    g.fillText(`+${maxAbs.toFixed(3)}`, x0 - 6, y0 + 8);
    g.fillText(`−${maxAbs.toFixed(3)}`, x0 - 6, y1);
    g.textAlign = 'left';
    g.fillText(zh ? '残差 (obs−fit)' : 'residuals (obs−fit)', x0 + 6, y0 + 10);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const fit = this.fit;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    if (!fit) {
      g.fillStyle = 'rgba(170,182,200,0.95)';
      g.fillText(
        zh ? '载入 h,theta 数据后按「拟合 van Genuchten」' : 'Load h,theta data, then press "Fit van Genuchten"',
        54,
        canvas.height - 14,
      );
      return;
    }
    const p = fit.params;
    // Derived quantities at field capacity (h = 330 cm) as a physical anchor.
    const fc = vgTheta(330, p);
    const capFc = vgCapacity(330, p);
    const rFc = equivalentPoreRadiusCm(330);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = `θr=${p.thr.toFixed(4)}  θs=${p.ths.toFixed(4)}  α=${p.alpha.toFixed(4)} 1/cm  n=${p.n.toFixed(3)}  RMSE=${fit.rmse.toFixed(5)}`;
    g.fillText(l1, 54, canvas.height - 28);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = zh
      ? `田间持水量 h=330 cm：θ=${fc.toFixed(3)}  Se=${vgSe(330, p).toFixed(3)}  C=${capFc.toExponential(2)} 1/cm  r≈${rFc.toExponential(2)} cm`
      : `field capacity h=330 cm: θ=${fc.toFixed(3)}  Se=${vgSe(330, p).toFixed(3)}  C=${capFc.toExponential(2)} 1/cm  r≈${rFc.toExponential(2)} cm`;
    g.fillText(l2, 54, canvas.height - 12);
  }
}

export default function createSoilWaterPlugin(): Plugin {
  return new SoilWaterPlugin();
}
