// ==========================================================================
// Ergalics Studio — Pyodide code-mode worker
//
// A dedicated module worker that runs real CPython (via Pyodide) for code
// mode. It loads Pyodide from the jsdelivr CDN (Vite's worker.format 'es'
// forbids importScripts, so we dynamic-import pyodide.mjs at runtime), injects
// the `studio` module (STUDIO_PYTHON_SOURCE), and executes user code with
// stdout/stderr/plot/notify streamed back to the host over postMessage.
//
// The host terminates + respawns the worker to interrupt a run (no SAB), so
// no interrupt message exists here — a fresh worker means a fresh interpreter.
// ==========================================================================

import type { PyodideInterface } from 'pyodide';
import { STUDIO_PYTHON_SOURCE } from './studio.py';
import {
  collectWorkspaceOutputs,
  mountWorkspace,
  snapshotWorkspace,
  WORKSPACE_ROOT,
  type WorkspaceFs,
} from './workspace-files';
import {
  PYODIDE_INDEX_URL,
  PYODIDE_LOAD_PACKAGES,
  type CollectMessage,
  type LoadPackagesMessage,
  type MountMessage,
  type NotifyKind,
  type PlotMessage,
  type PlotPayload,
  type RunMessage,
  type ReplMessage,
  type VariableSnapshot,
  type WorkerRequest,
} from './protocol';

let pyodide: PyodideInterface | null = null;
let ready = false;

/** In-flight bootstrap, so concurrent init/run/repl share one `loadPyodide`. */
let bootstrap: Promise<PyodideInterface> | null = null;
/**
 * The indexURL the interpreter was (or is being) booted from. `init` owns it;
 * `run`/`repl` read it instead of hardcoding the CDN, otherwise a run that
 * races ahead of `init` would silently load Pyodide from the public CDN and
 * break offline/self-hosted setups.
 */
let activeIndexURL: string = PYODIDE_INDEX_URL;

// ---- host-facing side effects -------------------------------------------

function postPlot(payload: PlotPayload): void {
  const message: PlotMessage = { type: 'plot', payload };
  postMessage(message);
}

function postLog(text: string): void {
  postMessage({ type: 'stdout', text });
}

function postNotify(kind: NotifyKind, message: string): void {
  postMessage({ type: 'notify', kind, message });
}

// ---- interpreter bootstrap ----------------------------------------------

function ensurePyodide(indexURL: string): Promise<PyodideInterface> {
  if (pyodide && ready) return Promise.resolve(pyodide);
  // Memoize the *pending* load too: without this, an `init` and a `run` racing
  // each other started two `loadPyodide` calls and downloaded the WASM twice.
  if (bootstrap) return bootstrap;
  activeIndexURL = indexURL;
  const load = (async () => {
    // Dynamic import of an absolute URL: Vite leaves it untouched (@vite-ignore).
    const mod = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as {
      loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInterface>;
    };
    const instance = await mod.loadPyodide({ indexURL });
    pyodide = instance;
    return instance;
  })();
  bootstrap = load;
  // A rejected bootstrap must not be cached, or every later attempt replays the
  // same failure without ever retrying the (transient) network load.
  void load.catch(() => {
    if (bootstrap === load) bootstrap = null;
  });
  return load;
}

/** Boot the interpreter: load packages, register the bridge, inject `studio`. */
async function init(indexURL: string, loadPackages: string[]): Promise<void> {
  if (bootstrap && activeIndexURL !== indexURL) {
    // A run/repl got here first and started booting from the default URL; make
    // the mismatch visible instead of silently ignoring the configured one.
    postNotify('warning', `Pyodide already loading from ${activeIndexURL}; ignoring indexURL ${indexURL}`);
  }
  const py = await ensurePyodide(indexURL);
  await py.loadPackage(loadPackages);

  // JS side of `studio_bridge`: Python's studio.plot / studio.print /
  // studio.notify call into these functions; each posts a message to the host.
  py.registerJsModule('studio_bridge', {
    // String args convert cleanly to JS; a Python dict would arrive as a
    // JsProxy that structured-clone (postMessage) cannot serialize.
    plot: (pluginId: string, text: string) => postPlot({ pluginId, text }),
    log: postLog,
    notify: postNotify,
  });

  py.setStdout({ batched: (text: string) => postLog(text) });
  py.setStderr({ batched: (text: string) => postMessage({ type: 'stderr', text }) });

  await py.runPythonAsync(STUDIO_PYTHON_SOURCE);
  ready = true;
  postMessage({ type: 'ready', version: 'pyodide' });
}

