// ==========================================================================
// Boot sequence gate.
//
// The studio is deployed on GitHub Pages; users on slow links (notably from
// mainland China) used to reach the workbench while its chunks were still
// downloading and could crash it by interacting with a half-mounted app.
// This module defines the readiness checklist that must complete before the
// UI is revealed:
//
//   1. "modules"  — every static resource finished loading (window load) AND
//                   the two route chunks the first screens need (welcome +
//                   workbench) are prefetched, so entering the workbench
//                   never waits on the network again.
//   2. "engine"   — the compute engines are probed (WebGPU adapter + WASM
//                   core). Both degrade gracefully internally, so a probe
//                   failure never blocks startup — it only decides which
//                   backend the app will use.
//   3. "plugins"  — every autoload built-in plugin is warmed + registered,
//                   so the workbench opens with its full registry instead of
//                   plugins popping in one by one.
//
// A watchdog bounds the whole sequence: on timeout the caller may offer an
// "enter anyway" escape hatch instead of trapping the user behind the splash.
// ==========================================================================

import { initGpu } from './gpu';
import { wasmStatus } from './wasm';
import { initDesktopPlatform } from './platform/bootstrap';

export type BootStep = 'modules' | 'engine' | 'plugins';
export type BootOutcome = 'ready' | 'failed' | 'timeout';

export interface BootOptions {
  /** Hard cap for the whole sequence (default 45s — slow links included). */
  timeoutMs?: number;
  onStep?: (step: BootStep) => void;
}

/** Fade-out duration — keep in sync with the `#boot` CSS transition. */
export const BOOT_FADE_MS = 450;

function waitForWindowLoad(): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener('load', () => resolve(), { once: true });
  });
}

/**
 * Run the readiness checklist. Never rejects: failures surface as a
 * `failed` outcome so the UI can offer a retry instead of crashing.
 */
export async function runBoot(opts: BootOptions = {}): Promise<BootOutcome> {
  const { timeoutMs = 45_000, onStep } = opts;

  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
  }, timeoutMs);

  try {
    // --- 0. platform adapters ---------------------------------------------
    // Inside Electron this swaps in the IPC-backed git adapter (simple-git)
    // and marks the real-Python channel as preferred. No-op on the web.
    initDesktopPlatform();

    // --- 1. core modules -------------------------------------------------
    onStep?.('modules');
    await waitForWindowLoad();
    // Prefetch the chunks behind the first two screens. The dynamic imports
    // also make Rollup emit modulepreload hints for them, so browsers start
    // fetching during HTML parse — before this code even runs.
    const chunks = await Promise.allSettled([
      import('@/pages/welcome/WelcomePage'),
      import('@/pages/workbench/WorkbenchPage'),
    ]);
    if (chunks.some((c) => c.status === 'rejected')) {
      clearTimeout(watchdog);
      return 'failed';
    }
    if (timedOut) return 'timeout';

    // --- 2. compute engines ----------------------------------------------
    onStep?.('engine');
    // initGpu coalesces concurrent calls; WelcomePage's own probe later
    // reuses this result. allSettled: probe failure = CPU fallback, not a
    // boot failure.
    await Promise.allSettled([initGpu(), wasmStatus()]);
    if (timedOut) return 'timeout';

    // --- 3. built-in plugins ----------------------------------------------
    // Warm + register every autoload plugin so the workbench never shows the
    // "plugins popping in one by one" sequence. ensureBuiltinsLoaded caches
    // its promise, so WorkbenchPage's own call later reuses this result.
    onStep?.('plugins');
    const { usePluginStore } = await import('@/stores/pluginStore');
    await usePluginStore.getState().ensureBuiltinsLoaded();
    // Fully done — even if the watchdog fired mid-way, everything is ready.
    clearTimeout(watchdog);
    return 'ready';
  } catch {
    clearTimeout(watchdog);
    return 'failed';
  }
}

// --------------------------------------------------------------------------
// Chunk-load crash recovery.
//
// A stale cached HTML (PWA / browser cache) referencing hashed chunks that
// no longer exist after a redeploy rejects its dynamic imports with an
// unrecoverable error — the user sees a dead page. One automatic reload per
// session re-fetches the fresh manifest; the sessionStorage marker prevents
// a reload loop if the site itself is broken.
// --------------------------------------------------------------------------

const RELOAD_MARKER = 'ergalics:boot-chunk-reloaded';

const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;

export function installBootChunkRecovery(): void {
  try {
    if (sessionStorage.getItem(RELOAD_MARKER)) return;
  } catch {
    /* storage unavailable — skip the guard, keep the recovery */
  }
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as Error | string | undefined;
    const message = typeof reason === 'string' ? reason : reason?.message ?? '';
    if (!CHUNK_ERROR_PATTERN.test(message)) return;
    try {
      sessionStorage.setItem(RELOAD_MARKER, '1');
    } catch {
      /* ignore */
    }
    window.location.reload();
  });
}
