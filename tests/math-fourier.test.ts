import { describe, expect, it } from 'vitest';
import {
  analyticCoeff,
  analyticL2Norm,
  analyticTailL2,
  computeFourierCoeffs,
  evalFourierSum,
  fejerOvershoot,
  GIBBS_RATIO,
  gibbsOvershootRatio,
  parsevalResidual,
  relativeL2Error,
  runFourierBenchmarks,
  SI_PI,
  WAVEFORMS,
} from '../src/plugins/builtin/math/fourier/kernel';

describe('math-fourier kernel — analytic constants', () => {
  it('Si(π) ≈ 1.851937 and the Gibbs constant 2·Si(π)/π ≈ 1.17898', () => {
    expect(Math.abs(SI_PI - 1.8519370519824663)).toBeLessThan(1e-9);
    expect(Math.abs(GIBBS_RATIO - 1.1789797444721672)).toBeLessThan(1e-9);
  });

  it('analytic coefficients match the textbook series', () => {
    // square: b_n = 4/(πn) odd
    expect(analyticCoeff('square', 1)!.b).toBeCloseTo(4 / Math.PI, 15);
    expect(analyticCoeff('square', 2)!.b).toBe(0);
    // triangle: a_n = 8/(π²n²) odd
    expect(analyticCoeff('triangle', 3)!.a).toBeCloseTo(8 / (Math.PI * Math.PI * 9), 15);
    expect(analyticCoeff('triangle', 4)!.a).toBe(0);
    // sawtooth: b_n = 2(−1)^(n+1)/(πn)
    expect(analyticCoeff('sawtooth', 1)!.b).toBeCloseTo(2 / Math.PI, 15);
    expect(analyticCoeff('sawtooth', 2)!.b).toBeCloseTo(-2 / (2 * Math.PI), 15);
    expect(analyticCoeff('custom', 1)).toBeNull();
  });

  it('analytic L2 norms are exact (square 2, triangle & sawtooth 2/3)', () => {
    expect(analyticL2Norm('square')).toBe(2);
    expect(analyticL2Norm('triangle')).toBeCloseTo(2 / 3, 15);
    expect(analyticL2Norm('sawtooth')).toBeCloseTo(2 / 3, 15);
  });
});

describe('math-fourier kernel — benchmark ①②: coefficients vs analytic', () => {
  it('Simpson (jump-split) recovers square-wave b_n = 4/(nπ) with rel err < 1e-4', () => {
    const c = computeFourierCoeffs(WAVEFORMS.square, Math.PI, 64, 2000);
    for (let n = 1; n <= 64; n += 2) {
      const ref = analyticCoeff('square', n)!.b;
      expect(Math.abs(c.b[n - 1]! - ref) / Math.abs(ref)).toBeLessThan(1e-4);
    }
    // even harmonics vanish (integral of an odd-symmetric product)
    for (let n = 2; n <= 64; n += 2) {
      expect(Math.abs(c.b[n - 1]!)).toBeLessThan(1e-10);
    }
  });

  it('Simpson recovers triangle-wave a_n = 8/(π²n²) with rel err < 1e-4', () => {
    const c = computeFourierCoeffs(WAVEFORMS.triangle, Math.PI, 64, 2000);
    for (let n = 1; n <= 64; n += 2) {
      const ref = analyticCoeff('triangle', n)!.a;
      expect(Math.abs(c.a[n - 1]! - ref) / Math.abs(ref)).toBeLessThan(1e-4);
    }
  });

  it('works on a non-default interval [−L, L] (coefficients rescale correctly)', () => {
    // f(x) = sin(πx/L) profile must give b_1 = 1 exactly for any L.
    const L = 2.5;
    const sine: typeof WAVEFORMS.square = {
      ...WAVEFORMS.square,
      fn: (u) => Math.sin(u),
      breaks: [],
      jumpU: null,
    };
    const c = computeFourierCoeffs(sine, L, 4, 400);
    expect(Math.abs(c.b[0]! - 1)).toBeLessThan(1e-10);
    for (let n = 2; n <= 4; n += 1) expect(Math.abs(c.b[n - 1]!)).toBeLessThan(1e-10);
  });
});

describe('math-fourier kernel — benchmark ③: Gibbs overshoot', () => {
  it('partial-sum overshoot ratio → 2·Si(π)/π ≈ 1.17898 with err < 1% at N = 64', () => {
    const c = computeFourierCoeffs(WAVEFORMS.square, Math.PI, 64, 600);
    const ratio = gibbsOvershootRatio(c, WAVEFORMS.square)!;
    expect(ratio).toBeGreaterThan(1.1); // a genuine overshoot above the level 1
    expect(Math.abs(ratio - GIBBS_RATIO) / GIBBS_RATIO).toBeLessThan(0.01);
  });

  it('returns null for smooth waveforms', () => {
    const c = computeFourierCoeffs(WAVEFORMS.triangle, Math.PI, 16, 200);
    expect(gibbsOvershootRatio(c, WAVEFORMS.triangle)).toBeNull();
  });
});

