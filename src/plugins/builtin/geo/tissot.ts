// ==========================================================================
// Example plugin: Projection Distortion (Tissot Indicatrices)
//
// The classroom proof that every flat map lies somewhere: world coastlines
// drawn in seven classic projections, overlaid with Tissot indicatrices —
// small circles of equal angular radius sampled on the sphere. Where a
// circle inflates, areas are stretched; where it squashes into an ellipse,
// angles (shapes) are sheared. Mercator keeps circles round but blows them
// up toward the poles; the equal-area projections keep them at true size
// but tilt them away from the standard parallels.
//
// Projection math is unit-sphere (R = 1), input degrees. Orthographic
// hides the far hemisphere by returning `null` for invisible points.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, exportCanvasPng, actionFired, notify } from '../shared/enhance';
import { isZh } from './geoCore';
import { tissotManifest } from './tissotManifest';
import WORLD_LAND_RAW from '../../../../examples/data/geo-world-110m-land.json?raw';

export { tissotManifest } from './tissotManifest';

// ---- Projection math (exported for tests) ----------------------------------

const D2R = Math.PI / 180;

export type ProjId =
  | 'equirect'
  | 'mercator'
  | 'sinusoidal'
  | 'mollweide'
  | 'gall-peters'
  | 'lambert-az-eq'
  | 'orthographic';

export type ProjFn = (lon: number, lat: number) => [number, number] | null;

export interface ProjInfo {
  id: ProjId;
  /** Fixed unit-sphere drawing bounds for aspect-correct fitting. */
  bounds: { xmin: number; xmax: number; ymin: number; ymax: number };
}

export const PROJECTIONS: ProjInfo[] = [
  { id: 'equirect', bounds: { xmin: -Math.PI, xmax: Math.PI, ymin: -Math.PI / 2, ymax: Math.PI / 2 } },
  { id: 'mercator', bounds: { xmin: -Math.PI, xmax: Math.PI, ymin: -3.13, ymax: 3.13 } },
  { id: 'sinusoidal', bounds: { xmin: -Math.PI, xmax: Math.PI, ymin: -Math.PI / 2, ymax: Math.PI / 2 } },
  { id: 'mollweide', bounds: { xmin: -2 * Math.SQRT2, xmax: 2 * Math.SQRT2, ymin: -Math.SQRT2, ymax: Math.SQRT2 } },
  { id: 'gall-peters', bounds: { xmin: -Math.SQRT1_2 * Math.PI, xmax: Math.SQRT1_2 * Math.PI, ymin: -Math.SQRT2, ymax: Math.SQRT2 } },
  { id: 'lambert-az-eq', bounds: { xmin: -2, xmax: 2, ymin: -2, ymax: 2 } },
  { id: 'orthographic', bounds: { xmin: -1, xmax: 1, ymin: -1, ymax: 1 } },
];

/** Cylindrical equidistant: x = λ, y = φ. */
export function projectEquirect(lon: number, lat: number): [number, number] {
  return [lon * D2R, lat * D2R];
}

/** Conformal cylindrical: y = ln tan(π/4 + φ/2), latitude clamped to ±85°. */
export function projectMercator(lon: number, lat: number): [number, number] {
  const φ = Math.max(-85, Math.min(85, lat)) * D2R;
  return [lon * D2R, Math.log(Math.tan(Math.PI / 4 + φ / 2))];
}

/** Equal-area pseudocylindrical: x = λ·cos φ, y = φ. */
export function projectSinusoidal(lon: number, lat: number): [number, number] {
  const φ = lat * D2R;
  return [lon * D2R * Math.cos(φ), φ];
}

