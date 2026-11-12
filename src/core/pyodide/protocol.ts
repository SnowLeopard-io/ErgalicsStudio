// ==========================================================================
// Ergalics Studio — Pyodide worker protocol (shared host ⇄ worker types)
//
// Messages the code-mode host and the Pyodide worker exchange. The host owns
// the worker lifecycle; the worker runs real CPython via Pyodide, mirrors the
// `studio` module (STUDIO_PYTHON_SOURCE) and streams side effects (stdout /
// stderr / plot / notify) back over postMessage (editor architecture §12).
// ==========================================================================

export const PYODIDE_VERSION = '314.0.7';

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
  /**
   * Optional source of the script `code` is about to execute (terminal
   * `python script.py`). The wrapper uses runpy, so its imports live in the
   * file rather than in `code`; the worker scans this source to auto-load the
   * scientific packages it needs before the script starts.
   */
  preloadSource?: string;
}

/**
 * Materialise the workspace files in the interpreter WITHOUT running user
 * code. The terminal browses and runs project files (`ls`, `cd data`,
 * `python script.py`), so the tree must exist in the interpreter even when
 * the user has not pressed 运行 yet.
 */
export interface MountMessage {
  type: 'mount';
  id?: number;
  files: Record<string, string>;
  /** Optional: the studio file registry (project + bundled examples), so
   *  `studio.load(...)` resolves the same way it does during a run. */
  dataFiles?: Record<string, string>;
}

/**
 * Load extra Pyodide packages into the running interpreter (the terminal's
 * `pip install <pkg>`). Pyodide ships scientific wheels as packages, so
 * installing means loading the wheel — no network index involved.
 */
export interface LoadPackagesMessage {
  type: 'load-packages';
  id?: number;
  packages: string[];
}

/**
 * Collect the files the interpreter created or changed since the last
 * mount/run. The terminal uses it to write a script's output back into the
 * project (same behaviour as the editor's 运行 button).
 */
export interface CollectMessage {
  type: 'collect';
  id?: number;
}

export type WorkerRequest =
  | InitMessage
  | RunMessage
  | ReplMessage
  | MountMessage
  | LoadPackagesMessage
  | CollectMessage;

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
  /** Workspace files the program created or changed (relative paths). */
  files?: Record<string, string>;
  /** Binary outputs (figures, PDFs, .npy …) as base64 by relative path. */
  binaryFiles?: Record<string, string>;
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

/** Result of a workspace-only mount (no user code executed). */
export interface MountResultMessage {
  type: 'mount-result';
  id: number;
  ok: boolean;
  error?: string;
}

/** Result of a package install (Pyodide loadPackage). */
export interface LoadPackagesResultMessage {
  type: 'load-packages-result';
  id: number;
  ok: boolean;
  loaded: string[];
  error?: string;
}

/** Files the interpreter created or changed since the last baseline. */
export interface CollectResultMessage {
  type: 'collect-result';
  id: number;
  ok: boolean;
  files: Record<string, string>;
  /** Binary outputs (figures, PDFs, .npy …) as base64 by relative path. */
  binaryFiles?: Record<string, string>;
  error?: string;
}

/**
 * Bootstrap failed (CDN unreachable, WASM compile error, package load
 * failure). The host treats this as fatal before `ready` instead of waiting
 * out the boot timeout, and fails every request queued on the dead worker.
 */
export interface InitFailedMessage {
  type: 'init-failed';
  error: string;
}

export type WorkerEvent =
  | ReadyMessage
  | StdoutMessage
  | StderrMessage
  | PlotMessage
  | NotifyMessage
  | ResultMessage
  | ReplResultMessage
  | MountResultMessage
  | LoadPackagesResultMessage
  | CollectResultMessage
  | InitFailedMessage;
