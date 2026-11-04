// ==========================================================================
// Example plugin: Spatial Interpolation (IDW + Ordinary Kriging)
//
// Turns scattered station observations into a continuous surface — the
// classroom introduction to geostatistics.
//
//   IDW    : value(node) = Σ v_i / d_i^p  ÷  Σ 1 / d_i^p   (exact at stations)
//   OK     : solve the ordinary-kriging system [Γ 1; 1ᵀ 0]·[w; μ] = [γ0; 1]
//            with an auto-fitted variogram (grid-search over nugget/range,
//            spherical vs exponential by SSE). The augmented matrix is
//            inverted ONCE; per-node work is then a single O(N²) mat-vec.
//
// Kriging is capped at 400 stations to stay interactive (O(N²) per node);
// larger datasets fall back to IDW with a notice. Distances are great-circle
// kilometres so high-latitude longitude stretching is handled correctly.
// Scientific outputs (LOOCV R²/RMSE, Moran's I + p, kriging σ) are published
// through the science-output bus, and an embedded synthetic-field benchmark
// (seeded mulberry32 field with a KNOWN variogram) quantifies variogram
// parameter recovery — always labelled as a benchmark, never as user data.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  notify,
} from '@/core/plugin-tools/enhance';
import { heatmapColor } from '@/core/wgsl';
import { marchingSquares, haversineKm } from '../shared/geoCore';
import { isZh } from '@/core/plugin-tools/locale';
import { parseDelimited, stripHeaderIfNonNumeric } from '@/core/plugin-tools/table';
import { setScienceOutputs, clearScienceOutputs, fmtMetric } from '@/core/research/scienceOutput';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import { mulberry32 } from '@/core/repro/random';
import { pushPanelsToFigure, panelTag, panelPlace, FIGURE_PANEL_WIDTH, FIGURE_PANEL_HEIGHT } from '@/core/figure/sheet';
import type { FigurePanelSpec, Bilingual } from '@/core/figure/sheet';
import { spatialInterpManifest } from './manifest';

export { spatialInterpManifest } from './manifest';

// ---- Parsing & interpolation math (exported for tests) ---------------------

export interface InterpPoint {
  lon: number;
  lat: number;
  value: number;
  name?: string;
}

export interface Bounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export function parsePointsCsv(text: string): InterpPoint[] {
  const rows = stripHeaderIfNonNumeric(parseDelimited(text));
  const out: InterpPoint[] = [];
  for (const row of rows) {
    const lon = Number(row[0]);
    const lat = Number(row[1]);
    const value = Number(row[2]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(value)) continue;
    const name = row[3]?.trim();
    out.push({ lon, lat, value, name: name || undefined });
  }
  return out;
}

export function boundsOf(points: InterpPoint[], padFrac = 0.05): Bounds {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  const padLon = Math.max((maxLon - minLon) * padFrac, 1e-6);
  const padLat = Math.max((maxLat - minLat) * padFrac, 1e-6);
  return { minLon: minLon - padLon, maxLon: maxLon + padLon, minLat: minLat - padLat, maxLat: maxLat + padLat };
}

/** IDW estimate at one (lon, lat) from a station list (great-circle km). */
export function idwAt(points: InterpPoint[], lon: number, lat: number, power: number): number {
  const p = Math.max(0.5, power);
  let wSum = 0;
  let vSum = 0;
  for (const pt of points) {
    const d = haversineKm(lat, lon, pt.lat, pt.lon);
    if (d < 1e-6) return pt.value;
    const w = 1 / Math.pow(d, p);
    wSum += w;
    vSum += w * pt.value;
  }
  return vSum / wSum;
}

/** Inverse-distance-weighted gridding over a row-major field (row 0 = maxLat). */
export function idwGrid(points: InterpPoint[], cols: number, rows: number, bounds: Bounds, power: number): Float64Array {
  const field = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    const lat = bounds.maxLat - ((bounds.maxLat - bounds.minLat) * r) / (rows - 1);
    for (let c = 0; c < cols; c += 1) {
      const lon = bounds.minLon + ((bounds.maxLon - bounds.minLon) * c) / (cols - 1);
      field[r * cols + c] = idwAt(points, lon, lat, power);
    }
  }
  return field;
}

export type VariogramModel = 'spherical' | 'exponential';

export interface Variogram {
  model: VariogramModel;
  nugget: number;
  sill: number; // nugget + partial sill
  range: number; // km
  sse: number;
}

/** Model semivariance γ(h) in km units. */
export function variogramGamma(vario: Variogram, h: number): number {
  const c0 = vario.nugget;
  const c = vario.sill - vario.nugget;
  if (vario.model === 'spherical') {
    if (h >= vario.range) return vario.sill;
    const r = h / vario.range;
    return c0 + c * (1.5 * r - 0.5 * r * r * r);
  }
  return c0 + c * (1 - Math.exp((-3 * h) / vario.range));
}

export interface EmpiricalVariogram {
  /** Lag-bin centres (km). */
  centers: number[];
  /** Empirical semivariance per bin. */
  gamma: number[];
  /** Half the maximum pair distance — the fitting domain. */
  lagMax: number;
}

/**
 * Binned empirical semivariance: 12 lags up to half the maximum pair
 * distance, γ(h) = ½·(z_i − z_j)² averaged per bin.
 */
export function empiricalVariogram(points: InterpPoint[]): EmpiricalVariogram {
  const n = points.length;
  let hMax = 0;
  const pairs: Array<{ h: number; g: number }> = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const h = haversineKm(points[i]!.lat, points[i]!.lon, points[j]!.lat, points[j]!.lon);
      if (h > hMax) hMax = h;
      pairs.push({ h, g: 0.5 * (points[i]!.value - points[j]!.value) ** 2 });
    }
  }
  const lagMax = Math.max(hMax / 2, 1e-6);
  const NB = 12;
  const binSum = new Float64Array(NB);
  const binCnt = new Float64Array(NB);
  for (const pr of pairs) {
    const b = Math.min(NB - 1, Math.floor((pr.h / lagMax) * NB));
    binSum[b] = (binSum[b] ?? 0) + pr.g;
    binCnt[b] = (binCnt[b] ?? 0) + 1;
  }
  const centers: number[] = [];
  const gamma: number[] = [];
  for (let b = 0; b < NB; b += 1) {
    if ((binCnt[b] ?? 0) === 0) continue;
    centers.push(((b + 0.5) / NB) * lagMax);
    gamma.push((binSum[b] ?? 0) / (binCnt[b] ?? 1));
  }
  return { centers, gamma, lagMax };
}

