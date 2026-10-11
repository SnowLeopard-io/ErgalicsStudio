// ==========================================================================
// bio-neuron — Hodgkin–Huxley action-potential workbench (canvas)
//
// Top panel: membrane potential V(t) with the injected-current waveform
// overlaid on a right-hand axis. Bottom panel: m/h/n gating variables.
// The precomputed RK4 series plays back with run/pause/reset controls;
// "Run validation benchmarks" publishes the 1952-system checks to the
// scientific-output strip. All numerics live in ./kernel (pure, DOM-free).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { bioNeuronManifest } from './manifest';
import {
  DEFAULT_HH_PARAMS,
  DEFAULT_STIM,
  REST_V,
  countSpikes,
  runHhBenchmarks,
  simulateHH,
  type HHSeries,
  type HHStim,
} from './kernel';

export { bioNeuronManifest } from './manifest';

interface State {
  hold: number;
  pulseAmp: number;
  pulseStart: number;
  pulseDur: number;
  tMax: number;
  tempC: number;
}

const DT_MS = 0.01; // integration step, ms

export class BioNeuronPlugin implements Plugin {
  readonly manifest = bioNeuronManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    hold: DEFAULT_STIM.hold,
    pulseAmp: DEFAULT_STIM.pulseAmp,
    pulseStart: DEFAULT_STIM.pulseStart,
    pulseDur: DEFAULT_STIM.pulseDur,
    tMax: 100,
    tempC: DEFAULT_HH_PARAMS.tempC,
  };
  private series: HHSeries | null = null;
  private playIdx = 0;
  private timer: number | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.stopPlayback();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stopPlayback();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  private params(): { p: typeof DEFAULT_HH_PARAMS; stim: HHStim } {
    return {
      p: { ...DEFAULT_HH_PARAMS, tempC: this.state.tempC },
      stim: {
        hold: this.state.hold,
        pulseAmp: this.state.pulseAmp,
        pulseStart: this.state.pulseStart,
        pulseDur: this.state.pulseDur,
      },
    };
  }

  private recompute(): HHSeries {
    const { p, stim } = this.params();
    this.series = simulateHH(p, stim, this.state.tMax, DT_MS);
    this.playIdx = this.series.times.length - 1;
    return this.series;
  }

  // ---- playback ---------------------------------------------------------------

  private stopPlayback() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startPlayback() {
    if (!this.series) this.recompute();
    if (this.timer !== null) return;
    if (this.playIdx >= (this.series ? this.series.times.length - 1 : 0)) this.playIdx = 0;
    const len = this.series ? this.series.times.length : 1;
    const stride = Math.max(1, Math.floor(len / 150));
    this.timer = window.setInterval(() => {
      if (!this.series) return;
      this.playIdx = Math.min(this.playIdx + stride, this.series.times.length - 1);
      this.draw();
      if (this.playIdx >= this.series.times.length - 1) this.stopPlayback();
    }, 30);
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'hold',
        label: 'I hold',
        labelI18n: { 'zh-CN': '持续电流 I (µA/cm²)', 'en-US': 'Sustained I (µA/cm²)' },
        type: 'range',
        min: -10,
        max: 80,
        step: 0.5,
        value: this.state.hold,
        hint: this.zh ? '持续去极化/超极化注入' : 'sustained depolarizing / hyperpolarizing injection',
      },
      {
        key: 'pulseAmp',
        label: 'I pulse',
        labelI18n: { 'zh-CN': '脉冲幅度 (µA/cm²)', 'en-US': 'Pulse amplitude (µA/cm²)' },
        type: 'range',
        min: 0,
        max: 80,
        step: 0.5,
        value: this.state.pulseAmp,
      },
      {
        key: 'pulseStart',
        label: 't start',
        labelI18n: { 'zh-CN': '脉冲起始 (ms)', 'en-US': 'Pulse start (ms)' },
        type: 'range',
        min: 0,
        max: 50,
        step: 1,
        value: this.state.pulseStart,
      },
      {
        key: 'pulseDur',
        label: 't dur',
        labelI18n: { 'zh-CN': '脉冲宽度 (ms)', 'en-US': 'Pulse duration (ms)' },
        type: 'range',
        min: 0.1,
        max: 20,
        step: 0.1,
        value: this.state.pulseDur,
      },
      {
        key: 'tMax',
        label: 't range',
        labelI18n: { 'zh-CN': '仿真时长 (ms)', 'en-US': 'Simulated span (ms)' },
        type: 'range',
        min: 20,
        max: 500,
        step: 10,
        value: this.state.tMax,
      },
      {
        key: 'tempC',
        label: 'T',
        labelI18n: { 'zh-CN': '温度 (°C, Q10=3)', 'en-US': 'Temperature (°C, Q10=3)' },
        type: 'range',
        min: 6.3,
        max: 40,
        step: 0.1,
        value: this.state.tempC,
        hint: this.zh ? '1952 年原始参照温度为 6.3 °C' : '1952 reference temperature is 6.3 °C',
      },
      actionButton('run', 'Run / replay', '运行 / 重播'),
      actionButton('pause', 'Pause', '暂停'),
      actionButton('reset', 'Reset', '重置'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export trace CSV', '导出波形 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: keyof State, apply: (n: number) => void): void => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v) && v !== this.state[k]) {
        apply(v);
        this.recompute();
        this.stopPlayback();
        this.draw();
      }
    };
    num('hold', (n) => {
      this.state.hold = n;
    });
    num('pulseAmp', (n) => {
      this.state.pulseAmp = n;
    });
    num('pulseStart', (n) => {
      this.state.pulseStart = n;
    });
    num('pulseDur', (n) => {
      this.state.pulseDur = n;
    });
    num('tMax', (n) => {
      this.state.tMax = n;
    });
    num('tempC', (n) => {
      this.state.tempC = n;
    });
    if (actionFired(params, 'run')) this.startPlayback();
    if (actionFired(params, 'pause')) this.stopPlayback();
    if (actionFired(params, 'reset')) {
      this.stopPlayback();
      if (!this.series) this.recompute();
      this.playIdx = 0;
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    notify(
      this.api,
      'warning',
      'bio-neuron is fully parameter-driven — no external data is required; adjust the current sliders instead.',
      'bio-neuron 完全由参数驱动，无需外部数据——请直接调节电流滑块。',
    );
    void file;
  }

  // ---- science outputs ---------------------------------------------------------

  private runBenchmark() {
    const bench = runHhBenchmarks(DT_MS);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `hh-bench-${b.key}`,
      label: `Bench · ${b.key}`,
      value: b.display,
      unit: '',
      severity: b.pass ? 'ok' : 'error',
      hint: `${b.label} — ${b.hint}`,
    }));
    const s = this.series ?? this.recompute();
    const peak = Math.max(...s.v);
    const spikes = countSpikes(s.v);
    metrics.push(
      {
        key: 'v-end',
        label: 'V(end)',
        value: `${s.v[s.v.length - 1]!.toFixed(2)}`,
        unit: 'mV',
        severity: 'info',
      },
      {
        key: 'v-peak',
        label: 'V peak',
        value: `${peak.toFixed(2)}`,
        unit: 'mV',
        severity: 'info',
      },
      {
        key: 'spikes',
        label: this.zh ? '峰电位数' : 'Spike count',
        value: String(spikes),
        unit: '',
        severity: 'info',
        hint: this.zh ? '以 0 mV 上穿计数' : 'upward 0 mV crossings',
      },
    );
    setScienceOutputs(this.manifest.id, metrics);
    const allPass = bench.every((b) => b.pass);
    notify(
      this.api,
      allPass ? 'success' : 'warning',
      allPass
        ? 'All Hodgkin–Huxley benchmarks passed.'
        : 'Hodgkin–Huxley benchmark failed — inspect the science strip.',
      allPass
        ? '全部 Hodgkin–Huxley 基准通过。'
        : 'Hodgkin–Huxley 基准未通过——请查看科研输出条。',
    );
  }

  private exportCsv() {
    const s = this.series ?? this.recompute();
    const rows: Array<Array<number | string>> = s.times.map((t, i) => [
      Number(t.toFixed(4)),
      Number(s.v[i]!.toFixed(5)),
      Number(s.m[i]!.toFixed(6)),
      Number(s.h[i]!.toFixed(6)),
      Number(s.n[i]!.toFixed(6)),
      Number(s.i[i]!.toFixed(4)),
    ]);
    exportRowsCsv(this.api, 'bio-neuron-hh-trace', ['time_ms', 'V_mV', 'm', 'h', 'n', 'I_uA_per_cm2'], rows);
  }

  // ---- drawing ------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const s = this.series ?? this.recompute();
    const len = s.times.length;
    const idx = Math.max(1, Math.min(this.playIdx, len - 1));
    const tMax = s.times[len - 1]!;
    const zh = this.zh;

    const padL = 56;
    const padR = 52;
    const padT = 46;
    const padB = 44;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const yTop = padT;
    const midSplit = padT + (canvas.height - padT - padB) * 0.58;
    const yBot = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const hA = Math.max(midSplit - yTop, 20);
    const hB = Math.max(yBot - (midSplit + 16), 20);
    const yB0 = midSplit + 16;

    const px = (t: number) => x0 + (plotW * t) / tMax;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `Hodgkin–Huxley 1952 · V(t) 与 m/h/n 门控 · T=${this.state.tempC.toFixed(1)} °C`
        : `Hodgkin–Huxley 1952 · V(t) and m/h/n gating · T=${this.state.tempC.toFixed(1)} °C`,
      canvas.width / 2,
      20,
    );

    // ---- panel A: V(t) ---------------------------------------------------------
    let vLo = -90;
    let vHi = 60;
    for (let i = 0; i <= idx; i += 1) {
      vLo = Math.min(vLo, s.v[i]! - 5);
      vHi = Math.max(vHi, s.v[i]! + 8);
    }
    const pyV = (v: number) => yTop + hA - ((hA * (v - vLo)) / (vHi - vLo));

    // injected current on a right-hand axis, drawn as filled area
    let iLo = 0;
    let iHi = 1;
    for (let i = 0; i <= idx; i += 1) {
      iLo = Math.min(iLo, s.i[i]!);
      iHi = Math.max(iHi, s.i[i]!);
    }
    if (iHi - iLo < 1) iHi = iLo + 1;
    const pyI = (v: number) => yTop + hA - ((hA * (v - iLo)) / (iHi - iLo));
    g.fillStyle = 'rgba(120, 225, 170, 0.14)';
    g.beginPath();
    g.moveTo(px(s.times[0]!), pyI(s.i[0]!));
    for (let i = 1; i <= idx; i += 1) g.lineTo(px(s.times[i]!), pyI(s.i[i]!));
    g.lineTo(px(s.times[idx]!), yTop + hA);
    g.lineTo(px(s.times[0]!), yTop + hA);
    g.closePath();
    g.fill();

    // reference lines
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(x0, yTop, plotW, hA);
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(170,182,200,0.4)';
    g.beginPath();
    g.moveTo(x0, pyV(REST_V));
    g.lineTo(x1, pyV(REST_V));
    g.moveTo(x0, pyV(0));
    g.lineTo(x1, pyV(0));
    g.stroke();
    g.setLineDash([]);

    // V trace
    g.strokeStyle = 'rgba(120, 200, 250, 0.95)';
    g.lineWidth = 1.8;
    g.beginPath();
    const decim = Math.max(1, Math.floor(idx / 1800));
    for (let i = 0; i <= idx; i += decim) {
      const sx = px(s.times[i]!);
      const sy = pyV(s.v[i]!);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();

    // panel A ticks
    g.textAlign = 'right';
    g.font = '10px Consolas, monospace';
    for (let k = 0; k <= 3; k += 1) {
      const v = vLo + ((vHi - vLo) * k) / 3;
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(v.toFixed(0), x0 - 6, pyV(v) + 3);
    }
    g.fillStyle = 'rgba(120, 225, 170, 0.85)';
    g.textAlign = 'left';
    g.fillText(`${iHi.toFixed(1)}`, x1 + 6, pyI(iHi) + 3);
    g.fillText(`${iLo.toFixed(1)}`, x1 + 6, yTop + hA - 2);
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText(zh ? 'V (mV) / I (µA/cm²)' : 'V (mV) / I (µA/cm²)', x0 + 4, yTop + 12);

    // ---- panel B: gating variables ---------------------------------------------
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, yB0, plotW, hB);
    const pyG = (v: number) => yB0 + hB - (hB * Math.min(Math.max(v, 0), 1));
    const drawGate = (arr: number[], color: string): void => {
      g.strokeStyle = color;
      g.lineWidth = 1.4;
      g.beginPath();
      for (let i = 0; i <= idx; i += decim) {
        const sx = px(s.times[i]!);
        const sy = pyG(arr[i]!);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
    };
    drawGate(s.m, 'rgba(240, 170, 110, 0.95)');
    drawGate(s.h, 'rgba(190, 140, 250, 0.9)');
    drawGate(s.n, 'rgba(120, 225, 170, 0.9)');
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('1', x0 - 6, yB0 + 8);
    g.fillText('0', x0 - 6, yB0 + hB);
    g.textAlign = 'left';
    g.fillText(zh ? '门控变量 m / h / n' : 'gating m / h / n', x0 + 4, yB0 + 12);

    // legend
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let lx = x1 - 170;
    let ly = yB0 + 12;
    g.fillStyle = 'rgba(240, 170, 110, 0.95)';
    g.fillRect(lx, ly, 10, 3);
    g.fillStyle = 'rgba(200, 214, 232, 0.95)';
    g.fillText('m (Na act.)', lx + 14, ly + 4);
    ly += 13;
    g.fillStyle = 'rgba(190, 140, 250, 0.9)';
    g.fillRect(lx, ly, 10, 3);
    g.fillStyle = 'rgba(200, 214, 232, 0.95)';
    g.fillText('h (Na inact.)', lx + 14, ly + 4);
    ly += 13;
    g.fillStyle = 'rgba(120, 225, 170, 0.9)';
    g.fillRect(lx, ly, 10, 3);
    g.fillStyle = 'rgba(200, 214, 232, 0.95)';
    g.fillText('n (K act.)', lx + 14, ly + 4);

    // time axis
    g.textAlign = 'center';
    g.font = '10px Consolas, monospace';
    for (let k = 0; k <= 6; k += 1) {
      const t = (tMax * k) / 6;
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(t.toFixed(0), px(t), yBot + 14);
    }
    g.fillText('t (ms)', x1 + 20, yBot + 14);

    // footer stats (loop-based: the series can hold ~50k samples)
    const vNow = s.v[idx]!;
    let peak = -Infinity;
    let spikes = 0;
    for (let i = 0; i <= idx; i += 1) {
      const v = s.v[i]!;
      if (v > peak) peak = v;
      if (i > 0 && s.v[i - 1]! < 0 && v >= 0) spikes += 1;
    }
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(
      zh
        ? `t=${s.times[idx]!.toFixed(1)} ms  V=${vNow.toFixed(1)} mV  峰值=${peak.toFixed(1)} mV  峰电位=${spikes}  gNa=120 gK=36 gL=0.3 mS/cm²`
        : `t=${s.times[idx]!.toFixed(1)} ms  V=${vNow.toFixed(1)} mV  peak=${peak.toFixed(1)} mV  spikes=${spikes}  gNa=120 gK=36 gL=0.3 mS/cm²`,
      54,
      canvas.height - 14,
    );
  }
}

export default function createBioNeuronPlugin(): Plugin {
  return new BioNeuronPlugin();
}
