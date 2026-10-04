// ==========================================================================
// Example plugin: 3-D lake stratification — SPH particle fluid
//
// The layered-cylinder model was replaced by a real weakly-compressible SPH
// fluid (see ./sph.ts): 1500–3500 particles slosh inside an ellipsoidal lake
// basin, each carrying a temperature that is advected with the flow, weakly
// diffused between neighbours and fed back through thermal buoyancy (warm
// water rises, cold water sinks). Seeding the temperatures from the
// lakeProfile teaching profile makes the assembly form and hold a
// thermocline; wind shear on the surface band drives epilimnion currents and
// a slight tilt; the nutrient load rides along as a passive scalar and tints
// near-surface particles green (algal bloom).
//
// Rendering is THREE.Points + a custom sprite shader (soft circular sprites,
// temperature-mapped colour, depthWrite off) — continuous fluid look, no
// blocks. The science survives: particle temperatures are binned by depth
// and compared against the theoretical profile and an optional measured
// `depth,temp,do` CSV on the 2-D canvas (three curves per plot). DO(z) is
// derived from the simulated temperature with a saturation formula — a
// labelled teaching approximation.
// ==========================================================================

import * as THREE from 'three';
import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { envRampColor3, lakeProfile, numCell, type LakeProfilePoint } from './envCore';
import { actionButton, actionFired, exportSnapshotPng, notify } from '@/core/plugin-tools/enhance';
import { isZh } from '@/core/plugin-tools/locale';
import { LakeSph, profileBins } from './sph';
import { LabelSet } from './label3d';
import { lake3dManifest } from './lake3dManifest';

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

// ---- DO teaching approximation ----------------------------------------------

/** Freshwater O₂ saturation (mg/L), Benson–Krause-style polynomial. */
function doSaturation(tC: number): number {
  const t = Math.min(40, Math.max(0, tC));
  return Math.max(0, 14.62 - 0.4092 * t + 0.00804 * t * t - 7.79e-5 * t * t * t);
}

/** Teaching DO(z): saturated at the simulated temperature, consumed with depth. */
function simDoFromTemp(tC: number, frac: number): number {
  const sat = doSaturation(tC);
  const consumed = (0.8 * Math.max(0, frac - 0.25)) / 0.75;
  return Math.max(0.3, sat * (1 - consumed));
}

// ---- Plugin -----------------------------------------------------------------

interface State {
  depth: number;
  surfaceTemp: number;
  wind: number;
  nutrients: number;
  sliceAxis: 'x' | 'z';
  quality: '1500' | '2500' | '3500';
  running: boolean;
  showSlice: boolean;
  measured: MeasuredProfile | null;
}

const DEFAULTS: State = {
  depth: 30,
  surfaceTemp: 20,
  wind: 2,
  nutrients: 0.5,
  sliceAxis: 'x',
  quality: '2500',
  running: true,
  showSlice: true,
  measured: null,
};

const TEMP_MIN = 4;
const TEMP_MAX = 30;
const R = 1.05; // waterline radius (world units)
const DEPTH_SCALE = 0.03; // metres → world units: 30 m ≈ 0.9, keeps the bowl wide like a real lake
const MAX_DEPTH_WORLD = 1.365; // ≈ 1.3 × R — cap so deep lakes never become narrow shafts
const RIM = 0.05; // rim wall above the waterline (world units)
const N_BINS = 20;
const QUALITY_COUNTS: Record<string, number> = { '1500': 1500, '2500': 2500, '3500': 3500 };
/** Algal-bloom film opacity: thin tint at the waterline, ≤ 0.35 even at full load. */
const bloomOpacity = (nutrients: number): number => 0.08 + 0.27 * Math.min(1, Math.max(0, nutrients));

interface PlotLine {
  pts: Array<[number, number]>; // (value, depth m)
  color: string;
  dash?: number[];
  width?: number;
}

const POINT_VERT = /* glsl */ `
attribute float aTemp;
attribute float aNutrient;
uniform float uSize;
uniform float uScale;
uniform vec2 uTempRange;
varying float vT;
varying float vN;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale / max(0.12, -mv.z), 1.0, 256.0);
  float span = max(1.0, uTempRange.y - uTempRange.x);
  vT = clamp((aTemp - uTempRange.x) / span, 0.0, 1.0);
  vN = clamp(aNutrient, 0.0, 1.0);
}
`;

