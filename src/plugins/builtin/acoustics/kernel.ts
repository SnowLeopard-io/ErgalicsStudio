// ==========================================================================
// acoustics — pure acoustics kernel
//
// Waveform metrics, FFT helpers (delegated to core/signal), harmonic and
// overtone analysis, beat envelopes, standing-wave room modes, Sabine
// reverberation and interference. Everything is DOM-free so the numerical
// layer can be tested in Node; audio decoding/playback lives in core/audio.
// ==========================================================================

import { spectrum, type SpectrumResult } from '@/core/signal/fft';

export interface SampleTable {
  sampleRate: number;
  samples: Float64Array;
}

/** Root-mean-square amplitude. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/** Peak absolute amplitude. */
export function peakAmplitude(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]!));
  return peak;
}

/** Amplitude ratio → decibels (relative to 1.0 full scale by default). */
export function toDb(amplitude: number, ref = 1): number {
  if (!(amplitude > 0)) return -Infinity;
  return 20 * Math.log10(amplitude / ref);
}

/** dBFS from RMS amplitude. */
export function rmsDbfs(samples: ArrayLike<number>): number {
  return toDb(rms(samples));
}

/** Crest factor (peak / RMS). */
export function crestFactor(samples: ArrayLike<number>): number {
  const r = rms(samples);
  return r > 0 ? peakAmplitude(samples) / r : 0;
}

/** Zero-crossing estimate of the fundamental frequency (robust fallback). */
export function zeroCrossingFrequency(samples: ArrayLike<number>, sampleRate: number): number {
  let crossings = 0;
  let prev = 0;
  let started = false;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]!;
    if (!started) {
      prev = v;
      started = true;
      continue;
    }
    if ((prev < 0 && v >= 0) || (prev > 0 && v <= 0)) crossings += 1;
    prev = v;
  }
  const seconds = samples.length / sampleRate;
  return seconds > 0 ? crossings / 2 / seconds : 0;
}

/** Dominant frequency via an FFT peak, falling back to zero crossings. */
export function dominantFrequency(samples: ArrayLike<number>, sampleRate: number, nfft = 8192): number {
  if (samples.length < 8) return 0;
  const result = spectrum(samples, sampleRate, 'hann', nfft);
  let best = 1;
  let bestMag = -1;
  const limit = Math.min(result.magnitude.length, Math.floor(nfft / 2));
  for (let k = 1; k < limit; k += 1) {
    if (result.magnitude[k]! > bestMag) {
      bestMag = result.magnitude[k]!;
      best = k;
    }
  }
  const f = result.freqs[best] ?? 0;
  return f > 0 ? f : zeroCrossingFrequency(samples, sampleRate);
}

/** Ideal harmonic frequencies f0, 2f0, … */
export function harmonicSeries(f0: number, count = 8): number[] {
  return Array.from({ length: count }, (_, i) => f0 * (i + 1));
}

export interface HarmonicAmplitude {
  n: number;
  freq: number;
  amplitude: number;
  relDb: number;
}

/**
 * Measure the amplitude at each harmonic of `f0` from the one-sided spectrum
 * (nearest bin, ±1 bin max). Returns harmonic 1…count.
 */
export function harmonicAnalysis(
  samples: ArrayLike<number>,
  sampleRate: number,
  f0: number,
  count = 8,
  nfft = 8192,
): HarmonicAmplitude[] {
  if (!(f0 > 0)) return [];
  const spec = spectrum(samples, sampleRate, 'hann', nfft);
  const binHz = sampleRate / spec.nfft;
  const out: HarmonicAmplitude[] = [];
  let max = 0;
  for (let n = 1; n <= count; n += 1) {
    const target = f0 * n;
    const centre = Math.round(target / binHz);
    let amp = 0;
    for (let k = Math.max(1, centre - 1); k <= Math.min(spec.magnitude.length - 1, centre + 1); k += 1) {
      amp = Math.max(amp, spec.magnitude[k]!);
    }
    max = Math.max(max, amp);
    out.push({ n, freq: target, amplitude: amp, relDb: 0 });
  }
  return out.map((h) => ({ ...h, relDb: max > 0 ? toDb(h.amplitude / max) : -Infinity }));
}

/** Total harmonic distortion from harmonic amplitudes (H2…Hn / H1). */
export function thd(harmonics: HarmonicAmplitude[]): number {
  if (harmonics.length === 0) return 0;
  const h1 = harmonics[0]!.amplitude;
  if (!(h1 > 0)) return 0;
  let sum = 0;
  for (let i = 1; i < harmonics.length; i += 1) sum += harmonics[i]!.amplitude ** 2;
  return Math.sqrt(sum) / h1;
}

/** Two-tone beat envelope e(t) = 2 cos(2π·Δf/2·t) · cos(2π·f̄·t). */
export function beatEnvelope(f1: number, f2: number, t: number): number {
  const df = Math.abs(f1 - f2);
  const mean = (f1 + f2) / 2;
  return 2 * Math.cos(Math.PI * df * t) * Math.cos(2 * Math.PI * mean * t);
}

