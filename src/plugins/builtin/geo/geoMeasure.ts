// ==========================================================================
// Example plugin: Distance & Area Measure
//
// A click-to-measure canvas: the classic geography-lab exercise of pacing
// out distances and areas on a map. Points are added by clicking; distances
// use great-circle (haversine) arithmetic and areas the spherical polygon
// excess formula, both shared with the other geo plugins via geoCore.
//
// Canvas interaction needs real DOM listeners, so every handler registered
// here is removed again in destroy() — the studio may mount/unmount plugin
// views freely and stale listeners would double-fire clicks.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, exportCanvasPng, actionFired, notify } from '../shared/enhance';
import { isZh, parseDelimited, stripHeaderIfNonNumeric, haversineKm, sphericalAreaKm2 } from './geoCore';
import { geoMeasureManifest } from './geoMeasureManifest';

export { geoMeasureManifest } from './geoMeasureManifest';

// ---- Parsing (exported for tests) ------------------------------------------

export interface Waypoint {
  name?: string;
  lat: number;
  lon: number;
}

/** Accept `{ points: [...] }`, a plain array, or a lon,lat[,name] CSV. */
export function parseWaypoints(text: string): Waypoint[] {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const parsed = JSON.parse(t) as unknown;
      const list = Array.isArray(parsed)
        ? (parsed as unknown[])
        : ((parsed as { points?: unknown[] }).points ?? []);
      const out: Waypoint[] = [];
      for (const item of list) {
        const o = item as Record<string, unknown>;
        const lat = Number(o?.lat);
        const lon = Number(o?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        out.push({ lat, lon, name: typeof o?.name === 'string' ? o.name : undefined });
      }
      return out;
    } catch {
      return [];
    }
  }
  const rows = stripHeaderIfNonNumeric(parseDelimited(text));
  const out: Waypoint[] = [];
  for (const row of rows) {
    const lon = Number(row[0]);
    const lat = Number(row[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push({ lon, lat, name: row[2]?.trim() || undefined });
  }
  return out;
}

/** Total great-circle length of a waypoint chain (km). */
export function chainLengthKm(points: Waypoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += haversineKm(points[i - 1]!.lat, points[i - 1]!.lon, points[i]!.lat, points[i]!.lon);
  }
  return sum;
}

/** Spherical polygon area (km²) and perimeter including the closing edge. */
export function polygonAreaKm2(points: Waypoint[]): { area: number; perimeter: number } {
  if (points.length < 3) return { area: 0, perimeter: chainLengthKm(points) };
  const ring = points.map((p) => [p.lat, p.lon] as [number, number]);
  let perimeter = chainLengthKm(points);
  perimeter += haversineKm(points[points.length - 1]!.lat, points[points.length - 1]!.lon, points[0]!.lat, points[0]!.lon);
  return { area: sphericalAreaKm2(ring), perimeter };
}

// ---- Plugin ----------------------------------------------------------------

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.32;

interface ViewState {
  centerLat: number;
  centerLon: number;
  kmPerPx: number;
}

interface State {
  mode: 'distance' | 'area';
  points: Waypoint[];
  view: ViewState;
}

export class GeoMeasurePlugin implements Plugin {
  readonly manifest = geoMeasureManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = {
    mode: 'distance',
    points: [],
    view: { centerLat: 36, centerLon: 105, kmPerPx: 120 },
  };