const POINT_FRAG = /* glsl */ `
varying float vT;
varying float vN;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float alpha = smoothstep(1.0, 0.55, d);
  if (alpha < 0.02) discard;
  vec3 cold = vec3(0.118, 0.314, 0.549);
  vec3 mid  = vec3(0.298, 0.776, 0.831);
  vec3 warm = vec3(0.882, 0.373, 0.278);
  vec3 col = vT < 0.5 ? mix(cold, mid, vT * 2.0) : mix(mid, warm, vT * 2.0 - 1.0);
  col = mix(col, vec3(0.243, 0.62, 0.173), vN * 0.55);
  gl_FragColor = vec4(col, alpha * 0.88);
}
`;

export class Lake3DPlugin implements Plugin {
  readonly manifest = lake3dManifest;
  private api!: PluginApi;
  private three: Scene3DHandle | null = null;
  private ctx: ContainerCapabilities | null = null;
  private group: THREE.Group | null = null;
  /** Fit the camera only on first show / re-activation — never yank it back
   * while the user is orbiting or dragging parameter sliders. */
  private needsFit = true;
  private sim: LakeSph | null = null;
  private simDepth = -1;
  private simCount = 0;
  private seedKey = '';
  private pointsGeo: THREE.BufferGeometry | null = null;
  private pointsMat: THREE.ShaderMaterial | null = null;
  private sliceMesh: THREE.Mesh | null = null;
  private bloomMat: THREE.MeshStandardMaterial | null = null;
  private bloomMesh: THREE.Mesh | null = null;
  /** Bloom annotation sprite — hidden while nutrient load is 0. */
  private bloomLabel: THREE.Sprite | null = null;
  /** Bilingual 3-D scene annotations (湖面 / 湖底 / 温跃层 / 藻华). */
  private labels = new LabelSet();
  /** Mean height of the above-waterline particles — the bloom film rides it. */
  private surfaceY = 0.02;
  private rafId = 0;
  private lastT = 0;
  private lastPanel = 0;
  private lastNaNNotify = -1e9;
  private state: State = { ...DEFAULTS };

  async init(api: PluginApi) {
    this.api = api;
    // Re-render the 3-D annotations in place on a locale switch (no rebuild);
    // refreshing a disposed (empty) LabelSet is a no-op, so this is safe while
    // the plugin is deactivated.
    api.onLocaleChange((l) => this.labels.refresh(isZh(l) ? 'zh-CN' : 'en-US'));
  }

  async destroy() {
    this.stopTick();
    this.clearGroup();
    this.sim = null;
    this.three = null;
    this.ctx = null;
    this.state.measured = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.needsFit = true;
    this.rebuild();
  }