/** Mollweide: 2θ + sin 2θ = π sin φ (Newton), x = (2√2/π)·λ·cos θ, y = √2 sin θ. */
export function projectMollweide(lon: number, lat: number): [number, number] {
  const φ = lat * D2R;
  const λ = lon * D2R;
  let θ = φ;
  const target = Math.PI * Math.sin(φ);
  for (let i = 0; i < 12; i += 1) {
    const f = 2 * θ + Math.sin(2 * θ) - target;
    if (Math.abs(f) < 1e-14) break; // converged; also covers the exact-pole case
    const fp = 2 + 2 * Math.cos(2 * θ);
    if (Math.abs(fp) < 1e-12) break; // Newton denominator degenerates only at the poles
    const step = f / fp;
    θ -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return [((2 * Math.SQRT2) / Math.PI) * λ * Math.cos(θ), Math.SQRT2 * Math.sin(θ)];
}

/** Cylindrical equal-area with standard parallel 45° (Gall–Peters). */
export function projectGallPeters(lon: number, lat: number): [number, number] {
  const φ = lat * D2R;
  return [lon * D2R * Math.SQRT1_2, Math.sin(φ) / Math.SQRT1_2];
}

/** Lambert azimuthal equal-area centred on (0°, 0°). */
export function projectLambertAzEq(lon: number, lat: number): [number, number] {
  const φ = lat * D2R;
  const λ = lon * D2R;
  const k = Math.sqrt(Math.max(2 / (1 + Math.cos(φ) * Math.cos(λ)), 1e-12));
  return [k * Math.cos(φ) * Math.sin(λ), k * Math.sin(φ)];
}

/** Orthographic (globe): far-hemisphere points map to null. */
export function projectOrthographic(lon: number, lat: number): [number, number] | null {
  const φ = lat * D2R;
  const λ = lon * D2R;
  if (Math.cos(φ) * Math.cos(λ) < -1e-9) return null;
  return [Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

/**
 * Generalized orthographic centred on (lat0, lon0) — the draggable globe.
 * At lat0 = 0 it degenerates to projectOrthographic shifted by lon0.
 * Far-hemisphere points map to null.
 */
export function projectOrthographicRot(lon: number, lat: number, lat0: number, lon0: number): [number, number] | null {
  const φ = lat * D2R;
  const λ = lon * D2R;
  const φ0 = lat0 * D2R;
  const λ0 = lon0 * D2R;
  const cosc = Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(λ - λ0);
  if (cosc < 0) return null; // beyond the visible horizon
  const x = Math.cos(φ) * Math.sin(λ - λ0);
  const y = Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(λ - λ0);
  return [x, y];
}

export function projectionFn(id: ProjId): ProjFn {
  switch (id) {
    case 'equirect':
      return projectEquirect;
    case 'mercator':
      return projectMercator;
    case 'sinusoidal':
      return projectSinusoidal;
    case 'mollweide':
      return projectMollweide;
    case 'gall-peters':
      return projectGallPeters;
    case 'lambert-az-eq':
      return projectLambertAzEq;
    case 'orthographic':
      return projectOrthographic;
  }
}

// ---- Tissot indicatrix sampling (exported for tests) -----------------------

type Vec3 = [number, number, number];

export function latLonToVec(lat: number, lon: number): Vec3 {
  const φ = lat * D2R;
  const λ = lon * D2R;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

export function vecToLatLon(v: Vec3): [number, number] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2] / n))) / D2R;
  const lon = Math.atan2(v[1], v[0]) / D2R;
  return [lat, lon];
}

/**
 * Sample `samples` points on the small circle of angular radius `epsDeg`
 * centred at (lat, lon) — the Tissot indicatrix footprint on the sphere.
 * Points are returned as (lon, lat) — the same order every other dataset
 * (GeoJSON rings, graticule) uses, so they all flow through traceLine.
 */
export function tissotCircle(lat: number, lon: number, epsDeg: number, samples = 24): Array<[number, number]> {
  const c = latLonToVec(lat, lon);
  const sinφ = Math.sin(lat * D2R);
  const cosφ = Math.cos(lat * D2R);
  const sinλ = Math.sin(lon * D2R);
  const cosλ = Math.cos(lon * D2R);
  const east: Vec3 = [-sinλ, cosλ, 0];
  const north: Vec3 = [-sinφ * cosλ, -sinφ * sinλ, cosφ];
  const eps = epsDeg * D2R;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < samples; i += 1) {
    const t = (i / samples) * 2 * Math.PI;
    const w = Math.cos(eps);
    const r = Math.sin(eps);
    const p: Vec3 = [
      w * c[0] + r * (Math.cos(t) * east[0] + Math.sin(t) * north[0]),
      w * c[1] + r * (Math.cos(t) * east[1] + Math.sin(t) * north[1]),
      w * c[2] + r * (Math.cos(t) * east[2] + Math.sin(t) * north[2]),
    ];
    const ll = vecToLatLon(p);
    out.push([ll[1], ll[0]]); // (lon, lat)
  }
  return out;
}

// ---- GeoJSON coastline -----------------------------------------------------

interface Ring {
  pts: Array<[number, number]>; // [lon, lat]
}

