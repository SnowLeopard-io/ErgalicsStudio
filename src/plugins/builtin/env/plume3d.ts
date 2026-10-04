// ==========================================================================
// Example plugin: 3-D plume dispersion
//
// The Gaussian-plume kernel from envCore evaluated on a 3-D grid (x downwind,
// y crosswind, z vertical) and rendered as a translucent voxel cloud over a
// teaching terrain (the shared geo terrain mesh builder fed a synthetic
// DEM). Optional downwind cross-section (a vertex-coloured plane at y = 0)
// and a colour legend. OrbitControls come from the host Scene3DHandle.
//
// Dense-grid compute stays on the CPU at teaching-scale resolutions
// (capped at 48³ ≈ 110k cells) so the module works identically with or
// without a WebGPU device — the host `PluginApi.gpu` presence is reported to
// the log but never required.
// ==========================================================================

import * as THREE from 'three';
import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { plumeConcentration, rampColor3, type StabilityClass } from './envCore';
import { actionButton, actionFired, exportSnapshotPng, notify } from '../shared/enhance';
import { buildTerrainGroup } from '../geo/terrain3d';
import type { AscGrid } from '../geo/terrain';
import { plume3dManifest } from './plume3dManifest';

export { plume3dManifest } from './plume3dManifest';

const MAX_DIM = 48; // per-axis cap → 110k cells
const X_MAX = 10000; // m
const Y_MAX = 2000; // m
const Z_MAX = 600; // m

// ---- Voxel field computation (exported for tests) ---------------------------

export interface VoxelField3D {
  nx: number;
  ny: number;
  nz: number;
  c: Float64Array;
  cMax: number;
}

/** Gaussian plume sampled at cell centres (μq/s → μg/m³ with Q in μg/s). */
export function computePlumeField(q: number, u: number, cls: StabilityClass, stackH: number, dim: number): VoxelField3D {
  const nx = dim;
  const ny = Math.max(8, Math.round(dim / 2));
  const nz = Math.max(6, Math.round(dim / 3));
  const c = new Float64Array(nx * ny * nz);
  let cMax = 0;
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const x = ((i + 0.5) / nx) * X_MAX;
        const y = ((j + 0.5) / ny - 0.5) * 2 * Y_MAX;
        const z = ((k + 0.5) / nz) * Z_MAX;
        const v = plumeConcentration(q, u, cls, stackH, x, y, z);
        c[(k * ny + j) * nx + i] = v;
        if (v > cMax) cMax = v;
      }
    }
  }
  return { nx, ny, nz, c, cMax };
}

/** Optional `x,y,z,conc` override (any unit) — normalised onto a 24³ grid. */
export function parseConcCsv(text: string): VoxelField3D | null {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
  if (rows.length < 8) return null;
  const vals: Array<[number, number, number, number]> = [];
  for (const line of rows) {
    const cells = line.split(/[,;\t]+/).map((s) => s.trim());
    const nums = cells.map((s) => Number(s));
    if (nums.length < 4 || nums.slice(0, 4).some((n) => !Number.isFinite(n))) continue;
    if (nums[0]! < 0 || nums[1]! < 0 || nums[2]! < 0) continue;
    vals.push([nums[0]!, nums[1]!, nums[2]!, Math.max(0, nums[3]!)]);
  }
  if (vals.length < 8) return null;
  const maxX = Math.max(...vals.map((v) => v[0]), 1);
  const maxY = Math.max(...vals.map((v) => v[1]), 1);
  const maxZ = Math.max(...vals.map((v) => v[2]), 1);
  const nx = 24;
  const ny = 24;
  const nz = 24;
  const c = new Float64Array(nx * ny * nz);
  let cMax = 0;
  for (const [x, y, z, conc] of vals) {
    const i = Math.min(nx - 1, Math.floor((x / maxX) * nx));
    const j = Math.min(ny - 1, Math.floor((y / maxY) * ny));
    const k = Math.min(nz - 1, Math.floor((z / maxZ) * nz));
    const idx = (k * ny + j) * nx + i;
    const cur = c[idx] ?? 0;
    const v = cur + conc;
    c[idx] = v;
    if (v > cMax) cMax = v;
  }
  return { nx, ny, nz, c, cMax };
}