/**
 * Fit a variogram by grid search over nugget × range for both candidate
 * models, minimising SSE against the empirical (binned) semivariance.
 * The prior sill is the sample variance — the standard first guess.
 */
export function fitVariogram(points: InterpPoint[]): Variogram {
  const n = points.length;
  const mean = points.reduce((a, p) => a + p.value, 0) / (n || 1);
  const sill = Math.max(points.reduce((a, p) => a + (p.value - mean) ** 2, 0) / Math.max(1, n - 1), 1e-9);

  const emp = empiricalVariogram(points);
  const { centers } = emp;
  const gammaEmp = emp.gamma;

  const nuggets = [0, 0.05, 0.1, 0.2, 0.35].map((f) => f * sill);
  const ranges: number[] = [];
  for (let i = 0; i < 14; i += 1) ranges.push((emp.lagMax * (i + 2)) / 15);

  let best: Variogram = { model: 'spherical', nugget: 0, sill, range: emp.lagMax, sse: Infinity };
  for (const model of ['spherical', 'exponential'] as VariogramModel[]) {
    for (const nugget of nuggets) {
      if (nugget >= sill) continue;
      for (const range of ranges) {
        let sse = 0;
        for (let k = 0; k < centers.length; k += 1) {
          const d = variogramGamma({ model, nugget, sill, range, sse: 0 }, centers[k]!) - gammaEmp[k]!;
          sse += d * d;
        }
        if (sse < best.sse) best = { model, nugget, sill, range, sse };
      }
    }
  }
  return best;
}

/** Gaussian-elimination solve (partial pivoting). Returns null if singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    }
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    if (piv !== col) {
      const t = m[piv]!;
      m[piv] = m[col]!;
      m[col] = t;
    }
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c += 1) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

const KRIGING_MAX_STATIONS = 400;
/** Leave-one-out rebuilds the kriging system per station — cap it lower. */
const LOOCV_KRIGING_MAX_STATIONS = 200;

/** The augmented ordinary-kriging matrix [Γ 1; 1ᵀ 0] for a station set. */
function buildKrigingSystem(points: InterpPoint[], vario: Variogram): number[][] {
  const n = points.length;
  const A: number[][] = [];
  for (let i = 0; i <= n; i += 1) A.push(new Array<number>(n + 1).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      const g = i === j ? 0 : variogramGamma(vario, haversineKm(points[i]!.lat, points[i]!.lon, points[j]!.lat, points[j]!.lon));
      A[i]![j] = g;
      A[j]![i] = g;
    }
    A[i]![n] = 1;
    A[n]![i] = 1;
  }
  A[n]![n] = 0;
  return A;
}

/** Ordinary-kriging estimate plus prediction standard error σ = √(wᵀγ₀ + μ). */
export interface KrigingEstimate {
  est: number;
  /** Kriging standard deviation (√ of the kriging variance wᵀγ₀ + μ). */
  sigma: number;
}

/**
 * Ordinary-kriging estimate + kriging variance at a single location (system
 * rebuilt per call — the LOOCV and validation path). σ² = Σ wᵢ·γ(i,0) + μ
 * with μ the Lagrange multiplier of the unbiasedness constraint.
 */
export function krigingAtFull(points: InterpPoint[], lon: number, lat: number, vario: Variogram): KrigingEstimate | null {
  const n = points.length;
  const inv = invertMatrix(buildKrigingSystem(points, vario));
  if (!inv) return null;
  const b = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i += 1) b[i] = variogramGamma(vario, haversineKm(lat, lon, points[i]!.lat, points[i]!.lon));
  b[n] = 1;
  let est = 0;
  const w = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    let wi = 0;
    for (let j = 0; j <= n; j += 1) wi += inv[i]![j]! * b[j]!;
    w[i] = wi;
    est += wi * points[i]!.value;
  }
  let mu = 0;
  for (let j = 0; j <= n; j += 1) mu += inv[n]![j]! * b[j]!;
  let var2 = 0;
  for (let i = 0; i < n; i += 1) var2 += w[i]! * b[i]!;
  var2 += mu;
  return { est, sigma: var2 > 0 ? Math.sqrt(var2) : 0 };
}

/**
 * Ordinary-kriging estimate at a single location (system rebuilt per call —
 * the LOOCV and validation path; gridding uses the amortised krigingGrid).
 */
export function krigingAt(points: InterpPoint[], lon: number, lat: number, vario: Variogram): number | null {
  const full = krigingAtFull(points, lon, lat, vario);
  return full ? full.est : null;
}

/** Gridded ordinary kriging with the prediction σ field. */
export interface KrigingGridFull {
  field: Float64Array;
  sigma: Float64Array;
}

/**
 * Ordinary-kriging gridding. The augmented (N+1) system is inverted once
 * (Gauss-Jordan); each node then costs one O(N²) mat-vec, and the kriging
 * variance σ² = Σ wᵢ·γ(i,0) + μ is evaluated on the same weights. Returns
 * null when the system is singular (coincident stations).
 */
