// ==========================================================================
// Ergalics Studio — FR-20 PWA support module
//
// Service-worker registration (production only, feature-detected), install
// prompt capture (`beforeinstallprompt`), online/offline helpers, and the
// `needsNetwork()` catalogue that marks which resources require a live
// connection (model CDN fallback, external links, …).
// ==========================================================================

/** Minimal shape of the Chromium install prompt event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const onlineListeners = new Set<() => void>();

/** True when the browser supports service workers at all. */
export function swSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Register the offline service worker. No-op during dev (vite serves SW
 * files without build-time manifest injection) and in non-secure contexts.
 * Returns the registration promise when registration was attempted.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!swSupported()) return Promise.resolve(undefined);
  if (!import.meta.env.PROD) return Promise.resolve(undefined);
  if (!window.isSecureContext) return Promise.resolve(undefined);
  // `./sw.js` resolves against the app base (deployed under /<repo>/app/).
  const url = new URL('sw.js', document.baseURI).href;
  return navigator.serviceWorker
    .register(url)
    .then((reg) => {
      void reg.update().catch(() => undefined);
      return reg;
    })
    .catch(() => undefined);
}

/** Start tracking installability + connectivity (call once at startup). */
export function initPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    emitInstallable();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emitInstallable();
  });
  window.addEventListener('online', notifyOnline);
  window.addEventListener('offline', notifyOnline);
}

function notifyOnline(): void {
  onlineListeners.forEach((l) => l());
}

/** Reactive online-status subscription; returns an unsubscribe fn. */
export function subscribeOnline(listener: () => void): () => void {
  onlineListeners.add(listener);
  return () => onlineListeners.delete(listener);
}

/** Current connectivity (defaults to true in non-browser contexts). */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

/** The captured install prompt, or null when the app is not installable. */
export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

let installableListeners = new Set<() => void>();

function emitInstallable(): void {
  installableListeners.forEach((l) => l());
}

/** Subscribe to installability changes (prompt captured / installed). */
export function subscribeInstallable(listener: () => void): () => void {
  installableListeners.add(listener);
  return () => installableListeners.delete(listener);
}

/** Show the native install prompt; resolves with the user's outcome. */
export async function requestInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  emitInstallable();
  return outcome;
}

/** Whether the app currently runs inside an installed PWA window. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari exposes it as a navigator property instead.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// ---------------------------------------------------------------------------
// needsNetwork — catalogue of resources that cannot work offline.
// ---------------------------------------------------------------------------

export interface NetworkResource {
  id: string;
  /** i18n key describing the resource (rendered in the PWA settings panel). */
  labelKey: string;
  /** Why it needs a connection (i18n key). */
  reasonKey: string;
}

/**
 * Resources that REQUIRE network access. The vendored pyodide/blockly/webr
 * engines are cached by the service worker after first use; these entries are
 * the genuinely online-only paths.
 */
export const NETWORK_RESOURCES: NetworkResource[] = [
  {
    id: 'pyodide-cdn',
    labelKey: 'pwa.res.pyodide_cdn',
    reasonKey: 'pwa.res.pyodide_cdn_reason',
  },
  {
    id: 'model-import',
    labelKey: 'pwa.res.model_import',
    reasonKey: 'pwa.res.model_import_reason',
  },
  {
    id: 'external-links',
    labelKey: 'pwa.res.external',
    reasonKey: 'pwa.res.external_reason',
  },
];

/**
 * Does this request URL require network (i.e. is it NOT served offline)?
 * True for any cross-origin URL (model CDN, jsdelivr Pyodide fallback,
 * external docs) — the service worker deliberately bypasses those.
 * `base` defaults to the document base URI (or a synthetic same-origin base
 * in tests/node), so relative same-origin paths return false.
 */
export function needsNetwork(url: string, base?: string): boolean {
  const fallback =
    base ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/app/');
  try {
    let u: URL;
    if (/^[\w./\-#?=&%+~]+$/.test(url)) {
      // Conservative relative-path form (no scheme, no spaces/garbage).
      u = new URL(url, fallback);
    } else {
      try {
        u = new URL(url); // absolute form
      } catch {
        return true; // garbage → assume online
      }
    }
    const b = new URL(fallback);
    return u.origin !== b.origin;
  } catch {
    return true; // unparsable → assume online
  }
}
