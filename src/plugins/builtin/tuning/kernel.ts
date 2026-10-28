// ==========================================================================
// Tuning System Calculator — pure kernel
//
// Frequency, ratio and cent arithmetic for 12-TET, 5-limit just intonation,
// Pythagorean tuning, quarter-comma meantone and Werckmeister III, plus
// MIDI note mapping and diatonic mode analysis. No DOM, no audio: everything
// here is directly unit-testable.
// ==========================================================================

export type TuningId = '12tet' | 'just' | 'pythagorean' | 'meantone' | 'werckmeister';

export interface TuningDef {
  id: TuningId;
  labelEn: string;
  labelZh: string;
  /** Width of one octave in cents (always 1200 here). */
  octaveCents: number;
  /** Chromatic ratios relative to the tonic; index 11 is the major seventh. */
  ratios: number[];
  /** Short historical note. */
  noteEn: string;
  noteZh: string;
}

const R = (n: number, d: number): number => n / d;
const ratioFromCents = (c: number): number => 2 ** (c / 1200);

// Quarter-comma meantone is generated from its exact definition: four fifths
// are narrowed by a quarter syntonic comma, so one fifth is 5^(1/4) = 696.578 ¢.
// Each chromatic degree is that many fifths away from the tonic, folded into
// one octave; keeping the derivation avoids rounding in the published cent table.
const MEANTONE_FIFTH_CENTS = 300 * Math.log2(5);
const MEANTONE_FIFTH_STEPS = [0, 7, 2, -3, 4, -1, 6, 1, 8, 3, -2, 5];
const foldOctave = (cents: number): number => cents - 1200 * Math.floor(cents / 1200);
const MEANTONE_CENTS = MEANTONE_FIFTH_STEPS.map((k) => foldOctave(k * MEANTONE_FIFTH_CENTS));
const WERCKMEISTER_CENTS = [0, 90.22, 192.18, 294.13, 390.22, 498.04, 588.27, 696.09, 792.18, 888.27, 996.09, 1092.18];

export const TUNINGS: Record<TuningId, TuningDef> = {
  '12tet': {
    id: '12tet',
    labelEn: '12-TET (equal temperament)',
    labelZh: '十二平均律（12-TET）',
    octaveCents: 1200,
    ratios: Array.from({ length: 12 }, (_, k) => ratioFromCents(100 * k)),
    noteEn: 'Every semitone is exactly 100 cents; all keys are equivalent, at the cost of pure thirds and fifths.',
    noteZh: '每个半音恰为 100 音分，各调等价；代价是三度和五度不再纯正。',
  },
  just: {
    id: 'just',
    labelEn: '5-limit just intonation',
    labelZh: '五限纯律',
    octaveCents: 1200,
    ratios: [
      1,
      R(16, 15),
      R(9, 8),
      R(6, 5),
      R(5, 4),
      R(4, 3),
      R(45, 32),
      R(3, 2),
      R(8, 5),
      R(5, 3),
      R(9, 5),
      R(15, 8),
    ],
    noteEn: 'Pure 5/4 major thirds and 3/2 fifths; the syntonic comma (81/80, 21.51 ¢) has to be absorbed somewhere.',
    noteZh: '纯 5/4 大三度与 3/2 纯五度；81/80 的舌尖音差（21.51 音分）必须被某处吸收。',
  },
  pythagorean: {
    id: 'pythagorean',
    labelEn: 'Pythagorean tuning',
    labelZh: '毕达哥拉斯律',
    octaveCents: 1200,
    ratios: [
      1,
      R(256, 243),
      R(9, 8),
      R(32, 27),
      R(81, 64),
      R(4, 3),
      R(729, 512),
      R(3, 2),
      R(128, 81),
      R(27, 16),
      R(16, 9),
      R(243, 128),
    ],
    noteEn: 'Stacked pure 3/2 fifths; wolf fifth (729/512 diminished sixth) between G♯ and E♭.',
    noteZh: '连续叠置纯 3/2 五度；G♯ 与 E♭ 之间留下 729/512 的“狼五度”。',
  },
  meantone: {
    id: 'meantone',
    labelEn: 'Quarter-comma meantone',
    labelZh: '四分之一音差中全律',
    octaveCents: 1200,
    ratios: MEANTONE_CENTS.map(ratioFromCents),
    noteEn: 'Four fifths are narrowed by a quarter syntonic comma so that the major third is exactly 5/4.',
    noteZh: '每个五度收窄四分之一舌尖音差，使大三度恰为纯 5/4。',
  },
  werckmeister: {
    id: 'werckmeister',
    labelEn: 'Werckmeister III well temperament',
    labelZh: '韦克迈斯特 III 良好律',
    octaveCents: 1200,
    ratios: WERCKMEISTER_CENTS.map(ratioFromCents),
    noteEn: 'A circulating well temperament (1691): all keys usable, each with a distinct colour.',
    noteZh: '1691 年的循环良好律：所有调都可演奏，但每个调色彩不同。',
  },
};

