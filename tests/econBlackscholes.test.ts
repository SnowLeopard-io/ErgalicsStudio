import { describe, expect, it } from 'vitest';
import {
  BS_BENCHMARK,
  DEFAULT_BS_PARAMS,
  bsGreeks,
  bsPrices,
  deltaFiniteDiff,
  mcPrices,
  parityResidual,
  runBlackscholesBenchmark,
  spotCurve,
  stdNormCdf,
  stdNormPdf,
} from '../src/plugins/builtin/econ-blackscholes/kernel';

const ATM = DEFAULT_BS_PARAMS; // S=100, K=100, r=5%, q=0, σ=20%, T=1

describe('econ-blackscholes kernel', () => {
  it('standard normal CDF hits the published N(1.96) and is symmetric', () => {
    expect(Math.abs(stdNormCdf(1.96) - BS_BENCHMARK.n196)).toBeLessThan(1e-7);
    // A&S 26.2.17 keeps |eps| < 7.5e-8 (5.2e-10 at the origin)
    expect(stdNormCdf(0)).toBeCloseTo(0.5, 8);
    expect(stdNormCdf(-2) + stdNormCdf(2)).toBeCloseTo(1, 12);
    expect(stdNormPdf(0)).toBeCloseTo(0.3989422804014327, 12);
  });

  it('analytic ATM prices match the textbook values', () => {
    const p = bsPrices(ATM);
    // Hull-style table value C ≈ 10.4506 (A&S CDF keeps |err| ≲ 2e-5 here)
    expect(Math.abs(p.call - 10.450584)).toBeLessThan(1e-4);
    expect(Math.abs(p.put - 5.573526)).toBeLessThan(1e-4);
  });

  it('put-call parity holds to machine precision across parameter sets', () => {
    const cases = [
      ATM,
      { ...ATM, S: 80, K: 105, sigma: 0.35, T: 0.5 },
      { ...ATM, q: 0.03, r: 0.02, sigma: 0.1 },
      { ...ATM, sigma: 0, T: 2 }, // degenerate branch
    ];
    for (const c of cases) {
      expect(Math.abs(parityResidual(c))).toBeLessThan(1e-10);
    }
  });

  it('Greeks match closed forms and obey delta/theta identities', () => {
    const g = bsGreeks(ATM);
    // delta_call = N(d1), d1 = 0.35
    expect(Math.abs(g.deltaCall - 0.6368307)).toBeLessThan(1e-6);
    // delta_call − delta_put = e^{-qT} = 1 (exact through the CDF symmetry branch)
    expect(g.deltaCall - g.deltaPut).toBeCloseTo(1, 12);
    // gamma = φ(d1)/(S·σ·√T), pure pdf → machine precision
    expect(Math.abs(g.gamma - 0.3752403468 / 20)).toBeLessThan(1e-10);
    // vega = S·φ(d1)·√T
    expect(Math.abs(g.vega - 37.52403468)).toBeLessThan(1e-7);
    // theta_put − theta_call = r·K·e^{-rT} − q·S·e^{-qT} = 4.756147
    expect(Math.abs(g.thetaPut - g.thetaCall - 4.7561471)).toBeLessThan(1e-6);
  });

  it('analytic Delta agrees with a central finite difference', () => {
    const err = Math.abs(bsGreeks(ATM).deltaCall - deltaFiniteDiff(ATM));
    expect(err).toBeLessThan(5e-4);
  });

  it('MC pricing is within 3 standard errors of the analytic price', () => {
    const an = bsPrices(ATM);
    const mc = mcPrices(ATM, BS_BENCHMARK.paths, BS_BENCHMARK.seed).result;
    const seUnits = Math.abs(mc.call.mean - an.call) / mc.call.se;
    expect(seUnits).toBeLessThan(3);
    // CI brackets the estimate and has the right half-width
    expect(Math.abs(mc.call.hi - mc.call.lo - 2 * 1.959963984540054 * mc.call.se)).toBeLessThan(1e-12);
    // Per-path C−P = S_T − K, so the MC parity difference equals
    // disc·(mean S_T − K) and carries the S_T sampling error
    // (SE ≈ disc·std(S_T)/√n ≈ 0.064 here): assert within 3σ.
    const fwdDiff = ATM.S - ATM.K * Math.exp(-ATM.r * ATM.T);
    expect(Math.abs(mc.call.mean - mc.put.mean - fwdDiff)).toBeLessThan(0.25);
  });

  it('MC engine is deterministic under a fixed seed and traces convergence', () => {
    const a = mcPrices(ATM, 20_000, 12345, 40);
    const b = mcPrices(ATM, 20_000, 12345, 40);
    expect(a.result.call.mean).toBe(b.result.call.mean);
    expect(a.result.put.mean).toBe(b.result.put.mean);
    expect(a.trace.length).toBeGreaterThanOrEqual(10);
    const last = a.trace[a.trace.length - 1]!;
    expect(last.n).toBe(20_000);
    expect(Math.abs(last.callMean - a.result.call.mean)).toBeLessThan(1e-9);
  });

  it('spot curve is finite and call prices are monotone in spot', () => {
    const pts = spotCurve(ATM, 50, 150, 121);
    expect(pts.length).toBe(121);
    for (let i = 1; i < pts.length; i += 1) {
      expect(pts[i]!.call).toBeGreaterThanOrEqual(pts[i - 1]!.call - 1e-12);
      expect(Number.isFinite(pts[i]!.put)).toBe(true);
    }
  });

  it('embedded benchmark battery passes', () => {
    const b = runBlackscholesBenchmark();
    expect(b.parity).toBeLessThan(1e-10);
    expect(b.cdfErr196).toBeLessThan(1e-7);
    expect(b.deltaFdErr).toBeLessThan(1e-3);
    expect(b.mcSeUnits).toBeLessThan(3);
    expect(b.pass).toBe(true);
  });
});
