// ==========================================================================
// Forced landscape — mobile adaptation (portrait is not a supported layout).
//
// Layered strategy, strongest to weakest (covered by tests/orientation.test.ts):
//   1. public/manifest.webmanifest `"orientation": "landscape"` — an installed
//      PWA launches directly in landscape on Android and iOS.
//   2. screen.orientation.lock('landscape') here — attempted at startup and
//      re-attempted whenever the device rotates back to portrait. Android
//      Chrome honours it in standalone/fullscreen contexts; every other
//      engine rejects, which is expected and swallowed.
//   3. The CSS portrait guard (PortraitGuard in App.tsx + app.css) — on
//      engines with no lock API at all (iOS Safari) a blocking
//      "rotate to landscape" overlay stands in for the lock.
//
// The lock is best-effort by spec (NotSupportedError / SecurityError outside
// fullscreen); every failure is swallowed so a rejected promise can never
// surface as an application error.
// ==========================================================================

/** The lock mode we ask the platform for. `landscape` rather than
 *  `landscape-primary` keeps both landscape directions allowed, so the user
 *  may rotate the phone either way while portrait stays refused. */
export const LANDSCAPE_LOCK_MODE = 'landscape';

/** Phone-sized viewport query — mirrors the compact media block in app.css.
 *  Exported so tests can assert the TS constant and the CSS stay in sync
 *  (the panel-overlay + scale tiers key off this exact query). */
export const COMPACT_VIEWPORT_QUERY = '(max-width: 1024px) and (max-height: 560px)';

/** Pure: orientation of a viewport from its CSS-pixel dimensions. Square
 *  viewports count as landscape (width wins — no benefit to flipping). */
export function isPortraitViewport(width: number, height: number): boolean {
  return height > width;
}

/** Structural view of ScreenOrientation: `lock` is missing from some TS lib
 *  dom versions (and from most engines at runtime), so the API surface is
 *  declared here rather than inherited from the DOM type. */
interface LockableOrientation {
  lock?: (mode: string) => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function currentOrientation(): LockableOrientation | undefined {
  if (typeof screen === 'undefined') return undefined;
  return screen.orientation as unknown as LockableOrientation | undefined;
}

/** Attempt the platform landscape lock. Resolves true only when the engine
 *  accepted the request; everything else (no API, rejected lock — desktop
 *  Chrome without fullscreen, iOS Safari, embedded webviews) resolves false. */
export async function lockLandscape(): Promise<boolean> {
  const orientation = currentOrientation();
  if (!orientation || typeof orientation.lock !== 'function') return false;
  try {
    await orientation.lock(LANDSCAPE_LOCK_MODE);
    return true;
  } catch {
    return false;
  }
}

/** Coarse-pointer (touch-class) heuristic: desktop windows never attempt the
 *  lock, so a portrait-shaped desktop window gets no pointless rejections. */
function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : true;
  } catch {
    return true;
  }
}

let activeTeardown: (() => void) | null = null;

/**
 * Wire up forced landscape: lock at startup, re-lock on every rotation event,
 * and re-lock on resize only while the viewport is actually portrait (throttled
 * — engines that ignore the lock would otherwise reject a promise per pixel of
 * a window drag). Safe to call in non-DOM environments (node tests): returns
 * a no-op teardown. Re-calling replaces the previous wiring instead of
 * stacking listeners (HMR / double init).
 *
 * Returns the teardown that removes every listener installed here.
 */
export function initOrientationLock(): () => void {
  activeTeardown?.();
  if (typeof window === 'undefined') {
    activeTeardown = null;
    return () => undefined;
  }

  let lastResizeAttempt = 0;

  // Rotation events force an attempt even when currently landscape: that is
  // the moment the user just left portrait (or the OS re-granted it) and the
  // lock must be re-established before the next frame settles.
  const onRotate = () => {
    if (!coarsePointer()) return;
    void lockLandscape();
  };

  // Viewport resize without a rotation event (webview chrome, foldables).
  // Only worthwhile while portrait — and throttled to once a second.
  const onResize = () => {
    if (!coarsePointer()) return;
    const now = Date.now();
    if (now - lastResizeAttempt < 1000) return;
    if (!isPortraitViewport(window.innerWidth, window.innerHeight)) return;
    lastResizeAttempt = now;
    void lockLandscape();
  };

  const screenOrientation = currentOrientation();
  // Older Safari exposes screen.orientation without a working change event —
  // addEventListener is optional-chained, window covers those engines.
  screenOrientation?.addEventListener?.('change', onRotate);
  window.addEventListener('orientationchange', onRotate);
  window.addEventListener('resize', onResize);

  onRotate(); // startup attempt

  const teardown = () => {
    screenOrientation?.removeEventListener?.('change', onRotate);
    window.removeEventListener('orientationchange', onRotate);
    window.removeEventListener('resize', onResize);
    if (activeTeardown === teardown) activeTeardown = null;
  };
  activeTeardown = teardown;
  return teardown;
}
