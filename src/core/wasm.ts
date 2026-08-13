// ==========================================================================
// WASM module loader (spec §3.1.3, §11.1: retry 3x, 1s interval)
// ==========================================================================

import { logger } from './logger';

export interface WasmModule {
  core_version(): string;
  detect_file_kind(prefix: Uint8Array): string | undefined;
  log(message: string): void;
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

  loading = (async () => {
    for (let attempt = 1; attempt <= MAX_WASM_RETRIES; attempt += 1) {
      const loaded = await tryLoad();
      if (loaded) {
        module = loaded;
        return loaded;
      }
      if (attempt < MAX_WASM_RETRIES) {
        await new Promise((r) => setTimeout(r, WASM_RETRY_DELAY_MS));
      }
    }
    return null;
  })();

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