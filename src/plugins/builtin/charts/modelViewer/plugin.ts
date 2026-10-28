// ==========================================================================
// Example plugin: 3D Model Viewer
// Loads GLB / GLTF / STL / OBJ / PLY models into the host Three.js scene.
// View modes (shaded / wireframe / normals / X-ray), axis clipping planes,
// glTF animation playback, two-point distance measurement, camera view
// presets, and model statistics.
// ==========================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  Scene3DHandle,
} from '@/types/plugin';
import { disposeObjectTree, fitCameraToObject } from '@/core/three-utils';

export { modelViewerManifest } from './manifest';
import { modelViewerManifest } from './manifest';

type ViewMode = 'shaded' | 'wireframe' | 'normal' | 'xray';
type ClipAxis = 'x' | 'y' | 'z';
type ViewPreset = 'fit' | 'front' | 'top' | 'side';

interface ModelStats {
  meshes: number;
  triangles: number;
  vertices: number;
}

interface State {
  loaded: boolean;
  filename: string;
  viewMode: ViewMode;
  clip: boolean;
  clipAxis: ClipAxis;
  /** Clip position along the axis, 0..1 across the model bbox. */
  clipPos: number;
  autoRotate: boolean;
  view: ViewPreset;
  animation: string;
  playing: boolean;
  measure: boolean;
}

const zh = (api: PluginApi) => api.locale === 'zh-CN';

/**
 * Some GLB writers pad the JSON chunk with NUL bytes; the glTF 2.0 spec
 * mandates spaces (0x20), and GLTFLoader's JSON.parse rejects NULs with
 * "Unexpected non-whitespace character after JSON". Walk the chunk list and
 * rewrite NUL padding inside JSON chunks to spaces — copy-on-write, so
 * well-formed files keep the original buffer untouched.
 */
function sanitizeGlbPadding(buffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return buffer; // 'glTF'
  const fixed = new Uint8Array(buffer.slice(0));
  let off = 12;
  let changed = false;
  while (off + 8 <= fixed.length) {
    const len = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    const start = off + 8;
    if (start + len > fixed.length) break; // truncated chunk list — leave as-is
    if (type === 0x4e4f534a) {
      // 'JSON': NULs can only be padding here (payload is UTF-8 text).
      for (let i = start; i < start + len; i += 1) {
        if (fixed[i] === 0) {
          fixed[i] = 0x20;
          changed = true;
        }
      }
    }
    off = start + len;
  }
  return changed ? fixed.buffer : buffer;
}

