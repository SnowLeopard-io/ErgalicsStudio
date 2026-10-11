// ==========================================================================
// geo-hydrology — SCS curve-number rainfall-runoff workbench
//
// Partitions incremental rainfall into SCS-CN excess (S = 25400/CN - 254,
// cumulative differencing) and convolves it with an SCS synthetic unit
// hydrograph (triangular Tb = 2.67 Tp, or the NOHRSC dimensionless
// curvilinear table discretely renormalized to exact volume). The canvas
// shows the hyetograph with cumulative curves, the direct runoff hydrograph
// with its peak marked, and a footer carrying the water-balance numbers.
// Scientific outputs publish total excess, peak flow, time to peak and the
// mass-balance residual; the four validation benchmarks are one click away.
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
import { hydrologyManifest } from './manifest';
import {
  DESIGN_STORM_90MM_6H,
  parseHyetograph,
  parseRainText,
  runAllBenchmarks,
  runScsEvent,
  type ScsEventResult,
  type UhType,
} from './kernel';

export { hydrologyManifest } from './manifest';

interface State {
  cn: number;
  areaKm2: number;
  tpHours: number;
  peakFactor: number;
  dtHours: number;
  uhType: UhType;
  rainText: string;
}

interface RainfallSource {
  increments: number[];
  dtHours: number;
  label: string;
}

