// ==========================================================================
// Example plugin: 3-D groundwater transport
//
// Advection–dispersion of a contaminant slug through a teaching aquifer:
// the explicit upwind step from envCore advances a voxel concentration field
// along the Darcy flow direction (+x), a source injects continuously at the
// user-set (x, z) and a pumping well withdraws at the far side. The plume is
// drawn as translucent cubes, Darcy arrows show the flow direction, and a
// first-arrival readout reports when the front (≥1 % of the source conc)
// reaches the well. Time stepping runs through the host render loop and is
// clamped to the numerical stability limit (reported when clamped).
// ==========================================================================

import * as THREE from 'three';
import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { groundwaterStep, isZh, pumpWell, rampColor3, type GroundwaterGrid } from './envCore';
import { actionButton, actionFired, exportSnapshotPng, notify } from '../shared/enhance';
import { groundwater3dManifest } from './groundwater3dManifest';

export { groundwater3dManifest } from './groundwater3dManifest';

const NX = 40;
const NY = 18;
const NZ = 10;
const DX = 12.5; // m per cell → 500 m aquifer length
const K_MIN = 0.1;
const K_MAX = 100; // m/d, PRD range
const POROSITY = 0.3;

// ---- Plugin ----------------------------------------------------------------

interface State {
  k: number; // hydraulic conductivity m/d
  gradient: number; // dimensionless
  dispL: number; // longitudinal dispersivity m
  srcX: number; // 0–1 normalised
  srcZ: number; // 0–1 normalised
  playing: boolean;
}

const DEFAULTS: State = { k: 10, gradient: 0.005, dispL: 10, srcX: 0.25, srcZ: 0.5, playing: true };