/** Gentle synthetic teaching DEM (sin hills), shared geometry with the geo terrain builder. */
function syntheticDem(n = 40): AscGrid {
  const values = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      values[y * n + x] =
        90 +
        55 * Math.sin((x / n) * Math.PI * 2 + 0.7) * Math.cos((y / n) * Math.PI * 1.5) +
        30 * Math.sin((x / n) * Math.PI * 5.3);
    }
  }
  return { ncols: n, nrows: n, xllcorner: 0, yllcorner: 0, cellsize: 10, nodata: -9999, values };
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  q: number;
  u: number;
  cls: StabilityClass;
  stackH: number;
  dim: number;
  showSection: boolean;
  thresholdT: number; // fraction of cMax below which voxels hide
  /** When set, the CSV field replaces the computed plume. */
  custom: VoxelField3D | null;
}

const DEFAULTS: State = { q: 100, u: 4, cls: 'C', stackH: 50, dim: 36, showSection: false, thresholdT: 0.02, custom: null };

export class Plume3DPlugin implements Plugin {
  readonly manifest = plume3dManifest;
  private api!: PluginApi;
  private three: Scene3DHandle | null = null;
  private group: THREE.Group | null = null;
  private state: State = { ...DEFAULTS };

  async init(api: PluginApi) {
    this.api = api;
    if (api.gpu) {
      api.log('info', `GPU compute surface: ${api.gpu.available ? api.gpu.backend : 'unavailable'} — teaching-scale fields stay on CPU`);
    }
  }

  async destroy() {
    this.clearGroup();
    this.three = null;
    this.state.custom = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    if (context.container.three) this.three = context.container.three;
    this.rebuild();
  }

