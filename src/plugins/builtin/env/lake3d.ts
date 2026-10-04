// ==========================================================================
// Example plugin: 3-D lake stratification
//
// Teaching model of a lake basin in thermal stratification: an epilimnion at
// the surface temperature, a linear thermocline and a cold hypolimnion, with
// the corresponding DO profile (oxygen-rich surface, near-anoxic bottom) and
// a nutrient-load-driven surface algal bloom. A vertical slice plane carries
// vertex-coloured temperature; line overlays trace T(z) and DO(z). A
// measured `depth,temp,do` CSV replaces the synthetic profile (≥3 points).
// ==========================================================================

import * as THREE from 'three';
import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { isZh, lakeProfile, rampColor3, numCell, type LakeProfilePoint } from './envCore';
import { actionButton, actionFired, exportSnapshotPng, notify } from '../shared/enhance';
import { lake3dManifest } from './lake3dManifest';

export { lake3dManifest } from './lake3dManifest';

// ---- Profile helpers (exported for tests) -----------------------------------

export interface MeasuredProfile {
  points: LakeProfilePoint[];
}

/** Parse a `depth,temp,do` sheet; depths sorted ascending, 0–40 ℃ clamped. */
export function parseProfileCsv(text: string): MeasuredProfile | null {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
  const pts: LakeProfilePoint[] = [];
  for (const line of rows) {
    const cells = line.split(/[,;\t]+/).map((s) => s.trim());
    const nums = cells.map((s) => numCell(s));
    if (nums.length < 3 || nums.slice(0, 3).some((n) => n === null)) continue;
    const depth = nums[0]!;
    const temp = Math.min(40, Math.max(0, nums[1]!));
    const doVal = Math.max(0, nums[2]!);
    if (depth < 0) continue;
    pts.push({ depth, temp, do: doVal });
  }
  if (pts.length === 0) return null;
  pts.sort((a, b) => a.depth - b.depth);
  return { points: pts };
}

/** Interpolate a measured profile onto evenly spaced display depths. */
export function resampleProfile(pts: LakeProfilePoint[], maxDepth: number): LakeProfilePoint[] {
  const out: LakeProfilePoint[] = [];
  const top = Math.min(maxDepth, pts[pts.length - 1]!.depth);
  const n = 24;
  for (let i = 0; i <= n; i += 1) {
    const d = (top * i) / n;
    let j = 0;
    while (j + 1 < pts.length && pts[j + 1]!.depth < d) j += 1;
    const a = pts[j]!;
    const b = pts[Math.min(j + 1, pts.length - 1)]!;
    const f = b.depth > a.depth ? (d - a.depth) / (b.depth - a.depth) : 0;
    out.push({
      depth: d,
      temp: a.temp + (b.temp - a.temp) * Math.min(1, Math.max(0, f)),
      do: a.do + (b.do - a.do) * Math.min(1, Math.max(0, f)),
    });
  }
  return out;
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  depth: number;
  surfaceTemp: number;
  wind: number;
  nutrients: number;
  sliceAxis: 'x' | 'z';
  measured: MeasuredProfile | null;
}

const DEFAULTS: State = { depth: 30, surfaceTemp: 20, wind: 2, nutrients: 0.5, sliceAxis: 'x', measured: null };

const TEMP_MIN = 4;
const TEMP_MAX = 30;

