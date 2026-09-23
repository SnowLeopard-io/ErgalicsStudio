// ==========================================================================
// Example plugin: 3-D Voxel Renderer (spec FR-15 — 3D visualization)
//
// Renders a 3-D scalar field in the host Three.js scene, either as a blocky
// isosurface (face-extraction approximation of marching cubes — see
// `core/mesh3d`) or as translucent instanced cubes (one InstancedMesh, one
// draw call, no per-cube objects). Data comes from a project file: a JSON
// 3-D array or {nx, ny, nz, values}. Parsing and surface extraction are
// pure functions in this file / core/mesh3d (unit-tested); the plugin only
// wires results into the host-managed Scene3DHandle lifecycle.
// ==========================================================================

import * as THREE from 'three';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  Scene3DHandle,
} from '@/types/plugin';
import { voxelIsosurface, voxelSolidCells, type VoxelField } from '@/core/mesh3d';
import { rampColor, scalarRampColors } from '@/core/pointcloud-gpu';
import { viz3dZh, viz3dEn } from '@/i18n/dicts/viz3d';
import { actionButton, actionFired, exportRowsCsv, exportSnapshotPng } from './shared/enhance';

export { voxel3DManifest } from './voxel3DManifest';
import { voxel3DManifest } from './voxel3DManifest';

/** Hard cap on field cells so a pathological file cannot OOM the scene. */
const MAX_VOXEL_CELLS = 2_000_000;

/**
 * Parse a 3-D scalar field from text. Accepts a JSON 3-D array (nested
 * x → y → z) or a {nx, ny, nz, values} wrapper (values flat, z fastest).
 * Ragged arrays are padded with 0; non-finite cells become 0. Returns null
 * when nothing parses as a field.
 */
export function parseVoxelField(text: string): VoxelField | null {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = null;
  }
  if (!parsed) return null;

  const toNum = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  if (Array.isArray(parsed)) {
    const slab = parsed[0];
    if (!Array.isArray(slab) || !Array.isArray(slab[0])) return null;
    const nx = Math.min(parsed.length, 256);
    const ny = Math.min((parsed[0] as unknown[]).length, 256);
    const nz = Math.min(((parsed[0] as unknown[])[0] as unknown[]).length, 256);
    if (nx * ny * nz > MAX_VOXEL_CELLS) return null;
    const values = new Float32Array(nx * ny * nz);
    for (let x = 0; x < nx; x += 1) {
      const plane = parsed[x] as unknown[] | undefined;
      for (let y = 0; y < ny; y += 1) {
        const row = (plane?.[y] ?? []) as unknown[];
        for (let z = 0; z < nz; z += 1) {
          values[(x * ny + y) * nz + z] = toNum(row[z]);
        }
      }
    }
    return { nx, ny, nz, values };
  }

  if (typeof parsed === 'object') {
    const o = parsed as { nx?: unknown; ny?: unknown; nz?: unknown; values?: unknown; data?: unknown };
    const nx = Number(o.nx);
    const ny = Number(o.ny);
    const nz = Number(o.nz);
    const flat = Array.isArray(o.values) ? o.values : Array.isArray(o.data) ? o.data : null;
    if (!Number.isInteger(nx) || !Number.isInteger(ny) || !Number.isInteger(nz)) return null;
    if (!flat || nx <= 0 || ny <= 0 || nz <= 0) return null;
    if (nx * ny * nz > MAX_VOXEL_CELLS || flat.length < nx * ny * nz) return null;
    const values = new Float32Array(nx * ny * nz);
    for (let i = 0; i < values.length; i += 1) values[i] = toNum(flat[i]);
    return { nx, ny, nz, values };
  }
  return null;
}

/** Field min/max (for the level slider mapping). */
export function fieldRange(field: VoxelField): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of field.values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return { min, max };
}

interface State {
  mode: 'isosurface' | 'voxels';
  /** Normalized threshold in [0, 1] mapped onto the field range. */
  levelT: number;
  opacity: number;
  hasData: boolean;
}