/** Beat rate (Hz) of two partials. */
export function beatRate(f1: number, f2: number): number {
  return Math.abs(f1 - f2);
}

/** Wavelength from frequency and speed of sound. */
export function wavelength(freq: number, speed = 343): number {
  return freq > 0 ? speed / freq : Number.POSITIVE_INFINITY;
}

/**
 * Resultant amplitude of two coherent waves with a phase difference:
 * A = √(A1² + A2² + 2A1A2 cos φ).
 */
export function interferenceAmplitude(a1: number, a2: number, phaseDeg: number): number {
  const phi = (phaseDeg * Math.PI) / 180;
  return Math.sqrt(a1 * a1 + a2 * a2 + 2 * a1 * a2 * Math.cos(phi));
}

export type RoomModeType = 'axial' | 'tangential' | 'oblique';

export interface RoomMode {
  nx: number;
  ny: number;
  nz: number;
  type: RoomModeType;
  freq: number;
}

/**
 * Rectangular-room eigenfrequencies:
 * f = (c/2)·√((nx/Lx)² + (ny/Ly)² + (nz/Lz)²).
 * Zero indices are the room dimensions that do not participate.
 */
export function roomModes(lx: number, ly: number, lz: number, speed = 343, maxFreq = 300, maxIndex = 4): RoomMode[] {
  const modes: RoomMode[] = [];
  for (let nx = 0; nx <= maxIndex; nx += 1) {
    for (let ny = 0; ny <= maxIndex; ny += 1) {
      for (let nz = 0; nz <= maxIndex; nz += 1) {
        if (nx === 0 && ny === 0 && nz === 0) continue;
        const freq = (speed / 2) * Math.sqrt((nx / lx) ** 2 + (ny / ly) ** 2 + (nz / lz) ** 2);
        if (freq > maxFreq) continue;
        const active = [nx, ny, nz].filter((n) => n > 0).length;
        const type: RoomModeType = active === 1 ? 'axial' : active === 2 ? 'tangential' : 'oblique';
        modes.push({ nx, ny, nz, type, freq });
      }
    }
  }
  return modes.sort((a, b) => a.freq - b.freq);
}

/** Sabine reverberation time RT60 = 0.161 V / Σ(αᵢ Sᵢ) (SI). */
export function sabineRt60(volume: number, surfaces: Array<{ area: number; alpha: number }>): number {
  const absorption = surfaces.reduce((sum, s) => sum + Math.max(0, s.area) * Math.min(1, Math.max(0, s.alpha)), 0);
  if (!(volume > 0) || !(absorption > 0)) return Number.POSITIVE_INFINITY;
  return (0.161 * volume) / absorption;
}

/** Eyring reverberation time: 0.161V / (−S ln(1 − ᾱ)). */
export function eyringRt60(volume: number, surfaces: Array<{ area: number; alpha: number }>): number {
  const totalArea = surfaces.reduce((sum, s) => sum + Math.max(0, s.area), 0);
  if (!(volume > 0) || !(totalArea > 0)) return Number.POSITIVE_INFINITY;
  const meanAlpha = surfaces.reduce((sum, s) => sum + Math.max(0, s.area) * Math.min(0.999, Math.max(0, s.alpha)), 0) / totalArea;
  const denom = -totalArea * Math.log(1 - meanAlpha);
  return denom > 0 ? (0.161 * volume) / denom : Number.POSITIVE_INFINITY;
}

/** Schroeder frequency f_s ≈ 2000·√(RT60 / V). */
export function schroederFrequency(volume: number, rt60: number): number {
  return volume > 0 && rt60 > 0 ? 2000 * Math.sqrt(rt60 / volume) : 0;
}

/** Critical distance for a room (metres): 0.057·√(V/RT60) for Q = 1. */
export function criticalDistance(volume: number, rt60: number): number {
  return rt60 > 0 ? 0.057 * Math.sqrt(volume / rt60) : Number.POSITIVE_INFINITY;
}

