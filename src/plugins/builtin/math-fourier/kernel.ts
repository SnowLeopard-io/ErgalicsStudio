// ==========================================================================
// math-fourier — Fourier series numerics (pure, dependency-free, testable)
//
// Trigonometric Fourier coefficients of 2L-periodic waveform presets are
// computed by composite Simpson quadrature, splitting the integration at the
// known discontinuities of the periodic extension so piecewise-smooth
// integrands keep their high-order accuracy. Partial sums (plain and
// Fejér-averaged) are evaluated in closed form; L2 errors use a midpoint
// sampling rule that never lands on a discontinuity; the Gibbs overshoot is
// measured near the first jump and compared with the classic constant
// 2·Si(π)/π ≈ 1.17898 (Bôcher, 1906); Parseval's identity closes the loop
// between coefficient energy and the function's L2 norm.
//
// All functions are pure so the kernel unit-tests without a canvas or DOM.
// The unified error metric throughout is |computed − analytic|/|analytic|.
// ==========================================================================

export type WaveformId = 'square' | 'triangle' | 'sawtooth' | 'custom';

/** A 2π-periodic profile defined on the phase u = π·x/L ∈ [−π, π]. */
export interface WaveformDef {
  id: WaveformId;
  labelEn: string;
  labelZh: string;
  /** Profile value on the phase variable u (period 2π). */
  fn: (u: number) => number;
  /** Interior phase discontinuities within (−π, π); Simpson splits there. */
  breaks: number[];
  /** Phase of the largest jump of the periodic extension; null = smooth. */
  jumpU: number | null;
  /** One-sided limits at the jump (jump height = jumpHi − jumpLo). */
  jumpHi: number;
  jumpLo: number;
}

/** Preset waveforms, all normalized to amplitude ±1 (custom is smooth). */
export const WAVEFORMS: Record<WaveformId, WaveformDef> = {
  square: {
    id: 'square',
    labelEn: 'Square wave',
    labelZh: '方波',
    fn: (u) => (Math.sin(u) >= 0 ? 1 : -1),
    breaks: [0],
    jumpU: 0,
    jumpHi: 1,
    jumpLo: -1,
  },
  triangle: {
    id: 'triangle',
    labelEn: 'Triangle wave',
    labelZh: '三角波',
    fn: (u) => 1 - (2 * Math.abs(u)) / Math.PI,
    breaks: [],
    jumpU: null,
    jumpHi: 0,
    jumpLo: 0,
  },
  sawtooth: {
    id: 'sawtooth',
    labelEn: 'Sawtooth wave',
    labelZh: '锯齿波',
    fn: (u) => u / Math.PI,
    breaks: [],
    jumpU: Math.PI, // periodic seam at u = ±π (rises to +1, resets to −1)
    jumpHi: 1,
    jumpLo: -1,
  },
  custom: {
    id: 'custom',
    labelEn: 'Analytic custom e^sin u − 1',
    labelZh: '自定义解析函数 e^sin u − 1',
    fn: (u) => Math.exp(Math.sin(u)) - 1,
    breaks: [],
    jumpU: null,
    jumpHi: 0,
    jumpLo: 0,
  },
};

// ---- coefficient computation ------------------------------------------------

export interface FourierCoeffs {
  /** Half-period; the series lives on [−L, L]. */
  L: number;
  /** Highest harmonic index. */
  N: number;
  /** a₀ in the (1/L)∫f convention; the constant term of the series is a₀/2. */
  a0: number;
  /** a[n-1] = coefficient a_n, n = 1..N. */
  a: number[];
  /** b[n-1] = coefficient b_n, n = 1..N. */
  b: number[];
}

/**
 * Compute Fourier coefficients a_n = (1/L)∫f·cos(nπx/L)dx and
 * b_n = (1/L)∫f·sin(nπx/L)dx by composite Simpson quadrature, integrating
 * separately between the waveform's phase discontinuities (mapped to x).
 * `panelsPerSegment` must be even.
 */
