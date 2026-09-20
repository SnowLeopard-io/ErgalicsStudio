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

/**
 * Snapshot of the current viewport. Returns a copy on purpose: this used to
 * hand out the live internal object, so a caller that cached the result kept
 * reading stale values (setViewport2d replaces the object), and could even
 * mutate the global view by writing a field.
 */
export function getViewport2d(): Viewport2D {
  return { ...current };
}

export function setViewport2d(next: Viewport2D): void {
  current = { ...next };
}

export function resetViewport2d(): void {
  current = { ...DEFAULT_VIEWPORT };
}

const hookedCanvases = new WeakSet<HTMLCanvasElement>();

/**
 * Display density used for the 2D backing store. Every plugin draw starts with
 * `canvas.width = clientWidth` (CSS pixels), which on 125%/150% Windows
 * scaling stretched a CSS-sized bitmap over the element — the source of the
 * global canvas blur. We transparently enlarge the bitmap by the dpr (capped
 * at 2, matching the 3D renderer) while keeping the plugin-facing coordinate
 * space in CSS pixels.
 */
const dpr = (): number => Math.min(window.devicePixelRatio || 1, 2);

/**
 * Hook the canvas so the 2D context transform follows the viewport. Applied
 * after every `canvas.width`/`height` assignment (which resets the context),
 * i.e. once at the start of each plugin draw. Idempotent per canvas; non-2d
 * canvases (the 3D surface, plugin-scoped canvases) are untouched.
 *
 * The width/height hooks also apply the dpr scaling transparently: a write of
 * the logical (CSS) size W allocates a W·dpr bitmap, and a read reports
 * bitmap/dpr back so plugin layout math that mixes reads and writes stays
 * self-consistent in CSS coordinates.
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
    // Read the live object directly: this runs on every width/height write,
    // i.e. once per frame per draw, so a copy here would be pure GC churn.
    // The dpr factor maps the plugin's CSS-coordinate drawing onto the
    // enlarged physical bitmap.
    const vp = current;
    const d = dpr();
    g.setTransform(vp.scale * d, 0, 0, vp.scale * d, vp.x * d, vp.y * d);
  };

  const hookDimension = (
    prop: 'width' | 'height',
    desc: PropertyDescriptor,
  ): void => {
    Object.defineProperty(canvas, prop, {
      get() {
        // Report the logical size (physical buffer ÷ dpr) so read-back is
        // consistent with what the plugin wrote, regardless of the display dpr.
        return Math.round((desc.get!.call(this) as number) / dpr());
      },
      set(v: number) {
        // Physical buffer = logical CSS size × dpr (never below 1 device px).
        const d = dpr();
        desc.set!.call(this, Math.max(1, Math.round((v as number) * d)));
        applyViewport();
      },
      configurable: true,
    });
  };
  hookDimension('width', widthDesc);
  hookDimension('height', heightDesc);
}

/**
 * Clear the canvas in the fixed (viewport) coordinate space, regardless of the
 * current view transform. The hooked width/height getters report logical
 * sizes, so the physical bitmap is dpr× larger — scale the clear rect up.
 */
export function clearCanvas2dInViewport(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const d = dpr();
  g.clearRect(0, 0, canvas.width * d, canvas.height * d);
}