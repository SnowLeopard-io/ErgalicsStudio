// ==========================================================================
// Ergalics Studio — R runtime factory (FR-04)
//
// One entry point for code-mode R: `createRRuntime({ preferFull })`.
//
//   • preferFull=true (the default when the user picks R): try the webR full
//     runtime; if the bundle is missing / fails to boot, fall back to the
//     built-in IR engine and record WHY (`fallbackReason`) so the UI can tell
//     the user and keep the page responsive.
//   • preferFull=false: go straight to the built-in IR engine (never probes).
//
// The built-in path must always succeed — it has no external requirement —
// so R code mode is guaranteed to run even on hosts without the webR bundle.
// ==========================================================================

import { logger } from '@/core/logger';
import { BuiltinIRRuntime } from './builtin-ir-runtime';
import { WebRRuntime } from './webr-runtime';
import type { RLanguageRuntime } from './types';
import type { StudioApi } from '@/editor/runtime/studio-api';

export interface CreateRRuntimeOptions {
  /** Attempt the full webR runtime first (default: true). */
  preferFull?: boolean;
  /** Builder for the `studio.*` API the builtin IR engine executes against. */
  getStudioApi: () => StudioApi;
  /** Host-side studio sink forwarded to the webR bridge (best effort). */
  onStudioCall?: (method: string, argsJson: string) => void;
  /** Override the webR module URL (tests / non-standard vendoring layout). */
  webrModuleUrl?: string;
  /** Progress callback for the full-runtime boot (UI loading indicator). */
  onProgress?: (percent: number) => void;
}

export interface RRuntimeCreation {
  runtime: RLanguageRuntime;
  /** Engine actually selected (may differ from the request after fallback). */
  engine: RLanguageRuntime['engine'];
  /** Why the full runtime was abandoned; undefined when it loaded. */
  fallbackReason?: string;
}

function createBuiltin(getStudioApi: () => StudioApi): BuiltinIRRuntime {
  return new BuiltinIRRuntime({ getStudioApi });
}

/**
 * Create the R runtime for a code session. Resolves with the builtin engine
 * whenever webR cannot be used — it never rejects, so the editor can always
 * run R (in degraded DSL mode, clearly flagged by `fallbackReason`).
 */
export async function createRRuntime(
  options: CreateRRuntimeOptions,
): Promise<RRuntimeCreation> {
  const { preferFull = true, getStudioApi } = options;

  if (!preferFull) {
    const runtime = createBuiltin(getStudioApi);
    await runtime.load();
    return { runtime, engine: 'builtin-ir' };
  }

  try {
    const webr = new WebRRuntime({
      onStudioCall: options.onStudioCall,
      moduleUrl: options.webrModuleUrl,
    });
    await webr.load((p) => options.onProgress?.(p.percent));
    return { runtime: webr, engine: 'webr' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn('r-runtime', `full R runtime unavailable, falling back to builtin IR: ${reason}`);
    const runtime = createBuiltin(getStudioApi);
    await runtime.load();
    return { runtime, engine: 'builtin-ir', fallbackReason: reason };
  }
}
