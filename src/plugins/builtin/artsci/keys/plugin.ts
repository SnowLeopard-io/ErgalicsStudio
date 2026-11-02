// ==========================================================================
// keys — Keyboard Performance (playable on-screen piano).
//
// Real-time additive synthesis through Web Audio: one custom PeriodicWave
// oscillator per voice (harmonic stacks from kernel.ts) with the shared
// ADSR envelope, optional vibrato LFO and low-pass shaping. The playable
// keyboard is an interactive <canvas> injected into container.dom (the
// shared canvas2d surface is pointer-events:none and reserved for the
// host's pan/zoom, so direct interaction must live in the DOM layer).
// Input sources: pointer clicks on the keys and the computer keyboard
// (Z-M / QWERTY rows; '-' / '=' shift octaves). Pressed keys get
// immediate visual feedback.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
// While this plugin is open (and while any voice sounds), the host's ambient
// music must stand down so the two never overlap (see core/ambience/audio.ts).
import { setHostAudioActive, setHostAudioPluginOpen } from '@/core/ambience/audio';
import { keysManifest } from './manifest';
import {
  INSTRUMENTS,
  INSTRUMENT_IDS,
  KEY_BINDINGS,
  buildKeyboard,
  noteFrequency,
  noteName,
  runKeysBenchmarks,
  type InstrumentId,
  type PianoKey,
} from './kernel';

export { keysManifest } from './manifest';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Geometry for one rendered key (canvas CSS pixels). */
function keyRect(k: PianoKey, W: number, H: number, whiteCount: number): Rect {
  const ww = W / whiteCount;
  if (!k.isBlack) return { x: k.whiteIndex * ww, y: 0, w: ww, h: H };
  const bw = ww * 0.62;
  const bh = H * 0.62;
  return { x: (k.whiteIndex + 1) * ww - bw / 2, y: 0, w: bw, h: bh };
}