export function krigingGridFull(
  points: InterpPoint[],
  cols: number,
  rows: number,
  bounds: Bounds,
  vario: Variogram,
): KrigingGridFull | null {
  const n = points.length;
  const inv = invertMatrix(buildKrigingSystem(points, vario));
  if (!inv) return null;

  const field = new Float64Array(cols * rows);
  const sigma = new Float64Array(cols * rows);
  const w = new Array<number>(n).fill(0);
  const b = new Array<number>(n + 1).fill(0);
  for (let r = 0; r < rows; r += 1) {
    const lat = bounds.maxLat - ((bounds.maxLat - bounds.minLat) * r) / (rows - 1);
    for (let c = 0; c < cols; c += 1) {
      const lon = bounds.minLon + ((bounds.maxLon - bounds.minLon) * c) / (cols - 1);
      for (let i = 0; i < n; i += 1) {
        b[i] = variogramGamma(vario, haversineKm(lat, lon, points[i]!.lat, points[i]!.lon));
      }
      b[n] = 1;
      // w = inv · b
      let est = 0;
      for (let i = 0; i < n; i += 1) {
        let wi = 0;
        for (let j = 0; j <= n; j += 1) wi += inv[i]![j]! * b[j]!;
        w[i] = wi;
        est += wi * points[i]!.value;
      }
      let mu = 0;
      for (let j = 0; j <= n; j += 1) mu += inv[n]![j]! * b[j]!;
      let var2 = 0;
      for (let i = 0; i < n; i += 1) var2 += w[i]! * b[i]!;
      field[r * cols + c] = est;
      sigma[r * cols + c] = var2 > 0 ? Math.sqrt(var2) : 0;
    }
  }
  return { field, sigma };
}

/**
 * Ordinary-kriging gridding (estimate only — see `krigingGridFull` for the
 * paired σ field). The augmented (N+1) system is inverted once
 * (Gauss-Jordan); each node then costs one O(N²) mat-vec. Returns null when
 * the system is singular (coincident stations).
 */
export function krigingGrid(
  points: InterpPoint[],
  cols: number,
  rows: number,
  bounds: Bounds,
  vario: Variogram,
): Float64Array | null {
  const full = krigingGridFull(points, cols, rows, bounds, vario);
  return full ? full.field : null;
}

function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  const m = A.map((row, i) => {
    const r = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j += 1) r[j] = row[j]!;
    r[n + i] = 1;
    return r;
  });
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    }
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    if (piv !== col) {
      const t = m[piv]!;
      m[piv] = m[col]!;
      m[col] = t;
    }
    const d = m[col]![col]!;
    for (let c = 0; c < 2 * n; c += 1) m[col]![c]! /= d;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = m[r]![col]!;
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c += 1) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row) => row.slice(n));
}

// ---- Cross-validation & spatial autocorrelation (exported for tests) -------

export interface LoocvRow {
  lon: number;
  lat: number;
  observed: number;
  predicted: number;
  /** Kriging prediction σ for this station (null for IDW). */
  sigma: number | null;
}

export interface LoocvResult {
  n: number;
  /** Root-mean-square cross-validation error. */
  rmse: number;
  /** Mean absolute cross-validation error. */
  mae: number;
  /** R² = 1 − SS_res / SS_tot of predicted vs observed. */
  r2: number;
  rows: LoocvRow[];
}

/**
 * Leave-one-out cross-validation: each station is predicted from the other
 * n−1 stations with the chosen method (kriging refits the variogram and
 * rebuilds the system per leave-out, so it is capped at
 * LOOCV_KRIGING_MAX_STATIONS). Returns null when the method/system is not
 * usable for the given n.
 */
export function loocvValidate(points: InterpPoint[], method: 'idw' | 'kriging', power: number): LoocvResult | null {
  const n = points.length;
  if (n < 4) return null;
  if (method === 'kriging' && n > LOOCV_KRIGING_MAX_STATIONS) return null;
  const mean = points.reduce((a, p) => a + p.value, 0) / n;
  let sTot = 0;
  for (const p of points) sTot += (p.value - mean) ** 2;
  const rows: LoocvRow[] = [];
  let se = 0;
  let ae = 0;
  for (let i = 0; i < n; i += 1) {
    const p = points[i]!;
    const rest = points.filter((_, j) => j !== i);
    let pred: number | null;
    let sigma: number | null = null;
    if (method === 'idw') {
      pred = idwAt(rest, p.lon, p.lat, power);
    } else {
      const full = krigingAtFull(rest, p.lon, p.lat, fitVariogram(rest));
      pred = full ? full.est : null;
      sigma = full ? full.sigma : null;
    }
    if (pred === null || !Number.isFinite(pred)) return null;
    const err = pred - p.value;
    se += err * err;
    ae += Math.abs(err);
    rows.push({ lon: p.lon, lat: p.lat, observed: p.value, predicted: pred, sigma });
  }
  const r2 = sTot > 0 ? 1 - se / sTot : 0;
  return { n, rmse: Math.sqrt(se / n), mae: ae / n, r2, rows };
}

/** LOOCV summary table as CSV: observed, predicted, error, standardized error. */
export function loocvCsv(result: LoocvResult): string {
  const head = 'lon,lat,observed,predicted,error,standardized_error';
  const lines = result.rows.map((r) => {
    const err = r.predicted - r.observed;
    const std = r.sigma !== null && r.sigma > 0 ? (err / r.sigma).toFixed(4) : '';
    return `${r.lon},${r.lat},${r.observed},${r.predicted},${err.toFixed(4)},${std}`;
  });
  return [head, ...lines].join('\n');
}

/** Two-tailed p-value of a standard-normal z (Abramowitz–Stegun erf 7.1.26). */
export function normalTwoTailP(z: number): number {
  if (!Number.isFinite(z)) return Number.NaN;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const pU = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return Math.max(0, Math.min(1, 2 * pU));
}

export interface MoransIResult {
  /** Global Moran's I (inverse-distance weights). */
  i: number;
  /** Randomisation expectation E[I] = −1/(n−1). */
  expected: number;
  /** Randomisation z-score. */
  z: number;
  n: number;
}

