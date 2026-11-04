import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aeSignalTable,
  binaryTwoGroup,
  chi2_2x2,
  equalInformationFractions,
  fisherExact2x2,
  generateRandomization,
  obfSpending,
  parseAeCsv,
  parseStrataSpec,
  parseTrialCsv,
  pocockSpending,
  sampleSizeForPower,
  sequentialBoundaries,
  valuesByArm,
  welchTwoSample,
} from '../src/plugins/builtin/med/biostat/stats';

// Tolerances: closed-form textbook values are matched to 4-5 digits; the
// sequential-boundary recursion is matched to ~0.01-0.05 (grid integration).

const Z975 = 1.959963984540054;
const Z90 = 1.2815515655446004;
const Z80 = 0.8416212335729143;
const Z95 = 1.6448536269514722;

describe('med-biostat sample size (textbook closed forms)', () => {
  it('two proportions, superiority: p1=0.85 p2=0.65 a=0.05 power=0.90 -> 96.41/97 per group', () => {
    const res = sampleSizeForPower({
      objective: 'superiority',
      endpoint: 'proportions',
      alpha: 0.05,
      power: 0.9,
      sigma: 1,
      delta: 0,
      margin: 0,
      p1: 0.85,
      p2: 0.65,
      ratio: 1,
    });
    expect(res).not.toBeNull();
    // pooled-variance normal approximation: (za*sqrt(2*p*q)+zb*sqrt(q1+q2))^2/d^2
    const expected = ((Z975 * Math.sqrt(2 * 0.75 * 0.25) + Z90 * Math.sqrt(0.85 * 0.15 + 0.65 * 0.35)) ** 2) / 0.2 ** 2;
    expect(res!.nControlRaw).toBeCloseTo(expected, 6);
    expect(res!.nControlRaw).toBeCloseTo(96.41, 1);
    expect(res!.nControl).toBe(97);
    expect(res!.nTreat).toBe(97);
    expect(res!.achievedPower).toBeGreaterThan(0.895);
  });

  it('two means, superiority: sigma=10 delta=5 a=0.05 power=0.90 -> 84.06/85 per group', () => {
    const res = sampleSizeForPower({
      objective: 'superiority',
      endpoint: 'means',
      alpha: 0.05,
      power: 0.9,
      sigma: 10,
      delta: 5,
      margin: 0,
      p1: 0.5,
      p2: 0.5,
      ratio: 1,
    });
    expect(res).not.toBeNull();
    expect(res!.nControlRaw).toBeCloseTo((2 * 100 * (Z975 + Z90) ** 2) / 25, 6);
    expect(res!.nControlRaw).toBeCloseTo(84.06, 1);
    expect(res!.nControl).toBe(85);
    // Cohen's d = 0.5 at 80% power: the classic ~63-per-group answer.
    const dHalf = sampleSizeForPower({
      objective: 'superiority',
      endpoint: 'means',
      alpha: 0.05,
      power: 0.8,
      sigma: 1,
      delta: 0.5,
      margin: 0,
      p1: 0.5,
      p2: 0.5,
      ratio: 1,
    });
    expect(dHalf!.nControlRaw).toBeCloseTo((2 * (Z975 + Z80) ** 2) / 0.25, 6);
    expect(dHalf!.nControlRaw).toBeCloseTo(62.79, 1);
    expect(dHalf!.nControl).toBe(63);
    // achieved power at the ceiled n is back at (or just above) the target
    expect(dHalf!.achievedPower).toBeGreaterThan(0.795);
    expect(dHalf!.achievedPower).toBeLessThan(0.81);
  });

  it('unequal allocation shifts n between arms consistently', () => {
    const res = sampleSizeForPower({
      objective: 'superiority',
      endpoint: 'means',
      alpha: 0.05,
      power: 0.9,
      sigma: 10,
      delta: 5,
      margin: 0,
      p1: 0.5,
      p2: 0.5,
      ratio: 2,
    });
    expect(res).not.toBeNull();
    // nC = (1 + 1/r) * sigma^2 * (za+zb)^2 / d^2 = 1.5 * 100 * 10.5074 / 25 = 63.04
    expect(res!.nControlRaw).toBeCloseTo(1.5 * 2 * 100 * ((Z975 + Z90) ** 2) / 25 / 2 + 0, 6);
    expect(res!.nControl).toBe(64);
    expect(res!.nTreat).toBe(Math.ceil(res!.nControlRaw * 2));
  });

  it('non-inferiority (margin) uses a one-sided alpha and the effective margin', () => {
    const res = sampleSizeForPower({
      objective: 'noninferiority',
      endpoint: 'means',
      alpha: 0.025,
      power: 0.9,
      sigma: 10,
      delta: 0,
      margin: 3,
      p1: 0.5,
      p2: 0.5,
      ratio: 1,
    });
    expect(res).not.toBeNull();
    // n = 2 * sigma^2 * (z_0.975 + z_0.9)^2 / M^2
    expect(res!.nControlRaw).toBeCloseTo((2 * 100 * (Z975 + Z90) ** 2) / 9, 6);
    expect(res!.nControlRaw).toBeCloseTo(233.5, 1);
    expect(res!.nControl).toBe(234);
    // an assumed true advantage erodes the effective margin: M - |delta|
    const withDelta = sampleSizeForPower({
      objective: 'noninferiority',
      endpoint: 'means',
      alpha: 0.025,
      power: 0.9,
      sigma: 10,
      delta: 1,
      margin: 3,
      p1: 0.5,
      p2: 0.5,
      ratio: 1,
    });
    expect(withDelta!.nControlRaw).toBeCloseTo((2 * 100 * (Z975 + Z90) ** 2) / 4, 6);
  });

  it('equivalence TOST: z_(1-beta/2) enters, M=4 sigma=10 a=0.05 power=0.8 -> 107.05/108', () => {
    const res = sampleSizeForPower({
      objective: 'equivalence',
      endpoint: 'means',
      alpha: 0.05,
      power: 0.8,
      sigma: 10,
      delta: 0,
      margin: 4,
      p1: 0.5,
      p2: 0.5,
      ratio: 1,
    });
    expect(res).not.toBeNull();
    expect(res!.nControlRaw).toBeCloseTo((2 * 100 * (Z95 + Z90) ** 2) / 16, 6);
    expect(res!.nControlRaw).toBeCloseTo(107.05, 1);
    expect(res!.nControl).toBe(108);
    expect(res!.achievedPower).toBeGreaterThan(0.79);
    // margin consumed by the assumed true difference -> infeasible
    const bad = sampleSizeForPower({
      objective: 'equivalence',
      endpoint: 'means',
      alpha: 0.05,
      power: 0.8,
      sigma: 10,
      delta: 4,
      margin: 4,
      p1: 0.5,
      p2: 0.5,
      ratio: 1,
    });
    expect(bad).toBeNull();
  });
});

