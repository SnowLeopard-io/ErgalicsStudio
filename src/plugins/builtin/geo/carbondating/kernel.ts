// ==========================================================================
// geo-carbondating — radiocarbon dating numerics (pure, dependency-free)
//
// Three research-grade layers:
//   1. Libby conventional radiocarbon age: t = -8033·ln(F14C) yr BP (BP = 1950,
//      Libby half-life 5568 yr → mean life 8033 yr).
//   2. Calibration against an atmospheric curve (IntCal20 excerpt): a
//      likelihood profile of the measurement over the curve grid — χ²(F) =
//      ((F_meas − F_curve(calBP)) / σ_tot)² with combined measurement + curve
//      uncertainty — then the χ²-minimum best fit and 1σ/2σ ranges from the
//      standard Δχ² ≤ 1 / Δχ² ≤ 4 thresholds. Wiggles can produce several
//      disjoint calibrated ranges; all are reported.
//   3. Multi-sample combination: inverse-variance weighted mean F14C with a
//      reduced-χ² homogeneity screen.
//
// All functions are pure so the kernel unit-tests without a canvas or DOM.
// ========================================================================

import { mulberry32 } from '@/core/repro/random';

/** Conventional Libby half-life in years. */
export const LIBBY_HALF_LIFE = 5568;
/** Radiocarbon mean life λ⁻¹ = 5568 / ln(2) ≈ 8033 yr, the constant in t = −8033·ln(F14C). */
export const MEAN_LIFE_14C = 8033;

/** Present reference year for BP ages. */
export const BP_REFERENCE_YEAR = 1950;

/** Conventional radiocarbon age from F14C: t = −8033·ln(F). Non-positive F → NaN. */
export function libbyAgeFromF14C(f14c: number): number {
  if (!(f14c > 0)) return Number.NaN;
  return -MEAN_LIFE_14C * Math.log(f14c);
}

/** F14C from a conventional radiocarbon age: F = exp(−t / 8033). */
export function f14cFromRadiocarbonAge(ageBp: number): number {
  return Math.exp(-ageBp / MEAN_LIFE_14C);
}

/**
 * Error propagation of F14C ± σ_F to a radiocarbon age ± σ_t.
 * t = −8033·ln(F) → σ_t = 8033·σ_F / F.
 */
export function uncalibratedAge(f14c: number, sigmaF14c: number): { age: number; sigma: number } {
  const age = libbyAgeFromF14C(f14c);
  return { age, sigma: f14c > 0 ? (MEAN_LIFE_14C * sigmaF14c) / f14c : Number.NaN };
}

// ---- calibration curve ------------------------------------------------------

/** One calibration-curve row. `sigmaF14c` is the curve uncertainty in F14C units. */
export interface CalibrationPoint {
  calBP: number;
  f14c: number;
  sigmaF14c: number;
}

/** Interpolation mode across curve rows. */
export type InterpMode = 'linear' | 'step';

/** Maximum value allowed in the age column when auto-detecting 14C age vs F14C columns. */
const F14C_COLUMN_MAX = 5;

/**
 * Parse a calibration curve from CSV / TSV / whitespace text.
 * Expected columns: `cal BP, 14C age, sigma` (IntCal20-style, ages in yr BP)
 * or `cal BP, F14C, sigma_F14C`. `#` comment lines and one header row are
 * skipped; the age-vs-F14C mode is auto-detected from the column magnitudes.
 * Rows are sorted by cal BP (ascending) and deduplicated.
 */
export function parseCalibrationCurve(text: string): CalibrationPoint[] {
  const rows: Array<{ calBP: number; value: number; sigma: number }> = [];
  let sawHeader = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const cells = line.split(/[,;\t]| +/).map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 3) {
      sawHeader = true; // tolerate a 2-column header row
      continue;
    }
    const calBP = Number(cells[0]);
    const value = Number(cells[1]);
    const sigma = Number(cells[2]);
    if (!Number.isFinite(calBP) || !Number.isFinite(value) || !Number.isFinite(sigma)) {
      if (!sawHeader) sawHeader = true; // first non-numeric line = header
      continue;
    }
    rows.push({ calBP, value, sigma });
  }
  let ageMode = false;
  for (const r of rows) {
    if (r.value > F14C_COLUMN_MAX) {
      ageMode = true;
      break;
    }
  }
  const points = rows.map((r) => ({
    calBP: r.calBP,
    f14c: ageMode ? f14cFromRadiocarbonAge(r.value) : r.value,
    sigmaF14c: ageMode ? (f14cFromRadiocarbonAge(r.value) * r.sigma) / MEAN_LIFE_14C : r.sigma,
  }));
  points.sort((a, b) => a.calBP - b.calBP);
  const deduped: CalibrationPoint[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (last && last.calBP === p.calBP) continue;
    deduped.push(p);
  }
  return deduped;
}

