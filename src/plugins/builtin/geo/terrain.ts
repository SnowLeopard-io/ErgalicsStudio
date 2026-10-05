// ==========================================================================
// Example plugin: DEM Terrain Analysis
//
// Reads an ESRI ASCII Grid (.asc) digital elevation model and draws it as
// colour-ramped elevation, a computed hillshade, Horn's slope / aspect
// rasters, or plain elevation with contour lines from marching squares.
//
// The hillshade follows the classic single-source formulation: with solar
// azimuth A and altitude h, shade = cos(zenith)·cos(slope)
//                                    + sin(zenith)·sin(slope)·cos(A − aspect),
// using Horn's 3×3 (ROOK+SIGNED style) finite differences for dz/dx, dz/dy.
// NoData cells propagate as NaN and render as the canvas background.
//
// The watershed mode runs the classic hydrological pipeline: priority-flood
// depression filling (Barnes et al. 2014, epsilon gradient), D8 flow
// directions (steepest strict descent) and flow accumulation in Kahn
// topological order. Watershed statistics (basin area, drainage density) are
// extracted from the outlet of the highest-accumulation sink.
//
// Scientific outputs: Horn vs Zevenbergen–Thorne slope error band, watershed
// statistics, and the assumed CRS/unit note. An embedded analytic benchmark
// (z = 0.05·(u²+v²) paraboloid DEM) scores slope/flow-direction recovery —
// always labelled as a benchmark, never as user data.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { actionButton, exportCanvasPng, exportSnapshotPng, actionFired, notify } from '@/core/plugin-tools/enhance';
import { heatmapColor } from '@/core/wgsl';
import { marchingSquares } from './geoCore';
import { isZh } from '@/core/plugin-tools/locale';
import { setScienceOutputs, clearScienceOutputs, fmtMetric } from '@/core/research/scienceOutput';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, panelTag, panelPlace, FIGURE_PANEL_WIDTH, FIGURE_PANEL_HEIGHT } from '@/core/figure/sheet';
import type { FigurePanelSpec, Bilingual } from '@/core/figure/sheet';
import { terrainManifest } from './terrainManifest';
import { buildTerrainGroup, fitTerrainCamera } from './terrain3d';
import type { Group } from 'three';
import type { AscGrid } from '@/core/geo/terrainMesh';

export type { AscGrid };

export { terrainManifest } from './terrainManifest';

// ---- Parsing & terrain math (exported for tests) ---------------------------

const HEADER_KEYS = /^(ncols|nrows|xllcorner|yllcorner|cellsize|nodata_value)$/i;

export function parseAsciiGrid(text: string): AscGrid | null {
  const lines = text.split(/\r?\n/);
  const header: Record<string, number> = {};
  let valueStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const m = /^(\w+)\s+(-?[\d.eE+]+)$/.exec(line);
    if (m && HEADER_KEYS.test(m[1]!)) {
      header[m[1]!.toLowerCase()] = Number(m[2]);
    } else {
      valueStart = i;
      break;
    }
  }
  if (valueStart < 0) return null;
  const ncols = header['ncols'] ?? -1;
  const nrows = header['nrows'] ?? -1;
  if (!Number.isFinite(ncols) || !Number.isFinite(nrows) || ncols < 1 || nrows < 1) return null;
  const values = new Float64Array(ncols * nrows);
  const nodata = Number.isFinite(header['nodata_value']) ? header['nodata_value']! : -9999;

  const tokens: string[] = [];
  for (let i = valueStart; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    for (const tok of line.split(/\s+/)) tokens.push(tok);
  }
  if (tokens.length < ncols * nrows) return null;
  for (let i = 0; i < ncols * nrows; i += 1) {
    const v = Number(tokens[i]);
    values[i] = Number.isFinite(v) && v !== nodata ? v : NaN;
  }
  return {
    ncols,
    nrows,
    xllcorner: header['xllcorner'] ?? 0,
    yllcorner: header['yllcorner'] ?? 0,
    cellsize: header['cellsize'] ?? 1,
    nodata,
    values,
  };
}

export interface SlopeAspect {
  /** Slope in degrees (Horn 3×3); NaN on edges and NoData-adjacent cells. */
  slope: Float64Array;
  /** Compass aspect in degrees 0-360 (0 = north-facing); NaN likewise. */
  aspect: Float64Array;
}

/** Horn's method finite differences over a 3×3 window. */
export function hornSlopeAspect(values: Float64Array, ncols: number, nrows: number, cellsize: number): SlopeAspect {
  const slope = new Float64Array(ncols * nrows).fill(NaN);
  const aspect = new Float64Array(ncols * nrows).fill(NaN);
  const at = (x: number, y: number): number => values[y * ncols + x]!;
  for (let y = 1; y + 1 < nrows; y += 1) {
    for (let x = 1; x + 1 < ncols; x += 1) {
      // Window: a b c / d e f / g h i  (row-major, top-left a).
      const a = at(x - 1, y - 1);
      const b = at(x, y - 1);
      const c = at(x + 1, y - 1);
      const d = at(x - 1, y);
      const f = at(x + 1, y);
      const g2 = at(x - 1, y + 1);
      const h = at(x, y + 1);
      const i2 = at(x + 1, y + 1);
      if ([a, b, c, d, f, g2, h, i2].some((v) => !Number.isFinite(v))) continue;
      const dzdx = (c + 2 * f + i2 - (a + 2 * d + g2)) / (8 * cellsize);
      const dzdy = (g2 + 2 * h + i2 - (a + 2 * b + c)) / (8 * cellsize);
      const sl = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      // ESRI-style conversion to compass aspect.
      let asp = (Math.atan2(dzdy, -dzdx) * 180) / Math.PI;
      asp = asp < 90 ? 90 - asp : 360 - asp + 90;
      const idx = y * ncols + x;
      slope[idx] = sl;
      aspect[idx] = asp;
    }
  }
  return { slope, aspect };
}

