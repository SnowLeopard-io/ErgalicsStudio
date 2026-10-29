// ==========================================================================
// acoustics — Acoustics Lab
//
// Five views over one session-scoped audio clip: waveform, spectrum,
// harmonics, beats and room acoustics. Imported audio is decoded by
// core/audio (WAV natively, other containers through the platform decoder)
// and never auto-plays: the user must press Play.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { emit } from '@/core/events';
import {
  AudioClipPlayer,
  audioErrorText,
  decodeAudioClip,
  type AudioClip,
} from '@/core/audio';
import { acousticFigurePanels } from './figure';
import { acousticsManifest } from './manifest';
import {
  acousticSpectrum,
  beatEnvelope,
  beatRate,
  criticalDistance,
  crestFactor,
  dominantFrequency,
  eyringRt60,
  harmonicAnalysis,
  interferenceAmplitude,
  parseSampleCsv,
  peakAmplitude,
  rms,
  rmsDbfs,
  roomModes,
  runAcousticBenchmarks,
  sabineRt60,
  schroederFrequency,
  thd,
  toDb,
  waveformOverview,
  wavelength,
  zeroCrossingFrequency,
  type AcousticSpectrum,
  type HarmonicAmplitude,
  type SampleTable,
} from './kernel';

export { acousticsManifest } from './manifest';

type ViewId = 'waveform' | 'spectrum' | 'harmonics' | 'beats' | 'room';

interface State {
  view: ViewId;
  harmonics: number;
  f1: number;
  f2: number;
  lx: number;
  ly: number;
  lz: number;
  alpha: number;
  volume: number;
  playing: boolean;
  volumeGain: number;
}

const SPEED_OF_SOUND = 343;

/** One-second synthetic 440 Hz tone with H2/H3 — a visible default signal. */
function demoTone(): SampleTable {
  const sampleRate = 8000;
  const seconds = 1;
  const samples = new Float64Array(sampleRate * seconds);
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    const fade = Math.min(1, i / 160) * Math.min(1, (samples.length - i) / 160);
    samples[i] =
      0.55 * fade * (Math.sin(2 * Math.PI * 440 * t) + 0.35 * Math.sin(2 * Math.PI * 880 * t) + 0.18 * Math.sin(2 * Math.PI * 1320 * t));
  }
  return { sampleRate, samples };
}

