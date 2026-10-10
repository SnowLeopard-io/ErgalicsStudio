// ==========================================================================
// Example plugin: 3-D global environment
//
// Teaching-approximate environmental layers on a globe: surface CO₂ (a
// latitudinal gradient plus the seasonal biosphere "breathing" cycle driven
// by the month slider), surface albedo, and major surface-current arrows.
// Coastlines reuse the same Natural Earth 110m land GeoJSON as the geo
// globe. The sphere colours are rebuilt per layer/month while the camera
// pose is preserved. Built-in approximations only — no external data.
// ==========================================================================

import * as THREE from 'three';
import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { envRampColor3, surfaceAlbedo, surfaceCo2 } from './envCore';
import { actionButton, actionFired, exportSnapshotPng, notify } from '@/core/plugin-tools/enhance';
import { isZh } from '@/core/plugin-tools/locale';
import { angularDistance, lonLatToVec3 } from '@/core/geo/spherical';
import { earth3dManifest } from './earth3dManifest';
import WORLD_LAND_RAW from '../../../../examples/data/geo-world-110m-land.json?raw';

type Layer = 'co2' | 'albedo' | 'currents';

// ---- GeoJSON rings (local minimal extraction; globe.ts keeps its own) -------

interface Ring {
  pts: Array<[number, number]>;
}

function extractRings(geo: unknown): Ring[] {
  const rings: Ring[] = [];
  const walk = (geom: { type?: string; coordinates?: unknown; geometries?: unknown }) => {
    if (!geom || typeof geom !== 'object') return;
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
      for (const ring of geom.coordinates as number[][][]) rings.push({ pts: ring.map((p) => [p[0]!, p[1]!] as [number, number]) });
    } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      for (const poly of geom.coordinates as number[][][][]) for (const ring of poly) rings.push({ pts: ring.map((p) => [p[0]!, p[1]!] as [number, number]) });
    } else if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
      for (const g of geom.geometries) walk(g as typeof geom);
    }
  };
  const root = geo as { type?: string; geometry?: unknown; features?: Array<{ geometry?: unknown }> };
  if (root?.type === 'FeatureCollection' && Array.isArray(root.features)) {
    for (const f of root.features) walk(f?.geometry as { type?: string; coordinates?: unknown });
  } else walk(root);
  return rings;
}

/** Major teaching surface currents: [lon1, lat1, lon2, lat2] arrow segments. */
const CURRENT_ARROWS: Array<[number, number, number, number]> = [
  // Gulf Stream / North Atlantic drift
  [-80, 26, -60, 36],
  [-60, 36, -30, 46],
  [-30, 46, -5, 55],
  // Kuroshio
  [130, 24, 145, 32],
  [145, 32, 165, 38],
  // North Equatorial (westward)
  [-120, 14, -100, 14],
  [-40, 12, -20, 12],
  [110, 12, 130, 12],
  // Humboldt / Peru
  [-78, -8, -74, -22],
  [-74, -22, -72, -36],
  // Benguela
  [16, -32, 12, -18],
  // Antarctic Circumpolar
  [-60, -55, 0, -56],
  [0, -56, 60, -56],
  [120, -55, 180, -55],
  // Agulhas
  [42, -20, 32, -33],
  // East Australian
  [152, -28, 156, -38],
];

// ---- Plugin ----------------------------------------------------------------

interface State {
  layer: Layer;
  month: number; // 1–12
  showLegend: boolean;
}

const DEFAULTS: State = { layer: 'co2', month: 1, showLegend: true };

export class Earth3DPlugin implements Plugin {
  readonly manifest = earth3dManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private group: THREE.Group | null = null;
  /** Fit the camera only on first show / re-activation — never yank it back
   * while the user is orbiting or dragging parameter sliders. */
  private needsFit = true;
  private state: State = { ...DEFAULTS };
  private rings: Ring[] = [];

  async init(api: PluginApi) {
    this.api = api;
    try {
      this.rings = extractRings(JSON.parse(WORLD_LAND_RAW) as unknown);
    } catch {
      this.rings = [];
    }
  }