  // DOM listener bookkeeping (removed in destroy / re-render).
  private boundCanvas: HTMLCanvasElement | null = null;
  private onClickHandler: ((ev: MouseEvent) => void) | null = null;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.detachListeners();
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.attachListeners(container.canvas2d);
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'undo')) {
      this.state.points.pop();
      this.draw();
      return;
    }
    if (actionFired(params, 'clear')) {
      this.state.points = [];
      this.draw();
      return;
    }
    if (actionFired(params, 'fitView')) {
      this.fitView();
      this.draw();
      return;
    }
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'geo-measure');
      return;
    }
    if (params.mode === 'distance' || params.mode === 'area') {
      this.state.mode = params.mode;
      this.draw();
    }
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'mode',
        label: 'Measure mode',
        labelI18n: { 'zh-CN': '量算模式', 'en-US': 'Measure mode' },
        type: 'select',
        value: this.state.mode,
        options: [
          { value: 'distance', label: 'Distance', labelI18n: { 'zh-CN': '测距（折线）', 'en-US': 'Distance (polyline)' } },
          { value: 'area', label: 'Area', labelI18n: { 'zh-CN': '测面（多边形）', 'en-US': 'Area (polygon)' } },
        ],
      },
      actionButton('undo', 'Undo point', '撤销上一点'),
      actionButton('clear', 'Clear all points', '清空所有点'),
      actionButton('fitView', 'Re-fit view', '视图复位'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const parsed = parseWaypoints(await file.text());
    if (parsed.length < 2) {
      notify(this.api, 'warning', 'Need ≥ 2 waypoints (lat/lon)', '至少需要 2 个点位（含经纬度）');
      return;
    }
    this.state.points = parsed;
    this.fitView();
    notify(this.api, 'success', `Loaded ${parsed.length} waypoints`, `已加载 ${parsed.length} 个点位`);
    this.draw();
  }

  // ---- canvas interaction --------------------------------------------------

  private detachListeners() {
    if (this.boundCanvas && this.onClickHandler) {
      this.boundCanvas.removeEventListener('click', this.onClickHandler);
    }
    this.boundCanvas = null;
    this.onClickHandler = null;
  }

  private attachListeners(canvas: HTMLCanvasElement | undefined) {
    if (!canvas) return;
    if (this.boundCanvas === canvas) return;
    this.detachListeners();
    this.onClickHandler = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const { centerLat, centerLon, kmPerPx } = this.state.view;
      const dLat = ((canvas.height / 2 - y) * kmPerPx) / KM_PER_DEG_LAT;
      const dLon = ((x - canvas.width / 2) * kmPerPx) / (KM_PER_DEG_LON_EQ * Math.max(0.2, Math.cos((centerLat * Math.PI) / 180)));
      const lat = Math.max(-85, Math.min(85, centerLat + dLat));
      const lon = Math.max(-180, Math.min(180, centerLon + dLon));
      this.state.points.push({ lat, lon });
      this.draw();
    };
    canvas.addEventListener('click', this.onClickHandler);
    this.boundCanvas = canvas;
  }

  private fitView() {
    const pts = this.state.points;
    if (pts.length === 0) {
      this.state.view = { centerLat: 36, centerLon: 105, kmPerPx: 120 };
      return;
    }
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const p of pts) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    }
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const canvas = this.ctx?.canvas2d;
    const wKm = Math.max((maxLon - minLon) * KM_PER_DEG_LON_EQ * Math.max(0.2, Math.cos((centerLat * Math.PI) / 180)), 30);
    const hKm = Math.max((maxLat - minLat) * KM_PER_DEG_LAT, 30);
    const kmPerPx = Math.max(wKm / Math.max(canvas?.width ?? 640, 1), hKm / Math.max(canvas?.height ?? 420, 1)) * 1.6;
    this.state.view = { centerLat, centerLon, kmPerPx };
  }

  // ---- drawing -------------------------------------------------------------

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
    const { centerLat, centerLon, kmPerPx } = this.state.view;

    const px = (lon: number) => canvas.width / 2 + ((lon - centerLon) * KM_PER_DEG_LON_EQ * Math.max(0.2, Math.cos((centerLat * Math.PI) / 180))) / kmPerPx;
    const py = (lat: number) => canvas.height / 2 - ((lat - centerLat) * KM_PER_DEG_LAT) / kmPerPx;

    // Graticule with a "nice" spacing.
    const degPerPx = kmPerPx / KM_PER_DEG_LAT;
    const step = niceStep(degPerPx * 80);
    g.strokeStyle = 'rgba(120, 135, 158, 0.16)';
    g.lineWidth = 1;
    g.beginPath();
    for (let lat = Math.ceil((centerLat - 90) / step) * step; lat <= centerLat + 90; lat += step) {
      const y = py(lat);
      if (y < -4 || y > canvas.height + 4) continue;
      g.moveTo(0, y);
      g.lineTo(canvas.width, y);
    }
    for (let lon = Math.ceil((centerLon - 180) / step) * step; lon <= centerLon + 180; lon += step) {
      const x = px(lon);
      if (x < -4 || x > canvas.width + 4) continue;
      g.moveTo(x, 0);
      g.lineTo(x, canvas.height);
    }
    g.stroke();

    // Geometry.
    const pts = this.state.points;
    if (pts.length >= 2) {
      g.strokeStyle = '#5fd0a5';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px(pts[0]!.lon), py(pts[0]!.lat));
      for (let i = 1; i < pts.length; i += 1) g.lineTo(px(pts[i]!.lon), py(pts[i]!.lat));
      if (this.state.mode === 'area' && pts.length >= 3) g.closePath();
      g.stroke();
    }

    // Segment labels + vertex markers.
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i]!;
      const x = px(p.lon);
      const y = py(p.lat);
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fillStyle = '#5fd0a5';
      g.fill();
      g.strokeStyle = '#0a0e13';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = 'rgba(235, 242, 250, 0.95)';
      g.textAlign = 'left';
      const label = p.name ? `${i + 1}·${p.name}` : String(i + 1);
      g.fillText(label, x + 7, y - 6);
      if (i > 0) {
        const q = pts[i - 1]!;
        const d = haversineKm(p.lat, p.lon, q.lat, q.lon);
        g.fillStyle = '#ffd479';
        g.textAlign = 'center';
        g.fillText(`${d.toFixed(1)} km`, (px(p.lon) + px(q.lon)) / 2, (py(p.lat) + py(q.lat)) / 2 - 4);
      }
    }

    // Header readout.
    g.textAlign = 'left';
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(235, 242, 250, 0.95)';
    if (this.state.mode === 'distance') {
      const total = chainLengthKm(pts);
      g.fillText(
        zh
          ? `测距：${pts.length} 个点，累计 ${fmtKm(total)}${pts.length < 2 ? '（点击画布加点）' : ''}`
          : `Distance: ${pts.length} points, total ${fmtKm(total)}${pts.length < 2 ? ' (click the canvas to add)' : ''}`,
        14,
        20,
      );
    } else {
      const { area, perimeter } = polygonAreaKm2(pts);
      g.fillText(
        zh
          ? `测面：${pts.length} 个顶点，面积 ${fmtArea(area)}，周长 ${fmtKm(perimeter)}${pts.length < 3 ? '（测面需 ≥ 3 点）' : ''}`
          : `Area: ${pts.length} vertices, ${fmtArea(area)}, perimeter ${fmtKm(perimeter)}${pts.length < 3 ? ' (need ≥ 3 points)' : ''}`,
        14,
        20,
      );
    }

    // Scale bar.
    const barPx = 100;
    const barKm = barPx * kmPerPx;
    g.strokeStyle = 'rgba(220, 228, 240, 0.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(14, canvas.height - 18);
    g.lineTo(14 + barPx, canvas.height - 18);
    g.moveTo(14, canvas.height - 22);
    g.lineTo(14, canvas.height - 14);
    g.moveTo(14 + barPx, canvas.height - 22);
    g.lineTo(14 + barPx, canvas.height - 14);
    g.stroke();
    g.fillStyle = 'rgba(220, 228, 240, 0.9)';
    g.fillText(fmtKm(barKm), 14, canvas.height - 26);
  }
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const norm = raw / pow;
  const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return nice * pow;
}

function fmtKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(2)}×10³ km`;
  return `${km.toFixed(1)} km`;
}

function fmtArea(km2: number): string {
  if (km2 >= 1e6) return `${(km2 / 1e6).toFixed(2)}×10⁶ km²`;
  if (km2 >= 1e3) return `${(km2 / 1e3).toFixed(1)}×10³ km²`;
  return `${km2.toFixed(1)} km²`;
}

export default function createGeoMeasurePlugin(): Plugin {
  return new GeoMeasurePlugin();
}