describe('med-biostat two-arm inference', () => {
  // R reference: t.test(extra ~ group, sleep) ->
  // t = -1.860813, df = 17.77647, p-value = 0.07939, CI (-3.365483, 0.2054832)
  const g1 = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0];
  const g2 = [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];

  it('Welch t test reproduces the classic sleep-data values', () => {
    const w = welchTwoSample(g1, g2, 0.05);
    expect(w).not.toBeNull();
    expect(w!.diff).toBeCloseTo(-1.58, 10);
    expect(w!.t).toBeCloseTo(-1.860813, 4);
    expect(w!.df).toBeCloseTo(17.77647, 3);
    expect(w!.p).toBeCloseTo(0.079394, 4);
    expect(w!.ciLo).toBeCloseTo(-3.365483, 4);
    expect(w!.ciHi).toBeCloseTo(0.2054832, 4);
    // Cohen's d with pooled SD sqrt((9*3.2 + 9*4.00889)/18) = 1.898537
    expect(w!.cohensD).toBeCloseTo(-1.58 / 1.898537, 4);
  });

  it('Welch degenerate input returns null', () => {
    expect(welchTwoSample([1, 1, 1], [2, 3, 4])).toBeNull();
    expect(welchTwoSample([1], [2, 3, 4])).toBeNull();
  });

  it('Pearson chi-square matches hand-computed 2x2 tables', () => {
    // [[10,20],[20,30]]: E = 11.25/18.75/18.75/31.25 -> chi2 = 0.35556
    const a = chi2_2x2(10, 20, 20, 30);
    expect(a.chi2).toBeCloseTo(0.355556, 5);
    expect(a.p).toBeCloseTo(0.550989, 3);
    // [[6,54],[15,45]]: E = 10.5/49.5/10.5/49.5 -> chi2 = 4.675325, p = 0.0306
    // (this is the trial table: 6/60 vs 15/60 events)
    const b = chi2_2x2(6, 54, 15, 45);
    expect(b.chi2).toBeCloseTo(4.675325, 5);
    expect(b.p).toBeCloseTo(0.0306, 3);
  });

  it('Fisher exact matches R fisher.test references', () => {
    expect(fisherExact2x2(3, 1, 1, 3)).toBeCloseTo(0.4857142857, 6);
    expect(fisherExact2x2(10, 2, 2, 10)).toBeCloseTo(0.00332885, 4);
  });

  it('binary two-group rates: risk difference, RR, OR and both p-values', () => {
    const r = binaryTwoGroup(6, 60, 15, 60);
    expect(r).not.toBeNull();
    expect(r!.rate1).toBeCloseTo(0.1, 10);
    expect(r!.rate2).toBeCloseTo(0.25, 10);
    expect(r!.diff).toBeCloseTo(-0.15, 10);
    expect(r!.chi2).toBeCloseTo(4.675325, 5);
    expect(r!.p).toBeCloseTo(0.0306, 3);
    expect(r!.rr).toBeCloseTo(0.4, 6);
    expect(r!.or).toBeCloseTo(1 / 3, 6);
    // Fisher is more conservative than the chi-square approximation here
    expect(r!.fisherP).toBeGreaterThan(r!.p);
    expect(r!.fisherP).toBeLessThan(0.06);
  });
});