function extractRings(geo: unknown): Ring[] {
  const rings: Ring[] = [];
  const walk = (geom: { type?: string; coordinates?: unknown; geometries?: unknown }) => {
    if (!geom || typeof geom !== 'object') return;
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
      for (const ring of geom.coordinates as number[][][]) {
        rings.push({ pts: ring.map((p) => [p[0]!, p[1]!] as [number, number]) });
      }
    } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      for (const poly of geom.coordinates as number[][][][]) {
        for (const ring of poly) {
          rings.push({ pts: ring.map((p) => [p[0]!, p[1]!] as [number, number]) });
        }
      }
    } else if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
      for (const g of geom.geometries) walk(g as typeof geom);
    }
  };
  const root = geo as { type?: string; geometry?: unknown; features?: Array<{ geometry?: unknown }> };
  if (root?.type === 'FeatureCollection' && Array.isArray(root.features)) {
    for (const f of root.features) walk(f?.geometry as { type?: string; coordinates?: unknown });
  } else if (root?.type === 'Feature') {
    walk(root.geometry as { type?: string; coordinates?: unknown });
  } else {
    walk(root);
  }
  return rings;
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  proj: ProjId;
  spacing: number;
  circleSize: number;
  showCoast: boolean;
  /** View centre of the draggable globe (orthographic only). */
  globeLat: number;
  globeLon: number;
  rings: Ring[];
}

const PROJ_NAMES: Record<ProjId, { zh: string; en: string }> = {
  equirect: { zh: '等距圆柱投影', en: 'Equirectangular' },
  mercator: { zh: '墨卡托投影', en: 'Mercator' },
  sinusoidal: { zh: '正弦投影（等积）', en: 'Sinusoidal (equal-area)' },
  mollweide: { zh: '摩尔威德投影（等积）', en: 'Mollweide (equal-area)' },
  'gall-peters': { zh: '高尔-彼得斯投影（等积）', en: 'Gall–Peters (equal-area)' },
  'lambert-az-eq': { zh: '方位等积投影', en: 'Lambert azimuthal equal-area' },
  orthographic: { zh: '正射投影（地球仪·拖拽转动）', en: 'Orthographic (globe · drag to spin)' },
};