// ---- workspace staging ----------------------------------------------------
//
// Every runtime text file is mounted under /workspace (its workspace-relative
// path preserved), which gives Python real cross-folder imports:
//
//   data/raw.csv        → /workspace/data/raw.csv
//   lib/stats.py        → /workspace/lib/stats.py   (importable: `import stats`)
//
// The interpreter runs with /workspace as its cwd, so open("out/report.csv",
// "w") lands in the project tree as well. Mount/snapshot/diff live in
// ./workspace-files (pure + unit-testable); only the Python-side preparation
// stays here.

function workspaceFs(py: PyodideInterface): WorkspaceFs {
  return py.FS as unknown as WorkspaceFs;
}

/** Make /workspace importable and clear cached modules from previous runs. */
function prepareWorkspaceRuntime(py: PyodideInterface): void {
  py.runPython(`
import os as _os, sys as _sys, importlib as _il
_os.makedirs('/workspace', exist_ok=True)
_os.chdir('/workspace')
for _root, _dirs, _files in _os.walk('/workspace'):
    _dirs[:] = [d for d in _dirs if d != '__pycache__']
    if _root not in _sys.path:
        _sys.path.insert(0, _root)
for _name, _mod in list(_sys.modules.items()):
    _file = getattr(_mod, '__file__', None)
    if isinstance(_file, str) and _file.startswith('/workspace/'):
        del _sys.modules[_name]
_il.invalidate_caches()
`);
}

/**
 * Lighter variant for the mount path: make sure /workspace exists and is the
 * cwd, but keep the imported modules of the session. A mount only adds files
 * to the tree — dropping the user's imports would be a side effect nobody
 * asked for.
 */
function ensureWorkspaceRoot(py: PyodideInterface): void {
  py.runPython(`
import os as _os
_os.makedirs('/workspace', exist_ok=True)
_os.chdir('/workspace')
`);
}

// ---- run / repl ----------------------------------------------------------

/**
 * Snapshot of the workspace as it was right after the last mount/run. The
 * collect message diffs against it, so only files the program actually
 * created or modified are handed back to the host.
 */
let workspaceBaseline: Record<string, string> | null = null;

function snapshotVariables(py: PyodideInterface): Record<string, VariableSnapshot> {
  const snapshot = py.runPython('_snapshot_variables()') as {
    toJs: (opts: { dict_converter: (entries: [string, VariableSnapshot][]) => Record<string, VariableSnapshot> }) => Record<
      string,
      VariableSnapshot
    >;
  };
  return snapshot.toJs({ dict_converter: (entries) => Object.fromEntries(entries) });
}

/**
 * Clear the workspace tree before mounting a fresh one.
 *
 * A run mounts the "runtime file set", which also folds in the bundled
 * example catalogue and basename aliases. Those leftovers would otherwise
 * keep showing up in the terminal's `ls`, so the mount starts from an empty
 * /workspace and rebuilds exactly the project tree.
 */
function resetWorkspaceTree(py: PyodideInterface): void {
  py.runPython(`
import os as _os, shutil as _shutil
_shutil.rmtree('/workspace', ignore_errors=True)
_os.makedirs('/workspace', exist_ok=True)
`);
}

/**
 * Remember the interpreter's working directory across a workspace reset.
 *
 * prepareWorkspaceRuntime() chdir's to /workspace so that relative outputs
 * land in the project root. That also threw away the terminal's `cd`, which
 * read as "the command did not work". The directory is restored afterwards
 * whenever it still exists, so `cd data` then 运行 keeps the user in data/.
 */
function rememberCwd(py: PyodideInterface): string {
  try {
    return String(py.runPython("__import__('os').getcwd()") ?? '');
  } catch {
    return '';
  }
}

function restoreCwd(py: PyodideInterface, cwd: string): void {
  if (!cwd || cwd === WORKSPACE_ROOT) return;
  // Only a directory INSIDE the workspace may be restored. Before the first
  // mount the interpreter sits in Pyodide's home (/home/pyodide) — restoring
  // that would break the "cwd is /workspace" invariant the runtime relies on
  // (relative outputs would land outside the project).
  if (!cwd.startsWith(`${WORKSPACE_ROOT}/`)) return;
  // The paths go into Python source: they MUST be quoted (a bare /workspace
  // is a syntax error, not a path).
  const literal = JSON.stringify(cwd);
  const rootLiteral = JSON.stringify(WORKSPACE_ROOT);
  py.runPython(
    `import os as _os\nif _os.path.isdir(${literal}):\n    _os.chdir(${literal})\nelse:\n    _os.chdir(${rootLiteral})`,
  );
}