/** Peak-preserving waveform overview buckets for canvas drawing. */
export function waveformOverview(samples: ArrayLike<number>, buckets: number): Array<{ min: number; max: number }> {
  const n = Math.max(1, Math.floor(buckets));
  const out: Array<{ min: number; max: number }> = [];
  const step = samples.length / n;
  for (let b = 0; b < n; b += 1) {
    const start = Math.floor(b * step);
    const end = Math.max(start + 1, Math.floor((b + 1) * step));
    let min = 1;
    let max = -1;
    for (let i = start; i < end && i < samples.length; i += 1) {
      const v = samples[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) {
      min = 0;
      max = 0;
    }
    out.push({ min, max });
  }
  return out;
}

/** RMS envelope with a moving window. */
export function rmsEnvelope(samples: ArrayLike<number>, window: number): Float64Array {
  const w = Math.max(1, Math.floor(window));
  const out = new Float64Array(Math.ceil(samples.length / w));
  for (let i = 0; i < out.length; i += 1) {
    const start = i * w;
    const end = Math.min(samples.length, start + w);
    let sum = 0;
    for (let k = start; k < end; k += 1) sum += samples[k]! * samples[k]!;
    out[i] = end > start ? Math.sqrt(sum / (end - start)) : 0;
  }
  return out;
}

/** One-sided spectrum in a convenient plain-object shape for drawing. */
export interface AcousticSpectrum {
  freqs: Float64Array;
  magnitude: Float64Array;
  nfft: number;
}

export function acousticSpectrum(samples: ArrayLike<number>, sampleRate: number, nfft = 8192): AcousticSpectrum {
  const r: SpectrumResult = spectrum(samples, sampleRate, 'hann', nfft);
  return { freqs: r.freqs, magnitude: r.magnitude, nfft: r.nfft };
}

/** Parse a waveform CSV: first column time (s, optional) and second amplitude. */
export function parseSampleCsv(text: string): SampleTable | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 4) return null;
  const split = (line: string): number[] => line.split(/[,\t; ]+/).map(Number).filter((v) => Number.isFinite(v));
  const first = split(lines[0]!);
  const hasHeader = first.length === 0 || /[a-z]/i.test(lines[0]!);
  const rows = lines.slice(hasHeader ? 1 : 0).map(split).filter((r) => r.length >= 1);
  if (rows.length < 4) return null;
  const hasTime = rows.every((r) => r.length >= 2);
  const times = hasTime ? rows.map((r) => r[0]!) : [];
  const values = rows.map((r) => (hasTime ? r[1]! : r[0]!));
  let sampleRate = 8000;
  if (hasTime && times.length > 1) {
    const diffs = times.slice(1).map((t, i) => t - times[i]!).filter((d) => d > 0);
    diffs.sort((a, b) => a - b);
    const dt = diffs[Math.floor(diffs.length / 2)] ?? 0;
    if (dt > 0 && dt < 1) sampleRate = Math.round(1 / dt);
  }
  const samples = new Float64Array(values);
  const peak = peakAmplitude(samples);
  if (peak > 1) for (let i = 0; i < samples.length; i += 1) samples[i] = samples[i]! / peak;
  return { sampleRate, samples };
}

export interface AcousticBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

/** Embedded validation suite against textbook formulae. */
export function runAcousticBenchmarks(): AcousticBenchmark[] {
  const axial = (speed: number, l: number): number => speed / (2 * l);
  const beat = beatRate(440, 445);
  const interference = interferenceAmplitude(1, 1, 180);
  const rt = sabineRt60(120, [{ area: 200, alpha: 0.2 }]);
  const mode = roomModes(6, 4, 3, 343, 60, 1).find((m) => m.nx === 1 && m.ny === 0 && m.nz === 0)?.freq ?? 0;
  const cases = [
    {
      id: 'axial-mode',
      labelEn: 'Axial mode f = c/2L (6 m, 343 m/s)',
      labelZh: '轴向模态 f = c/2L（6 m，343 m/s）',
      measured: mode,
      expected: axial(343, 6),
      tol: 1e-9,
    },
    {
      id: 'sabine',
      labelEn: 'Sabine RT60 = 0.161V/A (120 m³, 40 m² sabin)',
      labelZh: 'Sabine RT60 = 0.161V/A（120 m³，40 m² 吸声量）',
      measured: rt,
      expected: (0.161 * 120) / 40,
      tol: 1e-9,
    },
    {
      id: 'beat',
      labelEn: 'Beat rate |445 − 440| = 5 Hz',
      labelZh: '拍频 |445 − 440| = 5 Hz',
      measured: beat,
      expected: 5,
      tol: 1e-12,
    },
    {
      id: 'interference',
      labelEn: 'Equal anti-phase waves cancel (A = 0)',
      labelZh: '等幅反相波完全抵消（A = 0）',
      measured: interference,
      expected: 0,
      tol: 1e-12,
    },
    {
      id: 'wavelength',
      labelEn: '343 Hz wavelength = 1 m',
      labelZh: '343 Hz 波长 = 1 m',
      measured: wavelength(343, 343),
      expected: 1,
      tol: 1e-12,
    },
    {
      id: 'in-phase',
      labelEn: 'Equal in-phase waves double (A = 2)',
      labelZh: '等幅同相波叠加（A = 2）',
      measured: interferenceAmplitude(1, 1, 0),
      expected: 2,
      tol: 1e-12,
    },
    {
      id: 'decibel',
      labelEn: 'Amplitude 0.5 = −6.0206 dBFS',
      labelZh: '幅度 0.5 = −6.0206 dBFS',
      measured: toDb(0.5),
      expected: 20 * Math.log10(0.5),
      tol: 1e-9,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return { ...c, relErr, passed: relErr <= c.tol };
  });
}