export class Lake3DPlugin implements Plugin {
  readonly manifest = lake3dManifest;
  private api!: PluginApi;
  private three: Scene3DHandle | null = null;
  private group: THREE.Group | null = null;
  private state: State = { ...DEFAULTS };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.clearGroup();
    this.three = null;
    this.state.measured = null;
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
    const zh = isZh(this.api.locale);
    return [
      { key: 'depth', label: 'Max depth (m)', labelI18n: { 'zh-CN': '湖深（m）', 'en-US': 'Max depth (m)' }, type: 'number', min: 5, max: 120, step: 1, value: this.state.depth, hint: zh ? '0 或负值禁用' : '0/negative disables' },
      { key: 'surfaceTemp', label: 'Inflow / surface temp (°C)', labelI18n: { 'zh-CN': '入流温度（℃）', 'en-US': 'Inflow / surface temp (°C)' }, type: 'range', min: 4, max: 35, step: 0.5, value: this.state.surfaceTemp },
      { key: 'wind', label: 'Mixing wind speed (m/s)', labelI18n: { 'zh-CN': '混合风速（m/s）', 'en-US': 'Mixing wind speed (m/s)' }, type: 'range', min: 0, max: 8, step: 0.5, value: this.state.wind, hint: zh ? '风生混合加深表层' : 'Wind stress deepens the epilimnion' },
      { key: 'nutrients', label: 'Nutrient load (relative)', labelI18n: { 'zh-CN': '营养盐负荷（相对）', 'en-US': 'Nutrient load (relative)' }, type: 'range', min: 0, max: 1, step: 0.05, value: this.state.nutrients },
      {
        key: 'sliceAxis',
        label: 'Slice direction',
        labelI18n: { 'zh-CN': '展示剖面方向', 'en-US': 'Slice direction' },
        type: 'select',
        value: this.state.sliceAxis,
        options: [
          { value: 'x', label: 'X', labelI18n: { 'zh-CN': 'X', 'en-US': 'X' } },
          { value: 'z', label: 'Z', labelI18n: { 'zh-CN': 'Z', 'en-US': 'Z' } },
        ],
      },
      { key: 'reset', label: 'Reset to defaults', labelI18n: { 'zh-CN': '回到初始参数', 'en-US': 'Reset to defaults' }, type: 'button', action: 'reset' },
      actionButton('fitView', 'Fit view', '重置视角'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportPngTransparent', 'Snapshot PNG (transparent)', '快照 PNG（透明）'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot() ?? null, 'env-lake3d');
      return;
    }
    if (actionFired(params, 'exportPngTransparent')) {
      exportSnapshotPng(this.api, this.three?.snapshot({ transparent: true }) ?? null, 'env-lake3d');
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
      this.state = { ...DEFAULTS, measured: this.state.measured };
      this.rebuild();
      return;
    }
    let rebuild = false;
    if (typeof params.depth === 'number' && params.depth >= 5 && params.depth !== this.state.depth) {
      this.state.depth = Math.min(120, params.depth);
      rebuild = true;
    }
    if (typeof params.surfaceTemp === 'number' && params.surfaceTemp !== this.state.surfaceTemp) {
      this.state.surfaceTemp = Math.min(35, Math.max(4, params.surfaceTemp));
      rebuild = true;
    }
    if (typeof params.wind === 'number' && params.wind !== this.state.wind) {
      this.state.wind = params.wind;
      rebuild = true;
    }
    if (typeof params.nutrients === 'number' && params.nutrients !== this.state.nutrients) {
      this.state.nutrients = params.nutrients;
      rebuild = true;
    }
    if ((params.sliceAxis === 'x' || params.sliceAxis === 'z') && params.sliceAxis !== this.state.sliceAxis) {
      this.state.sliceAxis = params.sliceAxis;
      rebuild = true;
    }
    if (rebuild) this.rebuild();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const parsed = parseProfileCsv(await file.text());
    if (!parsed) {
      notify(this.api, 'warning', 'Expected depth,temp,do rows', '需要 depth,temp,do 数据行');
      return;
    }
    if (parsed.points.length < 3) {
      notify(this.api, 'warning', 'Fewer than 3 measured points — profile may be unreliable', '实测点少于 3 个 — 剖面可能不可靠');
      return;
    }
    this.state.measured = parsed;
    this.state.depth = Math.max(this.state.depth, Math.ceil(parsed.points[parsed.points.length - 1]!.depth));
    this.api.reportDataScale(parsed.points.length);
    notify(this.api, 'success', `Loaded ${parsed.points.length} measured points`, `已加载 ${parsed.points.length} 个实测点`);
    this.rebuild();
  }

  /** Active profile: measured (resampled) or synthetic model. */
  private profile(): LakeProfilePoint[] {
    if (this.state.measured) return resampleProfile(this.state.measured.points, this.state.depth);
    return lakeProfile(this.state.depth, this.state.surfaceTemp, this.state.wind, this.state.nutrients);
  }

  // ---- scene ---------------------------------------------------------------