export class Groundwater3DPlugin implements Plugin {
  readonly manifest = groundwater3dManifest;
  private api!: PluginApi;
  private three: Scene3DHandle | null = null;
  private group: THREE.Group | null = null;
  private mesh: THREE.InstancedMesh | null = null;
  private state: State = { ...DEFAULTS };
  private grid: GroundwaterGrid | null = null;
  private simDays = 0;
  private arrivalDays: number | null = null;
  private rafId = 0;
  private lastT = 0;
  private clampedWarned = false;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stopTick();
    this.clearMesh();
    this.grid = null;
    this.three = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    if (context.container.three) this.three = context.container.three;
    this.resetSim();
    this.rebuild();
  }

  async deactivate() {
    this.stopTick();
    this.clearMesh();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    if (container.three) this.three = container.three;
    this.resetSim();
    this.rebuild();
  }

  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.resetSim();
    this.rebuild();
  }

  getParams(): ParamDefinition[] {
    const zh = isZh(this.api.locale);
    const kOutOfRange = this.state.k < K_MIN || this.state.k > K_MAX;
    return [
      {
        key: 'k',
        label: 'Hydraulic conductivity K (m/d)',
        labelI18n: { 'zh-CN': '渗透系数 K（m/d）', 'en-US': 'Hydraulic conductivity K (m/d)' },
        type: 'number',
        min: 0,
        max: 200,
        step: 1,
        value: this.state.k,
        hint: zh ? `合理范围 ${K_MIN}–${K_MAX} m/d，越界禁用计算` : `Valid ${K_MIN}–${K_MAX} m/d; out of range disables the model`,
      },
      { key: 'gradient', label: 'Hydraulic gradient i', labelI18n: { 'zh-CN': '水力梯度 i', 'en-US': 'Hydraulic gradient i' }, type: 'range', min: 0.001, max: 0.02, step: 0.001, value: this.state.gradient },
      { key: 'dispL', label: 'Longitudinal dispersivity (m)', labelI18n: { 'zh-CN': '纵向弥散度（m）', 'en-US': 'Longitudinal dispersivity (m)' }, type: 'number', min: 0, max: 50, step: 1, value: this.state.dispL },
      { key: 'srcX', label: 'Source x (0–1)', labelI18n: { 'zh-CN': '污染源位置 x（0–1）', 'en-US': 'Source x (0–1)' }, type: 'range', min: 0.05, max: 0.5, step: 0.05, value: this.state.srcX },
      { key: 'srcZ', label: 'Source z (0–1)', labelI18n: { 'zh-CN': '污染源位置 z（0–1）', 'en-US': 'Source z (0–1)' }, type: 'range', min: 0.1, max: 0.9, step: 0.05, value: this.state.srcZ },
      { key: 'play', label: zh ? '播放' : 'Play', offLabelI18n: { 'zh-CN': '播放', 'en-US': 'Play' }, onLabelI18n: { 'zh-CN': '暂停', 'en-US': 'Pause' }, labelI18n: { 'zh-CN': '播放 / 暂停', 'en-US': 'Play / Pause' }, type: 'toggle', value: this.state.playing, offLabel: zh ? '播放' : 'Play', onLabel: zh ? '暂停' : 'Pause' },
      { key: 'reset', label: 'Reset to defaults', labelI18n: { 'zh-CN': '回到初始参数', 'en-US': 'Reset to defaults' }, type: 'button', action: 'reset' },
      actionButton('fitView', 'Fit view', '重置视角'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportPngTransparent', 'Snapshot PNG (transparent)', '快照 PNG（透明）'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
      ...(kOutOfRange
        ? [
            {
              key: 'kWarn',
              label: zh ? `K 越界 — 已禁用（${K_MIN}–${K_MAX} m/d）` : `K out of range — disabled (${K_MIN}–${K_MAX} m/d)`,
              labelI18n: { 'zh-CN': `K 越界 — 已禁用（${K_MIN}–${K_MAX} m/d）`, 'en-US': `K out of range — disabled (${K_MIN}–${K_MAX} m/d)` },
              type: 'checkbox' as const,
              value: true,
            },
          ]
        : []),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot() ?? null, 'env-groundwater3d');
      return;
    }
    if (actionFired(params, 'exportPngTransparent')) {
      exportSnapshotPng(this.api, this.three?.snapshot({ transparent: true }) ?? null, 'env-groundwater3d');
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
      this.resetSim();
      this.rebuild();
      return;
    }
    let simReset = false;
    let rebuild = false;
    if (typeof params.k === 'number' && params.k !== this.state.k) {
      this.state.k = params.k;
      simReset = true;
    }
    if (typeof params.gradient === 'number' && params.gradient !== this.state.gradient) {
      this.state.gradient = params.gradient;
      simReset = true;
    }
    if (typeof params.dispL === 'number' && params.dispL >= 0 && params.dispL !== this.state.dispL) {
      this.state.dispL = Math.min(50, params.dispL);
      simReset = true;
    }
    if (typeof params.srcX === 'number' && params.srcX !== this.state.srcX) {
      this.state.srcX = params.srcX;
      simReset = true;
    }
    if (typeof params.srcZ === 'number' && params.srcZ !== this.state.srcZ) {
      this.state.srcZ = params.srcZ;
      simReset = true;
    }
    if (typeof params.play === 'boolean' && params.play !== this.state.playing) {
      this.state.playing = params.play;
    }
    if (simReset) this.resetSim();
    if (simReset || rebuild) this.rebuild();
    if (this.state.playing) this.ensureTick();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  /** Darcy seepage velocity (m/d) — teaching value with fixed porosity. */
  private velocity(): number {
    return (this.state.k * this.state.gradient) / POROSITY;
  }

  private kOutOfRange(): boolean {
    return this.state.k < K_MIN || this.state.k > K_MAX;
  }

  private resetSim() {
    this.grid = { nx: NX, ny: NY, nz: NZ, c: new Float64Array(NX * NY * NZ) };
    this.simDays = 0;
    this.arrivalDays = null;
    this.clampedWarned = false;
    this.inject();
    this.stepSim(30); // pre-run a little so the plume is visible on load
  }

  private srcCell(): [number, number, number] {
    return [
      Math.min(NX - 2, Math.max(1, Math.round(this.state.srcX * NX))),
      Math.round(NY / 2),
      Math.min(NZ - 2, Math.max(1, Math.round(this.state.srcZ * NZ))),
    ];
  }

  private inject() {
    if (!this.grid) return;
    const [sx, sy, sz] = this.srcCell();
    const r = 1;
    for (let dz = -r; dz <= r; dz += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        const idx = ((sz + dz) * NY + sy + dy) * NX + sx;
        this.grid.c[idx] = 100; // mg/L source concentration
      }
    }
  }

  private wellCell(): [number, number, number] {
    return [NX - 4, Math.round(NY / 2), Math.round(NZ / 2)];
  }

  /** Advance the simulation by ~`daysPerFrame` days (called each tick). */
  private stepSim(frames = 1) {
    if (!this.grid || this.kOutOfRange()) return;
    const v = this.velocity();
    const dtDays = 5; // nominal dt; groundwaterStep clamps for stability
    for (let f = 0; f < frames; f += 1) {
      const { clamped } = groundwaterStep(this.grid, { velocity: v, dispL: this.state.dispL, dx: DX, dt: dtDays });
      if (clamped && !this.clampedWarned) {
        this.clampedWarned = true;
        this.api.log('warn', 'Time step clamped to the numerical stability limit');
      }
      this.inject();
      const [wx, wy, wz] = this.wellCell();
      pumpWell(this.grid, wx, wy, wz, 0.25);
      this.simDays += dtDays;
      // First arrival: front (≥1 mg/L) reaches the well column.
      if (this.arrivalDays === null) {
        const wIdx = (wz * NY + wy) * NX + wx;
        if (this.grid.c[wIdx]! >= 1) this.arrivalDays = this.simDays;
      }
    }
  }

  // ---- render loop -----------------------------------------------------------

  private tick = (t: number) => {
    this.rafId = 0;
    const three = this.three;
    if (!three || !this.state.playing) return;
    const dt = this.lastT ? (t - this.lastT) / 1000 : 0;
    this.lastT = t;
    const steps = Math.min(6, Math.max(1, Math.round(dt * 60))); // ~real-time-ish
    this.stepSim(steps);
    this.rebuildMeshOnly();
    three.render();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private ensureTick() {
    if (!this.rafId && this.three && this.state.playing) this.rafId = requestAnimationFrame(this.tick);
  }

  private stopTick() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.lastT = 0;
  }

  // ---- scene ---------------------------------------------------------------

  private clearMesh() {
    if (this.mesh) {
      this.three?.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    if (this.group) {
      this.three?.scene.remove(this.group);
      this.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry?.dispose?.();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.group = null;
    }
  }

  private fitCamera() {
    if (!this.three) return;
    this.three.camera.position.set(2.6, 1.8, 2.9);
    this.three.camera.lookAt(0, 0, 0);
    this.three.controls.update?.();
    this.three.render();
  }

  /** Full rebuild: static furniture (arrows, well, source markers + legend). */
  private rebuild() {
    const three = this.three;
    if (!three) return;
    this.stopTick();
    this.clearMesh();
    const group = new THREE.Group();
    group.add(new THREE.AmbientLight(0x9fb4cc, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(2.4, 3.0, 1.6);
    group.add(sun);

    // Aquifer bounding box (wireframe).
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.9, 0.5, 0.9)),
      new THREE.LineBasicMaterial({ color: 0x5a6b80, transparent: true, opacity: 0.7 }),
    );
    box.position.y = 0.28;
    group.add(box);

    // Darcy flow arrows along +x.
    const arrowMat = new THREE.LineBasicMaterial({ color: 0x6f8ba8, transparent: true, opacity: 0.9 });
    for (const zy of [0.16, 0.28, 0.4]) {
      for (const zx of [-0.5, 0.2, 0.7]) {
        const dir = new THREE.Vector3(1, 0, 0);
        const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(zx, zy, zx * 0.3 - 0.2), 0.18, 0x6f8ba8, 0.05, 0.025);
        (arrow.line as THREE.Line).material = arrowMat;
        (arrow.cone as THREE.Mesh).material = arrowMat;
        group.add(arrow);
      }
    }

    // Source marker (red) + well (blue cylinder).
    const [sx, , sz] = this.srcCell();
    const source = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xe05e4b, emissive: 0x531710 }),
    );
    source.position.set((sx / NX) * 1.9 - 0.95, 0.28, (sz / NZ) * 0.9 - 0.45);
    group.add(source);
    const [wx, , wz] = this.wellCell();
    const well = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.56, 12),
      new THREE.MeshStandardMaterial({ color: 0x7ec8e3, emissive: 0x0f2f3d }),
    );
    well.position.set((wx / NX) * 1.9 - 0.95, 0.28, (wz / NZ) * 0.9 - 0.45);
    group.add(well);

    this.group = group;
    three.scene.add(group);
    this.rebuildMeshOnly();
    this.fitCamera();
    three.setVisible(true);
    three.render();
    if (this.state.playing) this.ensureTick();
  }

  /** Recreate only the voxel cloud from the current grid (cheap, per frame). */
  private rebuildMeshOnly() {
    const three = this.three;
    const grid = this.grid;
    if (!three || !grid) return;
    if (this.mesh) {
      three.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    const cMax = Math.max(...Array.from(grid.c), 1);
    const visible: Array<[number, number, number, number]> = [];
    for (let z = 0; z < grid.nz; z += 1) {
      for (let y = 0; y < grid.ny; y += 1) {
        for (let x = 0; x < grid.nx; x += 1) {
          const v = grid.c[(z * grid.ny + y) * grid.nx + x]!;
          if (v >= Math.max(0.5, cMax * 0.01)) visible.push([x, y, z, v]);
        }
      }
    }
    this.api.reportDataScale(visible.length);
    if (visible.length === 0) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5, roughness: 0.55, metalness: 0.05, vertexColors: true });
    const inst = new THREE.InstancedMesh(geo, mat, visible.length);
    const m = new THREE.Matrix4();
    const colors = new Float32Array(visible.length * 3);
    const sx = 1.9 / grid.nx;
    const sy = 0.5 / grid.nz;
    const sz = 0.9 / grid.ny;
    visible.forEach(([x, y, z, v], n) => {
      m.makeScale(sx * 0.92, sy * 0.92, sz * 0.92);
      m.setPosition((x + 0.5) * sx - 0.95, 0.28 + ((z + 0.5) * sy - 0.25), (y + 0.5) * sz - 0.45);
      inst.setMatrixAt(n, m);
      const [r, g2, b] = rampColor3(v / cMax);
      colors[n * 3] = r;
      colors[n * 3 + 1] = g2;
      colors[n * 3 + 2] = b;
    });
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    inst.instanceMatrix.needsUpdate = true;
    this.mesh = inst;
    three.scene.add(inst);
  }
}

export default function createGroundwater3DPlugin(): Plugin {
  return new Groundwater3DPlugin();
}