export const TUNING_IDS = Object.keys(TUNINGS) as TuningId[];

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Equal-tempered MIDI → frequency with configurable A4 (default 440 Hz). */
export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

/** Frequency → fractional MIDI number (inverse of `midiToFreq`). */
export function freqToMidi(freq: number, a4 = 440): number {
  if (!(freq > 0)) return Number.NaN;
  return 69 + 12 * Math.log2(freq / a4);
}

/** Scientific pitch name for a MIDI note, e.g. 69 → "A4". */
export function noteName(midi: number): string {
  const round = Math.round(midi);
  const pc = ((round % 12) + 12) % 12;
  return `${NOTE_NAMES[pc]}${Math.floor(round / 12) - 1}`;
}

/** Signed interval in cents from f1 to f2 (positive = f2 higher). */
export function centsBetween(f1: number, f2: number): number {
  if (!(f1 > 0) || !(f2 > 0)) return Number.NaN;
  return 1200 * Math.log2(f2 / f1);
}

/** Ratio → cents. */
export function ratioToCents(ratio: number): number {
  return 1200 * Math.log2(ratio);
}

/** Cents → ratio. */
export function centsToRatio(cents: number): number {
  return 2 ** (cents / 1200);
}

/** Approximate a decimal ratio as p/q with q ≤ maxDenominator. */
export function ratioLabel(ratio: number, maxDenominator = 64): string {
  if (!(ratio > 0)) return '—';
  let bestN = 1;
  let bestD = 1;
  let bestErr = Math.abs(ratio - 1);
  for (let d = 1; d <= maxDenominator; d += 1) {
    const n = Math.round(ratio * d);
    if (n < 1) continue;
    const err = Math.abs(ratio - n / d);
    if (err < bestErr) {
      bestErr = err;
      bestN = n;
      bestD = d;
    }
  }
  return bestN === bestD ? '1/1' : `${bestN}/${bestD}`;
}

export interface TuningRow {
  /** Chromatic degree 0…11 above the tonic. */
  degree: number;
  note: string;
  /** Ratio to the tonic. */
  ratio: number;
  /** Approximate p/q spelling. */
  ratioLabel: string;
  /** Frequency in Hz. */
  freq: number;
  /** Interval above the tonic in cents. */
  cents: number;
  /** Deviation from 12-TET in cents (negative = flat). */
  devCents: number;
}

export interface TuningScale {
  tuning: TuningDef;
  tonicMidi: number;
  tonicName: string;
  tonicFreq: number;
  a4: number;
  rows: TuningRow[];
  /** Beat frequency against equal temperament for each degree (Hz). */
  beats: number[];
}

