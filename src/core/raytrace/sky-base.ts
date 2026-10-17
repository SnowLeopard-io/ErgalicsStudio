// ==========================================================================
// Shared sky-renderer infrastructure for fullscreen-quad atmosphere plugins.
//
// Two pieces:
//  1. createSkyQuad — a fullscreen NDC quad whose vertex shader comes from
//     the shared ray-tracing core (RT_CAMERA_VERTEX), depth-test disabled and
//     drawn last (renderOrder 9999) so it acts as a sky background.
//  2. SkyLoop — render loop + adaptive resolution + idle gating for all
//     atmosphere plugins (cloud / sky / stars / ...).
//
// Loop-scheduling invariant (the bug this class exists to prevent): exactly
// ONE requestAnimationFrame callback may be pending at any moment. The cloud
// plugin historically scheduled frames from BOTH the controls 'change'
// listener and the end of its tick; with auto-orbit on, controls.update()
// fires 'change' mid-tick while rafId is 0, so every tick spawned an extra
// callback chain — the chain count doubled per frame and froze the page after
// ~1 s ("renders one frame, then dies"). Here schedule() is the ONLY place
// that requests a frame, so chains can never multiply.
//
// Adaptive resolution note: three.js consumes setPixelRatio() only inside
// setSize(), so the drawing buffer is re-asserted explicitly (with
// updateStyle=false to keep the host's 100 % CSS sizing untouched).
// ==========================================================================

import { Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RT_CAMERA_VERTEX } from './glsl';

/** The slice of ContainerCapabilities the sky loop needs. */
export interface SkyHandle {
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  renderer: WebGLRenderer;
  render(): void;
}

/** Fullscreen background quad driven by the shared camera-ray vertex shader. */
export function createSkyQuad(fragmentShader: string, uniforms: Record<string, { value: unknown }>): { mesh: Mesh; material: ShaderMaterial } {
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    vertexShader: RT_CAMERA_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9999;
  return { mesh, material };
}

export interface SkyLoopOptions {
  three: SkyHandle;
  /** The material (needs uCamWorld / uProjInv if present — auto-updated). */
  material?: ShaderMaterial;
  /** True while any animation keeps frames coming; false parks the loop. */
  isAnimating: () => boolean;
  /** Per-frame simulation/ephemeris update, called before the render. */
  onFrame: (dt: number) => void;
  /** Quality-tier base scale (0..1]; multiplied by the adaptive scale. */
  qualityScale: () => number;
}

const MIN_DYN_SCALE = 0.35;

export class SkyLoop {
  private rafId = 0;
  private lastT = 0;
  private fpsEma = 0;
  private dynScale = 1;
  private savedRatio: number | null = null;

  constructor(private readonly opts: SkyLoopOptions) {}

  /** Registers the camera-restart listener and snapshots the host ratio. */
  mount() {
    this.savedRatio = this.opts.three.renderer.getPixelRatio();
    this.opts.three.controls.addEventListener('change', this.onControlsChange);
  }

  /** Detaches everything and hands the renderer back at its original ratio. */
  unmount() {
    this.stop();
    this.opts.three.controls.removeEventListener('change', this.onControlsChange);
    if (this.savedRatio !== null) {
      const r = this.opts.three.renderer;
      r.setPixelRatio(this.savedRatio);
      const el = r.domElement;
      r.setSize(el.clientWidth || 640, el.clientHeight || 480, false);
      this.savedRatio = null;
    }
    this.dynScale = 1;
    this.fpsEma = 0;
  }

  start() {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.lastT = 0;
    this.fpsEma = 0;
  }

  /** Renders exactly one frame (also used to show parameter changes while idle). */
  renderFrame() {
    this.opts.onFrame(0);
    this.updateCamera();
    this.opts.three.render();
  }

  /** Applies quality-tier × adaptive internal resolution to the host renderer. */
  applyResolution() {
    const r = this.opts.three.renderer;
    if (this.savedRatio === null) this.savedRatio = r.getPixelRatio();
    const base = Math.min(window.devicePixelRatio || 1, 2);
    const target = Math.min(1, base * this.opts.qualityScale() * this.dynScale);
    r.setPixelRatio(Math.max(target, 0.25));
    // setPixelRatio alone is inert — three.js consumes it inside setSize.
    const el = r.domElement;
    r.setSize(el.clientWidth || 640, el.clientHeight || 480, false);
  }

  private onControlsChange = () => {
    // Camera interaction restarts the loop when the idle gate stopped it.
    this.start();
  };

  /** The ONLY place that schedules a frame — chains can never multiply. */
  private schedule() {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Pushes camera state into the shared uniforms (when the material has them). */
  private updateCamera() {
    const m = this.opts.material;
    const cam = this.opts.three.camera;
    if (m) {
      if (m.uniforms.uCamWorld) m.uniforms.uCamWorld.value.copy(cam.matrixWorld);
      if (m.uniforms.uProjInv) m.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    }
  }

  private tick = (t: number) => {
    this.rafId = 0; // consumed; schedule() decides whether to continue
    const { three } = this.opts;
    const rawDt = this.lastT ? (t - this.lastT) / 1000 : 0;
    const dt = Math.min(Math.max(rawDt, 0), 0.1);
    this.lastT = t;
    // Adaptive resolution: track FPS (EMA) and shrink/grow the internal
    // render resolution so weak GPUs stay interactive. Suspicious gaps (tab
    // switches, first frame) are skipped.
    if (rawDt > 0 && rawDt < 0.5) {
      const fps = 1 / rawDt;
      this.fpsEma = this.fpsEma ? this.fpsEma * 0.9 + fps * 0.1 : fps;
      if (this.fpsEma < 24 && this.dynScale > MIN_DYN_SCALE) {
        this.dynScale = Math.max(MIN_DYN_SCALE, this.dynScale * 0.85);
        this.fpsEma = 0;
        this.applyResolution();
      } else if (this.fpsEma > 55 && this.dynScale < 1) {
        this.dynScale = Math.min(1, this.dynScale * 1.12);
        this.fpsEma = 0;
        this.applyResolution();
      }
    }
    this.opts.onFrame(dt);
    three.controls.update?.();
    three.camera.updateMatrixWorld();
    this.updateCamera();
    three.render();
    // Idle gate: with every animation off, park the loop — the controls
    // 'change' listener restarts it on the next camera interaction.
    if (this.opts.isAnimating()) this.schedule();
  };
}
