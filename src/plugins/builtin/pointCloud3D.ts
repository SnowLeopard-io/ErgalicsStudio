// ==========================================================================
// Example plugin: 3D Point Cloud Viewer (spec §3.2.3 — three container)
//
// Demonstrates the host-managed Three.js scene: loads .xyz / .dat point
// clouds, renders them as THREE.Points in the host scene, supports height
// coloring, adjustable point size, and auto-fits the camera to the data.
// Falls back to a 2D hint when the three container is unavailable.
// ==========================================================================

import * as THREE from 'three';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  Scene3DHandle,
} from '@/types/plugin';
import { actionButton, exportRowsCsv, exportSnapshotPng } from './shared/enhance';

export const pointCloud3DManifest: PluginManifest = {
  id: 'example.point-cloud-3d',
  name: 'Point Cloud 3D',
  nameI18n: { 'zh-CN': '3D 点云', 'en-US': 'Point Cloud 3D' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Interactive 3D point clouds in the host Three.js scene.',
  descriptionI18n: {
    'zh-CN': '基于宿主 Three.js 场景的交互式 3D 点云渲染，支持高度着色与自适应视野。',
    'en-US': 'Interactive 3D point clouds rendered in the host Three.js scene with height coloring and auto-fit.',
  },
  license: 'MIT',
  entry: 'example.point-cloud-3d',
  formats: [
    { extension: '.xyz', mimeTypes: ['text/plain', 'chemical/x-xyz'], description: '3D point cloud' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: '3D point cloud' },
  ],
};

const MAX_RENDERED_POINTS = 150_000;

interface State {
  count: number;
  size: number;
  colorMode: 'solid' | 'height';
  hasData: boolean;
}

interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export class PointCloud3DPlugin implements Plugin {
  readonly manifest = pointCloud3DManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private positions = new Float32Array(0);
  private pointsMesh: THREE.Points | null = null;
  private state: State = { count: 0, size: 0.02, colorMode: 'height', hasData: false };

  async init(api: PluginApi) {
    this.api = api;
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

  /** Explicit entry point used by plugins that prefer the scene API. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    // Buttons accept both the host's `{ key: { action } }` emission and a
    // plain `{ key: true }` call. They never touch the render state.
    const fired = (key: string): boolean => {
      const v = params[key];
      return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
    };
    if (fired('exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot() ?? null, 'pointcloud3d');
      return;
    }
    if (fired('exportCsv')) {
      this.exportCsv();
      return;
    }
    if (typeof params.size === 'number' && params.size !== this.state.size) {
      this.state.size = params.size;
      this.rebuildMesh();
    }
    if (params.colorMode === 'solid' || params.colorMode === 'height') {
      if (params.colorMode !== this.state.colorMode) {
        this.state.colorMode = params.colorMode;
        this.rebuildMesh();
      }
    }
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'size', label: 'Point Size', type: 'range', min: 0.005, max: 0.1, step: 0.005, value: this.state.size },
      {
        key: 'colorMode',
        label: 'Color',
        type: 'select',
        options: [
          { value: 'height', label: 'By height', labelI18n: { 'zh-CN': '按高度', 'en-US': 'By height' } },
          { value: 'solid', label: 'Solid', labelI18n: { 'zh-CN': '单色', 'en-US': 'Solid' } },
        ],
        value: this.state.colorMode,
      },
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportCsv', 'Export Points CSV', '导出点云 CSV'),
    ];
  }

  /** Export the loaded points (x, y, z) as CSV. */
  private exportCsv() {
    const n = this.state.count;
    const rows: number[][] = [];
    for (let i = 0; i < n; i += 1) {
      rows.push([
        this.positions[i * 3]!,
        this.positions[i * 3 + 1]!,
        this.positions[i * 3 + 2]!,
      ]);
    }
    exportRowsCsv(this.api, 'pointcloud3d', ['x', 'y', 'z'], rows);
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const { positions, count } = this.parse(text);
    this.positions = positions;
    this.state.count = count;
    this.state.hasData = count > 0;
    this.api.reportDataScale(count);
    if (count === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? `未能从 ${file.name} 解析出任何坐标点（支持 "x y z" 或标准 XYZ "元素 x y z" 格式）`
          : `Parsed 0 points from ${file.name} (expected "x y z" rows or standard XYZ "element x y z" rows)`,
      );
    }
    this.rebuildMesh();
    this.fitCamera();
    this.draw();
  }

  /**
   * Parse coordinate rows in two dialects: "x y z [more…]" (whitespace or
   * comma separated) or standard XYZ molecular rows "Element x y z", where
   * the first token is an element symbol. The XYZ header (a lone atom
   * count) and comment line carry no three finite coordinates and are
   * skipped automatically.
   */
  private parse(text: string): { positions: Float32Array; count: number } {
    const out: number[] = [];
    let limit = MAX_RENDERED_POINTS;
    for (const line of text.split(/\r?\n/)) {
      if (out.length / 3 >= MAX_RENDERED_POINTS) break;
      const parts = line.trim().split(/[\s,]+/).filter(Boolean);
      if (parts.length < 3) continue;
      let x = Number.NaN;
      let y = Number.NaN;
      let z = Number.NaN;
      const first = parseFloat(parts[0] ?? '');
      if (Number.isFinite(first)) {
        x = first;
        y = parseFloat(parts[1] ?? '');
        z = parseFloat(parts[2] ?? '');
      } else if (parts.length >= 4) {
        // "Element x y z" — skip the symbol column.
        x = parseFloat(parts[1] ?? '');
        y = parseFloat(parts[2] ?? '');
        z = parseFloat(parts[3] ?? '');
      }
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        out.push(x, y, z);
        limit -= 1;
        if (limit <= 0) break;
      }
    }
    return { positions: new Float32Array(out), count: out.length / 3 };
  }

  private bounds(): Bounds | null {
    const n = this.state.count;
    if (n === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const x = this.positions[i * 3] ?? 0;
      const y = this.positions[i * 3 + 1] ?? 0;
      const z = this.positions[i * 3 + 2] ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }

  /** Height ramp: deep teal → bright amber. */
  private heightColors(bounds: Bounds): Float32Array {
    const n = this.state.count;
    const colors = new Float32Array(n * 3);
    const span = Math.max(bounds.maxZ - bounds.minZ, 1e-9);
    const low = new THREE.Color('#0d9488');
    const mid = new THREE.Color('#22d3ee');
    const high = new THREE.Color('#fbbf24');
    for (let i = 0; i < n; i += 1) {
      const t = ((this.positions[i * 3 + 2] ?? 0) - bounds.minZ) / span;
      const c = t < 0.5 ? low.clone().lerp(mid, t * 2) : mid.clone().lerp(high, (t - 0.5) * 2);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return colors;
  }

  private clearMesh() {
    if (!this.pointsMesh) return;
    this.three?.scene.remove(this.pointsMesh);
    this.pointsMesh.geometry.dispose();
    (this.pointsMesh.material as THREE.Material).dispose();
    this.pointsMesh = null;
  }

  private rebuildMesh() {
    if (!this.three) return;
    this.clearMesh();
    if (this.state.count === 0) return;

    const bounds = this.bounds();
    if (!bounds) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    const useHeightColors = this.state.colorMode === 'height';
    if (useHeightColors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(this.heightColors(bounds), 3));
    }

    const material = new THREE.PointsMaterial({
      size: this.state.size,
      sizeAttenuation: true,
      vertexColors: useHeightColors,
      color: useHeightColors ? undefined : new THREE.Color('#2dd4bf'),
    });

    this.pointsMesh = new THREE.Points(geometry, material);
    this.three.scene.add(this.pointsMesh);
    this.three.render();
  }

  /** Move the host camera so the loaded cloud fills the view. */
  private fitCamera() {
    if (!this.three) return;
    const bounds = this.bounds();
    if (!bounds) {
      this.three.render();
      return;
    }
    const { camera, controls } = this.three;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const radius = Math.max(
      Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2,
      1e-3,
    );
    controls.target.set(cx, cy, cz);
    const dist = radius * 2.6 + 1;
    camera.position.set(cx + dist * 0.75, cy + dist * 0.55, cz + dist);
    camera.near = Math.max(radius / 100, 1e-4);
    camera.far = Math.max(radius * 200, 100);
    camera.updateProjectionMatrix();
    controls.update();
    this.three.render();
  }

  private draw() {
    if (this.three) {
      if (this.state.count > 0 && !this.pointsMesh) this.rebuildMesh();
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
    const msg =
      this.api.locale === 'zh-CN'
        ? '3D 容器不可用，请使用支持 WebGL 的浏览器'
        : '3D container unavailable — use a WebGL-capable browser';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

export default function createPointCloud3DPlugin(): Plugin {
  return new PointCloud3DPlugin();
}