/** Build the 12 chromatic degrees of `tuningId` on `tonicMidi`. */
export function tuningScale(tuningId: TuningId, tonicMidi = 60, a4 = 440): TuningScale {
  const tuning = TUNINGS[tuningId] ?? TUNINGS['12tet'];
  const tonicFreq = midiToFreq(tonicMidi, a4);
  const rows: TuningRow[] = [];
  const beats: number[] = [];
  for (let degree = 0; degree < 12; degree += 1) {
    const ratio = tuning.ratios[degree]!;
    const freq = tonicFreq * ratio;
    const cents = ratioToCents(ratio);
    const tet = tonicFreq * 2 ** (degree / 12);
    rows.push({
      degree,
      note: noteName(tonicMidi + degree),
      ratio,
      ratioLabel: ratioLabel(ratio),
      freq,
      cents,
      devCents: cents - degree * 100,
    });
    beats.push(Math.abs(freq - tet));
  }
  return { tuning, tonicMidi, tonicName: noteName(tonicMidi), tonicFreq, a4, rows, beats };
}

export type ModeId = 'ionian' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'aeolian' | 'locrian';

export interface ModeDef {
  id: ModeId;
  labelEn: string;
  labelZh: string;
  /** Semitone offsets of the seven scale degrees. */
  steps: number[];
}

