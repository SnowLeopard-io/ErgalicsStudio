// ==========================================================================
// Example plugin: N-Body Gravity Simulator (3D)
//
// Astrophysics direct-summation N-body integration in three dimensions.
// Demonstrates the heavy "embarrassingly parallel" scientific workload that
// benefits most from GPU compute: every body feels the gravitational pull of
// every other body (O(N²) per step). On the GPU it runs an all-pairs WGSL
// kernel with ping-pong buffers; on the CPU it runs the exact same integrator
// (used as the fallback and for the interactive animation). The trajectory is
// identical in both modes — only the speed differs.
//
// Data-driven: the plugin never fabricates a dataset. It renders an empty 3D
// scene until the user drops a `.json` file or loads sample data.
// ==========================================================================

import * as THREE from 'three';
import type {
  ComputeBufferHandle,
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  GpuComputeApi,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  Scene3DHandle,
} from '@/types/plugin';
import { logger } from '@/core/logger';
import {
  advanceNBodyCPU,
  nbodyBufferBytes,
  nbodyKernelWGSL,
  NBODY_BUFFER_USAGE,
  NBODY_PARAMS_USAGE,
  packBodies,
  packNBodyParams,
  unpackBodies,
  type NBodyBody,
} from '@/core/wgsl';

export const nbodyManifest: PluginManifest = {
  id: 'example.nbody',
  name: 'N-Body Gravity',
  nameI18n: { 'zh-CN': '引力 N 体模拟', 'en-US': 'N-Body Gravity' },
  version: '1.1.0',
  author: 'Ergalics',
  description: '3-D direct-summation gravity simulation with GPU compute.',
  descriptionI18n: {
    'zh-CN': '三维天体物理 N 体引力直接求和模拟，支持 GPU 全配对计算与 CPU 降级。',
    'en-US': '3-D astrophysics direct-summation gravity with GPU all-pairs compute + CPU fallback.',
  },
  license: 'MIT',
  entry: 'example.nbody',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'N-body initial conditions' },
  ],
};

/** Hard cap on the CPU path so the one-shot Compute button cannot freeze the
 *  main thread. The GPU path is not capped — it dispatches the full N. */
const CPU_NBODY_CAP = 3000;
const MAX_BODIES = 8192;

interface State {
  count: number;
  G: number;
  softening: number;
  dt: number;
  steps: number;
  running: boolean;
  hasData: boolean;
}

