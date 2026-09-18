// ==========================================================================
// Ergalics Studio — R language runtime abstraction (FR-04)
//
// Code-mode R runs on a pluggable runtime behind one interface:
//
//   • `webr`        — the full R runtime (real R interpreter in a Worker,
//                     free-form syntax + CRAN packages). Optional: the webR
//                     bundle is vendored same-origin (public/webr) or exposed
//                     as `globalThis.WebR`; it is deliberately NOT an npm
//                     dependency, so hosts without it fall back cleanly.
//   • `builtin-ir`  — the existing built-in IR engine (studio DSL through
//                     parseCodeToIR('r') + interpret), wrapped so current
//                     behaviour never regresses.
//
// `studio.*` semantics are shared with Python / block mode: the builtin
// runtime executes against the workbench StudioApi; the webR runtime injects
// a best-effort `studio` bridge into the R session.
// ==========================================================================

import type { DataValue } from '@/types/datatable';

/** Which engine backs an `RLanguageRuntime`. */
export type REngine = 'webr' | 'builtin-ir';

/** Load progress event emitted by `load(onProgress)`. */
export interface RLoadProgress {
  stage: 'probe' | 'boot' | 'studio' | 'ready';
  /** Coarse 0–100 completion estimate (never exact — downloads vary). */
  percent: number;
}

/** One execution result, uniform across engines. */
export interface RExecResult {
  ok: boolean;
  /** Console text produced by the full runtime (webr only). */
  stdout?: string;
  /** Panel-ready variables (builtin-ir only; webr snapshot is a TODO). */
  variables?: Record<string, DataValue>;
  error?: string;
  durationMs: number;
  /** Statements degraded to RawCode (builtin-ir only). */
  skippedCount?: number;
}

export interface RLanguageRuntime {
  /** `true` only for the full webR runtime (free syntax + packages). */
  readonly isFullRuntime: boolean;
  readonly engine: REngine;
  /** Boot the engine; resolves once `exec` is usable. */
  load(onProgress?: (progress: RLoadProgress) => void): Promise<void>;
  /** Run a program to completion. */
  exec(code: string): Promise<RExecResult>;
  /** Install a CRAN package (full runtime only; builtin throws). */
  install(pkg: string): Promise<void>;
  /** Abort the in-flight run. The caller is expected to restart afterwards. */
  interrupt(): Promise<void>;
  /** Tear the engine down (idempotent). */
  dispose(): Promise<void>;
}

/** Error thrown when the optional webR bundle cannot be located/loaded. */
export class WebRUnavailableError extends Error {
  readonly code = 'webr-unavailable';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WebRUnavailableError';
  }
}

/** Validate a CRAN package name before asking the runtime to install it. */
export function isValidRPkgName(pkg: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._]*$/.test(pkg);
}
