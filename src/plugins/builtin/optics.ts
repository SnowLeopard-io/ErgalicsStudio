// ==========================================================================
// Example plugin: Optics Lab (光学实验)
//
// A 2-D ray tracer for classical geometric optics:
//   • Light source  — a fan of rays (adjustable divergence).
//   • Convex lens   — ideal thin lens (f > 0), converging.
//   • Concave lens  — ideal thin lens (f < 0), diverging.
//   • Prism         — equilateral triangular glass; real Snell refraction at
//                     each face with wavelength-dependent index (dispersion).
//   • Screen        — a vertical line where the rays land (image plane).
//
// Everything is positioned by dragging on the canvas. The trace is static
// (recomputed on every change), so it is cheap and deterministic.
// ==========================================================================

import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
} from '@/types/plugin';
import { actionButton, exportCanvasPng, notify } from './shared/enhance';

export const opticsManifest: PluginManifest = {
  id: 'example.optics',
  name: 'Optics Lab',
  nameI18n: { 'zh-CN': '光学实验', 'en-US': 'Optics Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Ray tracing: convex/concave lenses, prism dispersion, light screen.',
  descriptionI18n: {
    'zh-CN': '几何光学光线追踪：凸透镜/凹透镜（薄透镜）、三棱镜（斯涅尔折射 + 色散）、光屏成像。所有元件可在画布上拖动。',
    'en-US': 'Geometric ray tracer: thin convex/concave lenses, triangular prism (Snell + dispersion), and a screen.',
  },
  license: 'MIT',
  entry: 'example.optics',
  category: 'scientific',
  icon: '🔆',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Optics layout: { source, lens?, prism?, screen, focal } with x/y in 0..1',
    },
  ],
};

interface Pt {
  x: number;
  y: number;
}
interface Ray {
  pts: Pt[];
  color: string;
}
/** Element layout captured on load, restored by the Reset Elements button. */
interface InitialLayout {
  source: Pt;
  lensX: number;
  prismCenter: Pt;
  screenX: number;
  lensType: OpticsState['lensType'];
  focal: number;
  showPrism: boolean;
  showScreen: boolean;
}

interface OpticsState {
  lensType: 'none' | 'convex' | 'concave';
  showPrism: boolean;
  showScreen: boolean;
  focal: number; // focal length (px); convex positive, concave negative
  rays: number; // number of rays in the fan
  divergence: number; // total fan angle (rad)
  dispersion: number; // prism index spread
  prismIndex: number; // base refractive index (middle wavelength)
  /**
   * True once a bench layout has been loaded. The bench never fabricates a
   * default arrangement — without data it stays an empty canvas, so the
   * geometry always comes from the user's file or a sample.
   */
  hasData: boolean;
}

const CANVAS_W = 600;
const CANVAS_H = 400;

// Wavelength → RGB (visible spectrum approximation), 380..700 nm.
function wavelengthToColor(nm: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380);
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / (490 - 440);
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / (510 - 490);
  } else if (nm < 580) {
    r = (nm - 510) / (580 - 510);
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = -(nm - 645) / (645 - 580);
  } else if (nm <= 700) {
    r = 1;
  }
  const f = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 645 ? 0.3 + (0.7 * (700 - nm)) / 55 : 1;
  const to255 = (v: number) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v * f)), 0.8));
  return `rgb(${to255(r)},${to255(g)},${to255(b)})`;
}

