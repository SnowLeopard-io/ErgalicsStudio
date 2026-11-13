// ==========================================================================
// Desktop Python client — real CPython over IPC, PyodideClient-compatible.
// ==========================================================================
// Mirrors the PyodideClient public surface (constructor options, runPython,
// repl, interrupt, dispose) so code mode's createCodeRuntime can swap
// runtimes based on platform without touching its call sites. Interrupt
// semantics are identical: kill + fresh interpreter.

import { logger } from '../logger';
import type { VariableSnapshot } from '../pyodide/protocol';
import { desktopBridge, type DesktopPythonApi } from './index';

interface DesktopPythonClientOptions {
  loadPackages?: string[];
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onNotify?: (kind: 'info' | 'success' | 'warning' | 'error', message: string) => void;
}

interface DesktopPythonRunResult {
  ok: boolean;
  variables: Record<string, VariableSnapshot>;
  /** Present for parity with Pyodide; the desktop channel does not collect
   *  workspace outputs yet, so it stays undefined. */
  files?: Record<string, string>;
  /** Present for parity with Pyodide; desktop CPython writes real files. */
  binaryFiles?: Record<string, string>;
  error?: string;
  durationMs: number;
}

export class DesktopPythonClient {
  private readonly options: DesktopPythonClientOptions;
  private readonly api: DesktopPythonApi;
  private sessionId: string | null = null;
  private readonly unsubscribers: (() => void)[] = [];
  private readonly pendingInterrupt = new Set<Promise<unknown>>();

  constructor(options: DesktopPythonClientOptions = {}) {
    this.options = options;
    this.api = desktopBridge().python;
    this.unsubscribers.push(
      this.api.onEvent((payload) => {
        const kind = payload['type'];
        if (kind === 'stdout') this.options.onStdout?.(String(payload['text'] ?? ''));
        else if (kind === 'stderr') this.options.onStderr?.(String(payload['text'] ?? ''));
        else if (kind === 'notify') {
          this.options.onNotify?.(
            (payload['kind'] as 'info' | 'success' | 'warning' | 'error') ?? 'info',
            String(payload['message'] ?? ''),
          );
        }
      }),
    );
  }

  private async ensureSession(): Promise<string> {
    if (!this.sessionId) {
      const { sessionId } = await this.api.sessionStart();
      this.sessionId = sessionId;
    }
    return this.sessionId;
  }

  async runPython(
    code: string,
    files: Record<string, string> = {},
    params: Record<string, unknown> = {},
  ): Promise<DesktopPythonRunResult> {
    const sessionId = await this.ensureSession();
    try {
      const res = await this.api.run({
        sessionId,
        code,
        files,
        params,
        loadPackages: this.options.loadPackages,
      });
      return {
        ok: res.ok,
        variables: res.variables as Record<string, VariableSnapshot>,
        error: res.error,
        durationMs: res.durationMs,
      };
    } catch (err) {
      // Session died (interrupt or crash): drop it so the next run is fresh —
      // same behavior as the Pyodide client's worker respawn.
      this.sessionId = null;
      throw err;
    }
  }

  // `preloadSource` is Pyodide-specific (it scans the script for imports to
  // auto-load wheels); desktop CPython already has the scientific stack.
  async repl(
    code: string,
    _preloadSource?: string,
  ): Promise<{ ok: boolean; text: string; error?: string }> {
    const sessionId = await this.ensureSession();
    try {
      return await this.api.repl(sessionId, code);
    } catch (err) {
      this.sessionId = null;
      throw err;
    }
  }

  /**
   * Desktop edition: the interpreter runs against the real project tree, so
   * there is nothing to mount — the browser (Pyodide) build is the one that
   * needs the workspace materialised in the virtual FS.
   */
  async mountWorkspace(
    _files: Record<string, string>,
    _dataFiles?: Record<string, string>,
  ): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  /** Desktop edition: CPython has no Pyodide wheels — installing is a no-op. */
  async installPackages(packages: string[]): Promise<{ ok: boolean; loaded: string[]; error?: string }> {
    return { ok: true, loaded: packages };
  }

  /** Desktop edition: real CPython imports straight from site-packages —
   *  there is no Pyodide loadedPackages snapshot to report. */
  async listPackages(): Promise<{ ok: boolean; packages: Record<string, string>; error?: string }> {
    return { ok: true, packages: {} };
  }

  /** Desktop edition: a fresh CPython session is the cleanest reset. */
  async resetNamespace(): Promise<boolean> {
    this.sessionId = null;
    return true;
  }

  /** Desktop edition: the interpreter writes straight into the project tree,
   *  so there is nothing to collect back. */
  async collectWorkspaceFiles(): Promise<{
    ok: boolean;
    files: Record<string, string>;
    binaryFiles?: Record<string, string>;
    error?: string;
  }> {
    return { ok: true, files: {}, binaryFiles: {} };
  }

  interrupt(): void {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.pendingInterrupt.add(this.api.interrupt(sessionId).catch(() => {}));
    this.sessionId = null;
  }

  dispose(): void {
    void (async () => {
      for (const p of this.pendingInterrupt) {
        try { await p; } catch { /* ignore */ }
      }
      if (this.sessionId) {
        try { await this.api.sessionEnd(this.sessionId); } catch { /* already gone */ }
      }
      for (const unsub of this.unsubscribers) unsub();
    })();
    void logger;
  }
}