/**
 * Single-source hillshade from precomputed slope/aspect rasters.
 * Returns 0..1 (NaN where inputs are NaN).
 */
export function hillshadeFromSlope(
  slope: Float64Array,
  aspect: Float64Array,
  azimuthDeg = 315,
  altitudeDeg = 45,
): Float64Array {
  const out = new Float64Array(slope.length).fill(NaN);
  const zenith = ((90 - altitudeDeg) * Math.PI) / 180;
  const az = azimuthDeg * (Math.PI / 180);
  for (let i = 0; i < slope.length; i += 1) {
    const sl = slope[i]!;
    const asp = aspect[i]!;
    if (!Number.isFinite(sl) || !Number.isFinite(asp)) continue;
    const slopeRad = (sl * Math.PI) / 180;
    const aspectRad = (asp * Math.PI) / 180;
    out[i] = Math.cos(zenith) * Math.cos(slopeRad) + Math.sin(zenith) * Math.sin(slopeRad) * Math.cos(az - aspectRad);
  }
  return out;
}

// ---- Watershed analysis (priority-flood + D8, exported for tests) -----------

/** Binary min-heap over grid indices keyed by external numeric keys. */
class MinHeap {
  private idx: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(idx: number, key: number): void {
    this.idx.push(idx);
    this.keys.push(key);
    let i = this.idx.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.keys[parent] ?? Infinity) <= (this.keys[i] ?? Infinity)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Remove and return the index carrying the smallest key. */
  pop(): number {
    const top = this.idx[0]!;
    const last = this.idx.length - 1;
    this.swap(0, last);
    this.idx.pop();
    this.keys.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let s = i;
      if (l < this.idx.length && (this.keys[l] ?? Infinity) < (this.keys[s] ?? Infinity)) s = l;
      if (r < this.idx.length && (this.keys[r] ?? Infinity) < (this.keys[s] ?? Infinity)) s = r;
      if (s === i) break;
      this.swap(i, s);
      i = s;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.idx[a]!;
    this.idx[a] = this.idx[b]!;
    this.idx[b] = ti;
    const tk = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = tk;
  }
}

/**
 * Priority-flood depression filling (Barnes et al. 2014) with an epsilon
 * gradient: cells inside depressions are raised to just above their spill
 * level so the filled surface strictly increases away from the drainage
 * seeds — this guarantees D8 finds a downslope neighbour even on flats.
 * Boundary cells seed the flood; NoData cells (also interior holes) seed at
 * key −Infinity so they act as drains, and stay NaN in the output.
 */
export function fillDepressions(values: Float64Array, ncols: number, nrows: number): Float64Array {
  const n = ncols * nrows;
  const filled = new Float64Array(n);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  for (let y = 0; y < nrows; y += 1) {
    for (let x = 0; x < ncols; x += 1) {
      const i = y * ncols + x;
      const v = values[i]!;
      filled[i] = v;
      if (x === 0 || y === 0 || x === ncols - 1 || y === nrows - 1 || !Number.isFinite(v)) {
        closed[i] = 1;
        heap.push(i, Number.isFinite(v) ? v : -Infinity);
      }
    }
  }
  while (heap.size > 0) {
    const cur = heap.pop();
    const cy = Math.floor(cur / ncols);
    const cx = cur % ncols;
    const zc = filled[cur]!;
    const curNoData = !Number.isFinite(zc);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= ncols || ny >= nrows) continue;
        const ni = ny * ncols + nx;
        if (closed[ni]) continue;
        closed[ni] = 1;
        const zv = values[ni]!;
        if (!Number.isFinite(zv)) {
          filled[ni] = NaN;
          heap.push(ni, -Infinity);
          continue;
        }
        const eps = Math.max(1e-6, Math.abs(zc) * 1e-9);
        filled[ni] = curNoData || zv > zc ? zv : zc + eps;
        heap.push(ni, filled[ni]!);
      }
    }
  }
  return filled;
}

/** Direction code meaning "no downslope neighbour" (NoData or outlet). */
export const D8_NODIR = -1;

/**
 * D8 flow directions on the filled surface: each cell points at its steepest
 * strictly-downslope neighbour (cardinal distance = cellsize, diagonal =
 * cellsize·√2). Strictly positive slope makes cycles impossible, so the
 * graph is a DAG ready for topological accumulation.
 */
export function d8FlowDirections(filled: Float64Array, ncols: number, nrows: number, cellsize: number): Int32Array {
  const dir = new Int32Array(ncols * nrows).fill(D8_NODIR);
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= ncols || y >= nrows ? NaN : filled[y * ncols + x]!;
  for (let y = 0; y < nrows; y += 1) {
    for (let x = 0; x < ncols; x += 1) {
      const i = y * ncols + x;
      const z = filled[i]!;
      if (!Number.isFinite(z)) continue;
      let bestSlope = 0;
      let bestIdx = D8_NODIR;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nz = at(x + dx, y + dy);
          if (!Number.isFinite(nz)) continue;
          const dist = dx !== 0 && dy !== 0 ? cellsize * Math.SQRT2 : cellsize;
          const slope = (z - nz) / dist;
          if (slope > bestSlope) {
            bestSlope = slope;
            bestIdx = (y + dy) * ncols + (x + dx);
          }
        }
      }
      dir[i] = bestIdx;
    }
  }
  return dir;
}

/**
 * Flow accumulation by Kahn topological traversal of the D8 graph: every
 * valid cell contributes 1 unit of rain and passes its running total to its
 * downstream neighbour. NoData cells contribute 0.
 */
