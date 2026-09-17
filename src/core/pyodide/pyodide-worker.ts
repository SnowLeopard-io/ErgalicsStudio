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
  PYODIDE_INDEX_URL,
  PYODIDE_LOAD_PACKAGES,
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

// ---- run / repl ----------------------------------------------------------

function snapshotVariables(py: PyodideInterface): Record<string, VariableSnapshot> {
  const snapshot = py.runPython('_snapshot_variables()') as {
    toJs: (opts: { dict_converter: (entries: [string, VariableSnapshot][]) => Record<string, VariableSnapshot> }) => Record<
      string,
      VariableSnapshot
    >;
  };
  return snapshot.toJs({ dict_converter: (entries) => Object.fromEntries(entries) });
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
    await py.runPythonAsync(msg.code);
    const variables = snapshotVariables(py);
    postMessage({
      type: 'result',
      id: msg.id,
      ok: true,
      variables,
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
  }
});
