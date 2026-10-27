// ==========================================================================
// synth — Synthesizer Lab
//
// The design surface edits one preset at a time (oscillator, FM, filter,
// ADSR, LFO). Rendering is offline on the CPU; pressing Play hands the
// buffer to the shared clip player, and Export writes 16-bit PCM WAV.
// Nothing plays automatically.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { AudioClipPlayer, audioErrorText, type AudioClip } from '@/core/audio';
import { synthFigurePanels } from './figure';
import { synthManifest } from './manifest';
import {
  DEFAULT_PRESETS,
  adsrGain,
  biquadCoeffs,
  biquadResponse,
  lfoValue,
  noteFrequency,
  parsePresetsJson,
  renderPreset,
  renderPresetWav,
  runSynthBenchmarks,
  type FilterKind,
  type LfoShape,
  type SynthPreset,
  type WaveKind,
} from './kernel';

export { synthManifest } from './manifest';

type ViewId = 'waveform' | 'filter' | 'envelope' | 'lfo';

interface State {
  presetIndex: number;
  view: ViewId;
  playing: boolean;
}

const VIEWS: Array<{ value: ViewId; en: string; zh: string }> = [
  { value: 'waveform', en: 'Waveform', zh: '波形' },
  { value: 'filter', en: 'Filter response', zh: '滤波器响应' },
  { value: 'envelope', en: 'ADSR envelope', zh: 'ADSR 包络' },
  { value: 'lfo', en: 'LFO modulation', zh: 'LFO 调制' },
];

const WAVES: Array<{ value: WaveKind; en: string; zh: string }> = [
  { value: 'sine', en: 'Sine', zh: '正弦波' },
  { value: 'square', en: 'Square', zh: '方波' },
  { value: 'sawtooth', en: 'Sawtooth', zh: '锯齿波' },
  { value: 'triangle', en: 'Triangle', zh: '三角波' },
  { value: 'wavetable', en: 'Wavetable (additive)', zh: '波表（加法）' },
];

const FILTERS: Array<{ value: FilterKind; en: string; zh: string }> = [
  { value: 'lowpass', en: 'Low-pass', zh: '低通' },
  { value: 'highpass', en: 'High-pass', zh: '高通' },
  { value: 'bandpass', en: 'Band-pass', zh: '带通' },
  { value: 'notch', en: 'Notch', zh: '陷波' },
];

const LFO_SHAPES: Array<{ value: LfoShape; en: string; zh: string }> = [
  { value: 'sine', en: 'Sine', zh: '正弦' },
  { value: 'triangle', en: 'Triangle', zh: '三角' },
  { value: 'square', en: 'Square', zh: '方波' },
];

