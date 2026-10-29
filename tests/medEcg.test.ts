// med-ecg kernel validation: Pan-Tompkins R-peak detection on synthetic
// P-QRS-T signals, hand-computed HRV statistics, rhythm-screening threshold
// boundaries, and text-table / WFDB header parsing (plus the bundled example
// CSV records).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyRhythm,
  detectRPeaks,
  hrvTimeStats,
  isPvcRule,
  parseEcgTable,
  parseHeaHeader,
  type RhythmInput,
} from '../src/plugins/builtin/med/ecg/ecg';

/** Gaussian bump centred at `mu` with width `sigma` (seconds). */
function gauss(t: number, mu: number, sigma: number): number {
  const d = t - mu;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

/** Synthesize a clean single-lead ECG: P wave, QRS complex and T per beat. */
function synthEcg(fs: number, seconds: number, rTimes: number[]): Float64Array {
  const n = Math.round(fs * seconds);
  const out = new Float64Array(n);
  for (const rT of rTimes) {
    for (let i = 0; i < n; i += 1) {
      const t = i / fs;
      out[i] = out[i]! +
        1.2 * gauss(t, rT, 0.012) + // R spike (QRS)
        0.25 * gauss(t, rT + 0.32, 0.04) + // T wave
        0.12 * gauss(t, rT - 0.15, 0.025); // P wave
    }
  }
  return out;
}

describe('med-ecg Pan-Tompkins R-peak detection', () => {
  // 12 beats at 75 bpm (0.8 s RR) starting at t = 0.5 s in a 10 s record.
  const TRUE_R = Array.from({ length: 12 }, (_, k) => 0.5 + 0.8 * k);

  it('finds all 12 synthetic R peaks at 500 Hz within 50 ms of the truth', () => {
    const fs = 500;
    const sig = synthEcg(fs, 10, TRUE_R);
    const peaks = detectRPeaks(sig, fs);
    expect(peaks).toHaveLength(12);
    for (let k = 0; k < peaks.length; k += 1) {
      expect(peaks[k]! / fs).toBeCloseTo(TRUE_R[k]!, 1); // within 0.05 s
    }
    // Ascending order and physiologic refractory distance (>= 250 ms).
    for (let i = 1; i < peaks.length; i += 1) {
      expect(peaks[i]! - peaks[i - 1]!).toBeGreaterThanOrEqual(0.25 * fs);
    }
  });

  it('keeps working at 250 Hz sampling (>= 11 of 12 beats, positions matched)', () => {
    const fs = 250;
    const sig = synthEcg(fs, 10, TRUE_R);
    const peaks = detectRPeaks(sig, fs);
    expect(peaks.length).toBeGreaterThanOrEqual(11);
    for (const p of peaks) {
      const nearest = TRUE_R.reduce((best, r) =>
        Math.abs(p / fs - r) < Math.abs(p / fs - best) ? r : best,
      );
      expect(Math.abs(p / fs - nearest)).toBeLessThan(0.06);
    }
  });

  it('returns no peaks for a signal shorter than one second', () => {
    expect(detectRPeaks(new Float64Array(100), 500)).toEqual([]);
    expect(detectRPeaks(new Float64Array(0), 500)).toEqual([]);
  });
});

describe('med-ecg time-domain HRV (hand-computed)', () => {
  it('SDNN / RMSSD / pNN50 match the textbook computation for a fixed RR series', () => {
    // mean 800; squared deviations sum to 1200 -> SDNN = sqrt(1200/9) = 11.547
    // successive diffs squared sum to 3600 -> RMSSD = sqrt(3600/9) = 20.000
    const rr = [800, 810, 790, 800, 820, 780, 800, 790, 810, 800];
    const s = hrvTimeStats(rr);
    expect(s.nIntervals).toBe(10);
    expect(s.meanRrMs).toBeCloseTo(800, 9);
    expect(s.sdnnMs).toBeCloseTo(Math.sqrt(1200 / 9), 9);
    expect(s.rmssdMs).toBeCloseTo(20, 9);
    expect(s.pnn50).toBe(0);
    expect(s.minRrMs).toBe(780);
    expect(s.maxRrMs).toBe(820);
    expect(s.meanHrBpm).toBeCloseTo(75, 9);
  });

  it('pNN50 counts differences over 50 ms and non-positive values are dropped', () => {
    // diffs: +60, -60, +10, -70 -> 3 of 4 exceed 50 ms -> pnn50 = 0.75
    const s = hrvTimeStats([800, 860, 800, 810, 740, Number.NaN, 0, -5]);
    expect(s.nIntervals).toBe(5);
    expect(s.pnn50).toBeCloseTo(0.75, 9);
    expect(s.rmssdMs).toBeCloseTo(Math.sqrt((3600 + 3600 + 100 + 4900) / 4), 9);
    expect(s.meanHrBpm).toBeCloseTo(60000 / 802, 9);
  });

  it('degenerate series yield zeroed statistics', () => {
    const empty = hrvTimeStats([]);
    expect(empty.nIntervals).toBe(0);
    expect(empty.sdnnMs).toBe(0);
    expect(empty.rmssdMs).toBe(0);
    const single = hrvTimeStats([900]);
    expect(single.nIntervals).toBe(1);
    expect(single.sdnnMs).toBe(0);
    expect(single.rmssdMs).toBe(0);
    expect(single.meanHrBpm).toBeCloseTo(60000 / 900, 9);
  });
});

describe('med-ecg rhythm screening thresholds', () => {
  const BASE: RhythmInput = {
    meanHrBpm: 75,
    meanRrMs: 800,
    rmssdMs: 20,
    pWaveRate: 0.9,
    pvcCount: 0,
    nBeats: 10,
  };

  it('60 and 100 bpm are the inclusive normal limits', () => {
    expect(classifyRhythm(BASE).conclusion).toBe('sinus rhythm');
    const at60 = classifyRhythm({ ...BASE, meanHrBpm: 60 });
    expect(at60.conclusion).toBe('sinus rhythm');
    expect(at60.brady).toBe(false);
    const justBelow = classifyRhythm({ ...BASE, meanHrBpm: 59.9 });
    expect(justBelow.conclusion).toBe('sinus bradycardia');
    expect(justBelow.severity).toBe('warn');
    const at100 = classifyRhythm({ ...BASE, meanHrBpm: 100 });
    expect(at100.conclusion).toBe('sinus rhythm');
    expect(at100.tachy).toBe(false);
    const justAbove = classifyRhythm({ ...BASE, meanHrBpm: 100.1 });
    expect(justAbove.conclusion).toBe('sinus tachycardia');
    expect(justAbove.tachy).toBe(true);
  });

  it('flags suspected AFib only when irregular, P-wave-poor and long enough', () => {
    const afib = classifyRhythm({ ...BASE, rmssdMs: 120, pWaveRate: 0.3, pvcCount: 2 });
    expect(afib.conclusion).toBe('suspected AFib');
    expect(afib.conclusionZh).toBe('疑似心房颤动');
    expect(afib.severity).toBe('warn');
    expect(afib.afibSuspect).toBe(true);
    // Exactly 0.1 RMSSD/mean or 50% P waves or 3 beats: no AFib flag.
    expect(classifyRhythm({ ...BASE, rmssdMs: 80, pWaveRate: 0.3 }).afibSuspect).toBe(false);
    expect(classifyRhythm({ ...BASE, rmssdMs: 120, pWaveRate: 0.5 }).afibSuspect).toBe(false);
    expect(
      classifyRhythm({ ...BASE, rmssdMs: 120, pWaveRate: 0.3, nBeats: 3 }).afibSuspect,
    ).toBe(false);
  });

  it('reports PVCs ahead of rate abnormalities but below AFib', () => {
    const pvc = classifyRhythm({ ...BASE, pvcCount: 1, meanHrBpm: 120 });
    expect(pvc.conclusion).toBe('sinus rhythm with PVCs');
    expect(pvc.conclusionZh).toBe('窦性心律伴室性早搏');
    expect(pvc.tachy).toBe(true);
    expect(pvc.severity).toBe('warn');
    // AFib outranks PVC reporting.
    const both = classifyRhythm({ ...BASE, pvcCount: 3, rmssdMs: 130, pWaveRate: 0.1 });
    expect(both.conclusion).toBe('suspected AFib');
  });

  it('isPvcRule: wide QRS + early arrival + compensatory pause, all strict', () => {
    const med = 800;
    expect(isPvcRule(140, 700, 950, med)).toBe(true);
    // QRS duration must exceed 120 ms.
    expect(isPvcRule(120, 700, 950, med)).toBe(false);
    expect(isPvcRule(121, 700, 950, med)).toBe(true);
    // Previous RR must be < 0.9 x median (720 ms here).
    expect(isPvcRule(140, 720, 950, med)).toBe(false);
    expect(isPvcRule(140, 719, 950, med)).toBe(true);
    // Next RR must be > 1.15 x median (920 ms here; note 920 itself sits on a
    // float edge because 800 * 1.15 evaluates to 919.9999999999999).
    expect(isPvcRule(140, 700, 919, med)).toBe(false);
    expect(isPvcRule(140, 700, 921, med)).toBe(true);
    // Non-positive intervals make the rule abstain.
    expect(isPvcRule(140, 0, 950, med)).toBe(false);
    expect(isPvcRule(140, 700, 950, 0)).toBe(false);
  });
});

describe('med-ecg table parsing (parseEcgTable)', () => {
  it('parses a headered CSV with a time column and derives fs from the step', () => {
    const csv = [
      'time(s),II,V5',
      '0.000,0.10,0.05',
      '0.002,0.12,0.06',
      '0.004,0.11,0.04',
      '0.006,0.09,0.03',
      '0.008,0.08,0.02',
    ].join('\n');
    const t = parseEcgTable(csv);
    expect(t).not.toBeNull();
    expect(t!.leadNames).toEqual(['II', 'V5']);
    expect(t!.leads).toHaveLength(2);
    expect(t!.fs).toBe(500);
    expect(t!.hasTime).toBe(true);
    expect(t!.leads[0]![0]).toBeCloseTo(0.1, 10);
    expect(t!.leads[1]![2]).toBeCloseTo(0.04, 10);
  });

  it('detects a headerless monotone first column as the time axis', () => {
    const csv = '0,1.0\n0.002,1.1\n0.004,0.9\n0.006,1.2\n0.008,1.0';
    const t = parseEcgTable(csv);
    expect(t).not.toBeNull();
    expect(t!.leadNames).toEqual(['lead1']);
    expect(t!.fs).toBe(500);
    expect(t!.hasTime).toBe(true);
  });

  it('single-column whitespace text yields one lead at the default rate', () => {
    const t = parseEcgTable('1.5\n2.0\n3.5\n2.0\n1.0');
    expect(t).not.toBeNull();
    expect(t!.leadNames).toEqual(['lead1']);
    expect(t!.leads).toHaveLength(1);
    expect(t!.leads[0]).toHaveLength(5);
    expect(t!.fs).toBe(500);
    expect(t!.hasTime).toBe(false);
  });

  it('honours a # fs hint when the time grid is outside the 1-5000 Hz band', () => {
    // Time in milliseconds: the derived estimate (0.25 Hz) is out of band, so
    // the comment hint wins.
    const csv = [
      '# fs: 250',
      'time(ms),II',
      '0,1',
      '4,2',
      '8,3',
      '12,4',
      '16,5',
      '20,6',
    ].join('\n');
    const t = parseEcgTable(csv);
    expect(t).not.toBeNull();
    expect(t!.fs).toBe(250);
    expect(t!.hasTime).toBe(true);
    expect(t!.leadNames).toEqual(['II']);
  });

  it('rejects empty or non-numeric input', () => {
    expect(parseEcgTable('')).toBeNull();
    expect(parseEcgTable('# only a comment\n')).toBeNull();
    expect(parseEcgTable('foo bar\nbaz qux\n')).toBeNull();
  });
});

describe('med-ecg WFDB header parsing (parseHeaHeader)', () => {
  it('reads the traditional gain/baseline column pair and skips metadata', () => {
    const hea = [
      'rec100 2 360 650000',
      'rec100.dat 16 200 1024 12 0 -221 950 974 ECG lead II',
      'rec100.dat 16 175 1024 12 0 -221 1013 1020 ECG lead V1',
    ].join('\n');
    const h = parseHeaHeader(hea);
    expect(h).not.toBeNull();
    expect(h!.name).toBe('rec100');
    expect(h!.nsig).toBe(2);
    expect(h!.fs).toBe(360);
    expect(h!.nsamp).toBe(650000);
    expect(h!.datFile).toBe('rec100.dat');
    expect(h!.formats).toEqual(['16', '16']);
    expect(h!.gains).toEqual([200, 175]);
    expect(h!.baselines).toEqual([1024, 1024]);
    expect(h!.units).toEqual(['mV', 'mV']);
    expect(h!.sigNames).toEqual(['ECG lead II', 'ECG lead V1']);
  });

  it('reads the inline gain(baseline)/units form', () => {
    const hea = ['recA 1 250 5000', 'recA.dat 16 200(1024)/mV ECG II'].join('\n');
    const h = parseHeaHeader(hea);
    expect(h).not.toBeNull();
    expect(h!.nsig).toBe(1);
    expect(h!.fs).toBe(250);
    expect(h!.nsamp).toBe(5000);
    expect(h!.gains).toEqual([200]);
    expect(h!.baselines).toEqual([1024]);
    expect(h!.units).toEqual(['mV']);
    expect(h!.sigNames).toEqual(['ECG II']);
  });

  it('rejects malformed headers', () => {
    expect(parseHeaHeader('')).toBeNull();
    expect(parseHeaHeader('# comment only\n')).toBeNull();
    expect(parseHeaHeader('rec 2')).toBeNull(); // fewer than 3 header tokens
    expect(parseHeaHeader('rec 0 360 x')).toBeNull(); // nsig <= 0
    expect(parseHeaHeader('rec 2 abc x')).toBeNull(); // fs not a number
  });

  it('tolerates a header line without signal lines (empty signal arrays)', () => {
    const h = parseHeaHeader('rec 2 360');
    expect(h).not.toBeNull();
    expect(h!.nsig).toBe(2);
    expect(h!.fs).toBe(360);
    expect(h!.formats).toEqual([]);
    expect(h!.gains).toEqual([]);
    expect(h!.sigNames).toEqual([]);
  });
});

// ---- bundled example records ------------------------------------------------

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
function readExample(name: string): string {
  return readFileSync(`${ROOT}examples/data/${name}`, 'utf8');
}

describe('med-ecg example CSV intake (bundled data)', () => {
  const CASES = [
    { file: 'med-ecg-sinus.csv', samples: 5000 },
    { file: 'med-ecg-afib.csv', samples: 5000 },
    { file: 'med-ecg-pvc.csv', samples: 5000 },
  ];

  for (const c of CASES) {
    it(`parses ${c.file} as one lead_II channel at 500 Hz over 10 s`, () => {
      const t = parseEcgTable(readExample(c.file));
      expect(t).not.toBeNull();
      expect(t!.leadNames).toEqual(['lead_II']);
      expect(t!.leads).toHaveLength(1);
      expect(t!.leads[0]).toHaveLength(c.samples);
      expect(t!.fs).toBe(500);
      expect(t!.hasTime).toBe(true);
      expect(t!.leads[0]!.every((v) => Number.isFinite(v))).toBe(true);
    });
  }

  it('detects beats on the bundled sinus record (end-to-end sanity)', () => {
    const t = parseEcgTable(readExample('med-ecg-sinus.csv'))!;
    const peaks = detectRPeaks(t.leads[0]!, t.fs);
    expect(peaks.length).toBeGreaterThanOrEqual(8);
    const rr = peaks.slice(1).map((p, i) => ((p - peaks[i]!) / t.fs) * 1000);
    const stats = hrvTimeStats(rr);
    expect(stats.meanHrBpm).toBeGreaterThan(40);
    expect(stats.meanHrBpm).toBeLessThan(120);
  });
});
