// ==========================================================================
// Ergalics Studio — shared Python (Pyodide) runtime for code mode
//
// The interpreter used to be created on every CodeEditor mount and disposed
// on unmount, so switching work modes re-downloaded/re-initialised Pyodide
// each time. This module owns ONE client for the whole session: the worker
// survives mode switches, project switches and tab changes, and is only
// recreated when the user explicitly restarts it.
//
// stdout/stderr are fanned out to the surfaces that are currently mounted
// (code console now; the notebook store can subscribe too).
// ==========================================================================

import { useAppStore } from '@/stores/appStore';
import { usePluginStore, rerenderActivePlugin } from '@/stores/pluginStore';
import { createCodeRuntime, type CodeRuntime } from './runtime';
import {
  pythonRuntimeBegin,
  pythonRuntimeFail,
  pythonRuntimeReady,
  registerPythonRuntimeRetry,
} from './runtime-status';

export interface PythonOutputSink {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

const sinks = new Set<PythonOutputSink>();

/** Route interpreter output to a surface for as long as it is mounted. */
export function subscribePythonOutput(sink: PythonOutputSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

let runtime: CodeRuntime | null = null;
let boot: Promise<boolean> | null = null;
let retryRegistered = false;

function createRuntime(): CodeRuntime {
  return createCodeRuntime({
    // Serve Pyodide same-origin from public/pyodide (vendored by the
    // copy-pyodide build step) instead of cdn.jsdelivr.net — far more
    // reliable from mainland China and cached by the app's own origin.
    indexURL: new URL('pyodide/', document.baseURI).href,
    activatePlugin: async (pluginId) => {
      const store = usePluginStore.getState();
      if (store.activeId !== pluginId) await store.activate(pluginId);
      else rerenderActivePlugin();
      return store.getActive();
    },
    onStdout: (text) => {
      for (const sink of sinks) sink.stdout?.(text);
    },
    onStderr: (text) => {
      for (const sink of sinks) sink.stderr?.(text);
    },
    onNotify: (kind, message) => useAppStore.getState().notify(kind, message),
  });
}

/** The session-wide interpreter handle. Does not boot it by itself. */
export function getPythonRuntime(): CodeRuntime {
  if (!runtime) runtime = createRuntime();
  if (!retryRegistered) {
    retryRegistered = true;
    registerPythonRuntimeRetry(() => {
      void warmPythonRuntime({ restart: true });
    });
  }
  return runtime;
}

export interface WarmOptions {
  /** Tear down the worker first — used by the retry button after a failure. */
  restart?: boolean;
  /**
   * Background preload: the runtime notice stays hidden for it. Ignored when
   * another (non-silent) boot is already in flight.
   */
  silent?: boolean;
}

/**
 * Boot the interpreter once (idempotent) so later runs never pay the load
 * cost. Resolves true when the runtime is usable.
 */
export function warmPythonRuntime(opts: WarmOptions = {}): Promise<boolean> {
  if (opts.restart) {
    boot = null;
    runtime?.dispose();
    runtime = null;
  }
  if (boot) return boot;
  const rt = getPythonRuntime();
  const token = pythonRuntimeBegin('code', { silent: opts.silent });
  boot = rt.runPython('import studio', {}, {}).then(
    (result) => {
      if (!result.ok) throw new Error(result.error || 'Python runtime failed to start');
      pythonRuntimeReady(token);
      return true;
    },
    (err: unknown) => {
      pythonRuntimeFail(token, err);
      // Allow a later call to retry from scratch; the client already dropped
      // its dead worker, so the same handle can spawn a fresh one.
      boot = null;
      return false;
    },
  );
  return boot;
}

/** True while the interpreter is booting (used for lazy UI hints). */
export function isPythonRuntimeWarm(): boolean {
  return boot !== null;
}
