// ==========================================================================
// Example plugin: GeoJSON Map (choropleth)
//
// Renders GeoJSON (FeatureCollection / Feature / GeometryCollection) on the
// 2-D canvas: polygons/lines/points with a fill-and-outline style, optional
// choropleth coloring driven by a numeric feature property, and a Web
// Mercator or equirectangular projection auto-fitted to the data bbox.
//
// Purely local: no tile servers, no network — the geometry comes from the
// user's file (or the bundled sample), keeping the offline workstation
// contract. This is the studio's first geography plugin.
// ==========================================================================

import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
} from '@/types/plugin';
import { heatmapColor } from '@/core/wgsl';

export const geoMapManifest: PluginManifest = {
  id: 'example.geomap',
  name: 'GeoJSON Map',
  nameI18n: { 'zh-CN': 'GeoJSON 地图', 'en-US': 'GeoJSON Map' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Local GeoJSON viewer with choropleth coloring.',
  descriptionI18n: {
    'zh-CN': '离线渲染 GeoJSON 矢量数据：多边形/线/点，支持按数值属性分级设色（choropleth）与墨卡托/等距圆柱投影。',
    'en-US': 'Offline GeoJSON rendering: polygons/lines/points with property-driven choropleth shading, Mercator or equirectangular projection.',
  },
  license: 'MIT',
  entry: 'example.geomap',
  category: 'scientific',
  icon: '⬡',
  formats: [
    { extension: '.geojson', mimeTypes: ['application/geo+json'], description: 'GeoJSON vector data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'GeoJSON vector data' },
  ],
};

// ---- GeoJSON parsing (exported for tests) --------------------------------

export interface GeoFeature {
  /** Ring coordinates in projected order: lon, lat (degrees). */
  polygons: number[][][]; // each ring: [ [lon,lat], ... ]
  lines: number[][][]; // each polyline: [ [lon,lat], ... ]
  points: number[][]; // each: [lon, lat]
  props: Record<string, unknown>;
}

function pushRing(target: number[][][], ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  const out: number[][] = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) return false;
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    out.push([lon, lat]);
  }
  target.push(out);
  return true;
}

function collectGeometry(geom: unknown, feature: GeoFeature): boolean {
  if (!geom || typeof geom !== 'object') return false;
  const g = geom as Record<string, unknown>;
  const type = typeof g.type === 'string' ? g.type : '';
  const coords = g.coordinates;
  switch (type) {
    case 'Polygon':
      if (!Array.isArray(coords)) return false;
      return (coords as unknown[]).every((ring) => pushRing(feature.polygons, ring));
    case 'MultiPolygon':
      if (!Array.isArray(coords)) return false;
      return (coords as unknown[]).every((poly) =>
        Array.isArray(poly) ? (poly as unknown[]).every((ring) => pushRing(feature.polygons, ring)) : false,
      );
    case 'LineString':
      if (!Array.isArray(coords)) return false;
      return pushLine(feature.lines, coords);
    case 'MultiLineString':
      if (!Array.isArray(coords)) return false;
      return (coords as unknown[]).every((line) => (Array.isArray(line) ? pushLine(feature.lines, line) : false));
    case 'Point':
      return pushPoint(feature.points, coords);
    case 'MultiPoint':
      if (!Array.isArray(coords)) return false;
      return (coords as unknown[]).every((pt) => pushPoint(feature.points, pt));
    case 'GeometryCollection': {
      const geoms = (g as Record<string, unknown>).geometries;
      if (!Array.isArray(geoms)) return false;
      return geoms.every((sub) => collectGeometry(sub, feature));
    }
    default:
      return false;
  }
}

function pushLine(target: number[][][], coords: unknown): boolean {
  if (!Array.isArray(coords) || coords.length < 2) return false;
  const line: number[][] = [];
  for (const pt of coords) {
    if (!Array.isArray(pt) || pt.length < 2) return false;
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    line.push([lon, lat]);
  }
  target.push(line);
  return true;
}

function pushPoint(target: number[][], coords: unknown): boolean {
  if (!Array.isArray(coords) || coords.length < 2) return false;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  target.push([lon, lat]);
  return true;
}

/**
 * Parse GeoJSON text into a flat feature list. Accepts a FeatureCollection,
 * a single Feature, or a bare geometry. Returns an empty array when nothing
 * usable is found — the caller reports the parse error.
 */