  async deactivate() {
    this.stopTick();
    this.clearGroup();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
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
      {
        key: 'depth',
        label: 'Max depth (m)',
        labelI18n: { 'zh-CN': '湖深（m）', 'en-US': 'Max depth (m)' },
        type: 'number',
        min: 5,
        max: 120,
        step: 1,
        value: this.state.depth,
        hint: zh ? '5–120 m；修改后重新播种粒子' : '5–120 m; reseeds the particles',
      },
      { key: 'surfaceTemp', label: 'Inflow / surface temp (°C)', labelI18n: { 'zh-CN': '入流温度（℃）', 'en-US': 'Inflow / surface temp (°C)' }, type: 'range', min: 4, max: 35, step: 0.5, value: this.state.surfaceTemp },
      { key: 'wind', label: 'Mixing wind speed (m/s)', labelI18n: { 'zh-CN': '混合风速（m/s）', 'en-US': 'Mixing wind speed (m/s)' }, type: 'range', min: 0, max: 8, step: 0.5, value: this.state.wind, hint: zh ? '表层剪切实时生效，驱动环流' : 'Live surface shear drives circulation' },
      { key: 'nutrients', label: 'Nutrient load (relative)', labelI18n: { 'zh-CN': '营养盐负荷（相对）', 'en-US': 'Nutrient load (relative)' }, type: 'range', min: 0, max: 1, step: 0.05, value: this.state.nutrients },
      {
        key: 'quality',
        label: 'Particle count',
        labelI18n: { 'zh-CN': '粒子数', 'en-US': 'Particle count' },
        type: 'select',
        value: this.state.quality,
        hint: zh ? '粒子越多流体越细腻，CPU 负担越大' : 'More particles = finer fluid, heavier CPU',
        options: [
          { value: '1500', label: 'Low (1500)', labelI18n: { 'zh-CN': '低（1500）', 'en-US': 'Low (1500)' } },
          { value: '2500', label: 'Medium (2500)', labelI18n: { 'zh-CN': '中（2500）', 'en-US': 'Medium (2500)' } },
          { value: '3500', label: 'High (3500)', labelI18n: { 'zh-CN': '高（3500）', 'en-US': 'High (3500)' } },
        ],
      },
      {
        key: 'runSim',
        label: 'Simulation',
        labelI18n: { 'zh-CN': '仿真运行', 'en-US': 'Simulation' },
        type: 'toggle',
        value: this.state.running,
        offLabel: 'Run',
        offLabelI18n: { 'zh-CN': '运行', 'en-US': 'Run' },
        onLabel: 'Pause',
        onLabelI18n: { 'zh-CN': '暂停', 'en-US': 'Pause' },
      },
      { key: 'showSlice', label: 'Theory slice plane', labelI18n: { 'zh-CN': '理论剖面板', 'en-US': 'Theory slice plane' }, type: 'checkbox', value: this.state.showSlice },
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
      actionButton('resetSim', 'Reset simulation', '重置仿真'),
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
    if (actionFired(params, 'resetSim')) {
      if (this.sim) {
        this.sim.reset();
        this.seedField(this.sim);
        this.drawPanel();
      }
      notify(this.api, 'success', 'Simulation reset.', '已重置仿真。');
      return;
    }
    if (typeof params.runSim === 'boolean') {
      this.state.running = params.runSim;
      return;
    }
    if (typeof params.showSlice === 'boolean') {
      this.state.showSlice = params.showSlice;
      if (this.sliceMesh) this.sliceMesh.visible = params.showSlice;
      this.three?.render();
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
    if (typeof params.quality === 'string' && params.quality in QUALITY_COUNTS && params.quality !== this.state.quality) {
      this.state.quality = params.quality as State['quality'];
      rebuild = true;
    }
    if (typeof params.wind === 'number' && params.wind !== this.state.wind) {
      this.state.wind = Math.min(8, Math.max(0, params.wind));
    }
    if (typeof params.nutrients === 'number' && params.nutrients !== this.state.nutrients) {
      this.state.nutrients = Math.min(1, Math.max(0, params.nutrients));
      if (this.bloomMat) this.bloomMat.opacity = bloomOpacity(this.state.nutrients);
      if (this.bloomLabel) this.bloomLabel.visible = this.state.nutrients > 0;
    }
    if ((params.sliceAxis === 'x' || params.sliceAxis === 'z') && params.sliceAxis !== this.state.sliceAxis) {
      this.state.sliceAxis = params.sliceAxis;
      rebuild = true; // keeps the running solver — only the plane rotates
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

  // ---- physics wiring --------------------------------------------------------

  private worldDepth(): number {
    return Math.min(MAX_DEPTH_WORLD, Math.max(0.12, this.state.depth * DEPTH_SCALE));
  }

  private bottomTemp(): number {
    return Math.min(8, Math.max(4, this.state.surfaceTemp * 0.25));
  }

  /** Profile the particles are seeded with: measured CSV (resampled) or model. */
  private seedingProfile(): LakeProfilePoint[] {
    if (this.state.measured) return resampleProfile(this.state.measured.points, this.state.depth);
    return lakeProfile(this.state.depth, this.state.surfaceTemp, this.state.wind, this.state.nutrients);
  }

  private sampleProfile(prof: LakeProfilePoint[], depthM: number): number {
    const last = prof[prof.length - 1]!;
    const d = Math.min(last.depth, Math.max(0, depthM));
    let j = 0;
    while (j + 1 < prof.length && prof[j + 1]!.depth < d) j += 1;
    const a = prof[j]!;
    const b = prof[Math.min(j + 1, prof.length - 1)]!;
    const f = b.depth > a.depth ? (d - a.depth) / (b.depth - a.depth) : 0;
    return a.temp + (b.temp - a.temp) * Math.min(1, Math.max(0, f));
  }

  private seedField(sim: LakeSph) {
    const prof = this.seedingProfile();
    const depthM = this.state.depth;
    sim.seedField({
      tempAt: (frac) => this.sampleProfile(prof, frac * depthM),
      surfaceTemp: this.state.surfaceTemp,
      bottomTemp: this.bottomTemp(),
      nutrients: this.state.nutrients,
    });
  }

  /** Create/keep the solver; re-seed only when the physics inputs changed. */
  private ensureSim() {
    const D = this.worldDepth();
    const count = QUALITY_COUNTS[this.state.quality] ?? 2500;
    const key = `${this.state.depth}|${this.state.surfaceTemp}|${this.state.quality}|${this.state.measured ? 'm' : 's'}`;
    if (this.sim && this.simDepth === D && this.simCount === count && this.seedKey === key) return;
    const sim = new LakeSph({ count, radius: R, depth: D, rim: RIM });
    this.seedField(sim);
    this.sim = sim;
    this.simDepth = D;
    this.simCount = count;
    this.seedKey = key;
  }

  // ---- scene -----------------------------------------------------------------

  private clearGroup() {
    if (!this.group) return;
    this.three?.scene.remove(this.group);
    this.labels.dispose(); // detach + dispose label sprites/textures first
    this.group.traverse((obj) => {
      const o = obj as THREE.Mesh;
      o.geometry?.dispose?.();
      const m = (o as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose?.();
    });
    this.group = null;
    this.pointsGeo = null;
    this.pointsMat = null;
    this.sliceMesh = null;
    this.bloomMat = null;
    this.bloomMesh = null;
    this.bloomLabel = null;
  }

  private fitCamera() {
    if (!this.three) return;
    const D = this.worldDepth();
    const k = Math.max(1, D / 12);
    const cy = -D * 0.35;
    this.three.camera.position.set(2.4 * k, cy + 1.5 * k, 2.6 * k);
    this.three.camera.near = 0.01;
    this.three.camera.far = 500;
    this.three.camera.updateProjectionMatrix();
    this.three.camera.lookAt(0, cy, 0);
    this.three.controls.target.set(0, cy, 0);
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
    this.stopTick();
    this.clearGroup();
    this.ensureSim();
    this.buildScene();
    if (this.needsFit) {
      this.fitCamera();
      this.needsFit = false;
    }
    three.setVisible(true);
    this.drawPanel();
    this.api.reportDataScale(this.sim?.count ?? 0);
    this.lastT = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private buildScene() {
    const three = this.three;
    const sim = this.sim;
    if (!three || !sim) return;
    const D = this.worldDepth();
    const group = new THREE.Group();
    group.add(new THREE.AmbientLight(0x9fb4cc, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(2.2, 3.0, 1.4);
    group.add(sun);

    // Basin shell — translucent glass so the particle water body inside stays
    // visible from every angle. depthWrite off + fixed renderOrder keeps the
    // transparency compositing deterministic: bowl → slice → bloom → particles.
    const basin = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.02, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x8fb0c4,
        transparent: true,
        opacity: 0.22,
        roughness: 0.25,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    basin.scale.y = D / R;
    basin.renderOrder = 1;
    group.add(basin);

    // Shore ring so the waterline reads as a shoreline.
    const shore = new THREE.Mesh(
      new THREE.RingGeometry(R * 1.0, R * 1.18, 48),
      new THREE.MeshStandardMaterial({ color: 0x57624f, roughness: 1, side: THREE.DoubleSide }),
    );
    shore.rotation.x = -Math.PI / 2;
    shore.position.y = 0.005;
    group.add(shore);

    // Algal-bloom surface film — a thin translucent tint riding the mean
    // height of the surface particles (updated every frame in tick()).
    const bloom = new THREE.Mesh(
      new THREE.CircleGeometry(R, 48),
      new THREE.MeshStandardMaterial({
        color: 0x3f7d2c,
        transparent: true,
        opacity: bloomOpacity(this.state.nutrients),
        roughness: 0.6,
        depthWrite: false,
      }),
    );
    bloom.rotation.x = -Math.PI / 2;
    bloom.position.y = this.surfaceY + 0.006;
    bloom.renderOrder = 3;
    this.bloomMat = bloom.material as THREE.MeshStandardMaterial;
    this.bloomMesh = bloom;
    group.add(bloom);

    // Theory slice plane (vertex-coloured by the seeding profile). The plane
    // is clipped to the bowl cross-section (half-width follows the ellipsoid)
    // so it no longer pokes out of the glass as a wedge.
    const prof = this.seedingProfile();
    const sn = 40;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= sn; i += 1) {
      const p = prof[Math.min(prof.length - 1, Math.round((i / sn) * (prof.length - 1)))]!;
      const y = -(p.depth / this.state.depth) * D;
      const half = R * Math.sqrt(Math.max(0, 1 - (y * y) / (D * D)));
      positions.push(-half, y, 0, half, y, 0);
      const [r, g2, b] = envRampColor3((p.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN));
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
    const slice = new THREE.Mesh(
      sliceGeom,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    slice.renderOrder = 2;
    if (this.state.sliceAxis === 'z') slice.rotation.y = Math.PI / 2;
    slice.visible = this.state.showSlice;
    this.sliceMesh = slice;
    group.add(slice);

    // SPH particles: THREE.Points + soft-sprite temperature shader.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sim.pos, 3));
    geo.setAttribute('aTemp', new THREE.BufferAttribute(sim.temp, 1));
    geo.setAttribute('aNutrient', new THREE.BufferAttribute(sim.nutrient, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: 1.2 * sim.h },
        uScale: { value: 600 },
        uTempRange: { value: new THREE.Vector2(Math.min(TEMP_MIN, this.bottomTemp()), this.state.surfaceTemp + 0.5) },
      },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 10;
    this.pointsGeo = geo;
    this.pointsMat = mat;
    group.add(points);

    // Static bilingual annotations: camera-facing sprites anchored to scene
    // geometry (never to moving particles). depthTest off + renderOrder 20
    // keeps them readable on top of the translucent stack.
    const locale: 'zh-CN' | 'en-US' = isZh(this.api.locale) ? 'zh-CN' : 'en-US';
    // Waterline edge (diagonal anchor, slightly above the surface film).
    this.labels.add('湖面', 'Lake surface', locale, [R * 0.68, 0.14, R * 0.68], { font: 42 });
    // Sediment zone — above the bowl bottom, per teaching convention.
    this.labels.add('湖底沉积区', 'Sediment zone', locale, [0.34, -0.7 * D, 0.34], { font: 42 });
    // Thermocline anchor: depth of steepest temperature drop in the seeding
    // profile (the slice plane visualises exactly that gradient). A well-mixed
    // water column has no distinct thermocline — fall back to the bowl wall at
    // half depth.
    let thermFrac = 0.5;
    let bestGrad = 0;
    for (let i = 1; i < prof.length; i += 1) {
      const a = prof[i - 1]!;
      const b = prof[i]!;
      const grad = Math.abs(b.temp - a.temp) / Math.max(0.1, b.depth - a.depth);
      if (grad > bestGrad && grad >= 1.0) {
        bestGrad = grad;
        thermFrac = Math.min(0.85, Math.max(0.15, (0.5 * (a.depth + b.depth)) / this.state.depth));
      }
    }
    const rWall = R * Math.sqrt(Math.max(0.02, 1 - thermFrac * thermFrac));
    this.labels.add('温跃层', 'Thermocline', locale, [rWall * 0.72, -thermFrac * D, rWall * 0.5], { font: 42 });
    // Algal bloom annotation rides the bloom film's rim — visible only when
    // the nutrient load is non-zero (toggled live from updateParams).
    this.bloomLabel = this.labels.add('藻华（营养盐）', 'Algal bloom', locale, [R * 0.6, 0.2, -R * 0.6], { font: 42 });
    this.bloomLabel.visible = this.state.nutrients > 0;
    group.add(this.labels.group);

    this.group = group;
    three.scene.add(group);
  }

  private tick = (t: number) => {
    this.rafId = 0;
    const three = this.three;
    if (!three || !this.group || !this.sim) return;
    const dt = this.lastT ? Math.min(0.05, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    if (this.state.running && dt > 0) {
      const sub = 2;
      for (let s = 0; s < sub; s += 1) {
        this.sim.step(dt / sub, { wind: this.state.wind, nutrients: this.state.nutrients });
      }
      this.guardNaN(t);
    }
    // The bloom film rides the mean height of the above-waterline particles
    // so it stays glued to the actual water surface (never floats in mid-air).
    const s = this.sim;
    if (s) {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < s.count; i += 1) {
        const y = s.pos[i * 3 + 1]!;
        if (y > 0) {
          sum += y;
          n += 1;
        }
      }
      if (n > 0) this.surfaceY = sum / n;
    }
    if (this.bloomMesh) this.bloomMesh.position.y = this.surfaceY + 0.006;
    const geo = this.pointsGeo;
    if (geo) {
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('aTemp') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('aNutrient') as THREE.BufferAttribute).needsUpdate = true;
    }
    const mat = this.pointsMat;
    if (mat) {
      const el = three.renderer.domElement;
      const fovRad = (three.camera.fov * Math.PI) / 180;
      const uScale = mat.uniforms.uScale;
      if (uScale) uScale.value = (el.height || 800) / (2 * Math.tan(fovRad / 2));
    }
    three.controls.update?.();
    three.render();
    if (t - this.lastPanel > 250) {
      this.lastPanel = t;
      this.drawPanel();
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private stopTick() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.lastT = 0;
  }

  /** NaN guard: reset the particle state and warn (rate-limited). */
  private guardNaN(t: number) {
    const sim = this.sim;
    if (!sim) return;
    const hasNaN = (arr: Float32Array): boolean => {
      for (let i = 0; i < arr.length; i += 1) if (!Number.isFinite(arr[i]!)) return true;
      return false;
    };
    if (!hasNaN(sim.pos) && !hasNaN(sim.vel)) return;
    sim.reset();
    this.seedField(sim);
    if (t - this.lastNaNNotify > 5000) {
      this.lastNaNNotify = t;
      notify(this.api, 'warning', 'Solver instability detected — particles were reset.', '检测到求解器不稳定 — 粒子已重置。');
    }
  }

  // ---- 2-D science panel: T(z) / DO(z) comparison -----------------------------

  private drawPlot(
    g: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    w: number,
    h: number,
    xLabel: string,
    xMin: number,
    xMax: number,
    depthM: number,
    lines: PlotLine[],
    title: string,
  ) {
    g.strokeStyle = 'rgba(150,165,185,0.3)';
    g.lineWidth = 1;
    g.strokeRect(x0, y0, w, h);
    g.font = "10px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.textAlign = 'center';
    for (let k = 0; k <= 4; k += 1) {
      const xv = xMin + ((xMax - xMin) * k) / 4;
      g.fillText(String(Math.round(xv)), x0 + (w * k) / 4, y0 + h + 14);
    }
    g.fillText(xLabel, x0 + w / 2, y0 + h + 28);
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      g.fillText(((depthM * k) / 4).toFixed(0), x0 - 6, y0 + (h * k) / 4 + 4);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.9)';
    g.fillText(title, x0 + 6, y0 - 8);
    g.save();
    g.beginPath();
    g.rect(x0, y0, w, h);
    g.clip();
    const toX = (v: number) => x0 + (w * (Math.min(xMax, Math.max(xMin, v)) - xMin)) / (xMax - xMin);
    const toY = (d: number) => y0 + h * Math.min(1, Math.max(0, d / Math.max(depthM, 1e-6)));
    for (const line of lines) {
      if (line.pts.length < 2) continue;
      g.strokeStyle = line.color;
      g.lineWidth = line.width ?? 1.5;
      g.setLineDash(line.dash ?? []);
      g.beginPath();
      g.moveTo(toX(line.pts[0]![0]), toY(line.pts[0]![1]));
      for (let i = 1; i < line.pts.length; i += 1) g.lineTo(toX(line.pts[i]![0]), toY(line.pts[i]![1]));
      g.stroke();
    }
    g.setLineDash([]);
    g.restore();
  }

  private drawPanel() {
    const canvas = this.ctx?.canvas2d;
    const sim = this.sim;
    if (!canvas || !sim) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = isZh(this.api.locale);
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 460;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width;
    const H = canvas.height;

    g.textAlign = 'left';
    g.font = "13px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.fillText(zh ? `SPH 粒子流体 — ${sim.count} 粒子` : `SPH particle fluid — ${sim.count} particles`, 14, 22);
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.fillText(
      zh
        ? 'T(z) / DO(z) 剖面对比：模拟（粒子分箱）vs 理论 vs 实测'
        : 'T(z)/DO(z) profile: simulated (particle bins) vs theoretical vs measured',
      14,
      40,
    );
    g.textAlign = 'right';
    g.fillStyle = this.state.running ? 'rgba(126,200,227,0.95)' : 'rgba(230,180,90,0.95)';
    const runTxt = this.state.running ? (zh ? '运行中' : 'running') : zh ? '已暂停' : 'paused';
    g.fillText(
      `${runTxt} · ${zh ? '风速' : 'wind'} ${this.state.wind.toFixed(1)} m/s · ${zh ? '表层' : 'surf'} ${this.state.surfaceTemp.toFixed(1)}°C`,
      W - 14,
      22,
    );
    g.textAlign = 'left';

    const depthM = this.state.depth;
    const px0 = 56;
    const py0 = 62;
    const plotH = Math.max(80, H - py0 - 64);
    const plotW = Math.max(120, (W - px0 * 2 - 40) / 2);

    const simBins = profileBins(sim.pos, sim.temp, this.worldDepth(), depthM, N_BINS);
    const theory = lakeProfile(depthM, this.state.surfaceTemp, this.state.wind, this.state.nutrients);
    const measured = this.state.measured ? resampleProfile(this.state.measured.points, depthM) : null;
    const theoryStyle: Omit<PlotLine, 'pts'> = { color: 'rgba(183,197,216,0.85)', dash: [4, 3], width: 1.2 };
    const measuredStyle: Omit<PlotLine, 'pts'> = { color: 'rgba(79,195,247,0.95)', width: 1.6 };
    const simStyle: Omit<PlotLine, 'pts'> = { color: '#ff9e4a', width: 2.2 };

    const simT: Array<[number, number]> = [];
    const simDO: Array<[number, number]> = [];
    for (let b = 0; b < N_BINS; b += 1) {
      if ((simBins.count[b] ?? 0) <= 0) continue;
      simT.push([simBins.temp[b]!, simBins.depth[b]!]);
      simDO.push([simDoFromTemp(simBins.temp[b]!, simBins.depth[b]! / Math.max(depthM, 1e-6)), simBins.depth[b]!]);
    }
    const tLines: PlotLine[] = [
      { pts: theory.map((p) => [p.temp, p.depth] as [number, number]), ...theoryStyle },
    ];
    const doLines: PlotLine[] = [
      { pts: theory.map((p) => [p.do, p.depth] as [number, number]), ...theoryStyle },
    ];
    if (measured) {
      tLines.push({ pts: measured.map((p) => [p.temp, p.depth] as [number, number]), ...measuredStyle });
      doLines.push({ pts: measured.map((p) => [p.do, p.depth] as [number, number]), ...measuredStyle });
    }
    tLines.push({ pts: simT, ...simStyle });
    doLines.push({ pts: simDO, ...simStyle });

    this.drawPlot(g, px0, py0, plotW, plotH, zh ? '温度 T (°C)' : 'Temperature T (°C)', TEMP_MIN - 2, TEMP_MAX, depthM, tLines, 'T(z)');
    this.drawPlot(
      g,
      px0 + plotW + 40,
      py0,
      plotW,
      plotH,
      zh ? '溶解氧 DO (mg/L)' : 'Dissolved O₂ (mg/L)',
      0,
      14,
      depthM,
      doLines,
      'DO(z)',
    );

    let lx = px0;
    const ly = H - 30;
    const legend: Array<[string, string]> = [
      ['#ff9e4a', zh ? '模拟（粒子分箱）' : 'Simulated (bins)'],
      ['rgba(183,197,216,0.85)', zh ? '理论 lakeProfile' : 'Theoretical'],
    ];
    if (measured) legend.push(['rgba(79,195,247,0.95)', zh ? '实测 CSV' : 'Measured CSV']);
    for (const [color, label] of legend) {
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(lx, ly);
      g.lineTo(lx + 18, ly);
      g.stroke();
      g.fillStyle = 'rgba(200,212,228,0.95)';
      g.fillText(label, lx + 24, ly + 4);
      lx += 24 + g.measureText(label).width + 18;
    }
    g.fillStyle = 'rgba(120,132,150,0.9)';
    g.fillText(
      zh
        ? 'DO(z) 由模拟温度按饱和经验式推导 — 教学近似'
        : 'DO(z) derived from simulated T via a saturation formula — teaching approximation',
      lx + 6,
      ly + 4,
    );
  }
}

export default function createLake3DPlugin(): Plugin {
  return new Lake3DPlugin();
}