export interface CurveSample {
  f14c: number;
  sigmaF14c: number;
  /** True when calBP lies outside the loaded range and the nearest edge value was clamped. */
  clamped: boolean;
}

/**
 * Evaluate the calibration curve at a calendar age. Linear interpolation
 * between the bracketing rows (`linear`) or the value of the lower bracketing
 * row (`step`). Outside the loaded range the nearest edge value is returned
 * with `clamped = true`.
 */
export function curveF14CAt(curve: CalibrationPoint[], calBP: number, mode: InterpMode = 'linear'): CurveSample {
  if (curve.length === 0) return { f14c: Number.NaN, sigmaF14c: Number.NaN, clamped: true };
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (calBP <= first.calBP) return { f14c: first.f14c, sigmaF14c: first.sigmaF14c, clamped: calBP < first.calBP };
  if (calBP >= last.calBP) return { f14c: last.f14c, sigmaF14c: last.sigmaF14c, clamped: calBP > last.calBP };

  // Binary search for the bracketing interval: curve[i].calBP <= calBP < curve[i+1].calBP
  let lo = 0;
  let hi = curve.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid]!.calBP <= calBP) lo = mid;
    else hi = mid;
  }
  const a = curve[lo]!;
  const b = curve[hi]!;
  if (mode === 'step') return { f14c: a.f14c, sigmaF14c: a.sigmaF14c, clamped: false };
  const w = (calBP - a.calBP) / (b.calBP - a.calBP);
  return {
    f14c: a.f14c + w * (b.f14c - a.f14c),
    sigmaF14c: a.sigmaF14c + w * (b.sigmaF14c - a.sigmaF14c),
    clamped: false,
  };
}

// ---- likelihood calibration --------------------------------------------------

export interface Chi2Point {
  calBP: number;
  /** χ² of the measurement against the curve at this calendar age. */
  chi2: number;
  /** Relative likelihood exp(−Δχ²/2), normalised to 1 at the best fit. */
  relProb: number;
}

export interface CalibratedRange {
  /** Inclusive calendar-age bounds in cal yr BP (start < end). */
  from: number;
  to: number;
  /** Minimum χ² inside the range (per-segment best). */
  chi2: number;
}

export interface CalibrationResult {
  /** Calendar age of the χ² minimum (cal yr BP). */
  bestFitCalBP: number;
  chi2Min: number;
  /** Δχ² ≤ 1 (≈68%) contiguous calendar ranges. */
  interval1: CalibratedRange[];
  /** Δχ² ≤ 4 (≈95%) contiguous calendar ranges. */
  interval2: CalibratedRange[];
  /** Full likelihood profile over the loaded curve grid. */
  profile: Chi2Point[];
}

export interface CalibrationOptions {
  mode?: InterpMode;
  /** Include the curve's own σ in the total uncertainty (default true). */
  includeCurveSigma?: boolean;
}

/**
 * Likelihood-profile calibration of one F14C measurement against a loaded
 * curve. For every grid row the total variance combines the measurement and
 * curve uncertainties; the best fit is the χ² minimum and the 1σ/2σ ranges
 * are the contiguous grid segments with Δχ² ≤ 1 / ≤ 4.
 */
