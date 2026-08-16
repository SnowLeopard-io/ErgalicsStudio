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

function notifyChanged(): void {
  emit(BLOCK_GRAPH_CHANGED, undefined);
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  instances: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
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
    const conn: BlockConnection = { id: newId(), from, to };
    set((s) => ({ connections: [...s.connections, conn] }));
    notifyChanged();
  },

  disconnect: (connectionId) => {
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== connectionId),
    }));
    notifyChanged();
  },

  setViewport: (viewport) => set({ viewport }),
  setSelected: (ids) => set({ selectedIds: ids }),

  run: async () => {
    if (get().isRunning) return;
    const { instances, connections } = get();
    const graph: BlockGraph = { id: 'main', instances, connections };
    const result = compile(graph, blockRegistry);
    if (!result.ok || !result.program) {
      set({ compileDiagnostics: result.diagnostics, executionErrors: {}, nodeStatus: {} });
      return;
    }

    set({ compileDiagnostics: [], executionErrors: {}, isRunning: true, nodeStatus: {} });

    const executor = new DagExecutor(result.program, {
      storage: createMemoryStorage(),
      onNodeStatus: (nodeId, status) => {
        set((s) => ({ nodeStatus: { ...s.nodeStatus, [nodeId]: status } }));
      },
    });

    try {
      const cache = await executor.run();
      const nodeOutputs: Record<string, DataValue> = {};
      for (const [nodeId, value] of cache) nodeOutputs[nodeId] = value;
      set({ isRunning: false, nodeOutputs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errors: Record<string, string> = {};
      for (const [nodeId, status] of Object.entries(get().nodeStatus)) {
        if (status === 'error') errors[nodeId] = message;
      }
      set({ isRunning: false, executionErrors: errors });
    }
  },

  stop: () => {
    // Phase 1 runs are atomic and fast; this only resets the flag. Long-task
    // cancellation lands when GPU compute is wired in.
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
    instances: get().instances,
    connections: get().connections,
    viewport: get().viewport,
  }),

  fromJSON: (state) => {
    set({
      instances: state.instances,
      connections: state.connections,
      viewport: state.viewport,
      selectedIds: [],
      nodeStatus: {},
      executionErrors: {},
      compileDiagnostics: [],
      nodeOutputs: {},
    });
  },
}));