export class ModelViewerPlugin implements Plugin {
  readonly manifest = modelViewerManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  /** Host-managed Three.js scene handle (populated via renderToScene). */
  private three: Scene3DHandle | null = null;
  private state: State = {
    loaded: false,
    filename: '',
    viewMode: 'shaded',
    clip: false,
    clipAxis: 'x',
    clipPos: 0.5,
    autoRotate: false,
    view: 'fit',
    animation: '',
    playing: true,
    measure: false,
  };
  /** Monotonic token: a slow parse must not clobber a newer loadData. */
  private loadSeq = 0;
  private group: THREE.Group | null = null;
  private bbox = new THREE.Box3();
  /** Mesh → material loaded with the file (never disposed by view modes). */
  private originals = new Map<THREE.Mesh, THREE.Material>();
  /** View-mode clone materials owned by the plugin (disposed on change). */
  private modeMaterials = new Set<THREE.Material>();
  private normalMaterial: THREE.MeshNormalMaterial | null = null;
  private clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  // Animation
  private mixer: THREE.AnimationMixer | null = null;
  private clips: THREE.AnimationClip[] = [];
  private action: THREE.AnimationAction | null = null;
  private animRaf = 0;
  private animLast = 0;
  // Measurement
  private measureGroup: THREE.Group | null = null;
  private measurePoints: THREE.Vector3[] = [];
  private raycaster = new THREE.Raycaster();
  private onPointerDown: ((e: PointerEvent) => void) | null = null;
  private onPointerUp: ((e: PointerEvent) => void) | null = null;
  private downPos = { x: 0, y: 0 };
  private stats: ModelStats = { meshes: 0, triangles: 0, vertices: 0 };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.loadSeq += 1;
    this.stopAnimLoop();
    this.detachMeasureListeners();
    this.release();
    this.three = null;
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.attachMeasureListeners();
    this.startAnimLoop();
    this.remount();
  }

  async deactivate() {
    this.detachMeasureListeners();
    this.stopAnimLoop();
    this.three?.setVisible(false);
    this.unmount();
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    if (container.three) this.three = container.three;
    this.remount();
    if (!this.three) this.drawHint();
  }

  /** Host entry for 3-D-capable plugins: receive the shared scene handle. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.remount();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.viewMode === 'string' && ['shaded', 'wireframe', 'normal', 'xray'].includes(params.viewMode)) {
      this.state.viewMode = params.viewMode as ViewMode;
      this.applyViewMode();
    }
    if (typeof params.clip === 'boolean') {
      this.state.clip = params.clip;
      this.applyClip();
    }
    if (typeof params.clipAxis === 'string' && ['x', 'y', 'z'].includes(params.clipAxis)) {
      this.state.clipAxis = params.clipAxis as ClipAxis;
      this.applyClip();
    }
    if (typeof params.clipPos === 'number') {
      this.state.clipPos = Math.min(1, Math.max(0, params.clipPos));
      this.applyClip();
    }
    if (typeof params.autoRotate === 'boolean') {
      this.state.autoRotate = params.autoRotate;
      const three = this.three;
      if (three) {
        three.controls.autoRotate = this.state.autoRotate;
        three.controls.autoRotateSpeed = 2;
      }
    }
    if (typeof params.view === 'string' && ['fit', 'front', 'top', 'side'].includes(params.view)) {
      this.state.view = params.view as ViewPreset;
      this.applyView();
    }
    if (typeof params.animation === 'string') {
      this.state.animation = params.animation;
      this.selectClip();
    }
    if (typeof params.playing === 'boolean') {
      this.state.playing = params.playing;
      this.applyPlayState();
    }
    if (typeof params.measure === 'boolean') {
      this.state.measure = params.measure;
      if (!params.measure) this.clearMeasurement();
    }
  }

  getParams(): ParamDefinition[] {
    const zhOn = zh(this.api);
    const params: ParamDefinition[] = [
      {
        key: 'viewMode',
        label: 'View mode',
        labelI18n: { 'zh-CN': '观察模式', 'en-US': 'View mode' },
        type: 'select',
        value: this.state.viewMode,
        options: [
          { value: 'shaded', label: 'Shaded', labelI18n: { 'zh-CN': '着色', 'en-US': 'Shaded' } },
          { value: 'wireframe', label: 'Wireframe', labelI18n: { 'zh-CN': '线框', 'en-US': 'Wireframe' } },
          { value: 'normal', label: 'Normals', labelI18n: { 'zh-CN': '法线', 'en-US': 'Normals' } },
          { value: 'xray', label: 'X-ray', labelI18n: { 'zh-CN': '透视', 'en-US': 'X-ray' } },
        ],
      },
      { key: 'clip', label: 'Clipping', labelI18n: { 'zh-CN': '剖面', 'en-US': 'Clipping' }, type: 'checkbox', value: this.state.clip },
      // Clip axis/position are only meaningful when clipping is on; the
      // params panel re-reads getParams() on every change, so toggling the
      // checkbox reveals/hides them.
      ...(this.state.clip
        ? ([
            {
              key: 'clipAxis',
              label: 'Clip axis',
              labelI18n: { 'zh-CN': '剖面轴向', 'en-US': 'Clip axis' },
              type: 'select' as const,
              value: this.state.clipAxis,
              options: [
                { value: 'x', label: 'X' },
                { value: 'y', label: 'Y' },
                { value: 'z', label: 'Z' },
              ],
            },
            {
              key: 'clipPos',
              label: 'Clip position',
              labelI18n: { 'zh-CN': '剖面位置', 'en-US': 'Clip position' },
              type: 'range' as const,
              value: this.state.clipPos,
              min: 0,
              max: 1,
              step: 0.01,
            },
          ] as ParamDefinition[])
        : []),
      { key: 'autoRotate', label: 'Auto-rotate', labelI18n: { 'zh-CN': '自动旋转', 'en-US': 'Auto-rotate' }, type: 'checkbox', value: this.state.autoRotate },
      {
        key: 'view',
        label: 'View preset',
        labelI18n: { 'zh-CN': '视角预设', 'en-US': 'View preset' },
        type: 'select',
        value: this.state.view,
        options: [
          { value: 'fit', label: 'Fit', labelI18n: { 'zh-CN': '自适应', 'en-US': 'Fit' } },
          { value: 'front', label: 'Front', labelI18n: { 'zh-CN': '前视', 'en-US': 'Front' } },
          { value: 'top', label: 'Top', labelI18n: { 'zh-CN': '顶视', 'en-US': 'Top' } },
          { value: 'side', label: 'Side', labelI18n: { 'zh-CN': '侧视', 'en-US': 'Side' } },
        ],
      },
      { key: 'measure', label: 'Measure distance', labelI18n: { 'zh-CN': '两点测距', 'en-US': 'Measure distance' }, type: 'checkbox', value: this.state.measure },
    ];
    if (this.clips.length > 0) {
      params.push(
        {
          key: 'animation',
          label: 'Animation',
          labelI18n: { 'zh-CN': '动画', 'en-US': 'Animation' },
          type: 'select',
          value: this.state.animation,
          options: this.clips.map((c, i) => ({ value: String(i), label: c.name || `clip ${i + 1}` })),
        },
        { key: 'playing', label: 'Playing', labelI18n: { 'zh-CN': '播放', 'en-US': 'Playing' }, type: 'checkbox', value: this.state.playing },
      );
    }
    void zhOn;
    return params;
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const seq = ++this.loadSeq;
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      this.api.notify('error', zh(this.api) ? '读取文件失败' : 'Failed to read file');
      return;
    }
    if (seq !== this.loadSeq) return;

    const root = new THREE.Group();
    try {
      if (ext === '.glb' || ext === '.gltf') {
        const gltf = await this.parseGltf(ext === '.glb' ? buffer : new TextDecoder().decode(buffer));
        if (seq !== this.loadSeq) return;
        root.add(gltf.scene);
        this.clips = gltf.animations ?? [];
      } else if (ext === '.stl') {
        const geometry = new STLLoader().parse(buffer);
        geometry.computeVertexNormals();
        root.add(this.meshFromGeometry(geometry, file.name));
        this.clips = [];
      } else if (ext === '.obj') {
        const obj = new OBJLoader().parse(new TextDecoder().decode(buffer));
        root.add(obj);
        this.clips = [];
      } else if (ext === '.ply') {
        const geometry = new PLYLoader().parse(buffer);
        const hasFaces = geometry.index !== null;
        if (hasFaces) {
          geometry.computeVertexNormals();
          root.add(this.meshFromGeometry(geometry, file.name));
        } else {
          const points = new THREE.Points(
            geometry,
            new THREE.PointsMaterial({ size: 0.02, vertexColors: !!geometry.attributes.color, color: geometry.attributes.color ? 0xffffff : 0x8ab4ff }),
          );
          root.add(points);
        }
        this.clips = [];
      } else {
        this.api.notify('warning', zh(this.api) ? '不支持的模型格式' : 'Unsupported model format');
        return;
      }
    } catch (err) {
      if (seq === this.loadSeq) {
        this.api.notify('error', zh(this.api) ? '模型解析失败' : 'Model parse failed');
        console.error('[model-viewer] parse failed', err);
      }
      return;
    }
    if (seq !== this.loadSeq) return;

    this.release();
    this.group = root;
    this.state.loaded = true;
    this.state.filename = file.name;
    this.state.animation = this.clips.length > 0 ? '0' : '';
    root.updateMatrixWorld(true);
    this.bbox.setFromObject(root);

    // Inventory + per-mesh original material registry.
    let triangles = 0;
    let vertices = 0;
    let meshes = 0;
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh && !(node as THREE.Points).isPoints && !(node as THREE.Line).isLine) return;
      meshes += 1;
      const geometry = mesh.geometry;
      // glTF files (and hand-made samples) may omit the NORMAL attribute;
      // zero normals render black under normal-material and lighting modes.
      if (mesh.isMesh && !geometry.attributes.normal) geometry.computeVertexNormals();
      const count = geometry.attributes.position?.count ?? 0;
      vertices += count;
      triangles += geometry.index ? geometry.index.count / 3 : count / 3;
      if (mesh.isMesh) {
        // Single-sided triangles (e.g. flat fins in hand-made glTF) vanish
        // when viewed from behind; a viewer should always render both faces.
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && 'side' in mat) mat.side = THREE.DoubleSide;
        this.originals.set(mesh, mesh.material as THREE.Material);
      }
    });
    this.stats = { meshes, triangles: Math.round(triangles), vertices };

    this.api.reportDataScale(vertices);
    this.applyViewMode();
    this.applyClip();
    this.setupMixer();
    this.applyPlayState();
    this.remount();
    this.applyView();
    this.state.autoRotate = false;
    const three = this.three;
    if (three) three.controls.autoRotate = false;
  }

  async compute() {
    if (!this.state.loaded) {
      return { ok: false, error: 'no model loaded' };
    }
    return {
      ok: true,
      output: {
        filename: this.state.filename,
        ...this.stats,
        animations: this.clips.length,
        bbox: {
          min: this.bbox.min.toArray().map((v) => +v.toFixed(4)),
          max: this.bbox.max.toArray().map((v) => +v.toFixed(4)),
        },
      },
    };
  }

  // ---- mounting -----------------------------------------------------------

  /** Add the current model to the host scene (idempotent). */
  private remount() {
    const three = this.three;
    if (!three || !this.group) return;
    if (this.group.parent !== three.scene) {
      three.scene.add(this.group);
      three.setVisible(true);
    }
  }

  private unmount() {
    const three = this.three;
    if (three && this.group?.parent === three.scene) three.scene.remove(this.group);
  }

  private release() {
    this.stopAnimLoop();
    this.mixer = null;
    this.action = null;
    this.clips = [];
    if (this.group) {
      this.unmount();
      disposeObjectTree(this.group);
      this.group = null;
    }
    for (const material of this.modeMaterials) material.dispose();
    this.modeMaterials.clear();
    this.normalMaterial?.dispose();
    this.normalMaterial = null;
    this.originals.clear();
    this.clearMeasurement();
    this.state.loaded = false;
    this.state.filename = '';
  }

  // ---- view modes ---------------------------------------------------------

  private applyViewMode() {
    if (!this.group) return;
    // Dispose previous mode clones (never the originals).
    for (const material of this.modeMaterials) material.dispose();
    this.modeMaterials.clear();
    for (const [mesh, orig] of this.originals) {
      switch (this.state.viewMode) {
        case 'shaded':
          mesh.material = orig;
          break;
        case 'wireframe': {
          const clone = orig.clone();
          (clone as THREE.MeshStandardMaterial).wireframe = true;
          this.modeMaterials.add(clone);
          mesh.material = clone;
          break;
        }
        case 'normal': {
          // DoubleSide: FrontSide culls back-facing triangles, which reads as
          // a straight "cut" when viewing a closed surface from behind.
          this.normalMaterial ??= new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
          mesh.material = this.normalMaterial;
          break;
        }
        case 'xray': {
          const clone = orig.clone();
          clone.transparent = true;
          clone.opacity = 0.35;
          clone.depthWrite = false;
          this.modeMaterials.add(clone);
          mesh.material = clone;
          break;
        }
      }
    }
    this.applyClip();
  }

  // ---- clipping -----------------------------------------------------------

  private applyClip() {
    const planes = this.state.clip ? [this.clipPlane] : null;
    // Recompute the plane against the model bbox: normal points along -axis,
    // so fragments with axis-coordinate below the cut survive.
    const axis = this.state.clipAxis;
    const normal = new THREE.Vector3(axis === 'x' ? -1 : 0, axis === 'y' ? -1 : 0, axis === 'z' ? -1 : 0);
    this.clipPlane.normal.copy(normal);
    const min = this.bbox.isEmpty() ? 0 : this.bbox.min[axis];
    const max = this.bbox.isEmpty() ? 0 : this.bbox.max[axis];
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    this.clipPlane.constant = lo + this.state.clipPos * (hi - lo);
    const all = new Set<THREE.Material>();
    for (const material of this.originals.values()) all.add(material);
    for (const material of this.modeMaterials) all.add(material);
    if (this.normalMaterial) all.add(this.normalMaterial);
    for (const material of all) {
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    }
  }

  // ---- view presets -------------------------------------------------------

  private applyView() {
    const three = this.three;
    if (!three || !this.group) return;
    const dirs: Record<ViewPreset, THREE.Vector3 | undefined> = {
      fit: undefined,
      front: new THREE.Vector3(0, 0, 1),
      top: new THREE.Vector3(0, 1, 0.001),
      side: new THREE.Vector3(1, 0, 0),
    };
    fitCameraToObject(this.group, three.camera, three.controls, { direction: dirs[this.state.view] });
    three.render();
  }

  // ---- animation ----------------------------------------------------------

  private setupMixer() {
    if (this.clips.length === 0 || !this.group) {
      this.mixer = null;
      return;
    }
    this.mixer = new THREE.AnimationMixer(this.group);
    this.selectClip();
    this.startAnimLoop();
  }

  private selectClip() {
    if (!this.mixer || this.clips.length === 0) return;
    const index = Math.min(Math.max(0, Number(this.state.animation) || 0), this.clips.length - 1);
    const clip = this.clips[index];
    if (!clip) return;
    this.action?.stop();
    this.action = this.mixer.clipAction(clip);
    this.action.reset();
    if (this.state.playing) this.action.play();
  }

  private applyPlayState() {
    if (!this.mixer) return;
    if (this.state.playing) {
      this.action?.play();
      this.startAnimLoop();
    } else if (this.action) {
      this.action.paused = true;
    }
  }

  private startAnimLoop() {
    if (this.animRaf !== 0 || !this.mixer) return;
    this.animLast = performance.now();
    const tick = (now: number) => {
      const dt = (now - this.animLast) / 1000;
      this.animLast = now;
      this.mixer?.update(dt);
      this.animRaf = requestAnimationFrame(tick);
    };
    this.animRaf = requestAnimationFrame(tick);
  }

  private stopAnimLoop() {
    if (this.animRaf !== 0) cancelAnimationFrame(this.animRaf);
    this.animRaf = 0;
  }

  // ---- measurement --------------------------------------------------------

  private attachMeasureListeners() {
    const three = this.ctx?.three;
    if (!three || this.onPointerDown) return;
    this.onPointerDown = (e: PointerEvent) => {
      this.downPos = { x: e.clientX, y: e.clientY };
    };
    this.onPointerUp = (e: PointerEvent) => {
      if (!this.state.measure || !this.group) return;
      // Only treat it as a pick when the pointer didn't drag (orbiting).
      const dx = e.clientX - this.downPos.x;
      const dy = e.clientY - this.downPos.y;
      if (dx * dx + dy * dy > 25) return;
      const rect = three.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(ndc, three.camera);
      const hits = this.raycaster.intersectObject(this.group, true);
      const hit = hits[0];
      if (!hit) return;
      this.addMeasurePoint(hit.point.clone());
    };
    three.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    three.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
  }

  private detachMeasureListeners() {
    const three = this.ctx?.three;
    if (!three || !this.onPointerDown || !this.onPointerUp) return;
    three.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    three.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.onPointerDown = null;
    this.onPointerUp = null;
  }

  private addMeasurePoint(point: THREE.Vector3) {
    // Third click starts a new measurement.
    if (this.measurePoints.length >= 2) this.clearMeasurement();
    this.measurePoints.push(point);
    if (this.measurePoints.length === 2) this.drawMeasurement();
    else this.rebuildMeasureHelpers();
  }

  private rebuildMeasureHelpers() {
    const three = this.three;
    if (!three || !this.group) return;
    if (this.measureGroup) {
      this.measureGroup.parent?.remove(this.measureGroup);
      disposeObjectTree(this.measureGroup);
    }
    this.measureGroup = new THREE.Group();
    const sphereGeo = new THREE.SphereGeometry(Math.max(this.bboxDiagonal() * 0.004, 0.001), 12, 8);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffc857 });
    for (const point of this.measurePoints) {
      const marker = new THREE.Mesh(sphereGeo.clone(), sphereMat.clone());
      marker.position.copy(point);
      this.measureGroup.add(marker);
    }
    const p0 = this.measurePoints[0];
    const p1 = this.measurePoints[1];
    if (p0 && p1) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([p0, p1]),
        new THREE.LineBasicMaterial({ color: 0xffc857 }),
      );
      this.measureGroup.add(line);
      const dist = p0.distanceTo(p1);
      const label = this.makeDistanceSprite(dist);
      label.position.copy(p0).lerp(p1, 0.5);
      this.measureGroup.add(label);
      this.api.notify(
        'info',
        zh(this.api) ? `两点距离：${dist.toFixed(4)}（模型单位）` : `Distance: ${dist.toFixed(4)} (model units)`,
      );
    }
    // Parent to the model group (not the shared scene) so the markers follow
    // the model's lifecycle — deactivate/unmount takes them along.
    this.group.add(this.measureGroup);
    three.render();
  }

  private drawMeasurement() {
    this.rebuildMeasureHelpers();
  }

  private clearMeasurement() {
    this.measurePoints = [];
    if (this.measureGroup) {
      this.measureGroup.parent?.remove(this.measureGroup);
      disposeObjectTree(this.measureGroup);
      this.measureGroup = null;
    }
  }

  private bboxDiagonal(): number {
    if (this.bbox.isEmpty()) return 1;
    return this.bbox.getSize(new THREE.Vector3()).length() || 1;
  }

  private makeDistanceSprite(dist: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.fillStyle = 'rgba(11, 17, 23, 0.85)';
    g.roundRect?.(4, 8, 248, 48, 10);
    g.fill();
    g.strokeStyle = 'rgba(255, 200, 87, 0.9)';
    g.stroke();
    g.fillStyle = '#ffd98a';
    g.font = 'bold 26px Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${dist.toFixed(3)}`, 128, 33);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.scale.set(this.bboxDiagonal() * 0.16, this.bboxDiagonal() * 0.04, 1);
    return sprite;
  }

  // ---- helpers -------------------------------------------------------------

  private async parseGltf(data: ArrayBuffer | string) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    // Served from public/draco/ (copied from three at setup time); a relative
    // path resolves against the document base, matching the app's './' base.
    draco.setDecoderPath('draco/');
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
    if (data instanceof ArrayBuffer) data = sanitizeGlbPadding(data);
    return new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
      loader.parse(
        data,
        '',
        (gltf) => {
          draco.dispose();
          resolve({ scene: gltf.scene, animations: gltf.animations });
        },
        (err) => {
          draco.dispose();
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  private meshFromGeometry(geometry: THREE.BufferGeometry, _name: string): THREE.Mesh {
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      color: 0x9fb6cc,
      metalness: 0.1,
      roughness: 0.65,
      vertexColors: !!geometry.attributes.color,
      flatShading: false,
    });
    return new THREE.Mesh(geometry, material);
  }

  /** 2-D hint when the host has no 3D surface available. */
  private drawHint() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = '12px Consolas, monospace';
    g.textAlign = 'center';
    g.fillText(
      zh(this.api) ? '拖入 GLB/GLTF/STL/OBJ/PLY 模型文件' : 'Drop a GLB/GLTF/STL/OBJ/PLY model file',
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}

export default function createModelViewerPlugin(): Plugin {
  return new ModelViewerPlugin();
}
