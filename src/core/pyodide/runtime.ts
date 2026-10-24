// ==========================================================================
// Ergalics Studio — code-mode runtime (Pyodide ↔ editor store bridge)
//
// Connects the PyodideClient to the editor store and the plugin render
// bridge: streams stdout/stderr to the console, forwards plot payloads to the
// same RenderedView → plugin path block mode uses, and converts the Python
// variable snapshot into panel-ready DataValue entries (editor architecture
// §12.3).
// ==========================================================================

import { PyodideClient, type PyodideClientOptions } from './pyodide-client';
import type { VariableSnapshot } from './protocol';
import { IS_DESKTOP } from '../platform';
import { DesktopPythonClient } from '../platform/desktop-python-client';
import { createDataTable, type DataValue } from '@/types/datatable';
import type { VizPayload } from '@/blocks/catalog/visualize';
import { renderView, type ViewRenderHost } from '@/blocks/render';

/** Build a DataValue from a `_snapshot_variables()` entry. */
function toDataValue(snapshot: VariableSnapshot): DataValue | null {
  if (snapshot.kind === 'scalar') return { kind: 'scalar', value: snapshot.value };
  const columns = snapshot.columns.map((col) => {
    // Numeric column detection must not require finiteness: a single NaN/Inf
    // would downgrade a million-value float column to strings. f64 carries
    // non-finite values natively, so only the static type matters here.
    const allNumbers = col.data.every((v) => typeof v === 'number');
    return {
      name: col.name,
      type: allNumbers ? ('f64' as const) : ('string' as const),
      data: allNumbers ? Float64Array.from(col.data) : col.data.map(String),
    };
  });
  if (columns.length === 0) return null;
  try {
    return createDataTable(
      `code:${snapshot.name}`,
      columns,
      { provenance: snapshot.provenance },
    );
  } catch {
    return null;
  }
}

export interface CodeRuntimeHost extends PyodideClientOptions {
  /** Activate/fetch a plugin so a plot payload can be rendered. */
  activatePlugin: ViewRenderHost['activate'];
}

/**
 * A code-mode runtime tied to one mounted editor. Create a fresh instance per
 * mount (the Pyodide worker is heavy; disposing on unmount reclaims it).
 */
export function createCodeRuntime(host: CodeRuntimeHost) {
  const store = host; // host carries the store plumbing + pyodide callbacks

  // Desktop edition: prefer the real CPython channel when the Electron bridge
  // is present. Falls back to Pyodide transparently on the web (IS_DESKTOP is
  // a compile-time-stable runtime constant — same code ships to both).
  const runtime = createPlatformRuntime(store);

  /** Run a program, converting the snapshot into panel DataValue. */
  async function runPython(
    code: string,
    files: Record<string, string>,
    params: Record<string, unknown>,
  ) {
    const result = await runtime.runPython(code, files, params);
    const outputs: Record<string, DataValue> = {};
    if (result.ok) {
      for (const [name, snapshot] of Object.entries(result.variables)) {
        const value = toDataValue(snapshot);
        if (value) outputs[name] = value;
      }
    }
    return { ...result, outputs };
  }

  return {
    runPython,
    repl: (code: string) => runtime.repl(code),
    interrupt: () => runtime.interrupt(),
    dispose: () => runtime.dispose(),
  };
}

export type CodeRuntime = ReturnType<typeof createCodeRuntime>;

/**
 * Runtime factory shared by both editions: real CPython over IPC inside the
 * desktop shell, the Pyodide worker everywhere else. Both implementations
 * satisfy the narrow {runPython, repl, interrupt, dispose} contract consumed
 * by createCodeRuntime.
 */
function createPlatformRuntime(
  store: CodeRuntimeHost,
): PyodideClient | DesktopPythonClient {
  const onPlot = (payload: VizPayload) => {
    const view = {
      kind: 'rendered-view' as const,
      id: payload.pluginId,
      viewType: payload.pluginId,
      data: payload,
    };
    void renderView(view, { activate: store.activatePlugin });
  };

  if (IS_DESKTOP) {
    return new DesktopPythonClient({
      loadPackages: store.loadPackages,
      onStdout: store.onStdout,
      onStderr: store.onStderr,
      onNotify: store.onNotify,
    });
  }

  return new PyodideClient({
    indexURL: store.indexURL,
    loadPackages: store.loadPackages,
    onStdout: store.onStdout,
    onStderr: store.onStderr,
    onNotify: store.onNotify,
    onPlot,
  });
}