  async deactivate() {
    this.clearGroup();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    if (container.three) this.three = container.three;
    this.rebuild();
  }

  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.rebuild();
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'q', label: 'Source strength Q (g/s)', labelI18n: { 'zh-CN': '源强 Q（g/s）', 'en-US': 'Source strength Q (g/s)' }, type: 'number', min: 1, max: 10000, step: 10, value: this.state.q },
      { key: 'u', label: 'Wind speed u (m/s)', labelI18n: { 'zh-CN': '平均风速 u（m/s）', 'en-US': 'Wind speed u (m/s)' }, type: 'range', min: 0.5, max: 12, step: 0.5, value: this.state.u },
      {
        key: 'cls',
        label: 'Stability class',
        labelI18n: { 'zh-CN': '稳定度等级', 'en-US': 'Stability class' },
        type: 'select',
        value: this.state.cls,
        options: (['A', 'B', 'C', 'D', 'E', 'F'] as StabilityClass[]).map((c) => ({ value: c, label: c, labelI18n: { 'zh-CN': c, 'en-US': c } })),
      },
      { key: 'stackH', label: 'Effective stack height H (m)', labelI18n: { 'zh-CN': '有效源高 H（m）', 'en-US': 'Effective stack height H (m)' }, type: 'number', min: 5, max: 300, step: 5, value: this.state.stackH },
      { key: 'dim', label: 'Grid resolution (x cells)', labelI18n: { 'zh-CN': '网格分辨率（x 向格点）', 'en-US': 'Grid resolution (x cells)' }, type: 'number', min: 16, max: MAX_DIM, step: 4, value: this.state.dim, hint: `≤ ${MAX_DIM}³` },
      { key: 'threshold', label: 'Isosurface threshold', labelI18n: { 'zh-CN': '等值面阈值', 'en-US': 'Isosurface threshold' }, type: 'range', min: 0.005, max: 0.3, step: 0.005, value: this.state.thresholdT },
      { key: 'showSection', label: 'Show downwind cross-section', labelI18n: { 'zh-CN': '显示横切面', 'en-US': 'Show downwind cross-section' }, type: 'checkbox', value: this.state.showSection },
      { key: 'reset', label: 'Reset to defaults', labelI18n: { 'zh-CN': '回到初始参数', 'en-US': 'Reset to defaults' }, type: 'button', action: 'reset' },
      actionButton('fitView', 'Fit view', '重置视角'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportPngTransparent', 'Snapshot PNG (transparent)', '快照 PNG（透明）'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot() ?? null, 'env-plume3d');
      return;
    }
    if (actionFired(params, 'exportPngTransparent')) {
      exportSnapshotPng(this.api, this.three?.snapshot({ transparent: true }) ?? null, 'env-plume3d');
      return;
    }
    if (actionFired(params, 'fitView')) {
      this.fitCamera();
      return;
    }
    if (actionFired(params, 'reloadPlugin')) {
      notify(this.api, 'info', 'Resetting plugin…', '正在重置插件…');
      void this.api.reload?.();
      return;
    }
    if (actionFired(params, 'reset')) {
      this.state = { ...DEFAULTS };
      this.rebuild();
      return;
    }
    let rebuild = false;
    if (typeof params.q === 'number' && params.q >= 1 && params.q !== this.state.q) {
      this.state.q = params.q;
      rebuild = true;
    }
    if (typeof params.u === 'number' && params.u > 0 && params.u !== this.state.u) {
      this.state.u = params.u;
      rebuild = true;
    }
    if (typeof params.cls === 'string' && /^[A-F]$/.test(params.cls) && params.cls !== this.state.cls) {
      this.state.cls = params.cls as StabilityClass;
      rebuild = true;
    }
    if (typeof params.stackH === 'number' && params.stackH >= 5 && params.stackH !== this.state.stackH) {
      this.state.stackH = params.stackH;
      rebuild = true;
    }
    if (typeof params.dim === 'number' && params.dim !== this.state.dim) {
      this.state.dim = Math.min(MAX_DIM, Math.max(16, Math.round(params.dim)));
      rebuild = true;
    }
    if (typeof params.threshold === 'number' && params.threshold !== this.state.thresholdT) {
      this.state.thresholdT = params.threshold;
      rebuild = true;
    }
    if (typeof params.showSection === 'boolean' && params.showSection !== this.state.showSection) {
      this.state.showSection = params.showSection;
      rebuild = true;
    }
    if (rebuild) this.rebuild();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const field = parseConcCsv(await file.text());
    if (!field) {
      notify(this.api, 'warning', 'Expected x,y,z,conc rows (≥8)', '需要 x,y,z,conc 数据行（≥8 行）');
      return;
    }
    this.state.custom = field;
    this.api.reportDataScale(field.nx * field.ny * field.nz);
    notify(this.api, 'success', 'External concentration field loaded', '外部浓度场已加载');
    this.rebuild();
  }

  // ---- scene ---------------------------------------------------------------

  private clearGroup() {
    if (!this.group) return;
    this.three?.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.group = null;
  }

  private fitCamera() {
    if (!this.three) return;
    this.three.camera.position.set(2.6, 1.7, 2.9);
    this.three.camera.lookAt(0, 0.15, 0);
    this.three.controls.update?.();
    this.three.render();
  }

  private rebuild() {
    const three = this.three;
    if (!three) return;
    this.clearGroup();
    const group = new THREE.Group();

    // Lights (leave with the group, mirroring the geo 3-D plugins).
    group.add(new THREE.AmbientLight(0x9fb4cc, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2.4, 3.2, 1.6);
    group.add(sun);

    // Teaching terrain as the ground plane.
    group.add(buildTerrainGroup(syntheticDem(), 0.35));

    const field = this.state.custom ?? computePlumeField(this.state.q * 1e6, this.state.u, this.state.cls, this.state.stackH, this.state.dim);
    this.api.reportDataScale(field.nx * field.ny * field.nz);
    if (field.cMax <= 0) {
      this.group = group;
      three.scene.add(group);
      this.fitCamera();
      three.setVisible(true);
      three.render();
      return;
    }

    // Voxel cloud above the threshold.
    const threshold = this.state.thresholdT * field.cMax;
    const visible: number[] = [];
    for (let k = 0; k < field.nz; k += 1) {
      for (let j = 0; j < field.ny; j += 1) {
        for (let i = 0; i < field.nx; i += 1) {
          const v = field.c[(k * field.ny + j) * field.nx + i]!;
          if (v >= threshold) visible.push(i, j, k, v);
        }
      }
    }
    const count = visible.length / 4;
    if (count > 0) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45, roughness: 0.6, metalness: 0.05 });
      const inst = new THREE.InstancedMesh(geo, mat, count);
      const m = new THREE.Matrix4();
      const colors = new Float32Array(count * 3);
      // Map field axes to world: x → +X (downwind), y → Z, z → Y, centred.
      const sx = 1.9 / field.nx;
      const sy = 0.62 / field.nz;
      const sz = 0.9 / field.ny;
      for (let n = 0; n < count; n += 1) {
        const i = visible[n * 4]!;
        const j = visible[n * 4 + 1]!;
        const k = visible[n * 4 + 2]!;
        const v = visible[n * 4 + 3]!;
        const wx = (i + 0.5) * sx - 0.75;
        const wy = (k + 0.5) * sy + 0.06;
        const wz = (j + 0.5) * sz - 0.45;
        const shrink = 0.75 + 0.25 * (v / field.cMax);
        m.makeScale(sx * shrink, sy * shrink, sz * shrink);
        m.setPosition(wx, wy, wz);
        inst.setMatrixAt(n, m);
        const [r, g2, b] = rampColor3(v / field.cMax);
        colors[n * 3] = r;
        colors[n * 3 + 1] = g2;
        colors[n * 3 + 2] = b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      (mat as THREE.MeshStandardMaterial).vertexColors = true;
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }

    // Downwind cross-section at y = 0 (vertex-coloured plane in the x–z plane).
    if (this.state.showSection) {
      const snx = 60;
      const snz = 24;
      const positions: number[] = [];
      const colorsSec: number[] = [];
      const indices: number[] = [];
      for (let k = 0; k <= snz; k += 1) {
        for (let i = 0; i <= snx; i += 1) {
          const x = (i / snx) * X_MAX;
          const z = (k / snz) * Z_MAX;
          const v = this.state.custom
            ? this.sampleCustom(this.state.custom, x / X_MAX, 0.5, z / Z_MAX)
            : plumeConcentration(this.state.q * 1e6, this.state.u, this.state.cls, this.state.stackH, x, 0, z);
          positions.push((i / snx) * 1.9 - 0.75, (k / snz) * 0.62 + 0.06, 0);
          const [r, g2, b] = rampColor3(v / field.cMax);
          colorsSec.push(r, g2, b);
        }
      }
      for (let k = 0; k < snz; k += 1) {
        for (let i = 0; i < snx; i += 1) {
          const a = k * (snx + 1) + i;
          indices.push(a, a + snx + 1, a + 1, a + 1, a + snx + 1, a + snx + 2);
        }
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(colorsSec, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      mesh.position.z = 0;
      group.add(mesh);
    }

    this.group = group;
    three.scene.add(group);
    this.fitCamera();
    three.setVisible(true);
    three.render();
  }

  /** Sample the custom field at normalised (x,y,z) ∈ [0,1]³. */
  private sampleCustom(f: VoxelField3D, tx: number, ty: number, tz: number): number {
    const i = Math.min(f.nx - 1, Math.max(0, Math.floor(tx * f.nx)));
    const j = Math.min(f.ny - 1, Math.max(0, Math.floor(ty * f.ny)));
    const k = Math.min(f.nz - 1, Math.max(0, Math.floor(tz * f.nz)));
    return f.c[(k * f.ny + j) * f.nx + i]!;
  }
}

export default function createPlume3DPlugin(): Plugin {
  return new Plume3DPlugin();
}
