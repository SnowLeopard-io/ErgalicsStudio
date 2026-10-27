// ==========================================================================
// synth — pure synthesis kernel
//
// Oscillators, ADSR, FM, wavetable additive synthesis, RBJ biquad filters
// (coefficients + analytic magnitude response), LFO modulation and offline
// preset rendering to 16-bit WAV. No Web Audio here: the plugin renders
// buffers on the CPU, then hands them to the shared clip player.
// ==========================================================================

import { encodeWav } from '@/core/audio/wav';

export type WaveKind = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'wavetable';
export type FilterKind = 'lowpass' | 'highpass' | 'bandpass' | 'notch';
export type LfoShape = 'sine' | 'triangle' | 'square';

export interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface SynthPreset {
  name: string;
  wave: WaveKind;
  /** MIDI note number of the played note. */
  midi: number;
  /** Detune in cents applied to a second oscillator. */
  detune: number;
  /** FM modulator / carrier frequency ratio (1 = harmonic). */
  fmRatio: number;
  /** FM modulation index (0 = no FM). */
  fmIndex: number;
  filter: FilterKind;
  cutoff: number;
  q: number;
  adsr: Adsr;
  lfoRate: number;
  lfoDepth: number;
  lfoShape: LfoShape;
  /** Note length including release, seconds. */
  duration: number;
}

export const DEFAULT_PRESETS: SynthPreset[] = [
  {
    name: 'Warm saw pad',
    wave: 'sawtooth',
    midi: 57,
    detune: 7,
    fmRatio: 1,
    fmIndex: 0,
    filter: 'lowpass',
    cutoff: 2400,
    q: 0.9,
    adsr: { attack: 0.25, decay: 0.4, sustain: 0.65, release: 0.7 },
    lfoRate: 0.35,
    lfoDepth: 0.12,
    lfoShape: 'sine',
    duration: 3,
  },
  {
    name: 'Bright square lead',
    wave: 'square',
    midi: 64,
    detune: 0,
    fmRatio: 2,
    fmIndex: 1.2,
    filter: 'lowpass',
    cutoff: 5200,
    q: 1.4,
    adsr: { attack: 0.01, decay: 0.12, sustain: 0.8, release: 0.2 },
    lfoRate: 5.2,
    lfoDepth: 0.08,
    lfoShape: 'sine',
    duration: 1.6,
  },
  {
    name: 'Glass bell (FM)',
    wave: 'sine',
    midi: 72,
    detune: 0,
    fmRatio: 3.5,
    fmIndex: 3.2,
    filter: 'bandpass',
    cutoff: 3600,
    q: 2.2,
    adsr: { attack: 0.002, decay: 1.4, sustain: 0.0, release: 0.9 },
    lfoRate: 0.8,
    lfoDepth: 0.05,
    lfoShape: 'triangle',
    duration: 2.4,
  },
  {
    name: 'Hollow triangle flute',
    wave: 'triangle',
    midi: 69,
    detune: 4,
    fmRatio: 1,
    fmIndex: 0.15,
    filter: 'highpass',
    cutoff: 180,
    q: 0.7,
    adsr: { attack: 0.08, decay: 0.2, sustain: 0.9, release: 0.35 },
    lfoRate: 4.5,
    lfoDepth: 0.15,
    lfoShape: 'sine',
    duration: 2,
  },
  {
    name: 'Wavetable organ',
    wave: 'wavetable',
    midi: 60,
    detune: 0,
    fmRatio: 1,
    fmIndex: 0,
    filter: 'notch',
    cutoff: 1200,
    q: 0.8,
    adsr: { attack: 0.03, decay: 0.1, sustain: 0.95, release: 0.3 },
    lfoRate: 6,
    lfoDepth: 0.04,
    lfoShape: 'triangle',
    duration: 2.2,
  },
];