  async destroy() {
    this.clearGroup();
    this.three = null;
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.needsFit = true;
    this.rebuild();
  }

  async deactivate() {
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
        key: 'layer',
        label: 'Layer',
        labelI18n: { 'zh-CN': '图层', 'en-US': 'Layer' },
        type: 'select',
        value: this.state.layer,
        options: [
          { value: 'co2', label: zh ? 'CO₂ 浓度' : 'CO₂', labelI18n: { 'zh-CN': 'CO₂ 浓度', 'en-US': 'CO₂' } },
          { value: 'albedo', label: zh ? '反照率' : 'Albedo', labelI18n: { 'zh-CN': '反照率', 'en-US': 'Albedo' } },
          { value: 'currents', label: zh ? '洋流' : 'Currents', labelI18n: { 'zh-CN': '洋流', 'en-US': 'Currents' } },
        ],
      },
      { key: 'month', label: 'Month', labelI18n: { 'zh-CN': '月份', 'en-US': 'Month' }, type: 'range', min: 1, max: 12, step: 1, value: this.state.month },
      { key: 'showLegend', label: 'Show colour legend', labelI18n: { 'zh-CN': '显示色标', 'en-US': 'Show colour legend' }, type: 'checkbox', value: this.state.showLegend },
      { key: 'reset', label: 'Reset to defaults', labelI18n: { 'zh-CN': '回到初始参数', 'en-US': 'Reset to defaults' }, type: 'button', action: 'reset' },
      actionButton('fitView', 'Fit view', '重置视角'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportPngTransparent', 'Snapshot PNG (transparent)', '快照 PNG（透明）'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot() ?? null, 'env-earth3d');
      return;
    }
    if (actionFired(params, 'exportPngTransparent')) {
      exportSnapshotPng(this.api, this.three?.snapshot({ transparent: true }) ?? null, 'env-earth3d');
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
    if ((params.layer === 'co2' || params.layer === 'albedo' || params.layer === 'currents') && params.layer !== this.state.layer) {
      this.state.layer = params.layer;
      rebuild = true; // camera pose preserved — no fitCamera on layer switch
    }
    if (typeof params.month === 'number' && params.month !== this.state.month) {
      this.state.month = Math.round(Math.min(12, Math.max(1, params.month)));
      rebuild = true;
    }
    if (typeof params.showLegend === 'boolean' && params.showLegend !== this.state.showLegend) {
      this.state.showLegend = params.showLegend;
      this.drawLegend();
      return;
    }
    if (rebuild) this.rebuild();
  }

  // ---- scene ---------------------------------------------------------------

