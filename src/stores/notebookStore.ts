// ==========================================================================
// Notebook store (business layer)
//
// Cells live in `project.state.notebook` (write-through, like figureStore).
// Execution uses a dedicated `createCodeRuntime` instance — lazily created on
// the first cell run and terminated from the page's unmount effect, so the
// heavy Pyodide worker never outlives the Notebook surface. Finished cell
// runs are recorded in the experiment store (source 'notebook') and announced
// as `notebook:executed` on the host bus.
// ==========================================================================

import { create } from 'zustand';
import { NOTEBOOK_EXECUTED, emit } from '@/core/events';
import { createCodeRuntime, type CodeRuntime } from '@/core/pyodide/runtime';
import type { VariableSnapshot } from '@/core/pyodide/protocol';
import type { NotebookCell, NotebookCellOutput } from '@/core/notebook/notebook';
import { createCell } from '@/core/notebook/notebook';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { logger } from '@/core/logger';

interface NotebookStore {
  runningCellId: string | null;
  /** Add a cell (markdown/code) after `afterId`, or at the end. */
  addCell: (type: 'md' | 'code', afterId?: string) => void;
  removeCell: (id: string) => void;
  updateCell: (id: string, patch: Partial<Pick<NotebookCell, 'type' | 'source'>>) => void;
  moveCell: (id: string, dir: -1 | 1) => void;
  /** Execute a code cell; resolves when the cell has been updated. */
  runCell: (id: string) => Promise<void>;
  /** Terminate the Pyodide worker (page unmount). Safe to call twice. */
  disposeRuntime: () => void;
}

/** Lazily-created runtime; a fresh interpreter per Notebook mount. */
let runtime: CodeRuntime | null = null;
/** Per-run stream buffers, drained by runCell (single-flight). */
let streamBuf: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };

function ensureRuntime(): CodeRuntime {
  if (!runtime) {
    runtime = createCodeRuntime({
      onStdout: (text) => streamBuf.stdout.push(text),
      onStderr: (text) => streamBuf.stderr.push(text),
      // Plot payloads need a plugin host the Notebook doesn't have — drop
      // them; stdout/vars outputs are the notebook's contract.
      activatePlugin: async () => null,
    });
  }
  return runtime;
}

function writeCells(cells: NotebookCell[]): void {
  const { project, setDirty } = useProjectStore.getState();
  if (!project) return;
  useProjectStore.setState({
    project: {
      ...project,
      state: { ...project.state, notebook: { cells } },
    },
  });
  setDirty(true);
}

function mutateCells(fn: (cells: NotebookCell[]) => NotebookCell[]): void {
  const { project } = useProjectStore.getState();
  const cells = project?.state.notebook?.cells ?? [];
  writeCells(fn(cells));
}

/** One-line preview of a run's variable snapshot for the cell output. */
function varPreview(name: string, snapshot: VariableSnapshot): { name: string; preview: string } {
  if (snapshot.kind === 'scalar') {
    return { name, preview: String(snapshot.value) };
  }
  const cols = snapshot.columns.length;
  return { name, preview: `table · ${cols} cols × ${snapshot.length} rows` };
}

export const useNotebookStore = create<NotebookStore>((set) => ({
  runningCellId: null,

  addCell: (type, afterId) => {
    mutateCells((cells) => {
      const cell = createCell(type);
      if (!afterId) return [...cells, cell];
      const idx = cells.findIndex((c) => c.id === afterId);
      if (idx < 0) return [...cells, cell];
      const next = cells.slice();
      next.splice(idx + 1, 0, cell);
      return next;
    });
  },

  removeCell: (id) => {
    mutateCells((cells) => cells.filter((c) => c.id !== id));
  },

  updateCell: (id, patch) => {
    mutateCells((cells) => cells.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  },

  moveCell: (id, dir) => {
    mutateCells((cells) => {
      const idx = cells.findIndex((c) => c.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= cells.length) return cells;
      const next = cells.slice();
      const [cell] = next.splice(idx, 1);
      next.splice(target, 0, cell!);
      return next;
    });
  },

  runCell: async (id) => {
    const { project } = useProjectStore.getState();
    const cell = project?.state.notebook?.cells.find((c) => c.id === id);
    if (!cell || cell.type !== 'code') return;
    if (useNotebookStore.getState().runningCellId) return; // one cell at a time

    set({ runningCellId: id });
    const started = performance.now();
    streamBuf = { stdout: [], stderr: [] };
    let outputs: NotebookCellOutput[];
    let ok: boolean;
    let durationMs: number;

    try {
      const rt = ensureRuntime();
      // Project data files are exposed to the cell by their original name.
      const files: Record<string, string> = {};
      for (const f of project?.data.files ?? []) files[f.name] = f.content;

      const result = await rt.runPython(cell.source, files, {});
      durationMs = result.durationMs || Math.round(performance.now() - started);
      ok = result.ok;

      outputs = [];
      if (streamBuf.stdout.length > 0) {
        outputs.push({ kind: 'stdout', text: streamBuf.stdout.join('') });
      }
      if (streamBuf.stderr.length > 0) {
        outputs.push({ kind: 'stderr', text: streamBuf.stderr.join('') });
      }
      if (!result.ok && result.error) {
        outputs.push({ kind: 'error', text: result.error });
      }
      const entries = Object.entries(result.variables ?? {}).map(([name, snap]) =>
        varPreview(name, snap),
      );
      if (entries.length > 0) outputs.push({ kind: 'vars', entries });
    } catch (err) {
      durationMs = Math.round(performance.now() - started);
      ok = false;
      outputs = [{ kind: 'error', text: String(err) }];
      logger.error('notebook', 'cell execution failed', err);
    }

    mutateCells((cells) =>
      cells.map((c) => (c.id === id ? { ...c, outputs, ok, durationMs } : c)),
    );
    set({ runningCellId: null });

    emit(NOTEBOOK_EXECUTED, { cellId: id, ok, durationMs });
    // Feed the experiment history so notebook runs appear in 运行记录/血缘.
    await useExperimentStore.getState().recordRun({
      source: 'notebook',
      label: `notebook cell ${cell.source.slice(0, 24) || '…'}`,
      durationMs,
      failed: !ok,
    });
  },

  disposeRuntime: () => {
    runtime?.dispose();
    runtime = null;
  },
}));
