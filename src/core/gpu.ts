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

export async function initGpu(mode: GpuBackendMode = 'auto'): Promise<GpuBackend> {
  // Concurrency guard: WelcomePage calls initGpu twice (effect + enterWorkbench)
  // and re-runs it when the backend setting changes. Reusing the in-flight
  // promise prevents duplicate adapters/devices from being created.
  if (initPromise) return initPromise;
  initPromise = doInitGpu(mode).finally(() => {
    initPromise = null;
  });
  return initPromise;
}

let initPromise: Promise<GpuBackend> | null = null;

async function doInitGpu(mode: GpuBackendMode = 'auto'): Promise<GpuBackend> {
  const fallback = (): GpuBackend => {
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
    device.lost.then((reason: GPUDeviceLostInfo) => {
      logger.warn('gpu', 'device lost', reason.reason ?? reason.message);
      // Stop advertising a dead device: every subsequent GPU op would fail
      // silently. Flag the backend unavailable so plugins fall back to CPU.
      if (current.device === device) {
        current = { ...current, available: false, device: null, fallback: true };
        emit();
      }
    });
    device.addEventListener('uncapturederror', ((event: Event) => {
      const e = event as GPUUncapturedErrorEvent;
      logger.warn('gpu', 'uncaptured error', e.error?.message);
      if (e.error?.constructor?.name === 'GPUOutOfMemoryError') {
        current = { ...current, oom: true };
        emit();
      }
    }) as EventListener);

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
  const prev = current.device;
  current = { ...current, device: null, available: false, fallback: true };
  // Detach listeners on the old device so its errors can't touch new state.
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