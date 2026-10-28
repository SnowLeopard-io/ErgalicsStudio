// ==========================================================================
// EM Eigensolver plugin — Pyodide worker
//
// A dedicated module worker running the em_eigensolver Python package on
// real CPython (Pyodide). Mirrors src/core/pyodide/pyodide-worker.ts:
// dynamic-import of pyodide.mjs (worker.format 'es' forbids importScripts),
// package sources written into the interpreter FS from Vite `?raw` imports,
// JSON-string payloads only across the JS boundary (postMessage cannot
// structured-clone PyProxy objects).
//
// public/pyodide vendors core Pyodide + numpy + scipy, so the browser runs
// the SciPy-backed path (numpy-only degraded backend is only a fallback when
// the scipy wheel fails to load).
// ==========================================================================

/// <reference lib="webworker" />

import type { PyodideInterface } from 'pyodide';
import pkgInit from './python/em_eigensolver/__init__.py?raw';
import pkgBackend from './python/em_eigensolver/backend.py?raw';
import pkgCsr from './python/em_eigensolver/csr.py?raw';
import pkgIoMatrix from './python/em_eigensolver/io_matrix.py?raw';
import pkgMinres from './python/em_eigensolver/minres.py?raw';
import pkgLanczos from './python/em_eigensolver/lanczos.py?raw';
import pkgLobpcg from './python/em_eigensolver/lobpcg.py?raw';
import pkgJd from './python/em_eigensolver/jacdavid.py?raw';
import pkgSamples from './python/em_eigensolver/samples.py?raw';
import pkgRepro from './python/em_eigensolver/repro.py?raw';
import pkgSolver from './python/em_eigensolver/solver.py?raw';
import pkgSweep from './python/em_eigensolver/sweep.py?raw';
import pkgDriver from './python/em_eigensolver/driver.py?raw';
import type { EmWorkerEvent, EmWorkerRequest } from './types';

const PKG_ROOT = '/lib';
const PKG_DIR = `${PKG_ROOT}/em_eigensolver`;
const EXPORT_PATH = '/tmp/em-eigensolver-result.npz';

const MODULES: Record<string, string> = {
  '__init__.py': pkgInit,
  'backend.py': pkgBackend,
  'csr.py': pkgCsr,
  'io_matrix.py': pkgIoMatrix,
  'minres.py': pkgMinres,
  'lanczos.py': pkgLanczos,
  'lobpcg.py': pkgLobpcg,
  'jacdavid.py': pkgJd,
  'samples.py': pkgSamples,
  'repro.py': pkgRepro,
  'solver.py': pkgSolver,
  'sweep.py': pkgSweep,
  'driver.py': pkgDriver,
};

let pyodide: PyodideInterface | null = null;
let bootstrap: Promise<PyodideInterface> | null = null;
let pkgReady = false;
let indexURL = '';
let activeJobId = 0;

function post(message: EmWorkerEvent, transfer?: Transferable[]): void {
  if (transfer) {
    postMessage(message, transfer);
  } else {
    postMessage(message);
  }
}

function postLog(text: string): void {
  post({ type: 'stdout', text });
}

/** Boot the interpreter (memoized, retryable on failure) — same pattern as
 *  the code-mode worker: a rejected bootstrap must not stay cached. */
function ensurePyodide(url: string): Promise<PyodideInterface> {
  if (pyodide) return Promise.resolve(pyodide);
  if (bootstrap) return bootstrap;
  indexURL = url;
  const load = (async () => {
    const mod = (await import(/* @vite-ignore */ `${url}pyodide.mjs`)) as {
      loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInterface>;
    };
    const instance = await mod.loadPyodide({ indexURL: url });
    pyodide = instance;
    return instance;
  })();
  bootstrap = load;
  void load.catch(() => {
    if (bootstrap === load) bootstrap = null;
  });
  return load;
}