export class OpticsPlugin implements Plugin {
  readonly manifest = opticsManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private state: OpticsState = {
    lensType: 'convex',
    showPrism: false,
    showScreen: true,
    focal: 120,
    rays: 9,
    divergence: 0.5,
    dispersion: 0.04,
    prismIndex: 1.52,
    hasData: false,
  };
  // Element positions (pixels).
  private source: Pt = { x: 70, y: CANVAS_H / 2 };
  private lensX = 300;
  private prismCenter: Pt = { x: 320, y: CANVAS_H / 2 };
  private prismRadius = 70;
  private screenX = 520;
  // Interaction.
  private drag: 'source' | 'lens' | 'prism' | 'screen' | null = null;
  // Letterbox transform mapping the fixed 600x400 bench into the live canvas.
  private viewScale = 1;
  private viewX = 0;
  private viewY = 0;
  private bound = false;
  /** Element arrangement as loaded — the target of Reset Elements. */
  private initialLayout: InitialLayout | null = null;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.unbind();
    this.canvas = null;
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.canvas = context.container.canvas2d ?? null;
    this.bind();
    this.draw();
  }

  async deactivate() {
    this.unbind();
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    this.canvas = container.canvas2d ?? null;
    this.bind();
    this.draw();
  }

  private bind() {
    const canvas = this.canvas;
    if (!canvas || this.bound) return;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointerleave', this.onUp);
    this.bound = true;
  }

  private unbind() {
    const canvas = this.canvas;
    if (!canvas || !this.bound) return;
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointerleave', this.onUp);
    this.bound = false;
  }

  private toLocal(e: PointerEvent): Pt {
    const canvas = this.canvas!;
    const r = canvas.getBoundingClientRect();
    // Device pixels → CSS pixels → bench coordinates (inverse letterbox).
    const px = ((e.clientX - r.left) * canvas.width) / Math.max(1, r.width);
    const py = ((e.clientY - r.top) * canvas.height) / Math.max(1, r.height);
    const s = this.viewScale || 1;
    return { x: (px - this.viewX) / s, y: (py - this.viewY) / s };
  }

  private onDown = (e: PointerEvent) => {
    // Nothing is grabbable before a layout is loaded — the bench is empty, so
    // a drag would otherwise grab an invisible element.
    if (!this.state.hasData) return;
    const p = this.toLocal(e);
    if (Math.hypot(p.x - this.source.x, p.y - this.source.y) < 16) {
      this.drag = 'source';
    } else if (this.state.showPrism && this.hitPrism(p)) {
      this.drag = 'prism';
    } else if (this.state.lensType !== 'none' && Math.abs(p.x - this.lensX) < 12) {
      this.drag = 'lens';
    } else if (this.state.showScreen && Math.abs(p.x - this.screenX) < 12) {
      this.drag = 'screen';
    }
    if (this.drag) this.canvas?.setPointerCapture?.(e.pointerId);
    this.draw();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const p = this.toLocal(e);
    const cx = Math.max(20, Math.min(CANVAS_W - 20, p.x));
    const cy = Math.max(20, Math.min(CANVAS_H - 20, p.y));
    if (this.drag === 'source') {
      this.source = { x: cx, y: cy };
    } else if (this.drag === 'lens') {
      this.lensX = Math.max(40, Math.min(CANVAS_W - 40, cx));
    } else if (this.drag === 'prism') {
      this.prismCenter = { x: cx, y: cy };
    } else if (this.drag === 'screen') {
      this.screenX = Math.max(40, Math.min(CANVAS_W - 20, cx));
    }
    this.draw();
  };

  private onUp = (e: PointerEvent) => {
    this.drag = null;
    this.canvas?.releasePointerCapture?.(e.pointerId);
  };

  private hitPrism(p: Pt): boolean {
    const verts = this.prismVerts();
    return pointInTriangle(p, verts[0]!, verts[1]!, verts[2]!);
  }

  private prismVerts(): [Pt, Pt, Pt] {
    const { x, y } = this.prismCenter;
    const r = this.prismRadius;
    // Equilateral triangle pointing up.
    return [
      { x, y: y - r },
      { x: x - r * 0.866, y: y + r * 0.5 },
      { x: x + r * 0.866, y: y + r * 0.5 },
    ];
  }

  updateParams(params: Record<string, unknown>) {
    // Buttons accept both the host's `{ key: { action } }` emission and a
    // plain `{ key: true }` call. Neither mutates the running state — the
    // trace is static and recomputed on every draw.
    const fired = (key: string): boolean => {
      const v = params[key];
      return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
    };
    if (fired('exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'optics');
      return;
    }
    if (fired('resetElements')) {
      this.resetElements();
      return;
    }
    if (params.lensType === 'none' || params.lensType === 'convex' || params.lensType === 'concave') {
      this.state.lensType = params.lensType;
    }
    if (typeof params.showPrism === 'boolean') this.state.showPrism = params.showPrism;
    if (typeof params.showScreen === 'boolean') this.state.showScreen = params.showScreen;
    if (typeof params.focal === 'number') this.state.focal = params.focal;
    if (typeof params.rays === 'number') this.state.rays = Math.max(1, Math.min(25, Math.round(params.rays)));
    if (typeof params.divergence === 'number') this.state.divergence = Math.max(0, Math.min(1.4, params.divergence));
    if (typeof params.dispersion === 'number') this.state.dispersion = Math.max(0, Math.min(0.12, params.dispersion));
    if (typeof params.prismIndex === 'number') this.state.prismIndex = Math.max(1.3, Math.min(1.8, params.prismIndex));
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'lensType',
        label: 'Lens',
        labelI18n: { 'zh-CN': '透镜', 'en-US': 'Lens' },
        type: 'select',
        options: [
          { value: 'none', label: 'None', labelI18n: { 'zh-CN': '无', 'en-US': 'None' } },
          { value: 'convex', label: 'Convex (＋)', labelI18n: { 'zh-CN': '凸透镜', 'en-US': 'Convex (＋)' } },
          { value: 'concave', label: 'Concave (－)', labelI18n: { 'zh-CN': '凹透镜', 'en-US': 'Concave (－)' } },
        ],
        value: this.state.lensType,
      },
      {
        key: 'focal',
        label: 'Focal length',
        labelI18n: { 'zh-CN': '焦距', 'en-US': 'Focal length' },
        type: 'range',
        min: 60,
        max: 260,
        step: 5,
        value: this.state.focal,
      },
      {
        key: 'showPrism',
        label: 'Prism',
        labelI18n: { 'zh-CN': '三棱镜', 'en-US': 'Prism' },
        type: 'checkbox',
        value: this.state.showPrism,
      },
      {
        key: 'prismIndex',
        label: 'Prism index n',
        labelI18n: { 'zh-CN': '棱镜折射率', 'en-US': 'Prism index n' },
        type: 'range',
        min: 1.3,
        max: 1.8,
        step: 0.01,
        value: this.state.prismIndex,
      },
      {
        key: 'dispersion',
        label: 'Dispersion',
        labelI18n: { 'zh-CN': '色散强度', 'en-US': 'Dispersion' },
        type: 'range',
        min: 0,
        max: 0.12,
        step: 0.005,
        value: this.state.dispersion,
      },
      {
        key: 'showScreen',
        label: 'Screen',
        labelI18n: { 'zh-CN': '光屏', 'en-US': 'Screen' },
        type: 'checkbox',
        value: this.state.showScreen,
      },
      {
        key: 'rays',
        label: 'Ray count',
        labelI18n: { 'zh-CN': '光线数量', 'en-US': 'Ray count' },
        type: 'range',
        min: 1,
        max: 25,
        step: 1,
        value: this.state.rays,
      },
      {
        key: 'divergence',
        label: 'Beam spread',
        labelI18n: { 'zh-CN': '光束发散角', 'en-US': 'Beam spread' },
        type: 'range',
        min: 0,
        max: 1.4,
        step: 0.02,
        value: this.state.divergence,
      },
      actionButton('resetElements', 'Reset Elements', '重置元件'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
    ];
  }

  /** Restore the optical bench to the layout captured at load time. */
  private resetElements() {
    const initial = this.initialLayout;
    if (!initial) {
      notify(this.api, 'warning', 'No layout loaded to reset yet.', '尚未加载光路布局，无可重置的元件。');
      return;
    }
    this.source = { ...initial.source };
    this.lensX = initial.lensX;
    this.prismCenter = { ...initial.prismCenter };
    this.screenX = initial.screenX;
    this.state.lensType = initial.lensType;
    this.state.focal = initial.focal;
    this.state.showPrism = initial.showPrism;
    this.state.showScreen = initial.showScreen;
    this.drag = null;
    this.draw();
  }

  async loadData(file: File) {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '无法解析 JSON 文件' : 'Could not parse JSON file');
      return;
    }
    const o = parsed as Record<string, unknown>;
    const sx = o.source as Record<string, unknown> | undefined;
    if (sx && Number.isFinite(Number(sx.x)) && Number.isFinite(Number(sx.y))) {
      this.source = { x: Number(sx.x) * CANVAS_W, y: Number(sx.y) * CANVAS_H };
    }
    if (typeof o.lensX === 'number') this.lensX = o.lensX * CANVAS_W;
    if (typeof o.screenX === 'number') this.screenX = o.screenX * CANVAS_W;
    if (typeof o.prismX === 'number' && typeof o.prismY === 'number') {
      this.prismCenter = { x: o.prismX * CANVAS_W, y: o.prismY * CANVAS_H };
    }
    if (o.lensType === 'none' || o.lensType === 'convex' || o.lensType === 'concave') this.state.lensType = o.lensType;
    if (typeof o.focal === 'number') this.state.focal = o.focal;
    if (typeof o.prism === 'boolean') this.state.showPrism = o.prism;
    if (typeof o.screen === 'boolean') this.state.showScreen = o.screen;
    this.state.hasData = true;
    // Capture the loaded arrangement so Reset Elements can restore it after
    // the elements have been dragged or toggled.
    this.initialLayout = {
      source: { ...this.source },
      lensX: this.lensX,
      prismCenter: { ...this.prismCenter },
      screenX: this.screenX,
      lensType: this.state.lensType,
      focal: this.state.focal,
      showPrism: this.state.showPrism,
      showScreen: this.state.showScreen,
    };
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- Ray tracing ----------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const cw = (canvas.width = canvas.clientWidth || CANVAS_W);
    const ch = (canvas.height = canvas.clientHeight || CANVAS_H);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, cw, ch);

    if (!this.state.hasData) {
      // Empty state: no bench layout loaded — never render a fabricated
      // arrangement of source, lens and screen.
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `${this.api?.locale === 'zh-CN' ? '12px "Microsoft YaHei"' : '12px Consolas'}, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(
        this.api?.locale === 'zh-CN'
          ? '未加载数据 — 拖入 JSON 光路布局或打开「示例数据」'
          : 'No data — drop a JSON optics layout or open sample data',
        cw / 2,
        ch / 2,
      );
      return;
    }

    // Letterbox the fixed optical bench into whatever viewport the host gives
    // us: geometry and hit-testing stay in bench coordinates.
    const vs = Math.min(cw / CANVAS_W, ch / CANVAS_H) || 1;
    this.viewScale = vs;
    this.viewX = (cw - CANVAS_W * vs) / 2;
    this.viewY = (ch - CANVAS_H * vs) / 2;
    g.setTransform(vs, 0, 0, vs, this.viewX, this.viewY);
    const w = CANVAS_W;
    const h = CANVAS_H;

    // Optical axis.
    g.strokeStyle = 'rgba(120,140,170,0.25)';
    g.setLineDash([5, 5]);
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    g.setLineDash([]);

    const prism = this.state.showPrism ? this.prismVerts() : null;

    // Draw rays. When the prism is on, trace multiple wavelengths for the
    // central ray to show dispersion; otherwise trace a monochrome fan.
    if (prism) {
      const central = (this.state.rays - 1) / 2;
      for (let i = 0; i < this.state.rays; i += 1) {
        const t = this.state.rays > 1 ? (i - central) / central : 0;
        const angle = t * this.state.divergence;
        for (let wi = 0; wi < 5; wi += 1) {
          const nm = 420 + wi * 70;
          const ray = this.traceRay(angle, nm);
          this.drawRay(g, ray);
        }
      }
    } else {
      const central = (this.state.rays - 1) / 2;
      for (let i = 0; i < this.state.rays; i += 1) {
        const t = this.state.rays > 1 ? (i - central) / central : 0;
        const angle = t * this.state.divergence;
        const ray = this.traceRay(angle, 560);
        this.drawRay(g, ray);
      }
    }

    // Elements.
    this.drawLens(g);
    if (prism) this.drawPrism(g, prism);
    if (this.state.showScreen) this.drawScreen(g, h);
    this.drawSource(g);

    // HUD.
    g.fillStyle = 'rgba(150,165,185,0.85)';
    g.font = `11px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(
      this.api.locale === 'zh-CN' ? '拖动光源 / 透镜 / 棱镜 / 光屏调整光路' : 'Drag source / lens / prism / screen',
      12,
      18,
    );
  }

  /** Trace one ray from the source; `nm` selects wavelength for the prism. */
  private traceRay(angle: number, nm: number): Ray {
    const color = wavelengthToColor(nm);
    const pts: Pt[] = [{ ...this.source }];
    // Direction: down the optical bench (+x), fanned by `angle` degrees.
    let dir = { x: Math.cos(angle), y: Math.sin(angle) };
    let origin = { ...this.source };
    const prism = this.state.showPrism ? this.prismVerts() : null;

    // 1) Propagate source → lens (or → prism / screen if no lens).
    let hit: Pt | null = null;
    let hitKind: 'lens' | 'prism' | 'screen' | 'edge' = 'edge';
    let hitPrismFace = -1;
    const seg = intersectScene(origin, dir, {
      lensX: !this.state.showPrism && this.state.lensType !== 'none' ? this.lensX : null,
      prism,
      screenX: this.state.showScreen ? this.screenX : null,
      w: CANVAS_W,
      h: CANVAS_H,
    });
    hit = seg.point;
    hitKind = seg.kind;
    hitPrismFace = seg.face;
    pts.push(hit);

    // 2) Through the lens (thin-lens transform) if hit the lens plane.
    if (hitKind === 'lens' && this.state.lensType !== 'none') {
      const f = this.state.lensType === 'convex' ? this.state.focal : -this.state.focal;
      // Height of the impact point above the optical axis, and the ray's slope.
      const yAtLens = hit.y - CANVAS_H / 2;
      const slopeIn = Math.abs(dir.x) > 1e-6 ? dir.y / dir.x : 0;
      // Thin-lens ray-transfer: u' = u - y/f  (slope measured vs. optical axis).
      const slopeOut = slopeIn - yAtLens / f;
      const outDir = normalize({ x: 1, y: slopeOut });
      origin = { ...hit };
      dir = outDir;
      const seg2 = intersectScene(origin, dir, {
        lensX: this.state.showPrism ? null : this.lensX,
        prism,
        screenX: this.state.showScreen ? this.screenX : null,
        w: CANVAS_W,
        h: CANVAS_H,
        skipLens: true,
      });
      pts.push(seg2.point);
      hit = seg2.point;
      hitKind = seg2.kind;
      hitPrismFace = seg2.face;
    }

    // 3) Through the prism (real Snell refraction, wavelength-dependent).
    if (hitKind === 'prism' && prism && hitPrismFace >= 0) {
      let cur = { ...hit };
      let d = { ...dir };
      const nMid = this.state.prismIndex;
      const spread = this.state.dispersion;
      // Shorter wavelengths bend more: index rises towards the blue end.
      const frac = (560 - nm) / 280;
      const n = nMid * (1 + frac * spread);
      const faces = [
        [prism[0]!, prism[1]!],
        [prism[1]!, prism[2]!],
        [prism[2]!, prism[0]!],
      ] as const;
      let inside = false;
      for (let bounce = 0; bounce < 5; bounce += 1) {
        const fn = faces[hitPrismFace];
        if (!fn) break;
        let normal = outwardNormal(fn[0]!, fn[1]!, this.prismCenter);
        let refr: Pt | null;
        if (!inside) {
          refr = refract(d, normal, 1, n);
        } else {
          // Leaving the glass: the normal must face the incoming medium.
          normal = { x: -normal.x, y: -normal.y };
          refr = refract(d, normal, n, 1);
        }
        if (!refr) break; // total internal reflection — stop for simplicity
        const seg3 = intersectScene(cur, refr, {
          lensX: null,
          prism,
          screenX: this.state.showScreen ? this.screenX : null,
          w: CANVAS_W,
          h: CANVAS_H,
          skipLens: true,
          fromInside: true,
        });
        pts.push(seg3.point);
        if (seg3.kind !== 'prism') break;
        cur = seg3.point;
        d = refr;
        inside = !inside;
        hitPrismFace = seg3.face >= 0 ? seg3.face : (hitPrismFace + 1) % 3;
      }
    }

    return { pts, color };
  }

  private drawRay(g: CanvasRenderingContext2D, ray: Ray) {
    if (ray.pts.length < 2) return;
    g.strokeStyle = ray.color;
    g.globalAlpha = 0.85;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(ray.pts[0]!.x, ray.pts[0]!.y);
    for (let i = 1; i < ray.pts.length; i += 1) g.lineTo(ray.pts[i]!.x, ray.pts[i]!.y);
    g.stroke();
    g.globalAlpha = 1;
  }

  private drawSource(g: CanvasRenderingContext2D) {
    g.fillStyle = '#fde047';
    g.beginPath();
    g.arc(this.source.x, this.source.y, 7, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(253,224,71,0.4)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(this.source.x, this.source.y, 11, 0, Math.PI * 2);
    g.stroke();
  }

  private drawLens(g: CanvasRenderingContext2D) {
    if (this.state.lensType === 'none' || this.state.showPrism) return;
    const h = CANVAS_H;
    const top = h * 0.15;
    const bot = h * 0.85;
    g.strokeStyle = this.state.lensType === 'convex' ? '#67e8f9' : '#c4b5fd';
    g.lineWidth = 3;
    g.beginPath();
    if (this.state.lensType === 'convex') {
      g.moveTo(this.lensX, top);
      g.quadraticCurveTo(this.lensX - 18, h / 2, this.lensX, bot);
      g.quadraticCurveTo(this.lensX + 18, h / 2, this.lensX, top);
    } else {
      g.moveTo(this.lensX - 18, top);
      g.lineTo(this.lensX + 18, top);
      g.lineTo(this.lensX + 18, bot);
      g.lineTo(this.lensX - 18, bot);
      g.closePath();
    }
    g.stroke();
    // Focal markers.
    const f = this.state.lensType === 'convex' ? this.state.focal : -this.state.focal;
    g.fillStyle = 'rgba(103,232,249,0.5)';
    g.beginPath();
    g.arc(this.lensX - f, h / 2, 3, 0, Math.PI * 2);
    g.arc(this.lensX + f, h / 2, 3, 0, Math.PI * 2);
    g.fill();
  }

  private drawPrism(g: CanvasRenderingContext2D, verts: [Pt, Pt, Pt]) {
    g.fillStyle = 'rgba(120,180,255,0.12)';
    g.strokeStyle = '#7dd3fc';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(verts[0]!.x, verts[0]!.y);
    g.lineTo(verts[1]!.x, verts[1]!.y);
    g.lineTo(verts[2]!.x, verts[2]!.y);
    g.closePath();
    g.fill();
    g.stroke();
  }

  private drawScreen(g: CanvasRenderingContext2D, h: number) {
    g.strokeStyle = 'rgba(226,232,240,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(this.screenX, h * 0.1);
    g.lineTo(this.screenX, h * 0.9);
    g.stroke();
  }
}

