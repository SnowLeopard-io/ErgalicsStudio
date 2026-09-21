// ==========================================================================
// Example plugin: 3-D Surface Plot (spec FR-15 — 3D visualization)
//
// Height-field surface z = f(x, y) rendered in the host Three.js scene.
// Data comes from a project file (JSON 2-D grid or whitespace/comma number
// rows). The scene stays blank until a file is loaded; the built-in parameter
// functions that used to render a default surface now ship as downloadable
// example data instead (see core/examples.ts). Mesh generation is delegated
// to the pure pipeline in `core/mesh3d` (unit-tested); this file only wires
// geometry into the host-managed Scene3DHandle lifecycle.
// ==========================================================================

import * as THREE from 'three';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  Scene3DHandle,
} from '@/types/plugin';
import { heightFieldToMesh } from '@/core/mesh3d';
import { scalarRampColors } from '@/core/pointcloud-gpu';
import { viz3dZh, viz3dEn } from '@/i18n/dicts/viz3d';
import { actionButton, actionFired, exportRowsCsv, exportSnapshotPng } from './shared/enhance';

export { surface3DManifest } from './surface3DManifest';
import { surface3DManifest } from './surface3DManifest';

export type SurfaceFunction = 'sine' | 'gaussian' | 'saddle' | 'ripple' | 'paraboloid';

/** Max grid resolution from a file (64×64 vertices is plenty for a plot). */
const MAX_GRID_SIDE = 256;

/** Evaluate the built-in parameter functions on a normalized [-1, 1] domain. */
export function surfaceFunctionValue(fn: SurfaceFunction, xn: number, yn: number): number {
  switch (fn) {
    case 'sine':
      return Math.sin(xn * Math.PI * 2) * Math.cos(yn * Math.PI * 2);
    case 'gaussian':
      return Math.exp(-(xn * xn + yn * yn) * 3);
    case 'saddle':
      return xn * xn - yn * yn;
    case 'ripple': {
      const r = Math.sqrt(xn * xn + yn * yn);
      return Math.cos(r * Math.PI * 6) * Math.exp(-r * 1.5);
    }
    case 'paraboloid':
      return (xn * xn + yn * yn) * 2 - 1;
  }
}

/** Sample a parameter function into a rows × cols height grid (pure). */
export function sampleSurfaceFunction(
  fn: SurfaceFunction,
  resolution: number,
  extent = 1.5,
): number[][] {
  const n = Math.max(2, Math.min(MAX_GRID_SIDE, Math.floor(resolution)));
  const grid: number[][] = [];
  for (let r = 0; r < n; r += 1) {
    const yn = (r / (n - 1)) * 2 - 1;
    const row: number[] = [];
    for (let c = 0; c < n; c += 1) {
      const xn = (c / (n - 1)) * 2 - 1;
      row.push(surfaceFunctionValue(fn, xn, yn) * extent);
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Parse a height grid from text: a JSON 2-D array (or `{values}`/`{grid}`
 * wrapper), or whitespace/comma separated numeric rows. Non-numeric tokens
 * (headers) drop the row. Ragged input is padded to the widest row with NaN
 * (the mesh builder treats NaN as height 0). Oversized grids are clamped.
 */
export function parseHeightGrid(text: string): number[][] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
    const raw = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? ((parsed as { values?: unknown }).values ?? (parsed as { grid?: unknown }).grid)
        : null;
    if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
      return clampGrid(
        (raw as unknown[]).slice(0, MAX_GRID_SIDE).map((row) =>
          (row as unknown[]).slice(0, MAX_GRID_SIDE).map((v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : Number.NaN;
          }),
        ),
      );
    }
  }
  const rows: number[][] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length === 0) continue;
    const nums = parts.map((p) => parseFloat(p));
    if (nums.some((n) => !Number.isFinite(n))) continue;
    rows.push(nums);
    if (rows.length >= MAX_GRID_SIDE) break;
  }
  return clampGrid(rows);
}

function clampGrid(rows: number[][]): number[][] {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => {
    const row = r.slice(0, MAX_GRID_SIDE);
    while (row.length < width) row.push(Number.NaN);
    return row;
  });
}

interface State {
  heightScale: number;
  wireframe: boolean;
  hasFileData: boolean;
  fileGrid: number[][] | null;
}

export class Surface3DPlugin implements Plugin {
  readonly manifest = surface3DManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private mesh: THREE.Mesh | null = null;
  private state: State = {
    heightScale: 1,
    wireframe: false,
    hasFileData: false,
    fileGrid: null,
  };

  async init(api: PluginApi) {
    this.api = api;
  }

  /** Translate a `viz3d.*` key: the host catalog once modules.ts merges the
   *  dictionary, otherwise the module dictionary itself (same bilingual keys). */
  private translate(key: string, params?: Record<string, string | number>): string {
    let text = this.api.t(key);
    if (text === key) {
      text = (this.api.locale === 'zh-CN' ? viz3dZh : viz3dEn)[key] ?? key;
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
    }
    return text;
  }