export function flowAccumulation(filled: Float64Array, dir: Int32Array): Float64Array {
  const n = filled.length;
  const acc = new Float64Array(n);
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    acc[i] = Number.isFinite(filled[i]!) ? 1 : 0;
    const d = dir[i]!;
    if (d >= 0) indeg[d]! += 1;
  }
  const queue: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (indeg[i] === 0 && Number.isFinite(filled[i]!)) queue.push(i);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head]!;
    const d = dir[cur]!;
    if (d < 0) continue;
    acc[d]! += acc[cur]!;
    indeg[d]! -= 1;
    if (indeg[d] === 0) queue.push(d);
  }
  return acc;
}

/**
 * Zevenbergen–Thorne slope (degrees) — 4-neighbour central differences:
 * dz/dx = (f − d)/(2·cellsize), dz/dy = (h − b)/(2·cellsize). Curvature-
 * sensitive (fits a plane through the nine cells), so it diverges from Horn
 * on convex/convex tops and in pits; the disagreement band is published.
 */
export function zevenbergenThorneSlope(values: Float64Array, ncols: number, nrows: number, cellsize: number): Float64Array {
  const slope = new Float64Array(ncols * nrows).fill(NaN);
  const at = (x: number, y: number): number => values[y * ncols + x]!;
  for (let y = 1; y + 1 < nrows; y += 1) {
    for (let x = 1; x + 1 < ncols; x += 1) {
      const d = at(x - 1, y);
      const f = at(x + 1, y);
      const b = at(x, y - 1);
      const h = at(x, y + 1);
      if (!Number.isFinite(d) || !Number.isFinite(f) || !Number.isFinite(b) || !Number.isFinite(h)) continue;
      const dzdx = (f - d) / (2 * cellsize);
      const dzdy = (h - b) / (2 * cellsize);
      slope[y * ncols + x] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  }
  return slope;
}

/** Agreement band of two slope algorithms (Horn vs Zevenbergen–Thorne). */
export interface SlopeErrorBand {
  n: number;
  /** Median |slope_Horn − slope_ZT| in degrees. */
  medianDeg: number;
  /** Maximum |slope_Horn − slope_ZT| in degrees. */
  maxDeg: number;
}

/**
 * Slope error band between two algorithms: the median and maximum absolute
 * disagreement over cells where both are defined. A proxy for the
 * algorithm-induced uncertainty of terrain derivatives.
 */
export function slopeErrorBand(horn: Float64Array, zt: Float64Array): SlopeErrorBand | null {
  const diffs: number[] = [];
  for (let i = 0; i < horn.length && i < zt.length; i += 1) {
    const a = horn[i]!;
    const b = zt[i]!;
    if (Number.isFinite(a) && Number.isFinite(b)) diffs.push(Math.abs(a - b));
  }
  if (diffs.length === 0) return null;
  diffs.sort((x, y) => x - y);
  const mid = diffs.length >> 1;
  const median = diffs.length % 2 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
  return { n: diffs.length, medianDeg: median, maxDeg: diffs[diffs.length - 1]! };
}

// ---- Watershed statistics (exported for tests) -------------------------------

/** Watershed summary extracted from the D8/accumulation pipeline. */
export interface WatershedStats {
  outletIdx: number;
  outletCol: number;
  outletRow: number;
  /** Flow accumulation at the outlet (= contributing cells). */
  outletAcc: number;
  /** Cells draining to the outlet. */
  basinCells: number;
  basinAreaKm2: number;
  streamCells: number;
  streamLengthKm: number;
  /** Drainage density = stream length / basin area (km⁻¹). */
  drainageDensityKm1: number;
  /** Stream-definition threshold used (cells). */
  streamThreshold: number;
}

/**
 * Watershed statistics for the largest drainage: the outlet is the
 * highest-accumulation sink (D8_NODIR), the basin is its full upstream
 * area, and streams are basin cells with accumulation ≥ max(10, 1 % of the
 * basin) — each contributing one cell-length of channel.
 */
export function watershedStats(
  filled: Float64Array,
  dir: Int32Array,
  acc: Float64Array,
  ncols: number,
  nrows: number,
  cellsize: number,
): WatershedStats | null {
  const n = ncols * nrows;
  let outlet = -1;
  let best = 0;
  for (let i = 0; i < n; i += 1) {
    if (dir[i] === D8_NODIR && Number.isFinite(filled[i]!) && acc[i]! > best) {
      best = acc[i]!;
      outlet = i;
    }
  }
  if (outlet < 0) return null;

  // Reverse D8 adjacency, then upstream BFS from the outlet.
  const upstream: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i += 1) {
    const d = dir[i]!;
    if (d >= 0 && d < n) upstream[d]!.push(i);
  }
  const inBasin = new Uint8Array(n);
  const stack: number[] = [outlet];
  inBasin[outlet] = 1;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const up of upstream[cur]!) {
      if (!inBasin[up]) {
        inBasin[up] = 1;
        stack.push(up);
      }
    }
  }
  let basinCells = 0;
  for (let i = 0; i < n; i += 1) if (inBasin[i]) basinCells += 1;
  const streamThreshold = Math.max(10, 0.01 * basinCells);
  let streamCells = 0;
  for (let i = 0; i < n; i += 1) {
    if (inBasin[i] && acc[i]! >= streamThreshold) streamCells += 1;
  }
  const basinAreaKm2 = (basinCells * cellsize * cellsize) / 1e6;
  const streamLengthKm = (streamCells * cellsize) / 1000;
  return {
    outletIdx: outlet,
    outletCol: outlet % ncols,
    outletRow: Math.floor(outlet / ncols),
    outletAcc: acc[outlet]!,
    basinCells,
    basinAreaKm2,
    streamCells,
    streamLengthKm,
    drainageDensityKm1: basinAreaKm2 > 0 ? streamLengthKm / basinAreaKm2 : 0,
    streamThreshold,
  };
}