export class TissotPlugin implements Plugin {
  readonly manifest = tissotManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = {
    proj: 'mollweide',
    spacing: 30,
    circleSize: 7,
    showCoast: true,
    globeLat: 30,
    globeLon: 105, // face Asia by default
    rings: extractRings(JSON.parse(WORLD_LAND_RAW) as unknown),
  };
  private boundCanvas: HTMLCanvasElement | null = null;
  private pointerHandlers: Array<[string, EventListener]> = [];
  private lastScale = 100; // px per radian, refreshed on each draw

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.detachGlobeDrag();
    this.ctx = null;
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
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'geo-tissot');
      return;
    }
    let redraw = false;
    const projIds = PROJECTIONS.map((p) => p.id);
    if (typeof params.proj === 'string' && projIds.includes(params.proj as ProjId)) {
      this.state.proj = params.proj as ProjId;
      redraw = true;
    }
    // select submits strings; accept both spellings
    const sp = Number(params.spacing);
    if (params.spacing !== undefined && (sp === 15 || sp === 30)) {
      this.state.spacing = sp;
      redraw = true;
    }
    if (typeof params.circleSize === 'number') {
      this.state.circleSize = Math.max(2, Math.min(12, params.circleSize));
      redraw = true;
    }
    if (typeof params.showCoast === 'boolean') {
      this.state.showCoast = params.showCoast;
      redraw = true;
    }
    if (redraw) this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'proj',
        label: 'Projection',
        labelI18n: { 'zh-CN': '投影', 'en-US': 'Projection' },
        type: 'select',
        value: this.state.proj,
        options: PROJECTIONS.map((p) => ({
          value: p.id,
          label: PROJ_NAMES[p.id]!.en,
          labelI18n: { 'zh-CN': PROJ_NAMES[p.id]!.zh, 'en-US': PROJ_NAMES[p.id]!.en },
        })),
      },
      {
        key: 'spacing',
        label: 'Circle spacing (°)',
        labelI18n: { 'zh-CN': '圆间距（°）', 'en-US': 'Circle spacing (°)' },
        type: 'select',
        value: String(this.state.spacing),
        options: [
          { value: '15', label: '15°', labelI18n: { 'zh-CN': '15°', 'en-US': '15°' } },
          { value: '30', label: '30°', labelI18n: { 'zh-CN': '30°', 'en-US': '30°' } },
        ],
      },
      {
        key: 'circleSize',
        label: 'Circle radius (°)',
        labelI18n: { 'zh-CN': '圆半径（°）', 'en-US': 'Circle radius (°)' },
        type: 'range',
        min: 2,
        max: 12,
        step: 0.5,
        value: this.state.circleSize,
      },
      {
        key: 'showCoast',
        label: 'Show coastlines',
        labelI18n: { 'zh-CN': '显示海岸线', 'en-US': 'Show coastlines' },
        type: 'checkbox',
        value: this.state.showCoast,
      },
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    try {
      const rings = extractRings(JSON.parse(await file.text()) as unknown);
      if (rings.length === 0) throw new Error('no rings');
      this.state.rings = rings;
      notify(this.api, 'success', `Loaded ${rings.length} rings`, `已加载 ${rings.length} 个环`);
      this.draw();
    } catch {
      notify(this.api, 'warning', 'Expected a GeoJSON Polygon/MultiPolygon', '需要 GeoJSON Polygon/MultiPolygon 数据');
    }
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

    const info = PROJECTIONS.find((p) => p.id === this.state.proj) ?? PROJECTIONS[3]!;
    const isGlobe = info.id === 'orthographic';
    const proj: ProjFn = isGlobe
      ? (lon, lat) => projectOrthographicRot(lon, lat, this.state.globeLat, this.state.globeLon)
      : projectionFn(info.id);
    const visible: ((lon: number, lat: number) => boolean) | undefined = isGlobe
      ? (lon, lat) => projectOrthographicRot(lon, lat, this.state.globeLat, this.state.globeLon) !== null
      : undefined;
    const { xmin, xmax, ymin, ymax } = info.bounds;
    const pad = 16;
    const scale = Math.min((canvas.width - 2 * pad) / (xmax - xmin), (canvas.height - 2 * pad - 26) / (ymax - ymin));
    this.lastScale = scale;
    const px = (x: number) => canvas.width / 2 + (x - (xmin + xmax) / 2) * scale;
    const py = (y: number) => canvas.height / 2 - 13 - (y - (ymin + ymax) / 2) * scale;

    this.attachGlobeDrag(canvas, isGlobe);

    // Graticule (thin): emit straight segments in projected space.
    g.strokeStyle = 'rgba(120, 135, 158, 0.18)';
    g.lineWidth = 1;
    g.beginPath();
    for (let lat = -80; lat <= 80; lat += 20) this.traceLine(g, proj, lonLatRange(-180, 180, 2, lat), px, py, visible);
    for (let lon = -180; lon <= 180; lon += 20) this.traceLine(g, proj, latLonRange(-90, 90, 2, lon), px, py, visible);
    g.stroke();

    // Coastlines.
    if (this.state.showCoast) {
      g.strokeStyle = 'rgba(150, 168, 190, 0.9)';
      g.lineWidth = 1;
      g.beginPath();
      for (const ring of this.state.rings) this.traceLine(g, proj, ring.pts, px, py, visible);
      g.stroke();
    }

    // Tissot circles: closed loops of sampled sphere points.
    g.strokeStyle = '#ff9e64';
    g.lineWidth = 1.3;
    g.beginPath();
    const spacing = this.state.spacing;
    for (let lat = -60; lat <= 60 + 1e-9; lat += spacing) {
      for (let lon = -180; lon <= 180 - spacing + 1e-9; lon += spacing) {
        const circle = tissotCircle(lat, lon, this.state.circleSize, 24);
        this.traceLine(g, proj, [...circle, circle[0]!], px, py, visible);
      }
    }
    g.stroke();

    // Header.
    g.textAlign = 'left';
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(235, 242, 250, 0.95)';
    const name = zh ? PROJ_NAMES[this.state.proj]!.zh : PROJ_NAMES[this.state.proj]!.en;
    g.fillText(
      zh
        ? `${name}　—　橙色为 Tissot 变形圆（每 ${spacing}°，半径 ${this.state.circleSize}°）`
        : `${name} — Tissot circles every ${spacing}° (radius ${this.state.circleSize}°)`,
      14,
      20,
    );
    g.fillStyle = 'rgba(170, 182, 200, 0.9)';
    g.fillText(
      isGlobe
        ? zh
          ? `中心 (${Math.round(this.state.globeLat)}°, ${Math.round(this.state.globeLon)}°)　—　按住拖拽转动地球仪`
          : `Centre (${Math.round(this.state.globeLat)}°, ${Math.round(this.state.globeLon)}°) — drag to spin the globe`
        : zh
          ? '面积比 → 面积变形；扁率 → 角度变形。海岸线：Natural Earth 110m'
          : 'area ratio → areal distortion; flattening → angular distortion. Coastline: Natural Earth 110m',
      14,
      38,
    );
  }

  /** Bind pointer-drag globe rotation once per canvas; no-op for flat maps. */
  private attachGlobeDrag(canvas: HTMLCanvasElement, isGlobe: boolean) {
    if (!isGlobe) {
      this.detachGlobeDrag();
      canvas.style.cursor = 'default';
      return;
    }
    if (this.boundCanvas === canvas) return;
    this.detachGlobeDrag();

    let dragging = false;
    let sx = 0;
    let sy = 0;
    let slon = 0;
    let slat = 0;

    const down = (e: Event) => {
      const pe = e as PointerEvent;
      if (this.state.proj !== 'orthographic') return;
      dragging = true;
      sx = pe.clientX;
      sy = pe.clientY;
      slon = this.state.globeLon;
      slat = this.state.globeLat;
      try {
        canvas.setPointerCapture(pe.pointerId);
      } catch {
        /* pointer capture is best-effort */
      }
      canvas.style.cursor = 'grabbing';
    };
    const move = (e: Event) => {
      if (!dragging || this.state.proj !== 'orthographic') return;
      const pe = e as PointerEvent;
      // Grab-the-surface mapping: drag right → the globe spins east, so the
      // view centre moves west; drag down → the centre tilts north.
      const cos0 = Math.max(0.25, Math.cos(this.state.globeLat * (Math.PI / 180)));
      const dLon = (pe.clientX - sx) / (this.lastScale * cos0);
      const dLat = (pe.clientY - sy) / this.lastScale;
      this.state.globeLon = slon - dLon;
      this.state.globeLat = Math.max(-85, Math.min(85, slat + dLat));
      this.draw();
    };
    const up = (e: Event) => {
      if (!dragging) return;
      dragging = false;
      const pe = e as PointerEvent;
      try {
        canvas.releasePointerCapture(pe.pointerId);
      } catch {
        /* best-effort */
      }
      canvas.style.cursor = 'grab';
    };

    canvas.style.cursor = 'grab';
    this.pointerHandlers = [
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointercancel', up],
    ];
    for (const [type, fn] of this.pointerHandlers) canvas.addEventListener(type, fn);
    this.boundCanvas = canvas;
  }

  private detachGlobeDrag() {
    if (this.boundCanvas) {
      for (const [type, fn] of this.pointerHandlers) this.boundCanvas.removeEventListener(type, fn);
    }
    this.boundCanvas = null;
    this.pointerHandlers = [];
  }

  /**
   * Trace a polyline of (lon, lat) points through the projection, skipping
   * nulls. `visible` (globe mode only) also breaks the pen when a segment's
   * midpoint hides behind the horizon, so coastlines clip at the limb
   * instead of drawing chords across the far side.
   */
  private traceLine(
    g: CanvasRenderingContext2D,
    proj: ProjFn,
    pts: Array<[number, number]>,
    px: (x: number) => number,
    py: (y: number) => number,
    visible?: (lon: number, lat: number) => boolean,
  ) {
    let pen = false;
    let prev: [number, number] | null = null;
    for (const ll of pts) {
      const p = proj(ll[0], ll[1]);
      if (!p) {
        pen = false;
        prev = null;
        continue;
      }
      const midHidden = visible !== undefined && prev !== null && !visible((ll[0]! + prev[0]!) / 2, (ll[1]! + prev[1]!) / 2);
      const x = px(p[0]);
      const y = py(p[1]);
      if (pen && !midHidden) g.lineTo(x, y);
      else {
        g.moveTo(x, y);
        pen = true;
      }
      prev = ll;
    }
  }
}

function lonLatRange(lon0: number, lon1: number, step: number, lat: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let lon = lon0; lon <= lon1 + 1e-9; lon += step) out.push([lon, lat]);
  return out;
}

function latLonRange(lat0: number, lat1: number, step: number, lon: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let lat = lat0; lat <= lat1 + 1e-9; lat += step) out.push([lon, lat]);
  return out;
}

export default function createTissotPlugin(): Plugin {
  return new TissotPlugin();
}