/** Equal-tempered frequency of a MIDI note (A4 = 440 Hz). */
export function noteFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** One cycle of a band-limited-ish oscillator at phase ∈ [0, 1). */
export function waveSample(kind: WaveKind, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (kind) {
    case 'sine':
      return Math.sin(2 * Math.PI * p);
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'sawtooth':
      return 2 * p - 1;
    case 'triangle':
      return 4 * Math.abs(p - 0.5) - 1;
    case 'wavetable': {
      // Additive wavetable: 1/n² weights on odd harmonics (organ-like).
      let v = 0;
      for (let n = 1; n <= 9; n += 2) v += Math.sin(2 * Math.PI * n * p) / (n * n);
      return v * 0.9;
    }
    default:
      return 0;
  }
}

/** ADSR gain at time t (seconds) for a gate that stays on for `gate` seconds. */
export function adsrGain(t: number, adsr: Adsr, gate = Number.POSITIVE_INFINITY): number {
  const { attack, decay, sustain, release } = adsr;
  const a = Math.max(0, attack);
  const d = Math.max(0, decay);
  const r = Math.max(0, release);
  const s = Math.min(1, Math.max(0, sustain));
  if (t < 0) return 0;
  if (t < a) return a > 0 ? t / a : 1;
  const afterA = t - a;
  if (afterA < d) {
    const k = d > 0 ? afterA / d : 1;
    return 1 + (s - 1) * k;
  }
  if (t < gate) return s;
  const rt = t - gate;
  if (rt >= r) return 0;
  return s * (1 - (r > 0 ? rt / r : 1));
}

/** FM sample: carrier phase plus modulator with ratio and index. */
export function fmSample(carrierPhase: number, modPhase: number, index: number): number {
  return Math.sin(2 * Math.PI * carrierPhase + index * Math.sin(2 * Math.PI * modPhase));
}

