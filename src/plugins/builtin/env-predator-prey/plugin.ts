// ==========================================================================
// env-predator-prey — Lotka–Volterra workbench (canvas)
//
// Top panel: phase portrait (prey × predator) with the model orbit, the
// coexistence equilibrium, an optional data orbit and an optional fitted
// orbit. Bottom panel: observed time series when data is loaded, otherwise
// the model time series. "Run validation benchmarks" publishes the
// conservation-drift / orbit-closure / linearized-frequency / fit-recovery
// checks to the scientific-output strip; loading a CSV publishes the
// regression-fitted α/β/γ/δ. All numerics live in ./kernel (pure, DOM-free).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { envPredatorPreyManifest } from './manifest';
import {
  DEFAULT_LV_PARAMS,
  fitLv,
  linearOmega,
  lvConserved,
  lvEquilibrium,
  measurePeriod,
  parseLvCsv,
  runLvBenchmarks,
  simulateLv,
  type LvData,
  type LvFit,
  type LvParams,
} from './kernel';

export { envPredatorPreyManifest } from './manifest';

interface State {
  alpha: number;
  beta: number;
  gamma: number;
  delta: number;
  x0: number;
  y0: number;
  tMax: number;
  data: LvData | null;
  fit: LvFit | null;
}

const MODEL_STEPS = 1500;

export class EnvPredatorPreyPlugin implements Plugin {
  readonly manifest = envPredatorPreyManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    alpha: DEFAULT_LV_PARAMS.alpha,
    beta: DEFAULT_LV_PARAMS.beta,
    gamma: DEFAULT_LV_PARAMS.gamma,
    delta: DEFAULT_LV_PARAMS.delta,
    x0: DEFAULT_LV_PARAMS.x0,
    y0: DEFAULT_LV_PARAMS.y0,
    tMax: 30,
    data: null,
    fit: null,
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

