// ==========================================================================
// Ergalics Studio — Pyodide worker protocol (shared host ⇄ worker types)
//
// Messages the code-mode host and the Pyodide worker exchange. The host owns
// the worker lifecycle; the worker runs real CPython via Pyodide, mirrors the
// `studio` module (STUDIO_PYTHON_SOURCE) and streams side effects (stdout /
// stderr / plot / notify) back over postMessage (editor architecture §12).
// ==========================================================================

export const PYODIDE_VERSION = '314.0.3';

/**
 * Fallback Pyodide CDN root. The active runtime loads Pyodide same-origin
 * from public/pyodide (vendored by scripts/copy-pyodide.mjs) — see
 * CodeEditor.tsx, which passes `indexURL` to createCodeRuntime. This constant
 * is only the last-resort default if no indexURL is supplied.
 */
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Python packages to preload once the interpreter starts. numpy is the
 *  engine behind the numeric transforms; scipy/matplotlib can be appended by
 *  callers that need them (loadPackages on the init message). */
export const PYODIDE_LOAD_PACKAGES = ['numpy'];

// ---- host → worker ----

export interface InitMessage {
  type: 'init';
  indexURL?: string;
  loadPackages?: string[];
}

export interface RunMessage {
  type: 'run';
  id?: number;
  code: string;
  files: Record<string, string>;
  params: Record<string, unknown>;
}

export interface ReplMessage {
  type: 'repl';
  id?: number;
  code: string;
}

export type WorkerRequest = InitMessage | RunMessage | ReplMessage;

/** Notification severity the Python studio.notify() may emit. */
export type NotifyKind = 'info' | 'success' | 'warning' | 'error';

// ---- worker → host ----

export interface ReadyMessage {
  type: 'ready';
  version: string;
}

export interface StdoutMessage {
  type: 'stdout';
  text: string;
}

export interface StderrMessage {
  type: 'stderr';
  text: string;
}

/** A fire-and-forget plot payload (pluginId + delimited text, mirroring the
 *  JS studio.plot → renderView bridge). */
export interface PlotPayload {
  pluginId: string;
  text: string;
}

export interface PlotMessage {
  type: 'plot';
  payload: PlotPayload;
}

export interface NotifyMessage {
  type: 'notify';
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

/** A single snapshot entry from `_snapshot_variables()`. */
export type VariableSnapshot =
  | {
      kind: 'table';
      name: string;
      columns: { name: string; data: number[] }[];
      length: number;
      provenance: string;
    }
  | { kind: 'scalar'; value: number | string | boolean };

export interface ResultMessage {
  type: 'result';
  id: number;
  ok: boolean;
  variables: Record<string, VariableSnapshot>;
  error?: string;
  durationMs: number;
}

export interface ReplResultMessage {
  type: 'repl-result';
  id: number;
  ok: boolean;
  text: string;
  error?: string;
}

export type WorkerEvent =
  | ReadyMessage
  | StdoutMessage
  | StderrMessage
  | PlotMessage
  | NotifyMessage
  | ResultMessage
  | ReplResultMessage;