export function parseGeoJSON(text: string): GeoFeature[] {
  let root: unknown;
  try {
    root = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  const features: GeoFeature[] = [];
  const rootObj = root as Record<string, unknown> | null;
  if (!rootObj || typeof rootObj !== 'object') return [];

  let nodes: unknown[];
  if (rootObj.type === 'FeatureCollection' && Array.isArray(rootObj.features)) {
    nodes = rootObj.features;
  } else {
    nodes = [root];
  }

  for (const node of nodes.slice(0, 20000)) {
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    const feature: GeoFeature = { polygons: [], lines: [], points: [], props: {} };
    if (obj.type === 'Feature') {
      const props = obj.properties;
      if (props && typeof props === 'object' && !Array.isArray(props)) {
        for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
          if (v !== null && v !== undefined) feature.props[k] = v;
        }
      }
      if (!collectGeometry(obj.geometry, feature)) continue;
    } else if (!collectGeometry(node, feature)) {
      // Bare geometry or unknown node.
      continue;
    }
    if (feature.polygons.length || feature.lines.length || feature.points.length) {
      features.push(feature);
    }
  }
  return features;
}

/** Numeric property names across all features, in first-seen order. */
export function numericPropertyKeys(features: GeoFeature[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    for (const [k, v] of Object.entries(f.props)) {
      if (typeof v === 'number' && Number.isFinite(v) && !seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

/**
 * Pick a sensible default choropleth key: the first numeric key that is not
 * an administrative code (`adcode` codes color regions in bureaucratic
 * order, which reads as noise), or '' when only such keys exist.
 */
export function defaultChoroplethKey(keys: string[]): string {
  return keys.find((k) => k !== 'adcode' && k !== 'code' && k !== 'id') ?? '';
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  projection: 'albers' | 'mercator' | 'equirect';
  valueKey: string; // '' = outline only
  fillOpacity: number;
  showGraticule: boolean;
  hasData: boolean;
}

/**
 * Albers equal-area conic parameters tuned for China (the standard look of
 * Chinese thematic maps): standard parallels 25°/47°N, central meridian
 * 105°E, reference latitude 35°N. Computed per point, so no pre-projection
 * of the geometry is needed.
 */
const ALBERS_PHI1 = (25 * Math.PI) / 180;
const ALBERS_PHI2 = (47 * Math.PI) / 180;
const ALBERS_LAMBDA0 = (105 * Math.PI) / 180;
const ALBERS_PHI0 = (35 * Math.PI) / 180;
const ALBERS_N = (Math.sin(ALBERS_PHI1) + Math.sin(ALBERS_PHI2)) / 2;
const ALBERS_C = Math.cos(ALBERS_PHI1) ** 2 + 2 * ALBERS_N * Math.sin(ALBERS_PHI1);
const ALBERS_RHO0 = Math.sqrt(ALBERS_C - 2 * ALBERS_N * Math.sin(ALBERS_PHI0)) / ALBERS_N;

/** Albers equal-area conic projection → planar (x, y). */
function albersProject(lon: number, lat: number): [number, number] {
  const phi = (Math.max(-89.9, Math.min(89.9, lat)) * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const rho = Math.sqrt(ALBERS_C - 2 * ALBERS_N * Math.sin(phi)) / ALBERS_N;
  const theta = ALBERS_N * (lambda - ALBERS_LAMBDA0);
  return [rho * Math.sin(theta), ALBERS_RHO0 - rho * Math.cos(theta)];
}

const MAX_POINTS_PER_RING_DRAW = 4000;

export class GeoMapPlugin implements Plugin {
  readonly manifest = geoMapManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private features: GeoFeature[] = [];
  private keys: string[] = [];
  private min = 0;
  private max = 1;
  private state: State = {
    projection: 'albers',
    valueKey: '',
    fillOpacity: 0.8,
    showGraticule: true,
    hasData: false,
  };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.features = [];
    this.keys = [];
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
    let redraw = false;
    if (
      params.projection === 'albers' ||
      params.projection === 'mercator' ||
      params.projection === 'equirect'
    ) {
      if (params.projection !== this.state.projection) {
        this.state.projection = params.projection;
        redraw = true;
      }
    }
    if (typeof params.valueKey === 'string' && params.valueKey !== this.state.valueKey) {
      this.state.valueKey = params.valueKey;
      this.computeRange();
      redraw = true;
    }
    if (typeof params.fillOpacity === 'number') {
      this.state.fillOpacity = Math.max(0.05, Math.min(1, params.fillOpacity));
      redraw = true;
    }
    if (typeof params.showGraticule === 'boolean') {
      this.state.showGraticule = params.showGraticule;
      redraw = true;
    }
    if (redraw) this.draw();
  }

  getParams(): ParamDefinition[] {
    const valueKeyOptions = [
      {
        value: '',
        label: 'Outline only',
        labelI18n: { 'zh-CN': '仅边界', 'en-US': 'Outline only' },
      },
      ...this.keys.map((k) => ({ value: k, label: k })),
    ];
    return [
      {
        key: 'valueKey',
        label: 'Choropleth Property',
        labelI18n: { 'zh-CN': '设色属性', 'en-US': 'Choropleth Property' },
        type: 'select',
        value: this.state.valueKey,
        options: valueKeyOptions,
      },
      {
        key: 'projection',
        label: 'Projection',
        labelI18n: { 'zh-CN': '投影', 'en-US': 'Projection' },
        type: 'select',
        value: this.state.projection,
        options: [
          { value: 'albers', label: 'Albers (China)', labelI18n: { 'zh-CN': 'Albers 圆锥（中国）', 'en-US': 'Albers (China)' } },
          { value: 'mercator', label: 'Web Mercator', labelI18n: { 'zh-CN': 'Web 墨卡托', 'en-US': 'Web Mercator' } },
          { value: 'equirect', label: 'Equirectangular', labelI18n: { 'zh-CN': '等距圆柱', 'en-US': 'Equirectangular' } },
        ],
      },
      {
        key: 'fillOpacity',
        label: 'Fill Opacity',
        labelI18n: { 'zh-CN': '填充不透明度', 'en-US': 'Fill Opacity' },
        type: 'range',
        min: 0.05,
        max: 1,
        step: 0.05,
        value: this.state.fillOpacity,
      },
      {
        key: 'showGraticule',
        label: 'Graticule',
        labelI18n: { 'zh-CN': '经纬网格', 'en-US': 'Graticule' },
        type: 'checkbox',
        value: this.state.showGraticule,
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const features = parseGeoJSON(text);
    if (features.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '未找到有效的 GeoJSON 几何（支持 FeatureCollection / Feature / Geometry）'
          : 'No valid GeoJSON geometry found (FeatureCollection / Feature / geometry)',
      );
      return;
    }
    this.features = features;
    this.keys = numericPropertyKeys(features);
    // Auto-select a meaningful numeric property (skipping adcode-style
    // administrative codes) so a choropleth file lights up immediately;
    // plain geometry files stay in outline mode.
    this.state.valueKey = defaultChoroplethKey(this.keys);
    this.computeRange();
    this.state.hasData = true;
    this.api.reportDataScale(this.features.length);
    this.draw();
  }

  private computeRange() {
    this.min = Infinity;
    this.max = -Infinity;
    if (!this.state.valueKey) return;
    for (const f of this.features) {
      const v = f.props[this.state.valueKey];
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (v < this.min) this.min = v;
        if (v > this.max) this.max = v;
      }
    }
    if (this.min === Infinity) {
      this.min = 0;
      this.max = 1;
    }
  }

  /** Web-Mercator y for latitude (clamped to ±85.05° like standard tiles). */
  private static projY(lat: number): number {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = (clamped * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (!this.state.hasData || this.features.length === 0) {
      this.drawEmpty(g, canvas);
      return;
    }

    const useMercator = this.state.projection === 'mercator';
    const useAlbers = this.state.projection === 'albers';
    // Data bbox in projected units.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const proj = (lon: number, lat: number): [number, number] => {
      if (useAlbers) return albersProject(lon, lat);
      return useMercator ? [lon, GeoMapPlugin.projY(lat)] : [lon, lat];
    };
    for (const f of this.features) {
      for (const ring of f.polygons) {
        for (const pt of ring) {
          const [x, y] = proj(pt[0]!, pt[1]!);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      for (const line of f.lines) {
        for (const pt of line) {
          const [x, y] = proj(pt[0]!, pt[1]!);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      for (const pt of f.points) {
        const [x, y] = proj(pt[0]!, pt[1]!);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX)) return;
    const w = canvas.width;
    const h = canvas.height;
    const pad = 24;
    // Preserve aspect ratio of the projected bbox.
    const bw = Math.max(maxX - minX, 1e-9);
    const bh = Math.max(maxY - minY, 1e-9);
    const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
    const ox = (w - bw * scale) / 2;
    const oy = (h + bh * scale) / 2; // projected y grows upward
    const toScreen = (lon: number, lat: number): [number, number] => {
      const [x, y] = proj(lon, lat);
      return [ox + (x - minX) * scale, oy - (y - minY) * scale];
    };

    if (this.state.showGraticule) this.drawGraticule(g, toScreen);

    const span = Math.max(this.max - this.min, 1e-9);
    const coloring = this.state.valueKey !== '';

    // Polygons (choropleth fill + outline).
    for (const f of this.features) {
      if (f.polygons.length === 0) continue;
      g.beginPath();
      for (const ring of f.polygons) {
        // Downsample pathological rings rather than stalling the frame.
        const stepN = Math.max(1, Math.ceil(ring.length / MAX_POINTS_PER_RING_DRAW));
        for (let i = 0; i < ring.length; i += stepN) {
          const [sx, sy] = toScreen(ring[i]![0]!, ring[i]![1]!);
          if (i === 0) g.moveTo(sx, sy);
          else g.lineTo(sx, sy);
        }
        g.closePath();
      }
      if (coloring) {
        const v = f.props[this.state.valueKey];
        if (typeof v === 'number' && Number.isFinite(v)) {
          const t = (v - this.min) / span;
          const [r, gg, b] = heatmapColor(t);
          g.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(gg * 255)}, ${Math.round(b * 255)}, ${this.state.fillOpacity})`;
          g.fill();
        }
      }
      g.strokeStyle = 'rgba(220, 228, 240, 0.75)';
      g.lineWidth = 1;
      g.stroke();
    }

    // Lines.
    g.strokeStyle = 'rgba(120, 200, 255, 0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (const f of this.features) {
      for (const line of f.lines) {
        const stepN = Math.max(1, Math.ceil(line.length / MAX_POINTS_PER_RING_DRAW));
        for (let i = 0; i < line.length; i += stepN) {
          const [sx, sy] = toScreen(line[i]![0]!, line[i]![1]!);
          if (i === 0) g.moveTo(sx, sy);
          else g.lineTo(sx, sy);
        }
      }
    }
    g.stroke();

    // Points.
    g.fillStyle = 'rgba(255, 200, 90, 0.9)';
    for (const f of this.features) {
      for (const pt of f.points) {
        const [sx, sy] = toScreen(pt[0]!, pt[1]!);
        g.beginPath();
        g.arc(sx, sy, 3, 0, Math.PI * 2);
        g.fill();
      }
    }

    this.drawLegend(g, canvas, coloring);
  }

  private drawGraticule(
    g: CanvasRenderingContext2D,
    toScreen: (lon: number, lat: number) => [number, number],
  ) {
    g.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    g.lineWidth = 1;
    g.beginPath();
    for (let lon = -180; lon <= 180; lon += 15) {
      for (let lat = -80; lat <= 80; lat += 4) {
        const [sx, sy] = toScreen(lon, lat);
        const [sx2, sy2] = toScreen(lon, lat + 4);
        g.moveTo(sx, sy);
        g.lineTo(sx2, sy2);
      }
    }
    for (let lat = -80; lat <= 80; lat += 20) {
      for (let lon = -180; lon < 180; lon += 4) {
        const [sx, sy] = toScreen(lon, lat);
        const [sx2, sy2] = toScreen(lon + 4, lat);
        g.moveTo(sx, sy);
        g.lineTo(sx2, sy2);
      }
    }
    g.stroke();
  }

  private drawLegend(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, coloring: boolean) {
    const zh = this.api.locale === 'zh-CN';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    if (coloring) {
      const swatches = 8;
      const sw = 18;
      const x0 = 12;
      const y0 = canvas.height - 24;
      for (let i = 0; i < swatches; i += 1) {
        const t = i / (swatches - 1);
        const [r, gg, b] = heatmapColor(t);
        g.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(gg * 255)}, ${Math.round(b * 255)}, ${this.state.fillOpacity})`;
        g.fillRect(x0 + i * sw, y0, sw - 2, 8);
      }
      g.fillStyle = 'rgba(200, 210, 225, 0.9)';
      g.fillText(`${this.state.valueKey}: ${formatNum(this.min)} — ${formatNum(this.max)}`, x0, y0 - 4);
    } else {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.fillText(
        zh
          ? `轮廓模式 — 选择一个数值属性开启分级设色（${this.features.length} 个要素）`
          : `Outline mode — pick a numeric property for choropleth (${this.features.length} features)`,
        12,
        canvas.height - 12,
      );
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载数据 — 拖入 .geojson 文件或打开「示例数据」'
        : 'No data — drop a .geojson file or load sample data';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

function formatNum(v: number): string {
  return Math.abs(v) >= 1000 ? v.toFixed(0) : v.toPrecision(3);
}

export default function createGeoMapPlugin(): Plugin {
  return new GeoMapPlugin();
}
