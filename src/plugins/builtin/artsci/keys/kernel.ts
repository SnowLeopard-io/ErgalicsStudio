// ==========================================================================
// keys kernel — pure, testable core for the keyboard performance plugin.
//
// Lives browser-free: note naming, two-octave keyboard layout, computer-key
// bindings, additive instrument timbres and a piecewise ADSR envelope used
// both by the live Web Audio voices (plugin.ts) and by unit tests.
// ==========================================================================

/** MIDI note number -> frequency (equal temperament, A4 = 440 Hz). */
export function noteFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Scientific pitch notation for a MIDI note number, e.g. 69 -> 'A4'. */
export function noteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]!;
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

// ---- Keyboard layout --------------------------------------------------------

/** Semitone offsets of the white keys within one octave (C-based). */
export const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/** Black-key semitone offsets within one octave and their white-key index
 * (positioned between whiteIndex and whiteIndex+1). */
export const BLACK_SEMITONES = [
  { semi: 1, whiteIndex: 0 },
  { semi: 3, whiteIndex: 1 },
  { semi: 6, whiteIndex: 3 },
  { semi: 8, whiteIndex: 4 },
  { semi: 10, whiteIndex: 5 },
] as const;

/** Standard DAW two-octave computer-key bindings (bottom octave ZXCV..,
 * top octave QWERTY row), semitone offsets from the base note C. */
export const KEY_BINDINGS: Record<string, number> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12,
  l: 13, '.': 14, ';': 15, '/': 16,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23, i: 24,
  '9': 25, o: 26, '0': 27, p: 28,
};

export interface PianoKey {
  midi: number;
  isBlack: boolean;
  /** White-key slot index (0..whiteCount-1); black keys sit between slots. */
  whiteIndex: number;
  /** Computer key that triggers this note, or undefined. */
  key?: string;
}

/** Build a piano layout spanning `octaves` octaves starting at baseMidi
 * (which must be a C). Whites first (ascending), then blacks — the renderer
 * draws whites as full slots and blacks between their white neighbours. */
export function buildKeyboard(baseMidi: number, octaves: number): PianoKey[] {
  const keys: PianoKey[] = [];
  let white = 0;
  for (let o = 0; o < octaves; o++) {
    for (const semi of WHITE_SEMITONES) {
      const midi = baseMidi + o * 12 + semi;
      keys.push({ midi, isBlack: false, whiteIndex: white, key: keyFor(midi - baseMidi) });
      white += 1;
    }
  }
  for (let o = 0; o < octaves; o++) {
    for (const b of BLACK_SEMITONES) {
      const midi = baseMidi + o * 12 + b.semi;
      keys.push({ midi, isBlack: true, whiteIndex: b.whiteIndex + o * 7, key: keyFor(midi - baseMidi) });
    }
  }
  return keys;
}

/** Preferred computer binding for a semitone offset: bottom-row keys cover
 * the lower octave plus the overlap notes, QWERTY row covers the upper one.
 * Object.entries preserves insertion order, so the first match wins. */
function keyFor(semi: number): string | undefined {
  for (const [k, v] of Object.entries(KEY_BINDINGS)) {
    if (v === semi) return k;
  }
  return undefined;
}

// ---- Instruments (additive timbres + envelope) -------------------------------

export interface InstrumentDef {
  id: InstrumentId;
  /** Additive harmonic series: partial frequency ratio and relative gain. */
  harmonics: Array<{ ratio: number; gain: number }>;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Vibrato LFO (Hz) and depth as a fraction of the note frequency. */
  vibratoRate: number;
  vibratoDepth: number;
  /** Low-pass filter cutoff as a multiple of the note frequency (0 = none). */
  filterScale: number;
}