/**
 * Global Moran's I with inverse-distance weights,
 * I = (n/S₀)·ΣΣ w_ij·z_i·z_j / Σz_i², plus the classic randomisation
 * z-score (S₁, S₂ per Cliff & Ord). Positive I ⇒ clustered values,
 * negative ⇒ dispersed.
 */
export function moransI(points: InterpPoint[]): MoransIResult | null {
  const n = points.length;
  if (n < 4) return null;
  const mean = points.reduce((a, p) => a + p.value, 0) / n;
  let s0 = 0;
  let num = 0;
  let s1 = 0;
  const rowSum = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = haversineKm(points[i]!.lat, points[i]!.lon, points[j]!.lat, points[j]!.lon);
      const w = 1 / Math.max(d, 1e-6);
      s0 += 2 * w;
      num += 2 * w * (points[i]!.value - mean) * (points[j]!.value - mean);
      s1 += (2 * w) ** 2; // ½·ΣΣ(w_ij + w_ji)² for symmetric w
      rowSum[i]! += w;
      rowSum[j]! += w;
    }
  }
  const denom = points.reduce((a, p) => a + (p.value - mean) ** 2, 0);
  if (s0 <= 0 || denom <= 0) return null;
  const I = (n / s0) * (num / denom);
  let s2 = 0;
  for (let i = 0; i < n; i += 1) s2 += (2 * rowSum[i]!) ** 2;
  const expected = -1 / (n - 1);
  const varI = (n * n * s1 - n * s2 + 3 * s0 * s0) / (s0 * s0 * (n * n - 1)) - expected * expected;
  const z = varI > 0 ? (I - expected) / Math.sqrt(varI) : 0;
  return { i: I, expected, z, n };
}

// ---- Synthetic-field benchmark (L4, exported for tests) --------------------
//
// A KNOWN variogram generates a Gaussian random field on seeded stations
// (mulberry32, Box–Muller); the plugin's auto-fit is then scored on how well
// it recovers the generating nugget / sill / range. This is a self-test of
// the variogram engine — its numbers describe the benchmark, never user data.

export const SYNTHETIC_BENCH_SEED = 20240611;

export interface SyntheticFieldBenchmark {
  tag: 'synthetic-field-benchmark';
  seed: number;
  stations: number;
  trueModel: VariogramModel;
  trueNugget: number;
  trueSill: number;
  trueRangeKm: number;
  recModel: VariogramModel;
  recNugget: number;
  recSill: number;
  recRangeKm: number;
  nuggetErrPct: number;
  sillErrPct: number;
  rangeErrPct: number;
}

/** Cholesky factor L (A = L·Lᵀ) of a symmetric positive-definite matrix. */
function choleskyLower(A: number[][]): number[][] | null {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j += 1) {
    let d = A[j]![j]!;
    for (let k = 0; k < j; k += 1) d -= L[j]![k]! ** 2;
    if (d <= 0) return null;
    L[j]![j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i += 1) {
      let s = A[i]![j]!;
      for (let k = 0; k < j; k += 1) s -= L[i]![k]! * L[j]![k]!;
      L[i]![j] = s / L[j]![j]!;
    }
  }
  return L;
}

/**
 * Generate a Gaussian random field with a KNOWN spherical variogram on
 * seeded random stations, refit, and report parameter-recovery errors.
 * Deterministic for a given seed (`SYNTHETIC_BENCH_SEED`).
 */
export function runSyntheticFieldBenchmark(seed: number = SYNTHETIC_BENCH_SEED): SyntheticFieldBenchmark | null {
  const truth: Variogram = { model: 'spherical', nugget: 2.4, sill: 12, range: 380, sse: 0 };
  const N = 90;
  const rng = mulberry32(seed);
  const pts: InterpPoint[] = [];
  for (let i = 0; i < N; i += 1) {
    pts.push({ lon: 100 + 40 * rng(), lat: 20 + 28 * rng(), value: 0 });
  }
  // Covariance C_ij = sill − γ(h_ij) (C_ii = sill); small jitter keeps the
  // Cholesky well-conditioned without measurably changing the field.
  const C: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let i = 0; i < N; i += 1) {
    for (let j = i; j < N; j += 1) {
      const c = i === j ? truth.sill + 1e-8 * truth.sill : truth.sill - variogramGamma(truth, haversineKm(pts[i]!.lat, pts[i]!.lon, pts[j]!.lat, pts[j]!.lon));
      C[i]![j] = c;
      C[j]![i] = c;
    }
  }
  const L = choleskyLower(C);
  if (!L) return null;
  // z = L·ξ with ξ ~ N(0,1) (Box–Muller from the seeded stream).
  const z = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i += 1) {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    for (let j = 0; j <= i; j += 1) z[i]! += L[i]![j]! * g;
  }
  for (let i = 0; i < N; i += 1) pts[i]!.value = z[i]!;
  const fit = fitVariogram(pts);
  return {
    tag: 'synthetic-field-benchmark',
    seed,
    stations: N,
    trueModel: truth.model,
    trueNugget: truth.nugget,
    trueSill: truth.sill,
    trueRangeKm: truth.range,
    recModel: fit.model,
    recNugget: fit.nugget,
    recSill: fit.sill,
    recRangeKm: fit.range,
    nuggetErrPct: (Math.abs(fit.nugget - truth.nugget) / truth.sill) * 100,
    sillErrPct: (Math.abs(fit.sill - truth.sill) / truth.sill) * 100,
    rangeErrPct: (Math.abs(fit.range - truth.range) / truth.range) * 100,
  };
}

// ---- Figure Studio panels (exported for tests) ------------------------------

const FIG_COLS = 60;
const FIG_ROWS = 45;

/**
 * Research sheet for one interpolation run: (a) the interpolated surface,
 * (b) empirical vs fitted variogram, (c) LOOCV observed-vs-predicted scatter
 * with the 1:1 line. Panel (c) is skipped when LOOCV is not applicable.
 */