export class AcousticsPlugin implements Plugin {
  readonly manifest = acousticsManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private player = new AudioClipPlayer();
  private clip: AudioClip | null = null;
  private demo: SampleTable | null = null;
  private specCache: AcousticSpectrum | null = null;
  private state: State = {
    view: 'waveform',
    harmonics: 8,
    f1: 440,
    f2: 445,
    lx: 6,
    ly: 4,
    lz: 3,
    alpha: 0.2,
    volume: 72,
    playing: false,
    volumeGain: 0.8,
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
    const s = this.state;
    return [
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'waveform', label: this.zh ? '波形' : 'Waveform' },
          { value: 'spectrum', label: this.zh ? '频谱' : 'Spectrum' },
          { value: 'harmonics', label: this.zh ? '谐波与过音列' : 'Harmonics & overtones' },
          { value: 'beats', label: this.zh ? '拍频与干涉' : 'Beats & interference' },
          { value: 'room', label: this.zh ? '房间声学' : 'Room acoustics' },
        ],
        value: s.view,
      },
      actionButton('importAudio', 'Import audio (WAV / MP3 / M4A / OGG / FLAC …)', '导入音频（WAV / MP3 / M4A / OGG / FLAC …）'),
      actionButton('play', 'Play audio', '播放音频', 'primary'),
      actionButton('stopAudio', 'Stop audio', '停止播放'),
      actionButton('loadDemo', 'Load built-in demo tone', '加载内置演示音'),
      // Playback volume is meaningless with no clip loaded, so it stays hidden
      // until audio arrives rather than sitting there dead.
      ...(this.clip
        ? [
            {
              key: 'volumeGain',
              label: 'Playback volume',
              labelI18n: { 'zh-CN': '播放音量', 'en-US': 'Playback volume' },
              type: 'range',
              min: 0,
              max: 1,
              step: 0.05,
              value: s.volumeGain,
            } as ParamDefinition,
          ]
        : []),
      {
        key: 'harmonics',
        label: 'Harmonics',
        labelI18n: { 'zh-CN': '谐波数量', 'en-US': 'Harmonics' },
        type: 'range',
        min: 2,
        max: 16,
        step: 1,
        value: s.harmonics,
        visibleWhen: { key: 'view', in: ['harmonics'] },
      },
      {
        key: 'f1',
        label: 'Tone 1 (Hz)',
        labelI18n: { 'zh-CN': '音 1（Hz）', 'en-US': 'Tone 1 (Hz)' },
        type: 'number',
        min: 50,
        max: 5000,
        step: 1,
        value: s.f1,
        visibleWhen: { key: 'view', in: ['beats'] },
      },
      {
        key: 'f2',
        label: 'Tone 2 (Hz)',
        labelI18n: { 'zh-CN': '音 2（Hz）', 'en-US': 'Tone 2 (Hz)' },
        type: 'number',
        min: 50,
        max: 5000,
        step: 1,
        value: s.f2,
        visibleWhen: { key: 'view', in: ['beats'] },
      },
      {
        key: 'lx',
        label: 'Room length (m)',
        labelI18n: { 'zh-CN': '房间长（m）', 'en-US': 'Room length (m)' },
        type: 'number',
        min: 2,
        max: 30,
        step: 0.1,
        value: s.lx,
        visibleWhen: { key: 'view', in: ['room'] },
      },
      {
        key: 'ly',
        label: 'Room width (m)',
        labelI18n: { 'zh-CN': '房间宽（m）', 'en-US': 'Room width (m)' },
        type: 'number',
        min: 2,
        max: 30,
        step: 0.1,
        value: s.ly,
        visibleWhen: { key: 'view', in: ['room'] },
      },
      {
        key: 'lz',
        label: 'Room height (m)',
        labelI18n: { 'zh-CN': '房间高（m）', 'en-US': 'Room height (m)' },
        type: 'number',
        min: 2,
        max: 20,
        step: 0.1,
        value: s.lz,
        visibleWhen: { key: 'view', in: ['room'] },
      },
      {
        key: 'alpha',
        label: 'Mean absorption α',
        labelI18n: { 'zh-CN': '平均吸声系数 α', 'en-US': 'Mean absorption α' },
        type: 'range',
        min: 0.02,
        max: 0.95,
        step: 0.01,
        value: s.alpha,
        visibleWhen: { key: 'view', in: ['room'] },
      },
      {
        key: 'volume',
        label: 'Volume (m³)',
        labelI18n: { 'zh-CN': '体积（m³）', 'en-US': 'Volume (m³)' },
        type: 'number',
        min: 10,
        max: 20000,
        step: 10,
        value: s.volume,
        visibleWhen: { key: 'view', in: ['room'] },
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export spectrum CSV', '导出频谱 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.view === 'string' && ['waveform', 'spectrum', 'harmonics', 'beats', 'room'].includes(params.view)) {
      if (params.view !== this.state.view) {
        this.state.view = params.view as ViewId;
        this.draw();
      }
    }
    const num = (key: keyof State, min: number, max: number, round = false): void => {
      const v = params[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const next = round ? Math.round(Math.min(max, Math.max(min, v))) : Math.min(max, Math.max(min, v));
      if (next !== this.state[key]) {
        (this.state as unknown as Record<string, unknown>)[key] = next;
        if (key === 'volumeGain') this.player.setVolume(next);
        if (key === 'lx' || key === 'ly' || key === 'lz') this.state.volume = Number((this.state.lx * this.state.ly * this.state.lz).toFixed(1));
        this.draw();
      }
    };
    num('harmonics', 2, 16, true);
    num('f1', 50, 5000);
    num('f2', 50, 5000);
    num('lx', 2, 30);
    num('ly', 2, 30);
    num('lz', 2, 20);
    num('alpha', 0.02, 0.95);
    num('volume', 10, 20000);
    num('volumeGain', 0, 1);
    if (actionFired(params, 'importAudio')) void this.importAudio();
    if (actionFired(params, 'play')) void this.playAudio();
    if (actionFired(params, 'stopAudio')) this.stopPlayback(true);
    if (actionFired(params, 'loadDemo')) this.loadDemoTone();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    const isAudio =
      file.type.startsWith('audio/') ||
      /\.(wav|wave|mp3|m4a|mp4|aac|ogg|oga|opus|flac|weba|webm)$/i.test(low);
    if (isAudio) {
      try {
        const clip = await decodeAudioClip(this.api, file);
        this.clip = clip;
        this.specCache = null;
        this.state.view = 'waveform';
        this.stopPlayback(false);
        this.draw();
        this.refreshParams();
        notify(
          this.api,
          'success',
          `Loaded ${file.name} — ${clip.duration.toFixed(2)} s, ${clip.sampleRate} Hz, ${clip.channels} ch. Press Play to listen.`,
          `已载入 ${file.name} — ${clip.duration.toFixed(2)} 秒，${clip.sampleRate} Hz，${clip.channels} 声道。点“播放”才会发声。`,
        );
      } catch (err) {
        notify(this.api, 'error', audioErrorText(err, false), audioErrorText(err, true));
      }
      return;
    }

    const table = parseSampleCsv(await file.text());
    if (!table) {
      notify(
        this.api,
        'warning',
        'Unsupported file. Import WAV / MP3 / M4A / AAC / OGG / Opus / FLAC / WebM audio, or a CSV with time_s, amplitude.',
        '不支持的文件。请导入 WAV / MP3 / M4A / AAC / OGG / Opus / FLAC / WebM 音频，或含 time_s、amplitude 的 CSV。',
      );
      return;
    }
    this.clip = {
      name: file.name,
      sampleRate: table.sampleRate,
      channels: 1,
      duration: table.samples.length / table.sampleRate,
      samples: table.samples,
      channelData: [table.samples],
      codec: 'decoded',
    };
    this.specCache = null;
    this.state.view = 'waveform';
    this.stopPlayback(false);
    this.draw();
    this.refreshParams();
    notify(
      this.api,
      'success',
      `Loaded ${table.samples.length} samples from ${file.name} at ~${table.sampleRate} Hz.`,
      `已从 ${file.name} 载入 ${table.samples.length} 个采样点，约 ${table.sampleRate} Hz。`,
    );
  }

  // ---- audio actions ---------------------------------------------------------

  private async importAudio() {
    const file = await this.api.openFile('audio/*,.wav,.mp3,.ogg,.m4a,.flac,.aac');
    if (file) await this.loadData(file);
  }

  private async playAudio() {
    const clip = this.currentClip();
    if (!clip) {
      notify(
        this.api,
        'warning',
        'No audio loaded yet — import audio or load the demo tone first.',
        '尚未载入音频，请先导入音频或加载内置演示音。',
      );
      return;
    }
    if (!this.player.available) {
      notify(
        this.api,
        'warning',
        'Web Audio is unavailable in this environment.',
        '当前环境没有可用的 Web Audio。',
      );
      return;
    }
    try {
      await this.player.play(clip, 0, () => {
        this.state.playing = false;
        this.draw();
      });
      this.player.setVolume(this.state.volumeGain);
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

  private currentClip(): AudioClip | null {
    return this.clip;
  }

  private table(): SampleTable | null {
    const clip = this.currentClip();
    return clip ? { sampleRate: clip.sampleRate, samples: clip.samples } : null;
  }

  /** Explicit user action: load the built-in demo tone (never on startup). */
  private loadDemoTone() {
    const demo = (this.demo ??= demoTone());
    this.clip = {
      name: this.zh ? '内置演示音（440 Hz + 谐波）' : 'built-in demo tone (440 Hz + harmonics)',
      sampleRate: demo.sampleRate,
      channels: 1,
      duration: demo.samples.length / demo.sampleRate,
      samples: demo.samples,
      channelData: [demo.samples],
      codec: 'decoded',
    };
    this.specCache = null;
    this.stopPlayback(false);
    this.state.view = 'waveform';
    this.draw();
    this.refreshParams();
  }

  /** Re-read the parameter list after a state change that alters it. */
  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  // ---- actions ---------------------------------------------------------------

  private runBenchmark() {
    const bench = runAcousticBenchmarks();
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
        ? `All ${bench.length} acoustics benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项声学基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  private exportCsv() {
    const table = this.table();
    if (!table) {
      notify(this.api, 'warning', 'No audio loaded yet.', '尚未载入音频。');
      return;
    }
    const spec = this.getSpectrum(table);
    const rows: Array<Array<number | string>> = [];
    for (let k = 1; k < spec.freqs.length; k += 1) {
      const m = spec.magnitude[k]!;
      rows.push([Number(spec.freqs[k]!.toFixed(3)), Number(m.toPrecision(6)), Number(toDb(m).toFixed(3))]);
    }
    exportRowsCsv(this.api, 'acoustic-spectrum', ['frequency_hz', 'magnitude', 'magnitude_db'], rows);
  }

  private async sendToFigure() {
    const table = this.table();
    const clip = this.currentClip();
    if (!table || !clip) {
      notify(this.api, 'warning', 'No audio loaded yet.', '尚未载入音频。');
      return;
    }
    const spec = this.getSpectrum(table);
    const f0 = dominantFrequency(table.samples, table.sampleRate);
    const room = this.roomStats();
    const caption: Bilingual = {
      zh: `声学分析：${clip.name}（${table.sampleRate} Hz，${(table.samples.length / table.sampleRate).toFixed(2)} 秒），基频 ${f0.toFixed(1)} Hz；房间 ${this.state.lx}×${this.state.ly}×${this.state.lz} m，RT60(Sabine) ${room.rt60.toFixed(2)} s。`,
      en: `Acoustic analysis: ${clip.name} (${table.sampleRate} Hz, ${(table.samples.length / table.sampleRate).toFixed(2)} s), fundamental ${f0.toFixed(1)} Hz; room ${this.state.lx}×${this.state.ly}×${this.state.lz} m, Sabine RT60 ${room.rt60.toFixed(2)} s.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '声学分析', en: 'Acoustics Analysis' },
      caption,
      acousticFigurePanels({ table, spectrum: spec, fundamental: f0, modes: this.modes() }),
    );
  }

  // ---- numerics --------------------------------------------------------------

  private getSpectrum(table: SampleTable): AcousticSpectrum {
    if (!this.specCache) this.specCache = acousticSpectrum(table.samples, table.sampleRate, 8192);
    return this.specCache;
  }

  private harmonics(table: SampleTable): HarmonicAmplitude[] {
    const f0 = dominantFrequency(table.samples, table.sampleRate);
    return harmonicAnalysis(table.samples, table.sampleRate, f0, this.state.harmonics);
  }

  private modes() {
    return roomModes(this.state.lx, this.state.ly, this.state.lz, SPEED_OF_SOUND, 300, 4);
  }

  private roomStats() {
    const volume = this.state.volume;
    const area = 2 * (this.state.lx * this.state.ly + this.state.ly * this.state.lz + this.state.lz * this.state.lx);
    const surfaces = [{ area, alpha: this.state.alpha }];
    const rt60 = sabineRt60(volume, surfaces);
    return {
      volume,
      area,
      rt60,
      eyring: eyringRt60(volume, surfaces),
      schroeder: schroederFrequency(volume, rt60),
      critical: criticalDistance(volume, rt60),
      axial: SPEED_OF_SOUND / (2 * this.state.lx),
    };
  }

  private publish() {
    const table = this.table();
    const room = this.roomStats();
    const metrics: ScienceMetric[] = [];
    if (table) {
      const clip = this.currentClip()!;
      const f0 = dominantFrequency(table.samples, table.sampleRate);
      const harmonics = this.harmonics(table);
      metrics.push(
        {
          key: 'fundamental',
          label: 'Fundamental f₀',
          value: fmtMetric(f0),
          unit: 'Hz',
          severity: 'info',
          hint: `${this.zh ? 'FFT 峰值' : 'FFT peak'} · ${this.zh ? '过零估计' : 'zero-crossing'} ${zeroCrossingFrequency(table.samples, table.sampleRate).toFixed(1)} Hz`,
        },
        {
          key: 'level',
          label: 'RMS level',
          value: fmtMetric(rmsDbfs(table.samples), 2),
          unit: 'dBFS',
          severity: rmsDbfs(table.samples) > -1 ? 'warn' : 'ok',
          hint: this.zh
            ? `峰值 ${peakAmplitude(table.samples).toFixed(3)} · 波峰因数 ${crestFactor(table.samples).toFixed(2)}`
            : `peak ${peakAmplitude(table.samples).toFixed(3)} · crest ${crestFactor(table.samples).toFixed(2)}`,
        },
        {
          key: 'thd',
          label: 'THD (H2…Hn)',
          value: fmtMetric(thd(harmonics) * 100, 2),
          unit: '%',
          severity: 'info',
          hint: this.zh ? `前 ${this.state.harmonics} 次谐波` : `first ${this.state.harmonics} harmonics`,
        },
        {
          key: 'duration',
          label: 'Duration',
          value: fmtMetric(table.samples.length / table.sampleRate, 2),
          unit: 's',
          severity: 'info',
          hint: `${table.sampleRate} Hz · ${clip.channels} ch`,
        },
      );
    }
    metrics.push(
      {
        key: 'rt60',
        label: 'RT60 (Sabine)',
        value: fmtMetric(room.rt60, 2),
        unit: 's',
        severity: room.rt60 < 0.6 ? 'ok' : room.rt60 < 1.5 ? 'info' : 'warn',
        hint: this.zh
          ? `V=${room.volume} m³，S=${room.area.toFixed(1)} m²，α=${this.state.alpha.toFixed(2)}；Eyring ${room.eyring.toFixed(2)} s`
          : `V=${room.volume} m³, S=${room.area.toFixed(1)} m², α=${this.state.alpha.toFixed(2)}; Eyring ${room.eyring.toFixed(2)} s`,
      },
      {
        key: 'schroeder',
        label: 'Schroeder f_s',
        value: fmtMetric(room.schroeder),
        unit: 'Hz',
        severity: 'info',
        hint: this.zh
          ? `临界距离 ${room.critical.toFixed(2)} m · 一阶轴向模态 ${room.axial.toFixed(1)} Hz`
          : `critical distance ${room.critical.toFixed(2)} m · first axial mode ${room.axial.toFixed(1)} Hz`,
      },
    );
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const zh = this.zh;
    this.publish();
    if (!this.clip && ['waveform', 'spectrum', 'harmonics'].includes(this.state.view)) {
      this.stopPlayback(false);
      drawEmptyCanvas(this.api, canvas, {
        titleZh: '尚未载入音频',
        title: 'No audio loaded',
        hintZh: '导入 WAV / MP3 / M4A / AAC / OGG / Opus / FLAC / WebM，或含 time_s, amplitude 的 CSV；也可点「加载内置演示音」',
        hint: 'Import WAV / MP3 / M4A / AAC / OGG / Opus / FLAC / WebM audio, or a time_s/amplitude CSV — or press “Load built-in demo tone”.',
      });
      return;
    }
    canvas.width = canvas.clientWidth || 820;
    canvas.height = canvas.clientHeight || 460;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    this.drawHeader(g, canvas, zh);

    switch (this.state.view) {
      case 'spectrum':
        this.drawSpectrum(g, canvas, zh);
        break;
      case 'harmonics':
        this.drawHarmonics(g, canvas, zh);
        break;
      case 'beats':
        this.drawBeats(g, canvas, zh);
        break;
      case 'room':
        this.drawRoom(g, canvas, zh);
        break;
      default:
        this.drawWaveform(g, canvas, zh);
    }
  }

  private drawHeader(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const clip = this.currentClip();
    g.textAlign = 'center';
    g.font = `14px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(235,241,250,0.96)';
    g.fillText(zh ? '声学实验室' : 'Acoustics Lab', canvas.width / 2, 20);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.92)';
    g.fillText(
      clip
        ? `${clip.name} · ${clip.sampleRate} Hz · ${clip.channels} ch · ${clip.duration.toFixed(2)} s${
            this.state.playing ? (zh ? ' · 正在播放' : ' · playing') : ''
          }`
        : zh
          ? '尚未载入音频 · 拍频与房间声学无需音频'
          : 'no audio loaded · beats and room acoustics work without audio',
      canvas.width / 2,
      38,
    );
  }

  private drawWaveform(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const table = this.table();
    if (!table) return;
    const x0 = 56;
    const x1 = canvas.width - 24;
    const y0 = 58;
    const y1 = canvas.height - 70;
    const w = Math.max(x1 - x0, 20);
    const h = Math.max(y1 - y0, 20);
    const mid = (y0 + y1) / 2;
    const buckets = waveformOverview(table.samples, Math.max(80, Math.floor(w)));
    const peak = Math.max(peakAmplitude(table.samples), 1e-6);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(x0, mid);
    g.lineTo(x1, mid);
    g.stroke();
    g.strokeStyle = 'rgba(120,200,255,0.9)';
    g.lineWidth = 1;
    g.beginPath();
    buckets.forEach((b, i) => {
      const x = x0 + (i / Math.max(buckets.length - 1, 1)) * w;
      const yTop = mid - (b.max / peak) * (h / 2) * 0.92;
      const yBot = mid - (b.min / peak) * (h / 2) * 0.92;
      g.moveTo(x, yTop);
      g.lineTo(x, Math.max(yBot, yTop + 0.5));
    });
    g.stroke();
    g.strokeStyle = 'rgba(255,214,102,0.6)';
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(x0, mid - (peak / peak) * (h / 2) * 0.92);
    g.lineTo(x1, mid - (peak / peak) * (h / 2) * 0.92);
    g.moveTo(x0, mid + (peak / peak) * (h / 2) * 0.92);
    g.lineTo(x1, mid + (peak / peak) * (h / 2) * 0.92);
    g.stroke();
    g.setLineDash([]);
    g.font = `10px Consolas, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'right';
    g.fillText(peak.toFixed(2), x0 - 6, y0 + 10);
    g.fillText('0', x0 - 6, mid + 3);
    g.fillText((-peak).toFixed(2), x0 - 6, y1);
    g.textAlign = 'left';
    g.fillText('0 s', x0, y1 + 14);
    g.textAlign = 'right';
    g.fillText(
      `${(table.samples.length / table.sampleRate).toFixed(2)} s`,
      x1,
      y1 + 14,
    );
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(
      zh
        ? `RMS ${toDb(rms(table.samples)).toFixed(1)} dBFS · 峰值 ${peakAmplitude(table.samples).toFixed(3)} · 过零频率 ${zeroCrossingFrequency(table.samples, table.sampleRate).toFixed(1)} Hz`
        : `RMS ${toDb(rms(table.samples)).toFixed(1)} dBFS · peak ${peakAmplitude(table.samples).toFixed(3)} · zero-crossing ${zeroCrossingFrequency(table.samples, table.sampleRate).toFixed(1)} Hz`,
      x0,
      canvas.height - 16,
    );
    g.fillStyle = 'rgba(170,182,200,0.8)';
    g.fillText(
      zh ? '导入音频后可点“播放音频”；不会自动播放。' : 'Import audio, then press Play — nothing auto-plays.',
      x0,
      canvas.height - 34,
    );
  }

  private drawSpectrum(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const table = this.table();
    if (!table) return;
    const spec = this.getSpectrum(table);
    const f0 = dominantFrequency(table.samples, table.sampleRate);
    const x0 = 66;
    const x1 = canvas.width - 24;
    const y0 = 58;
    const y1 = canvas.height - 58;
    const w = Math.max(x1 - x0, 20);
    const h = Math.max(y1 - y0, 20);
    const maxF = Math.min(table.sampleRate / 2, 8000);
    let maxMag = 1e-9;
    for (let k = 1; k < spec.freqs.length; k += 1) {
      if (spec.freqs[k]! <= maxF) maxMag = Math.max(maxMag, spec.magnitude[k]!);
    }
    const dbTop = Math.max(0, toDb(maxMag));
    const dbBot = dbTop - 80;
    const px = (f: number) => x0 + (f / maxF) * w;
    const py = (m: number) => {
      const db = Math.max(dbBot, toDb(m));
      return y1 - ((db - dbBot) / (dbTop - dbBot)) * h;
    };
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, w, h);
    g.font = `10px Consolas, monospace`;
    for (let db = dbBot; db <= dbTop + 1e-9; db += 10) {
      const y = y1 - ((db - dbBot) / (dbTop - dbBot)) * h;
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.8)';
      g.textAlign = 'right';
      g.fillText(`${db.toFixed(0)}`, x0 - 6, y + 3);
    }
    g.strokeStyle = 'rgba(180,140,255,0.95)';
    g.lineWidth = 1.3;
    g.beginPath();
    let first = true;
    const step = Math.max(1, Math.floor(spec.freqs.length / 1200));
    for (let k = 1; k < spec.freqs.length; k += step) {
      const f = spec.freqs[k]!;
      if (f > maxF) break;
      const x = px(f);
      const y = py(spec.magnitude[k]!);
      if (first) {
        g.moveTo(x, y);
        first = false;
      } else g.lineTo(x, y);
    }
    g.stroke();
    if (f0 > 0 && f0 <= maxF) {
      g.strokeStyle = 'rgba(255,214,102,0.7)';
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(px(f0), y0);
      g.lineTo(px(f0), y1);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(255,214,102,0.95)';
      g.textAlign = 'left';
      g.font = `11px Consolas, monospace`;
      g.fillText(`f₀ = ${f0.toFixed(1)} Hz`, Math.min(px(f0) + 6, x1 - 110), y0 + 14);
    }
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'center';
    g.fillText('frequency / Hz', (x0 + x1) / 2, y1 + 16);
    g.textAlign = 'left';
    g.save();
    g.translate(16, (y0 + y1) / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillText('magnitude / dB', 0, 0);
    g.restore();
    g.textAlign = 'left';
    g.fillText(
      zh
        ? `FFT ${spec.nfft} 点 · Hann 窗 · 采样率 ${table.sampleRate} Hz`
        : `FFT ${spec.nfft} points · Hann window · ${table.sampleRate} Hz`,
      x0,
      canvas.height - 16,
    );
  }

  private drawHarmonics(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const table = this.table();
    if (!table) return;
    const f0 = dominantFrequency(table.samples, table.sampleRate);
    const harmonics = this.harmonics(table);
    const x0 = 60;
    const x1 = canvas.width - 24;
    const y0 = 62;
    const y1 = canvas.height - 64;
    const w = Math.max(x1 - x0, 20);
    const h = Math.max(y1 - y0, 20);
    const n = Math.max(harmonics.length, 1);
    const barW = Math.min(46, (w / n) * 0.62);
    const dbMin = -60;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, w, h);
    g.font = `10px Consolas, monospace`;
    for (let db = dbMin; db <= 0; db += 10) {
      const y = y1 - ((db - dbMin) / -dbMin) * h;
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.8)';
      g.textAlign = 'right';
      g.fillText(`${db}`, x0 - 6, y + 3);
    }
    harmonics.forEach((hm, i) => {
      const x = x0 + ((i + 0.5) / n) * w;
      const db = Math.max(dbMin, hm.relDb);
      const y = y1 - ((db - dbMin) / -dbMin) * h;
      g.fillStyle = i === 0 ? 'rgba(255,214,102,0.9)' : 'rgba(120,200,255,0.8)';
      g.fillRect(x - barW / 2, y, barW, Math.max(1, y1 - y));
      g.fillStyle = 'rgba(235,241,250,0.95)';
      g.textAlign = 'center';
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(zh ? `${hm.n}×` : `H${hm.n}`, x, y1 + 14);
      g.fillStyle = 'rgba(170,182,200,0.85)';
      g.fillText(`${hm.freq.toFixed(0)}`, x, y1 + 27);
      g.fillText(hm.relDb > dbMin ? `${hm.relDb.toFixed(1)}` : '≤−60', x, Math.min(y1 - 4, y - 4));
    });
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `基频 f₀ ≈ ${f0.toFixed(1)} Hz · THD = ${(thd(harmonics) * 100).toFixed(2)}% · 相对电平（dB，以最强谐波为 0）`
        : `f₀ ≈ ${f0.toFixed(1)} Hz · THD = ${(thd(harmonics) * 100).toFixed(2)}% · relative level (dB, strongest harmonic = 0)`,
      x0,
      canvas.height - 34,
    );
    g.fillText(
      zh
        ? '理想过音列：f₀, 2f₀, 3f₀ …；整数倍频率决定音色（谐波），非整数倍为泛音/不谐和。'
        : 'Ideal overtone series: f₀, 2f₀, 3f₀ …; integer multiples shape timbre, non-integer partials sound inharmonic.',
      x0,
      canvas.height - 16,
    );
  }

  private drawBeats(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const f1 = this.state.f1;
    const f2 = this.state.f2;
    const rate = beatRate(f1, f2);
    const span = rate > 0.2 ? Math.min(2, Math.max(0.2, 4 / rate)) : 0.5;
    const x0 = 56;
    const x1 = canvas.width - 24;
    const yTop = 58;
    const yBottom = canvas.height - 74;
    const w = Math.max(x1 - x0, 20);
    const half = (yBottom - yTop) / 2;
    const mid = yTop + half;
    const N = 800;
    const py = (v: number) => mid - (v / 2.6) * half;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, yTop, w, half * 2);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(x0, mid);
    g.lineTo(x1, mid);
    g.stroke();

    // Superposition of the two tones.
    g.strokeStyle = 'rgba(120,200,255,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= N; i += 1) {
      const t = (i / N) * span;
      const v = Math.cos(2 * Math.PI * f1 * t) + Math.cos(2 * Math.PI * f2 * t);
      const x = x0 + (i / N) * w;
      const y = py(v);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // Beat envelope ±2cos(πΔf t).
    g.strokeStyle = 'rgba(255,214,102,0.95)';
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i <= N; i += 1) {
      const t = (i / N) * span;
      const env = 2 * Math.cos(Math.PI * rate * t);
      const x = x0 + (i / N) * w;
      const y = py(env);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath();
    for (let i = 0; i <= N; i += 1) {
      const t = (i / N) * span;
      const env = -2 * Math.cos(Math.PI * rate * t);
      const x = x0 + (i / N) * w;
      const y = py(env);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // Phase-difference interference curve.
    const c0 = canvas.height - 58;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.textAlign = 'left';
    g.fillText(
      zh
        ? `f₁ = ${f1} Hz · f₂ = ${f2} Hz · 拍频 |Δf| = ${rate.toFixed(2)} Hz（每 ${(1 / Math.max(rate, 1e-6)).toFixed(3)} s 一拍）`
        : `f₁ = ${f1} Hz · f₂ = ${f2} Hz · beat |Δf| = ${rate.toFixed(2)} Hz (one beat every ${(1 / Math.max(rate, 1e-6)).toFixed(3)} s)`,
      x0,
      c0,
    );
    g.fillStyle = 'rgba(255,214,102,0.9)';
    g.fillText(
      zh
        ? `相干叠加：φ=0° → ${interferenceAmplitude(1, 1, 0).toFixed(3)}；φ=90° → ${interferenceAmplitude(1, 1, 90).toFixed(3)}；φ=180° → ${interferenceAmplitude(1, 1, 180).toFixed(3)}（等幅）`
        : `Coherent sum: φ=0° → ${interferenceAmplitude(1, 1, 0).toFixed(3)}; φ=90° → ${interferenceAmplitude(1, 1, 90).toFixed(3)}; φ=180° → ${interferenceAmplitude(1, 1, 180).toFixed(3)} (equal amplitudes)`,
      x0,
      c0 + 18,
    );
    g.fillStyle = 'rgba(170,182,200,0.8)';
    g.fillText(
      zh ? `包络峰-峰时间 ${(1 / Math.max(rate, 1e-6)).toFixed(3)} s · 窗口 ${span.toFixed(2)} s` : `envelope period ${(1 / Math.max(rate, 1e-6)).toFixed(3)} s · window ${span.toFixed(2)} s`,
      x0,
      c0 + 36,
    );
  }

  private drawRoom(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const room = this.roomStats();
    const modes = this.modes();
    const x0 = 56;
    const x1 = canvas.width - 24;
    const y0 = 108;
    const y1 = canvas.height - 66;
    const w = Math.max(x1 - x0, 20);
    const h = Math.max(y1 - y0, 20);
    const fMax = 300;
    const px = (f: number) => x0 + (f / fMax) * w;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, w, h);
    g.font = `10px Consolas, monospace`;
    for (let f = 0; f <= fMax; f += 50) {
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(px(f), y0);
      g.lineTo(px(f), y1);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.8)';
      g.textAlign = 'center';
      g.fillText(`${f}`, px(f), y1 + 14);
    }
    const rows: Array<[string, number, string]> = [
      ['axial', 3, 'rgba(255,214,102,0.95)'],
      ['tangential', 2, 'rgba(120,200,255,0.9)'],
      ['oblique', 1, 'rgba(180,140,255,0.85)'],
    ];
    for (const [type, row, color] of rows) {
      const y = y1 - ((row + 0.5) / 3.5) * h;
      g.fillStyle = color;
      for (const m of modes.filter((mm) => mm.type === type)) {
        g.fillRect(px(m.freq) - 1, y - 5, 2, 10);
      }
      g.textAlign = 'left';
      g.fillText(type, x0 + 4, y - 8);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(235,241,250,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `房间 ${this.state.lx.toFixed(1)} × ${this.state.ly.toFixed(1)} × ${this.state.lz.toFixed(1)} m · V=${room.volume.toFixed(0)} m³ · S=${room.area.toFixed(1)} m²`
        : `room ${this.state.lx.toFixed(1)} × ${this.state.ly.toFixed(1)} × ${this.state.lz.toFixed(1)} m · V=${room.volume.toFixed(0)} m³ · S=${room.area.toFixed(1)} m²`,
      x0,
      62,
    );
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(255,214,102,0.95)';
    g.fillText(
      zh
        ? `RT60（Sabine）= ${room.rt60.toFixed(2)} s · Eyring = ${room.eyring.toFixed(2)} s · Schroeder f_s = ${room.schroeder.toFixed(0)} Hz · 临界距离 ${room.critical.toFixed(2)} m`
        : `RT60 (Sabine) = ${room.rt60.toFixed(2)} s · Eyring = ${room.eyring.toFixed(2)} s · Schroeder f_s = ${room.schroeder.toFixed(0)} Hz · critical distance ${room.critical.toFixed(2)} m`,
      x0,
      80,
    );
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText(
      zh
        ? `一阶轴向模态 ${room.axial.toFixed(1)} Hz（c/2Lx）· 波长 ${wavelength(room.axial, SPEED_OF_SOUND).toFixed(2)} m · 共 ${modes.length} 个模态 ≤ 300 Hz`
        : `first axial mode ${room.axial.toFixed(1)} Hz (c/2Lx) · wavelength ${wavelength(room.axial, SPEED_OF_SOUND).toFixed(2)} m · ${modes.length} modes ≤ 300 Hz`,
      x0,
      canvas.height - 38,
    );
    g.fillText(
      zh ? '提示：驻波在墙面上形成压力腹点，房间尺寸决定模态频率。' : 'Standing waves form pressure antinodes at walls; room dimensions set the modal frequencies.',
      x0,
      canvas.height - 18,
    );
  }
}

export default function createAcousticsPlugin(): Plugin {
  return new AcousticsPlugin();
}

/** Re-export the beat envelope helper for callers extending this lab. */
export { beatEnvelope };