describe('med-biostat alpha-spending boundaries', () => {
  it('OBF spending function matches its closed form', () => {
    // alpha(t) = 2 - 2*Phi(z_{a/2}/sqrt(t)); at t=1 it returns the full alpha
    expect(obfSpending(1, 0.05)).toBeCloseTo(0.05, 12);
    expect(obfSpending(0.2, 0.05)).toBeCloseTo(2 * (1 - 0.999994132), 6);
    expect(pocockSpending(1, 0.05)).toBeCloseTo(0.05, 12);
    expect(pocockSpending(0.2, 0.05)).toBeCloseTo(0.05 * Math.log(1 + (Math.E - 1) * 0.2), 10);
  });

  it("O'Brien-Fleming k=5 a=0.05: first boundary satisfies the analytic identity", () => {
    const times = equalInformationFractions(5);
    expect(times).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
    const b = sequentialBoundaries(times, 0.05, 'obf');
    expect(b).toHaveLength(5);
    // First look: b1 = z_{a/2}/sqrt(t1) = 1.96/sqrt(0.2) = 4.3827 by construction.
    expect(b[0]!).toBeCloseTo(Z975 / Math.sqrt(0.2), 2);
    expect(b[0]!).toBeGreaterThan(4.2);
    // Boundaries decrease monotonically; final look stays near the fixed-sample z.
    for (let j = 0; j < 4; j += 1) expect(b[j]!).toBeGreaterThan(b[j + 1]!);
    expect(b[4]!).toBeGreaterThan(1.9);
    expect(b[4]!).toBeLessThan(2.45);
    // Mean boundary of the OBF design sits around ~2.9-3.0 (textbook magnitude).
    const mean = b.reduce((s, v) => s + v, 0) / 5;
    expect(mean).toBeGreaterThan(2.7);
    expect(mean).toBeLessThan(3.1);
  });

  it('Pocock boundaries are near-constant and flatter than OBF', () => {
    const times = equalInformationFractions(5);
    const obf = sequentialBoundaries(times, 0.05, 'obf');
    const poc = sequentialBoundaries(times, 0.05, 'pocock');
    expect(poc[0]!).toBeGreaterThan(2.3);
    expect(poc[0]!).toBeLessThan(2.7);
    for (const v of poc) {
      expect(v).toBeGreaterThan(2.2);
      expect(v).toBeLessThan(2.8);
    }
    expect(Math.max(...poc) - Math.min(...poc)).toBeLessThan(0.4);
    expect(obf[0]!).toBeGreaterThan(poc[0]!);
    expect(obf[4]!).toBeLessThan(poc[4]!);
  });

  it('k=2 OBF first boundary equals 1.96/sqrt(0.5) = 2.7718', () => {
    const b = sequentialBoundaries(equalInformationFractions(2), 0.05, 'obf');
    expect(b[0]!).toBeCloseTo(Z975 / Math.SQRT1_2, 2);
    expect(b[1]!).toBeCloseTo(1.977, 1); // classic tabulated final bound
  });
});