/** Write the package sources, put /lib on sys.path, import driver. */
async function ensurePackage(py: PyodideInterface): Promise<void> {
  if (pkgReady) return;
  const pyAny = py as unknown as {
    FS: {
      mkdirTree: (path: string) => void;
      writeFile: (path: string, data: Uint8Array | string) => void;
      readFile: (path: string) => Uint8Array;
    };
  };
  try {
    pyAny.FS.mkdirTree(PKG_DIR);
  } catch {
    // already exists
  }
  for (const [name, src] of Object.entries(MODULES)) {
    pyAny.FS.writeFile(`${PKG_DIR}/${name}`, src);
  }
  py.runPython(
    'import sys\nif not "/lib" in sys.path: sys.path.insert(0, "/lib")',
  );
  py.setStdout({ batched: (text: string) => postLog(text) });
  py.setStderr({ batched: (text: string) => postLog(text) });
  await py.runPythonAsync('import em_eigensolver');
  await py.runPythonAsync('from em_eigensolver import driver');
  // Progress bridge: the Python driver hands us a JSON string per cycle.
  py.globals.set('_EM_PROGRESS_SINK', (jsonText: string) => {
    try {
      const info = JSON.parse(jsonText) as import('./types').EmProgressInfo;
      post({ type: 'progress', id: activeJobId, info });
    } catch {
      // malformed progress line — never fatal
    }
  });
  py.runPython('driver.set_progress_sink(_EM_PROGRESS_SINK)');
  pkgReady = true;
}

async function handleInit(msg: Extract<EmWorkerRequest, { type: 'init' }>): Promise<void> {
  try {
    const py = await ensurePyodide(msg.indexURL);
    await py.loadPackage(['numpy', 'scipy']);
    await ensurePackage(py);
    post({ type: 'ready', version: 'pyodide' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'init-failed', error: message });
  }
}

async function handleSolve(msg: Extract<EmWorkerRequest, { type: 'solve' }>): Promise<void> {
  const started = performance.now();
  try {
    const py = await ensurePyodide(indexURL);
    await ensurePackage(py);

    const request: { source: string; sample?: string; path?: string; name?: string } =
      msg.request.source === 'sample'
        ? { source: 'sample', sample: msg.request.sample }
        : (() => {
            // Upload the raw bytes into the interpreter FS; read_matrix(path)
            // dispatches on the extension (.mtx/.npz/.npy).
            const fs = (py as unknown as {
              FS: { writeFile: (path: string, data: Uint8Array) => void };
            }).FS;
            const path = `/tmp/${msg.request.filename}`;
            fs.writeFile(path, new Uint8Array(msg.request.data));
            return { source: 'file', path, name: msg.request.name };
          })();

    activeJobId = msg.id;
    // Flat payload: {source, sample?|path?, name?, config} — matches the
    // schema documented in driver.solve_json (nested wrappers broke the
    // driver's source dispatch and raised KeyError 'path' on samples).
    py.globals.set('_EM_PAYLOAD', JSON.stringify({ ...request, config: msg.config }));
    const reportJson = await py.runPythonAsync('driver.solve_json(_EM_PAYLOAD)');
    const payload = JSON.parse(String(reportJson));
    postLog(`[em] backend=${payload?.backend ?? 'unknown'} method=${payload?.method ?? '?'}`);
    post({
      type: 'result',
      id: msg.id,
      ok: true,
      payload,
      durationMs: performance.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({
      type: 'result',
      id: msg.id,
      ok: false,
      error: message,
      durationMs: performance.now() - started,
    });
  }
}

async function handleExport(msg: Extract<EmWorkerRequest, { type: 'export' }>): Promise<void> {
  try {
    const py = await ensurePyodide(indexURL);
    await ensurePackage(py);
    const pyAny = py as unknown as {
      FS: { readFile: (path: string) => Uint8Array };
      runPython: (code: string) => unknown;
    };
    py.globals.set('_EM_EXPORT_PATH', EXPORT_PATH);
    pyAny.runPython('driver.export_npz(_EM_EXPORT_PATH)');
    const bytes = pyAny.FS.readFile(EXPORT_PATH);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    post({ type: 'export-result', id: msg.id, ok: true, bytes: copy.buffer }, [copy.buffer]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'export-result', id: msg.id, ok: false, error: message });
  }
}

self.addEventListener('message', (ev: MessageEvent<EmWorkerRequest & { data?: ArrayBuffer }>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    void handleInit(msg);
  } else if (msg.type === 'solve') {
    void handleSolve(msg as Extract<EmWorkerRequest, { type: 'solve' }>);
  } else if (msg.type === 'export') {
    void handleExport(msg);
  }
});