/** Watershed + slope-band summary table as CSV (metric,value,unit rows). */
export function watershedStatsCsv(stats: WatershedStats | null, band: SlopeErrorBand | null, grid: AscGrid): string {
  const rows: string[] = ['# Terrain analysis summary', 'metric,value,unit'];
  const add = (metric: string, value: string, unit: string) => rows.push(`${metric},${value},${unit}`);
  add('grid_ncols', String(grid.ncols), 'cells');
  add('grid_nrows', String(grid.nrows), 'cells');
  add('cellsize', String(grid.cellsize), 'm');
  add('assumed_crs', 'EPSG:4326 (lon/lat, cellsize interpreted as metres)', '');
  if (band) {
    add('slope_diff_median_horn_zt', band.medianDeg.toFixed(4), 'deg');
    add('slope_diff_max_horn_zt', band.maxDeg.toFixed(4), 'deg');
  }
  if (stats) {
    add('outlet_col', String(stats.outletCol), 'cell');
    add('outlet_row', String(stats.outletRow), 'cell');
    add('outlet_accumulation', String(Math.round(stats.outletAcc)), 'cells');
    add('basin_cells', String(stats.basinCells), 'cells');
    add('basin_area', stats.basinAreaKm2.toFixed(4), 'km2');
    add('stream_cells', String(stats.streamCells), 'cells');
    add('stream_length', stats.streamLengthKm.toFixed(4), 'km');
    add('drainage_density', stats.drainageDensityKm1.toFixed(6), '1/km');
    add('stream_threshold', String(Math.round(stats.streamThreshold)), 'cells');
  }
  return rows.join('\n');
}

// ---- Analytic-surface benchmark (L4, exported for tests) ---------------------
//
// A paraboloid DEM with an ANALYTIC slope/gradient (z = 0.05·(u²+v²), 1 m
// cells) is piped through the same Horn + D8 code; the recovered slope and
// flow directions are scored against the closed form. Benchmark-tagged.

export const ANALYTIC_BENCH_TAG = 'analytic-surface-benchmark';

export interface AnalyticSurfaceBenchmark {
  tag: typeof ANALYTIC_BENCH_TAG;
  surface: string;
  cells: number;
  /** Median |slope_rec − slope_analytic| in degrees. */
  slopeMedianErrDeg: number;
  slopeMaxErrDeg: number;
  /** Median relative slope error (%) over cells steeper than 5°. */
  slopeMedianErrPct: number;
  /** % of cells whose D8 direction equals the analytic steepest descent. */
  flowAgreementPct: number;
}

/**
 * Build the z = 0.05·(u²+v²) paraboloid DEM (61×61, cellsize 1 m, centred).
 * ∇z = (0.1u, 0.1v), so the analytic slope is atan(0.1·r) degrees.
 */
export function analyticParaboloidDem(n = 61): Float64Array {
  const values = new Float64Array(n * n);
  const c = (n - 1) / 2;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const u = x - c;
      const v = y - c;
      values[y * n + x] = 0.05 * (u * u + v * v);
    }
  }
  return values;
}

export function runAnalyticSurfaceBenchmark(): AnalyticSurfaceBenchmark | null {
  const n = 61;
  const cs = 1;
  const values = analyticParaboloidDem(n);
  const c = (n - 1) / 2;

  // Slope recovery against atan(0.1·r).
  const { slope } = hornSlopeAspect(values, n, n, cs);
  const errsDeg: number[] = [];
  const errsPct: number[] = [];
  for (let y = 1; y + 1 < n; y += 1) {
    for (let x = 1; x + 1 < n; x += 1) {
      const rec = slope[y * n + x]!;
      if (!Number.isFinite(rec)) continue;
      const r = Math.hypot(x - c, y - c);
      const analytic = (Math.atan(0.1 * r) * 180) / Math.PI;
      const err = Math.abs(rec - analytic);
      errsDeg.push(err);
      if (analytic > 5) errsPct.push((err / analytic) * 100);
    }
  }
  if (errsDeg.length === 0) return null;
  errsDeg.sort((a, b) => a - b);
  const mid = errsDeg.length >> 1;
  const medianDeg = errsDeg.length % 2 ? errsDeg[mid]! : (errsDeg[mid - 1]! + errsDeg[mid]!) / 2;
  errsPct.sort((a, b) => a - b);
  const midP = errsPct.length >> 1;
  const medianPct = errsPct.length % 2 ? errsPct[midP]! : (errsPct[midP - 1]! + errsPct[midP]!) / 2;

  // Flow-direction recovery against the analytic steepest-descent neighbour.
  const filled = fillDepressions(values, n, n);
  const dir = d8FlowDirections(filled, n, n, cs);
  let eligible = 0;
  let matches = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const gx = 0.1 * (x - c);
      const gy = 0.1 * (y - c);
      if (gx === 0 && gy === 0) continue; // the outlet — no unique direction
      let bestSlope = 0;
      let bestDx = 0;
      let bestDy = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const descent = -(gx * dx + gy * dy) / Math.hypot(dx, dy);
          if (descent > bestSlope) {
            bestSlope = descent;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }
      const d = dir[y * n + x]!;
      eligible += 1;
      const ddx = (d % n) - x;
      const ddy = Math.floor(d / n) - y;
      if (d >= 0 && ddx === bestDx && ddy === bestDy) matches += 1;
    }
  }
  return {
    tag: ANALYTIC_BENCH_TAG,
    surface: 'z = 0.05·(u² + v²), cellsize 1 m',
    cells: n * n,
    slopeMedianErrDeg: medianDeg,
    slopeMaxErrDeg: errsDeg[errsDeg.length - 1]!,
    slopeMedianErrPct: medianPct,
    flowAgreementPct: eligible > 0 ? (matches / eligible) * 100 : 0,
  };
}

