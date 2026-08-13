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
  if (!('gpu' in navigator)) {
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
  }

  try {
    const gpu = navigator.gpu as GPU;
    const adapter = await gpu.requestAdapter({
      powerPreference: 'high-performance',
      // forceFallbackAdapter only honoured for CPU fallback request
      forceFallbackAdapter: mode === 'cpu-fallback',
    });

    if (!adapter) {
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
    }

    const info = adapter.info as { vendor?: string; architecture?: string; device?: string; description?: string };
    const deviceName =
      info.device || info.description || `${info.vendor ?? ''} ${info.architecture ?? ''}`.trim() || 'Unknown';

    const device = await adapter.requestDevice();
    if (device.lost) {
      device.lost.then((reason: GPUDeviceLostInfo) => {
        logger.info('gpu', 'device lost', reason);
      });
    }
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
    current = {
      available: false,
      name: 'Unknown',
      backend: 'none',
      device: null,
      fallback: true,
      oom: false,
    };
  }
  emit();
  return current;
}

/** Release the current device (used when user forces CPU fallback). */
export function resetGpu(): void {
  current = { ...current, device: null, available: false, fallback: true };
  emit();
}

import { logger } from './logger';