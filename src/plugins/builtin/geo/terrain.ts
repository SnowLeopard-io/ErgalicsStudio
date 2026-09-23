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
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { actionButton, exportCanvasPng, exportSnapshotPng, actionFired, notify } from '../shared/enhance';
import { heatmapColor } from '@/core/wgsl';
import { isZh, marchingSquares } from './geoCore';
import { terrainManifest } from './terrainManifest';
import { buildTerrainGroup, fitTerrainCamera } from './terrain3d';
import type { Group } from 'three';

export { terrainManifest } from './terrainManifest';

// ---- Parsing & terrain math (exported for tests) ---------------------------

export interface AscGrid {
  ncols: number;
  nrows: number;
  xllcorner: number;
  yllcorner: number;
  cellsize: number;
  nodata: number;
  /** Row-major elevations (metres); NoData replaced by NaN. */
  values: Float64Array;
}

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

// ---- Plugin ----------------------------------------------------------------

type TerrainMode = 'elevation' | 'hillshade' | 'slope' | 'aspect' | '3d';

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

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.teardown3d();
    this.ctx = null;
    this.state.grid = null;
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
    let redraw = false;
    if (
      params.mode === 'elevation' ||
      params.mode === 'hillshade' ||
      params.mode === 'slope' ||
      params.mode === 'aspect' ||
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
    this.draw();
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
      const t = (v - vmin) / (vmax - vmin);
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
    if (this.state.showContours && this.state.mode !== 'aspect') {
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
      '3d': { zh: '3D 建模视图', en: '3D Mesh View' },
    };
    const rangeLabel =
      this.state.mode === 'elevation'
        ? `${fmtM(vmin)}–${fmtM(vmax)} m`
        : this.state.mode === 'slope'
          ? `0–${fmtM(vmax)}°`
          : this.state.mode === 'aspect'
            ? '0–360°'
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
        const t = i / 10;
        let rgb: [number, number, number];
        if (this.state.mode === 'hillshade') {
          const s = 0.12 + 0.8 * t;
          rgb = [s, s, s];
        } else {
          rgb = heatmapColor(t);
        }
        grad.addColorStop(t, `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`);
      }
      g.fillStyle = grad;
      g.fillRect(14, canvas.height - 24, 140, 10);
      g.fillStyle = 'rgba(220, 228, 240, 0.95)';
      g.fillText(this.state.mode === 'elevation' ? fmtM(vmin) : '0', 14, canvas.height - 28);
      g.textAlign = 'right';
      g.fillText(this.state.mode === 'elevation' ? fmtM(vmax) : this.state.mode === 'slope' ? `${vmax.toFixed(0)}°` : '1', 154, canvas.height - 28);
      g.textAlign = 'left';
    }
  }

  /** Raster for the active mode (elevation reused directly). */
  private buildRaster(): Float64Array {
    const grid = this.state.grid!;
    if (this.state.mode === 'elevation') return grid.values;
    const { slope, aspect } = hornSlopeAspect(grid.values, grid.ncols, grid.nrows, grid.cellsize);
    if (this.state.mode === 'slope') return slope;
    if (this.state.mode === 'aspect') return aspect;
    return hillshadeFromSlope(slope, aspect);
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

  /** Hide + free the 3D surface (2D view switch, deactivate, destroy). */
  private teardown3d() {
    if (this.state.mode !== '3d') this.disposeGroup();
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
