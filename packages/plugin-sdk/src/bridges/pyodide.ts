// ==========================================================================
// Ergalics Studio Plugin SDK — Python / Pyodide Runtime Bridge (IoC)
//
// Solver plugins running on dedicated Pyodide workers notify the host about
// runtime preflight and cold-boot progress through this bridge so the
// workbench UI can display unified loading / error banners without plugins
// importing host stores or i18n directly.
// ==========================================================================

export type PythonRuntimeSource = 'code' | 'notebook' | 'solver';

export interface PythonRuntimeBridge {
  assertPythonRuntimeAssets(indexURL: string): Promise<void>;
  begin(source: PythonRuntimeSource, opts?: { silent?: boolean }): string;
  ready(token: string): void;
  cancel(token: string): void;
  fail(token: string, error: unknown): void;
  registerRetry(handler: () => void): () => void;
}

let bridge: PythonRuntimeBridge | null = null;
let fallbackSeq = 0;

export function setPythonRuntimeBridge(next: PythonRuntimeBridge | null): void {
  bridge = next;
}

export async function assertPythonRuntimeAssets(indexURL: string): Promise<void> {
  if (bridge) {
    return bridge.assertPythonRuntimeAssets(indexURL);
  }
  let url: string;
  try {
    url = new URL('pyodide.mjs', indexURL).href;
  } catch {
    throw new Error('Python runtime assets are unavailable.');
  }
  const response = await fetch(url, { method: 'GET', cache: 'force-cache' });
  void response.body?.cancel();
  if (!response.ok) {
    throw new Error('Python runtime assets are unavailable.');
  }
}

export function pythonRuntimeBegin(
  source: PythonRuntimeSource,
  opts?: { silent?: boolean },
): string {
  return bridge ? bridge.begin(source, opts) : `${source}:fallback-${++fallbackSeq}`;
}

export function pythonRuntimeReady(token: string): void {
  bridge?.ready(token);
}

export function pythonRuntimeCancel(token: string): void {
  bridge?.cancel(token);
}

export function pythonRuntimeFail(token: string, error: unknown): void {
  bridge?.fail(token, error);
}

export function registerPythonRuntimeRetry(handler: () => void): () => void {
  if (!bridge) return () => {};
  return bridge.registerRetry(handler);
}
