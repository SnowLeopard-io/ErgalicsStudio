import { describe, expect, it } from 'vitest';
import {
  RT_BENCHMARK,
  betai,
  cohensD,
  filterOutliers,
  gammaln,
  parseRtData,
  runRtBenchmark,
  summarize,
  tCdf,
  tQuantile,
  tTwoTailedP,
  welchTest,
} from '../src/plugins/builtin/psych/rt/kernel';

describe('psych-rt kernel (reaction-time statistics)', () => {
  it('gammaln and betai match known special values', () => {
    expect(gammaln(1)).toBeCloseTo(0, 12);
    expect(gammaln(5)).toBeCloseTo(Math.log(24), 12);
    expect(betai(1, 1, 0.3)).toBeCloseTo(0.3, 12);
    expect(betai(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('two-tailed t probability reproduces the 0.05 critical value', () => {
    expect(tTwoTailedP(0, 6)).toBeCloseTo(1, 12);
    // p(t = 2.447, df = 6) ≈ 0.0499888 — the classic critical-value check
    expect(Math.abs(tTwoTailedP(2.447, 6) - 0.05)).toBeLessThan(1e-3);
    expect(tTwoTailedP(2.447, 6)).toBeLessThan(0.05);
    // p(t_{0.975,6}, 6) = 0.05 exactly
    expect(Math.abs(tTwoTailedP(tQuantile(0.975, 6), 6) - 0.05)).toBeLessThan(1e-9);
  });

  it('t quantiles match published table values', () => {
    expect(Math.abs(tQuantile(0.975, 6) - RT_BENCHMARK.tQ6)).toBeLessThan(1e-6);
    expect(Math.abs(tQuantile(0.975, 1) - 12.7062047)).toBeLessThan(1e-3); // Cauchy-like df = 1
    // bisection floor: the t CDF near 0.5 carries ~1e-8 from the x→1 branch of betai
    expect(tQuantile(0.5, 4)).toBeCloseTo(0, 6);
    for (const df of [1, 3, 7, 30]) {
      for (const p of [0.025, 0.5, 0.975]) {
        expect(Math.abs(tCdf(tQuantile(p, df), df) - p)).toBeLessThan(1e-7);
      }
    }
  });

  it('descriptives: [2,4,4,4,5,5,7,9] → mean 5, sample SD √(32/7), median 4.5, symmetric CI', () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(s.n).toBe(8);
    expect(s.mean).toBeCloseTo(5, 12);
    expect(s.sd).toBeCloseTo(Math.sqrt(32 / 7), 12); // sample SD (ddof = 1)
    expect(s.median).toBeCloseTo(4.5, 12);
    expect(s.sem).toBeCloseTo(Math.sqrt(32 / 7) / Math.sqrt(8), 12);
    expect(Math.abs(s.ciLo - s.mean + s.ciHalf)).toBeLessThan(1e-9);
    expect(Math.abs(s.ciHi - s.mean - s.ciHalf)).toBeLessThan(1e-9);
    // ciHalf = t_{0.975,7} · SEM
    expect(s.ciHalf).toBeCloseTo(tQuantile(0.975, 7) * s.sem, 9);
  });

  it('descriptives: [1,2,3,4] mean 2.5, sd sqrt(5/3), median 2.5', () => {
    const s = summarize([1, 2, 3, 4])!;
    expect(s.mean).toBeCloseTo(2.5, 12);
    expect(s.sd).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(s.median).toBeCloseTo(2.5, 12);
    expect(summarize([5])).toBeNull();
    expect(summarize([])).toBeNull();
    expect(summarize([1, Number.NaN, 3])).not.toBeNull();
    expect(summarize([1, Number.NaN, 3])!.n).toBe(2);
  });

  it('Welch t on [1,2,3,4] vs [5,6,7,8] equals the hand value −4·√(6/5), df = 6', () => {
    const w = welchTest([1, 2, 3, 4], [5, 6, 7, 8])!;
    expect(Math.abs(w.t - RT_BENCHMARK.manualT)).toBeLessThan(1e-12);
    expect(Math.abs(w.df - 6)).toBeLessThan(1e-9);
    expect(w.p).toBeGreaterThan(0);
    expect(w.p).toBeLessThan(0.01);
    // degenerate inputs return null
    expect(welchTest([1], [2, 3])).toBeNull();
    expect(welchTest([1, 1, 1], [1, 1, 1])).toBeNull();
  });

  it("Cohen's d uses the pooled-SD convention: −4/√(5/3)", () => {
    const d = cohensD([1, 2, 3, 4], [5, 6, 7, 8])!;
    expect(Math.abs(d - -4 / Math.sqrt(5 / 3))).toBeLessThan(1e-12);
    expect(cohensD([1], [2, 3])).toBeNull();
  });

  it('outlier screen keeps the inclusive window and preserves order', () => {
    const screen = filterOutliers([50, 250, 300, 5000, 90], 100, 2000);
    expect(screen.kept).toEqual([250, 300]); // 90 < 100 ms ⇒ removed
    expect(screen.removed).toEqual([50, 5000, 90]);
    // defaults are 100 / 2000, inclusive on both ends
    const def = filterOutliers([99, 100, 2000, 2001, Number.NaN]);
    expect(def.kept).toEqual([100, 2000]);
    expect(def.removed).toEqual([99, 2001, Number.NaN]);
  });

  it('parser handles header, headerless, TSV and single-column RT lists', () => {
    const headed = parseRtData('condition,rt\nA,310\nA,320\nB,350\nB,360');
    expect(headed).not.toBeNull();
    expect(headed!.n).toBe(4);
    expect(headed!.groups.length).toBe(2);
    expect(headed!.groups[0]!.name).toBe('A');
    expect(headed!.groups[0]!.rts).toEqual([310, 320]);

    const tsv = parseRtData('condition\trt\nctrl,250\ntreat,310\nctrl,260');
    expect(tsv!.groups.find((g) => g.name === 'ctrl')!.rts).toEqual([250, 260]);

    const bare = parseRtData('# trial log\n310\n320\n305');
    expect(bare!.groups.length).toBe(1);
    expect(bare!.groups[0]!.name).toBe('RT');
    expect(bare!.groups[0]!.rts).toEqual([310, 320, 305]);

    expect(parseRtData('   ')).toBeNull();
    expect(parseRtData('condition,rt\nA,x\nB,y')).toBeNull();
  });

  it('embedded benchmark battery passes', () => {
    const b = runRtBenchmark();
    expect(b.manualTErr).toBeLessThan(1e-9);
    expect(Math.abs(b.manualDf - 6)).toBeLessThan(1e-9);
    expect(b.pCriticalErr).toBeLessThan(1e-3);
    expect(b.tQ6Err).toBeLessThan(1e-6);
    expect(b.ciSelfConsistent).toBe(true);
    expect(b.outlierKept).toEqual([250, 300]);
    expect(b.outlierRemoved).toEqual([50, 5000, 90]);
    expect(b.pass).toBe(true);
  });
});
