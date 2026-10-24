// ==========================================================================
// Ergalics Studio — built-in IR runtime for code-mode R (FR-04 fallback)
//
// Wraps the existing restricted engine (R text → parseCodeToIR('r') → the
// shared IR interpreter) behind the `RLanguageRuntime` contract, so the
// current behaviour is preserved verbatim when webR is unavailable. The
// `studio.*` API is injected through `getStudioApi` — the very same workbench
// StudioApi block mode and the JavaScript code path use, keeping the three
// languages on one data semantic (editor architecture §8.2).
// ==========================================================================

import { parseCodeToIR } from '@/editor/code/parse';
import { interpret } from '@/editor/runtime/interpreter';
import type { StudioApi } from '@/editor/runtime/studio-api';
import {
  type RLanguageRuntime,
  type RExecResult,
  type RLoadProgress,
} from './types';

export interface BuiltinIRRuntimeOptions {
  /** Build the `studio.*` API the IR program executes against. Injected so
   *  this module stays free of store/DOM imports (Node-testable). */
  getStudioApi: () => StudioApi;
}

export class BuiltinIRRuntime implements RLanguageRuntime {
  readonly isFullRuntime = false;
  readonly engine = 'builtin-ir' as const;

  private readonly getStudioApi: () => StudioApi;
  private disposed = false;

  constructor(options: BuiltinIRRuntimeOptions) {
    this.getStudioApi = options.getStudioApi;
  }

  async load(onProgress?: (progress: RLoadProgress) => void): Promise<void> {
    // The IR interpreter is in-process and already available — boot is instant.
    onProgress?.({ stage: 'probe', percent: 50 });
    onProgress?.({ stage: 'ready', percent: 100 });
  }

  async exec(code: string): Promise<RExecResult> {
    if (this.disposed) throw new Error('R builtin-ir runtime has been disposed');
    const startedAt = Date.now();
    const { program, rawCount } = parseCodeToIR(code, 'r');
    const result = await interpret(program, this.getStudioApi());
    if (result.ok) {
      return {
        ok: true,
        variables: result.variables,
        durationMs: Date.now() - startedAt,
        skippedCount: rawCount,
      };
    }
    return {
      ok: false,
      error: result.error?.message ?? 'run failed',
      durationMs: Date.now() - startedAt,
      skippedCount: rawCount,
    };
  }

  async install(pkg: string): Promise<void> {
    throw new Error(
      `package "${pkg}" cannot be installed: the built-in IR engine has no package manager — load the full R runtime instead`,
    );
  }

  async interrupt(): Promise<void> {
    // IR programs are short-lived and interpreted synchronously per statement;
    // there is no long-running loop to abort (the UI clears its running flag).
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}