export function interpFigurePanels(
  points: InterpPoint[],
  method: 'idw' | 'kriging',
  power: number,
): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  const bounds = boundsOf(points);

  // (a) interpolated surface at figure resolution.
  let field: Float64Array | null = null;
  let methodLabel = 'IDW';
  if (method === 'idw') {
    field = idwGrid(points, FIG_COLS, FIG_ROWS, bounds, power);
    methodLabel = `IDW (p=${power})`;
  } else if (points.length <= KRIGING_MAX_STATIONS) {
    const vario = fitVariogram(points);
    field = krigingGrid(points, FIG_COLS, FIG_ROWS, bounds, vario);
    methodLabel = 'Ordinary Kriging';
  }
  if (!field) field = idwGrid(points, FIG_COLS, FIG_ROWS, bounds, power);
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const p of points) {
    if (p.value < vmin) vmin = p.value;
    if (p.value > vmax) vmax = p.value;
  }
  if (!(vmax > vmin)) vmax = vmin + 1e-9;
  panels.push({
    ...panelPlace(panels.length),
    tag: panelTag(panels.length),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Interpolated surface — ${methodLabel}`,
      xLabel: 'lon',
      yLabel: 'lat',
      ticks: 4,
      series: [
        {
          name: 'value',
          kind: 'field',
          color: '#3CA0FF',
          field: { values: Array.from(field), rows: FIG_ROWS, cols: FIG_COLS, domain: [vmin, vmax] },
        },
      ],
    },
  });

  // (b) empirical vs fitted variogram.
  if (method === 'kriging' && points.length <= KRIGING_MAX_STATIONS) {
    const vario = fitVariogram(points);
    const emp = empiricalVariogram(points);
    const hEnd = Math.max(emp.lagMax, vario.range) * 1.1;
    const modelPts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k <= 60; k += 1) {
      const h = (hEnd * k) / 60;
      modelPts.push({ x: h, y: variogramGamma(vario, h) });
    }
    panels.push({
      ...panelPlace(panels.length),
      tag: panelTag(panels.length),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `Variogram — ${vario.model}, range ${vario.range.toFixed(0)} km`,
        xLabel: 'h [km]',
        yLabel: 'γ(h)',
        ticks: 4,
        grid: true,
        legend: true,
        series: [
          { name: 'empirical', kind: 'scatter', color: '#FF9E64', points: emp.centers.map((h, k) => ({ x: h, y: emp.gamma[k] ?? 0 })) },
          { name: 'fitted', kind: 'line', color: '#7FB2E8', points: modelPts },
        ],
      },
    });
  }

  // (c) LOOCV validation scatter with the 1:1 line.
  const loocv = loocvValidate(points, method, power);
  if (loocv) {
    const lo = Math.min(...loocv.rows.map((r) => Math.min(r.observed, r.predicted)));
    const hi = Math.max(...loocv.rows.map((r) => Math.max(r.observed, r.predicted)));
    const pad = (hi - lo) * 0.05 || 1;
    const dom: [number, number] = [lo - pad, hi + pad];
    const diag: Array<{ x: number; y: number }> = [
      { x: dom[0], y: dom[0] },
      { x: dom[1], y: dom[1] },
    ];
    panels.push({
      ...panelPlace(panels.length),
      tag: panelTag(panels.length),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `LOOCV — RMSE ${loocv.rmse.toFixed(2)}, MAE ${loocv.mae.toFixed(2)}`,
        xLabel: 'observed',
        yLabel: 'predicted',
        xDomain: dom,
        yDomain: dom,
        ticks: 4,
        grid: true,
        legend: true,
        series: [
          { name: 'stations', kind: 'scatter', color: '#5FD0A5', points: loocv.rows.map((r) => ({ x: r.observed, y: r.predicted })) },
          { name: '1:1', kind: 'line', color: '#B07AA1', dash: [4, 2], points: diag },
        ],
      },
    });
  }
  return panels;
}

// ---- Plugin ----------------------------------------------------------------

const GRID_COLS = 120;
const GRID_ROWS = 90;

interface State {
  points: InterpPoint[];
  title: string;
  method: 'idw' | 'kriging';
  power: number;
  showStations: boolean;
  showContours: boolean;
  /** Kriging prediction-σ field for the current grid (kriging only). */
  sigmaField: Float64Array | null;
  /** Result of the embedded synthetic-field benchmark (benchmark-tagged). */
  bench: SyntheticFieldBenchmark | null;
}

export class SpatialInterpPlugin implements Plugin {
  readonly manifest = spatialInterpManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { points: [], title: '', method: 'idw', power: 2, showStations: true, showContours: true, sigmaField: null, bench: null };
  // Validation memo (LOOCV + Moran's I) keyed by points identity + params.
  private validCache: { pts: InterpPoint[]; key: string; loocv: LoocvResult | null; moran: MoransIResult | null } | null = null;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state.points = [];
    this.state.sigmaField = null;
    this.state.bench = null;
    this.validCache = null;
    clearScienceOutputs(this.manifest.id);
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {

    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
      return;
    }
    if (actionFired(params, 'exportLoocvCsv')) {
      const { loocv } = this.validation();
      if (!loocv) {
        notify(this.api, 'warning', 'LOOCV unavailable for this dataset', '当前数据无法执行留一交叉验证');
        return;
      }
      this.api.exportFile('geo-interp-loocv.csv', loocvCsv(loocv), 'text/csv');
      return;
    }
    if (actionFired(params, 'runBenchmark')) {
      const bench = runSyntheticFieldBenchmark();
      this.state.bench = bench;
      if (bench) {
        notify(
          this.api,
          'success',
          `Benchmark (synthetic field, seed ${bench.seed}): ${bench.recModel} model, range err ${bench.rangeErrPct.toFixed(1)}%`,
          `基准（合成随机场，种子 ${bench.seed}）：${bench.recModel === 'spherical' ? '球状' : '指数'}模型，变程误差 ${bench.rangeErrPct.toFixed(1)}%`,
        );
      }
      this.publish();
      return;
    }
    let redraw = false;
    if (params.method === 'idw' || params.method === 'kriging') {
      this.state.method = params.method;
      redraw = true;
    }
    if (typeof params.power === 'number') {
      this.state.power = Math.max(0.5, Math.min(5, params.power));
      redraw = true;
    }
    if (typeof params.showStations === 'boolean') {
      this.state.showStations = params.showStations;
      redraw = true;
    }
    if (typeof params.showContours === 'boolean') {
      this.state.showContours = params.showContours;
      redraw = true;
    }
    if (redraw) this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'method',
        label: 'Method',
        labelI18n: { 'zh-CN': '插值方法', 'en-US': 'Method' },
        type: 'select',
        value: this.state.method,
        options: [
          { value: 'idw', label: 'IDW', labelI18n: { 'zh-CN': '反距离加权 IDW', 'en-US': 'IDW' } },
          { value: 'kriging', label: 'Ordinary Kriging', labelI18n: { 'zh-CN': '普通克里金', 'en-US': 'Ordinary Kriging' } },
        ],
      },
      {
        key: 'power',
        label: 'IDW power p',
        labelI18n: { 'zh-CN': 'IDW 幂次 p', 'en-US': 'IDW power p' },
        type: 'range',
        min: 0.5,
        max: 5,
        step: 0.5,
        value: this.state.power,
      },
      {
        key: 'showStations',
        label: 'Show stations',
        labelI18n: { 'zh-CN': '显示站点', 'en-US': 'Show stations' },
        type: 'checkbox',
        value: this.state.showStations,
      },
      {
        key: 'showContours',
        label: 'Contour lines',
        labelI18n: { 'zh-CN': '等值线', 'en-US': 'Contour lines' },
        type: 'checkbox',
        value: this.state.showContours,
      },
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      actionButton('exportLoocvCsv', 'Export LOOCV CSV', '导出 LOOCV CSV'),
      actionButton('runBenchmark', 'Run synthetic-field benchmark', '运行合成随机场基准'),
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    // GeoJSON point collection also accepted.
    if (text.trimStart().startsWith('{')) {
      try {
        const geo = JSON.parse(text) as { features?: Array<{ geometry?: { type?: string; coordinates?: [number, number, number?] }; properties?: Record<string, unknown> }> };
        const pts: InterpPoint[] = [];
        for (const f of geo.features ?? []) {
          const coord = f.geometry?.coordinates;
          if (f.geometry?.type !== 'Point' || !coord) continue;
          const v = Number(f.properties?.value ?? f.properties?.val ?? coord[2]);
          if (!Number.isFinite(v)) continue;
          pts.push({ lon: coord[0]!, lat: coord[1]!, value: v, name: f.properties?.name as string | undefined });
        }
        if (pts.length >= 3) {
          this.setPoints(pts, '');
          return;
        }
      } catch {
        // fall through to CSV
      }
    }
    const parsed = parsePointsCsv(text);
    if (parsed.length < 3) {
      notify(this.api, 'warning', 'Need ≥ 3 lon,lat,value rows', '至少需要 3 行 lon,lat,value 数据');
      return;
    }
    this.setPoints(parsed, '');
  }

  private setPoints(points: InterpPoint[], title: string) {
    this.state.points = points;
    this.state.title = title;
    this.state.sigmaField = null;
    this.api.reportDataScale(points.length);
    notify(
      this.api,
      'success',
      `Loaded ${points.length} stations`,
      `已加载 ${points.length} 个站点`,
    );
    this.draw();
  }

  /**
   * LOOCV + Moran's I for the *effective* method (kriging degrades to IDW
   * above its station cap). Memoised against the points identity and params
   * so slider redraws don't re-run the O(n³)-worst-case validation.
   */
  private validation(): { loocv: LoocvResult | null; moran: MoransIResult | null } {
    const pts = this.state.points;
    const effMethod = this.state.method === 'kriging' && pts.length > KRIGING_MAX_STATIONS ? 'idw' : this.state.method;
    const key = `${effMethod}:${this.state.power}:${pts.length}`;
    if (this.validCache && this.validCache.pts === pts && this.validCache.key === key) {
      return { loocv: this.validCache.loocv, moran: this.validCache.moran };
    }
    const loocv = pts.length >= 4 ? loocvValidate(pts, effMethod, this.state.power) : null;
    const moran = moransI(pts);
    this.validCache = { pts, key, loocv, moran };
    return { loocv, moran };
  }

  private computeField(bounds: Bounds): Float64Array | null {
    const pts = this.state.points;
    if (this.state.method === 'idw') {
      this.state.sigmaField = null;
      return idwGrid(pts, GRID_COLS, GRID_ROWS, bounds, this.state.power);
    }
    if (pts.length > KRIGING_MAX_STATIONS) {
      notify(
        this.api,
        'warning',
        `Kriging capped at ${KRIGING_MAX_STATIONS} stations — showing IDW instead`,
        `克里金限制 ${KRIGING_MAX_STATIONS} 个站点以内 — 已改用 IDW`,
      );
      this.state.sigmaField = null;
      return idwGrid(pts, GRID_COLS, GRID_ROWS, bounds, this.state.power);
    }
    const vario = fitVariogram(pts);
    const full = krigingGridFull(pts, GRID_COLS, GRID_ROWS, bounds, vario);
    if (!full) {
      notify(this.api, 'warning', 'Kriging system singular — showing IDW', '克里金方程组奇异 — 已改用 IDW');
      this.state.sigmaField = null;
      return idwGrid(pts, GRID_COLS, GRID_ROWS, bounds, this.state.power);
    }
    this.state.sigmaField = full.sigma;
    return full.field;
  }

  /**
   * Publish the run's scientific conclusions to the science-output strip:
   * LOOCV R²/RMSE, global Moran's I with its randomisation p-value, the
   * median kriging σ, and (when run) the tagged synthetic-field benchmark.
   */
  private publish() {
    const zh = isZh(this.api.locale);
    const pts = this.state.points;
    if (pts.length < 3) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const { loocv, moran } = this.validation();
    const metrics: ScienceMetric[] = [];
    metrics.push({
      key: 'stations',
      label: 'n',
      value: String(pts.length),
      severity: 'info',
      hint: zh ? '参与插值的站点数' : 'stations used in the interpolation',
    });
    if (loocv) {
      metrics.push({
        key: 'loocv-r2',
        label: 'R²',
        value: fmtMetric(loocv.r2),
        severity: loocv.r2 >= 0.8 ? 'ok' : loocv.r2 < 0.5 ? 'warn' : 'info',
        hint: zh ? '留一交叉验证 R² = 1 − SS_res/SS_tot（观测 vs 预测）' : 'LOOCV R² = 1 − SS_res/SS_tot (observed vs predicted)',
      });
      metrics.push({
        key: 'loocv-rmse',
        label: 'RMSE',
        value: fmtMetric(loocv.rmse),
        hint: zh ? '留一交叉验证均方根误差（输入单位）' : 'LOOCV root-mean-square error (input units)',
      });
    }
    if (moran) {
      const p = normalTwoTailP(moran.z);
      metrics.push({
        key: 'moran-i',
        label: "Moran's I",
        value: fmtMetric(moran.i),
        severity: 'info',
        hint: zh ? `全局 Moran's I（反距离权），z = ${moran.z.toFixed(2)}；正值聚集，负值分散` : `global Moran's I (inverse-distance weights), z = ${moran.z.toFixed(2)}; positive = clustered`,
      });
      metrics.push({
        key: 'moran-p',
        label: 'p',
        value: fmtMetric(p),
        severity: p < 0.05 ? 'ok' : 'info',
        hint: zh ? "Moran's I 随机化零假设下的双侧 p 值（正态近似）" : "two-tailed randomisation p for Moran's I (normal approximation)",
      });
    }
    const sig = this.state.sigmaField;
    if (sig && sig.length > 0) {
      const finite: number[] = [];
      for (const v of sig) if (Number.isFinite(v) && v >= 0) finite.push(v);
      if (finite.length > 0) {
        finite.sort((a, b) => a - b);
        const mid = finite.length >> 1;
        const med = finite.length % 2 ? finite[mid]! : (finite[mid - 1]! + finite[mid]!) / 2;
        metrics.push({
          key: 'sigma-median',
          label: 'σ median',
          value: fmtMetric(med),
          severity: 'info',
          hint: zh ? '克里金预测标准差 σ = √(wᵀγ₀+μ)，网格节点中位数（克里金模式）' : 'ordinary-kriging σ = √(wᵀγ₀+μ), median over grid nodes (kriging mode)',
        });
      }
    }
    const bench = this.state.bench;
    if (bench) {
      metrics.push({
        key: 'bench-model',
        label: 'bench model',
        value: `${bench.recModel} (${bench.trueModel})`,
        severity: bench.recModel === bench.trueModel ? 'ok' : 'warn',
        hint: zh ? `基准（合成随机场，种子 ${bench.seed}）：恢复/真实变差函数模型` : `benchmark (synthetic field, seed ${bench.seed}): recovered/true variogram model`,
      });
      metrics.push({
        key: 'bench-nugget-err',
        label: 'bench C₀ err',
        value: `${fmtMetric(bench.nuggetErrPct)}%`,
        severity: bench.nuggetErrPct < 20 ? 'ok' : 'warn',
        hint: zh ? `基准块金误差 |C₀′−C₀|/sill（真实 C₀ = ${bench.trueNugget}）` : `benchmark nugget error |C₀′−C₀|/sill (true C₀ = ${bench.trueNugget})`,
      });
      metrics.push({
        key: 'bench-sill-err',
        label: 'bench sill err',
        value: `${fmtMetric(bench.sillErrPct)}%`,
        severity: bench.sillErrPct < 20 ? 'ok' : 'warn',
        hint: zh ? `基准基台值恢复误差（真实 sill = ${bench.trueSill}）` : `benchmark sill recovery error (true sill = ${bench.trueSill})`,
      });
      metrics.push({
        key: 'bench-range-err',
        label: 'bench range err',
        value: `${fmtMetric(bench.rangeErrPct)}%`,
        severity: bench.rangeErrPct < 25 ? 'ok' : 'warn',
        hint: zh ? `基准变程恢复误差（真实 ${bench.trueRangeKm} km，${bench.stations} 站）` : `benchmark range recovery error (true ${bench.trueRangeKm} km, ${bench.stations} stations)`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 640;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = isZh(this.api.locale);
    const pts = this.state.points;
    if (pts.length < 3) {
      clearScienceOutputs(this.manifest.id);
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = "12px 'Microsoft YaHei', Consolas, monospace";
      g.textAlign = 'center';
      g.fillText(zh ? '请从示例或文件加载 lon,lat,value CSV 数据' : 'Load a lon,lat,value CSV from samples or a file', canvas.width / 2, canvas.height / 2);
      return;
    }

    const bounds = boundsOf(pts);
    const field = this.computeField(bounds);
    if (!field) return;
    this.publish();

    // Value range over both field and stations (they agree at stations).
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const p of pts) {
      if (p.value < vmin) vmin = p.value;
      if (p.value > vmax) vmax = p.value;
    }
    if (!(vmax > vmin)) vmax = vmin + 1e-9;

    // Heat surface: render grid to an offscreen canvas, then scale up.
    const off = document.createElement('canvas');
    off.width = GRID_COLS;
    off.height = GRID_ROWS;
    const og = off.getContext('2d');
    if (!og) return;
    const img = og.createImageData(GRID_COLS, GRID_ROWS);
    for (let i = 0; i < field.length; i += 1) {
      const t = (field[i]! - vmin) / (vmax - vmin);
      const [r, gg, b] = heatmapColor(t);
      img.data[i * 4] = Math.round(r * 255);
      img.data[i * 4 + 1] = Math.round(gg * 255);
      img.data[i * 4 + 2] = Math.round(b * 255);
      img.data[i * 4 + 3] = 210;
    }
    og.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(off, 0, 0, canvas.width, canvas.height);

    // Contours from the same field.
    if (this.state.showContours) {
      g.strokeStyle = 'rgba(15, 20, 28, 0.65)';
      g.lineWidth = 1;
      g.beginPath();
      const N_LEVELS = 9;
      for (let k = 1; k < N_LEVELS; k += 1) {
        const level = vmin + ((vmax - vmin) * k) / N_LEVELS;
        const segs = marchingSquares(field, GRID_COLS, GRID_ROWS, level);
        for (const s of segs) {
          g.moveTo((s.x1 / (GRID_COLS - 1)) * canvas.width, (s.y1 / (GRID_ROWS - 1)) * canvas.height);
          g.lineTo((s.x2 / (GRID_COLS - 1)) * canvas.width, (s.y2 / (GRID_ROWS - 1)) * canvas.height);
        }
      }
      g.stroke();
    }

    // Stations.
    const px = (lon: number) => ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * canvas.width;
    const py = (lat: number) => ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * canvas.height;
    if (this.state.showStations) {
      for (const p of pts) {
        g.beginPath();
        g.arc(px(p.lon), py(p.lat), 3.2, 0, Math.PI * 2);
        g.fillStyle = '#ffffff';
        g.fill();
        g.lineWidth = 1.4;
        g.strokeStyle = '#10151d';
        g.stroke();
      }
    }

    // Header + scale bar.
    g.textAlign = 'left';
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(235, 242, 250, 0.95)';
    const methodLabel =
      this.state.method === 'idw'
        ? zh
          ? `IDW（p=${this.state.power}）`
          : `IDW (p=${this.state.power})`
        : zh
          ? '普通克里金'
          : 'Ordinary Kriging';
    g.fillText(
      zh
        ? `${this.state.title || '空间插值'}\u3000${methodLabel}\u3000${pts.length} 站点`
        : `${this.state.title || 'Spatial interpolation'}\u3000${methodLabel}\u3000${pts.length} stations`,
      14,
      20,
    );
    // Validation row: LOOCV RMSE/MAE + global Moran's I (spatial autocorrelation).
    const { loocv, moran } = this.validation();
    g.fillStyle = 'rgba(190, 200, 216, 0.95)';
    const parts: string[] = [];
    if (loocv) parts.push(zh ? `留一交叉验证 RMSE ${loocv.rmse.toFixed(2)} / MAE ${loocv.mae.toFixed(2)}` : `LOOCV RMSE ${loocv.rmse.toFixed(2)} / MAE ${loocv.mae.toFixed(2)}`);
    if (moran) parts.push(zh ? `Moran's I = ${moran.i.toFixed(3)}（z = ${moran.z.toFixed(1)}，${moran.i > 0 ? '空间聚集' : '空间分散'}）` : `Moran's I = ${moran.i.toFixed(3)} (z = ${moran.z.toFixed(1)}, ${moran.i > 0 ? 'clustered' : 'dispersed'})`);
    if (parts.length > 0) g.fillText(parts.join('\u3000'), 14, 38);
    const grad = g.createLinearGradient(14, 0, 154, 0);
    for (let i = 0; i <= 10; i += 1) {
      const [r, gg, b] = heatmapColor(i / 10);
      grad.addColorStop(i / 10, `rgb(${Math.round(r * 255)},${Math.round(gg * 255)},${Math.round(b * 255)})`);
    }
    g.fillStyle = grad;
    g.fillRect(14, canvas.height - 26, 140, 10);
    g.fillStyle = 'rgba(220, 228, 240, 0.95)';
    g.fillText(fmtVal(vmin), 14, canvas.height - 30);
    g.textAlign = 'right';
    g.fillText(fmtVal(vmax), 154, canvas.height - 30);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(190, 200, 216, 0.9)';
    g.fillText(zh ? '年降水量 mm（示例）' : 'value', 164, canvas.height - 18);
  }

  /** Stream the surface / variogram / LOOCV research sheet to Figure Studio. */
  private async sendToFigure(): Promise<void> {
    const pts = this.state.points;
    if (pts.length < 3) return;
    const zh = isZh(this.api.locale);
    const { loocv, moran } = this.validation();
    const stats: string[] = [];
    if (loocv) stats.push(zh ? `留一交叉验证 RMSE = ${loocv.rmse.toFixed(2)}` : `LOOCV RMSE = ${loocv.rmse.toFixed(2)}`);
    if (moran) stats.push(zh ? `Moran's I = ${moran.i.toFixed(3)}（z = ${moran.z.toFixed(1)}）` : `Moran's I = ${moran.i.toFixed(3)} (z = ${moran.z.toFixed(1)})`);
    const caption: Bilingual = {
      zh: `空间插值（${this.state.method === 'idw' ? `IDW，p = ${this.state.power}` : '普通克里金'}）：插值场、变异函数（经验点 + 拟合曲线，γ(h) 球面/指数模型）与观测-预测验证散点${stats.length > 0 ? '。' + stats.join('，') : ''}。克里金系统 [Γ 1; 1ᵀ 0]·[w; μ] = [γ₀; 1]。`,
      en: `Spatial interpolation (${this.state.method === 'idw' ? `IDW, p = ${this.state.power}` : 'ordinary kriging'}): interpolated surface, variogram (empirical bins + fitted spherical/exponential γ(h)) and observed-vs-predicted validation scatter${stats.length > 0 ? '. ' + stats.join(', ') : ''}. Kriging system [Γ 1; 1ᵀ 0]·[w; μ] = [γ₀; 1].`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '空间插值', en: 'Spatial interpolation' },
      caption,
      interpFigurePanels(pts, this.state.method, this.state.power),
    );
  }
}

function fmtVal(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(v >= 100 ? 0 : 1);
}

export default function createSpatialInterpPlugin(): Plugin {
  return new SpatialInterpPlugin();
}