export class Voxel3DPlugin implements Plugin {
  readonly manifest = voxel3DManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private field: VoxelField | null = null;
  private range: { min: number; max: number } = { min: 0, max: 1 };
  private object: THREE.Mesh | THREE.InstancedMesh | null = null;
  private state: State = { mode: 'isosurface', levelT: 0.5, opacity: 0.45, hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  /** Translate a `viz3d.*` key with the module dictionary as fallback while
   *  the host catalog has not merged it yet (see modules.ts integration). */
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
    this.field = null;
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
    if (params.mode === 'isosurface' || params.mode === 'voxels') {
      if (params.mode !== this.state.mode) {
        this.state.mode = params.mode;
        this.rebuildMesh();
      }
    }
    if (typeof params.level === 'number' && params.level !== this.state.levelT) {
      this.state.levelT = Math.min(1, Math.max(0, params.level));
      this.rebuildMesh();
    }
    if (typeof params.opacity === 'number' && params.opacity !== this.state.opacity) {
      this.state.opacity = Math.min(1, Math.max(0.05, params.opacity));
      this.rebuildMesh();
    }
    if (actionFired(params, 'fitView')) {
      this.fitCamera();
      return;
    }
    if (actionFired(params, 'exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot() ?? null, 'voxel3d');
      return;
    }
    if (actionFired(params, 'exportObjPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot({ transparent: true }) ?? null, 'voxel3d');
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
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'isosurface', label: 'Isosurface', labelI18n: { 'zh-CN': '等值面', 'en-US': 'Isosurface' } },
          { value: 'voxels', label: 'Translucent voxels', labelI18n: { 'zh-CN': '半透明体素', 'en-US': 'Translucent voxels' } },
        ],
        value: this.state.mode,
      },
      {
        key: 'level',
        label: 'Level',
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
        value: this.state.levelT,
      },
      {
        key: 'opacity',
        label: 'Opacity',
        type: 'range',
        min: 0.05,
        max: 1,
        step: 0.05,
        value: this.state.opacity,
      },
      actionButton('fitView', 'Auto-fit View', '自动适配视角'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportObjPng', 'Objects PNG (transparent)', '导出物品 PNG（透明）'),
      actionButton('exportCsv', 'Export Field CSV', '导出标量场 CSV'),
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const field = parseVoxelField(text);
    if (!field) {
      this.field = null;
      this.state.hasData = false;
      this.clearMesh();
      this.api.notify('warning', this.translate('viz3d.voxel.parse_failed', { name: file.name }));
      this.draw();
      return;
    }
    this.field = field;
    this.range = fieldRange(field);
    this.state.hasData = true;
    this.api.reportDataScale(field.nx * field.ny * field.nz);
    this.rebuildMesh();
    const tris = this.object instanceof THREE.Mesh ? (this.object.geometry.index?.count ?? 0) / 3 : 0;
    this.api.notify(
      'success',
      this.translate('viz3d.voxel.loaded', { nx: field.nx, ny: field.ny, nz: field.nz, tris }),
    );
    this.fitCamera();
    this.draw();
  }

  /** Absolute isosurface level from the normalized slider position. */
  private level(): number {
    return this.range.min + this.state.levelT * Math.max(this.range.max - this.range.min, 1e-9);
  }

  /** Export the scalar field as x, y, z, value rows (strided for big fields). */
  private exportCsv() {
    const field = this.field;
    if (!field) return;
    const rows: number[][] = [];
    const { nx, ny, nz, values } = field;
    const total = nx * ny * nz;
    const MAX_ROWS = 50_000;
    const stride = Math.max(1, Math.ceil(total / MAX_ROWS));
    let i = 0;
    for (let x = 0; x < nx; x += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let z = 0; z < nz; z += 1, i += 1) {
          if (i % stride !== 0) continue;
          rows.push([x, y, z, values[i] ?? 0]);
        }
      }
    }
    exportRowsCsv(this.api, 'voxel3d', ['x', 'y', 'z', 'value'], rows);
  }

  private clearMesh() {
    if (!this.object) return;
    this.three?.scene.remove(this.object);
    this.object.geometry.dispose();
    const material = this.object.material as THREE.Material;
    material.dispose();
    this.object = null;
  }

  private rebuildMesh() {
    if (!this.three) return;
    this.clearMesh();
    const field = this.field;
    if (!field) return;
    if (this.state.mode === 'isosurface') this.buildIsosurface(field);
    else this.buildVoxelInstances(field);
    this.three.render();
  }

  /** Blocky isosurface as one indexed Mesh (single draw call). */
  private buildIsosurface(field: VoxelField) {
    if (!this.three) return;
    const mesh = voxelIsosurface(field, this.level());
    if (mesh.indices.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(scalarRampColors(mesh.values, this.range.min, this.range.max), 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.05,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(geometry, material);
    this.centerObject(field, this.object);
    this.three.scene.add(this.object);
  }

  /** Translucent voxels as one InstancedMesh (unit cubes, one submission). */
  private buildVoxelInstances(field: VoxelField) {
    if (!this.three) return;
    const cells = voxelSolidCells(field, this.level());
    if (cells.length === 0) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: this.state.opacity,
      depthWrite: false,
      metalness: 0.05,
      roughness: 0.7,
    });
    const instanced = new THREE.InstancedMesh(geometry, material, cells.length);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const { ny, nz, values } = field;
    for (let i = 0; i < cells.length; i += 1) {
      const idx = cells[i]!;
      const x = Math.floor(idx / (ny * nz));
      const y = Math.floor(idx / nz) % ny;
      const z = idx % nz;
      matrix.setPosition(x, y, z);
      instanced.setMatrixAt(i, matrix);
      const v = values[idx] ?? 0;
      const t = (v - this.range.min) / Math.max(this.range.max - this.range.min, 1e-9);
      // Same teal → cyan → amber family as the shared height ramp.
      const [r, g, bl] = rampColor(t);
      color.setRGB(r, g, bl);
      instanced.setColorAt(i, color);
    }
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    this.object = instanced;
    this.centerObject(field, instanced);
    this.three.scene.add(instanced);
  }

  /** Shift the object so the field's center sits on the world origin. */
  private centerObject(field: VoxelField, object: THREE.Object3D) {
    object.position.set(-field.nx / 2, -field.ny / 2, -field.nz / 2);
  }

  /** Move the host camera so the loaded field fills the view. */
  private fitCamera() {
    if (!this.three) return;
    const field = this.field;
    if (!field || !this.object) {
      this.three.render();
      return;
    }
    const { camera, controls } = this.three;
    const maxSide = Math.max(field.nx, field.ny, field.nz);
    controls.target.set(0, 0, 0);
    const dist = maxSide * 1.8 + 2;
    camera.position.set(dist * 0.7, dist * 0.55, dist);
    camera.near = Math.max(maxSide / 100, 1e-3);
    camera.far = Math.max(maxSide * 200, 100);
    camera.updateProjectionMatrix();
    controls.update();
    this.three.render();
  }

  private draw() {
    if (this.three) {
      if (this.state.hasData && !this.object) this.rebuildMesh();
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
    const msg = this.state.hasData
      ? this.translate('viz3d.no_container')
      : this.translate('viz3d.voxel.no_data');
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

export default function createVoxel3DPlugin(): Plugin {
  return new Voxel3DPlugin();
}
