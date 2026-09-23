// ==========================================================================
// Example plugin: Interactive Globe (3D)
//
// The 2D projection suite answers "how does a flat map lie?" — this plugin
// shows the honest reference: the sphere itself. Natural Earth 110m
// coastlines and a graticule are draped on a Three.js globe inside the
// host's Scene3DHandle (drag to spin / scroll to zoom through the bundled
// Orbit controls), with spherical Tissot indicatrices overlaid so students
// can connect every distorted ellipse on a flat map back to the true small
// circle it came from. Optional auto-rotation keeps the view alive.
//
// Pure math helpers (lon/lat → xyz, angular distance, camera fitting) are
// exported for unit tests; all Three.js objects are built lazily and
// disposed with the plugin. No render loop of our own until the scene is
// active — the rAF tick is cancelled on deactivate/destroy.
// ==========================================================================

import * as THREE from 'three';
import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { actionButton, actionFired, exportSnapshotPng, notify } from '../shared/enhance';
import { tissotCircle } from './tissot';
import { globeManifest } from './globeManifest';
import WORLD_LAND_RAW from '../../../../examples/data/geo-world-110m-land.json?raw';

export { globeManifest } from './globeManifest';

// ---- Sphere math (exported for tests) --------------------------------------

/** lon/lat (degrees) → position on a sphere of `radius`, Three.js Y-up:
 * the north pole is +Y and λ = 0 faces +X (λ = 90°E faces −Z). Pure. */
export function lonLatToVec3(lon: number, lat: number, radius = 1): [number, number, number] {
  const φ = (lat * Math.PI) / 180;
  const λ = (lon * Math.PI) / 180;
  return [radius * Math.cos(φ) * Math.cos(λ), radius * Math.sin(φ), -radius * Math.cos(φ) * Math.sin(λ)];
}

/** Great-circle angular distance between two (lon, lat) points, radians.
 * Uses 2·asin(‖a−b‖/2) rather than acos(a·b): acos loses half its digits
 * near dot = 1 (identical points come back as ~1.5e-8 rad), while asin is
 * accurate at both ends of the range. */
export function angularDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const a = lonLatToVec3(lon1, lat1);
  const b = lonLatToVec3(lon2, lat2);
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return 2 * Math.asin(Math.min(1, Math.hypot(dx, dy, dz) / 2));
}

export interface GlobeRing {
  pts: Array<[number, number]>; // (lon, lat)
}

function extractRings(geo: unknown): GlobeRing[] {
  const rings: GlobeRing[] = [];
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

// ---- Line builders (Three.js objects) --------------------------------------

const SEG_MAT = (): THREE.LineBasicMaterial =>
  new THREE.LineBasicMaterial({ color: 0x96a8be, transparent: true, opacity: 0.9 });

/** Flat vertex-pair array for LineSegments: consecutive (lon, lat) points are
 * joined only when their great-circle step is short — GeoJSON rings that
 * jump the antimeridian (λ 179 → −179) would otherwise draw a chord
 * straight through the globe. */
function ringToSegments(ring: GlobeRing, radius: number, maxStepRad: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < ring.pts.length; i += 1) {
    const [lon1, lat1] = ring.pts[i]!;
    const [lon2, lat2] = ring.pts[i + 1]!;
    if (angularDistance(lon1, lat1, lon2, lat2) > maxStepRad) continue;
    const a = lonLatToVec3(lon1, lat1, radius);
    const b = lonLatToVec3(lon2, lat2, radius);
    out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  return out;
}

function segmentsGeometry(flat: number[]): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  return geom;
}

function graticuleSegments(radius: number): number[] {
  const out: number[] = [];
  const push = (lon1: number, lat1: number, lon2: number, lat2: number) => {
    const a = lonLatToVec3(lon1, lat1, radius);
    const b = lonLatToVec3(lon2, lat2, radius);
    out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  };
  for (let lat = -80; lat <= 80; lat += 20) {
    for (let lon = -180; lon < 180; lon += 4) push(lon, lat, lon + 4, lat);
  }
  for (let lon = -180; lon < 180; lon += 20) {
    for (let lat = -90; lat < 90; lat += 4) push(lon, lat, lon, lat + 4);
  }
  return out;
}

/** Spherical Tissot indicatrices as small closed circles on the sphere. */
function tissotLineLoops(spacing: number, epsDeg: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xff9e64, transparent: true, opacity: 0.95 });
  for (let lat = -60; lat <= 60 + 1e-9; lat += spacing) {
    for (let lon = -180; lon <= 180 - spacing + 1e-9; lon += spacing) {
      const pts = tissotCircle(lat, lon, epsDeg, 32).map(
        ([lo, la]) => new THREE.Vector3(...lonLatToVec3(lo, la, radius)),
      );
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
  }
  return group;
}

/** Move the host camera so the unit globe fills the view nicely. */
export function fitGlobeCamera(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update?: () => void },
): void {
  camera.position.set(0, 0.9, 3.1);
  camera.near = 0.01;
  camera.far = 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update?.();
}

// ---- Scene assembly --------------------------------------------------------

interface GlobeOpts {
  showCoast: boolean;
  showTissot: boolean;
  spacing: number;
  circleSize: number;
}