export class HydrologyPlugin implements Plugin {
  readonly manifest = hydrologyManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private rain: number[] | null = null;
  private rainDtHours: number | null = null;
  private dataName = '';
  private event: ScsEventResult | null = null;
  private state: State = {
    cn: 80,
    areaKm2: 10,
    tpHours: 2,
    peakFactor: 0.208,
    dtHours: 1,
    uhType: 'triangular',
    rainText: '',
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
        key: 'cn',
        label: 'Curve number CN',
        labelI18n: { 'zh-CN': '曲线数 CN', 'en-US': 'Curve number CN' },
        type: 'number',
        min: 30,
        max: 99,
        step: 1,
        value: s.cn,
      },
      {
        key: 'areaKm2',
        label: 'Area (km²)',
        labelI18n: { 'zh-CN': '流域面积 (km²)', 'en-US': 'Area (km²)' },
        type: 'number',
        min: 0.01,
        max: 10000,
        step: 0.1,
        value: s.areaKm2,
      },
      {
        key: 'tpHours',
        label: 'Tp time-to-peak (h)',
        labelI18n: { 'zh-CN': 'Tp 峰现时间 (h)', 'en-US': 'Tp time-to-peak (h)' },
        type: 'number',
        min: 0.1,
        max: 72,
        step: 0.1,
        value: s.tpHours,
      },
      {
        key: 'peakFactor',
        label: 'qp factor (m³/s per mm·km²·h)',
        labelI18n: { 'zh-CN': 'qp 系数 (m³/s per mm·km²·h)', 'en-US': 'qp factor (m³/s per mm·km²·h)' },
        type: 'number',
        min: 0.05,
        max: 0.5,
        step: 0.001,
        value: s.peakFactor,
      },
      {
        key: 'dtHours',
        label: 'Time step dt (h)',
        labelI18n: { 'zh-CN': '时间步长 dt (h)', 'en-US': 'Time step dt (h)' },
        type: 'number',
        min: 0.05,
        max: 24,
        step: 0.05,
        value: s.dtHours,
      },
      {
        key: 'uhType',
        label: 'Unit hydrograph',
        labelI18n: { 'zh-CN': '单位线线型', 'en-US': 'Unit hydrograph' },
        type: 'select',
        options: [
          { value: 'triangular', label: this.zh ? '三角形（Tb = 2.67 Tp）' : 'Triangular (Tb = 2.67 Tp)' },
          { value: 'curvilinear', label: this.zh ? '曲表（NOHRSC 无因次表）' : 'Curvilinear (NOHRSC table)' },
        ],
        value: s.uhType,
      },
      {
        key: 'rainText',
        label: 'Rainfall increments (mm)',
        labelI18n: { 'zh-CN': '降雨增量 (mm)', 'en-US': 'Rainfall increments (mm)' },
        type: 'text',
        value: s.rainText,
        placeholder: '6.25, 18.75, 27.5, 20.83, 12.5, 4.17',
      },
      actionButton('run', 'Run SCS event', '运行 SCS 径流计算', 'primary'),
      actionButton('demo', 'Demo · 90 mm / 6 h design storm', '演示 · 90 mm / 6 h 设计暴雨'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export event CSV', '导出过程 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (apply(params[k] as number)) this.draw();
      }
    };
    num('cn', (n) => {
      if (n === this.state.cn) return false;
      this.state.cn = Math.min(99, Math.max(30, Math.round(n)));
      return true;
    });
    num('areaKm2', (n) => {
      if (n === this.state.areaKm2) return false;
      this.state.areaKm2 = Math.min(10000, Math.max(0.01, n));
      return true;
    });
    num('tpHours', (n) => {
      if (n === this.state.tpHours) return false;
      this.state.tpHours = Math.min(72, Math.max(0.1, n));
      return true;
    });
    num('peakFactor', (n) => {
      if (n === this.state.peakFactor) return false;
      this.state.peakFactor = Math.min(0.5, Math.max(0.05, n));
      return true;
    });
    num('dtHours', (n) => {
      if (n === this.state.dtHours) return false;
      this.state.dtHours = Math.min(24, Math.max(0.05, n));
      return true;
    });
    if (
      typeof params.uhType === 'string' &&
      (params.uhType === 'triangular' || params.uhType === 'curvilinear') &&
      params.uhType !== this.state.uhType
    ) {
      this.state.uhType = params.uhType;
      this.draw();
    }
    if (typeof params.rainText === 'string' && params.rainText !== this.state.rainText) {
      this.state.rainText = params.rainText;
      this.draw();
    }
    if (actionFired(params, 'run')) this.runNow('user');
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
      notify(
        this.api,
        'warning',
        'Hyetograph data must be CSV / TSV / TXT with time_h,rain_mm (or single rain_mm) columns.',
        '雨量数据须为含 time_h,rain_mm（或单列 rain_mm）的 CSV / TSV / TXT。',
      );
      return;
    }
    const text = await file.text();
    const parsed = parseHyetograph(text, this.state.dtHours);
    if (parsed.rainMm.length === 0) {
      notify(this.api, 'warning', 'No numeric rainfall rows found.', '未找到数值雨量行。');
      return;
    }
    this.rain = parsed.rainMm;
    this.rainDtHours = parsed.dtHours;
    this.dataName = file.name;
    this.state.rainText = '';
    this.runNow('load');
    notify(
      this.api,
      'success',
      `Loaded ${parsed.rainMm.length} rainfall increments (dt=${parsed.dtHours} h${parsed.hasTimeColumn ? ', from time column' : ', assumed dt'}).`,
      `已载入 ${parsed.rainMm.length} 个降雨增量（dt=${parsed.dtHours} h${parsed.hasTimeColumn ? '，取自时间列' : '，dt 为假定值'}）。`,
    );
  }

  private resolveRainfall(): RainfallSource | null {
    const text = this.state.rainText.trim();
    if (text.length > 0) {
      const inc = parseRainText(text);
      if (inc.length === 0) return null;
      return { increments: inc, dtHours: this.state.dtHours, label: 'pasted rainfall text' };
    }
    if (this.rain && this.rain.length > 0) {
      return {
        increments: this.rain,
        dtHours: this.rainDtHours ?? this.state.dtHours,
        label: this.dataName || 'loaded hyetograph',
      };
    }
    return null;
  }

  private runNow(source: 'user' | 'load' | 'demo') {
    const rainfall = this.resolveRainfall();
    if (!rainfall) {
      notify(
        this.api,
        'warning',
        'Provide rainfall: load a hyetograph CSV or paste increments, or use the demo storm.',
        '请提供降雨：载入雨量 CSV、粘贴增量数据，或使用演示暴雨。',
      );
      return;
    }
    const ev = runScsEvent({
      precipMm: rainfall.increments,
      dtHours: rainfall.dtHours,
      cn: this.state.cn,
      areaKm2: this.state.areaKm2,
      tpHours: this.state.tpHours,
      uhType: this.state.uhType,
      peakFactor: this.state.peakFactor,
    });
    this.event = ev;
    this.publishEvent(source, rainfall.label);
    notify(
      this.api,
      'success',
      `P=${ev.totalPrecipMm.toFixed(1)} mm -> Q=${ev.totalExcessMm.toFixed(2)} mm; peak=${ev.peakFlowM3s.toFixed(2)} m³/s @ ${ev.timeToPeakHours.toFixed(1)} h`,
      `P=${ev.totalPrecipMm.toFixed(1)} mm → Q=${ev.totalExcessMm.toFixed(2)} mm；峰值=${ev.peakFlowM3s.toFixed(2)} m³/s @ ${ev.timeToPeakHours.toFixed(1)} h`,
    );
    this.draw();
  }

  private publishEvent(source: 'user' | 'load' | 'demo', label: string) {
    const ev = this.event;
    if (!ev) return;
    const provenance =
      source === 'demo'
        ? this.zh
          ? '数据来源：内置 90 mm / 6 h 设计暴雨（合成雨型，非实测）'
          : 'source: built-in 90 mm / 6 h design storm (synthetic, not observed)'
        : this.zh
          ? `数据来源：${label}`
          : `source: ${label}`;
    const coeff = ev.totalPrecipMm > 0 ? ev.totalExcessMm / ev.totalPrecipMm : 0;
    const metrics: ScienceMetric[] = [
      {
        key: 'scs-s',
        label: 'S retention',
        value: fmtMetric(ev.sMm),
        unit: 'mm',
        severity: 'info',
        hint: `S = 25400/CN − 254 (CN=${ev.cn}); Ia = 0.2·S = ${ev.iaMm.toFixed(2)} mm`,
      },
      {
        key: 'scs-q',
        label: 'Q excess',
        value: fmtMetric(ev.totalExcessMm),
        unit: 'mm',
        severity: 'info',
        hint: `${this.zh ? '径流系数' : 'runoff coefficient'} Q/P = ${(coeff * 100).toFixed(1)}% (${provenance})`,
      },
      {
        key: 'scs-peak',
        label: 'Peak discharge',
        value: fmtMetric(ev.peakFlowM3s),
        unit: 'm³/s',
        severity: 'info',
        hint: `qp factor = ${this.state.peakFactor}, ${this.state.uhType === 'triangular' ? 'Tb = 2.67·Tp' : 'NOHRSC curvilinear table'}`,
      },
      {
        key: 'scs-tp',
        label: 'Time to peak',
        value: fmtMetric(ev.timeToPeakHours),
        unit: 'h',
        severity: 'info',
        hint: `Tp = ${this.state.tpHours} h, dt = ${ev.dtHours} h`,
      },
      {
        key: 'scs-mass',
        label: 'Mass residual',
        value: ev.massRelResidual.toExponential(2),
        severity: ev.massRelResidual < 1e-9 ? 'ok' : 'warn',
        hint: `|V_runoff − V_excess|/V_excess = ${ev.volumeRunoffM3.toFixed(3)} vs ${ev.volumeExcessM3.toFixed(3)} m³`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runDemo() {
    this.rain = DESIGN_STORM_90MM_6H.slice();
    this.rainDtHours = 1;
    this.dataName = 'built-in design storm (90 mm / 6 h)';
    this.state.rainText = '';
    this.runNow('demo');
  }

  private runBenchmarks() {
    const outcomes = runAllBenchmarks();
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
    const ev = this.event;
    if (!ev) {
      notify(this.api, 'warning', 'Run an event first.', '请先运行一次径流计算。');
      return;
    }
    const n = Math.max(ev.precipMm.length, ev.directRunoff.length);
    const rows: Array<Array<number | string>> = [];
    for (let i = 0; i < n; i += 1) {
      rows.push([
        Number((i * ev.dtHours).toFixed(4)),
        i < ev.precipMm.length ? Number(ev.precipMm[i]!.toFixed(4)) : '',
        i < ev.excessMm.length ? Number(ev.excessMm[i]!.toFixed(4)) : '',
        i < ev.cumulativePrecipMm.length ? Number(ev.cumulativePrecipMm[i]!.toFixed(4)) : '',
        i < ev.cumulativeExcessMm.length ? Number(ev.cumulativeExcessMm[i]!.toFixed(4)) : '',
        i < ev.directRunoff.length ? Number(ev.directRunoff[i]!.toFixed(5)) : '',
      ]);
    }
    exportRowsCsv(
      this.api,
      'scs-runoff-event',
      ['time_h', 'precip_mm', 'excess_mm', 'cum_precip_mm', 'cum_excess_mm', 'runoff_m3s'],
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
    if (!this.event) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No rainfall input',
        titleZh: '尚未提供降雨输入',
        hint: 'Load a hyetograph CSV (time_h,rain_mm), paste increments in the rainfall field, or run the 90 mm / 6 h demo storm.',
        hintZh: '请载入雨量 CSV（time_h,rain_mm）、在降雨栏粘贴增量，或运行 90 mm / 6 h 演示暴雨。',
      });
      return;
    }
    const zh = this.zh;
    this.drawHyetograph(g, canvas, zh);
    this.drawHydrograph(g, canvas, zh);
    this.drawFooter(g, canvas, zh);
  }

  private drawHyetograph(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const ev = this.event!;
    const padL = 56;
    const padR = 20;
    const padT = 42;
    const y0 = padT;
    const y1 = canvas.height * 0.42;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const n = ev.precipMm.length;
    const pMax = Math.max(...ev.precipMm, 0.1);
    const tEnd = n * ev.dtHours;
    const cx = (t: number) => x0 + (t / tEnd) * plotW;

    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(zh ? '降雨增量与有效降雨（虚线：累积 P / 累积 Q）' : 'Rainfall increments and excess (dashed: cum P / cum Q)', canvas.width / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // y ticks for the bar scale
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = '11px Consolas, monospace';
    for (let i = 0; i <= 4; i += 1) {
      const v = (pMax * i) / 4;
      const sy = y1 - (i / 4) * plotH;
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillText(v.toFixed(1), x0 - 6, sy + 4);
    }

    // x ticks every hour (or coarser for long events)
    const tickStep = Math.max(1, Math.ceil(tEnd / 10));
    for (let t = 0; t <= tEnd + 1e-9; t += tickStep) {
      const sx = cx(t);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.textAlign = 'center';
      g.fillText(String(Math.round(t * 100) / 100), sx, y1 + 14);
    }

    // bars: total precipitation (steel) and excess (amber, overlaid)
    const barW = Math.max((plotW / n) * 0.62, 1.5);
    for (let i = 0; i < n; i += 1) {
      const bx = cx(i * ev.dtHours) - barW / 2;
      const hp = (ev.precipMm[i]! / pMax) * plotH;
      g.fillStyle = 'rgba(120,170,230,0.75)';
      g.fillRect(bx, y1 - hp, barW, hp);
      const he = (ev.excessMm[i]! / pMax) * plotH;
      if (he > 0.5) {
        g.fillStyle = 'rgba(250,205,120,0.9)';
        g.fillRect(bx + barW * 0.2, y1 - he, barW * 0.6, he);
      }
    }

    // cumulative curves normalized by total precipitation (runoff coefficient view)
    const cumScale = Math.max(ev.totalPrecipMm, 0.1) * 1.02;
    const drawCum = (arr: number[], color: string): void => {
      g.strokeStyle = color;
      g.setLineDash([4, 3]);
      g.beginPath();
      for (let i = 0; i < arr.length; i += 1) {
        const sx = cx((i + 0.5) * ev.dtHours);
        const sy = y1 - (arr[i]! / cumScale) * plotH;
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
      g.setLineDash([]);
    };
    drawCum(ev.cumulativePrecipMm, 'rgba(220,230,245,0.85)');
    drawCum(ev.cumulativeExcessMm, 'rgba(250,205,120,0.9)');

    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('mm', x0 + 6, y0 + 14);
    g.textAlign = 'right';
    g.fillText(zh ? '时间 (h)' : 'time (h)', x1, y1 + 28);
  }

  private drawHydrograph(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const ev = this.event!;
    const padL = 56;
    const padR = 20;
    const y0 = canvas.height * 0.48;
    const y1 = canvas.height * 0.86;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const qMax = Math.max(...ev.directRunoff, 1e-9);
    const tEnd = (ev.directRunoff.length - 1) * ev.dtHours;
    const cx = (t: number) => x0 + (t / tEnd) * plotW;
    const cy = (q: number) => y1 - (q / (qMax * 1.05)) * plotH;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(zh ? '直接径流过程线' : 'Direct runoff hydrograph', (x0 + x1) / 2, canvas.height * 0.48 - 6);
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = '11px Consolas, monospace';
    for (let i = 0; i <= 4; i += 1) {
      const v = (qMax * 1.05 * i) / 4;
      const sy = y1 - (i / 4) * plotH;
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillText(v.toFixed(1), x0 - 6, sy + 4);
    }
    const tickStep = Math.max(1, Math.ceil(tEnd / 10));
    for (let t = 0; t <= tEnd + 1e-9; t += tickStep) {
      const sx = cx(t);
      g.textAlign = 'center';
      g.fillText(String(Math.round(t * 100) / 100), sx, y1 + 14);
    }

    // filled area + curve
    g.beginPath();
    g.moveTo(cx(0), y1);
    for (let k = 0; k < ev.directRunoff.length; k += 1) {
      g.lineTo(cx(ev.timesHours[k]!), cy(ev.directRunoff[k]!));
    }
    g.lineTo(cx(tEnd), y1);
    g.closePath();
    g.fillStyle = 'rgba(140,190,250,0.18)';
    g.fill();

    g.beginPath();
    for (let k = 0; k < ev.directRunoff.length; k += 1) {
      const sx = cx(ev.timesHours[k]!);
      const sy = cy(ev.directRunoff[k]!);
      if (k === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.strokeStyle = 'rgba(140,190,250,0.95)';
    g.lineWidth = 2;
    g.stroke();
    g.lineWidth = 1;

    // peak marker
    const pkx = cx(ev.timeToPeakHours);
    const pky = cy(ev.peakFlowM3s);
    g.strokeStyle = 'rgba(250,205,120,0.6)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(pkx, pky);
    g.lineTo(pkx, y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(250,205,120,1)';
    g.beginPath();
    g.arc(pkx, pky, 3.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(250,205,120,0.95)';
    g.textAlign = 'left';
    g.fillText(`${ev.peakFlowM3s.toFixed(2)} m³/s @ ${ev.timeToPeakHours.toFixed(1)} h`, Math.min(pkx + 8, x1 - 120), Math.max(pky - 6, y0 + 12));

    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('m³/s', x0 + 6, y0 + 14);
    g.textAlign = 'right';
    g.fillText(zh ? '时间 (h)' : 'time (h)', x1, y1 + 28);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const ev = this.event!;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const coeff = ev.totalPrecipMm > 0 ? ev.totalExcessMm / ev.totalPrecipMm : 0;
    const l1 = `CN=${ev.cn}  S=${ev.sMm.toFixed(2)} mm  Ia=${ev.iaMm.toFixed(2)} mm  P=${ev.totalPrecipMm.toFixed(2)} mm  Q=${ev.totalExcessMm.toFixed(3)} mm  Q/P=${(coeff * 100).toFixed(1)}%`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(l1, 54, canvas.height - 28);
    const l2 = zh
      ? `体积：径流 ${ev.volumeRunoffM3.toFixed(1)} m³ = 有效雨 ${ev.volumeExcessM3.toFixed(1)} m³（残差 ${ev.massRelResidual.toExponential(1)}）｜单位线 ${ev.uh.type === 'triangular' ? '三角形' : '曲表'}，重归一化 ×${ev.uh.renormFactor.toFixed(5)}`
      : `volume: runoff ${ev.volumeRunoffM3.toFixed(1)} m3 = excess ${ev.volumeExcessM3.toFixed(1)} m3 (residual ${ev.massRelResidual.toExponential(1)}) | UH ${ev.uh.type}, renorm x${ev.uh.renormFactor.toFixed(5)}`;
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(l2, 54, canvas.height - 12);
  }
}

export default function createHydrologyPlugin(): Plugin {
  return new HydrologyPlugin();
}