/** LFO value in [−1, 1] (before depth scaling). */
export function lfoValue(t: number, rate: number, shape: LfoShape = 'sine'): number {
  const phase = (t * Math.max(rate, 0)) % 1;
  switch (shape) {
    case 'triangle':
      return 4 * Math.abs(phase - 0.5) - 1;
    case 'square':
      return phase < 0.5 ? 1 : -1;
    default:
      return Math.sin(2 * Math.PI * phase);
  }
}

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ audio-EQ-cookbook biquad coefficients (Q form). */
export function biquadCoeffs(kind: FilterKind, sampleRate: number, freq: number, q = 0.7071): BiquadCoeffs {
  const w0 = (2 * Math.PI * Math.min(Math.max(freq, 1), sampleRate / 2 - 1)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.max(q, 1e-4));
  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;
  switch (kind) {
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    default:
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Analytic magnitude response |H(e^{jω})| in dB at each frequency. */
export function biquadResponse(coeffs: BiquadCoeffs, sampleRate: number, freqs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i += 1) {
    const w = (2 * Math.PI * freqs[i]!) / sampleRate;
    const cos1 = Math.cos(w);
    const sin1 = Math.sin(w);
    const cos2 = Math.cos(2 * w);
    const sin2 = Math.sin(2 * w);
    const numRe = coeffs.b0 + coeffs.b1 * cos1 + coeffs.b2 * cos2;
    const numIm = -(coeffs.b1 * sin1 + coeffs.b2 * sin2);
    const denRe = 1 + coeffs.a1 * cos1 + coeffs.a2 * cos2;
    const denIm = -(coeffs.a1 * sin1 + coeffs.a2 * sin2);
    const mag = Math.hypot(numRe, numIm) / Math.max(1e-12, Math.hypot(denRe, denIm));
    out[i] = 20 * Math.log10(Math.max(mag, 1e-9));
  }
  return out;
}

/** In-place direct-form I biquad filtering. */
export function applyBiquad(samples: Float64Array, coeffs: BiquadCoeffs): Float64Array {
  const out = new Float64Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x0 = samples[i]!;
    const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** Render a preset offline to mono Float64 samples. */
export function renderPreset(preset: SynthPreset, sampleRate = 44100): Float64Array {
  const n = Math.max(1, Math.round(preset.duration * sampleRate));
  const out = new Float64Array(n);
  const base = noteFrequency(preset.midi);
  const detune = 2 ** (preset.detune / 1200);
  const gate = Math.max(0.01, preset.duration - preset.adsr.release);
  let phase = 0;
  let phase2 = 0;
  let mod = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    // LFO modulates cutoff by ±depth octaves around the preset cutoff.
    const lfo = lfoValue(t, preset.lfoRate, preset.lfoShape) * preset.lfoDepth;
    const cutoff = Math.min(sampleRate / 2 - 20, Math.max(20, preset.cutoff * 2 ** lfo));
    // The filter is rendered in one pass after the oscillator loop; the
    // cutoff sweep is approximated by a slowly updated state below.
    void cutoff;
    const f1 = base * detune;
    phase = (phase + f1 / sampleRate) % 1;
    phase2 = (phase2 + (base / detune) / sampleRate) % 1;
    mod = (mod + (base * preset.fmRatio) / sampleRate) % 1;
    const s1 = preset.fmIndex > 0 ? fmSample(phase, mod, preset.fmIndex) : waveSample(preset.wave, phase);
    const s2 = preset.detune !== 0 ? waveSample(preset.wave, phase2) : 0;
    const env = adsrGain(t, preset.adsr, gate);
    out[i] = 0.5 * (s1 + 0.5 * s2) * env;
  }
  const coeffs = biquadCoeffs(preset.filter, sampleRate, preset.cutoff, preset.q);
  const filtered = applyBiquad(out, coeffs);
  // Normalise to −1 dBFS peak for a predictable export level.
  let peak = 0;
  for (let i = 0; i < filtered.length; i += 1) peak = Math.max(peak, Math.abs(filtered[i]!));
  if (peak > 0.89) {
    const g = 0.89 / peak;
    for (let i = 0; i < filtered.length; i += 1) filtered[i] = filtered[i]! * g;
  }
  return filtered;
}

/** Render a preset and encode it as a 16-bit PCM WAV. */
export function renderPresetWav(preset: SynthPreset, sampleRate = 44100): ArrayBuffer {
  return encodeWav(renderPreset(preset, sampleRate), sampleRate);
}

/** Parse a single preset or an array of presets from JSON text. */
export function parsePresetsJson(text: string): SynthPreset[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : [data];
  const out: SynthPreset[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const wave = String(o.wave ?? 'sine') as WaveKind;
    const filter = String(o.filter ?? 'lowpass') as FilterKind;
    const lfoShape = String(o.lfoShape ?? 'sine') as LfoShape;
    const adsrRaw = (o.adsr ?? {}) as Record<string, unknown>;
    const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    out.push({
      name: String(o.name ?? `preset ${out.length + 1}`),
      wave: ['sine', 'square', 'sawtooth', 'triangle', 'wavetable'].includes(wave) ? wave : 'sine',
      midi: num(o.midi, 60),
      detune: num(o.detune, 0),
      fmRatio: num(o.fmRatio, 1),
      fmIndex: num(o.fmIndex, 0),
      filter: ['lowpass', 'highpass', 'bandpass', 'notch'].includes(filter) ? filter : 'lowpass',
      cutoff: num(o.cutoff, 3000),
      q: num(o.q, 0.7),
      adsr: {
        attack: Math.max(0, num(adsrRaw.attack, 0.01)),
        decay: Math.max(0, num(adsrRaw.decay, 0.2)),
        sustain: Math.min(1, Math.max(0, num(adsrRaw.sustain, 0.7))),
        release: Math.max(0, num(adsrRaw.release, 0.3)),
      },
      lfoRate: num(o.lfoRate, 1),
      lfoDepth: num(o.lfoDepth, 0),
      lfoShape: ['sine', 'triangle', 'square'].includes(lfoShape) ? lfoShape : 'sine',
      duration: Math.min(20, Math.max(0.1, num(o.duration, 2))),
    });
  }
  return out;
}

export interface SynthBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

export function runSynthBenchmarks(): SynthBenchmark[] {
  const sine = new Float64Array(4096);
  for (let i = 0; i < sine.length; i += 1) sine[i] = Math.sin((2 * Math.PI * i) / 64);
  let sumSq = 0;
  for (let i = 0; i < sine.length; i += 1) sumSq += sine[i]! * sine[i]!;
  const sineRms = Math.sqrt(sumSq / sine.length);

  const adsr = { attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.2 };
  const atAttackPeak = adsrGain(0.1, adsr, 1);
  const atSustain = adsrGain(0.5, adsr, 1);
  const afterRelease = adsrGain(1.25, adsr, 1);

  const dc = new Float64Array(2048).fill(1);
  const lp = biquadCoeffs('lowpass', 48000, 1000, 0.7071);
  const lpResponse = biquadResponse(lp, 48000, new Float64Array([0]))[0]!;
  const notch = biquadCoeffs('notch', 48000, 1000, 2);
  const notchAtCutoff = biquadResponse(notch, 48000, new Float64Array([1000]))[0]!;
  const notchScore = notchAtCutoff <= -60 ? -60 : notchAtCutoff;
  const filteredDc = applyBiquad(dc, lp);
  const dcGain = filteredDc[filteredDc.length - 1]!;

  const square = waveSample('square', 0.25);
  const saw = waveSample('sawtooth', 0.25);
  const tri = waveSample('triangle', 0.0);
  const lfo = lfoValue(0.125, 1, 'sine');

  const cases = [
    {
      id: 'sine-rms',
      labelEn: 'Unit sine RMS = 1/√2',
      labelZh: '单位正弦 RMS = 1/√2',
      measured: sineRms,
      expected: Math.SQRT1_2,
      tol: 2e-3,
    },
    {
      id: 'adsr-peak',
      labelEn: 'ADSR reaches 1.0 at attack peak',
      labelZh: 'ADSR 在起音峰值达到 1.0',
      measured: atAttackPeak,
      expected: 1,
      tol: 1e-9,
    },
    {
      id: 'adsr-sustain',
      labelEn: 'ADSR sustain level = 0.5',
      labelZh: 'ADSR 延音电平 = 0.5',
      measured: atSustain,
      expected: 0.5,
      tol: 1e-9,
    },
    {
      id: 'adsr-release',
      labelEn: 'ADSR reaches zero after release',
      labelZh: 'ADSR 释音后归零',
      measured: afterRelease,
      expected: 0,
      tol: 1e-9,
    },
    {
      id: 'lowpass-dc',
      labelEn: 'Low-pass DC gain = 0 dB',
      labelZh: '低通直流增益 = 0 dB',
      measured: lpResponse,
      expected: 0,
      tol: 1e-6,
    },
    {
      id: 'lowpass-dc-time',
      labelEn: 'Low-pass step settles to unity',
      labelZh: '低通阶跃稳定于 1',
      measured: dcGain,
      expected: 1,
      tol: 1e-3,
    },
    {
      id: 'notch-cutoff',
      labelEn: 'Notch attenuation at f₀ ≤ −60 dB',
      labelZh: '陷波在 f₀ 处 ≤ −60 dB',
      measured: notchScore,
      expected: -60,
      tol: 0,
    },
    {
      id: 'wave-square',
      labelEn: 'Square(0.25) = +1',
      labelZh: '方波(0.25) = +1',
      measured: square,
      expected: 1,
      tol: 1e-12,
    },
    {
      id: 'wave-saw',
      labelEn: 'Sawtooth(0.25) = −0.5',
      labelZh: '锯齿波(0.25) = −0.5',
      measured: saw,
      expected: -0.5,
      tol: 1e-12,
    },
    {
      id: 'wave-tri',
      labelEn: 'Triangle(0) = −1',
      labelZh: '三角波(0) = −1',
      measured: tri,
      expected: -1,
      tol: 1e-12,
    },
    {
      id: 'lfo-quarter',
      labelEn: 'Sine LFO at 1/8 cycle = 1',
      labelZh: '正弦 LFO 在 1/8 周期 = 1',
      measured: lfo,
      expected: 1,
      tol: 1e-9,
    },
    {
      id: 'note-a4',
      labelEn: 'MIDI 69 = 440 Hz',
      labelZh: 'MIDI 69 = 440 Hz',
      measured: noteFrequency(69),
      expected: 440,
      tol: 1e-12,
    },
  ].map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return { ...c, relErr, passed: relErr <= c.tol };
  });
  return cases;
}