export function buildGlobeGroup(rings: GlobeRing[], opts: GlobeOpts): THREE.Group {
  const root = new THREE.Group();
  const R = 1;

  // Lights (part of the group, so they leave with it).
  root.add(new THREE.AmbientLight(0x8899aa, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2.5, 1.6, 2.2);
  root.add(sun);

  // Ocean sphere.
  const ocean = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.996, 64, 48),
    new THREE.MeshPhongMaterial({ color: 0x0d2b45, transparent: true, opacity: 0.94, shininess: 16 }),
  );
  root.add(ocean);

  // Graticule.
  root.add(new THREE.LineSegments(segmentsGeometry(graticuleSegments(R)), SEG_MAT()));

  // Coastlines.
  if (opts.showCoast) {
    const coast: number[] = [];
    for (const ring of rings) coast.push(...ringToSegments(ring, R, 0.2));
    if (coast.length > 0) root.add(new THREE.LineSegments(segmentsGeometry(coast), SEG_MAT()));
  }

  // Tissot indicatrices.
  if (opts.showTissot) root.add(tissotLineLoops(opts.spacing, opts.circleSize, R * 1.002));

  return root;
}

// ---- Plugin ----------------------------------------------------------------

interface GlobeState extends GlobeOpts {
  spin: boolean;
  rings: GlobeRing[];
}

export class GlobePlugin implements Plugin {
  readonly manifest = globeManifest;
  private api!: PluginApi;
  private three: Scene3DHandle | null = null;
  private group: THREE.Group | null = null;
  private rafId = 0;
  private lastT = 0;
  private state: GlobeState = {
    showCoast: true,
    showTissot: true,
    spacing: 30,
    circleSize: 8,
    spin: true,
    rings: extractRings(JSON.parse(WORLD_LAND_RAW) as unknown),
  };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stopTick();
    this.clearGroup();
    this.three?.setVisible(false);
    this.three = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.three = context.container.three ?? null;
    this.ensureScene();
  }

  /** Host-driven 3D wiring: the studio only materializes the WebGL scene for
   * plugins that declare this method, then hands over the shared handle. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.ensureScene();
  }

  async deactivate() {
    this.stopTick();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    if (container.three) this.three = container.three;
    this.ensureScene();
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot(), 'geo-globe');
      return;
    }
    if (actionFired(params, 'fitView')) {
      if (this.three) fitGlobeCamera(this.three.camera, this.three.controls);
      this.three?.render();
      return;
    }
    let rebuild = false;
    if (typeof params.showCoast === 'boolean') {
      this.state.showCoast = params.showCoast;
      rebuild = true;
    }
    if (typeof params.showTissot === 'boolean') {
      this.state.showTissot = params.showTissot;
      rebuild = true;
    }
    const sp = Number(params.spacing);
    if (params.spacing !== undefined && (sp === 15 || sp === 30)) {
      this.state.spacing = sp;
      rebuild = true;
    }
    if (typeof params.circleSize === 'number') {
      this.state.circleSize = Math.max(2, Math.min(12, params.circleSize));
      rebuild = true;
    }
    if (typeof params.spin === 'boolean') {
      this.state.spin = params.spin;
    }
    if (rebuild) this.ensureScene();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'showCoast',
        label: 'Show coastlines',
        labelI18n: { 'zh-CN': '显示海岸线', 'en-US': 'Show coastlines' },
        type: 'checkbox',
        value: this.state.showCoast,
      },
      {
        key: 'showTissot',
        label: 'Show Tissot circles',
        labelI18n: { 'zh-CN': '显示 Tissot 变形圆', 'en-US': 'Show Tissot circles' },
        type: 'checkbox',
        value: this.state.showTissot,
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
        key: 'spin',
        label: 'Auto-rotate',
        labelI18n: { 'zh-CN': '自动自转', 'en-US': 'Auto-rotate' },
        type: 'checkbox',
        value: this.state.spin,
      },
      actionButton('fitView', 'Fit view', '重置视角'),
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
      notify(this.api, 'success', `Draped ${rings.length} rings on the globe`, `已加载 ${rings.length} 个环`);
      this.ensureScene();
    } catch {
      notify(this.api, 'warning', 'Expected a GeoJSON Polygon/MultiPolygon', '需要 GeoJSON Polygon/MultiPolygon 数据');
    }
  }

  // ---- scene plumbing ------------------------------------------------------

  private ensureScene() {
    const three = this.three;
    if (!three) return;
    this.stopTick();
    this.clearGroup();
    this.group = buildGlobeGroup(this.state.rings, this.state);
    three.scene.add(this.group);
    fitGlobeCamera(three.camera, three.controls);
    three.setVisible(true);
    three.render();
    this.lastT = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (t: number) => {
    this.rafId = 0;
    const three = this.three;
    if (!three || !this.group) return;
    const dt = this.lastT ? (t - this.lastT) / 1000 : 0;
    this.lastT = t;
    if (this.state.spin) this.group.rotation.y += dt * 0.22; // rad/s
    three.controls.update?.();
    three.render();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private stopTick() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.lastT = 0;
  }

  private clearGroup() {
    if (!this.group) return;
    this.group.parent?.remove(this.group);
    this.group.traverse((obj) => {
      const withGeo = obj as THREE.Mesh;
      withGeo.geometry?.dispose();
      const mat = (withGeo as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.group = null;
  }
}

export default function createGlobePlugin(): Plugin {
  return new GlobePlugin();
}