export class SynthPlugin implements Plugin {
  readonly manifest = synthManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private player = new AudioClipPlayer();
  private presets: SynthPreset[] = DEFAULT_PRESETS.map((p) => ({ ...p, adsr: { ...p.adsr } }));
  private state: State = { presetIndex: 0, view: 'waveform', playing: false };
  private rendered: Float64Array | null = null;
  private renderKey = '';

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
    this.player.dispose();
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stopPlayback(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    const p = this.preset();
    const s = this.state;
    return [
      {
        key: 'presetIndex',
        label: 'Preset',
        labelI18n: { 'zh-CN': '预设', 'en-US': 'Preset' },
        type: 'select',
        options: this.presets.map((preset, i) => ({
          value: String(i),
          label: `${i + 1}. ${preset.name}`,
        })),
        value: String(s.presetIndex),
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: VIEWS.map((v) => ({ value: v.value, label: this.zh ? v.zh : v.en })),
        value: s.view,
      },
      {
        key: 'wave',
        label: 'Oscillator',
        labelI18n: { 'zh-CN': '振荡器波形', 'en-US': 'Oscillator' },
        type: 'select',
        options: WAVES.map((w) => ({ value: w.value, label: this.zh ? w.zh : w.en })),
        value: p.wave,
      },
      {
        key: 'midi',
        label: 'Note (MIDI)',
        labelI18n: { 'zh-CN': '音符（MIDI）', 'en-US': 'Note (MIDI)' },
        type: 'range',
        min: 24,
        max: 108,
        step: 1,
        value: p.midi,
      },
      {
        key: 'detune',
        label: 'Detune (cent)',
        labelI18n: { 'zh-CN': '失谐（音分）', 'en-US': 'Detune (cent)' },
        type: 'range',
        min: -50,
        max: 50,
        step: 1,
        value: p.detune,
      },
      {
        key: 'fmIndex',
        label: 'FM index',
        labelI18n: { 'zh-CN': 'FM 调制指数', 'en-US': 'FM index' },
        type: 'range',
        min: 0,
        max: 8,
        step: 0.05,
        value: p.fmIndex,
      },
      {
        key: 'fmRatio',
        label: 'FM ratio',
        labelI18n: { 'zh-CN': 'FM 频率比', 'en-US': 'FM ratio' },
        type: 'range',
        min: 0.25,
        max: 8,
        step: 0.25,
        value: p.fmRatio,
      },
      {
        key: 'filter',
        label: 'Filter',
        labelI18n: { 'zh-CN': '滤波器类型', 'en-US': 'Filter' },
        type: 'select',
        options: FILTERS.map((f) => ({ value: f.value, label: this.zh ? f.zh : f.en })),
        value: p.filter,
      },
      {
        key: 'cutoff',
        label: 'Cutoff (Hz)',
        labelI18n: { 'zh-CN': '截止频率（Hz）', 'en-US': 'Cutoff (Hz)' },
        type: 'number',
        min: 40,
        max: 18000,
        step: 10,
        value: p.cutoff,
      },
      {
        key: 'q',
        label: 'Resonance Q',
        labelI18n: { 'zh-CN': '共振 Q', 'en-US': 'Resonance Q' },
        type: 'range',
        min: 0.1,
        max: 12,
        step: 0.1,
        value: p.q,
      },
      {
        key: 'attack',
        label: 'Attack (s)',
        labelI18n: { 'zh-CN': '起音（s）', 'en-US': 'Attack (s)' },
        type: 'range',
        min: 0,
        max: 2,
        step: 0.005,
        value: p.adsr.attack,
      },
      {
        key: 'decay',
        label: 'Decay (s)',
        labelI18n: { 'zh-CN': '衰减（s）', 'en-US': 'Decay (s)' },
        type: 'range',
        min: 0,
        max: 2,
        step: 0.005,
        value: p.adsr.decay,
      },
      {
        key: 'sustain',
        label: 'Sustain (0–1)',
        labelI18n: { 'zh-CN': '延音电平（0–1）', 'en-US': 'Sustain (0–1)' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
        value: p.adsr.sustain,
      },
      {
        key: 'release',
        label: 'Release (s)',
        labelI18n: { 'zh-CN': '释音（s）', 'en-US': 'Release (s)' },
        type: 'range',
        min: 0,
        max: 3,
        step: 0.01,
        value: p.adsr.release,
      },
      {
        key: 'lfoRate',
        label: 'LFO rate (Hz)',
        labelI18n: { 'zh-CN': 'LFO 速率（Hz）', 'en-US': 'LFO rate (Hz)' },
        type: 'range',
        min: 0.05,
        max: 20,
        step: 0.05,
        value: p.lfoRate,
        visibleWhen: { key: 'view', in: ['lfo'] },
      },
      {
        key: 'lfoDepth',
        label: 'LFO depth (octave)',
        labelI18n: { 'zh-CN': 'LFO 深度（倍频程）', 'en-US': 'LFO depth (octave)' },
        type: 'range',
        min: 0,
        max: 2,
        step: 0.01,
        value: p.lfoDepth,
        visibleWhen: { key: 'view', in: ['lfo'] },
      },
      {
        key: 'lfoShape',
        label: 'LFO shape',
        labelI18n: { 'zh-CN': 'LFO 波形', 'en-US': 'LFO shape' },
        type: 'select',
        options: LFO_SHAPES.map((l) => ({ value: l.value, label: this.zh ? l.zh : l.en })),
        value: p.lfoShape,
        visibleWhen: { key: 'view', in: ['lfo'] },
      },
      actionButton('playPreset', 'Render & play', '渲染并播放', 'primary'),
      actionButton('stopSynth', 'Stop audio', '停止播放'),
      actionButton('exportWav', 'Export WAV', '导出 WAV'),
      actionButton('importPreset', 'Import preset JSON', '导入预设 JSON'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export filter response CSV', '导出滤波器响应 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const p = this.preset();
    let changed = false;
    if (typeof params.presetIndex === 'string') {
      const idx = Number(params.presetIndex);
      if (Number.isInteger(idx) && idx >= 0 && idx < this.presets.length && idx !== this.state.presetIndex) {
        this.state.presetIndex = idx;
        this.player.stop();
        this.state.playing = false;
        changed = true;
      }
    }
    if (typeof params.view === 'string' && VIEWS.some((v) => v.value === params.view)) {
      if (params.view !== this.state.view) {
        this.state.view = params.view as ViewId;
        changed = true;
      }
    }
    if (typeof params.wave === 'string' && WAVES.some((w) => w.value === params.wave) && params.wave !== p.wave) {
      p.wave = params.wave as WaveKind;
      changed = true;
    }
    if (typeof params.filter === 'string' && FILTERS.some((f) => f.value === params.filter) && params.filter !== p.filter) {
      p.filter = params.filter as FilterKind;
      changed = true;
    }
    if (typeof params.lfoShape === 'string' && LFO_SHAPES.some((l) => l.value === params.lfoShape) && params.lfoShape !== p.lfoShape) {
      p.lfoShape = params.lfoShape as LfoShape;
      changed = true;
    }
    const num = (key: string, apply: (v: number) => void, min: number, max: number): void => {
      const v = params[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const next = Math.min(max, Math.max(min, v));
      apply(next);
      changed = true;
    };
    num('midi', (v) => (p.midi = Math.round(v)), 24, 108);
    num('detune', (v) => (p.detune = v), -50, 50);
    num('fmIndex', (v) => (p.fmIndex = v), 0, 8);
    num('fmRatio', (v) => (p.fmRatio = v), 0.25, 8);
    num('cutoff', (v) => (p.cutoff = v), 40, 18000);
    num('q', (v) => (p.q = v), 0.1, 12);
    num('attack', (v) => (p.adsr.attack = v), 0, 2);
    num('decay', (v) => (p.adsr.decay = v), 0, 2);
    num('sustain', (v) => (p.adsr.sustain = v), 0, 1);
    num('release', (v) => (p.adsr.release = v), 0, 3);
    num('lfoRate', (v) => (p.lfoRate = v), 0.05, 20);
    num('lfoDepth', (v) => (p.lfoDepth = v), 0, 2);
    if (changed) this.draw();

    if (actionFired(params, 'playPreset')) void this.play();
    if (actionFired(params, 'stopSynth')) this.stopPlayback(true);
    if (actionFired(params, 'exportWav')) this.exportWav();
    if (actionFired(params, 'importPreset')) void this.importPreset();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (low.endsWith('.json')) {
      const presets = parsePresetsJson(await file.text());
      if (presets.length === 0) {
        notify(this.api, 'warning', 'No valid synth presets found in this JSON.', '该 JSON 中没有有效的合成器预设。');
        return;
      }
      this.presets = [...this.presets, ...presets];
      this.state.presetIndex = this.presets.length - presets.length;
      this.resetRender();
      this.draw();
      notify(
        this.api,
        'success',
        `Imported ${presets.length} preset(s) from ${file.name}.`,
        `已从 ${file.name} 导入 ${presets.length} 个预设。`,
      );
      return;
    }
    // Numeric CSV: midi,duration_s — retune the current preset.
    const lines = (await file.text())
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    const first = lines[0]?.split(/[,\t;]/).map(Number) ?? [];
    if (first.length >= 1 && Number.isFinite(first[0]) && first[0]! >= 0 && first[0]! <= 127) {
      const p = this.preset();
      p.midi = Math.round(first[0]!);
      if (first.length >= 2 && Number.isFinite(first[1])) p.duration = Math.min(20, Math.max(0.1, first[1]!));
      this.resetRender();
      this.draw();
      notify(
        this.api,
        'success',
        `Loaded note ${p.midi}${first.length >= 2 ? `, ${p.duration.toFixed(2)} s` : ''} from ${file.name}.`,
        `已从 ${file.name} 载入音符 ${p.midi}${first.length >= 2 ? `，${p.duration.toFixed(2)} 秒` : ''}。`,
      );
      return;
    }
    notify(
      this.api,
      'warning',
      'Unsupported preset file (expected JSON presets or a CSV starting with MIDI note).',
      '不支持的预设文件（需要 JSON 预设，或以 MIDI 音符开头的 CSV）。',
    );
  }

  // ---- audio actions ---------------------------------------------------------

  private async play() {
    const p = this.preset();
    const rendered = this.renderedSamples();
    if (!this.player.available) {
      notify(this.api, 'warning', 'Web Audio is unavailable in this environment.', '当前环境没有可用的 Web Audio。');
      return;
    }
    const clip: AudioClip = {
      name: p.name,
      sampleRate: 44100,
      channels: 1,
      duration: rendered.length / 44100,
      samples: rendered,
      channelData: [rendered],
      codec: 'decoded',
    };
    try {
      await this.player.play(clip, 0, () => {
        this.state.playing = false;
        this.draw();
      });
      this.state.playing = true;
      this.draw();
    } catch (err) {
      notify(this.api, 'error', audioErrorText(err, false), audioErrorText(err, true));
    }
  }

  private stopPlayback(redraw: boolean) {
    this.player.stop();
    this.state.playing = false;
    if (redraw) this.draw();
  }

  private exportWav() {
    const p = this.preset();
    const wav = renderPresetWav(p, 44100);
    this.api.exportFile(`synth-${p.name.replace(/[^\w-]+/g, '_')}.wav`, wav, 'audio/wav');
    notify(this.api, 'success', 'WAV exported.', 'WAV 已导出。');
  }

  private async importPreset() {
    const file = await this.api.openFile();
    if (file) await this.loadData(file);
  }

  // ---- numerics --------------------------------------------------------------

  private preset(): SynthPreset {
    return this.presets[this.state.presetIndex] ?? this.presets[0]!;
  }

  private resetRender() {
    this.rendered = null;
    this.renderKey = '';
  }

  private renderedSamples(): Float64Array {
    const p = this.preset();
    const key = JSON.stringify(p);
    if (!this.rendered || key !== this.renderKey) {
      this.rendered = renderPreset(p, 44100);
      this.renderKey = key;
    }
    return this.rendered;
  }

  private runBenchmark() {
    const bench = runSynthBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: this.zh
        ? `实测 ${b.measured.toPrecision(8)} / 参考 ${b.expected.toPrecision(8)}，统一相对误差`
        : `measured ${b.measured.toPrecision(8)} / reference ${b.expected.toPrecision(8)}, unified relative error`,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} synthesis benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项合成基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  private exportCsv() {
    const p = this.preset();
    const coeffs = biquadCoeffs(p.filter, 44100, p.cutoff, p.q);
    const freqs: number[] = [];
    const count = 512;
    for (let k = 0; k <= count; k += 1) freqs.push(20 * (20000 / 20) ** (k / count));
    const resp = biquadResponse(coeffs, 44100, freqs);
    exportRowsCsv(
      this.api,
      'synth-filter-response',
      ['frequency_hz', 'gain_db'],
      freqs.map((f, k) => [Number(f.toFixed(2)), Number(resp[k]!.toFixed(4))]),
    );
  }

  private async sendToFigure() {
    const p = this.preset();
    const rendered = this.renderedSamples();
    const caption: Bilingual = {
      zh: `合成器预设「${p.name}」：${p.wave}，MIDI ${p.midi}（${noteFrequency(p.midi).toFixed(2)} Hz），${p.filter} 截止 ${p.cutoff} Hz / Q ${p.q.toFixed(2)}，ADSR ${p.adsr.attack}/${p.adsr.decay}/${p.adsr.sustain}/${p.adsr.release} s。`,
      en: `Synth preset "${p.name}": ${p.wave}, MIDI ${p.midi} (${noteFrequency(p.midi).toFixed(2)} Hz), ${p.filter} at ${p.cutoff} Hz / Q ${p.q.toFixed(2)}, ADSR ${p.adsr.attack}/${p.adsr.decay}/${p.adsr.sustain}/${p.adsr.release} s.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '合成器声音设计', en: 'Synthesizer Sound Design' },
      caption,
      synthFigurePanels({ preset: p, rendered, sampleRate: 44100 }),
    );
  }

  private publish() {
    const p = this.preset();
    const rendered = this.renderedSamples();
    const f0 = noteFrequency(p.midi);
    const coeffs = biquadCoeffs(p.filter, 44100, p.cutoff, p.q);
    const atCutoff = biquadResponse(coeffs, 44100, new Float64Array([p.cutoff]))[0]!;
    let rms = 0;
    for (let i = 0; i < rendered.length; i += 1) rms += rendered[i]! * rendered[i]!;
    rms = Math.sqrt(rms / Math.max(1, rendered.length));
    const metrics: ScienceMetric[] = [
      {
        key: 'frequency',
        label: 'Note frequency',
        value: fmtMetric(f0, 2),
        unit: 'Hz',
        severity: 'info',
        hint: `MIDI ${p.midi} · ${p.wave}${p.detune !== 0 ? ` · detune ${p.detune} 音分` : ''}`,
      },
      {
        key: 'cutoff',
        label: 'Filter cutoff / Q',
        value: `${p.cutoff} Hz / ${p.q.toFixed(2)}`,
        severity: 'info',
        hint: `${p.filter} · ${this.zh ? '截止处增益' : 'gain at cutoff'} ${atCutoff.toFixed(2)} dB`,
      },
      {
        key: 'adsr',
        label: 'ADSR',
        value: `${p.adsr.attack.toFixed(2)} / ${p.adsr.decay.toFixed(2)} / ${p.adsr.sustain.toFixed(2)} / ${p.adsr.release.toFixed(2)}`,
        severity: 'info',
        hint: this.zh ? '起音 / 衰减 / 延音 / 释音（秒）' : 'attack / decay / sustain / release (s)',
      },
      {
        key: 'fm',
        label: 'FM ratio / index',
        value: `${p.fmRatio.toFixed(2)} / ${p.fmIndex.toFixed(2)}`,
        severity: 'info',
        hint: this.zh ? '调制器:载波频率比与调制指数' : 'modulator:carrier ratio and modulation index',
      },
      {
        key: 'rms',
        label: 'Rendered RMS',
        value: fmtMetric(20 * Math.log10(Math.max(rms, 1e-9)), 2),
        unit: 'dBFS',
        severity: 'info',
        hint: `${(rendered.length / 44100).toFixed(2)} s · 44.1 kHz · ${this.zh ? '离线渲染' : 'offline render'}`,
      },
      {
        key: 'lfo',
        label: 'LFO',
        value: `${p.lfoRate.toFixed(2)} Hz × ${p.lfoDepth.toFixed(2)} oct`,
        severity: 'info',
        hint: `${p.lfoShape} · ${this.zh ? '调制截止频率' : 'modulates cutoff'}`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing ---------------------------------------------------------------

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
    this.publish();
    const p = this.preset();
    g.textAlign = 'center';
    g.font = `14px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(235,241,250,0.96)';
    g.fillText(`${p.name}${this.state.playing ? (zh ? ' · 正在播放' : ' · playing') : ''}`, canvas.width / 2, 20);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.92)';
    g.fillText(
      zh
        ? `MIDI ${p.midi}（${noteFrequency(p.midi).toFixed(1)} Hz）· ${p.wave} · ${p.filter} ${p.cutoff} Hz · ADSR`
        : `MIDI ${p.midi} (${noteFrequency(p.midi).toFixed(1)} Hz) · ${p.wave} · ${p.filter} ${p.cutoff} Hz · ADSR`,
      canvas.width / 2,
      38,
    );

    switch (this.state.view) {
      case 'filter':
        this.drawFilter(g, canvas, zh);
        break;
      case 'envelope':
        this.drawEnvelope(g, canvas, zh);
        break;
      case 'lfo':
        this.drawLfo(g, canvas, zh);
        break;
      default:
        this.drawWaveform(g, canvas, zh);
    }
  }

  private drawWaveform(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const rendered = this.renderedSamples();
    const x0 = 56;
    const x1 = canvas.width - 24;
    const y0 = 58;
    const y1 = canvas.height - 58;
    const w = Math.max(x1 - x0, 20);
    const h = Math.max(y1 - y0, 20);
    const mid = (y0 + y1) / 2;
    const count = 900;
    const step = Math.max(1, Math.floor(rendered.length / count));
    let peak = 1e-9;
    for (let i = 0; i < rendered.length; i += 1) peak = Math.max(peak, Math.abs(rendered[i]!));
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(x0, mid);
    g.lineTo(x1, mid);
    g.stroke();
    g.strokeStyle = 'rgba(120,200,255,0.95)';
    g.lineWidth = 1.2;
    g.beginPath();
    let first = true;
    for (let k = 0; k < rendered.length; k += step) {
      const x = x0 + (k / Math.max(1, rendered.length - 1)) * w;
      const y = mid - (rendered[k]! / peak) * (h / 2) * 0.92;
      if (first) {
        g.moveTo(x, y);
        first = false;
      } else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `10px Consolas, monospace`;
    g.textAlign = 'left';
    g.fillText(`0 s`, x0, y1 + 15);
    g.textAlign = 'right';
    g.fillText(`${(rendered.length / 44100).toFixed(2)} s`, x1, y1 + 15);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const p = this.preset();
    g.fillText(
      zh
        ? `离线渲染 ${rendered.length} 采样 @ 44.1 kHz · 峰值 ${peak.toFixed(3)} · 起音 ${p.adsr.attack.toFixed(2)} s`
        : `offline render ${rendered.length} samples @ 44.1 kHz · peak ${peak.toFixed(3)} · attack ${p.adsr.attack.toFixed(2)} s`,
      x0,
      canvas.height - 32,
    );
    g.fillText(
      zh ? '提示：点“渲染并播放”才会发声；导出按钮生成 16-bit WAV。' : 'Press Render & play to listen; Export writes a 16-bit WAV.',
      x0,
      canvas.height - 14,
    );
  }

  private drawFilter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const p = this.preset();
    const coeffs = biquadCoeffs(p.filter, 44100, p.cutoff, p.q);
    const x0 = 64;
    const x1 = canvas.width - 24;
    const y0 = 58;
    const y1 = canvas.height - 58;
    const w = Math.max(x1 - x0, 20);
    const h = Math.max(y1 - y0, 20);
    const fMin = 20;
    const fMax = 20000;
    const freqs: number[] = [];
    const count = 420;
    for (let k = 0; k <= count; k += 1) freqs.push(fMin * (fMax / fMin) ** (k / count));
    const resp = biquadResponse(coeffs, 44100, freqs);
    const px = (f: number) => x0 + (Math.log10(f / fMin) / Math.log10(fMax / fMin)) * w;
    const py = (db: number) => y0 + ((24 - Math.max(-60, Math.min(24, db))) / 84) * h;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, w, h);
    g.font = `10px Consolas, monospace`;
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = px(f);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x, y1);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.8)';
      g.textAlign = 'center';
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, y1 + 14);
    }
    g.textAlign = 'right';
    for (let db = -60; db <= 24; db += 12) {
      const y = py(db);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.8)';
      g.fillText(`${db}`, x0 - 6, y + 3);
    }
    g.strokeStyle = 'rgba(255,214,102,0.95)';
    g.lineWidth = 1.6;
    g.beginPath();
    freqs.forEach((f, k) => {
      const x = px(f);
      const y = py(resp[k]!);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
    g.strokeStyle = 'rgba(120,200,255,0.75)';
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(px(p.cutoff), y0);
    g.lineTo(px(p.cutoff), y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(120,200,255,0.95)';
    g.textAlign = 'left';
    g.font = `11px Consolas, monospace`;
    g.fillText(`fc ${p.cutoff} Hz`, Math.min(px(p.cutoff) + 6, x1 - 90), y0 + 14);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const atCutoff = biquadResponse(coeffs, 44100, new Float64Array([p.cutoff]))[0]!;
    g.fillText(
      zh
        ? `${p.filter} · f_c=${p.cutoff} Hz · Q=${p.q.toFixed(2)} · 截止处 ${atCutoff.toFixed(2)} dB（RBJ 双二阶解析响应）`
        : `${p.filter} · f_c=${p.cutoff} Hz · Q=${p.q.toFixed(2)} · ${atCutoff.toFixed(2)} dB at cutoff (analytic RBJ biquad)`,
      x0,
      canvas.height - 16,
    );
  }

  private drawEnvelope(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const p = this.preset();
    const x0 = 64;
    const x1 = canvas.width - 24;
    const y0 = 58;
    const y1 = canvas.height - 58;
    const w = Math.max(x1 - x0, 20);
    const h = Math.max(y1 - y0, 20);
    const gate = Math.max(0.01, p.duration - p.adsr.release);
    const px = (t: number) => x0 + (t / Math.max(p.duration, 1e-6)) * w;
    const py = (v: number) => y1 - v * h;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, w, h);
    const stages: Array<[number, number, string]> = [
      [0, p.adsr.attack, 'A'],
      [p.adsr.attack, p.adsr.attack + p.adsr.decay, 'D'],
      [p.adsr.attack + p.adsr.decay, gate, 'S'],
      [gate, p.duration, 'R'],
    ];
    stages.forEach(([a, b, label]) => {
      if (b <= a) return;
      const x = px(a);
      const width = Math.max(1, px(b) - x);
      g.fillStyle = 'rgba(180,140,255,0.08)';
      g.fillRect(x, y0, width, h);
      g.fillStyle = 'rgba(170,182,200,0.85)';
      g.textAlign = 'center';
      g.font = `11px Consolas, monospace`;
      g.fillText(label, x + width / 2, y0 + 14);
    });
    g.strokeStyle = 'rgba(180,140,255,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    const steps = 600;
    for (let k = 0; k <= steps; k += 1) {
      const t = (k / steps) * p.duration;
      const x = px(t);
      const y = py(adsrGain(t, p.adsr, gate));
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(
      zh
        ? `A=${p.adsr.attack.toFixed(2)} s · D=${p.adsr.decay.toFixed(2)} s · S=${p.adsr.sustain.toFixed(2)} · R=${p.adsr.release.toFixed(2)} s · 总长 ${p.duration.toFixed(2)} s`
        : `A=${p.adsr.attack.toFixed(2)} s · D=${p.adsr.decay.toFixed(2)} s · S=${p.adsr.sustain.toFixed(2)} · R=${p.adsr.release.toFixed(2)} s · total ${p.duration.toFixed(2)} s`,
      x0,
      canvas.height - 16,
    );
  }

  private drawLfo(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const p = this.preset();
    const x0 = 64;
    const x1 = canvas.width - 24;
    const y0 = 58;
    const y1 = canvas.height - 64;
    const w = Math.max(x1 - x0, 20);
    const h = Math.max(y1 - y0, 20);
    const span = Math.max(0.1, Math.min(p.duration, 4 / Math.max(p.lfoRate, 0.05)));
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, w, h);
    const mid = (y0 + y1) / 2;
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(x0, mid);
    g.lineTo(x1, mid);
    g.stroke();
    const N = 700;
    g.strokeStyle = 'rgba(120,200,255,0.9)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let k = 0; k <= N; k += 1) {
      const t = (k / N) * span;
      const v = lfoValue(t, p.lfoRate, p.lfoShape);
      const x = x0 + (k / N) * w;
      const y = mid - v * (h / 2) * 0.8;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,214,102,0.95)';
    g.beginPath();
    for (let k = 0; k <= N; k += 1) {
      const t = (k / N) * span;
      const lfo = lfoValue(t, p.lfoRate, p.lfoShape) * p.lfoDepth;
      const cutoff = p.cutoff * 2 ** lfo;
      const norm = Math.log2(cutoff / Math.max(20, p.cutoff / 4)) / Math.log2(8);
      const x = x0 + (k / N) * w;
      const y = mid - (Math.max(0, Math.min(1, norm)) - 0.5) * (h / 2) * 1.5;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(
      zh
        ? `LFO ${p.lfoRate.toFixed(2)} Hz · 深度 ±${p.lfoDepth.toFixed(2)} 倍频程 · ${p.lfoShape}；蓝线为 LFO，黄线为截止频率轨迹（相对）`
        : `LFO ${p.lfoRate.toFixed(2)} Hz · depth ±${p.lfoDepth.toFixed(2)} oct · ${p.lfoShape}; blue = LFO, amber = cutoff trajectory (relative)`,
      x0,
      canvas.height - 40,
    );
    g.fillStyle = 'rgba(170,182,200,0.8)';
    g.fillText(
      zh ? `窗口 ${span.toFixed(2)} s · 截止 ${p.cutoff} Hz` : `window ${span.toFixed(2)} s · cutoff ${p.cutoff} Hz`,
      x0,
      canvas.height - 20,
    );
  }
}

export default function createSynthPlugin(): Plugin {
  return new SynthPlugin();
}