export function computeFourierCoeffs(
  wave: WaveformDef,
  L: number,
  N: number,
  panelsPerSegment = 600,
): FourierCoeffs {
  const m = Math.max(2, panelsPerSegment - (panelsPerSegment % 2));
  const edges = [-L];
  for (const u of wave.breaks) {
    const x = (u * L) / Math.PI;
    if (x > -L && x < L) edges.push(x);
  }
  edges.push(L);
  edges.sort((p, q) => p - q);

  const a = new Array<number>(N).fill(0);
  const b = new Array<number>(N).fill(0);
  let integralF = 0; // ∫ f dx over [−L, L]

  for (let s = 0; s + 1 < edges.length; s += 1) {
    const x0 = edges[s]!;
    const x1 = edges[s + 1]!;
    // 2m+1 Simpson nodes must span exactly [x0, x1] (m Simpson panels).
    const h = (x1 - x0) / (2 * m);
    // Sample f once at the Simpson nodes; share the values across harmonics.
    // At segment endpoints the phase lands on a jump, so f is evaluated with
    // the one-sided limit from inside the segment (a relative nudge of the
    // node by 1e-6·h) — otherwise the shared jump node feeds the wrong limit
    // into both adjacent segments and contaminates every cosine coefficient.
    const eps = h * 1e-6;
    const fv = new Array<number>(2 * m + 1);
    for (let i = 0; i <= 2 * m; i += 1) {
      const x = i === 0 ? x0 + eps : i === 2 * m ? x1 - eps : x0 + h * i;
      const v = wave.fn((Math.PI * x) / L);
      fv[i] = Number.isFinite(v) ? v : 0;
    }
    let sumOdd = 0;
    let sumEven = 0;
    for (let i = 1; i < 2 * m; i += 1) {
      if (i % 2 === 1) sumOdd += fv[i]!;
      else sumEven += fv[i]!;
    }
    integralF += ((h / 3) * (fv[0]! + fv[2 * m]! + 4 * sumOdd + 2 * sumEven));

    for (let n = 1; n <= N; n += 1) {
      const w = (n * Math.PI) / L;
      let sc = fv[0]! * Math.cos(w * x0) + fv[2 * m]! * Math.cos(w * x1);
      let ss = fv[0]! * Math.sin(w * x0) + fv[2 * m]! * Math.sin(w * x1);
      for (let i = 1; i < 2 * m; i += 1) {
        const val = fv[i]! * (i % 2 === 1 ? 4 : 2);
        const x = x0 + h * i;
        sc += val * Math.cos(w * x);
        ss += val * Math.sin(w * x);
      }
      a[n - 1] = a[n - 1]! + (sc * h) / (3 * L);
      b[n - 1] = b[n - 1]! + (ss * h) / (3 * L);
    }
  }

  return { L, N, a0: integralF / L, a, b };
}

// ---- partial sums ------------------------------------------------------------

export type SumMode = 'partial' | 'fejer';

/**
 * Evaluate the truncated Fourier series at x.
 * `partial` → plain N-term sum; `fejer` → Fejér mean (Cesàro weights
 * 1 − n/(N+1)), which converges uniformly and never overshoots.
 */
export function evalFourierSum(c: FourierCoeffs, x: number, mode: SumMode): number {
  const w0 = Math.PI / c.L;
  let s = c.a0 / 2;
  for (let n = 1; n <= c.N; n += 1) {
    const w = w0 * n;
    const k = mode === 'fejer' ? 1 - n / (c.N + 1) : 1;
    s += k * (c.a[n - 1]! * Math.cos(w * x) + c.b[n - 1]! * Math.sin(w * x));
  }
  return s;
}

/**
 * Relative L2 error ‖S − f‖₂/‖f‖₂ on [−L, L] via a midpoint sampling rule.
 * Midpoints of an even sample grid never coincide with the interior
 * discontinuities of the presets (x = 0) nor with the seams x = ±L.
 */
