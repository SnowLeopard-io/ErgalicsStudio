// ==========================================================================
// reactmd — Pyodide worker running the NumPy reaction-MD engine.
//
// Mirrors the fluid-cfd worker: dynamic-import of pyodide.mjs, package sources
// written into the interpreter FS from Vite `?raw` imports, numpy loaded from
// the vendored offline bundle, and a JSON-string payload across the boundary.
// The engine is pure NumPy so it runs unmodified in the browser.
// ==========================================================================

/// <reference lib="webworker" />

import type { PyodideInterface } from 'pyodide';
import pkgInit from '../python/reactmd/__init__.py?raw';
import pkgDriver from '../python/reactmd/driver.py?raw';
import type { ReactMDWorkerEvent, ReactMDWorkerRequest, SimulationResult } from './types';

const PKG_DIR = '/lib/reactmd';
const MODULES: Record<string, string> = { '__init__.py': pkgInit, 'driver.py': pkgDriver };

let pyodide: PyodideInterface | null = null;
let bootstrap: Promise<PyodideInterface> | null = null;
let pkgReady = false;
let indexURL = '';

function post(message: ReactMDWorkerEvent): void {
  postMessage(message);
}

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
  for (const [name, src] of Object.entries(MODULES)) fs.writeFile(`${PKG_DIR}/${name}`, src);
  py.runPython('import sys\nif not "/lib" in sys.path: sys.path.insert(0, "/lib")');
  py.setStdout({ batched: (t: string) => post({ type: 'stdout', text: t }) });
  py.setStderr({ batched: (t: string) => post({ type: 'stdout', text: t }) });
  await py.runPythonAsync('import reactmd');
  await py.runPythonAsync('from reactmd import driver');
  pkgReady = true;
}

async function handleInit(msg: Extract<ReactMDWorkerRequest, { type: 'init' }>): Promise<void> {
  try {
    const py = await ensurePyodide(msg.indexURL);
    await py.loadPackage(['numpy']);
    await ensurePackage(py);
    post({ type: 'ready' });
  } catch (err) {
    post({ type: 'init-failed', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleRun(msg: Extract<ReactMDWorkerRequest, { type: 'run' }>): Promise<void> {
  const started = performance.now();
  try {
    const py = await ensurePyodide(indexURL);
    await ensurePackage(py);
    py.globals.set('_EM_PAYLOAD', JSON.stringify(msg.payload));
    const text = String(await py.runPythonAsync('import json\njson.dumps(driver.simulate(json.loads(_EM_PAYLOAD)))'));
    const result = JSON.parse(text) as SimulationResult;
    result.durationMs = performance.now() - started;
    post({ type: 'result', id: msg.id, ok: true, payload: result, durationMs: result.durationMs });
  } catch (err) {
    post({ type: 'result', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

self.addEventListener('message', (ev: MessageEvent<ReactMDWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') void handleInit(msg);
  else if (msg.type === 'run') void handleRun(msg);
});