// ---- Figure Studio panels (exported for tests) ------------------------------

/**
 * Research sheet for one DEM: (a) elevation field, (b) Horn slope,
 * (c) D8 flow accumulation on a log₁₀ scale after priority-flood filling.
 */
export function terrainFigurePanels(grid: AscGrid): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  const { ncols, nrows, values, cellsize } = grid;

  // (a) elevation, NoData mapped to the field minimum.
  let zmin = Infinity;
  let zmax = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < zmin) zmin = v;
    if (v > zmax) zmax = v;
  }
  if (!Number.isFinite(zmin) || !Number.isFinite(zmax)) {
    zmin = 0;
    zmax = 1;
  }
  panels.push({
    ...panelPlace(panels.length),
    tag: panelTag(panels.length),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Elevation [m]',
      xLabel: 'col',
      yLabel: 'row',
      ticks: 4,
      series: [
        {
          name: 'elevation',
          kind: 'field',
          color: '#3CA0FF',
          field: {
            values: Array.from(values, (v) => (Number.isFinite(v) ? v : zmin)),
            rows: nrows,
            cols: ncols,
            domain: [zmin, zmax],
          },
        },
      ],
    },
  });

  // (b) Horn slope, NoData mapped to 0.
  const { slope } = hornSlopeAspect(values, ncols, nrows, cellsize);
  let smax = 0;
  for (const s of slope) {
    if (Number.isFinite(s) && s > smax) smax = s;
  }
  panels.push({
    ...panelPlace(panels.length),
    tag: panelTag(panels.length),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Slope (Horn 3×3) [°]',
      xLabel: 'col',
      yLabel: 'row',
      ticks: 4,
      series: [
        {
          name: 'slope',
          kind: 'field',
          color: '#E6A23C',
          field: {
            values: Array.from(slope, (s) => (Number.isFinite(s) ? s : 0)),
            rows: nrows,
            cols: ncols,
            domain: [0, smax],
          },
        },
      ],
    },
  });

  // (c) flow accumulation on a log₁₀ scale after depression filling.
  const filled = fillDepressions(values, ncols, nrows);
  const dir = d8FlowDirections(filled, ncols, nrows, cellsize);
  const acc = flowAccumulation(filled, dir);
  let amax = 1;
  for (const a of acc) {
    if (a > amax) amax = a;
  }
  panels.push({
    ...panelPlace(panels.length),
    tag: panelTag(panels.length),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Flow accumulation (D8, log₁₀)',
      xLabel: 'col',
      yLabel: 'row',
      ticks: 4,
      series: [
        {
          name: 'log10(acc)',
          kind: 'field',
          color: '#5FD0A5',
          field: {
            values: Array.from(acc, (a) => (Number.isFinite(a) ? Math.log10(a + 1) : 0)),
            rows: nrows,
            cols: ncols,
            domain: [0, Math.log10(amax + 1)],
          },
        },
      ],
    },
  });
  return panels;
}

// ---- Plugin ----------------------------------------------------------------

type TerrainMode = 'elevation' | 'hillshade' | 'slope' | 'aspect' | 'watershed' | '3d';

interface State {
  grid: AscGrid | null;
  mode: TerrainMode;
  showContours: boolean;
  verticalExaggeration: number;
}

const CONTOUR_TARGET = 10;