export function relativeL2Error(
  wave: WaveformDef,
  c: FourierCoeffs,
  mode: SumMode,
  samples = 4096,
): number {
  const h = (2 * c.L) / samples;
  let err2 = 0;
  let ref2 = 0;
  for (let i = 0; i < samples; i += 1) {
    const x = -c.L + (i + 0.5) * h;
    const f0 = wave.fn((Math.PI * x) / c.L);
    const s = evalFourierSum(c, x, mode);
    err2 += (s - f0) * (s - f0);
    ref2 += f0 * f0;
  }
  return ref2 <= 0 ? 0 : Math.sqrt(err2 / ref2);
}

// ---- Gibbs phenomenon ----------------------------------------------------------

/** Si(π) from its entire power series Σ (−1)^k π^(2k+1)/((2k+1)(2k+1)!). */
export const SI_PI: number = (() => {
  let sum = 0;
  let k = 0;
  for (;;) {
    const num = Math.pow(Math.PI, 2 * k + 1);
    const den = (2 * k + 1) * factorial(2 * k + 1);
    const term = (k % 2 === 0 ? 1 : -1) * (num / den);
    sum += term;
    if (Math.abs(term) < 1e-18) break;
    k += 1;
    if (k > 60) break;
  }
  return sum;
})();

/** Classical Gibbs overshoot constant 2·Si(π)/π ≈ 1.17898 (Bôcher, 1906). */
export const GIBBS_RATIO: number = (2 * SI_PI) / Math.PI;

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i += 1) f *= i;
  return f;
}

/**
 * Gibbs overshoot ratio of the plain partial sum: the maximum of S_N in a
 * window around the waveform's largest jump, divided by the upper one-sided
 * jump level. For the square/sawtooth presets the limit as N → ∞ is
 * 2·Si(π)/π ≈ 1.17898. Returns null for smooth waveforms.
 */
export function gibbsOvershootRatio(c: FourierCoeffs, wave: WaveformDef): number | null {
  if (wave.jumpU === null || wave.jumpHi === 0) return null;
  const d = c.L / (c.N + 1); // first partial-sum extremum sits ≈ d from the jump
  let x0: number;
  let x1: number;
  if (wave.jumpU === 0) {
    x0 = 1e-9 * c.L;
    x1 = 4 * d;
  } else {
    // Jump at the periodic seam x = ±L: probe just left of +L.
    x1 = c.L * (1 - 1e-9);
    x0 = x1 - 4 * d;
  }
  const samples = 2000;
  let maxS = -Infinity;
  for (let i = 0; i <= samples; i += 1) {
    const x = x0 + ((x1 - x0) * i) / samples;
    const s = evalFourierSum(c, x, 'partial');
    if (Number.isFinite(s) && s > maxS) maxS = s;
  }
  return maxS / wave.jumpHi;
}

/**
 * Fejér overshoot: max of the Fejér mean minus the waveform's global maximum,
 * sampled on a midpoint grid over [−L, L]. Because the Fejér kernel is
 * positive and integrates to one, the mean is a convex combination of function
 * values, so this is ≤ 0 up to floating-point noise — the numerical stamp of
 * "uniform convergence without overshoot".
 */
export function fejerOvershoot(wave: WaveformDef, c: FourierCoeffs, samples = 2048): number {
  const h = (2 * c.L) / samples;
  let maxF = -Infinity;
  let maxS = -Infinity;
  for (let i = 0; i < samples; i += 1) {
    const x = -c.L + (i + 0.5) * h;
    const u = (Math.PI * x) / c.L;
    const f0 = wave.fn(u);
    const s = evalFourierSum(c, x, 'fejer');
    if (Number.isFinite(f0) && f0 > maxF) maxF = f0;
    if (Number.isFinite(s) && s > maxS) maxS = s;
  }
  return maxS - maxF;
}

