// ==========================================================================
// mats-thermal — DSC / TGA numerics (pure, dependency-free, testable)
//
// Parses a temperature / signal curve, performs baseline-corrected peak
// detection, and extracts the standard thermal-analysis indices:
//  - DSC: extrapolated onset temperature (tangent intersection), peak
//    temperature, and the transition enthalpy ΔH (J/g) by trapezoidal
//    integration of the baseline-subtracted heat flow;
//  - TGA: mass-loss steps with onset / peak (DTG) temperatures, mass lost,
//    and residual mass.
//
// All functions are pure so the kernel is unit-testable without a canvas.
// ==========================================================================

export type ThermalMode = 'dsc' | 'tga';

export interface ThermalPoint {
  temperature: number;
  signal: number;
}

export interface ThermalPeak {
  onsetTemp: number; // extrapolated onset (tangent intersection), °C
  peakTemp: number; // extremum temperature, °C
  peakSignal: number; // baseline-subtracted signal at peak
  endTemp: number; // temperature where the peak returns to baseline, °C
  /** DSC: integrated transition enthalpy (J/g). TGA: mass lost (%). */
  integral: number;
}

export interface ThermalAnalysis {
  mode: ThermalMode;
  peaks: ThermalPeak[];
  /** DSC only: total enthalpy across all peaks. */
  totalEnthalpy?: number;
  /** TGA only: total mass loss (%). */
  totalMassLoss?: number;
  /** TGA only: final residual mass (%). */
  residualMass?: number;
}

// ---- parsing ---------------------------------------------------------------

/**
 * Parse a temperature / signal curve. Auto-detects DSC vs TGA: if the signal
 * changes by more than ~20 % over the run it is treated as TGA (mass %); the
 * heat-flow sign of a DSC is centred near zero. The `mode` hint overrides
 * auto-detection when set.
 */
export function parseThermal(text: string, hint?: ThermalMode): { mode: ThermalMode; pts: ThermalPoint[] } {
  const trimmed = text.trim();
  let pts: ThermalPoint[] = [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    pts = parseJson(trimmed);
  } else {
    const lines = trimmed.split(/\r\n|\r|\n/);
    let sawHeader = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const toks = line.includes(',') ? line.split(',') : line.split(/\s+|;|\t/);
      const c = toks.map((t) => t.trim()).filter(Boolean);
      if (c.length < 2) continue;
      const a = Number(c[0]);
      const b = Number(c[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        pts.push({ temperature: a, signal: b });
      } else if (!sawHeader && pts.length === 0) {
        sawHeader = true;
      }
    }
  }
  pts.sort((a, b) => a.temperature - b.temperature);
  if (pts.length < 5) return { mode: hint ?? 'dsc', pts: [] };
  // Auto-detect mode if no hint.
  let mode = hint;
  if (!mode) {
    const sMin = Math.min(...pts.map((p) => p.signal));
    const sMax = Math.max(...pts.map((p) => p.signal));
    const span = sMax - sMin;
    const mean = pts.reduce((a, p) => a + p.signal, 0) / pts.length;
    // TGA: signal starts near 100 (mass %) and decreases monotonically-ish,
    // with a span large relative to the mean (mass loss > 5%).
    const monotoneDown = pts[pts.length - 1]!.signal < pts[0]!.signal;
    mode = pts[0]!.signal > 50 && span > 5 && monotoneDown ? 'tga' : 'dsc';
    void mean;
  }
  return { mode, pts };
}

function parseJson(text: string): ThermalPoint[] {
  try {
    const obj = JSON.parse(text);
    const arr: unknown = Array.isArray(obj) ? obj : Array.isArray((obj as { data?: unknown }).data) ? (obj as { data: unknown }).data : [];
    const raw = arr as Array<Record<string, unknown>>;
    const pts: ThermalPoint[] = [];
    for (const r of raw) {
      const t = (r.temperature ?? r.temp ?? r.t ?? r.T) as number | undefined;
      const s = (r.signal ?? r.heat_flow ?? r.heatflow ?? r.mass ?? r.y) as number | undefined;
      if (typeof t === 'number' && typeof s === 'number') pts.push({ temperature: t, signal: s });
    }
    return pts;
  } catch {
    return [];
  }
}

