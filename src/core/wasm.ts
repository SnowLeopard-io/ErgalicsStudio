// ==========================================================================
// WASM module loader (spec §3.1.3, §11.1: retry 3x, 1s interval)
// ==========================================================================

import { logger } from './logger';
import type {
  BindingDescriptor,
  ComputeKernel,
  ComputeQueue,
  GpuBuffer,
  KernelDescriptor,
} from '@/native/ergalics_core';

export interface WasmModule {
  core_version(): string;
  /** Numeric `FileKind` enum (0=Magic, 1=Extension, 2=Unknown) — see `@/native/ergalics_core`. */
  detect_file_kind(prefix: Uint8Array): number | undefined;
  log(message: string): void;
  /** Compute surface (present on the native core build). */
  GpuBuffer?: typeof GpuBuffer;
  ComputeKernel?: typeof ComputeKernel;
  KernelDescriptor?: typeof KernelDescriptor;
  BindingDescriptor?: typeof BindingDescriptor;
  ComputeQueue?: typeof ComputeQueue;
}

let module: WasmModule | null = null;
let loading: Promise<WasmModule | null> | null = null;

export const MAX_WASM_RETRIES = 3;
export const WASM_RETRY_DELAY_MS = 1000;

async function tryLoad(): Promise<WasmModule | null> {
  try {
    // @vite-ignore — resolved lazily; module may be absent in dev until built.
    const mod = await import('@/native/ergalics_core.js');
    const init = mod.default as unknown as (() => Promise<unknown>) | undefined;
    if (typeof init === 'function') {
      await init();
    }
    try {
      logger.info('wasm', 'module loaded, core version:', mod.core_version());
    } catch {
      logger.warn('wasm', 'module loaded but core bindings unavailable');
    }
    return mod as unknown as WasmModule;
  } catch (err) {
    logger.warn('wasm', 'load attempt failed', err);
    return null;
  }
}

export function loadWasm(): Promise<WasmModule | null> {
  if (module) return Promise.resolve(module);
  if (loading) return loading;

  const attempt = (async () => {
    for (let attemptNo = 1; attemptNo <= MAX_WASM_RETRIES; attemptNo += 1) {
      const loaded = await tryLoad();
      if (loaded) {
        module = loaded;
        return loaded;
      }
      if (attemptNo < MAX_WASM_RETRIES) {
        await new Promise((r) => setTimeout(r, WASM_RETRY_DELAY_MS));
      }
    }
    return null;
  })();
  loading = attempt;
  // Only `module` is cached on success. On failure drop the cached promise so
  // a later call can retry — a transient failure (dev-server rebuild, brief
  // network blip) used to poison the whole session.
  void attempt.finally(() => {
    if (loading === attempt) loading = null;
  });
  return loading;
}

export function getWasm(): WasmModule | null {
  return module;
}

export async function wasmStatus(): Promise<'loaded' | 'failed' | 'pending'> {
  if (module) return 'loaded';
  const m = await loadWasm();
  return m ? 'loaded' : 'failed';
}