  async destroy() {
    this.clearMesh();
    this.ctx = null;
    this.three = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.clearMesh();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    // The host mounts `three` only for plugins declaring renderToScene.
    if (container.three) this.three = container.three;
    this.draw();
  }

  /** Explicit entry point used by the host's scene API. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.heightScale === 'number' && params.heightScale !== this.state.heightScale) {
      this.state.heightScale = params.heightScale;
      this.rebuildMesh();
    }
    if (typeof params.wireframe === 'boolean' && params.wireframe !== this.state.wireframe) {
      this.state.wireframe = params.wireframe;
      this.rebuildMesh();
    }
    if (actionFired(params, 'fitView')) {
      this.fitCamera();
      return;
    }
    if (actionFired(params, 'exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot() ?? null, 'surface3d');
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'heightScale', label: 'Height Scale', type: 'range', min: 0.1, max: 5, step: 0.1, value: this.state.heightScale },
      {
        key: 'wireframe',
        label: 'Wireframe',
        type: 'checkbox',
        value: this.state.wireframe,
      },
      actionButton('fitView', 'Auto-fit View', '自动适配视角'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportCsv', 'Export Mesh CSV', '导出网格 CSV'),
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const grid = parseHeightGrid(text);
    if (grid.length < 2 || (grid[0]?.length ?? 0) < 2) {
      this.state.hasFileData = false;
      this.state.fileGrid = null;
      this.api.notify('warning', this.translate('viz3d.surface.parse_failed', { name: file.name }));
      this.rebuildMesh();
      this.draw();
      return;
    }
    this.state.fileGrid = grid;
    this.state.hasFileData = true;
    const verts = grid.length * (grid[0]?.length ?? 0);
    this.api.reportDataScale(verts);
    this.api.notify(
      'success',
      this.translate('viz3d.surface.loaded', { rows: grid.length, cols: grid[0]?.length ?? 0, verts }),
    );
    this.rebuildMesh();
    this.fitCamera();
    this.draw();
  }

  /** The grid currently rendered: loaded file data only; null = blank scene. */
  private currentGrid(): number[][] | null {
    if (this.state.hasFileData && this.state.fileGrid) return this.state.fileGrid;
    return null;
  }

  /** Export the height grid (x, y, z) as CSV — the data, not the GPU buffers. */
  private exportCsv() {
    const grid = this.currentGrid();
    if (!grid) {
      this.api.notify('warning', this.translate('viz3d.surface.no_data'));
      return;
    }
    const rows: number[][] = [];
    for (let r = 0; r < grid.length; r += 1) {
      const row = grid[r]!;
      for (let c = 0; c < row.length; c += 1) {
        const v = row[c]!;
        rows.push([c, r, Number.isFinite(v) ? v : 0]);
      }
    }
    exportRowsCsv(this.api, 'surface3d', ['x', 'y', 'z'], rows);
  }

  private clearMesh() {
    if (!this.mesh) return;
    this.three?.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
    this.mesh = null;
  }

  private rebuildMesh() {
    if (!this.three) return;
    this.clearMesh();
    const grid = this.currentGrid();
    if (!grid) return;
    const meshData = heightFieldToMesh(grid, {
      cellSize: 24 / Math.max(1, grid.length - 1),
      heightScale: this.state.heightScale,
    });
    if (!meshData) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.meshColors(meshData.values), 3));
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.05,
      roughness: 0.85,
      wireframe: this.state.wireframe,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.three.scene.add(this.mesh);
    this.three.render();
  }

  /** Height ramp shared with the point-cloud paths (teal → cyan → amber). */
  private meshColors(values: Float32Array): Float32Array {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return scalarRampColors(values, min, max);
  }

  /** Move the host camera so the surface fills the view. */
  private fitCamera() {
    if (!this.three) return;
    if (!this.mesh) {
      this.three.render();
      return;
    }
    this.mesh.geometry.computeBoundingBox();
    const box = this.mesh.geometry.boundingBox;
    if (!box) return;
    const { camera, controls } = this.three;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1e-3);
    controls.target.copy(center);
    const dist = radius * 2.6 + 1;
    camera.position.set(center.x + dist * 0.75, center.y + dist * 0.55, center.z + dist);
    camera.near = Math.max(radius / 100, 1e-4);
    camera.far = Math.max(radius * 200, 100);
    camera.updateProjectionMatrix();
    controls.update();
    this.three.render();
  }

  private draw() {
    if (this.three) {
      if (this.state.hasFileData && !this.mesh) this.rebuildMesh();
      this.three.render();
      return;
    }
    // Fallback: no three container — draw an informative 2D hint.
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg = this.state.hasFileData
      ? this.translate('viz3d.no_container')
      : this.translate('viz3d.surface.no_data');
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

export default function createSurface3DPlugin(): Plugin {
  return new Surface3DPlugin();
}
