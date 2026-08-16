// ==========================================================================
// 2D viewport pan/zoom (host-side).
//
// Drag-to-pan and wheel-to-zoom for every 2D plugin. The shared canvas keeps a
// fixed viewport-sized bitmap, so panning the canvas *element* can only ever
// reveal an empty bitmap edge (the "content is truncated" bug). Instead the
// current pan/zoom is injected into every drawing call through a
// Proxy-wrapped 2D context: the plugin re-renders from its data on each
// viewport change, so content that was previously outside the frame is
// actually drawn again and appears inside the fixed frame.
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

// Rendering/path primitives that must run under the view transform. Read and
// state APIs (getImageData, measureText, fillStyle, …) pass through untouched.
const DRAW_METHODS: ReadonlySet<string> = new Set([
  'fillRect',
  'strokeRect',
  'clearRect',
  'fillText',
  'strokeText',
  'beginPath',
  'moveTo',
  'lineTo',
  'closePath',
  'rect',
  'roundRect',
  'arc',
  'arcTo',
  'ellipse',
  'bezierCurveTo',
  'quadraticCurveTo',
  'fill',
  'stroke',
  'clip',
  'drawImage',
]);

/**
 * Wrap the shared 2D canvas so every drawing call is issued under the current
 * viewport transform (save → translate/scale → op → restore). Idempotent —
 * repeated calls reuse the same proxy. Non-2d contexts (e.g. WebGL on the 3D
 * canvas) are untouched.
 */
export function wrapCanvas2d(canvas: HTMLCanvasElement): void {
  const origGetContext = canvas.getContext.bind(canvas) as typeof canvas.getContext;
  let cached: CanvasRenderingContext2D | null = null;

  const handler: ProxyHandler<CanvasRenderingContext2D> = {
    get(target, prop) {
      // Reflect with receiver = target: accessor properties (fillStyle, font,
      // …) are getters that require the real context's internal slots — they
      // throw "Illegal invocation" if invoked with `this` = the proxy.
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!DRAW_METHODS.has(prop as string)) {
        // Pass-through methods (getImageData, measureText, …) must keep
        // `this` bound to the real context for the same reason.
        return value.bind(target);
      }
      return (...args: unknown[]) => {
        const vp = getViewport2d();
        target.save();
        target.translate(vp.x, vp.y);
        target.scale(vp.scale, vp.scale);
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        target.restore();
        return result;
      };
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  };

  canvas.getContext = ((contextId: string, ...options: unknown[]) => {
    if (contextId !== '2d') return origGetContext(contextId, ...(options as [any?]));
    if (!cached) {
      const raw = origGetContext('2d', ...(options as [any?]));
      if (!raw) return null;
      cached = new Proxy(raw, handler) as unknown as CanvasRenderingContext2D;
    }
    return cached;
  }) as typeof canvas.getContext;
}