export function calibrateF14C(
  curve: CalibrationPoint[],
  measF14c: number,
  measSigma: number,
  opts?: CalibrationOptions,
): CalibrationResult | null {
  if (curve.length < 2 || !(measSigma > 0) || !Number.isFinite(measF14c)) return null;
  const includeCurveSigma = opts?.includeCurveSigma ?? true;

  const profile: Chi2Point[] = [];
  let bestIdx = -1;
  let chi2Min = Number.POSITIVE_INFINITY;
  for (const p of curve) {
    const sigmaTot = includeCurveSigma
      ? Math.sqrt(measSigma * measSigma + p.sigmaF14c * p.sigmaF14c)
      : measSigma;
    const d = (measF14c - p.f14c) / sigmaTot;
    const chi2 = d * d;
    profile.push({ calBP: p.calBP, chi2, relProb: 0 });
    if (chi2 < chi2Min) {
      chi2Min = chi2;
      bestIdx = profile.length - 1;
    }
  }
  if (bestIdx < 0) return null;
  for (const pt of profile) pt.relProb = Math.exp(-0.5 * (pt.chi2 - chi2Min));

  const interval1 = rangesForDelta(profile, chi2Min, 1);
  const interval2 = rangesForDelta(profile, chi2Min, 4);
  return {
    bestFitCalBP: profile[bestIdx]!.calBP,
    chi2Min,
    interval1,
    interval2,
    profile,
  };
}

/** Contiguous grid runs with χ² − χ²min ≤ delta, reported as inclusive cal-BP ranges. */
function rangesForDelta(profile: Chi2Point[], chi2Min: number, delta: number): CalibratedRange[] {
  const out: CalibratedRange[] = [];
  let open: { from: number; chi2: number } | null = null;
  for (const pt of profile) {
    const within = pt.chi2 - chi2Min <= delta;
    if (within && !open) {
      open = { from: pt.calBP, chi2: pt.chi2 };
    } else if (!within && open) {
      out.push(closeRange(open, pt.calBP));
      open = null;
    } else if (within && open && pt.chi2 < open.chi2) {
      open.chi2 = pt.chi2;
    }
  }
  const last = profile[profile.length - 1];
  if (open && last) out.push(closeRange(open, last.calBP));
  return out;
}

function closeRange(open: { from: number; chi2: number }, to: number): CalibratedRange {
  return { from: open.from, to, chi2: open.chi2 };
}

// ---- multi-sample combination ------------------------------------------------

export interface SampleInput {
  f14c: number;
  sigma: number;
}

export interface CombinedSample {
  f14c: number;
  sigma: number;
  n: number;
  /** Reduced χ² of the scatter about the weighted mean (null when n < 2). */
  chi2Red: number | null;
}

/** Inverse-variance weighted mean F14C of several measurements. */
export function combineF14C(samples: SampleInput[]): CombinedSample | null {
  const valid = samples.filter((s) => s.f14c > 0 && s.sigma > 0 && Number.isFinite(s.f14c) && Number.isFinite(s.sigma));
  if (valid.length === 0) return null;
  let wSum = 0;
  let fSum = 0;
  for (const s of valid) {
    const w = 1 / (s.sigma * s.sigma);
    wSum += w;
    fSum += w * s.f14c;
  }
  const f = fSum / wSum;
  const sigma = 1 / Math.sqrt(wSum);
  let chi2Red: number | null = null;
  if (valid.length >= 2) {
    let chi2 = 0;
    for (const s of valid) {
      const d = (s.f14c - f) / s.sigma;
      chi2 += d * d;
    }
    chi2Red = chi2 / (valid.length - 1);
  }
  return { f14c: f, sigma, n: valid.length, chi2Red };
}

// ---- seeded demo + validation benchmarks --------------------------------------

/**
 * Deterministic demo measurement: the curve value at `calBP` perturbed by one
 * seeded normal draw with the curve's own σ (typical lab precision), so the
 * calibration recovers ≈ calBP.
 */
export function demoMeasurement(curve: CalibrationPoint[], calBP = 3050, seed = 3050): SampleInput | null {
  const s = curveF14CAt(curve, calBP, 'linear');
  if (!Number.isFinite(s.f14c)) return null;
  const rand = mulberry32(seed >>> 0);
  // Box-Muller
  let u = 0;
  do {
    u = rand();
  } while (u <= 1e-12);
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  return { f14c: s.f14c + z * s.sigmaF14c, sigma: s.sigmaF14c };
}

export interface BenchmarkOutcome {
  name: string;
  passed: boolean;
  /** Observed relative error against the analytic reference (when defined). */
  relErr: number | null;
  detail: string;
}

