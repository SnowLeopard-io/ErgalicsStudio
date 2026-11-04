import { describe, expect, it } from 'vitest';
import {
  SDT_BENCHMARK,
  aucAnalytic,
  aucNumeric,
  confusionToRates,
  parseSdtData,
  rocCurve,
  rocHrEv,
  rocHrUv,
  runSdtBenchmark,
  safeRate,
  sdtMeasures,
  stdNormCdf,
  stdNormPdf,
  stdNormQuantile,
} from '../src/plugins/builtin/psych/sdt/kernel';

describe('psych-sdt kernel (signal detection theory)', () => {
  it('Phi is exact at 0, hits the published N(1.96), and is symmetric', () => {
    expect(stdNormCdf(0)).toBe(0.5);
    expect(Math.abs(stdNormCdf(1.96) - 0.9750021048517795)).toBeLessThan(1e-9);
    expect(stdNormCdf(-2) + stdNormCdf(2)).toBeCloseTo(1, 12);
    expect(stdNormPdf(0)).toBeCloseTo(0.3989422804014327, 12);
  });

  it('probit Phi^-1(0.975) = 1.959964 and round-trips through Phi', () => {
    expect(Math.abs(stdNormQuantile(0.975) - SDT_BENCHMARK.q975)).toBeLessThan(1e-8);
    for (const p of [0.001, 0.025, 0.5, 0.8, 0.975, 0.999]) {
      expect(Math.abs(stdNormCdf(stdNormQuantile(p)) - p)).toBeLessThan(1e-10);
    }
    expect(Number.isNaN(stdNormQuantile(0))).toBe(true);
    expect(Number.isNaN(stdNormQuantile(1))).toBe(true);
  });

  it("d'(H=0.8, F=0.2) = 1.6832425 with beta = 1 and c = 0", () => {
    const m = sdtMeasures(0.8, 0.2);
    // z(0.8) = 0.8416212335729143 ⇒ d' = 1.6832424671458286
    // (the 1.6868 sometimes quoted is a table-reading typo)
    expect(Math.abs(m.dprime - SDT_BENCHMARK.dprime8020)).toBeLessThan(1e-6);
    expect(Math.abs(m.beta - 1)).toBeLessThan(1e-9);
    expect(Math.abs(m.criterion)).toBeLessThan(1e-9);
  });

  it('d′ is stable at extreme rates H = 0.999 / F = 0.001', () => {
    const m = sdtMeasures(0.999, 0.001);
    expect(Number.isFinite(m.dprime)).toBe(true);
    expect(Number.isFinite(m.beta)).toBe(true);
    expect(Number.isFinite(m.criterion)).toBe(true);
    expect(Math.abs(m.dprime - SDT_BENCHMARK.extremeDprime)).toBeLessThan(1e-4);
  });

  it('safeRate clamps into the open unit interval', () => {
    expect(safeRate(0)).toBeGreaterThan(0);
    expect(safeRate(1)).toBeLessThan(1);
    expect(safeRate(-5)).toBe(safeRate(0));
    expect(safeRate(5)).toBe(safeRate(1));
  });

  it('the analytic ROC inverts the measures: HR(F=0.2) returns H=0.8', () => {
    const d = sdtMeasures(0.8, 0.2).dprime;
    expect(Math.abs(rocHrEv(d, 0.2) - 0.8)).toBeLessThan(1e-9);
    // HR(FAR = 0.5) = Phi(d')
    expect(Math.abs(rocHrEv(1.5, 0.5) - 0.9331927987311419)).toBeLessThan(1e-7);
    // unequal-variance model at s = 2, FAR = 0.5: HR = Phi(d'/2)
    expect(Math.abs(rocHrUv(2, 0.5, 2) - stdNormCdf(1))).toBeLessThan(1e-12);
  });

  it('rocCurve stays inside the unit square on a monotone FAR grid', () => {
    const pts = rocCurve(1.2, 1, 220);
    expect(pts.length).toBe(220);
    for (let i = 1; i < pts.length; i += 1) {
      expect(pts[i]!.far).toBeGreaterThan(pts[i - 1]!.far);
      expect(pts[i]!.hr).toBeGreaterThan(pts[i - 1]!.hr);
      expect(pts[i]!.hr).toBeLessThanOrEqual(1);
    }
  });

  it('AUC: closed form equals numerical integration (s = 1 and s = 1.5)', () => {
    expect(aucAnalytic(0, 1)).toBeCloseTo(0.5, 12);
    for (const s of [1, 1.5]) {
      const a = aucAnalytic(1.5, s);
      const relErr = Math.abs(aucNumeric(1.5, s) - a) / a;
      expect(relErr).toBeLessThan(1e-4);
    }
    expect(Math.abs(aucAnalytic(1.5, 1) - 0.8555778)).toBeLessThan(1e-6);
  });

  it('counts and trial tables both parse into the same confusion tally', () => {
    const trials = parseSdtData('signal,respond\n1,1\n1,0\n0,1\n0,0\n# comment');
    expect(trials).not.toBeNull();
    expect(trials!.n).toBe(4);
    expect(trials!.hits).toBe(1);
    expect(trials!.misses).toBe(1);
    expect(trials!.falseAlarms).toBe(1);
    expect(trials!.correctRejections).toBe(1);

    const counts = parseSdtData('hits,misses,falseAlarms,correctRejections\n8,2,1,9');
    expect(counts).not.toBeNull();
    expect(counts!.hits).toBe(8);
    expect(counts!.n).toBe(20);
    const rates = confusionToRates(counts!);
    expect(rates.hitRate).toBeCloseTo(0.8, 12);
    expect(rates.faRate).toBeCloseTo(0.1, 12);

    const words = parseSdtData('s,y\ns,n\nn,y\nn,n');
    expect(words!.hits).toBe(1);
    expect(words!.falseAlarms).toBe(1);
    expect(parseSdtData('hello world')).toBeNull();
  });

  it('embedded benchmark battery passes', () => {
    const b = runSdtBenchmark();
    expect(b.dprime8020Err).toBeLessThan(1e-4);
    expect(b.q975Err).toBeLessThan(1e-6);
    expect(b.aucNumRelErr).toBeLessThan(1e-4);
    expect(b.aucUvNumRelErr).toBeLessThan(1e-4);
    expect(b.extremeStable).toBe(true);
    expect(b.pass).toBe(true);
  });
});