function pointIn(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

interface Voice {
  oscs: OscillatorNode[];
  gain: GainNode;
  lfo?: OscillatorNode;
  lfoGain?: GainNode;
  onAt: number;
  released: boolean;
}

export class KeysPlugin implements Plugin {
  readonly manifest = keysManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private state = {
    instrument: 'piano' as InstrumentId,
    octave: 4,
    octaves: 3,
    volume: 0.5,
    sustain: false,
    labels: true,
  };

  // Audio graph (lazily created on the first user gesture).
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private waves = new Map<InstrumentId, PeriodicWave>();
  private voices = new Map<number, Voice>();
  private heldKeys = new Set<string>();
  private lastNote: { midi: number; at: number } | null = null;

  // Canvas interaction — the playable keyboard lives in container.dom.
  private keys: PianoKey[] = [];
  private overlay: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private pointerNotes = new Map<number, number>();

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.detachCanvas();
    this.stopAll();
    if (this.audio) {
      void this.audio.close().catch(() => undefined);
      this.audio = null;
      this.master = null;
      this.waves.clear();
    }
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.attachCanvas();
    // A sound-capable plugin owns the soundscape while it is open.
    setHostAudioPluginOpen(true);
  }

  async deactivate() {
    this.heldKeys.clear();
    this.stopAll();
    this.detachCanvas();
    setHostAudioPluginOpen(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.attachCanvas();
  }

  // ---- parameter panel -----------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      actionButton('panic', 'Release all notes', '释放全部音符'),
      {
        key: 'instrument',
        label: 'Instrument',
        labelI18n: { 'zh-CN': '音色', 'en-US': 'Instrument' },
        type: 'select',
        options: INSTRUMENT_IDS.map((id) => {
          const zh: Record<InstrumentId, string> = {
            piano: '三角钢琴',
            violin: '小提琴',
            organ: '管风琴',
            flute: '长笛',
            musicbox: '八音盒',
          };
          return { value: id, label: id, labelI18n: { 'zh-CN': zh[id]!, 'en-US': id } };
        }),
        value: s.instrument,
      },
      {
        key: 'octave',
        label: 'Base octave',
        labelI18n: { 'zh-CN': '基准八度', 'en-US': 'Base octave' },
        type: 'select',
        options: [1, 2, 3, 4, 5].map((o) => ({ value: String(o), label: `C${o}`, labelI18n: { 'zh-CN': `C${o}`, 'en-US': `C${o}` } })),
        value: String(s.octave),
        hint: this.zh ? '也可用 “-” / “=” 快捷切换八度。' : 'Also shiftable with the "-" / "=" hotkeys.',
      },
      {
        key: 'octaves',
        label: 'Octaves shown',
        labelI18n: { 'zh-CN': '显示八度数', 'en-US': 'Octaves shown' },
        type: 'select',
        options: [1, 2, 3, 4].map((o) => ({ value: String(o), label: `${o}`, labelI18n: { 'zh-CN': `${o}`, 'en-US': `${o}` } })),
        value: String(s.octaves),
      },
      {
        key: 'volume',
        label: 'Volume',
        labelI18n: { 'zh-CN': '音量', 'en-US': 'Volume' },
        type: 'number',
        value: s.volume,
        hint: '0 – 1 master gain.',
      },
      {
        key: 'sustain',
        label: 'Sustain pedal',
        labelI18n: { 'zh-CN': '延音踏板', 'en-US': 'Sustain pedal' },
        type: 'checkbox',
        value: s.sustain,
        hint: this.zh
          ? '开启后松开琴键声音延续，关闭或点“释放全部音符”停止。'
          : 'While on, released keys keep sounding; toggle off or press "Release all notes" to stop.',
      },
      {
        key: 'labels',
        label: 'Show key labels',
        labelI18n: { 'zh-CN': '显示键位标注', 'en-US': 'Show key labels' },
        type: 'checkbox',
        value: s.labels,
      },
      actionButton('benchmark', 'Run kernel benchmarks', '运行内核基准测试'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    if (actionFired(params, 'panic')) {
      this.stopAll();
      this.draw();
      return;
    }
    if (actionFired(params, 'benchmark')) {
      this.runBenchmarks();
      return;
    }
    if (typeof params.instrument === 'string' && INSTRUMENTS[params.instrument as InstrumentId]) {
      const changed = params.instrument !== s.instrument;
      s.instrument = params.instrument as InstrumentId;
      if (changed) this.stopAll();
    }
    if (typeof params.octave === 'string' && ['1', '2', '3', '4', '5'].includes(params.octave)) {
      const o = Number(params.octave);
      if (o !== s.octave) {
        s.octave = o;
        this.rebuildKeys();
        this.stopAll();
      }
    }
    if (typeof params.octaves === 'string' && ['1', '2', '3', '4'].includes(params.octaves)) {
      const o = Number(params.octaves);
      if (o !== s.octaves) {
        s.octaves = o;
        this.rebuildKeys();
        this.stopAll();
      }
    }
    if (typeof params.volume === 'number') s.volume = Math.min(1, Math.max(0, params.volume));
    if (typeof params.sustain === 'boolean') {
      const changed = params.sustain !== s.sustain;
      s.sustain = params.sustain;
      if (changed && !s.sustain) this.releaseSustained();
    }
    if (typeof params.labels === 'boolean') s.labels = params.labels;
    if (this.master && this.audio) this.master.gain.value = s.volume;
    this.draw();
  }

  private runBenchmarks() {
    const bench = runKeysBenchmarks();
    const line = bench.map((b) => `${b.value}`).join(' · ');
    notify(
      this.api,
      'success',
      `Kernel benchmarks: ${line}`,
      `内核基准：${line}`,
    );
  }

  // ---- keyboard bindings ----------------------------------------------------

  private rebuildKeys() {
    this.keys = buildKeyboard(12 * (this.state.octave + 1), this.state.octaves);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '-' || e.key === '=') {
      e.preventDefault();
      const next = Math.min(5, Math.max(1, this.state.octave + (e.key === '=' ? 1 : -1)));
      if (next !== this.state.octave) {
        this.state.octave = next;
        this.rebuildKeys();
        this.stopAll();
        this.draw();
      }
      return;
    }
    const semi = KEY_BINDINGS[e.key.toLowerCase()];
    if (semi === undefined) return;
    e.preventDefault();
    this.heldKeys.add(e.key.toLowerCase());
    this.noteOn(12 * (this.state.octave + 1) + semi);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!this.heldKeys.has(k)) return;
    this.heldKeys.delete(k);
    const semi = KEY_BINDINGS[k];
    if (semi === undefined) return;
    this.noteOff(12 * (this.state.octave + 1) + semi);
  };

  // ---- pointer interaction ----------------------------------------------------

  /** Inject the interactive keyboard canvas into container.dom. The shared
   * canvas2d is pointer-events:none (host pan/zoom owns it), so the playable
   * keys must be their own DOM element to receive pointer events. */
  private attachCanvas() {
    this.detachCanvas();
    const dom = this.ctx?.dom;
    if (!dom) return;
    this.rebuildKeys();
    let canvas = this.overlay;
    if (!canvas || canvas.ownerDocument !== dom.ownerDocument) {
      canvas = dom.ownerDocument.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      canvas.style.touchAction = 'none';
      canvas.tabIndex = 0;
      this.overlay = canvas;
    }
    if (canvas.parentElement !== dom) dom.appendChild(canvas);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.draw());
      this.observer.observe(canvas);
    }
    this.draw();
  }

  private detachCanvas() {
    const canvas = this.overlay;
    if (canvas) canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    canvas?.remove();
    this.overlay = null;
    this.pointerNotes.clear();
  }

  private onPointerDown = (e: PointerEvent) => {
    const canvas = this.overlay;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const whiteCount = this.state.octaves * 7;
    const hit = (isBlack: boolean): PianoKey | undefined => {
      for (const k of this.keys) {
        if (k.isBlack !== isBlack) continue;
        if (pointIn(keyRect(k, rect.width, rect.height, whiteCount), x, y)) return k;
      }
      return undefined;
    };
    // Black keys sit on top: test them first.
    const k = hit(true) ?? hit(false);
    if (!k) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture may fail on some devices; note still plays */
    }
    // Per-pointer tracking: multi-touch chords release only their own note.
    this.pointerNotes.set(e.pointerId, k.midi);
    this.noteOn(k.midi);
  };

  private onPointerUp = (e: PointerEvent) => {
    const midi = this.pointerNotes.get(e.pointerId);
    if (midi !== undefined) {
      this.pointerNotes.delete(e.pointerId);
      this.noteOff(midi);
    }
  };

  // ---- audio engine -----------------------------------------------------------

  private ensureAudio(): AudioContext | null {
    if (this.audio && this.audio.state !== 'closed') {
      if (this.audio.state === 'suspended') void this.audio.resume().catch(() => undefined);
      return this.audio;
    }
    const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) return null;
    // 'interactive' requests the smallest output latency the device offers —
    // essential for fast repeated notes to feel in sync with the keypress.
    this.audio = new Ctor({ latencyHint: 'interactive' });
    this.master = this.audio.createGain();
    this.master.gain.value = this.state.volume;
    this.master.connect(this.audio.destination);
    this.waves.clear();
    return this.audio;
  }

  private periodicWave(ctx: AudioContext, id: InstrumentId): PeriodicWave {
    const cached = this.waves.get(id);
    if (cached) return cached;
    const inst = INSTRUMENTS[id]!;
    const n = inst.harmonics.length;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let h = 0; h < n; h++) {
      const part = inst.harmonics[h]!;
      const idx = Math.round(part.ratio);
      if (idx > 0 && idx <= n) imag[idx] = part.gain;
    }
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.waves.set(id, wave);
    return wave;
  }

  private noteOn(midi: number) {
    // Retrigger: a still-sounding voice on this note is hard-cut with a tiny
    // fade so fast repeated hits always restart the envelope cleanly.
    const existing = this.voices.get(midi);
    if (existing) this.killVoice(midi, existing);
    const ctx = this.ensureAudio();
    if (!ctx || !this.master) return;
    const inst = INSTRUMENTS[this.state.instrument]!;
    const freq = noteFrequency(midi);
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + inst.attack);
    if (inst.sustain > 0) {
      gain.gain.linearRampToValueAtTime(inst.sustain, now + inst.attack + inst.decay);
    } else {
      // Percussive: exponential-style decay towards near-zero via ramps.
      gain.gain.linearRampToValueAtTime(0.02, now + inst.attack + inst.decay);
    }

    if (inst.filterScale > 0) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(ctx.sampleRate / 2 - 1000, inst.filterScale * freq);
      filter.Q.value = 0.5;
      gain.connect(filter);
      filter.connect(this.master);
    } else {
      gain.connect(this.master);
    }

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.periodicWave(ctx, this.state.instrument));
    osc.frequency.value = freq;
    osc.connect(gain);

    const voice: Voice = { oscs: [osc], gain, onAt: now, released: false };
    if (inst.vibratoDepth > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = inst.vibratoRate;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = inst.vibratoDepth * freq;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(now);
      voice.lfo = lfo;
      voice.lfoGain = lfoGain;
    }
    osc.start(now);
    this.voices.set(midi, voice);
    this.lastNote = { midi, at: Date.now() };
    this.setOutputs();
    this.draw();
  }

  private noteOff(midi: number) {
    const voice = this.voices.get(midi);
    if (!voice || voice.released) return;
    if (this.state.sustain) {
      // Sustained: keep sounding until the pedal turns off or panic fires.
      return;
    }
    this.releaseVoice(midi, voice);
  }

  /** Fast fade-out (default 15 ms) + immediate map removal. Used on retrigger
   * and panic. The timeout cleanup only drops the voice if it is still the
   * one registered under this note (a newer retrigger may have replaced it). */
  private killVoice(midi: number, voice: Voice, fade = 0.015) {
    voice.released = true;
    const ctx = this.audio;
    if (ctx) {
      const now = ctx.currentTime;
      try {
        const g = voice.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(Math.max(g.value, 0.0001), now);
        g.linearRampToValueAtTime(0, now + fade);
        for (const osc of voice.oscs) osc.stop(now + fade + 0.02);
        voice.lfo?.stop(now + fade + 0.02);
      } catch {
        /* already stopped */
      }
    } else {
      for (const osc of voice.oscs) {
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
      }
      voice.lfo?.stop();
    }
    if (this.voices.get(midi) === voice) this.voices.delete(midi);
    window.setTimeout(() => {
      try {
        voice.gain.disconnect();
      } catch {
        /* disconnected already */
      }
    }, (fade + 0.06) * 1000);
  }

  private releaseVoice(midi: number, voice: Voice) {
    const ctx = this.audio;
    if (!ctx) return;
    const inst = INSTRUMENTS[this.state.instrument]!;
    const now = ctx.currentTime;
    voice.released = true;
    const g = voice.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.linearRampToValueAtTime(0, now + inst.release);
    for (const osc of voice.oscs) {
      try {
        osc.stop(now + inst.release + 0.05);
      } catch {
        /* already stopped */
      }
    }
    voice.lfo?.stop(now + inst.release + 0.05);
    const tid = window.setTimeout(() => {
      try {
        voice.gain.disconnect();
      } catch {
        /* disconnected already */
      }
      // Guarded: a retrigger may have replaced this voice under the same note.
      if (this.voices.get(midi) === voice) {
        this.voices.delete(midi);
        this.setOutputs();
        this.draw();
      }
    }, (inst.release + 0.1) * 1000);
    void tid;
  }

  /** Release notes that are kept alive by the sustain pedal. */
  private releaseSustained() {
    for (const [midi, voice] of this.voices) {
      if (!voice.released) this.releaseVoice(midi, voice);
    }
  }

  private stopAll() {
    for (const [midi, voice] of [...this.voices]) {
      this.killVoice(midi, voice, 0.01);
    }
    this.setOutputs();
  }

  // ---- outputs & drawing -------------------------------------------------------

  private setOutputs() {
    // Ambient-music ducking follows the voice map: any entry — including a
    // released-but-still-tailing one — keeps the music paused.
    setHostAudioActive(this.voices.size > 0);
    const metrics: ScienceMetric[] = [
      { key: 'voices', label: this.zh ? '正在发声' : 'Active voices', value: fmtMetric(this.voices.size) },
    ];
    if (this.lastNote) {
      metrics.push({ key: 'last', label: this.zh ? '最近音符' : 'Last note', value: noteName(this.lastNote.midi) });
      metrics.push({ key: 'freq', label: this.zh ? '最近频率' : 'Last frequency', value: `${noteFrequency(this.lastNote.midi).toFixed(1)} Hz` });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private draw() {
    const canvas = this.overlay;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (W === 0 || H === 0) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const whiteCount = this.state.octaves * 7;
    const pressed = new Set<number>(this.voices.keys());

    // Background
    g.fillStyle = '#20242b';
    g.fillRect(0, 0, W, H);

    const labelFont = `${Math.max(9, Math.min(12, W / whiteCount / 2.2))}px ui-sans-serif, system-ui`;
    // White keys
    for (const k of this.keys) {
      if (k.isBlack) continue;
      const r = keyRect(k, W, H, whiteCount);
      const isDown = pressed.has(k.midi);
      g.fillStyle = isDown ? '#9fc0dc' : '#f4f1ea';
      g.fillRect(r.x + 0.5, r.y, r.w - 1, r.h - 2);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 2);
      if (isDown) {
        g.fillStyle = 'rgba(111,143,174,0.55)';
        g.fillRect(r.x + 2, r.h - Math.min(70, r.h * 0.3), r.w - 4, Math.min(70, r.h * 0.3) - 2);
      }
      if (this.state.labels && k.key) {
        g.fillStyle = isDown ? '#1c2a38' : '#5a6472';
        g.font = labelFont;
        g.textAlign = 'center';
        g.fillText(k.key, r.x + r.w / 2, r.h - 6);
      }
    }
    // Black keys
    for (const k of this.keys) {
      if (!k.isBlack) continue;
      const r = keyRect(k, W, H, whiteCount);
      const isDown = pressed.has(k.midi);
      g.fillStyle = isDown ? '#6f8fae' : '#15181d';
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (this.state.labels && k.key) {
        g.fillStyle = isDown ? '#10151b' : '#9aa4b2';
        g.font = labelFont;
        g.textAlign = 'center';
        g.fillText(k.key, r.x + r.w / 2, r.h - 6);
      }
    }

    // Header line: instrument + sustain state + last note.
    g.fillStyle = '#c9d2dd';
    g.font = '12px ui-sans-serif, system-ui';
    g.textAlign = 'left';
    const sustainText = this.state.sustain
      ? this.zh
        ? ' · 延音开'
        : ' · sustain on'
      : '';
    const lastText = this.lastNote
      ? ` · ${noteName(this.lastNote.midi)} (${noteFrequency(this.lastNote.midi).toFixed(1)} Hz)`
      : '';
    const playHint = this.voices.size > 0 ? '' : this.zh ? ' · 点击琴键或按 Z–M / QWERTY 播放' : ' · click keys or press Z-M / QWERTY';
    g.fillText(`${this.state.instrument}${sustainText}${lastText}${playHint}`, 8, 14);
  }
}

/** Plugin factory expected by the built-in loader (mirrors `createSynthPlugin`). */
export default function createKeysPlugin(): Plugin {
  return new KeysPlugin();
}
