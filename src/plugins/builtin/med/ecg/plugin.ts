// ==========================================================================
// med-ecg — ECG Analyzer workbench (2-D)
//
// Loads single- or multi-lead ECG records (CSV / whitespace text tables or
// WFDB .hea + .dat pairs), runs Pan-Tompkins style beat detection with
// P-QRS-T annotation, computes time- and frequency-domain HRV, applies a
// rule-based rhythm screening, and renders a grid-calibrated rhythm strip
// or the RR tachogram's power spectrum. All numbers are published through
// the scientific-output bus once a record is loaded.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  drawEmptyMessage,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import {
  clearScienceOutputs,
  fmtMetric,
  setScienceOutputs,
  type ScienceMetric,
} from '@/core/research/scienceOutput';
import { medEcgManifest } from './manifest';
import {
  annotateBeats,
  classifyRhythm,
  decodeWfdbDat16,
  detectRPeaks,
  hrvFrequency,
  hrvTimeStats,
  parseEcgTable,
  parseHeaHeader,
  type BeatAnnotation,
  type EcgTable,
  type HrvSpectrum,
  type HrvStats,
  type RhythmSummary,
} from './ecg';

/** Length of the scrolling strip window in seconds. */
const WINDOW_SECONDS = 10;

const TIME_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** 1/2/5 × 10^k step at least as large as `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / base;
  const m = r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10;
  return m * base;
}

interface State {
  lead: number;
  view: 'strip' | 'hrv';
  sensitivity: number;
  display: 'full' | 'window';
  windowStart: number;
  showBands: boolean;
}

interface Analysis {
  leadIndex: number;
  beats: BeatAnnotation[];
  rrMs: number[];
  stats: HrvStats;
  hrv: HrvSpectrum | null;
  rhythm: RhythmSummary;
  pvcCount: number;
  pWaveRate: number;
}

export class MedEcgPlugin implements Plugin {
  readonly manifest = medEcgManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private table: EcgTable | null = null;
  private fileName = '';
  private analysis: Analysis | null = null;
  private state: State = {
    lead: 0,
    view: 'strip',
    sensitivity: 1,
    display: 'full',
    windowStart: 0,
    showBands: true,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      if (this.analysis) this.publish();
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

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameters ----------------------------------------------------------

  getParams(): ParamDefinition[] {
    const table = this.table;
    const leadOptions =
      table && table.leadNames.length > 0
        ? table.leadNames.map((name, i) => ({
            value: String(i),
            label: name,
            labelI18n: { 'zh-CN': name, 'en-US': name },
          }))
        : [{ value: '0', label: '—', labelI18n: { 'zh-CN': '—', 'en-US': '—' } }];
    const duration = table && table.leads[0] ? table.leads[0].length / table.fs : 0;
    const maxStart = Math.max(0, Math.floor(Math.max(0, duration - WINDOW_SECONDS)));
    return [
      {
        key: 'lead',
        label: 'Lead',
        labelI18n: { 'zh-CN': '导联', 'en-US': 'Lead' },
        type: 'select',
        options: leadOptions,
        value: String(Math.min(this.state.lead, Math.max(0, leadOptions.length - 1))),
        hint: 'Channel analysed and drawn on the rhythm strip',
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'strip', label: 'Rhythm strip', labelI18n: { 'zh-CN': '节律条', 'en-US': 'Rhythm strip' } },
          { value: 'hrv', label: 'HRV spectrum', labelI18n: { 'zh-CN': 'HRV 频谱', 'en-US': 'HRV spectrum' } },
        ],
        value: this.state.view,
      },
      {
        key: 'sensitivity',
        label: 'Sensitivity',
        labelI18n: { 'zh-CN': '检测灵敏度', 'en-US': 'Detection sensitivity' },
        type: 'range',
        min: 0.5,
        max: 1.5,
        step: 0.05,
        value: this.state.sensitivity,
        hint: 'Higher admits weaker QRS complexes (re-runs detection)',
      },
      {
        key: 'display',
        label: 'Span',
        labelI18n: { 'zh-CN': '时间跨度', 'en-US': 'Time span' },
        type: 'select',
        options: [
          { value: 'full', label: 'Full record', labelI18n: { 'zh-CN': '全段显示', 'en-US': 'Full record' } },
          { value: 'window', label: '10 s window', labelI18n: { 'zh-CN': '10 秒窗口', 'en-US': '10 s window' } },
        ],
        value: this.state.display,
      },
      {
        key: 'windowStart',
        label: 'Window start (s)',
        labelI18n: { 'zh-CN': '窗口起点（秒）', 'en-US': 'Window start (s)' },
        type: 'range',
        min: 0,
        max: maxStart,
        step: 1,
        value: Math.min(this.state.windowStart, maxStart),
        visibleWhen: { key: 'display', in: ['window'] },
      },
      {
        key: 'showBands',
        label: 'LF/HF bands',
        labelI18n: { 'zh-CN': '显示 LF/HF 频段', 'en-US': 'Show LF/HF bands' },
        type: 'checkbox',
        value: this.state.showBands,
        visibleWhen: { key: 'view', in: ['hrv'] },
      },
      actionButton('exportCsv', 'Export CSV', '导出 CSV', 'primary'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let reanalyze = false;

    if (typeof params.lead === 'string' || typeof params.lead === 'number') {
      const v = Math.round(Number(params.lead));
      if (Number.isFinite(v) && v !== this.state.lead) {
        this.state.lead = Math.max(0, v);
        reanalyze = true;
      }
    }
    if (typeof params.sensitivity === 'number' && Number.isFinite(params.sensitivity)) {
      const v = Math.min(1.5, Math.max(0.5, params.sensitivity));
      if (v !== this.state.sensitivity) {
        this.state.sensitivity = v;
        reanalyze = true;
      }
    }
    if ((params.view === 'strip' || params.view === 'hrv') && params.view !== this.state.view) {
      this.state.view = params.view;
      this.draw();
    }
    if ((params.display === 'full' || params.display === 'window') && params.display !== this.state.display) {
      this.state.display = params.display;
      this.draw();
    }
    if (typeof params.windowStart === 'number' && Number.isFinite(params.windowStart)) {
      const v = Math.max(0, Math.floor(params.windowStart));
      if (v !== this.state.windowStart) {
        this.state.windowStart = v;
        this.draw();
      }
    }
    if (typeof params.showBands === 'boolean' && params.showBands !== this.state.showBands) {
      this.state.showBands = params.showBands;
      this.draw();
    }

    if (reanalyze && this.table) {
      this.analyze();
      this.draw();
    }
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  // ---- data loading --------------------------------------------------------

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (low.endsWith('.hea')) {
      await this.loadWfdb(file);
      return;
    }
    if (low.endsWith('.dat')) {
      notify(
        this.api,
        'warning',
        'Open the matching .hea header instead; it will prompt for this .dat file.',
        '请改为打开配套的 .hea 头文件，随后按提示选择该 .dat 文件。',
      );
      return;
    }
    if (low.endsWith('.csv') || low.endsWith('.txt') || low.endsWith('.tsv')) {
      const text = await file.text();
      const table = parseEcgTable(text);
      if (!table) {
        notify(
          this.api,
          'error',
          'No numeric ECG samples found (expected a time column plus lead columns, or a single sample column).',
          '未找到有效的心电数值样本（需要 time+导联列或单列采样值）。',
        );
        return;
      }
      this.adopt(table, file.name);
      return;
    }
    notify(
      this.api,
      'warning',
      'ECG Analyzer accepts .csv / .txt tables or a WFDB .hea header.',
      '心电图分析仪接受 .csv / .txt 表格或 WFDB .hea 头文件。',
    );
  }

  /** WFDB path: parse the .hea, then pair it with a user-picked .dat file. */
  private async loadWfdb(file: File) {
    const text = await file.text();
    const head = parseHeaHeader(text);
    if (!head) {
      notify(this.api, 'error', 'Could not parse the WFDB header.', '无法解析 WFDB 头文件。');
      return;
    }
    if (head.formats.some((f) => f !== '' && f !== '16' && f !== '1')) {
      notify(
        this.api,
        'warning',
        'Only 16-bit WFDB format records are supported (fmt 16 / 1).',
        '仅支持 16 位 WFDB 格式记录（fmt 16 / 1）。',
      );
      return;
    }
    notify(
      this.api,
      'info',
      `Header "${head.name}" read (${head.nsig} signal(s) @ ${head.fs} Hz). Select its .dat file.`,
      `已读取头文件「${head.name}」（${head.nsig} 导联 @ ${head.fs} Hz），请选择配套 .dat 文件。`,
    );
    const dat = await this.api.openFile();
    if (!dat) return;
    const buffer = await this.api.readBinary(dat);
    const leads = decodeWfdbDat16(buffer, head.nsig, head.nsamp, head.gains, head.baselines);
    if (!leads || leads.length === 0) {
      notify(
        this.api,
        'error',
        'The .dat file does not match the header frame size.',
        '.dat 文件与头文件的帧长度不匹配。',
      );
      return;
    }
    const names = leads.map((_, i) => head.sigNames[i] ?? `sig${i + 1}`);
    this.adopt({ leadNames: names, leads, fs: head.fs, hasTime: false }, head.name || file.name);
  }

  /** Install a parsed table as the active record and run the analysis. */
  private adopt(table: EcgTable, name: string) {
    this.table = table;
    this.fileName = name;
    if (this.state.lead >= table.leads.length) this.state.lead = 0;
    this.state.windowStart = 0;
    const ok = this.analyze();
    const samples = table.leads[0]?.length ?? 0;
    const dur = samples / table.fs;
    notify(
      this.api,
      ok ? 'success' : 'warning',
      ok
        ? `Loaded ${name}: ${table.leads.length} lead(s), ${table.fs} Hz, ${dur.toFixed(1)} s.`
        : `Loaded ${name}, but fewer than 2 R peaks were detected (try another sensitivity).`,
      ok
        ? `已载入 ${name}：${table.leads.length} 导联、${table.fs} Hz、${dur.toFixed(1)} 秒。`
        : `已载入 ${name}，但未检出 2 个以上 R 峰（可调整灵敏度重试）。`,
    );
    this.draw();
  }

  // ---- analysis & science output ------------------------------------------

  private analyze(): boolean {
    const table = this.table;
    if (!table || table.leads.length === 0) {
      this.analysis = null;
      clearScienceOutputs(this.manifest.id);
      return false;
    }
    const leadIndex = Math.min(Math.max(0, this.state.lead), table.leads.length - 1);
    const sig = table.leads[leadIndex]!;
    const fs = table.fs;
    const rPeaks = detectRPeaks(sig, fs, this.state.sensitivity);
    if (rPeaks.length < 2) {
      this.analysis = null;
      clearScienceOutputs(this.manifest.id);
      return false;
    }
    const beats = annotateBeats(sig, fs, rPeaks);
    if (beats.length < 2) {
      this.analysis = null;
      clearScienceOutputs(this.manifest.id);
      return false;
    }
    const rrMs: number[] = [];
    for (let i = 1; i < rPeaks.length; i += 1) {
      rrMs.push(((rPeaks[i]! - rPeaks[i - 1]!) / fs) * 1000);
    }
    const stats = hrvTimeStats(rrMs);
    const hrv = hrvFrequency(rrMs, 4);
    const pvcCount = beats.filter((b) => b.label === 'PVC').length;
    const withP = beats.filter((b) => b.pIndex >= 0).length;
    const pWaveRate = withP / beats.length;
    const rhythm = classifyRhythm({
      meanHrBpm: stats.meanHrBpm,
      meanRrMs: stats.meanRrMs,
      rmssdMs: stats.rmssdMs,
      pWaveRate,
      pvcCount,
      nBeats: beats.length,
    });
    this.analysis = { leadIndex, beats, rrMs, stats, hrv, rhythm, pvcCount, pWaveRate };
    this.publish();
    return true;
  }

  /**
   * Publish the record's headline conclusions: mean heart rate, SDNN,
   * RMSSD, LF/HF, beat and PVC counts, and the rhythm screening result.
   * Only published once a record has been analysed — never fabricated.
   */
  private publish() {
    const a = this.analysis;
    if (!a) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const zh = this.zh;
    const hrOk = a.stats.meanHrBpm >= 60 && a.stats.meanHrBpm <= 100;
    const metrics: ScienceMetric[] = [
      {
        key: 'mean-hr',
        label: 'Mean HR',
        value: fmtMetric(a.stats.meanHrBpm),
        unit: 'bpm',
        severity: hrOk ? 'ok' : 'warn',
        hint: zh ? '平均心率 = 60000 / 平均 RR（参考区间 60–100 bpm）' : 'mean heart rate = 60000 / mean RR (reference 60–100 bpm)',
      },
      {
        key: 'sdnn',
        label: 'SDNN',
        value: fmtMetric(a.stats.sdnnMs),
        unit: 'ms',
        severity: 'info',
        hint: zh ? 'RR 间期样本标准差（n−1）' : 'sample standard deviation of the RR intervals (n − 1)',
      },
      {
        key: 'rmssd',
        label: 'RMSSD',
        value: fmtMetric(a.stats.rmssdMs),
        unit: 'ms',
        severity: 'info',
        hint: zh ? '相邻 RR 差值的均方根（高频副交感指标）' : 'root mean square of successive RR differences (parasympathetic marker)',
      },
      {
        key: 'lfhf',
        label: 'LF/HF',
        value: a.hrv ? fmtMetric(a.hrv.lfhf) : '—',
        severity: 'info',
        hint: zh
          ? 'LF (0.04–0.15 Hz) 与 HF (0.15–0.4 Hz) 功率之比；RR 4 Hz 重采样 + Welch 周期图'
          : 'ratio of LF (0.04–0.15 Hz) to HF (0.15–0.4 Hz) power; 4 Hz RR resampling + Welch periodogram',
      },
      {
        key: 'beats',
        label: 'Beats',
        value: String(a.beats.length),
        severity: 'info',
        hint: zh ? '检出的 R 峰总数' : 'total detected R peaks',
      },
      {
        key: 'pvc',
        label: 'PVC',
        value: String(a.pvcCount),
        severity: a.pvcCount > 0 ? 'warn' : 'ok',
        hint: zh ? '宽 QRS + 提早 + 代偿间期规则命中的室性早搏拍数' : 'beats matching the wide-QRS + early + compensatory-pause rule',
      },
      {
        key: 'rhythm',
        label: 'Rhythm',
        value: zh ? a.rhythm.conclusionZh : a.rhythm.conclusion,
        severity: a.rhythm.severity,
        hint: zh ? '规则法筛查结论，仅供教学参考，非临床诊断' : 'rule-based screening conclusion; teaching reference only, not a clinical diagnosis',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- CSV export ----------------------------------------------------------

  private exportCsv() {
    const a = this.analysis;
    if (!a || !this.table) {
      notify(this.api, 'warning', 'Load an ECG record first.', '请先载入心电记录。');
      return;
    }
    const fs = this.table.fs;
    const header = ['beat', 'r_time_s', 'rr_ms', 'hr_bpm', 'qrs_ms', 'p_wave_s', 't_wave_s', 'label'];
    const rows = a.beats.map((b, i) => [
      String(i + 1),
      b.timeS.toFixed(3),
      b.rrPrevMs > 0 ? b.rrPrevMs.toFixed(1) : '',
      b.hrBpm > 0 ? b.hrBpm.toFixed(1) : '',
      b.qrsMs.toFixed(1),
      b.pIndex >= 0 ? (b.pIndex / fs).toFixed(3) : '',
      b.tIndex >= 0 ? (b.tIndex / fs).toFixed(3) : '',
      b.label,
    ]);
    exportRowsCsv(this.api, 'med-ecg-beats', header, rows);

    const s = a.stats;
    const hrvRows: Array<Array<string | number>> = [
      ['mean_hr_bpm', fmtMetric(s.meanHrBpm), 'bpm'],
      ['mean_rr_ms', fmtMetric(s.meanRrMs), 'ms'],
      ['sdnn_ms', fmtMetric(s.sdnnMs), 'ms'],
      ['rmssd_ms', fmtMetric(s.rmssdMs), 'ms'],
      ['pnn50', fmtMetric(s.pnn50), ''],
      ['min_rr_ms', fmtMetric(s.minRrMs), 'ms'],
      ['max_rr_ms', fmtMetric(s.maxRrMs), 'ms'],
      ['lf_ms2', a.hrv ? fmtMetric(a.hrv.lfMs2) : '', 'ms2'],
      ['hf_ms2', a.hrv ? fmtMetric(a.hrv.hfMs2) : '', 'ms2'],
      ['lf_hf', a.hrv ? fmtMetric(a.hrv.lfhf) : '', ''],
      ['total_power_ms2', a.hrv ? fmtMetric(a.hrv.totalMs2) : '', 'ms2'],
      ['beats', String(a.beats.length), 'count'],
      ['pvc_count', String(a.pvcCount), 'count'],
      ['rhythm', this.zh ? a.rhythm.conclusionZh : a.rhythm.conclusion, ''],
    ];
    exportRowsCsv(this.api, 'med-ecg-hrv', ['metric', 'value', 'unit'], hrvRows);
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    if (!this.table) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No ECG record',
        titleZh: '尚未加载心电数据',
        hint: 'Load a CSV / TXT ECG table (time + leads in mV), or a WFDB .hea header and its .dat file.',
        hintZh: '载入 CSV/TXT 心电表格（time + 导联 mV 列），或 WFDB .hea 头文件并选择配套 .dat。',
      });
      return;
    }
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (!this.analysis) {
      drawEmptyMessage(
        g,
        canvas,
        this.zh ? '未检出 2 个以上 R 峰' : 'Fewer than 2 R peaks detected',
        this.zh ? '可提高检测灵敏度或换一段记录' : 'Raise the detection sensitivity or load another segment',
      );
      return;
    }
    if (this.state.view === 'hrv') this.plotHrv(g, canvas);
    else this.plotStrip(g, canvas);
  }

  /** Grid-calibrated rhythm strip with beat / ectopy markers. */
  private plotStrip(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const table = this.table!;
    const a = this.analysis!;
    const lead = table.leads[a.leadIndex] ?? table.leads[0]!;
    const fs = table.fs;
    const n = lead.length;
    const dur = n / fs;
    const leadName = table.leadNames[a.leadIndex] ?? `lead${a.leadIndex + 1}`;

    const padL = 58;
    const padR = 18;
    const padT = 44;
    const padB = 56;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(10, x1 - x0);
    const plotH = Math.max(10, y1 - y0);

    const isWindow = this.state.display === 'window';
    const span = isWindow ? Math.min(WINDOW_SECONDS, dur) : dur;
    const t0 = isWindow ? Math.min(Math.max(0, this.state.windowStart), Math.max(0, dur - span)) : 0;
    const t1 = t0 + span;
    const i0 = Math.max(0, Math.floor(t0 * fs));
    const i1 = Math.max(i0 + 1, Math.min(n, Math.ceil(t1 * fs)));

    // Amplitude window (mV) with a small margin, always covering the baseline.
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let i = i0; i < i1; i += 1) {
      const v = lead[i]!;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) {
      vMin = -1;
      vMax = 1;
    }
    vMin = Math.min(vMin, 0);
    vMax = Math.max(vMax, 0);
    const margin = Math.max(0.05, (vMax - vMin) * 0.08);
    vMin -= margin;
    vMax += margin;
    if (vMax - vMin < 0.2) {
      const mid = (vMax + vMin) / 2;
      vMin = mid - 0.1;
      vMax = mid + 0.1;
    }

    const px = (t: number) => x0 + ((t - t0) / (t1 - t0)) * plotW;
    const py = (v: number) => y1 - ((v - vMin) / (vMax - vMin)) * plotH;

    // Time grid: minor lines every major/5, labels on the majors.
    let major = TIME_STEPS[TIME_STEPS.length - 1]!;
    for (const s of TIME_STEPS) {
      if ((s / Math.max(span, 1e-9)) * plotW >= 64) {
        major = s;
        break;
      }
    }
    const minor = major / 5;
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.045)';
    g.beginPath();
    for (let k = Math.ceil(t0 / minor); k * minor <= t1 && k < 5000; k += 1) {
      const x = px(k * minor);
      g.moveTo(x, y0);
      g.lineTo(x, y1);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.beginPath();
    for (let k = Math.ceil(t0 / major); k * major <= t1 && k < 1000; k += 1) {
      const x = px(k * major);
      g.moveTo(x, y0);
      g.lineTo(x, y1);
    }
    g.stroke();

    // Amplitude grid.
    const step = niceStep((vMax - vMin) / 6);
    g.textAlign = 'right';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let labelGuard = 0;
    for (let v = Math.ceil(vMin / step) * step; v <= vMax && labelGuard < 40; v += step, labelGuard += 1) {
      const y = py(v);
      const isBase = Math.abs(v) < step * 1e-6;
      g.strokeStyle = isBase ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(`${Math.abs(v) < 1e-9 ? '0' : v.toFixed(v % 1 === 0 ? 0 : 2)}`, x0 - 6, y + 3);
    }
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('mV', x0 - 6, y0 - 8);

    // Time axis labels.
    const fmtT = (t: number) => (span <= 2 ? t.toFixed(2) : span <= 30 ? t.toFixed(1) : t.toFixed(0));
    g.textAlign = 'center';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    for (let k = Math.ceil(t0 / major); k * major <= t1 && k < 1000; k += 1) {
      g.fillText(fmtT(k * major), px(k * major), y1 + 15);
    }
    g.fillText(zh ? '时间（s）' : 'time (s)', x0 + plotW / 2, y1 + 32);

    // Trace.
    g.strokeStyle = 'rgba(255,96,96,0.95)';
    g.lineWidth = 1.4;
    g.beginPath();
    for (let i = i0; i < i1; i += 1) {
      const x = px(i / fs);
      const y = py(lead[i]!);
      if (i === i0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // Beat markers, ectopy flags and P/QRS/T annotations.
    const inWin = a.beats.filter((b) => b.timeS >= t0 - 0.02 && b.timeS <= t1 + 0.02);
    const spacing = inWin.length > 0 ? plotW / inWin.length : plotW;
    const annotate = span <= 10 && spacing >= 30;
    for (const b of inWin) {
      const xR = px(b.timeS);
      const yR = py(lead[b.rIndex] ?? 0);
      const pvc = b.label === 'PVC';
      g.strokeStyle = pvc ? 'rgba(255,165,60,0.95)' : 'rgba(140,205,255,0.95)';
      g.fillStyle = pvc ? 'rgba(255,165,60,0.95)' : 'rgba(140,205,255,0.95)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(xR, yR, 3.4, 0, Math.PI * 2);
      g.stroke();
      if (pvc) {
        g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
        g.textAlign = 'center';
        g.fillText('PVC', xR, yR - 8);
      }
      if (!annotate) continue;
      // QRS bridge above the plot area with its duration.
      const xOn = px(b.qrsOn / fs);
      const xOff = px(b.qrsOff / fs);
      const yb = y0 - 12;
      g.strokeStyle = 'rgba(200,214,232,0.85)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xOn, yb + 4);
      g.lineTo(xOn, yb);
      g.lineTo(xOff, yb);
      g.lineTo(xOff, yb + 4);
      g.stroke();
      g.fillStyle = 'rgba(200,214,232,0.9)';
      g.font = `9px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(`${Math.round(b.qrsMs)}`, (xOn + xOff) / 2, yb - 3);
      // Wave letters at their sample positions.
      if (b.pIndex >= 0) {
        const x = px(b.pIndex / fs);
        g.fillStyle = 'rgba(150,225,170,0.95)';
        g.fillText('P', x, py(lead[b.pIndex]!) - 6);
      }
      g.fillStyle = 'rgba(230,238,248,0.95)';
      g.fillText('QRS', xR, yR + 14);
      if (b.tIndex >= 0) {
        const x = px(b.tIndex / fs);
        g.fillStyle = 'rgba(250,210,140,0.95)';
        g.fillText('T', x, py(lead[b.tIndex]!) - 6);
      }
    }

    // Title and legend.
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const winLabel = `${fmtT(t0)}–${fmtT(t1)} s`;
    g.fillText(
      zh
        ? `节律条 · 导联 ${leadName} · ${fs} Hz · ${winLabel}`
        : `Rhythm strip · lead ${leadName} · ${fs} Hz · ${winLabel}`,
      x0,
      20,
    );
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(140,205,255,0.95)';
    g.fillText(zh ? 'R 峰' : 'R peak', x1 - 150, 20);
    g.fillStyle = 'rgba(255,165,60,0.95)';
    g.fillText(zh ? '室早 (PVC)' : 'PVC', x1 - 96, 20);
    g.fillStyle = 'rgba(230,238,248,0.9)';
    g.fillText(zh ? '数字 = QRS 时长 (ms)' : 'number = QRS (ms)', x1 - 40, 20);

    // Bottom metrics strip.
    const s = a.stats;
    g.fillStyle = 'rgba(232,238,248,0.95)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    const conclusion = zh ? a.rhythm.conclusionZh : a.rhythm.conclusion;
    g.fillText(
      zh
        ? `HR ${s.meanHrBpm.toFixed(1)} bpm · RR ${s.meanRrMs.toFixed(0)} ms · SDNN ${s.sdnnMs.toFixed(1)} ms · RMSSD ${s.rmssdMs.toFixed(1)} ms · PVC ${a.pvcCount} · ${conclusion}`
        : `HR ${s.meanHrBpm.toFixed(1)} bpm · RR ${s.meanRrMs.toFixed(0)} ms · SDNN ${s.sdnnMs.toFixed(1)} ms · RMSSD ${s.rmssdMs.toFixed(1)} ms · PVC ${a.pvcCount} · ${conclusion}`,
      padL,
      canvas.height - 14,
    );
    g.textAlign = 'right';
    g.fillStyle = 'rgba(150,165,185,0.85)';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(this.fileName, x1, canvas.height - 14);
  }

  /** Welch periodogram of the RR tachogram with LF/HF band shading. */
  private plotHrv(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const a = this.analysis!;
    const hrv = a.hrv;
    if (!hrv) {
      drawEmptyMessage(
        g,
        canvas,
        zh ? 'HRV 频谱不可用（RR 区间太少）' : 'HRV spectrum unavailable (too few RR intervals)',
        zh ? '加载更长的心电记录以估计 LF / HF 功率' : 'Load a longer ECG record to estimate LF / HF power',
      );
      return;
    }
    const padL = 64;
    const padR = 18;
    const padT = 44;
    const padB = 56;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(10, x1 - x0);
    const plotH = Math.max(10, y1 - y0);

    const fMax = 0.5;
    let pMax = 0;
    for (let k = 0; k < hrv.freqs.length; k += 1) {
      if (hrv.freqs[k]! <= fMax && hrv.psd[k]! > pMax) pMax = hrv.psd[k]!;
    }
    if (!(pMax > 0)) {
      drawEmptyMessage(g, canvas, zh ? '频谱为空' : 'Empty spectrum', zh ? 'RR 间期缺少变异' : 'RR intervals carry no variability');
      return;
    }
    const px = (f: number) => x0 + (f / fMax) * plotW;
    const py = (p: number) => y1 - (p / pMax) * plotH;

    // LF / HF band shading.
    if (this.state.showBands) {
      g.fillStyle = 'rgba(120,200,250,0.10)';
      g.fillRect(px(0.04), y0, px(0.15) - px(0.04), plotH);
      g.fillStyle = 'rgba(240,180,90,0.10)';
      g.fillRect(px(0.15), y0, px(0.4) - px(0.15), plotH);
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillStyle = 'rgba(140,205,255,0.95)';
      g.fillText('LF', (px(0.04) + px(0.15)) / 2, y0 + 14);
      g.fillStyle = 'rgba(245,195,120,0.95)';
      g.fillText('HF', (px(0.15) + px(0.4)) / 2, y0 + 14);
    }

    // Grid + axes.
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let f = 0; f <= fMax + 1e-9; f += 0.05) {
      g.moveTo(px(f), y0);
      g.lineTo(px(f), y1);
    }
    g.stroke();
    const yStep = niceStep(pMax / 5);
    let guard = 0;
    g.beginPath();
    for (let p = 0; p <= pMax && guard < 40; p += yStep, guard += 1) {
      g.moveTo(x0, py(p));
      g.lineTo(x1, py(p));
    }
    g.stroke();

    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'center';
    for (let f = 0; f <= fMax + 1e-9; f += 0.1) {
      g.fillText(f.toFixed(1), px(f), y1 + 15);
    }
    g.fillText(zh ? '频率（Hz）' : 'frequency (Hz)', x0 + plotW / 2, y1 + 32);
    g.textAlign = 'right';
    guard = 0;
    for (let p = 0; p <= pMax && guard < 40; p += yStep, guard += 1) {
      g.fillText(p < 1 ? p.toFixed(2) : p.toFixed(1), x0 - 6, py(p) + 3);
    }
    g.fillText(zh ? 'PSD (ms²/Hz)' : 'PSD (ms2/Hz)', x0 - 6, y0 - 8);

    // PSD curve.
    g.strokeStyle = 'rgba(140,205,255,0.95)';
    g.lineWidth = 1.6;
    g.beginPath();
    let started = false;
    for (let k = 0; k < hrv.freqs.length; k += 1) {
      const f = hrv.freqs[k]!;
      if (f > fMax) break;
      const x = px(f);
      const y = py(hrv.psd[k]!);
      if (!started) {
        g.moveTo(x, y);
        started = true;
      } else g.lineTo(x, y);
    }
    g.stroke();

    // Title and readouts.
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh ? `HRV 频谱 · RR ${a.stats.meanRrMs.toFixed(0)} ms · ${a.beats.length} 拍` : `HRV spectrum · RR ${a.stats.meanRrMs.toFixed(0)} ms · ${a.beats.length} beats`,
      x0,
      20,
    );
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(232,238,248,0.95)';
    g.fillText(
      zh
        ? `LF ${hrv.lfMs2.toFixed(1)} ms² · HF ${hrv.hfMs2.toFixed(1)} ms² · LF/HF ${Number.isFinite(hrv.lfhf) ? hrv.lfhf.toFixed(2) : '—'} · 总功率 ${hrv.totalMs2.toFixed(1)} ms²`
        : `LF ${hrv.lfMs2.toFixed(1)} ms2 · HF ${hrv.hfMs2.toFixed(1)} ms2 · LF/HF ${Number.isFinite(hrv.lfhf) ? hrv.lfhf.toFixed(2) : '-'} · total ${hrv.totalMs2.toFixed(1)} ms2`,
      x0,
      canvas.height - 14,
    );
  }
}

export default function createMedEcgPlugin(): Plugin {
  return new MedEcgPlugin();
}