// ---- Parseval identity ----------------------------------------------------------

/**
 * Parseval residual: |E − I₂|/I₂ where E = a₀²/2 + Σ(a_n² + b_n²) is the
 * coefficient energy and I₂ = (1/L)∫f²dx is computed by the same jump-split
 * Simpson rule. For a complete series E = I₂ exactly; truncation at N leaves
 * the tail energy as the residual.
 */
export function parsevalResidual(wave: WaveformDef, c: FourierCoeffs, panelsPerSegment = 800): number {
  const i2 = integralOfSquare(wave, c.L, panelsPerSegment);
  let energy = (c.a0 * c.a0) / 2;
  for (let n = 1; n <= c.N; n += 1) {
    energy += c.a[n - 1]! * c.a[n - 1]! + c.b[n - 1]! * c.b[n - 1]!;
  }
  return i2 > 0 ? Math.abs(energy - i2) / i2 : 0;
}

/** (1/L)∫f²dx by jump-split composite Simpson (exact for the quadratic f²). */
export function integralOfSquare(wave: WaveformDef, L: number, panelsPerSegment = 800): number {
  const m = Math.max(2, panelsPerSegment - (panelsPerSegment % 2));
  const edges = [-L];
  for (const u of wave.breaks) {
    const x = (u * L) / Math.PI;
    if (x > -L && x < L) edges.push(x);
  }
  edges.push(L);
  edges.sort((p, q) => p - q);
  let total = 0;
  for (let s = 0; s + 1 < edges.length; s += 1) {
    const x0 = edges[s]!;
    const x1 = edges[s + 1]!;
    // 2m+1 Simpson nodes must span exactly [x0, x1] (m Simpson panels);
    // endpoints take the one-sided limit from inside the segment.
    const h = (x1 - x0) / (2 * m);
    const eps = h * 1e-6;
    let sumOdd = 0;
    let sumEven = 0;
    for (let i = 1; i < 2 * m; i += 1) {
      const v = wave.fn((Math.PI * (x0 + h * i)) / L);
      const v2 = Number.isFinite(v) ? v * v : 0;
      if (i % 2 === 1) sumOdd += v2;
      else sumEven += v2;
    }
    const gL = wave.fn((Math.PI * (x0 + eps)) / L);
    const gR = wave.fn((Math.PI * (x1 - eps)) / L);
    const g0 = Number.isFinite(gL) ? gL * gL : 0;
    const g1 = Number.isFinite(gR) ? gR * gR : 0;
    total += (h / 3) * (g0 + g1 + 4 * sumOdd + 2 * sumEven);
  }
  return total / L;
}

// ---- analytic references ----------------------------------------------------------

/**
 * Closed-form Fourier coefficients of the piecewise presets (normalized
 * amplitude ±1 profiles above); null for waveforms without a simple form.
 *   square   b_n = 4/(πn) for odd n, else 0
 *   triangle a_n = 8/(π²n²) for odd n, else 0
 *   sawtooth b_n = 2(−1)^(n+1)/(πn)
 */
export function analyticCoeff(wave: WaveformId, n: number): { a: number; b: number } | null {
  if (n < 1) return null;
  const odd = n % 2 === 1;
  switch (wave) {
    case 'square':
      return { a: 0, b: odd ? 4 / (Math.PI * n) : 0 };
    case 'triangle':
      return { a: odd ? 8 / (Math.PI * Math.PI * n * n) : 0, b: 0 };
    case 'sawtooth':
      return { a: 0, b: (2 * (odd ? 1 : -1)) / (Math.PI * n) };
    default:
      return null;
  }
}

/**
 * (1/L)∫f²dx of the presets in closed form: square 2, triangle 2/3,
 * sawtooth 2/3; null for `custom`.
 */
export function analyticL2Norm(wave: WaveformId): number | null {
  switch (wave) {
    case 'square':
      return 2;
    case 'triangle':
      return 2 / 3;
    case 'sawtooth':
      return 2 / 3;
    default:
      return null;
  }
}

