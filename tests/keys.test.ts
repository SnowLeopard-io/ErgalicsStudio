import { describe, expect, it } from 'vitest';
import {
  BLACK_SEMITONES,
  INSTRUMENTS,
  INSTRUMENT_IDS,
  KEY_BINDINGS,
  WHITE_SEMITONES,
  buildKeyboard,
  envelopeValue,
  noteFrequency,
  noteName,
  runKeysBenchmarks,
} from '@/plugins/builtin/artsci/keys/kernel';

describe('keys kernel — note math', () => {
  it('uses equal temperament with A4 = 440 Hz', () => {
    expect(noteFrequency(69)).toBeCloseTo(440, 6);
    expect(noteFrequency(60)).toBeCloseTo(261.6256, 3);
    expect(noteFrequency(81)).toBeCloseTo(880, 4);
  });

  it('names notes in scientific pitch notation', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(48)).toBe('C3');
  });
});

describe('keys kernel — keyboard layout', () => {
  it('builds 14 white + 10 black keys over two octaves', () => {
    const kb = buildKeyboard(60, 2);
    expect(kb.filter((k) => !k.isBlack)).toHaveLength(14);
    expect(kb.filter((k) => k.isBlack)).toHaveLength(10);
    expect(kb[0]!.midi).toBe(60);
    expect(kb[7]!.midi).toBe(72); // first white of the second octave = C5
  });

  it('places black keys between the correct white slots', () => {
    const kb = buildKeyboard(60, 1);
    const black = kb.filter((k) => k.isBlack);
    expect(black.map((k) => k.midi)).toEqual([61, 63, 66, 68, 70]);
    expect(black.map((k) => k.whiteIndex)).toEqual(
      BLACK_SEMITONES.map((b) => b.whiteIndex),
    );
  });

  it('every key in range has a computer binding', () => {
    const kb = buildKeyboard(60, 2);
    for (const k of kb) expect(k.key).toBeDefined();
  });

  it('bindings are unique and cover all chromatic semitones 0..24+', () => {
    const semis = new Set(Object.values(KEY_BINDINGS));
    for (let s = 0; s <= 24; s++) expect(semis.has(s)).toBe(true);
    const keys = [...Object.keys(KEY_BINDINGS)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('black semitone offsets match the octave structure', () => {
    expect([...WHITE_SEMITONES]).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(BLACK_SEMITONES.map((b) => b.semi)).toEqual([1, 3, 6, 8, 10]);
  });
});

describe('keys kernel — instruments and envelope', () => {
  it('defines five instruments with valid envelopes', () => {
    expect(INSTRUMENT_IDS).toHaveLength(5);
    for (const id of INSTRUMENT_IDS) {
      const inst = INSTRUMENTS[id]!;
      expect(inst.attack).toBeGreaterThan(0);
      expect(inst.decay).toBeGreaterThan(0);
      expect(inst.release).toBeGreaterThan(0);
      expect(inst.sustain).toBeGreaterThanOrEqual(0);
      expect(inst.sustain).toBeLessThanOrEqual(1);
      expect(inst.harmonics.length).toBeGreaterThan(0);
      expect(inst.harmonics[0]!.ratio).toBe(1);
    }
  });

  it('piano and musicbox decay to silence (sustain 0)', () => {
    expect(INSTRUMENTS.piano!.sustain).toBe(0);
    expect(INSTRUMENTS.musicbox!.sustain).toBe(0);
  });

  it('envelope ramps linearly through the attack', () => {
    const inst = INSTRUMENTS.violin!;
    expect(envelopeValue(inst, 0, Infinity)).toBe(0);
    expect(envelopeValue(inst, inst.attack / 2, Infinity)).toBeCloseTo(0.5, 5);
    expect(envelopeValue(inst, inst.attack, Infinity)).toBeCloseTo(1, 5);
  });

  it('envelope decays from peak to sustain during the decay phase', () => {
    const inst = INSTRUMENTS.violin!;
    const mid = inst.attack + inst.decay / 2;
    const v = envelopeValue(inst, mid, Infinity);
    expect(v).toBeGreaterThan(inst.sustain);
    expect(v).toBeLessThan(1);
    expect(envelopeValue(inst, inst.attack + inst.decay + 1, Infinity)).toBeCloseTo(inst.sustain, 5);
  });

  it('held percussive notes decay towards zero, then release cuts to zero', () => {
    const piano = INSTRUMENTS.piano!;
    const late = envelopeValue(piano, piano.attack + piano.decay * 3, Infinity);
    expect(late).toBeCloseTo(0.02, 5);
    expect(envelopeValue(piano, 2.5, 2.0)).toBe(0); // after release ends
  });

  it('release fades linearly to zero over the release time', () => {
    const inst = INSTRUMENTS.organ!;
    const gate = 1;
    const half = envelopeValue(inst, gate + inst.release / 2, gate);
    expect(half).toBeCloseTo(inst.sustain / 2, 5);
    expect(envelopeValue(inst, gate + inst.release, gate)).toBe(0);
  });

  it('envelope never exceeds [0, 1]', () => {
    const inst = INSTRUMENTS.violin!;
    for (let t = 0; t < 3; t += 0.01) {
      const v = envelopeValue(inst, t, 1.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('keys kernel — benchmarks', () => {
  it('runs deterministic self-checks', () => {
    const bench = runKeysBenchmarks();
    expect(bench.length).toBeGreaterThanOrEqual(5);
    expect(bench.find((b) => b.key === 'note-a4')!.value).toContain('440.00');
    expect(bench.find((b) => b.key === 'layout')!.value).toBe('14 / 10');
    // Same output on a second run (pure function).
    expect(runKeysBenchmarks()).toEqual(bench);
  });
});