/** Benchmark 1: Libby law — F14C = 0.5 must give 5568 yr (one half-life) within 0.1%. */
export function benchmarkLibby(): BenchmarkOutcome {
  const t = libbyAgeFromF14C(0.5);
  const relErr = Math.abs(t - LIBBY_HALF_LIFE) / LIBBY_HALF_LIFE;
  return {
    name: 'libby-age',
    passed: relErr < 1e-3,
    relErr,
    detail: `t(0.5) = ${t.toFixed(3)} yr, reference 5568 yr, rel err ${(relErr * 100).toFixed(4)}%`,
  };
}

/**
 * Benchmark 2: curve round-trip — official IntCal20 anchor (cal BP 3050 ↔
 * 14C age 2897 ± 18, Reimer et al. 2020). Convert the anchor to F14C, calibrate
 * with its σ, and the best-fit calendar age must return to 3050 within 0.1%
 * (Δχ² profile minimum sits on the anchor row).
 */
export const INT_CAL20_ANCHOR = { calBP: 3050, age14C: 2897, sigma: 18 } as const;

export function benchmarkCurveAnchor(curve: CalibrationPoint[]): BenchmarkOutcome {
  const f = f14cFromRadiocarbonAge(INT_CAL20_ANCHOR.age14C);
  const sigmaF = (f * INT_CAL20_ANCHOR.sigma) / MEAN_LIFE_14C;
  const res = calibrateF14C(curve, f, sigmaF, { mode: 'linear', includeCurveSigma: true });
  if (!res) {
    return { name: 'intcal20-anchor', passed: false, relErr: null, detail: 'calibration failed (curve too small?)' };
  }
  const relErr = Math.abs(res.bestFitCalBP - INT_CAL20_ANCHOR.calBP) / INT_CAL20_ANCHOR.calBP;
  return {
    name: 'intcal20-anchor',
    passed: relErr < 1e-3,
    relErr,
    detail: `best fit ${res.bestFitCalBP.toFixed(1)} cal BP, anchor ${INT_CAL20_ANCHOR.calBP}, rel err ${(relErr * 100).toFixed(4)}%`,
  };
}

/**
 * Benchmark 3: interpolation sanity — monotone within every bracketing
 * segment, exact reproduction of grid rows, and edge clamping outside the
 * loaded range. Reports the worst observed violation (0 = perfect).
 */
export function benchmarkInterpolation(curve: CalibrationPoint[]): BenchmarkOutcome {
  if (curve.length < 3) {
    return { name: 'interp-monotone', passed: false, relErr: null, detail: 'curve too short' };
  }
  let worst = 0;
  for (let i = 0; i + 1 < curve.length; i += 1) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    const mid = 0.5 * (a.calBP + b.calBP);
    const fm = curveF14CAt(curve, mid, 'linear').f14c;
    // Monotone within the segment: fm must lie between Fa and Fb.
    const lo = Math.min(a.f14c, b.f14c);
    const hi = Math.max(a.f14c, b.f14c);
    const span = Math.max(hi - lo, 1e-12);
    const viol = Math.max(0, lo - fm, fm - hi) / span;
    if (viol > worst) worst = viol;
    // Grid rows must be reproduced exactly.
    const relA = Math.abs(curveF14CAt(curve, a.calBP, 'linear').f14c - a.f14c) / Math.max(Math.abs(a.f14c), 1e-12);
    const relB = Math.abs(curveF14CAt(curve, b.calBP, 'linear').f14c - b.f14c) / Math.max(Math.abs(b.f14c), 1e-12);
    worst = Math.max(worst, relA, relB);
  }
  // Boundary handling: outside the range must clamp, not extrapolate.
  const edgeLow = curveF14CAt(curve, curve[0]!.calBP - 100, 'linear');
  const edgeHigh = curveF14CAt(curve, curve[curve.length - 1]!.calBP + 100, 'linear');
  const clampedOk = edgeLow.clamped && edgeHigh.clamped && edgeLow.f14c === curve[0]!.f14c && edgeHigh.f14c === curve[curve.length - 1]!.f14c;
  if (!clampedOk) worst = Math.max(worst, 1);
  return {
    name: 'interp-monotone',
    passed: worst < 1e-9,
    relErr: worst,
    detail: clampedOk ? `worst violation ${worst.toExponential(2)}` : 'boundary clamp failed',
  };
}