export class TerrainPlugin implements Plugin {
  readonly manifest = terrainManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { grid: null, mode: 'hillshade', showContours: false, verticalExaggeration: 1 };
  // 3D scene plumbing (see terrain3d.ts) — the group is cached against the
  // grid + exaggeration it was built from and rebuilt when either changes.
  private three: Scene3DHandle | null = null;
  private sceneHandle: Scene3DHandle | null = null;
  private terrainGroup: Group | null = null;
  private groupFor: AscGrid | null = null;
  private groupExag = -1;
  // Flow-accumulation cache (fill + D8 + Kahn is O(n log n) per run).
  private accFor: AscGrid | null = null;
  private accCache: Float64Array | null = null;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.teardown3d();
    this.ctx = null;
    this.state.grid = null;
    this.accFor = null;
    this.accCache = null;
    clearScienceOutputs(this.manifest.id);
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
  }

  async deactivate() {
    this.teardown3d();
  }

  /** Host entry for 3D-capable plugins (see pluginStore activation). */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.draw();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (container.three) this.three = container.three;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      if (this.state.mode === '3d') exportSnapshotPng(this.api, this.three?.snapshot(), 'geo-terrain-3d');
      else exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'geo-terrain');
      return;
    }
    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
      return;
    }
    let redraw = false;
    if (
      params.mode === 'elevation' ||
      params.mode === 'hillshade' ||
      params.mode === 'slope' ||
      params.mode === 'aspect' ||
      params.mode === 'watershed' ||
      params.mode === '3d'
    ) {
      this.state.mode = params.mode;
      redraw = true;
    }
    if (typeof params.showContours === 'boolean') {
      this.state.showContours = params.showContours;
      redraw = true;
    }
    if (typeof params.verticalExaggeration === 'number') {
      this.state.verticalExaggeration = Math.max(0.5, Math.min(3, params.verticalExaggeration));
      redraw = true;
    }
    if (redraw) this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'mode',
        label: 'View mode',
        labelI18n: { 'zh-CN': '视图模式', 'en-US': 'View mode' },
        type: 'select',
        value: this.state.mode,
        options: [
          { value: 'elevation', label: 'Elevation', labelI18n: { 'zh-CN': '高程设色', 'en-US': 'Elevation' } },
          { value: 'hillshade', label: 'Hillshade', labelI18n: { 'zh-CN': '山体阴影', 'en-US': 'Hillshade' } },
          { value: 'slope', label: 'Slope', labelI18n: { 'zh-CN': '坡度', 'en-US': 'Slope' } },
          { value: 'aspect', label: 'Aspect', labelI18n: { 'zh-CN': '坡向', 'en-US': 'Aspect' } },
          { value: 'watershed', label: 'Flow accumulation (D8)', labelI18n: { 'zh-CN': '汇流累积（D8）', 'en-US': 'Flow accumulation (D8)' } },
          { value: '3d', label: '3D Mesh', labelI18n: { 'zh-CN': '3D 建模视图', 'en-US': '3D Mesh View' } },
        ],
      },
      {
        key: 'verticalExaggeration',
        label: 'Vertical exaggeration',
        labelI18n: { 'zh-CN': '垂直夸张系数', 'en-US': 'Vertical exaggeration' },
        type: 'range',
        min: 0.5,
        max: 3,
        step: 0.1,
        value: this.state.verticalExaggeration,
      },
      {
        key: 'showContours',
        label: 'Contour overlay',
        labelI18n: { 'zh-CN': '等高线叠加', 'en-US': 'Contour overlay' },
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
    const grid = parseAsciiGrid(await file.text());
    if (!grid) {
      notify(this.api, 'warning', 'Not a valid ESRI ASCII Grid', '不是有效的 ESRI ASCII Grid');
      return;
    }
    this.state.grid = grid;
    this.api.reportDataScale(grid.ncols * grid.nrows);
    notify(
      this.api,
      'success',
      `Loaded ${grid.ncols}×${grid.nrows} grid, cell ${grid.cellsize}`,
      `已加载 ${grid.ncols}×${grid.nrows} 网格，像元 ${grid.cellsize}`,
    );
    this.publishScience();
    this.draw();
  }

  /**
   * Publish the terrain scientific outputs: Horn vs Zevenbergen–Thorne slope
   * error band, watershed summary, and the embedded analytic-surface
   * benchmark (explicitly tagged, never presented as user data).
   */
  private publishScience() {
    const grid = this.state.grid;
    if (!grid) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const metrics: ScienceMetric[] = [];

    // (a) Slope algorithm uncertainty: Horn vs Zevenbergen–Thorne.
    const { slope } = hornSlopeAspect(grid.values, grid.ncols, grid.nrows, grid.cellsize);
    const zt = zevenbergenThorneSlope(grid.values, grid.ncols, grid.nrows, grid.cellsize);
    const band = slopeErrorBand(slope, zt);
    if (band) {
      metrics.push({
        key: 'slope_diff_median',
        label: '|Δslope| med',
        value: fmtMetric(band.medianDeg),
        unit: '°',
        severity: 'info',
        hint: isZh(this.api.locale)
          ? 'Horn 与 Zevenbergen–Thorne 坡度差的中位数——坡度导数的算法不确定度代理。'
          : 'Median Horn vs Zevenbergen–Thorne slope disagreement — a proxy for algorithm-induced uncertainty.',
      });
      metrics.push({
        key: 'slope_diff_max',
        label: '|Δslope| max',
        value: fmtMetric(band.maxDeg),
        unit: '°',
        severity: 'info',
      });
    }

    // (b) Watershed summary from the D8/accumulation pipeline.
    const filled = fillDepressions(grid.values, grid.ncols, grid.nrows);
    const dir = d8FlowDirections(filled, grid.ncols, grid.nrows, grid.cellsize);
    const acc = flowAccumulation(filled, dir);
    const stats = watershedStats(filled, dir, acc, grid.ncols, grid.nrows, grid.cellsize);
    if (stats) {
      metrics.push({
        key: 'basin_area',
        label: 'basin area',
        value: fmtMetric(stats.basinAreaKm2),
        unit: 'km²',
        severity: 'info',
        hint: isZh(this.api.locale)
          ? '最大流域（最高累积汇出口的上游集水区）面积。'
          : 'Drainage area of the largest basin (upstream of the highest-accumulation outlet).',
      });
      metrics.push({
        key: 'drainage_density',
        label: 'drainage density',
        value: fmtMetric(stats.drainageDensityKm1),
        unit: '1/km',
        severity: 'info',
        hint: isZh(this.api.locale) ? '河网密度 = 河道长度 / 流域面积。' : 'Stream length per unit basin area.',
      });
    }

    // (c) Embedded analytic benchmark (paraboloid DEM with closed-form slope).
    const bench = runAnalyticSurfaceBenchmark();
    if (bench) {
      metrics.push({
        key: 'bench_slope_err',
        label: 'bench |Δslope|',
        value: fmtMetric(bench.slopeMedianErrDeg),
        unit: '°',
        severity: bench.slopeMedianErrDeg < 0.5 ? 'ok' : 'warn',
        hint: isZh(this.api.locale)
          ? `【基准】解析抛物面 DEM 恢复坡度的中位误差（${ANALYTIC_BENCH_TAG}）。`
          : `[benchmark] Median slope-recovery error on the analytic paraboloid DEM (${ANALYTIC_BENCH_TAG}).`,
      });
      metrics.push({
        key: 'bench_flow_agree',
        label: 'bench flow agree',
        value: `${bench.flowAgreementPct.toFixed(1)}%`,
        severity: bench.flowAgreementPct > 90 ? 'ok' : 'warn',
        hint: isZh(this.api.locale)
          ? '【基准】D8 方向与解析最陡下降方向一致的网格占比。'
          : '[benchmark] Share of cells whose D8 direction matches the analytic steepest descent.',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    // 3D mesh view: needs a grid and the host WebGL scene; anything else
    // falls back to the 2D raster path (which also hides the 3D overlay).
    if (this.state.mode === '3d' && this.state.grid && this.three) {
      this.draw3d();
      return;
    }
    this.teardown3d();
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 640;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = isZh(this.api.locale);
    const grid = this.state.grid;
    if (!grid) {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = "12px 'Microsoft YaHei', Consolas, monospace";
      g.textAlign = 'center';
      g.fillText(
        zh ? '请从示例或文件加载 ESRI ASCII Grid（.asc）' : 'Load an ESRI ASCII Grid (.asc) from samples or a file',
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }

    const { ncols, nrows, values } = grid;
    const raster: Float64Array = this.buildRaster();
    // Raster aspect-correct fit.
    const pad = 14;
    const scale = Math.min((canvas.width - 2 * pad) / ncols, (canvas.height - 2 * pad - 30) / nrows);
    const w = ncols * scale;
    const h = nrows * scale;
    const ox = (canvas.width - w) / 2;
    const oy = (canvas.height - 30 - h) / 2 + 4;

    // Value range for normalisation.
    let vmin = Infinity;
    let vmax = -Infinity;
    for (let i = 0; i < raster.length; i += 1) {
      const v = raster[i]!;
      if (!Number.isFinite(v)) continue;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    if (!(vmax > vmin)) vmax = vmin + 1e-9;
    // Watershed accumulations span decades — colour on a log scale.
    const logScale = this.state.mode === 'watershed';
    const logVmin = Math.log(Math.max(vmin, 0) + 1);
    const logVmax = Math.log(vmax + 1);

    const off = document.createElement('canvas');
    off.width = ncols;
    off.height = nrows;
    const og = off.getContext('2d');
    if (!og) return;
    const img = og.createImageData(ncols, nrows);
    for (let i = 0; i < raster.length; i += 1) {
      const v = raster[i]!;
      if (!Number.isFinite(v)) {
        img.data[i * 4 + 3] = 0;
        continue;
      }
      const t = logScale
        ? (Math.log(v + 1) - logVmin) / Math.max(logVmax - logVmin, 1e-9)
        : (v - vmin) / (vmax - vmin);
      let r: number;
      let gg: number;
      let b: number;
      if (this.state.mode === 'hillshade') {
        const s = Math.max(0, Math.min(1, v));
        r = gg = b = 0.12 + 0.8 * s;
      } else if (this.state.mode === 'aspect') {
        // Compass hue: N=teal, E=green, S=amber, W=violet (cosmetic).
        const hue = ((360 - v) / 360) * 6;
        const seg = Math.floor(hue) % 6;
        const f = hue - Math.floor(hue);
        const q = 1 - f;
        const rgb: [number, number, number] =
          seg === 0 ? [1, f * 0.7 + 0.3, 0.45] : seg === 1 ? [q * 0.7 + 0.3, 1, 0.45] : seg === 2 ? [0.45, 1, q * 0.55 + 0.45] : seg === 3 ? [0.45, q * 0.7 + 0.3, 1] : seg === 4 ? [q * 0.55 + 0.45, 0.45, 1] : [1, 0.45, q * 0.55 + 0.45];
        r = rgb[0];
        gg = rgb[1];
        b = rgb[2];
      } else {
        [r, gg, b] = heatmapColor(t);
      }
      img.data[i * 4] = Math.round(r * 255);
      img.data[i * 4 + 1] = Math.round(gg * 255);
      img.data[i * 4 + 2] = Math.round(b * 255);
      img.data[i * 4 + 3] = 255;
    }
    og.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(off, ox, oy, w, h);

    // Contour overlay on the elevation field.
    if (this.state.showContours && this.state.mode !== 'aspect' && this.state.mode !== 'watershed') {
      let zmin = Infinity;
      let zmax = -Infinity;
      for (let i = 0; i < values.length; i += 1) {
        const v = values[i]!;
        if (!Number.isFinite(v)) continue;
        if (v < zmin) zmin = v;
        if (v > zmax) zmax = v;
      }
      if (zmax > zmin) {
        const step = niceStep((zmax - zmin) / CONTOUR_TARGET);
        g.strokeStyle = 'rgba(10, 14, 20, 0.75)';
        g.lineWidth = 1;
        g.beginPath();
        for (let level = Math.ceil(zmin / step) * step; level < zmax; level += step) {
          for (const s of marchingSquares(values, ncols, nrows, level)) {
            g.moveTo(ox + (s.x1 / (ncols - 1)) * w, oy + (s.y1 / (nrows - 1)) * h);
            g.lineTo(ox + (s.x2 / (ncols - 1)) * w, oy + (s.y2 / (nrows - 1)) * h);
          }
        }
        g.stroke();
      }
    }

    // Header + legend.
    g.textAlign = 'left';
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(235, 242, 250, 0.95)';
    const modeNames: Record<TerrainMode, { zh: string; en: string }> = {
      elevation: { zh: '高程设色', en: 'Elevation' },
      hillshade: { zh: '山体阴影（315°/45°）', en: 'Hillshade (315°/45°)' },
      slope: { zh: '坡度', en: 'Slope' },
      aspect: { zh: '坡向', en: 'Aspect' },
      watershed: { zh: '汇流累积（D8）', en: 'Flow accumulation (D8)' },
      '3d': { zh: '3D 建模视图', en: '3D Mesh View' },
    };
    const rangeLabel =
      this.state.mode === 'elevation'
        ? `${fmtM(vmin)}–${fmtM(vmax)} m`
        : this.state.mode === 'slope'
          ? `0–${fmtM(vmax)}°`
          : this.state.mode === 'aspect'
            ? '0–360°'
            : this.state.mode === 'watershed'
              ? `1–${fmtM(vmax)} ${zh ? '格' : 'cells'}`
              : '';
    g.fillText(
      zh
        ? `DEM ${ncols}×${nrows}，像元 ${grid.cellsize} m\u3000|\u3000${modeNames[this.state.mode]!.zh}\u3000${rangeLabel}`
        : `DEM ${ncols}×${nrows}, cell ${grid.cellsize} m\u3000|\u3000${modeNames[this.state.mode]!.en}\u3000${rangeLabel}`,
      14,
      20,
    );
    if (this.state.mode !== 'aspect') {
      const grad = g.createLinearGradient(14, 0, 154, 0);
      for (let i = 0; i <= 10; i += 1) {
        const p = i / 10;
        let rgb: [number, number, number];
        if (this.state.mode === 'hillshade') {
          const s = 0.12 + 0.8 * p;
          rgb = [s, s, s];
        } else if (logScale) {
          // Legend ramp follows the log normalisation used for the pixels.
          const vp = vmin + p * (vmax - vmin);
          const tl = (Math.log(vp + 1) - logVmin) / Math.max(logVmax - logVmin, 1e-9);
          rgb = heatmapColor(Math.max(0, Math.min(1, tl)));
        } else {
          rgb = heatmapColor(p);
        }
        grad.addColorStop(p, `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`);
      }
      g.fillStyle = grad;
      g.fillRect(14, canvas.height - 24, 140, 10);
      g.fillStyle = 'rgba(220, 228, 240, 0.95)';
      g.fillText(this.state.mode === 'elevation' || logScale ? fmtM(vmin) : '0', 14, canvas.height - 28);
      g.textAlign = 'right';
      g.fillText(
        this.state.mode === 'elevation' || logScale
          ? fmtM(vmax)
          : this.state.mode === 'slope'
            ? `${vmax.toFixed(0)}°`
            : '1',
        154,
        canvas.height - 28,
      );
      g.textAlign = 'left';
    }
  }

  /** Raster for the active mode (elevation reused directly). */
  private buildRaster(): Float64Array {
    const grid = this.state.grid!;
    if (this.state.mode === 'elevation') return grid.values;
    if (this.state.mode === 'watershed') {
      if (this.accFor === grid && this.accCache) return this.accCache;
      const filled = fillDepressions(grid.values, grid.ncols, grid.nrows);
      const dir = d8FlowDirections(filled, grid.ncols, grid.nrows, grid.cellsize);
      this.accCache = flowAccumulation(filled, dir);
      this.accFor = grid;
      return this.accCache;
    }
    const { slope, aspect } = hornSlopeAspect(grid.values, grid.ncols, grid.nrows, grid.cellsize);
    if (this.state.mode === 'slope') return slope;
    if (this.state.mode === 'aspect') return aspect;
    return hillshadeFromSlope(slope, aspect);
  }

  /** Stream the elevation / slope / flow-accumulation research sheet to Figure Studio. */
  private async sendToFigure(): Promise<void> {
    const grid = this.state.grid;
    if (!grid) return;
    const caption: Bilingual = {
      zh: `地形分析（${grid.ncols}×${grid.nrows} 网格，像元 ${grid.cellsize} m）：高程场、Horn 3×3 差分坡度，以及填洼后的 D8 汇流累积（log₁₀ 刻度）。洼地填充用 priority-flood 优先级泛洪（Barnes 等 2014，ε 梯度），D8 方向取最陡下降 s = Δz / d（对角 d = √2·像元），汇流按 Kahn 拓扑序逐格累加。`,
      en: `Terrain analysis (${grid.ncols}×${grid.nrows} grid, ${grid.cellsize} m cells): elevation, Horn 3×3 slope, and D8 flow accumulation (log₁₀ scale) after depression filling. Depressions are filled by priority-flood (Barnes et al. 2014, epsilon gradient); D8 picks the steepest descent s = Δz / d (diagonal d = √2·cell); accumulation follows Kahn topological order.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '地形分析', en: 'Terrain analysis' },
      caption,
      terrainFigurePanels(grid),
    );
  }

  /** Show (or reuse) the displaced 3D terrain mesh in the host scene. */
  private draw3d() {
    const three = this.three!;
    const grid = this.state.grid!;
    if (this.groupFor !== grid || this.groupExag !== this.state.verticalExaggeration || this.sceneHandle !== three) {
      this.disposeGroup();
      this.terrainGroup = buildTerrainGroup(grid, this.state.verticalExaggeration);
      this.groupFor = grid;
      this.groupExag = this.state.verticalExaggeration;
      this.sceneHandle = three;
      three.scene.add(this.terrainGroup);
      fitTerrainCamera(three.camera, three.controls, this.state.verticalExaggeration);
    }
    three.setVisible(true);
    three.render();
  }

  /** Hide + free the 3D surface (2D view switch, deactivate, destroy).
   *  Always dispose: the host scene is SHARED, so a later 3-D plugin
   *  re-showing the surface must not find our mesh still in it. */
  private teardown3d() {
    this.disposeGroup();
    this.three?.setVisible(false);
  }

  private disposeGroup() {
    if (!this.terrainGroup) return;
    this.terrainGroup.parent?.remove(this.terrainGroup);
    this.terrainGroup.traverse((obj) => {
      const withGeo = obj as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      withGeo.geometry?.dispose();
      withGeo.material?.dispose();
    });
    this.terrainGroup = null;
    this.groupFor = null;
    this.groupExag = -1;
    this.sceneHandle = null;
  }
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const norm = raw / pow;
  const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return nice * pow;
}

function fmtM(v: number): string {
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(Math.abs(v) < 10 ? 1 : 0);
}

export default function createTerrainPlugin(): Plugin {
  return new TerrainPlugin();
}