describe('med-biostat randomization', () => {
  const opts = { n: 120, blockSize: 6, seed: 20260 };

  it('fixed blocks give exact 1:1 balance, chi2 = 0, and same-seed reproducibility', () => {
    const a = generateRandomization({ ...opts, method: 'block' });
    const b = generateRandomization({ ...opts, method: 'block' });
    expect(a.arms).toHaveLength(120);
    expect(a.counts).toEqual({ a: 60, b: 60 });
    expect(a.chi2).toBeCloseTo(0, 10);
    expect(a.balanceP).toBeCloseTo(1, 10);
    expect(a.arms).toEqual(b.arms);
    expect(a.blockSizes.every((s) => s === 6)).toBe(true);
    const c = generateRandomization({ ...opts, method: 'block', seed: 777 });
    expect(c.arms).not.toEqual(a.arms);
  });

  it('random-length blocks draw sizes from {4,6,8} and stay balanced', () => {
    const r = generateRandomization({ ...opts, method: 'random-block' });
    expect(Math.abs(r.counts.a - r.counts.b)).toBeLessThanOrEqual(2);
    for (const s of r.blockSizes) expect([2, 3, 4, 6, 8]).toContain(s);
    expect(r.rule).toContain('random lengths');
  });

  it('stratified blocks balance within every stratum (2 x 2 factors)', () => {
    const factors = parseStrataSpec('center:2,severity:2');
    expect(factors).toEqual([
      { name: 'center', levels: 2 },
      { name: 'severity', levels: 2 },
    ]);
    const r = generateRandomization({ ...opts, method: 'stratified', factors });
    expect(r.perStratum).toHaveLength(4);
    for (const st of r.perStratum) {
      expect(Math.abs(st.a - st.b)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(r.counts.a - r.counts.b)).toBeLessThanOrEqual(2);
    const again = generateRandomization({ ...opts, method: 'stratified', factors });
    expect(r.arms).toEqual(again.arms);
  });

  it('adaptive (Pocock-Simon) is seeded, reproducible and near-balanced', () => {
    const factors = parseStrataSpec('center:2,severity:3');
    const a = generateRandomization({ ...opts, method: 'adaptive', factors });
    const b = generateRandomization({ ...opts, method: 'adaptive', factors });
    expect(a.arms).toEqual(b.arms);
    expect(Math.abs(a.counts.a - a.counts.b)).toBeLessThanOrEqual(10);
    expect(a.rule).toContain('Pocock-Simon');
    expect(a.perStratum.length).toBeGreaterThan(0);
  });
});

// ---- example data driven tests --------------------------------------------

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
function readExample(name: string): string {
  return readFileSync(`${ROOT}examples/data/${name}`, 'utf8');
}

describe('med-biostat CSV intake (example data)', () => {
  it('parses the bundled trial table', () => {
    const t = parseTrialCsv(readExample('med-biostat-trial.csv'));
    expect(t).not.toBeNull();
    expect(t!.n).toBe(120);
    expect(t!.armLabels).toEqual(['Control', 'Treatment']);
    expect(t!.event).not.toBeNull();
    expect(t!.secondary).not.toBeNull();
    expect(t!.primary.every((v) => Number.isFinite(v))).toBe(true);
    const evTotal = t!.event!.filter((v) => v === 1).length;
    expect(evTotal).toBe(21);
    const byArm = valuesByArm(t!.arm, t!.event!, t!.armLabels);
    expect(byArm[0]).toHaveLength(60);
    expect(byArm[1]).toHaveLength(60);
  });

  it('rejects tables without arm/endpoint columns', () => {
    expect(parseTrialCsv('x,y\n1,2\n3,4')).toBeNull();
    expect(parseAeCsv('x,y\n1,2\n3,4')).toBeNull();
  });

  it('parses the bundled AE count table and finds exactly one signal', () => {
    const rows = parseAeCsv(readExample('med-biostat-ae.csv'));
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(16);
    const table = aeSignalTable(rows!);
    const signals = table.filter((r) => r.signal);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.treatment).toBe('DrugA');
    expect(signals[0]!.event).toBe('headache');
    // PRR = (60/200)/(18/170) = 2.8333; chi2([[60,140],[18,152]]) = 20.81
    expect(signals[0]!.prr).toBeCloseTo(2.8333, 3);
    expect(signals[0]!.chi2).toBeCloseTo(20.813, 1);
    // DrugB/edema has PRR ~ 2.017 but chi2 ~ 2.39 < 4 -> no signal
    const edema = table.find((r) => r.treatment === 'DrugB' && r.event === 'edema')!;
    expect(edema.prr).toBeCloseTo(2.0168, 3);
    expect(edema.chi2).toBeCloseTo(2.39, 1);
    expect(edema.signal).toBe(false);
    const maxPrr = table.reduce((m, r) => (Number.isFinite(r.prr) && r.prr > m ? r.prr : m), 0);
    expect(maxPrr).toBeCloseTo(2.8333, 3);
  });
});
