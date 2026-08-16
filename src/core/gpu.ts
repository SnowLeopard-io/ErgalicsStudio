// ==========================================================================
// WebGPU device service (spec §3.1.3, §3.2.6, §11.1)
// ==========================================================================

export interface GpuBackend {
  available: boolean;
  name: string;
  backend: string;
  device: GPUDevice | null;
  fallback: boolean; // true when running in CPU fallback mode
  oom: boolean;
}

export type GpuBackendMode = 'auto' | 'cpu-fallback';

let current: GpuBackend = {
  available: false,
  name: 'Unknown',
  backend: 'webgpu',
  device: null,
  fallback: false,
  oom: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function getGpuBackend(): GpuBackend {
  return current;
}

export function subscribeGpu(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const inFlight = new Map<GpuBackendMode, Promise<GpuBackend>>();

/** Bumped by `resetGpu` so a still-in-flight `doInitGpu` that resolves later
 *  (a device request takes time) discards its result instead of re-applying a
 *  live device the user explicitly asked to release. */
let epoch = 0;

/** Cleanup for the currently attached device's listeners, if any. */
let activeCleanup: (() => void) | null = null;

function detachActive(): void {
  if (activeCleanup) {
    try {
      activeCleanup();
    } catch {
      /* listener removal must not break teardown */
    }
    activeCleanup = null;
  }
}

export async function initGpu(mode: GpuBackendMode = 'auto'): Promise<GpuBackend> {
  // Concurrency guard: WelcomePage calls initGpu twice (effect + enterWorkbench).
  // Coalesce per-mode so a "force CPU fallback" request issued while an 'auto'
  // init is in flight is honored instead of silently returning the auto result.
  const existing = inFlight.get(mode);
  if (existing) return existing;
  const run = doInitGpu(mode).finally(() => {
    inFlight.delete(mode);
  });
  inFlight.set(mode, run);
  return run;
}

async function doInitGpu(mode: GpuBackendMode = 'auto'): Promise<GpuBackend> {
  // Record the epoch we started under: if resetGpu runs while this init is in
  // flight, the freshly created device below must be discarded, not applied.
  const myEpoch = epoch;

  const fallback = (): GpuBackend => {
    detachActive();
    current = {
      available: false,
      name: 'Unknown',
      backend: 'none',
      device: null,
      fallback: true,
      oom: false,
    };
    emit();
    return current;
  };

  if (!('gpu' in navigator)) return fallback();

  try {
    const gpu = navigator.gpu as GPU;
    const adapter = await gpu.requestAdapter({
      powerPreference: 'high-performance',
      // forceFallbackAdapter only honoured for CPU fallback request
      forceFallbackAdapter: mode === 'cpu-fallback',
    });

    if (!adapter) return fallback();

    const info = adapter.info as { vendor?: string; architecture?: string; device?: string; description?: string };
    const deviceName =
      info.device || info.description || `${info.vendor ?? ''} ${info.architecture ?? ''}`.trim() || 'Unknown';

    const device = await adapter.requestDevice();

    if (myEpoch !== epoch) {
      // A reset happened while we were initializing. Discard this device
      // without touching `current` (which the reset already downgraded).
      try {
        (device as unknown as { destroy(): void }).destroy();
      } catch {
        /* device already lost */
      }
      return fallback();
    }

    const onUncapturedError = ((event: Event) => {
      const e = event as GPUUncapturedErrorEvent;
      logger.warn('gpu', 'uncaptured error', e.error?.message);
      if (e.error?.constructor?.name === 'GPUOutOfMemoryError') {
        current = { ...current, oom: true };
        emit();
      }
    }) as EventListener;
    device.addEventListener('uncapturederror', onUncapturedError);

    const detach = () => {
      try {
        device.removeEventListener('uncapturederror', onUncapturedError);
      } catch {
        /* ignore */
      }
    };

    device.lost.then((reason: GPUDeviceLostInfo) => {
      logger.warn('gpu', 'device lost', reason.reason ?? reason.message);
      // Stop advertising a dead device: every subsequent GPU op would fail
      // silently. Flag the backend unavailable so plugins fall back to CPU.
      if (current.device === device) {
        if (activeCleanup === detach) activeCleanup = null;
        detach();
        current = { ...current, available: false, device: null, fallback: true };
        emit();
      }
    });

    // Replacing an old device (re-init) must detach the previous listeners so
    // its uncaptured errors can no longer touch the new state.
    detachActive();
    activeCleanup = detach;

    current = {
      available: true,
      name: deviceName,
      backend: 'webgpu',
      device,
      fallback: mode === 'cpu-fallback',
      oom: false,
    };
  } catch (err) {
    logger.warn('gpu', 'adapter/device request failed, falling back', err);
    return fallback();
  }
  emit();
  return current;
}

/** Release the current device (used when user forces CPU fallback). */
export function resetGpu(): void {
  // Invalidate any in-flight init so its later result is discarded.
  epoch += 1;
  const prev = current.device;
  // Detach listeners on the old device so its errors can't touch new state.
  detachActive();
  current = { ...current, device: null, available: false, fallback: true };
  if (prev) {
    try {
      // GPUDevice.destroy() exists at runtime but is absent from this TS lib.dom.
      (prev as unknown as { destroy(): void }).destroy();
    } catch {
      /* device already lost */
    }
  }
  emit();
}

import { logger } from './logger';