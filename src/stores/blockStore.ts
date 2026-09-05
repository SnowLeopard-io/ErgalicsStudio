// ==========================================================================
// Ergalics Studio — block graph state store (block system)
//
// Single source of truth for the canvas graph (instances + connections +
// viewport) plus run orchestration: compile → execute → surface node status
// and diagnostics back into the store. UI subscribes; actions are the only
// way to mutate.
// ==========================================================================

import { create } from 'zustand';
import type {
  BlockConnection,
  BlockGraph,
  BlockGraphState,
  BlockInstance,
  BlockPosition,
} from '@/types/block';
import { compile } from '@/blocks/compiler';
import type { CompileDiagnostic } from '@/blocks/compiler';
import { DagExecutor } from '@/blocks/executor';
import { createMemoryStorage } from '@/blocks/context';
import { blockRegistry } from '@/blocks/registry';
import { emit } from '@/core/events';
import type { DataValue } from '@/types/datatable';

export type NodeStatus = 'idle' | 'computing' | 'done' | 'error';

export type { BlockGraphState };

export interface BlockStore {
  instances: BlockInstance[];
  connections: BlockConnection[];
  viewport: { x: number; y: number; zoom: number };
  /** Pixel size of the visible canvas, used to place new blocks at the
   *  current viewport center instead of the (0,0) screen corner. */
  canvasSize: { width: number; height: number };

  selectedIds: string[];

  isRunning: boolean;
  nodeStatus: Record<string, NodeStatus>;
  executionErrors: Record<string, string>;
  compileDiagnostics: CompileDiagnostic[];
  /** Output of every executed node from the last run, keyed by node id. */
  nodeOutputs: Record<string, DataValue>;

  addInstance: (blockId: string, position: BlockPosition) => void;
  removeInstance: (id: string) => void;
  moveInstance: (id: string, position: BlockPosition) => void;
  updateParams: (instanceId: string, params: Record<string, unknown>) => void;
  connect: (
    from: { nodeId: string; portId: string },
    to: { nodeId: string; portId: string },
  ) => void;
  disconnect: (connectionId: string) => void;
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
  setSelected: (ids: string[]) => void;

  run: () => Promise<void>;
  stop: () => void;
  clear: () => void;

  toJSON: () => BlockGraphState;
  fromJSON: (state: BlockGraphState) => void;
}

function newId(): string {
  return crypto.randomUUID();
}

/** Emitted whenever the graph data (instances/connections/params) mutates. */
export const BLOCK_GRAPH_CHANGED = 'block:graph:changed';

// Debounce the "graph changed" notification: dragging a node or typing a
// param fired one event + project-dirty per frame, churning the event bus
// and resetting the autosave timer every pointermove.
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifyChanged(): void {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    emit(BLOCK_GRAPH_CHANGED, undefined);
  }, 80);
}

/** Run token: bumped by `stop()` and each `run()` so a superseded in-flight
 *  run can never write its results (or per-node status) over a newer one. */