/**
 * Exact L2 tail of the truncation error via Parseval's identity applied to the
 * analytic coefficients: ‖f − S_N‖₂ = √(Σ_{n>N}(a_n² + b_n²)) (with the (1/L)
 * normalization). Null when the waveform has no closed form.
 */
export function analyticTailL2(wave: WaveformId, N: number, nMax = 2048): number | null {
  if (analyticL2Norm(wave) === null) return null;
  let sum = 0;
  for (let n = N + 1; n <= nMax; n += 1) {
    const cf = analyticCoeff(wave, n);
    if (!cf) break;
    sum += cf.a * cf.a + cf.b * cf.b;
  }
  return Math.sqrt(sum);
}

// ---- embedded validation benchmarks ------------------------------------------------

export const FOURIER_BENCHMARK_ID = 'fourier-series-benchmarks';
/** N used by the embedded benchmark suite (matches the Gibbs spec point). */
export const FOURIER_BENCH_N = 64;

export interface FourierBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  passed: boolean;
  /** Unified relative error |computed − analytic|/|analytic| (or raw residual). */
  relErr: number;
  /** Measured headline number (coefficient error, ratio, residual, …). */
  measured: number;
  /** Analytic reference value. */
  reference: number;
  detailEn: string;
  detailZh: string;
}

/** Tolerance for the coefficient benchmarks (spec: < 1e-4). */
const COEFF_TOL = 1e-4;
/** Tolerance for the Gibbs ratio at N = 64 (spec: < 1%). */
const GIBBS_TOL = 0.01;
/** Tolerance for the Fejér overshoot (spec: < 1e-6). */
const FEJER_TOL = 1e-6;
/** Tolerance for the Parseval residual (spec: < 1%). */
const PARSEVAL_TOL = 0.01;

/**
 * Run the embedded validation suite at N = 64 with a high-accuracy quadrature
 * (4000 Simpson panels per smooth segment). Every check uses the unified
 * relative-error metric against the analytic reference.
 */