async function handleRun(msg: RunMessage): Promise<void> {
  const started = performance.now();
  try {
    // Inside the try: a failed bootstrap (CDN blocked, offline) must still
    // report back, otherwise the host waits forever for a result.
    const py = await ensurePyodide(activeIndexURL);
    // Ship data files + params into the interpreter before running so the
    // synchronous studio.load() resolves without an async host round-trip.
    // toPy converts the JS objects into real Python dicts — a raw JsProxy
    // cannot be used as a container (`path not in _FILES` would raise
    // "argument of type 'JsProxy' is not a container or iterable").
    py.globals.set('_FILES', py.toPy(msg.files));
    py.globals.set('_PARAMS', py.toPy(msg.params));
    const fs = workspaceFs(py);
    mountWorkspace(fs, msg.files);
    // Baseline BEFORE the run: everything mounted reads back exactly as it
    // will after the run, so only files the program actually created or
    // modified survive the diff.
    const baseline = snapshotWorkspace(fs);
    workspaceBaseline = baseline;
    const cwd = rememberCwd(py);
    prepareWorkspaceRuntime(py);
    restoreCwd(py, cwd);
    await py.runPythonAsync(msg.code);
    const variables = snapshotVariables(py);
    const files = collectWorkspaceOutputs(fs, baseline);
    postMessage({
      type: 'result',
      id: msg.id,
      ok: true,
      variables,
      files,
      durationMs: performance.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMessage({
      type: 'result',
      id: msg.id,
      ok: false,
      variables: {},
      error: message,
      durationMs: performance.now() - started,
    });
  }
}

async function handleRepl(msg: ReplMessage): Promise<void> {
  try {
    // See handleRun: bootstrap failures must surface as a repl result too.
    const py = await ensurePyodide(activeIndexURL);
    py.globals.set('_REPL_CODE', msg.code);
    const text = String(py.runPython('_repl(_REPL_CODE)') ?? '');
    postMessage({ type: 'repl-result', id: msg.id, ok: true, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMessage({ type: 'repl-result', id: msg.id, ok: false, text: '', error: message });
  }
}

/**
 * Materialise the workspace in the interpreter without running user code.
 * The terminal needs the project tree to exist in /workspace before the user
 * ever presses 运行 (browsing with ls/cd, running a script with python).
 */
async function handleMount(msg: MountMessage): Promise<void> {
  try {
    const py = await ensurePyodide(activeIndexURL);
    const cwd = rememberCwd(py);
    const fs = workspaceFs(py);
    // Start from an empty tree: a previous run may have left the bundled
    // example files and basename aliases behind.
    resetWorkspaceTree(py);
    mountWorkspace(fs, msg.files);
    ensureWorkspaceRoot(py);
    restoreCwd(py, cwd);
    workspaceBaseline = snapshotWorkspace(fs);
    postMessage({ type: 'mount-result', id: msg.id, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMessage({ type: 'mount-result', id: msg.id, ok: false, error: message });
  }
}

/**
 * Hand the files the interpreter created or changed back to the host (the
 * terminal writes them into the project, like the editor's 运行 button).
 */
async function handleCollect(msg: CollectMessage): Promise<void> {
  try {
    const py = await ensurePyodide(activeIndexURL);
    const fs = workspaceFs(py);
    const files = workspaceBaseline ? collectWorkspaceOutputs(fs, workspaceBaseline) : {};
    workspaceBaseline = snapshotWorkspace(fs);
    postMessage({ type: 'collect-result', id: msg.id, ok: true, files });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMessage({ type: 'collect-result', id: msg.id, ok: false, files: {}, error: message });
  }
}

/**
 * Install extra packages into the live interpreter (terminal `pip install`).
 * Pyodide wheels are loaded from the same-origin /pyodide bundle, so this
 * works offline like everything else.
 */
async function handleLoadPackages(msg: LoadPackagesMessage): Promise<void> {
  const loaded: string[] = [];
  try {
    const py = await ensurePyodide(activeIndexURL);
    for (const name of msg.packages) {
      await py.loadPackage(name);
      loaded.push(name);
    }
    postMessage({ type: 'load-packages-result', id: msg.id, ok: true, loaded });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMessage({ type: 'load-packages-result', id: msg.id, ok: false, loaded, error: message });
  }
}

// ---- message routing -----------------------------------------------------
self.addEventListener('message', (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    // A bare `void` here turned any bootstrap failure into a silent unhandled
    // rejection — the host then sat on "starting Python" until its 60s boot
    // timeout. Post an explicit init-failed so the host fails fast, drops the
    // dead worker and rejects every queued request.
    init(msg.indexURL ?? PYODIDE_INDEX_URL, msg.loadPackages ?? PYODIDE_LOAD_PACKAGES).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      postNotify('error', `Pyodide failed to start: ${message}`);
      postMessage({ type: 'init-failed', error: message });
    });
  } else if (msg.type === 'run') {
    void handleRun(msg);
  } else if (msg.type === 'repl') {
    void handleRepl(msg);
  } else if (msg.type === 'mount') {
    void handleMount(msg);
  } else if (msg.type === 'load-packages') {
    void handleLoadPackages(msg);
  } else if (msg.type === 'collect') {
    void handleCollect(msg);
  }
});