  private clearGroup() {
    if (!this.group) return;
    this.three?.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.InstancedMesh) {
        (obj as THREE.Mesh).geometry?.dispose?.();
        const m = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose?.();
      }
    });
    this.group = null;
  }

  private fitCamera() {
    if (!this.three) return;
    this.three.camera.position.set(2.4, 1.6, 2.6);
    this.three.camera.lookAt(0, 0.05, 0);
    this.three.controls.update?.();
    this.three.render();
  }

  private rebuild() {
    const three = this.three;
    if (!three) return;
    if (this.state.depth <= 0) {
      notify(this.api, 'warning', 'Lake depth must be positive.', '湖深必须为正数。');
      return;
    }
    this.clearGroup();
    const group = new THREE.Group();
    group.add(new THREE.AmbientLight(0x9fb4cc, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(2.2, 3.0, 1.4);
    group.add(sun);

    const R = 1.05;
    const depthScale = 0.55;
    const profile = this.profile();

    // Basin shell (outer bowl, dark sediment).
    const basin = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.02, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3d3428, roughness: 0.95, side: THREE.DoubleSide }),
    );
    basin.scale.y = (this.state.depth * depthScale) / R;
    group.add(basin);

    // Shore ring so the waterline reads as a shoreline.
    const shore = new THREE.Mesh(
      new THREE.RingGeometry(R * 1.0, R * 1.18, 48),
      new THREE.MeshStandardMaterial({ color: 0x57624f, roughness: 1, side: THREE.DoubleSide }),
    );
    shore.rotation.x = -Math.PI / 2;
    shore.position.y = 0.005;
    group.add(shore);

    // Water body: stacked horizontal layers coloured by temperature.
    const layers = profile.length - 1;
    const waterGroup = new THREE.Group();
    for (let i = 0; i < layers; i += 1) {
      const p0 = profile[i]!;
      const p1 = profile[i + 1]!;
      const fracTop = p0.depth / this.state.depth;
      const fracBot = p1.depth / this.state.depth;
      // Radius shrinks with depth following the bowl profile.
      const rTop = R * Math.sqrt(Math.max(1e-4, 1 - fracTop * fracTop));
      const rBot = R * Math.sqrt(Math.max(1e-4, 1 - fracBot * fracBot));
      const h = (fracBot - fracTop) * this.state.depth * depthScale;
      if (h <= 0) continue;
      const [r, g2, b] = rampColor3((p1.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN));
      const layer = new THREE.Mesh(
        new THREE.CylinderGeometry(rTop, rBot, h, 48, 1, true),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(r, g2, b),
          transparent: true,
          opacity: 0.55,
          roughness: 0.3,
          side: THREE.DoubleSide,
        }),
      );
      layer.position.y = -((fracTop + fracBot) / 2) * this.state.depth * depthScale;
      waterGroup.add(layer);
    }
    group.add(waterGroup);

    // Surface disc + algal bloom shading (nutrient load).
    const bloom = new THREE.Mesh(
      new THREE.CircleGeometry(R, 48),
      new THREE.MeshStandardMaterial({
        color: 0x3f7d2c,
        transparent: true,
        opacity: 0.15 + 0.6 * this.state.nutrients,
        roughness: 0.5,
      }),
    );
    bloom.rotation.x = -Math.PI / 2;
    bloom.position.y = 0.01;
    group.add(bloom);

    // Vertical slice: temperature-coloured plane + T/DO curves.
    const sliceH = this.state.depth * depthScale;
    const sn = 40;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= sn; i += 1) {
      const p = profile[Math.min(profile.length - 1, Math.round((i / sn) * (profile.length - 1)))]!;
      const y = -(p.depth / this.state.depth) * sliceH;
      positions.push(-R, y, 0, R, y, 0);
      const [r, g2, b] = rampColor3((p.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN));
      colors.push(r, g2, b, r, g2, b);
    }
    for (let i = 0; i < sn; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const sliceGeom = new THREE.BufferGeometry();
    sliceGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    sliceGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    sliceGeom.setIndex(indices);
    sliceGeom.computeVertexNormals();
    const slice = new THREE.Mesh(sliceGeom, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    if (this.state.sliceAxis === 'z') slice.rotation.y = Math.PI / 2;
    group.add(slice);

    // T(z) curve as a Line (x = temperature offset, y = depth).
    const tempLinePts: number[] = [];
    const doLinePts: number[] = [];
    profile.forEach((p) => {
      const y = -(p.depth / this.state.depth) * sliceH;
      const tNorm = (p.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
      const doNorm = Math.min(1, p.do / 12);
      tempLinePts.push(-R + tNorm * 0.5, y, 0.02);
      doLinePts.push(R - doNorm * 0.5, y, 0.02);
    });
    const tempLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tempLinePts, 3)),
      new THREE.LineBasicMaterial({ color: 0xffb36b }),
    );
    const doLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(doLinePts, 3)),
      new THREE.LineBasicMaterial({ color: 0x7ec8e3 }),
    );
    if (this.state.sliceAxis === 'z') {
      tempLine.rotation.y = Math.PI / 2;
      doLine.rotation.y = Math.PI / 2;
    }
    group.add(tempLine, doLine);

    this.group = group;
    three.scene.add(group);
    this.fitCamera();
    three.setVisible(true);
    three.render();
  }
}

export default function createLake3DPlugin(): Plugin {
  return new Lake3DPlugin();
}