  private clearGroup() {
    if (!this.group) return;
    this.three?.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
        obj.geometry?.dispose?.();
        const m = obj.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose?.();
      }
    });
    this.group = null;
  }

  private fitCamera() {
    if (!this.three) return;
    this.three.camera.position.set(0, 0.7, 2.9);
    this.three.camera.lookAt(0, 0, 0);
    this.three.controls.update?.();
    this.three.render();
  }

  /** Vertex colour per lat/lon for the active scalar layer. */
  private layerColor(latDeg: number, _lonDeg: number): [number, number, number] {
    if (this.state.layer === 'albedo') {
      const a = surfaceAlbedo(latDeg);
      const [r, g2, b] = envRampColor3(1 - a / 0.8); // high albedo → cold colours
      return [r, g2, b];
    }
    const co2 = surfaceCo2(latDeg, this.state.month);
    // 410–440 ppm window for the teaching ramp.
    const [r, g2, b] = envRampColor3((co2 - 405) / 35);
    return [r, g2, b];
  }

  private rebuild() {
    const three = this.three;
    if (!three) return;
    this.clearGroup();
    const group = new THREE.Group();
    group.add(new THREE.AmbientLight(0x8899aa, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(2.5, 1.6, 2.2);
    group.add(sun);

    const R = 1;

    // Data sphere with vertex colours from the active layer.
    const geo = new THREE.SphereGeometry(R * 0.998, 72, 48);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      const lat = (Math.asin(Math.min(1, Math.max(-1, v.y / (R * 0.998)))) * 180) / Math.PI;
      const lon = (Math.atan2(-v.z, v.x) * 180) / Math.PI;
      const [r, g2, b] = this.layerColor(lat, lon);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g2;
      colors[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const sphere = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
    group.add(sphere);

    // Coastlines (same 110m land set as the geo globe).
    const coast: number[] = [];
    for (const ring of this.rings) {
      for (let i = 0; i + 1 < ring.pts.length; i += 1) {
        const [lon1, lat1] = ring.pts[i]!;
        const [lon2, lat2] = ring.pts[i + 1]!;
        if (angularDistance(lon1, lat1, lon2, lat2) > 0.2) continue;
        const a = lonLatToVec3(lon1, lat1, R * 1.002);
        const b = lonLatToVec3(lon2, lat2, R * 1.002);
        coast.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    }
    if (coast.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(coast, 3));
      group.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0x96a8be, transparent: true, opacity: 0.85 })));
    }

    // Current arrows (visible only in the currents layer).
    if (this.state.layer === 'currents') {
      const arrowMat = new THREE.LineBasicMaterial({ color: 0x7ec8e3, transparent: true, opacity: 0.95 });
      for (const [lon1, lat1, lon2, lat2] of CURRENT_ARROWS) {
        const a = lonLatToVec3(lon1, lat1, R * 1.012);
        const b = lonLatToVec3(lon2, lat2, R * 1.012);
        const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const len = dir.length();
        if (len < 1e-6) continue;
        dir.normalize();
        const origin = new THREE.Vector3(a[0], a[1], a[2]);
        const arrow = new THREE.ArrowHelper(dir, origin, Math.min(len * 0.8, 0.16), 0x7ec8e3, 0.05, 0.025);
        // Swap the ArrowHelper's line material for the shared one.
        (arrow.line as THREE.Line).material = arrowMat;
        (arrow.cone as THREE.Mesh).material = arrowMat;
        group.add(arrow);
      }
    }

    this.group = group;
    three.scene.add(group);
    if (this.needsFit) {
      this.fitCamera();
      this.needsFit = false;
    }
    three.setVisible(true);
    this.drawLegend();
    three.render();
  }

  /** 2-D legend rendered onto the canvas overlay (when a 2-D canvas exists). */
  private drawLegend() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = isZh(this.api.locale);
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 460;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    const layerName = { co2: zh ? 'CO₂ 浓度' : 'CO₂', albedo: zh ? '反照率' : 'Albedo', currents: zh ? '洋流' : 'Currents' }[this.state.layer];
    g.fillText(zh ? `3D 全球环境 — ${layerName}（${this.state.month} 月）` : `Global environment — ${layerName} (month ${this.state.month})`, 16, 24);
    g.fillStyle = 'rgba(230, 180, 90, 0.95)';
    g.fillText(
      zh ? '示意性展示，非观测数据产品' : 'Illustrative display — not an observational data product',
      16,
      42,
    );
    if (!this.state.showLegend) return;
    if (this.state.layer === 'currents') {
      g.fillStyle = 'rgba(126, 200, 227, 0.95)';
      g.fillText(zh ? '青色箭头：主要表层洋流方向（教学示意）' : 'Cyan arrows: major surface currents (teaching)', 16, 64);
      return;
    }
    const lgW = 160;
    const lx = 16;
    const ly = canvas.height - 34;
    for (let i = 0; i < lgW; i += 1) {
      const [r, g2, b] = envRampColor3(i / (lgW - 1));
      g.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g2 * 255)},${Math.round(b * 255)})`;
      g.fillRect(lx + i, ly, 1, 10);
    }
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    if (this.state.layer === 'co2') {
      g.fillText('405', lx, ly - 4);
      g.fillText('440 ppm', lx + lgW - 30, ly - 4);
    } else {
      g.fillText('0.8', lx, ly - 4);
      g.fillText('0.1', lx + lgW - 18, ly - 4);
    }
  }
}

export default function createEarth3DPlugin(): Plugin {
  return new Earth3DPlugin();
}
