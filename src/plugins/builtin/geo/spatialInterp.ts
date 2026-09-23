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
// Kriging is capped at 120 stations to stay interactive (O(N²) per node);
// larger datasets fall back to IDW with a notice. Distances are great-circle
// kilometres so high-latitude longitude stretching is handled correctly.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, exportCanvasPng, actionFired, notify } from '../shared/enhance';
import { heatmapColor } from '@/core/wgsl';
import { isZh, parseDelimited, stripHeaderIfNonNumeric, marchingSquares, haversineKm } from './geoCore';
import { pushPanelsToFigure, panelTag, panelPlace, GEO_PANEL_WIDTH, GEO_PANEL_HEIGHT } from './geoFigure';
import type { GeoFigurePanel, Bilingual } from './geoFigure';
import { spatialInterpManifest } from './spatialInterpManifest';

export { spatialInterpManifest } from './spatialInterpManifest';

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

const KRIGING_MAX_STATIONS = 120;
/** Leave-one-out rebuilds the kriging system per station — cap it lower. */
const LOOCV_KRIGING_MAX_STATIONS = 60;

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

/**
 * Ordinary-kriging estimate at a single location (system rebuilt per call —
 * the LOOCV and validation path; gridding uses the amortised krigingGrid).
 */
export function krigingAt(points: InterpPoint[], lon: number, lat: number, vario: Variogram): number | null {
  const n = points.length;
  const inv = invertMatrix(buildKrigingSystem(points, vario));
  if (!inv) return null;
  const b = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i += 1) b[i] = variogramGamma(vario, haversineKm(lat, lon, points[i]!.lat, points[i]!.lon));
  b[n] = 1;
  let est = 0;
  for (let i = 0; i < n; i += 1) {
    let w = 0;
    for (let j = 0; j <= n; j += 1) w += inv[i]![j]! * b[j]!;
    est += w * points[i]!.value;
  }
  return est;
}

/**
 * Ordinary-kriging gridding. The augmented (N+1) system is inverted once
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
  const n = points.length;
  const inv = invertMatrix(buildKrigingSystem(points, vario));
  if (!inv) return null;

  const field = new Float64Array(cols * rows);
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
        let w = 0;
        for (let j = 0; j <= n; j += 1) w += inv[i]![j]! * b[j]!;
        est += w * points[i]!.value;
      }
      field[r * cols + c] = est;
    }
  }
  return field;
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
}

export interface LoocvResult {
  n: number;
  /** Root-mean-square cross-validation error. */
  rmse: number;
  /** Mean absolute cross-validation error. */
  mae: number;
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
  const rows: LoocvRow[] = [];
  let se = 0;
  let ae = 0;
  for (let i = 0; i < n; i += 1) {
    const p = points[i]!;
    const rest = points.filter((_, j) => j !== i);
    let pred: number | null;
    if (method === 'idw') {
      pred = idwAt(rest, p.lon, p.lat, power);
    } else {
      pred = krigingAt(rest, p.lon, p.lat, fitVariogram(rest));
    }
    if (pred === null || !Number.isFinite(pred)) return null;
    const err = pred - p.value;
    se += err * err;
    ae += Math.abs(err);
    rows.push({ lon: p.lon, lat: p.lat, observed: p.value, predicted: pred });
  }
  return { n, rmse: Math.sqrt(se / n), mae: ae / n, rows };
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
): GeoFigurePanel[] {
  const panels: GeoFigurePanel[] = [];
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
      width: GEO_PANEL_WIDTH,
      height: GEO_PANEL_HEIGHT,
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
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
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
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
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
}

export class SpatialInterpPlugin implements Plugin {
  readonly manifest = spatialInterpManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { points: [], title: '', method: 'idw', power: 2, showStations: true, showContours: true };
  // Validation memo (LOOCV + Moran's I) keyed by points identity + params.
  private validCache: { pts: InterpPoint[]; key: string; loocv: LoocvResult | null; moran: MoransIResult | null } | null = null;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state.points = [];
    this.validCache = null;
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
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'geo-interp');
      return;
    }
    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
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
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
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

  // ---- drawing -------------------------------------------------------------

  private computeField(bounds: Bounds): Float64Array | null {
    const pts = this.state.points;
    if (this.state.method === 'idw') {
      return idwGrid(pts, GRID_COLS, GRID_ROWS, bounds, this.state.power);
    }
    if (pts.length > KRIGING_MAX_STATIONS) {
      notify(
        this.api,
        'warning',
        `Kriging capped at ${KRIGING_MAX_STATIONS} stations — showing IDW instead`,
        `克里金限制 ${KRIGING_MAX_STATIONS} 个站点以内 — 已改用 IDW`,
      );
      return idwGrid(pts, GRID_COLS, GRID_ROWS, bounds, this.state.power);
    }
    const vario = fitVariogram(pts);
    const field = krigingGrid(pts, GRID_COLS, GRID_ROWS, bounds, vario);
    if (!field) {
      notify(this.api, 'warning', 'Kriging system singular — showing IDW', '克里金方程组奇异 — 已改用 IDW');
      return idwGrid(pts, GRID_COLS, GRID_ROWS, bounds, this.state.power);
    }
    return field;
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
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = "12px 'Microsoft YaHei', Consolas, monospace";
      g.textAlign = 'center';
      g.fillText(zh ? '请从示例或文件加载 lon,lat,value CSV 数据' : 'Load a lon,lat,value CSV from samples or a file', canvas.width / 2, canvas.height / 2);
      return;
    }

    const bounds = boundsOf(pts);
    const field = this.computeField(bounds);
    if (!field) return;

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
