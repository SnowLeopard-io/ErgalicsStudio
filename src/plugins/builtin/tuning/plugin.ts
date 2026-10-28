// ==========================================================================
// tuning — Tuning System Calculator
//
// Compares historical temperaments on a cent grid, maps MIDI notes to Hz and
// analyses the seven diatonic modes. CSV import accepts any tuning table
// (degree/name/ratio/cents), which is also the Block/Flow entry point.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { tuningFigurePanels } from './figure';
import { tuningManifest } from './manifest';
import {
  MODES,
  MODE_IDS,
  TUNINGS,
  TUNING_IDS,
  centsBetween,
  midiToFreq,
  modeScale,
  noteName,
  parseTuningCsv,
  ratioLabel,
  ratioToCents,
  runTuningBenchmarks,
  tuningScale,
  type ModeId,
  type TuningCsvRow,
  type TuningId,
  type TuningRow,
} from './kernel';

export { tuningManifest } from './manifest';

type ViewId = 'deviation' | 'mode' | 'table';

interface State {
  tuning: TuningId;
  tonic: number;
  a4: number;
  mode: ModeId;
  view: ViewId;
}

export class TuningPlugin implements Plugin {
  readonly manifest = tuningManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private imported: TuningCsvRow[] | null = null;
  private state: State = { tuning: 'just', tonic: 60, a4: 440, mode: 'ionian', view: 'deviation' };

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
        key: 'tuning',
        label: 'Tuning system',
        labelI18n: { 'zh-CN': '音律系统', 'en-US': 'Tuning system' },
        type: 'select',
        options: TUNING_IDS.map((id) => ({
          value: id,
          label: this.zh ? TUNINGS[id].labelZh : TUNINGS[id].labelEn,
          labelI18n: { 'zh-CN': TUNINGS[id].labelZh, 'en-US': TUNINGS[id].labelEn },
        })),
        value: s.tuning,
      },
      {
        key: 'tonic',
        label: 'Tonic (MIDI)',
        labelI18n: { 'zh-CN': '主音（MIDI）', 'en-US': 'Tonic (MIDI)' },
        type: 'range',
        min: 36,
        max: 84,
        step: 1,
        value: s.tonic,
        hint: this.zh ? '60 = C4，69 = A4' : '60 = C4, 69 = A4',
      },
      {
        key: 'a4',
        label: 'A4 reference (Hz)',
        labelI18n: { 'zh-CN': 'A4 基准频率（Hz）', 'en-US': 'A4 reference (Hz)' },
        type: 'number',
        min: 392,
        max: 466,
        step: 0.1,
        value: s.a4,
      },
      {
        key: 'mode',
        label: 'Diatonic mode',
        labelI18n: { 'zh-CN': '教会调式', 'en-US': 'Diatonic mode' },
        type: 'select',
        options: MODE_IDS.map((id) => ({
          value: id,
          label: this.zh ? MODES[id].labelZh : MODES[id].labelEn,
          labelI18n: { 'zh-CN': MODES[id].labelZh, 'en-US': MODES[id].labelEn },
        })),
        value: s.mode,
        visibleWhen: { key: 'view', in: ['mode'] },
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'deviation', label: this.zh ? '音分偏差与键盘' : 'Cent deviation & keyboard' },
          { value: 'mode', label: this.zh ? '调式音程' : 'Mode intervals' },
          { value: 'table', label: this.zh ? '数值表' : 'Numerical table' },
        ],
        value: s.view,
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('exportCsv', 'Export tuning CSV', '导出音律 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.tuning === 'string' && params.tuning in TUNINGS && params.tuning !== this.state.tuning) {
      this.state.tuning = params.tuning as TuningId;
      this.draw();
    }
    if (typeof params.mode === 'string' && params.mode in MODES && params.mode !== this.state.mode) {
      this.state.mode = params.mode as ModeId;
      this.draw();
    }
    if (typeof params.view === 'string' && ['deviation', 'mode', 'table'].includes(params.view)) {
      if (params.view !== this.state.view) {
        this.state.view = params.view as ViewId;
        this.draw();
      }
    }
    if (typeof params.tonic === 'number' && Number.isFinite(params.tonic)) {
      const tonic = Math.round(Math.min(84, Math.max(36, params.tonic)));
      if (tonic !== this.state.tonic) {
        this.state.tonic = tonic;
        this.draw();
      }
    }
    if (typeof params.a4 === 'number' && Number.isFinite(params.a4)) {
      const a4 = Math.min(466, Math.max(392, params.a4));
      if (a4 !== this.state.a4) {
        this.state.a4 = a4;
        this.draw();
      }
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const rows = parseTuningCsv(await file.text());
    if (rows.length === 0) {
      notify(
        this.api,
        'warning',
        'No tuning rows found (expected degree, name, ratio, cents).',
        '未找到音律行（需要 degree、name、ratio、cents 列）。',
      );
      return;
    }
    this.imported = rows;
    this.state.view = 'table';
    this.draw();
    notify(
      this.api,
      'success',
      `Loaded ${rows.length} tuning rows from ${file.name}.`,
      `已从 ${file.name} 载入 ${rows.length} 行音律数据。`,
    );
  }

  // ---- data ------------------------------------------------------------------

  private scale() {
    return tuningScale(this.state.tuning, this.state.tonic, this.state.a4);
  }

  private modeRows() {
    return modeScale(this.state.mode, this.state.tuning, this.state.tonic, this.state.a4);
  }

  private displayRows(): Array<{ degree: number; note: string; ratio: number; label: string; freq: number; cents: number; dev: number; beat: number }> {
    const scale = this.scale();
    if (this.imported) {
      return this.imported.map((r) => ({
        degree: r.degree,
        note: r.name,
        ratio: r.ratio,
        label: ratioLabel(r.ratio),
        freq: scale.tonicFreq * r.ratio,
        cents: r.cents,
        dev: r.cents - r.degree * 100,
        beat: Math.abs(scale.tonicFreq * r.ratio - scale.tonicFreq * 2 ** (r.degree / 12)),
      }));
    }
    return scale.rows.map((r) => ({
      degree: r.degree,
      note: r.note,
      ratio: r.ratio,
      label: r.ratioLabel,
      freq: r.freq,
      cents: r.cents,
      dev: r.devCents,
      beat: Math.abs(r.freq - scale.tonicFreq * 2 ** (r.degree / 12)),
    }));
  }

  // ---- actions ---------------------------------------------------------------

  private runBenchmark() {
    const bench = runTuningBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: this.zh
        ? `实测 ${b.measured.toFixed(6)} / 参考 ${b.expected.toFixed(6)}，统一相对误差`
        : `measured ${b.measured.toFixed(6)} / reference ${b.expected.toFixed(6)}, unified relative error`,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} tuning benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项音律基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  private exportCsv() {
    const rows = this.displayRows();
    exportRowsCsv(
      this.api,
      'tuning-table',
      ['degree', 'note', 'ratio', 'ratio_fraction', 'frequency_hz', 'cents', 'dev_from_12tet_cents', 'beat_vs_12tet_hz'],
      rows.map((r) => [
        r.degree,
        r.note,
        Number(r.ratio.toFixed(8)),
        r.label,
        Number(r.freq.toFixed(4)),
        Number(r.cents.toFixed(4)),
        Number(r.dev.toFixed(4)),
        Number(r.beat.toFixed(4)),
      ]),
    );
  }

  private async sendToFigure() {
    const scale = this.scale();
    const rows = this.modeRows();
    const mode = MODES[this.state.mode];
    const worst = this.displayRows().reduce((m, r) => (Math.abs(r.dev) > Math.abs(m) ? r.dev : m), 0);
    const caption: Bilingual = {
      zh: `音律对比：${scale.tuning.labelZh}，主音 ${scale.tonicName}（${scale.tonicFreq.toFixed(2)} Hz），A4=${scale.a4} Hz；最大 12-TET 偏差 ${worst.toFixed(2)} 音分，调式 ${mode.labelZh}。`,
      en: `Tuning comparison: ${scale.tuning.labelEn}, tonic ${scale.tonicName} (${scale.tonicFreq.toFixed(2)} Hz), A4=${scale.a4} Hz; worst 12-TET deviation ${worst.toFixed(2)} cents, mode ${mode.labelEn}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '音律系统对比', en: 'Tuning System Comparison' },
      caption,
      tuningFigurePanels({ scale, modeRows: rows, modeLabel: this.zh ? mode.labelZh : mode.labelEn }),
    );
  }

  // ---- drawing ---------------------------------------------------------------

  private publish() {
    const scale = this.scale();
    const rows = this.displayRows();
    const worst = rows.reduce((m, r) => (Math.abs(r.dev) > Math.abs(m) ? r.dev : m), 0);
    const maxBeat = rows.reduce((m, r) => Math.max(m, r.beat), 0);
    const fifth = scale.rows[7]!;
    const metrics: ScienceMetric[] = [
      {
        key: 'tonic-freq',
        label: 'Tonic frequency',
        value: fmtMetric(scale.tonicFreq),
        unit: 'Hz',
        severity: 'info',
        hint: `${scale.tonicName} · A4=${scale.a4} Hz · ${this.zh ? scale.tuning.labelZh : scale.tuning.labelEn}`,
      },
      {
        key: 'worst-dev',
        label: 'Max 12-TET deviation',
        value: fmtMetric(worst),
        unit: 'cent',
        severity: Math.abs(worst) < 5 ? 'ok' : 'info',
        hint: this.zh ? '十二个半音中相对平均律的最大音分偏差（带符号）' : 'signed cent deviation farthest from 12-TET across the twelve degrees',
      },
      {
        key: 'fifth',
        label: 'Fifth width',
        value: fmtMetric(fifth.cents),
        unit: 'cent',
        severity: Math.abs(fifth.cents - 700) < 1 ? 'ok' : 'info',
        hint: this.zh
          ? `主音上的五度 ${fifth.ratioLabel}；纯五度参考 701.955 音分`
          : `fifth above the tonic ${fifth.ratioLabel}; pure fifth reference 701.955 cents`,
      },
      {
        key: 'max-beat',
        label: 'Max beat vs 12-TET',
        value: fmtMetric(maxBeat),
        unit: 'Hz',
        severity: 'info',
        hint: this.zh ? '同时奏响时与平均律对应音的最大拍频' : 'largest beat rate against the equal-tempered counterpart',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 820;
    canvas.height = canvas.clientHeight || 460;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const scale = this.scale();
    this.publish();
    this.drawHeader(g, canvas, zh);

    if (this.state.view === 'table') this.drawTable(g, canvas, zh);
    else if (this.state.view === 'mode') this.drawMode(g, canvas, zh);
    else this.drawDeviation(g, canvas, zh);

    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.textAlign = 'left';
    g.fillText(
      this.imported
        ? zh
          ? `已导入 ${this.imported.length} 行自定义音律（${scale.tonicName} 为参考主音）`
          : `imported ${this.imported.length} custom tuning rows (referenced to ${scale.tonicName})`
        : `A4=${scale.a4} Hz · ${notesLine(scale.rows)}`,
      54,
      canvas.height - 14,
    );
  }

  private drawHeader(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const s = this.scale();
    g.font = `14px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(235,241,250,0.96)';
    g.fillText(
      zh
        ? `${s.tuning.labelZh} · 主音 ${s.tonicName} · ${s.tonicFreq.toFixed(2)} Hz`
        : `${s.tuning.labelEn} · tonic ${s.tonicName} · ${s.tonicFreq.toFixed(2)} Hz`,
      canvas.width / 2,
      20,
    );
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'center';
    g.fillText(zh ? s.tuning.noteZh : s.tuning.noteEn, canvas.width / 2, 38);
  }

  private drawDeviation(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const rows = this.displayRows();
    const x0 = 56;
    const x1 = canvas.width - 20;
    const y0 = 56;
    const y1 = canvas.height - 96;
    const plotW = Math.max(x1 - x0, 20);
    const plotH = Math.max(y1 - y0, 20);
    const maxAbs = Math.max(10, ...rows.map((r) => Math.abs(r.dev))) * 1.18;
    const py = (v: number) => y1 - ((v + maxAbs) / (2 * maxAbs)) * plotH;
    const px = (i: number) => x0 + (plotW * (i + 0.5)) / Math.max(rows.length, 1);

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    // cent grid
    g.font = `10px Consolas, monospace`;
    g.textAlign = 'right';
    for (let c = -Math.floor(maxAbs / 10) * 10; c <= maxAbs; c += 10) {
      const yy = py(c);
      if (yy < y0 || yy > y1) continue;
      g.strokeStyle = c === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(x0, yy);
      g.lineTo(x1, yy);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.85)';
      g.fillText(`${c > 0 ? '+' : ''}${c}`, x0 - 6, yy + 3);
    }

    const barW = Math.min(34, (plotW / Math.max(rows.length, 1)) * 0.55);
    rows.forEach((r, i) => {
      const x = px(i);
      const yv = py(r.dev);
      const yz = py(0);
      g.fillStyle = r.dev >= 0 ? 'rgba(120,200,255,0.75)' : 'rgba(255,150,130,0.75)';
      g.fillRect(x - barW / 2, Math.min(yv, yz), barW, Math.max(1, Math.abs(yz - yv)));
      g.fillStyle = 'rgba(255,214,102,0.95)';
      g.beginPath();
      g.arc(x, yv, 2.6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(235,241,250,0.95)';
      g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(r.note, x, y1 + 15);
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.font = `9px Consolas, monospace`;
      g.fillText(`${r.dev > 0 ? '+' : ''}${r.dev.toFixed(1)}`, x, y1 + 28);
    });

    // keyboard strip
    const kbY = y1 + 40;
    const kbH = Math.min(48, canvas.height - kbY - 26);
    const kw = plotW / Math.max(rows.length, 1);
    rows.forEach((r, i) => {
      const black = r.note.includes('♯');
      const kx = x0 + i * kw;
      g.fillStyle = black ? 'rgba(30,34,42,0.95)' : 'rgba(232,238,248,0.9)';
      g.fillRect(kx + 1, kbY, kw - 2, black ? kbH * 0.62 : kbH);
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.strokeRect(kx + 1, kbY, kw - 2, black ? kbH * 0.62 : kbH);
      g.fillStyle = black ? 'rgba(220,228,240,0.95)' : 'rgba(20,24,32,0.9)';
      g.font = `9px Consolas, monospace`;
      g.textAlign = 'center';
      g.fillText(r.freq.toFixed(1), kx + kw / 2, kbY + kbH + 12);
    });
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(zh ? '相对 12-TET 的音分偏差（Hz 标于键下）' : 'cent deviation from 12-TET (Hz under keys)', x0, y0 - 8);
  }

  private drawMode(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const rows = this.modeRows();
    const scale = this.scale();
    const x0 = 64;
    const x1 = canvas.width - 24;
    const plotW = Math.max(x1 - x0, 20);
    const y = 88;
    const total = rows[rows.length - 1]!.cents;
    const px = (c: number) => x0 + (plotW * c) / Math.max(total, 1);

    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    for (const r of rows) {
      const x = px(r.cents);
      g.strokeStyle = 'rgba(120,200,255,0.6)';
      g.beginPath();
      g.moveTo(x, y - 12);
      g.lineTo(x, y + 12);
      g.stroke();
      g.fillStyle = 'rgba(255,214,102,0.95)';
      g.beginPath();
      g.arc(x, y, 3.4, 0, Math.PI * 2);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = 'rgba(235,241,250,0.96)';
      g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(`${r.step} ${r.note}`, x, y - 22);
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.font = `9px Consolas, monospace`;
      g.fillText(`${r.cents.toFixed(0)}¢`, x, y + 26);
      g.fillText(`${r.freq.toFixed(1)} Hz`, x, y + 39);
      g.fillText(r.ratioLabel, x, y + 51);
    }
    const mode = MODES[this.state.mode];
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `${mode.labelZh} · ${scale.tonicName} · 步宽（音分）：`
        : `${mode.labelEn} · ${scale.tonicName} · step widths (cent):`,
      x0,
      y + 90,
    );
    let acc = 0;
    const segs = rows.map((r) => {
      const start = acc;
      acc += r.stepCents;
      return `${r.stepCents.toFixed(1)} [${start.toFixed(0)}–${acc.toFixed(0)}]`;
    });
    g.fillStyle = 'rgba(235,241,250,0.9)';
    g.fillText(segs.join('   '), x0, y + 108);
    g.fillStyle = 'rgba(170,182,200,0.85)';
    g.fillText(
      zh
        ? '提示：调式步宽之和为 1200 音分（一个八度）。'
        : 'Note: mode step widths sum to 1200 cents (one octave).',
      x0,
      y + 132,
    );
  }

  private drawTable(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const rows = this.displayRows();
    const cols = zh
      ? ['音级', '音名', '频率 Hz', '比值', '音分', '偏差 ¢', '拍频 Hz']
      : ['deg', 'note', 'freq Hz', 'ratio', 'cent', 'dev ¢', 'beat Hz'];
    const x0 = 54;
    const top = 58;
    const cw = (canvas.width - x0 - 24) / cols.length;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    cols.forEach((c, j) => g.fillText(c, x0 + j * cw, top));
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.beginPath();
    g.moveTo(x0, top + 7);
    g.lineTo(canvas.width - 24, top + 7);
    g.stroke();
    const rowH = Math.max(14, Math.min(22, (canvas.height - top - 48) / Math.max(rows.length, 1)));
    rows.forEach((r, i) => {
      const yy = top + 16 + i * rowH;
      g.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0)';
      g.fillRect(x0, yy - rowH + 4, canvas.width - x0 - 24, rowH);
      g.fillStyle = 'rgba(235,241,250,0.95)';
      const cells = [
        String(r.degree),
        r.note,
        r.freq.toFixed(2),
        r.label,
        r.cents.toFixed(2),
        `${r.dev > 0 ? '+' : ''}${r.dev.toFixed(2)}`,
        r.beat.toFixed(2),
      ];
      cells.forEach((c, j) => g.fillText(c, x0 + j * cw, yy));
    });
  }
}

function notesLine(rows: TuningRow[]): string {
  return rows.map((r) => r.note).join(' ');
}

export default function createTuningPlugin(): Plugin {
  return new TuningPlugin();
}

// Re-export a few helpers so the plugin's public surface stays convenient in
// tests and in follow-up extensions.
export { centsBetween, midiToFreq, noteName, ratioToCents };