// ---- Geometry helpers -------------------------------------------------------

function normalize(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

function outwardNormal(a: Pt, b: Pt, inside: Pt): Pt {
  const edge = { x: b.x - a.x, y: b.y - a.y };
  let n = normalize({ x: -edge.y, y: edge.x });
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (dot(n, { x: inside.x - mid.x, y: inside.y - mid.y }) < 0) n = { x: -n.x, y: -n.y };
  return n;
}

/** Snell refraction (vector form). Returns null on total internal reflection. */
function refract(d: Pt, n: Pt, n1: number, n2: number): Pt | null {
  const cosI = -dot(d, n);
  const eta = n1 / n2;
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k < 0) return null;
  const t = {
    x: eta * d.x + (eta * cosI - Math.sqrt(k)) * n.x,
    y: eta * d.y + (eta * cosI - Math.sqrt(k)) * n.y,
  };
  return normalize(t);
}

function pointInTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
function sign(p: Pt, a: Pt, b: Pt): number {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

interface SceneOpts {
  lensX: number | null;
  prism: [Pt, Pt, Pt] | null;
  screenX: number | null;
  w: number;
  h: number;
  skipLens?: boolean;
  fromInside?: boolean;
}

interface Hit {
  point: Pt;
  kind: 'lens' | 'prism' | 'screen' | 'edge';
  face: number;
}

/** March a ray to the nearest scene element or canvas edge. */
function intersectScene(o: Pt, d: Pt, opt: SceneOpts): Hit {
  let best = Infinity;
  let kind: Hit['kind'] = 'edge';
  let face = -1;
  let point: Pt = { x: o.x + d.x * 4000, y: o.y + d.y * 4000 };

  const considerLine = (hit: Pt, dist: number, k: Hit['kind'], f = -1) => {
    if (dist > 1e-3 && dist < best) {
      best = dist;
      kind = k;
      face = f;
      point = hit;
    }
  };

  if (opt.lensX !== null && !opt.skipLens) {
    if (Math.abs(d.x) > 1e-6) {
      const t = (opt.lensX - o.x) / d.x;
      if (t > 0) considerLine({ x: opt.lensX, y: o.y + d.y * t }, t, 'lens');
    }
  }
  if (opt.screenX !== null) {
    if (Math.abs(d.x) > 1e-6) {
      const t = (opt.screenX - o.x) / d.x;
      if (t > 0) considerLine({ x: opt.screenX, y: o.y + d.y * t }, t, 'screen');
    }
  }
  if (opt.prism) {
    const verts = opt.prism;
    const edges: [Pt, Pt][] = [
      [verts[0]!, verts[1]!],
      [verts[1]!, verts[2]!],
      [verts[2]!, verts[0]!],
    ];
    for (let i = 0; i < 3; i += 1) {
      const hit = raySeg(o, d, edges[i]![0], edges[i]![1]);
      if (hit) {
        const dist = Math.hypot(hit.x - o.x, hit.y - o.y);
        considerLine(hit, dist, 'prism', i);
      }
    }
  }
  // Canvas edges.
  const edges: [Pt, Pt][] = [
    [{ x: 0, y: 0 }, { x: opt.w, y: 0 }],
    [{ x: 0, y: opt.h }, { x: opt.w, y: opt.h }],
    [{ x: 0, y: 0 }, { x: 0, y: opt.h }],
    [{ x: opt.w, y: 0 }, { x: opt.w, y: opt.h }],
  ];
  for (const e of edges) {
    const hit = raySeg(o, d, e[0], e[1]);
    if (hit) {
      const dist = Math.hypot(hit.x - o.x, hit.y - o.y);
      considerLine(hit, dist, 'edge');
    }
  }
  return { point, kind, face };
}

function raySeg(o: Pt, d: Pt, a: Pt, b: Pt): Pt | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = d.x * ey - d.y * ex;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / denom; // along ray
  const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / denom; // along segment
  if (t > 1e-3 && u >= 0 && u <= 1) return { x: o.x + d.x * t, y: o.y + d.y * t };
  return null;
}

export default function createOpticsPlugin(): Plugin {
  return new OpticsPlugin();
}
