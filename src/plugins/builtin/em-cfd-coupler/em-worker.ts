// ==========================================================================
// EM-CFD Coupler plugin — Pyodide worker
//
// A dedicated module worker running the em_cfd Python package on real
// CPython (Pyodide). Mirrors the em-eigensolver worker: dynamic-import of
// pyodide.mjs (worker.format 'es' forbids importScripts), package sources
// written into the interpreter FS from Vite `?raw` imports, and a JSON-string
// payload across the JS boundary (postMessage cannot structured-clone
// PyProxy objects). results cross the boundary as JSON text because the
// Python driver returns a plain dict, and JSON is the only representation
// that transfers identically between the browser and the CLI.
//
// public/pyodide vendors core Pyodide + numpy only — the em_cfd package is
// pure NumPy by design, so it runs unmodified in the browser.
// ==========================================================================

/// <reference lib="webworker" />

import type { PyodideInterface } from 'pyodide';
import pkgInit from './python/em_cfd/__init__.py?raw';
import pkgAnalytic from './python/em_cfd/analytic.py?raw';
import pkgCoupler from './python/em_cfd/coupler.py?raw';
import pkgDomain from './python/em_cfd/domain_3d.py?raw';
import pkgDriver from './python/em_cfd/driver.py?raw';
import pkgNetwork from './python/em_cfd/network_1d.py?raw';
import pkgUnits from './python/em_cfd/units.py?raw';
import pkgVerify from './python/em_cfd/verify.py?raw';
import type { EmWorkerEvent, EmWorkerRequest } from './types';

const PKG_DIR = '/lib/em_cfd';

const MODULES: Record<string, string> = {
  '__init__.py': pkgInit,
  'analytic.py': pkgAnalytic,
  'coupler.py': pkgCoupler,
  'domain_3d.py': pkgDomain,
  'driver.py': pkgDriver,
  'network_1d.py': pkgNetwork,
  'units.py': pkgUnits,
  'verify.py': pkgVerify,
};

let pyodide: PyodideInterface | null = null;
let bootstrap: Promise<PyodideInterface> | null = null;
let pkgReady = false;
let indexURL = '';
let activeJobId = 0;

function post(message: EmWorkerEvent): void {
  postMessage(message);
}

function postLog(text: string): void {
  post({ type: 'stdout', text });
}

/** Boot the interpreter (memoized, retryable on failure). */
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
  const fs = (py as unknown as {
    FS: { mkdirTree: (path: string) => void; writeFile: (path: string, data: Uint8Array | string) => void };
  }).FS;
  try {
    fs.mkdirTree(PKG_DIR);
  } catch {
    // already exists
  }
  for (const [name, src] of Object.entries(MODULES)) {
    fs.writeFile(`${PKG_DIR}/${name}`, src);
  }
  py.runPython('import sys\nif not "/lib" in sys.path: sys.path.insert(0, "/lib")');
  py.setStdout({ batched: (text: string) => postLog(text) });
  py.setStderr({ batched: (text: string) => postLog(text) });
  await py.runPythonAsync('import em_cfd');
  await py.runPythonAsync('from em_cfd import driver');
  // Progress bridge: the coupler hands us (done, total) per exchange window.
  py.globals.set('_EM_PROGRESS_SINK', (done: number, total: number) => {
    post({ type: 'progress', id: activeJobId, done, total });
  });
  py.runPython('driver.set_progress_sink(_EM_PROGRESS_SINK)');
  pkgReady = true;
}

async function handleInit(msg: Extract<EmWorkerRequest, { type: 'init' }>): Promise<void> {
  try {
    const py = await ensurePyodide(msg.indexURL);
    await py.loadPackage(['numpy']);
    await ensurePackage(py);
    post({ type: 'ready', version: 'pyodide' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'init-failed', error: message });
  }
}

/** Run the Python driver and hand back a JSON string for the one call. */
async function runJson(py: PyodideInterface, expr: string): Promise<unknown> {
  const text = String(await py.runPythonAsync(`import json\njson.dumps(${expr})`));
  return JSON.parse(text) as unknown;
}

async function handleSolve(msg: Extract<EmWorkerRequest, { type: 'solve' }>): Promise<void> {
  const started = performance.now();
  try {
    const py = await ensurePyodide(indexURL);
    await ensurePackage(py);
    activeJobId = msg.id;
    // The exact JSON payload solve_json accepts (benchmark case shortcut or
    // net/dom/cpl overrides) — matches the CLI contract byte-for-byte. The
    // payload crosses the boundary as a string (postMessage can't clone PyProxy),
    // so it is parsed back to a dict on the Python side before the call.
    py.globals.set('_EM_PAYLOAD', JSON.stringify(msg.payload));
    const payload = (await runJson(py, 'driver.solve_json(json.loads(_EM_PAYLOAD))')) as import('./types').EmCouplingResult;
    post({ type: 'result', id: msg.id, ok: true, payload, durationMs: performance.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'result', id: msg.id, ok: false, error: message, durationMs: performance.now() - started });
  }
}

async function handleVerify(msg: Extract<EmWorkerRequest, { type: 'verify' }>): Promise<void> {
  const started = performance.now();
  try {
    const py = await ensurePyodide(indexURL);
    await ensurePackage(py);
    activeJobId = msg.id;
    const payload = (await runJson(py, 'driver.verify_json(None)')) as import('./types').EmVerifyResult;
    post({ type: 'verify-result', id: msg.id, ok: true, payload, durationMs: performance.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'verify-result', id: msg.id, ok: false, error: message, durationMs: performance.now() - started });
  }
}

self.addEventListener('message', (ev: MessageEvent<EmWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    void handleInit(msg);
  } else if (msg.type === 'solve') {
    void handleSolve(msg as Extract<EmWorkerRequest, { type: 'solve' }>);
  } else if (msg.type === 'verify') {
    void handleVerify(msg as Extract<EmWorkerRequest, { type: 'verify' }>);
  }
});