describe('math-fourier kernel — benchmark ④: Fejér means overshoot-free', () => {
  it('Fejér overshoot < 1e-6 for the square wave (positive-kernel bound)', () => {
    const c = computeFourierCoeffs(WAVEFORMS.square, Math.PI, 64, 600);
    expect(fejerOvershoot(WAVEFORMS.square, c)).toBeLessThan(1e-6);
  });

  it('plain partial sums DO overshoot the square wave (control experiment)', () => {
    const c = computeFourierCoeffs(WAVEFORMS.square, Math.PI, 64, 600);
    const plainMax = Math.max(gibbsOvershootRatio(c, WAVEFORMS.square)!, 0);
    expect(plainMax).toBeGreaterThan(1.17); // Gibbs present in the plain sum
    expect(fejerOvershoot(WAVEFORMS.square, c)).toBeLessThan(plainMax - 0.1);
  });
});

describe('math-fourier kernel — benchmark ⑤: Parseval identity', () => {
  it('coefficient energy matches (1/L)∫f² with residual < 1% at N = 64', () => {
    const c = computeFourierCoeffs(WAVEFORMS.square, Math.PI, 64, 800);
    expect(parsevalResidual(WAVEFORMS.square, c)).toBeLessThan(0.01);
  });

  it('residual shrinks as N grows (tail energy vanishes)', () => {
    const small = parsevalResidual(WAVEFORMS.square, computeFourierCoeffs(WAVEFORMS.square, Math.PI, 16, 400));
    // Analytic tail at N = 256: (16/π²)·Σ_{odd n>256} 1/n² ≈ 0.0032, /I2 = 2
    // → residual ≈ 1.6e-3.
    const large = parsevalResidual(WAVEFORMS.square, computeFourierCoeffs(WAVEFORMS.square, Math.PI, 256, 400));
    expect(large).toBeLessThan(small);
    expect(large).toBeLessThan(0.002);
  });
});

describe('math-fourier kernel — L2 error vs exact Parseval tail', () => {
  it('sampled relative L2 error matches the analytic tail within 1e-3', () => {
    const c = computeFourierCoeffs(WAVEFORMS.square, Math.PI, 64, 600);
    // (S_N − f)² oscillates up to frequency ≈ 2N; the midpoint rule needs
    // enough samples to resolve it (16384 → ~128 points per fastest period).
    const sampled = relativeL2Error(WAVEFORMS.square, c, 'partial', 16384);
    // Sum the analytic tail far enough that its own truncation is negligible.
    const theory = analyticTailL2('square', 64, 2_000_000)! / Math.sqrt(analyticL2Norm('square')!);
    expect(Math.abs(sampled - theory) / theory).toBeLessThan(1e-3);
  });

  it('Fejér mean converges uniformly: L2 error of σ_N exceeds that of S_N near jumps', () => {
    // Fejér trades the Gibbs spike for a slightly larger global L2 error.
    const c = computeFourierCoeffs(WAVEFORMS.square, Math.PI, 64, 600);
    const plain = relativeL2Error(WAVEFORMS.square, c, 'partial');
    const fejer = relativeL2Error(WAVEFORMS.square, c, 'fejer');
    expect(fejer).toBeGreaterThan(plain);
  });

  it('custom analytic waveform converges spectrally (no Gibbs, tiny error at N=24)', () => {
    const c = computeFourierCoeffs(WAVEFORMS.custom, Math.PI, 24, 800);
    expect(relativeL2Error(WAVEFORMS.custom, c, 'partial')).toBeLessThan(1e-4);
  });
});

describe('math-fourier embedded benchmark suite', () => {
  it('all five spec benchmarks pass at N = 64', () => {
    const bench = runFourierBenchmarks();
    const specIds = ['square-coeff', 'triangle-coeff', 'gibbs-ratio', 'fejer-overshoot', 'parseval-residual'];
    for (const id of specIds) {
      const b = bench.find((x) => x.id === id);
      expect(b, `benchmark ${id} missing`).toBeDefined();
      expect(b!.passed, `${id} failed: ${b!.detailEn}`).toBe(true);
    }
  });
});

describe('math-fourier evalFourierSum sanity', () => {
  it('reproduces the square wave away from the jump as N grows', () => {
    const c = computeFourierCoeffs(WAVEFORMS.square, Math.PI, 255, 1000);
    // Pointwise convergence at x = π/2 is an alternating series; the remainder
    // after the last term is bounded by 4/(π·257) ≈ 5e-3.
    expect(Math.abs(evalFourierSum(c, Math.PI / 2, 'partial') - 1)).toBeLessThan(5e-3);
    expect(Math.abs(evalFourierSum(c, -Math.PI / 2, 'partial') + 1)).toBeLessThan(5e-3);
    // at the jump the symmetric series converges to the midpoint 0
    expect(Math.abs(evalFourierSum(c, 0, 'partial'))).toBeLessThan(1e-9);
  });
});