let runSeq = 0;

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  instances: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  canvasSize: { width: 900, height: 600 },
  selectedIds: [],
  isRunning: false,
  nodeStatus: {},
  executionErrors: {},
  compileDiagnostics: [],
  nodeOutputs: {},

  addInstance: (blockId, position) => {
    const meta = blockRegistry.get(blockId);
    if (!meta) return;
    const instance: BlockInstance = {
      id: newId(),
      blockId,
      position,
      params: { ...meta.defaultParams },
    };
    set((s) => ({ instances: [...s.instances, instance] }));
    notifyChanged();
  },

  removeInstance: (id) => {
    set((s) => ({
      instances: s.instances.filter((i) => i.id !== id),
      connections: s.connections.filter(
        (c) => c.from.nodeId !== id && c.to.nodeId !== id,
      ),
      selectedIds: s.selectedIds.filter((sid) => sid !== id),
      // Purge the deleted node's outputs/status/errors — otherwise the
      // preview kept rendering stale results and the toolbar kept showing
      // its old compile/run error after deletion.
      nodeOutputs: omitKey(s.nodeOutputs, id),
      nodeStatus: omitKey(s.nodeStatus, id),
      executionErrors: omitKey(s.executionErrors, id),
      compileDiagnostics: [],
    }));
    notifyChanged();
  },

  moveInstance: (id, position) => {
    set((s) => ({
      instances: s.instances.map((i) => (i.id === id ? { ...i, position } : i)),
    }));
    notifyChanged();
  },

  updateParams: (instanceId, params) => {
    set((s) => ({
      instances: s.instances.map((i) =>
        i.id === instanceId ? { ...i, params: { ...i.params, ...params } } : i,
      ),
    }));
    notifyChanged();
  },

  connect: (from, to) => {
    // Reject invalid connections up front so the canvas never renders edges
    // that can only fail at compile time (self loops, duplicate inputs).
    if (from.nodeId === to.nodeId) return;
    const instances = get().instances;
    const fromInst = instances.find((i) => i.id === from.nodeId);
    const toInst = instances.find((i) => i.id === to.nodeId);
    if (!fromInst || !toInst) return;
    const fromMeta = blockRegistry.get(fromInst.blockId);
    const toMeta = blockRegistry.get(toInst.blockId);
    if (!fromMeta || !toMeta) return;
    const fromPort = fromMeta.outputs.some((p) => p.id === from.portId);
    const toPort = toMeta.inputs.some((p) => p.id === to.portId);
    if (!fromPort || !toPort) return;
    // Each input port accepts at most one source.
    const dup = get().connections.some(
      (c) => c.to.nodeId === to.nodeId && c.to.portId === to.portId,
    );
    if (dup) return;
    const conn: BlockConnection = { id: newId(), from, to };
    set((s) => ({ connections: [...s.connections, conn] }));
    notifyChanged();
  },

  disconnect: (connectionId) => {
    const conn = get().connections.find((c) => c.id === connectionId);
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== connectionId),
      // Drop the downstream node's cached output so the preview cannot show
      // data computed with a connection that no longer exists.
      ...(conn ? { nodeOutputs: omitKey(s.nodeOutputs, conn.to.nodeId) } : {}),
      compileDiagnostics: [],
    }));
    notifyChanged();
  },

  setViewport: (viewport) => set({ viewport }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
  setSelected: (ids) => set({ selectedIds: ids }),

  run: async () => {
    if (get().isRunning) return;
    const token = ++runSeq;
    const { instances, connections } = get();
    const graph: BlockGraph = { id: 'main', instances, connections };
    const result = compile(graph, blockRegistry);
    if (!result.ok || !result.program) {
      set({ compileDiagnostics: result.diagnostics, executionErrors: {}, nodeStatus: {}, nodeOutputs: {}, isRunning: false });
      return;
    }

    // Keep the previous run's outputs visible until the new results arrive
    // — blanking them here made the preview flash empty during long runs.
    set({ compileDiagnostics: [], executionErrors: {}, isRunning: true, nodeStatus: {} });

    const executor = new DagExecutor(result.program, {
      storage: createMemoryStorage(),
      onNodeStatus: (nodeId, status) => {
        // A run superseded by stop() or a newer run must not keep painting
        // node status onto the graph.
        if (token !== runSeq) return;
        set((s) => ({ nodeStatus: { ...s.nodeStatus, [nodeId]: status } }));
      },
    });

    try {
      const cache = await executor.run();
      if (token !== runSeq) return; // superseded by stop() or a newer run
      const nodeOutputs: Record<string, DataValue> = {};
      for (const [nodeId, value] of cache) nodeOutputs[nodeId] = value;
      set({ isRunning: false, nodeOutputs });
    } catch (err) {
      if (token !== runSeq) return; // superseded by stop() or a newer run
      const message = err instanceof Error ? err.message : String(err);
      const errors: Record<string, string> = {};
      for (const [nodeId, status] of Object.entries(get().nodeStatus)) {
        if (status === 'error') errors[nodeId] = message;
      }
      // Clear stale outputs so the preview cannot show old data beside an error.
      set({ isRunning: false, executionErrors: errors, nodeOutputs: {} });
    }
  },

  stop: () => {
    // Invalidate any in-flight run so its late completion and per-node status
    // writes are discarded.
    runSeq += 1;
    set({ isRunning: false });
  },

  clear: () => {
    set({
      instances: [],
      connections: [],
      selectedIds: [],
      nodeStatus: {},
      executionErrors: {},
      compileDiagnostics: [],
      nodeOutputs: {},
    });
    notifyChanged();
  },

  toJSON: () => ({
    // Return copies, not live references — a consumer that mutates the
    // result before serializing used to corrupt the store's state.
    instances: get().instances.map((i) => ({ ...i, params: { ...i.params } })),
    connections: get().connections.map((c) => ({
      ...c,
      from: { ...c.from },
      to: { ...c.to },
    })),
    viewport: { ...get().viewport },
  }),

  fromJSON: (state) => {
    // A persisted graph is external input: an older build — or a hand-edited
    // `.clproj` — can carry an object whose arrays are missing. That used to
    // throw inside project restore and silently break opening the project, so
    // fall back to an empty graph instead.
    const instances = Array.isArray(state?.instances) ? state.instances : [];
    const connections = Array.isArray(state?.connections) ? state.connections : [];
    set({
      instances: instances.map((i) => ({ ...i, params: { ...(i.params ?? {}) } })),
      connections: connections.map((c) => ({
        ...c,
        from: { ...c.from },
        to: { ...c.to },
      })),
      viewport: state?.viewport ?? { x: 0, y: 0, zoom: 1 },
      selectedIds: [],
      nodeStatus: {},
      executionErrors: {},
      compileDiagnostics: [],
      nodeOutputs: {},
    });
  },
}));