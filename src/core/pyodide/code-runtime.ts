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
import { useProjectStore } from '@/stores/projectStore';
import { collectProjectFiles, collectRuntimeFiles } from '@/core/dataFiles';
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

/**
 * Materialise the project tree in the interpreter (no user code runs).
 *
 * The workspace is normally staged by a run (prepareWorkspaceRuntime mounts
 * the files and resets the cwd to /workspace). The terminal needs the tree
 * to exist on its own: `ls`, `cd data` and `python script.py` must work
 * before the user ever presses 运行.
 *
 * The mount is keyed by the project + its file-version, so it re-runs when
 * the project changes (or was still loading when the terminal opened) and is
 * a no-op otherwise.
 */
let mountedKey: string | null = null;

export async function mountWorkspaceFiles(force = false): Promise<boolean> {
  try {
    const ok = await warmPythonRuntime({ silent: true });
    if (!ok) return false;
    const project = useProjectStore.getState().project;
    const version = useAppStore.getState().fileOpsVersion;
    const key = `${project?.id ?? 'none'}:${version}`;
    if (!force && mountedKey === key) return true;
    const files = await collectProjectFiles();
    // The studio file registry additionally knows the bundled examples and
    // the basename aliases, so `studio.load('x.csv')` behaves exactly like
    // during a run — while /workspace itself stays the project tree.
    const dataFiles = await collectRuntimeFiles();
    const result = await getPythonRuntime().mountWorkspace(files, dataFiles);
    if (result.ok) mountedKey = key;
    return result.ok;
  } catch {
    // A failed mount must never surface as an unhandled rejection: the
    // terminal shows "workspace not ready" and retries on the next command.
    return false;
  }
}

/** True when the interpreter currently holds the project's file tree. */
export function isWorkspaceMounted(): boolean {
  const project = useProjectStore.getState().project;
  const version = useAppStore.getState().fileOpsVersion;
  return mountedKey === `${project?.id ?? 'none'}:${version}`;
}

/**
 * Install Pyodide wheels into the live interpreter (terminal `pip install`).
 * Pyodide ships the scientific stack as loadable wheels, so "installing" is
 * loading the package from the bundled /pyodide directory — offline, like
 * everything else in the browser build.
 */
export async function installPythonPackages(
  packages: string[],
): Promise<{ ok: boolean; loaded: string[]; error?: string }> {
  const ok = await warmPythonRuntime({ silent: true });
  if (!ok) return { ok: false, loaded: [], error: 'Python runtime is not available' };
  return getPythonRuntime().installPackages(packages);
}

/**
 * Files the interpreter created or changed since the last mount/run. The
 * terminal writes them into the project, so a script run from the terminal
 * produces the same artefacts as the editor's 运行 button.
 */
export async function collectWorkspaceOutputsFromRuntime(): Promise<Record<string, string>> {
  try {
    const result = await getPythonRuntime().collectWorkspaceFiles();
    return result.ok ? result.files : {};
  } catch {
    return {};
  }
}