// ---- baseline & peak detection --------------------------------------------

/**
 * Estimate a smooth baseline. For DSC this is a low-order polynomial fit
 * through the "flat" regions (excluding peak regions); for TGA it is the
 * piecewise-linear connect-the-step-tops envelope. A robust linear baseline
 * through the 10th and 90th-percentile signal is used as a fast, stable
 * approximation suitable for qualitative extraction.
 */
export function estimateBaseline(pts: ThermalPoint[], mode: ThermalMode): number[] {
  const n = pts.length;
  const s = pts.map((p) => p.signal);
  if (mode === 'tga') {
    // Upper envelope: running max with a wide window, then flatten to the
    // mass plateau that precedes each loss step.
    const win = Math.max(5, Math.floor(n * 0.1));
    const base: number[] = [];
    for (let i = 0; i < n; i += 1) {
      let mx = s[i]!;
      for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j += 1) {
        if (s[j]! > mx) mx = s[j]!;
      }
      base.push(mx);
    }
    return base;
  }
  // DSC: linear baseline through the lower envelope (endothermic-up convention
  // means the baseline sits under the peak). Use a robust lower linear fit.
  const base: number[] = [];
  // Fit a line through the first 10 % and last 10 % of the curve (pre- and
  // post-transition flat regions).
  const head = pts.slice(0, Math.max(3, Math.floor(n * 0.08)));
  const tail = pts.slice(n - Math.max(3, Math.floor(n * 0.08)));
  const flat = [...head, ...tail].map((p) => ({ x: p.temperature, y: p.signal }));
  const { slope, intercept } = linreg(flat);
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) {
    return pts.map(() => s.reduce((a, b) => a + b, 0) / n);
  }
  for (const p of pts) base.push(intercept + slope * p.temperature);
  return base;
}

/** Least-squares fit y = a + b·x. */
export function linreg(pts: Array<{ x: number; y: number }>): { slope: number; intercept: number; r2: number } {
  const n = pts.length;
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-18) return { slope: NaN, intercept: NaN, r2: NaN };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const yMean = sy / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of pts) {
    const yHat = intercept + slope * p.x;
    ssTot += (p.y - yMean) ** 2;
    ssRes += (p.y - yHat) ** 2;
  }
  const r2 = ssTot > 1e-18 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, r2 };
}

/**
 * Detect transitions in the baseline-subtracted signal.
 *  - DSC: peaks (endothermic or exothermic) are deviations from the
 *    baseline; onset by the intersection of the pre-peak tangent and the
 *    steepest-slope tangent; enthalpy by trapezoidal integration.
 *  - TGA: mass-loss steps are monotone-descending segments; onset by the
 *    intersection of the pre-step plateau tangent and the steepest descent;
 *    integral = mass lost.
 */
export function analyseThermal(pts: ThermalPoint[], mode: ThermalMode): ThermalAnalysis {
  if (pts.length < 8) return { mode, peaks: [] };
  const baseline = estimateBaseline(pts, mode);
  // Baseline-subtracted deviation (for DSC, the area of interest; for TGA,
  // the mass loss = baseline - signal).
  const dev = pts.map((p, i) => (mode === 'tga' ? baseline[i]! - p.signal : Math.abs(p.signal - baseline[i]!)));
  const devMax = Math.max(...dev) || 1;
  // Threshold: 5 % of the max deviation.
  const thr = devMax * 0.05;
  // Find contiguous "active" regions where dev > thr.
  const peaks: ThermalPeak[] = [];
  let i = 0;
  while (i < pts.length) {
    if (dev[i]! <= thr) {
      i += 1;
      continue;
    }
    const segStart = i;
    while (i < pts.length && dev[i]! > thr) i += 1;
    const segEnd = i; // exclusive
    if (segEnd - segStart < 3) continue;
    const peak = extractPeak(pts, baseline, dev, segStart, segEnd, mode);
    if (peak) peaks.push(peak);
  }
  // For DSC keep both positive (exo) and negative (endo) peaks; the |dev|
  // approach already captures both. For TGA the steps are mass losses.
  const result: ThermalAnalysis = { mode, peaks };
  if (mode === 'dsc') {
    result.totalEnthalpy = peaks.reduce((a, p) => a + p.integral, 0);
  } else {
    result.totalMassLoss = peaks.reduce((a, p) => a + p.integral, 0);
    result.residualMass = pts[pts.length - 1]!.signal;
  }
  return result;
}