export const MODES: Record<ModeId, ModeDef> = {
  ionian: { id: 'ionian', labelEn: 'Ionian (major)', labelZh: '伊奥尼亚（大调）', steps: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { id: 'dorian', labelEn: 'Dorian', labelZh: '多利亚', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { id: 'phrygian', labelEn: 'Phrygian', labelZh: '弗里吉亚', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { id: 'lydian', labelEn: 'Lydian', labelZh: '利底亚', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { id: 'mixolydian', labelEn: 'Mixolydian', labelZh: '混合利底亚', steps: [0, 2, 4, 5, 7, 9, 10] },
  aeolian: { id: 'aeolian', labelEn: 'Aeolian (natural minor)', labelZh: '爱奥利亚（自然小调）', steps: [0, 2, 3, 5, 7, 8, 10] },
  locrian: { id: 'locrian', labelEn: 'Locrian', labelZh: '洛克里亚', steps: [0, 1, 3, 5, 6, 8, 10] },
};

export const MODE_IDS = Object.keys(MODES) as ModeId[];

export interface ModeRow {
  /** Scale step 1…7 (1 = tonic). */
  step: number;
  note: string;
  freq: number;
  cents: number;
  /** Interval from the previous degree in cents. */
  stepCents: number;
  ratioLabel: string;
}

/** Seven-note mode on a tonic, using the chosen tuning's chromatic ratios. */
export function modeScale(modeId: ModeId, tuningId: TuningId, tonicMidi = 60, a4 = 440): ModeRow[] {
  const mode = MODES[modeId] ?? MODES.ionian;
  const scale = tuningScale(tuningId, tonicMidi, a4);
  let prev = 0;
  return mode.steps.map((step, i) => {
    const chromatic = scale.rows[step]!;
    const cents = chromatic.cents;
    const out: ModeRow = {
      step: i + 1,
      note: chromatic.note,
      freq: chromatic.freq,
      cents,
      stepCents: cents - prev,
      ratioLabel: chromatic.ratioLabel,
    };
    prev = cents;
    return out;
  });
}

export interface TuningBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

/** Embedded validation suite with textbook reference values (cents). */
export function runTuningBenchmarks(): TuningBenchmark[] {
  const cases: Array<{
    id: string;
    labelEn: string;
    labelZh: string;
    measured: number;
    expected: number;
    tol: number;
  }> = [
    {
      id: 'octave',
      labelEn: 'Octave = 1200 ¢',
      labelZh: '八度 = 1200 音分',
      measured: ratioToCents(2),
      expected: 1200,
      tol: 1e-9,
    },
    {
      id: '12tet-semitone',
      labelEn: '12-TET semitone = 100 ¢',
      labelZh: '12-TET 半音 = 100 音分',
      measured: centsBetween(midiToFreq(60), midiToFreq(61)),
      expected: 100,
      tol: 1e-9,
    },
    {
      id: 'just-fifth',
      labelEn: 'Just fifth (3/2) = 701.955 ¢',
      labelZh: '纯五度 (3/2) = 701.955 音分',
      measured: ratioToCents(3 / 2),
      expected: 701.9550008653874,
      tol: 1e-9,
    },
    {
      id: 'syntonic-comma',
      labelEn: 'Syntonic comma 81/80 = 21.506 ¢',
      labelZh: '舌尖音差 81/80 = 21.506 音分',
      measured: ratioToCents(81 / 80),
      expected: 21.506289596714777,
      tol: 1e-9,
    },
    {
      id: 'pythagorean-comma',
      labelEn: 'Pythagorean comma 531441/524288 = 23.460 ¢',
      labelZh: '毕氏音差 531441/524288 = 23.460 音分',
      measured: ratioToCents(531441 / 524288),
      expected: 23.460010384649043,
      tol: 1e-9,
    },
    {
      id: 'meantone-fifth',
      labelEn: 'Quarter-comma meantone fifth = 696.578 ¢',
      labelZh: '中全律五度 = 696.578 音分',
      measured: ratioToCents(TUNINGS.meantone.ratios[7]!),
      expected: 696.5784284662087,
      tol: 1e-9,
    },
    {
      id: 'werckmeister-fifth',
      labelEn: 'Werckmeister III C–G = 696.09 ¢',
      labelZh: '韦克迈斯特 III C–G = 696.09 音分',
      measured: ratioToCents(TUNINGS.werckmeister.ratios[7]!),
      expected: 696.09,
      tol: 1e-6,
    },
    {
      id: 'midi-a4',
      labelEn: 'MIDI 69 = 440 Hz',
      labelZh: 'MIDI 69 = 440 Hz',
      measured: midiToFreq(69),
      expected: 440,
      tol: 1e-12,
    },
    {
      id: 'freq-roundtrip',
      labelEn: 'MIDI → Hz → MIDI round-trip',
      labelZh: 'MIDI → Hz → MIDI 往返',
      measured: Math.abs(freqToMidi(midiToFreq(57, 442), 442) - 57),
      expected: 0,
      tol: 1e-9,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return { ...c, relErr, passed: relErr <= c.tol };
  });
}

export interface TuningCsvRow {
  degree: number;
  name: string;
  ratio: number;
  cents: number;
}

/** Parse a tuning CSV with columns degree/name/ratio/cents (header optional). */
export function parseTuningCsv(text: string): TuningCsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) return [];
  const cells = (line: string): string[] => line.split(/[,\t;]/).map((s) => s.trim());
  const head = cells(lines[0]!);
  const hasHeader = head.some((h) => /ratio|cent|degree|name/i.test(h));
  const idx = (name: string, fallback: number): number => {
    const i = head.findIndex((h) => h.toLowerCase() === name);
    return i >= 0 ? i : fallback;
  };
  const iDegree = hasHeader ? idx('degree', 0) : 0;
  const iName = hasHeader ? idx('name', 1) : 1;
  const iRatio = hasHeader ? idx('ratio', 2) : 2;
  const iCents = hasHeader ? idx('cents', 3) : 3;
  const out: TuningCsvRow[] = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i += 1) {
    const c = cells(lines[i]!);
    const degree = Number(c[iDegree]);
    const ratio = Number(c[iRatio]);
    const cents = Number(c[iCents]);
    if (!Number.isFinite(degree)) continue;
    const centsVal = Number.isFinite(cents) ? cents : Number.isFinite(ratio) ? ratioToCents(ratio) : 0;
    const ratioVal = Number.isFinite(ratio) && ratio > 0 ? ratio : centsToRatio(centsVal);
    out.push({ degree, name: c[iName] ?? `${degree}`, ratio: ratioVal, cents: centsVal });
  }
  return out;
}

/** Beat frequency (Hz) between two sustained partials. */
export function beatFrequency(f1: number, f2: number): number {
  return Math.abs(f1 - f2);
}