export class NBodyPlugin implements Plugin {
  readonly manifest = nbodyManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private state: State = {
    count: 4096,
    G: 0.05,
    softening: 0.03,
    dt: 0.004,
    steps: 120,
    running: false,
    hasData: false,
  };
  private bodies: NBodyBody[] = [];
  private pointsMesh: THREE.Points | null = null;
  private positionAttr = new Float32Array(0);
  private colorAttr = new Float32Array(0);
  private posBufAttr: THREE.BufferAttribute | null = null;
  private colBufAttr: THREE.BufferAttribute | null = null;
  private rafId = 0;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stop();
    this.clearMesh();
    this.three = null;
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stop();
    this.clearMesh();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    // The host mounts `three` only for plugins declaring renderToScene.
    if (container.three) this.three = container.three;
    this.draw();
  }

  /** Explicit entry point for the host-managed Three.js scene. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.count === 'number' && params.count !== this.state.count) {
      this.state.count = Math.max(64, Math.min(MAX_BODIES, Math.floor(params.count)));
      // Only resample a real dataset; never fabricate one.
      if (this.state.hasData) this.resampleLoaded();
    }
    if (typeof params.G === 'number') this.state.G = params.G;
    if (typeof params.softening === 'number') this.state.softening = params.softening;
    if (typeof params.dt === 'number') this.state.dt = params.dt;
    if (typeof params.steps === 'number') this.state.steps = Math.max(1, Math.floor(params.steps));
    if (typeof params.start === 'boolean') {
      if (params.start) this.start();
      else this.stop();
    }
    if ((params as { compute?: { action?: string } })?.compute?.action === 'gpu-compute') void this.runCompute();
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'count', label: 'Bodies', type: 'range', min: 64, max: MAX_BODIES, step: 64, value: this.state.count },
      { key: 'G', label: 'Gravity G', type: 'range', min: 0.005, max: 0.5, step: 0.005, value: this.state.G },
      { key: 'softening', label: 'Softening', type: 'range', min: 0.005, max: 0.3, step: 0.005, value: this.state.softening },
      { key: 'dt', label: 'Timestep', type: 'range', min: 0.0005, max: 0.02, step: 0.0005, value: this.state.dt },
      { key: 'steps', label: 'Compute steps', type: 'range', min: 10, max: 400, step: 10, value: this.state.steps },
      {
        key: 'start',
        label: 'Run',
        type: 'toggle',
        value: this.state.running,
        offLabelI18n: { 'zh-CN': '▶ 开始模拟', 'en-US': '▶ Run' },
        onLabelI18n: { 'zh-CN': '■ 停止模拟', 'en-US': '■ Stop' },
      },
      {
        key: 'compute',
        label: 'Compute',
        type: 'button',
        variant: 'primary',
        action: 'gpu-compute',
        labelI18n: { 'zh-CN': '⚡ GPU 全配对计算', 'en-US': '⚡ GPU all-pairs' },
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const bodies = this.parseData(text);
    if (bodies.length < 2) {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '无法解析数据文件' : 'Could not parse data file');
      return;
    }
    this.bodies = bodies;
    this.state.count = Math.min(MAX_BODIES, Math.max(64, this.bodies.length));
    this.state.hasData = true;
    this.api.reportDataScale(this.bodies.length);
    this.rebuildMesh();
    this.fitCamera();
    this.draw();
  }

  /**
   * Advance the simulation `steps` times. Uses the real WGSL all-pairs kernel
   * when a GPU is available (no per-step read-back — ping-pong buffers keep it
   * on the device), and the CPU-equivalent integrator otherwise. Reports the
   * measured time to the perf panel.
   */
  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    if (this.bodies.length === 0) {
      return { ok: false, error: this.api.locale === 'zh-CN' ? '未加载数据 — 请先拖入 .json 文件或打开「示例数据」' : 'no data — load a .json file or sample data first' };
    }
    const steps = this.state.steps;
    const { dt, G, softening } = this.state;
    const t0 = performance.now();
    const gpu = this.api.gpu;
    const n = this.bodies.length;

    if (gpu?.available) {
      this.api.setStatus('computing');
      const ok = await this.gpuIntegrate(gpu, steps, onProgress);
      this.api.setStatus('ready');
      if (ok) {
        const ms = performance.now() - t0;
        this.api.reportGpuTime(ms);
        this.updateGeometry();
        this.draw();
        return { ok: true, output: n, metrics: { gpuMs: ms, bytes: nbodyBufferBytes(n) } };
      }
    }

    // CPU fallback — mirror of the WGSL kernel.
    const cap = Math.min(n, CPU_NBODY_CAP);
    if (cap < n) {
      this.api.notify(
        'info',
        this.api.locale === 'zh-CN'
          ? `CPU 模式仅模拟前 ${cap} / ${n} 个天体（GPU 模式使用全部）`
          : `CPU mode simulates the first ${cap} / ${n} bodies (GPU uses all)`,
      );
    }
    const work = this.bodies.slice(0, cap);
    for (let s = 0; s < steps; s += 1) {
      advanceNBodyCPU(work, dt, G, softening);
      onProgress?.({ done: s + 1, total: steps });
    }
    for (let i = 0; i < cap; i += 1) this.bodies[i] = work[i] as NBodyBody;
    this.updateGeometry();
    this.draw();
    const ms = performance.now() - t0;
    this.api.reportGpuTime(ms);
    // Report the work actually done — the CPU path only simulated `cap` bodies,
    // so `bytes` must not claim the full-N buffer allocation.
    return { ok: true, output: cap, metrics: { gpuMs: ms, bytes: nbodyBufferBytes(cap) } };
  }

  /** Trigger the accelerated compute path from the params button. */
  private async runCompute() {
    if (this.bodies.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载数据 — 拖入 .json 文件或打开「示例数据」'
          : 'Load data first — drop a .json file or open sample data',
      );
      return;
    }
    const result = await this.compute(null, (p) => {
      this.api.notify('info', `${p.done}/${p.total}`);
    });
    if (result.ok) {
      const engine = this.api.gpu?.available ? this.api.gpu?.backend : 'cpu';
      this.api.notify(
        'success',
        this.api.locale === 'zh-CN'
          ? `计算完成（${engine}）— ${result.metrics?.gpuMs?.toFixed(1) ?? '?'} ms`
          : `Compute done (${engine}) — ${result.metrics?.gpuMs?.toFixed(1) ?? '?'} ms`,
      );
    } else {
      this.api.notify('error', result.error ?? 'compute failed');
    }
  }

  /**
   * Real WGSL all-pairs path with ping-pong buffers so the N step dispatches
   * stay on the device (no per-step read-back). Returns false on any failure
   * so `compute()` can transparently fall back to CPU.
   */
  private async gpuIntegrate(
    gpu: GpuComputeApi,
    steps: number,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<boolean> {
    const n = this.bodies.length;
    let bufA: ComputeBufferHandle | null = null;
    let bufB: ComputeBufferHandle | null = null;
    let paramsBuf: ComputeBufferHandle | null = null;
    try {
      bufA = gpu.createBuffer(
        nbodyBufferBytes(n),
        NBODY_BUFFER_USAGE,
        'nbody.A',
      );
      bufB = gpu.createBuffer(
        nbodyBufferBytes(n),
        NBODY_BUFFER_USAGE,
        'nbody.B',
      );
      paramsBuf = gpu.createBuffer(
        16,
        NBODY_PARAMS_USAGE,
        'nbody.params',
      );
      if (!bufA || !bufB || !paramsBuf) return false;

      const kernel = gpu.compileKernel({
        label: 'nbody.integrate',
        wgsl: nbodyKernelWGSL(),
        workgroupSize: [64, 1, 1],
        bindings: [
          { binding: 0, bufferType: 'read-only-storage' },
          { binding: 1, bufferType: 'storage' },
          { binding: 2, bufferType: 'uniform' },
        ],
      });
      if (!kernel) return false;

      bufA.write(packBodies(this.bodies));
      paramsBuf.write(new Uint8Array(packNBodyParams(this.state.dt, this.state.G, this.state.softening, n)));
      const workgroups = Math.max(1, Math.ceil(n / 64));

      let lastOut: ComputeBufferHandle = bufB;
      for (let s = 0; s < steps; s += 1) {
        const inBuf = s % 2 === 0 ? bufA : bufB;
        const outBuf = s % 2 === 0 ? bufB : bufA;
        if (!gpu.run(kernel, [inBuf, outBuf, paramsBuf], workgroups, 1, 1)) return false;
        lastOut = outBuf;
        onProgress?.({ done: s + 1, total: steps });
      }

      const result = await lastOut.read();
      unpackBodies(new Float32Array(result), this.bodies);
      this.api.reportDataScale(this.bodies.length);
      return true;
    } catch (err) {
      logger.warn('nbody', 'GPU compute failed, falling back to CPU', err);
      return false;
    } finally {
      bufA?.destroy();
      bufB?.destroy();
      paramsBuf?.destroy();
    }
  }

  /** Parse JSON ICs (7-column arrays or {x,y,z,vx,vy,vz,mass} objects). */
  private parseData(text: string): NBodyBody[] {
    const trimmed = text.trim();
    let parsed: unknown = null;
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
    }
    const arr = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { bodies?: unknown }).bodies : null;
    if (Array.isArray(arr)) {
      const out: NBodyBody[] = [];
      for (const item of arr) {
        if (Array.isArray(item)) {
          const it = item as number[];
          const x = it[0] ?? 0;
          const y = it[1] ?? 0;
          const z = it[2] ?? 0;
          const vx = it[3] ?? 0;
          const vy = it[4] ?? 0;
          const vz = it[5] ?? 0;
          const m = it[6] ?? 1;
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            out.push({ x, y, z, vx, vy, vz, mass: m || 1 });
          }
        } else if (item && typeof item === 'object') {
          const o = item as Record<string, number>;
          const x = o.x ?? 0;
          const y = o.y ?? 0;
          const z = o.z ?? 0;
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            out.push({ x, y, z, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0, mass: (o.mass ?? o.m ?? 1) || 1 });
          }
        }
      }
      if (out.length) return out;
    }
    // Fallback: whitespace/comma columns [x y z vx vy vz mass].
    const out: NBodyBody[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const parts = line
        .trim()
        .split(/[\s,]+/)
        .map((s) => parseFloat(s))
        .filter(Number.isFinite);
      if (parts.length >= 3) {
        out.push({
          x: parts[0] as number,
          y: parts[1] as number,
          z: parts[2] as number,
          vx: parts[3] ?? 0,
          vy: parts[4] ?? 0,
          vz: parts[5] ?? 0,
          mass: parts[6] ?? 1,
        });
      }
    }
    return out;
  }

  /** Resample the loaded dataset down to the current count. */
  private resampleLoaded() {
    const n = this.bodies.length;
    const target = Math.min(this.state.count, n);
    const next: NBodyBody[] = [];
    for (let i = 0; i < target; i += 1) {
      const idx = Math.min(Math.floor((i * n) / target), n - 1);
      next.push({ ...(this.bodies[idx] as NBodyBody) });
    }
    this.bodies = next;
    this.api.reportDataScale(this.bodies.length);
    this.rebuildMesh();
    this.draw();
  }

  private start() {
    if (this.state.running) return;
    if (this.bodies.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载数据 — 拖入 .json 文件或打开「示例数据」'
          : 'Load data first — drop a .json file or open sample data',
      );
      return;
    }
    this.state.running = true;
    this.api.setStatus('computing');
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop() {
    this.state.running = false;
    cancelAnimationFrame(this.rafId);
    this.api.setStatus('ready');
  }

  private tick = () => {
    if (!this.state.running) return;
    // One integration step per frame (CPU). The interactive loop must respect
    // the same CPU cap as the one-shot Compute button — at MAX_BODIES the full
    // all-pairs pass is ~67M iterations per frame and freezes the main thread.
    const n = this.bodies.length;
    const cap = Math.min(n, CPU_NBODY_CAP);
    const work = cap < n ? this.bodies.slice(0, cap) : this.bodies;
    advanceNBodyCPU(work, this.state.dt, this.state.G, this.state.softening);
    if (cap < n) {
      for (let i = 0; i < cap; i += 1) this.bodies[i] = work[i] as NBodyBody;
    }
    this.updateGeometry();
    this.draw();
    this.rafId = requestAnimationFrame(this.tick);
  };

  // ---- 3-D rendering ----

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
    const n = this.bodies.length;
    if (n === 0) return;

    this.positionAttr = new Float32Array(n * 3);
    this.colorAttr = new Float32Array(n * 3);

    const geometry = new THREE.BufferGeometry();
    this.posBufAttr = new THREE.BufferAttribute(this.positionAttr, 3);
    this.colBufAttr = new THREE.BufferAttribute(this.colorAttr, 3);
    geometry.setAttribute('position', this.posBufAttr);
    geometry.setAttribute('color', this.colBufAttr);

    const material = new THREE.PointsMaterial({
      size: 0.02,
      sizeAttenuation: true,
      vertexColors: true,
    });

    this.pointsMesh = new THREE.Points(geometry, material);
    this.three.scene.add(this.pointsMesh);
    this.updateGeometry();
  }

  /** Copy current body positions + speed colors into the mesh attributes. */
  private updateGeometry() {
    if (!this.pointsMesh) return;
    const n = this.bodies.length;
    if (this.positionAttr.length !== n * 3) {
      this.rebuildMesh();
      return;
    }
    let maxV = 1e-6;
    for (const b of this.bodies) maxV = Math.max(maxV, Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz));

    for (let i = 0; i < n; i += 1) {
      const b = this.bodies[i] as NBodyBody;
      this.positionAttr[i * 3] = b.x;
      this.positionAttr[i * 3 + 1] = b.y;
      this.positionAttr[i * 3 + 2] = b.z;
      const t = Math.min(1, Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) / maxV);
      const [r, g, bl] = speedRgb(t);
      this.colorAttr[i * 3] = r;
      this.colorAttr[i * 3 + 1] = g;
      this.colorAttr[i * 3 + 2] = bl;
    }
    this.posBufAttr!.needsUpdate = true;
    this.colBufAttr!.needsUpdate = true;
  }

  private fitCamera() {
    if (!this.three) return;
    if (this.bodies.length === 0) {
      this.three.render();
      return;
    }
    let maxR = 1e-6;
    for (const b of this.bodies) maxR = Math.max(maxR, Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z));
    const { camera, controls } = this.three;
    controls.target.set(0, 0, 0);
    const dist = Math.max(maxR * 2.8, 2);
    camera.position.set(dist * 0.7, dist * 0.55, dist);
    camera.near = Math.max(maxR / 100, 1e-3);
    camera.far = Math.max(maxR * 200, 100);
    camera.updateProjectionMatrix();
    controls.update();
  }

  private draw() {
    if (this.three) {
      if (this.bodies.length > 0 && !this.pointsMesh) this.rebuildMesh();
      this.three.render();
      return;
    }
    // Fallback: no 3-D container — show an informative 2-D hint.
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
        ? '拖入 .json 初始条件或打开「示例数据」'
        : 'Drop a .json file or load sample data';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

/** Blue → cyan → yellow → red speed ramp, returned as RGB triplets. */
function speedRgb(t: number): [number, number, number] {
  const stops = [
    [37, 99, 235],
    [45, 212, 191],
    [251, 191, 36],
    [239, 68, 68],
  ];
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const local = t * (stops.length - 1) - seg;
  const a = stops[seg] as number[];
  const b = stops[seg + 1] as number[];
  return [
    Math.round(a[0]! + (b[0]! - a[0]!) * local) / 255,
    Math.round(a[1]! + (b[1]! - a[1]!) * local) / 255,
    Math.round(a[2]! + (b[2]! - a[2]!) * local) / 255,
  ];
}

export default function createNBodyPlugin(): Plugin {
  return new NBodyPlugin();
}