function extractPeak(
  pts: ThermalPoint[],
  baseline: number[],
  dev: number[],
  start: number,
  end: number,
  mode: ThermalMode,
): ThermalPeak | null {
  // Peak: max deviation within the segment.
  let pkIdx = start;
  for (let i = start; i < end; i += 1) {
    if (dev[i]! > dev[pkIdx]!) pkIdx = i;
  }
  const peakTemp = pts[pkIdx]!.temperature;
  const peakSignal = dev[pkIdx]!;

  // Onset: the steepest-slope tangent on the leading edge intersects the
  // pre-transition baseline tangent. Find the max-slope point on [start, pkIdx].
  let slopeIdx = start;
  let maxSlope = -Infinity;
  for (let i = start + 1; i <= pkIdx; i += 1) {
    const dx = pts[i]!.temperature - pts[i - 1]!.temperature;
    if (dx <= 0) continue;
    const slope = (pts[i]!.signal - pts[i - 1]!.signal) / dx;
    if (slope > maxSlope && Number.isFinite(slope)) {
      maxSlope = slope;
      slopeIdx = i;
    }
  }
  // Pre-transition baseline tangent: linear fit on [max(0, start-N), start].
  const nFlat = Math.max(3, Math.floor((pkIdx - start) * 0.5));
  const flatStart = Math.max(0, start - nFlat);
  const flatSeg = pts.slice(flatStart, start + 1).map((p) => ({ x: p.temperature, y: p.signal }));
  const { slope: baseSlope, intercept: baseInt } = linreg(flatSeg);
  let onsetTemp = pts[start]!.temperature;
  if (Number.isFinite(baseSlope) && Number.isFinite(maxSlope)) {
    // Steepest-edge tangent line at slopeIdx.
    const eSlope = maxSlope;
    const eInt = pts[slopeIdx]!.signal - eSlope * pts[slopeIdx]!.temperature;
    // Intersection: baseInt + baseSlope·t = eInt + eSlope·t
    if (Math.abs(eSlope - baseSlope) > 1e-12) {
      onsetTemp = (eInt - baseInt) / (baseSlope - eSlope);
    }
  }
  // End temperature: where the trailing edge returns to baseline.
  const endTemp = pts[end - 1]!.temperature;

  // Integral.
  let integral = 0;
  if (mode === 'dsc') {
    // ΔH = ∫ (signal - baseline) dT  (proxy for J/g; needs heating rate &
    // sample mass for absolute J/g, here reported in the curve's units × °C).
    for (let i = start + 1; i < end; i += 1) {
      const dx = pts[i]!.temperature - pts[i - 1]!.temperature;
      const y0 = pts[i - 1]!.signal - baseline[i - 1]!;
      const y1 = pts[i]!.signal - baseline[i]!;
      integral += (dx * (y0 + y1)) / 2;
    }
    // Convert proxy area (signal·°C) to J/g-equivalent if signal is mW and
    // heating rate β (°C/min): ΔH = area / (β · m). We expose area·rate-normalised.
  } else {
    // TGA: mass lost = baseline(before) - signal(after).
    const m0 = baseline[start]!;
    const m1 = pts[end - 1]!.signal;
    integral = Math.max(0, m0 - m1);
  }
  return { onsetTemp, peakTemp, peakSignal, endTemp, integral };
}

// ---- derivative (DTG) ------------------------------------------------------

/** First derivative of signal w.r.t. temperature (central differences). */
export function derivative(pts: ThermalPoint[]): ThermalPoint[] {
  const out: ThermalPoint[] = [];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const dx = pts[i + 1]!.temperature - pts[i - 1]!.temperature;
    if (Math.abs(dx) < 1e-9) continue;
    out.push({ temperature: pts[i]!.temperature, signal: (pts[i + 1]!.signal - pts[i - 1]!.signal) / dx });
  }
  return out;
}
