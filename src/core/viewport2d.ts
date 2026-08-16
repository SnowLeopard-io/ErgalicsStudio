// ==========================================================================
// 2D viewport pan/zoom (host-side).
//
// Drag-to-pan and wheel-to-zoom for every 2D plugin. The shared canvas keeps a
// fixed viewport-sized bitmap, so panning the canvas *element* can only ever
// reveal an empty bitmap edge (the "content is truncated" bug). Instead the
// current pan/zoom is injected into the context transform: the plugin
// re-renders from its data on each viewport change, so content that was
// previously outside the frame is actually drawn again and appears inside the
// fixed frame.
//
// Every built-in 2D plugin starts its draw with `canvas.width = clientWidth`
// (and height), an assignment that also resets the context transform. Hooking
// the width/height setters lets us apply the viewport transform exactly once
// per frame — no per-call proxy overhead, so a drag tracks the cursor closely.
// ==========================================================================

export interface Viewport2D {
  /** Pan offset in device pixels. */
  x: number;
  /** Pan offset in device pixels. */
  y: number;
  /** Zoom factor (1 = fit). */
  scale: number;
}

const DEFAULT_VIEWPORT: Viewport2D = { x: 0, y: 0, scale: 1 };

let current: Viewport2D = { ...DEFAULT_VIEWPORT };

export function getViewport2d(): Viewport2D {
  return current;
}

export function setViewport2d(next: Viewport2D): void {
  current = { ...next };
}

export function resetViewport2d(): void {
  current = { ...DEFAULT_VIEWPORT };
}

const hookedCanvases = new WeakSet<HTMLCanvasElement>();

/**
 * Hook the canvas so the 2D context transform follows the viewport. Applied
 * after every `canvas.width`/`height` assignment (which resets the context),
 * i.e. once at the start of each plugin draw. Idempotent per canvas; non-2d
 * canvases (the 3D surface, plugin-scoped canvases) are untouched.
 */
export function wrapCanvas2d(canvas: HTMLCanvasElement): void {
  if (hookedCanvases.has(canvas)) return;
  hookedCanvases.add(canvas);

  const proto = HTMLCanvasElement.prototype;
  const widthDesc = Object.getOwnPropertyDescriptor(proto, 'width');
  const heightDesc = Object.getOwnPropertyDescriptor(proto, 'height');
  if (!widthDesc?.set || !heightDesc?.set) return;

  const applyViewport = () => {
    const g = canvas.getContext('2d');
    if (!g) return;
    const vp = getViewport2d();
    g.setTransform(vp.scale, 0, 0, vp.scale, vp.x, vp.y);
  };

  Object.defineProperty(canvas, 'width', {
    get() {
      return widthDesc.get!.call(this) as number;
    },
    set(v: number) {
      widthDesc.set!.call(this, v);
      applyViewport();
    },
    configurable: true,
  });

  Object.defineProperty(canvas, 'height', {
    get() {
      return heightDesc.get!.call(this) as number;
    },
    set(v: number) {
      heightDesc.set!.call(this, v);
      applyViewport();
    },
    configurable: true,
  });
}

/**
 * Clear the canvas in the fixed (viewport) coordinate space, regardless of the
 * current view transform.
 */
export function clearCanvas2dInViewport(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
}