export type InstrumentId = 'piano' | 'violin' | 'organ' | 'flute' | 'musicbox';

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  // Felt-hammer character: strong fundamental + odd partials, fast attack,
  // long exponential decay, no sustain plateau.
  piano: {
    id: 'piano',
    harmonics: [
      { ratio: 1, gain: 1.0 },
      { ratio: 2, gain: 0.45 },
      { ratio: 3, gain: 0.18 },
      { ratio: 4, gain: 0.1 },
      { ratio: 5, gain: 0.05 },
    ],
    attack: 0.005,
    decay: 1.6,
    sustain: 0.0,
    release: 0.25,
    vibratoRate: 0,
    vibratoDepth: 0,
    filterScale: 8,
  },
  // Bowed string: sawtooth-like series, slow attack, full sustain, vibrato.
  violin: {
    id: 'violin',
    harmonics: [
      { ratio: 1, gain: 1.0 },
      { ratio: 2, gain: 0.6 },
      { ratio: 3, gain: 0.4 },
      { ratio: 4, gain: 0.28 },
      { ratio: 5, gain: 0.2 },
      { ratio: 6, gain: 0.12 },
      { ratio: 7, gain: 0.08 },
    ],
    attack: 0.12,
    decay: 0.3,
    sustain: 0.85,
    release: 0.35,
    vibratoRate: 5.5,
    vibratoDepth: 0.006,
    filterScale: 6,
  },
  // Pipe organ: pure odd/even sine stops, instant on, holds forever.
  organ: {
    id: 'organ',
    harmonics: [
      { ratio: 1, gain: 1.0 },
      { ratio: 2, gain: 0.5 },
      { ratio: 3, gain: 0.35 },
      { ratio: 4, gain: 0.25 },
      { ratio: 8, gain: 0.1 },
    ],
    attack: 0.02,
    decay: 0.1,
    sustain: 1.0,
    release: 0.12,
    vibratoRate: 0,
    vibratoDepth: 0,
    filterScale: 0,
  },
  // Breath tone: near-sine with a faint second partial and a chiff attack.
  flute: {
    id: 'flute',
    harmonics: [
      { ratio: 1, gain: 1.0 },
      { ratio: 2, gain: 0.15 },
      { ratio: 3, gain: 0.04 },
    ],
    attack: 0.06,
    decay: 0.15,
    sustain: 0.8,
    release: 0.2,
    vibratoRate: 4.8,
    vibratoDepth: 0.004,
    filterScale: 5,
  },
  // Music box: bell-like inharmonic partials, plucked decay.
  musicbox: {
    id: 'musicbox',
    harmonics: [
      { ratio: 1, gain: 1.0 },
      { ratio: 2.76, gain: 0.5 },
      { ratio: 5.4, gain: 0.25 },
      { ratio: 8.93, gain: 0.12 },
    ],
    attack: 0.002,
    decay: 1.2,
    sustain: 0.0,
    release: 0.4,
    vibratoRate: 0,
    vibratoDepth: 0,
    filterScale: 0,
  },
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as InstrumentId[];

// ---- Envelope (piecewise-linear ADS with exponential-ish release) ------------

/** Normalised ADSR-style envelope value at time `t` seconds since note-on.
 * `gateEnd` is when the key was released (Infinity while held). Notes with
 * sustain 0 (piano/musicbox) decay towards zero during the gate. */
export function envelopeValue(inst: InstrumentDef, t: number, gateEnd: number): number {
  if (t < 0) return 0;
  const { attack, decay } = inst;
  // Percussive timbres (sustain = 0) decay to a small floor so the live
  // engine and this kernel share the same shape (avoids a hard zero cliff).
  const sustain = inst.sustain > 0 ? inst.sustain : 0.02;
  if (t < attack) return t / Math.max(attack, 1e-6);
  const held = Math.min(t, gateEnd);
  let v: number;
  if (held < attack + decay) {
    const d = (held - attack) / Math.max(decay, 1e-6);
    v = 1 - d * (1 - sustain);
  } else {
    v = sustain;
  }
  if (t > gateEnd) {
    const r = (t - gateEnd) / Math.max(inst.release, 1e-6);
    v *= Math.max(0, 1 - r);
  }
  return Math.max(0, Math.min(1, v));
}

// ---- Benchmarks --------------------------------------------------------------

export interface KeysBenchmark {
  key: string;
  label: string;
  value: string;
}

/** Deterministic kernel self-checks surfaced by the plugin's benchmark button. */
export function runKeysBenchmarks(): KeysBenchmark[] {
  const a4 = noteFrequency(69);
  const kb = buildKeyboard(60, 2);
  const whites = kb.filter((k) => !k.isBlack).length;
  const blacks = kb.filter((k) => k.isBlack).length;
  const piano = INSTRUMENTS.piano;
  const violin = INSTRUMENTS.violin;
  return [
    { key: 'note-a4', label: 'A4 frequency (440.00 Hz)', value: `${a4.toFixed(2)} Hz` },
    { key: 'note-c4', label: 'C4 frequency (261.63 Hz)', value: `${noteFrequency(60).toFixed(2)} Hz` },
    { key: 'layout', label: '2-octave layout (14 white / 10 black)', value: `${whites} / ${blacks}` },
    { key: 'bindings', label: 'Computer-key bindings', value: `${Object.keys(KEY_BINDINGS).length} keys` },
    { key: 'env-attack', label: 'Violin envelope at attack end (1.0)', value: envelopeValue(violin, violin.attack, Infinity).toFixed(3) },
    { key: 'env-sustain', label: 'Violin envelope at sustain (0.850)', value: envelopeValue(violin, violin.attack + violin.decay + 1, Infinity).toFixed(3) },
    { key: 'env-release', label: 'Piano envelope after release (0)', value: envelopeValue(piano, 2.5, 2.0).toFixed(3) },
  ];
}