export function runFourierBenchmarks(): FourierBenchmark[] {
  const N = FOURIER_BENCH_N;
  const panels = 4000;
  const out: FourierBenchmark[] = [];

  // ① Square wave: b_n = 4/(πn) for odd n.
  const sq = computeFourierCoeffs(WAVEFORMS.square, Math.PI, N, panels);
  let sqErr = 0;
  for (let n = 1; n <= N; n += 2) {
    const ref = analyticCoeff('square', n)!.b;
    sqErr = Math.max(sqErr, Math.abs(sq.b[n - 1]! - ref) / Math.abs(ref));
  }
  out.push({
    id: 'square-coeff',
    labelEn: 'Square b_n = 4/(nπ) vs Simpson',
    labelZh: '方波 b_n = 4/(nπ) 解析对照',
    passed: sqErr < COEFF_TOL,
    relErr: sqErr,
    measured: sq.b[0]!,
    reference: analyticCoeff('square', 1)!.b,
    detailEn: `max relative error over odd n ≤ ${N}: ${sqErr.toExponential(2)}`,
    detailZh: `奇数 n ≤ ${N} 的最大相对误差：${sqErr.toExponential(2)}`,
  });

  // ② Triangle wave: a_n = 8/(π²n²) for odd n.
  const tr = computeFourierCoeffs(WAVEFORMS.triangle, Math.PI, N, panels);
  let trErr = 0;
  for (let n = 1; n <= N; n += 2) {
    const ref = analyticCoeff('triangle', n)!.a;
    trErr = Math.max(trErr, Math.abs(tr.a[n - 1]! - ref) / Math.abs(ref));
  }
  out.push({
    id: 'triangle-coeff',
    labelEn: 'Triangle a_n = 8/(π²n²) vs Simpson',
    labelZh: '三角波 a_n = 8/(π²n²) 解析对照',
    passed: trErr < COEFF_TOL,
    relErr: trErr,
    measured: tr.a[0]!,
    reference: analyticCoeff('triangle', 1)!.a,
    detailEn: `max relative error over odd n ≤ ${N}: ${trErr.toExponential(2)}`,
    detailZh: `奇数 n ≤ ${N} 的最大相对误差：${trErr.toExponential(2)}`,
  });

  // ③ Gibbs overshoot ratio vs 2·Si(π)/π ≈ 1.17898 at N = 64.
  const ratio = gibbsOvershootRatio(sq, WAVEFORMS.square) ?? NaN;
  const gibbsErr = Math.abs(ratio - GIBBS_RATIO) / GIBBS_RATIO;
  out.push({
    id: 'gibbs-ratio',
    labelEn: 'Gibbs overshoot vs 2·Si(π)/π',
    labelZh: 'Gibbs 过冲比例对照 2·Si(π)/π',
    passed: gibbsErr < GIBBS_TOL,
    relErr: gibbsErr,
    measured: ratio,
    reference: GIBBS_RATIO,
    detailEn: `measured ${ratio.toFixed(5)} vs ${GIBBS_RATIO.toFixed(5)} (Bôcher 1906), rel err ${(
      gibbsErr * 100
    ).toFixed(3)}%`,
    detailZh: `实测 ${ratio.toFixed(5)} 对照 ${GIBBS_RATIO.toFixed(5)}（Bôcher 1906），相对误差 ${(
      gibbsErr * 100
    ).toFixed(3)}%`,
  });

  // ④ Fejér means are overshoot-free (positive-kernel convex argument).
  const fejer = fejerOvershoot(WAVEFORMS.square, sq);
  out.push({
    id: 'fejer-overshoot',
    labelEn: 'Fejér mean overshoot-free',
    labelZh: 'Fejér 平均无过冲',
    passed: fejer < FEJER_TOL,
    relErr: Math.max(0, fejer),
    measured: fejer,
    reference: 0,
    detailEn: `max(σ_N − max f) = ${fejer.toExponential(2)} (must be < 1e-6)`,
    detailZh: `max(σ_N − max f) = ${fejer.toExponential(2)}（须 < 1e-6）`,
  });

  // ⑤ Parseval identity residual < 1% at N = 64.
  const resid = parsevalResidual(WAVEFORMS.square, sq);
  out.push({
    id: 'parseval-residual',
    labelEn: 'Parseval residual < 1%',
    labelZh: 'Parseval 等式残差 < 1%',
    passed: resid < PARSEVAL_TOL,
    relErr: resid,
    measured: resid,
    reference: 0,
    detailEn: `|Σcoef² − (1/π)∫f²|/∫f² = ${(resid * 100).toFixed(3)}% (N = ${N})`,
    detailZh: `|Σ系数² − (1/π)∫f²|/∫f² = ${(resid * 100).toFixed(3)}%（N = ${N}）`,
  });

  // Bonus cross-check: sampled relative L2 error vs the exact Parseval tail.
  const norm2 = analyticL2Norm('square');
  const tail = analyticTailL2('square', N);
  if (norm2 !== null && tail !== null) {
    const theory = tail / Math.sqrt(norm2);
    const sampled = relativeL2Error(WAVEFORMS.square, sq, 'partial');
    const l2Err = Math.abs(sampled - theory) / theory;
    out.push({
      id: 'l2-vs-tail',
      labelEn: 'Sampled L2 err vs Parseval tail',
      labelZh: '采样 L2 误差对照 Parseval 尾项',
      passed: l2Err < 1e-3,
      relErr: l2Err,
      measured: sampled,
      reference: theory,
      detailEn: `sampled ${sampled.toExponential(3)} vs exact tail ${theory.toExponential(3)}`,
      detailZh: `采样 ${sampled.toExponential(3)} 对照精确尾项 ${theory.toExponential(3)}`,
    });
  }

  return out;
}
