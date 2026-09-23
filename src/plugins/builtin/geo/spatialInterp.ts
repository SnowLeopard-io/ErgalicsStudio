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

/** Inverse-distance-weighted gridding over a row-major field (row 0 = maxLat). */
export function idwGrid(points: InterpPoint[], cols: number, rows: number, bounds: Bounds, power: number): Float64Array {
  const field = new Float64Array(cols * rows);
  const p = Math.max(0.5, power);
  for (let r = 0; r < rows; r += 1) {
    const lat = bounds.maxLat - ((bounds.maxLat - bounds.minLat) * r) / (rows - 1);
    for (let c = 0; c < cols; c += 1) {
      const lon = bounds.minLon + ((bounds.maxLon - bounds.minLon) * c) / (cols - 1);
      let wSum = 0;
      let vSum = 0;
      let exact = -1;
      for (const pt of points) {
        const d = haversineKm(lat, lon, pt.lat, pt.lon);
        if (d < 1e-6) {
          exact = pt.value;
          break;
        }
        const w = 1 / Math.pow(d, p);
        wSum += w;
        vSum += w * pt.value;
      }
      field[r * cols + c] = exact >= 0 ? exact : vSum / wSum;
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

/**
 * Fit a variogram by grid search over nugget × range for both candidate
 * models, minimising SSE against the empirical (binned) semivariance.
 * The prior sill is the sample variance — the standard first guess.
 */
export function fitVariogram(points: InterpPoint[]): Variogram {
  const n = points.length;
  const mean = points.reduce((a, p) => a + p.value, 0) / (n || 1);
  const sill = Math.max(points.reduce((a, p) => a + (p.value - mean) ** 2, 0) / Math.max(1, n - 1), 1e-9);

  // Empirical bins: 12 lags up to half the maximum pair distance.
  const pairs: Array<{ h: number; g: number }> = [];
  let hMax = 0;
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
  const gammaEmp: number[] = [];
  for (let b = 0; b < NB; b += 1) {
    if ((binCnt[b] ?? 0) === 0) continue;
    centers.push(((b + 0.5) / NB) * lagMax);
    gammaEmp.push((binSum[b] ?? 0) / (binCnt[b] ?? 1));
  }

  const nuggets = [0, 0.05, 0.1, 0.2, 0.35].map((f) => f * sill);
  const ranges: number[] = [];
  for (let i = 0; i < 14; i += 1) ranges.push((lagMax * (i + 2)) / 15);

  let best: Variogram = { model: 'spherical', nugget: 0, sill, range: lagMax, sse: Infinity };
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
  // Precompute station-station semivariances.
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

  // Gauss-Jordan inverse of the augmented matrix.
  const inv = invertMatrix(A);
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

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state.points = [];
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
        ? `${this.state.title || '空间插值'}　${methodLabel}　${pts.length} 站点`
        : `${this.state.title || 'Spatial interpolation'}　${methodLabel}　${pts.length} stations`,
      14,
      20,
    );
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
}

function fmtVal(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(v >= 100 ? 0 : 1);
}

export default function createSpatialInterpPlugin(): Plugin {
  return new SpatialInterpPlugin();
}