  private params(): LvParams {
    return {
      alpha: this.state.alpha,
      beta: this.state.beta,
      gamma: this.state.gamma,
      delta: this.state.delta,
      x0: this.state.x0,
      y0: this.state.y0,
    };
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'alpha',
        label: 'α',
        labelI18n: { 'zh-CN': '猎物增长率 α', 'en-US': 'Prey growth α' },
        type: 'range',
        min: 0.1,
        max: 3,
        step: 0.05,
        value: this.state.alpha,
      },
      {
        key: 'beta',
        label: 'β',
        labelI18n: { 'zh-CN': '捕食率 β', 'en-US': 'Predation β' },
        type: 'range',
        min: 0.01,
        max: 1,
        step: 0.01,
        value: this.state.beta,
      },
      {
        key: 'gamma',
        label: 'γ',
        labelI18n: { 'zh-CN': '捕食者死亡率 γ', 'en-US': 'Predator mortality γ' },
        type: 'range',
        min: 0.1,
        max: 3,
        step: 0.05,
        value: this.state.gamma,
      },
      {
        key: 'delta',
        label: 'δ',
        labelI18n: { 'zh-CN': '转化率 δ', 'en-US': 'Conversion δ' },
        type: 'range',
        min: 0.05,
        max: 1.5,
        step: 0.05,
        value: this.state.delta,
      },
      {
        key: 'x0',
        label: 'x₀',
        labelI18n: { 'zh-CN': '初始猎物 x₀', 'en-US': 'Initial prey x₀' },
        type: 'range',
        min: 0.5,
        max: 50,
        step: 0.5,
        value: this.state.x0,
      },
      {
        key: 'y0',
        label: 'y₀',
        labelI18n: { 'zh-CN': '初始捕食者 y₀', 'en-US': 'Initial predator y₀' },
        type: 'range',
        min: 0.5,
        max: 50,
        step: 0.5,
        value: this.state.y0,
      },
      {
        key: 'tMax',
        label: 't range',
        labelI18n: { 'zh-CN': '仿真时长', 'en-US': 'Simulated span' },
        type: 'range',
        min: 5,
        max: 60,
        step: 1,
        value: this.state.tMax,
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('applyFit', 'Apply fitted α/β/γ/δ to sliders', '将拟合参数应用到滑块'),
      actionButton('clearData', 'Clear loaded data overlay', '清除数据叠加'),
      actionButton('exportCsv', 'Export model orbit CSV', '导出模型轨道 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: 'alpha' | 'beta' | 'gamma' | 'delta' | 'x0' | 'y0' | 'tMax'): void => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v) && v !== this.state[k]) {
        this.state[k] = v;
        this.draw();
      }
    };
    num('alpha');
    num('beta');
    num('gamma');
    num('delta');
    num('x0');
    num('y0');
    num('tMax');
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'applyFit')) {
      if (!this.state.fit) {
        notify(this.api, 'warning', 'No fitted parameters yet — load a prey/predator CSV first.', '尚无拟合参数——请先加载猎物/捕食者 CSV。');
      } else {
        this.state.alpha = this.state.fit.alpha;
        this.state.beta = this.state.fit.beta;
        this.state.gamma = this.state.fit.gamma;
        this.state.delta = this.state.fit.delta;
        this.draw();
        notify(this.api, 'success', 'Fitted parameters applied to the model sliders.', '拟合参数已应用到模型滑块。');
      }
    }
    if (actionFired(params, 'clearData')) {
      this.state.data = null;
      this.state.fit = null;
      this.draw();
    }
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv') && !low.endsWith('.txt')) {
      notify(
        this.api,
        'warning',
        'env-predator-prey accepts time,prey,predator CSV/TSV/TXT.',
        'env-predator-prey 仅接受 time,prey,predator 的 CSV/TSV/TXT。',
      );
      return;
    }
    const text = await file.text();
    const data = parseLvCsv(text);
    if (data.times.length < 8) {
      notify(
        this.api,
        'error',
        'Need at least 8 complete rows with positive prey and predator counts.',
        '至少需要 8 行猎物与捕食者计数均为正的完整数据。',
      );
      return;
    }
    this.state.data = data;
    const fit = fitLv(data.times, data.x, data.y);
    this.state.fit = fit;
    this.draw();
    const metrics: ScienceMetric[] = [];
    if (fit) {
      const trueP = this.params();
      metrics.push(
        {
          key: 'fit-alpha',
          label: 'fit α',
          value: fmtMetric(fit.alpha),
          unit: '1/t',
          severity: 'info',
          hint: this.zh ? '回归：d(ln x)/dt = α − βy 的截距' : 'intercept of d(ln x)/dt = α − βy',
        },
        { key: 'fit-beta', label: 'fit β', value: fmtMetric(fit.beta), unit: '1/(pop·t)', severity: 'info' },
        {
          key: 'fit-gamma',
          label: 'fit γ',
          value: fmtMetric(fit.gamma),
          unit: '1/t',
          severity: 'info',
          hint: this.zh ? '回归：d(ln y)/dt = δx − γ 的截距（取负）' : 'negated intercept of d(ln y)/dt = δx − γ',
        },
        { key: 'fit-delta', label: 'fit δ', value: fmtMetric(fit.delta), unit: '1/(pop·t)', severity: 'info' },
        {
          key: 'fit-omega',
          label: 'ω₀ = √(α·γ)',
          value: fmtMetric(Math.sqrt(fit.alpha * fit.gamma)),
          unit: 'rad/t',
          severity: 'info',
          hint: this.zh ? `当前滑块模型 ω₀ = ${Math.sqrt(trueP.alpha * trueP.gamma).toFixed(4)}` : `slider model ω₀ = ${Math.sqrt(trueP.alpha * trueP.gamma).toFixed(4)}`,
        },
      );
    }
    const tPer = measurePeriod(data.times, data.x);
    if (tPer) {
      metrics.push({
        key: 'data-period',
        label: this.zh ? '数据周期（猎物峰间距）' : 'data period (prey peak gaps)',
        value: fmtMetric(tPer),
        unit: 't',
        severity: 'info',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      'success',
      fit
        ? `Loaded ${data.times.length} paired observations — fitted α=${fit.alpha.toFixed(4)}, β=${fit.beta.toFixed(4)}, γ=${fit.gamma.toFixed(4)}, δ=${fit.delta.toFixed(4)}.`
        : `Loaded ${data.times.length} paired observations — not enough overlap for a regression fit.`,
      fit
        ? `已加载 ${data.times.length} 组配对观测——拟合 α=${fit.alpha.toFixed(4)}，β=${fit.beta.toFixed(4)}，γ=${fit.gamma.toFixed(4)}，δ=${fit.delta.toFixed(4)}。`
        : `已加载 ${data.times.length} 组配对观测——重叠数据不足，无法回归拟合。`,
    );
  }

  // ---- science outputs ---------------------------------------------------------

  private runBenchmark() {
    const bench = runLvBenchmarks();
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `lv-bench-${b.key}`,
      label: `Bench · ${b.key}`,
      value: b.display,
      unit: '',
      severity: b.pass ? 'ok' : 'error',
      hint: `${b.label} — ${b.hint}`,
    }));
    const p = this.params();
    const eq = lvEquilibrium(p);
    metrics.push({
      key: 'equilibrium',
      label: this.zh ? '共存平衡点' : 'Equilibrium',
      value: `(${eq.xStar.toFixed(2)}, ${eq.yStar.toFixed(2)})`,
      unit: '',
      severity: 'info',
      hint: '(γ/δ, α/β)',
    });
    setScienceOutputs(this.manifest.id, metrics);
    const allPass = bench.every((b) => b.pass);
    notify(
      this.api,
      allPass ? 'success' : 'warning',
      allPass
        ? 'All Lotka–Volterra benchmarks passed.'
        : 'Lotka–Volterra benchmark failed — inspect the science strip.',
      allPass
        ? '全部 Lotka–Volterra 基准通过。'
        : 'Lotka–Volterra 基准未通过——请查看科研输出条。',
    );
  }

  private exportCsv() {
    const p = this.params();
    const s = simulateLv(p, this.state.tMax, MODEL_STEPS);
    const rows: Array<Array<number | string>> = s.times.map((t, i) => [
      Number(t.toFixed(4)),
      Number(s.x[i]!.toFixed(5)),
      Number(s.y[i]!.toFixed(5)),
      Number(lvConserved(s.x[i]!, s.y[i]!, p).toFixed(6)),
    ]);
    exportRowsCsv(this.api, 'env-predator-prey-orbit', ['time', 'prey_x', 'predator_y', 'conserved_V'], rows);
  }

  // ---- drawing -------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const p = this.params();
    const model = simulateLv(p, this.state.tMax, MODEL_STEPS);
    const data = this.state.data;
    const fit = this.state.fit;
    const zh = this.zh;

    const padL = 56;
    const padR = 18;
    const padT = 46;
    const padB = 44;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const plotW = Math.max(x1 - x0, 10);
    const midGap = 18;
    const hA = Math.max((canvas.height - padT - padB - midGap) * 0.56, 30);
    const yA0 = padT;
    const yA1 = yA0 + hA;
    const yB0 = yA1 + midGap;
    const hB = Math.max(canvas.height - padB - yB0, 30);
    const yB1 = yB0 + hB;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `Lotka–Volterra 捕食者-猎物 · α=${p.alpha} β=${p.beta} γ=${p.gamma} δ=${p.delta}`
        : `Lotka–Volterra predator–prey · α=${p.alpha} β=${p.beta} γ=${p.gamma} δ=${p.delta}`,
      canvas.width / 2,
      20,
    );

    // ---- panel A: phase portrait -------------------------------------------------
    let xMax = Math.max(...model.x) * 1.1;
    let yMax = Math.max(...model.y) * 1.1;
    if (data) {
      xMax = Math.max(xMax, ...data.x) * 1.1;
      yMax = Math.max(yMax, ...data.y) * 1.1;
    }
    if (xMax <= 0) xMax = 1;
    if (yMax <= 0) yMax = 1;
    const px = (v: number) => x0 + (plotW * v) / xMax;
    const pyA = (v: number) => yA1 - (hA * v) / yMax;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(x0, yA0, plotW, hA);
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText((yMax * (k / 4)).toFixed(1), x0 - 6, pyA((yMax * k) / 4) + 3);
    }
    g.textAlign = 'center';
    for (let k = 0; k <= 5; k += 1) {
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText((xMax * (k / 5)).toFixed(1), px((xMax * k) / 5), yA0 - 4);
    }

    // equilibrium cross
    const eq = lvEquilibrium(p);
    g.strokeStyle = 'rgba(255, 210, 120, 0.9)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(px(eq.xStar) - 5, pyA(eq.yStar) - 5);
    g.lineTo(px(eq.xStar) + 5, pyA(eq.yStar) + 5);
    g.moveTo(px(eq.xStar) + 5, pyA(eq.yStar) - 5);
    g.lineTo(px(eq.xStar) - 5, pyA(eq.yStar) + 5);
    g.stroke();

    // fitted orbit (dashed cyan) from the data's initial condition
    if (fit && data) {
      const fitted = simulateLv({ ...fit, x0: data.x[0]!, y0: data.y[0]! }, data.times[data.times.length - 1]! - data.times[0]!, 1200);
      g.strokeStyle = 'rgba(90, 220, 230, 0.85)';
      g.setLineDash([5, 4]);
      g.lineWidth = 1.4;
      g.beginPath();
      for (let i = 0; i < fitted.x.length; i += 1) {
        const sx = px(fitted.x[i]!);
        const sy = pyA(fitted.y[i]!);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
      g.setLineDash([]);
    }

    // data orbit (orange markers)
    if (data) {
      g.fillStyle = 'rgba(240, 170, 110, 0.9)';
      const stride = Math.max(1, Math.floor(data.times.length / 120));
      for (let i = 0; i < data.times.length; i += stride) {
        g.beginPath();
        g.arc(px(data.x[i]!), pyA(data.y[i]!), 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }

    // model orbit (blue)
    g.strokeStyle = 'rgba(120, 200, 250, 0.95)';
    g.lineWidth = 1.8;
    g.beginPath();
    for (let i = 0; i < model.x.length; i += 1) {
      const sx = px(model.x[i]!);
      const sy = pyA(model.y[i]!);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();

    g.textAlign = 'left';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(zh ? '相图：y 捕食者 vs x 猎物' : 'phase: predator y vs prey x', x0 + 4, yA0 + 12);

    // ---- panel B: time series ------------------------------------------------------
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, yB0, plotW, hB);
    if (data) {
      const tA = data.times[0]!;
      const tB = data.times[data.times.length - 1]!;
      const span = tB - tA || 1;
      const pxT = (t: number) => x0 + (plotW * (t - tA)) / span;
      let dMax = Math.max(...data.x, ...data.y) * 1.1;
      if (dMax <= 0) dMax = 1;
      const pyB = (v: number) => yB1 - (hB * v) / dMax;
      const drawDataLine = (arr: number[], color: string): void => {
        g.strokeStyle = color;
        g.lineWidth = 1.4;
        g.beginPath();
        for (let i = 0; i < arr.length; i += 1) {
          const sx = pxT(data.times[i]!);
          const sy = pyB(arr[i]!);
          if (i === 0) g.moveTo(sx, sy);
          else g.lineTo(sx, sy);
        }
        g.stroke();
      };
      drawDataLine(data.x, 'rgba(240, 170, 110, 0.95)');
      drawDataLine(data.y, 'rgba(120, 200, 250, 0.95)');
      g.textAlign = 'right';
      g.font = '10px Consolas, monospace';
      for (let k = 0; k <= 3; k += 1) {
        const v = (dMax * k) / 3;
        g.fillStyle = 'rgba(170,182,200,0.9)';
        g.fillText(v >= 10000 ? `${Math.round(v / 1000)}k` : v.toFixed(0), x0 - 6, pyB(v) + 3);
      }
      g.textAlign = 'center';
      for (let k = 0; k <= 5; k += 1) {
        const t = tA + (span * k) / 5;
        g.fillStyle = 'rgba(170,182,200,0.9)';
        g.fillText(t.toFixed(0), pxT(t), yB1 + 14);
      }
      g.textAlign = 'left';
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillStyle = 'rgba(240, 170, 110, 0.95)';
      g.fillText(zh ? '猎物（野兔）' : 'prey (hare)', x0 + 4, yB0 + 12);
      g.fillStyle = 'rgba(120, 200, 250, 0.95)';
      g.fillText(zh ? '捕食者（猞猁）' : 'predator (lynx)', x0 + 90, yB0 + 12);
    } else {
      const tSpan = model.times[model.times.length - 1]!;
      const pxT = (t: number) => x0 + (plotW * t) / tSpan;
      const mMax = Math.max(Math.max(...model.x), Math.max(...model.y)) * 1.1;
      const pyB = (v: number) => yB1 - (hB * v) / mMax;
      const drawLine = (arr: number[], color: string): void => {
        g.strokeStyle = color;
        g.lineWidth = 1.4;
        g.beginPath();
        for (let i = 0; i < arr.length; i += 1) {
          const sx = pxT(model.times[i]!);
          const sy = pyB(arr[i]!);
          if (i === 0) g.moveTo(sx, sy);
          else g.lineTo(sx, sy);
        }
        g.stroke();
      };
      drawLine(model.x, 'rgba(240, 170, 110, 0.95)');
      drawLine(model.y, 'rgba(120, 200, 250, 0.95)');
      g.textAlign = 'right';
      g.font = '10px Consolas, monospace';
      for (let k = 0; k <= 3; k += 1) {
        const v = (mMax * k) / 3;
        g.fillStyle = 'rgba(170,182,200,0.9)';
        g.fillText(v.toFixed(1), x0 - 6, pyB(v) + 3);
      }
      g.textAlign = 'center';
      for (let k = 0; k <= 6; k += 1) {
        const t = (tSpan * k) / 6;
        g.fillStyle = 'rgba(170,182,200,0.9)';
        g.fillText(t.toFixed(1), pxT(t), yB1 + 14);
      }
      g.textAlign = 'left';
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillStyle = 'rgba(240, 170, 110, 0.95)';
      g.fillText(zh ? '猎物 x(t)' : 'prey x(t)', x0 + 4, yB0 + 12);
      g.fillStyle = 'rgba(120, 200, 250, 0.95)';
      g.fillText(zh ? '捕食者 y(t)' : 'predator y(t)', x0 + 70, yB0 + 12);
    }

    // footer
    const vNow = lvConserved(model.x[0]!, model.y[0]!, p);
    const vEnd = lvConserved(model.x[model.x.length - 1]!, model.y[model.y.length - 1]!, p);
    const drift = Math.abs(vEnd - vNow) / Math.abs(vNow);
    const tPer = measurePeriod(model.times, model.x);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const footer = zh
      ? `守恒量 V=${vNow.toFixed(3)}  漂移=${(drift * 100).toFixed(4)}%  模型周期=${tPer ? tPer.toFixed(2) : '—'}  ω₀=√(αγ)=${linearOmega(p).toFixed(4)}  平衡点=(${eq.xStar.toFixed(2)}, ${eq.yStar.toFixed(2)})`
      : `V=${vNow.toFixed(3)}  drift=${(drift * 100).toFixed(4)}%  model period=${tPer ? tPer.toFixed(2) : '—'}  ω₀=√(αγ)=${linearOmega(p).toFixed(4)}  equilibrium=(${eq.xStar.toFixed(2)}, ${eq.yStar.toFixed(2)})`;
    g.fillText(footer, 54, canvas.height - 14);
  }
}

export default function createEnvPredatorPreyPlugin(): Plugin {
  return new EnvPredatorPreyPlugin();
}
