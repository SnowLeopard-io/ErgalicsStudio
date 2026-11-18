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
import { createMemoryStorage } from '@/blocks/context';
import { blockRegistry } from '@/blocks/registry';
import { emit } from '@/core/events';
import { BuildEngine } from '@/core/build/engine';
import { createBuildCache } from '@/core/build/cache';
import { createBuildEnvironment } from '@/core/build/key';
import { compiledRegionToPlan, runCompiledRegion } from '@/core/build/blockAdapter';
import { createBuildAttestation } from '@/core/build/provenance';
import type { BuildAttestation } from '@/core/build/provenance';
import type { BuildStats, StepDecision } from '@/core/build/engine';
import type { BuildCacheStats } from '@/core/build/cache';
import type { RunBuildStats } from '@/core/experiment/record';
import type { DataValue } from '@/types/datatable';

export type NodeStatus = 'idle' | 'computing' | 'done' | 'error';

/** Emitted when a Flow-mode graph run finishes (experiment tracking hook). */
export const FLOW_RUN_FINISHED = 'flow:run:finished';

/** Cache/compute breakdown of a run, for the run history and diagnostics. */
export type FlowBuildStats = RunBuildStats;

/** Per-node outcome of the last run (drives the canvas cache badges). */
export interface FlowBuildStepInfo {
  status: StepDecision['status'];
  /** Machine-readable reason: `cache-hit`, `computed`, `upstream-failed`, … */
  reason: string;
  durationMs: number;
  /** True when a cache hit came from IndexedDB rather than this session. */
  fromPersistence?: boolean;
}

export interface FlowRunFinishedPayload {
  ok: boolean;
  durationMs: number;
  /** Fingerprint of the executed graph (instances + connections). */
  graphHash: string;
  outputs: Record<string, unknown>;
  /** Incremental-build breakdown (absent when compilation failed). */
  build?: FlowBuildStats;
}

export type { BlockGraphState };

interface BlockStore {
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
  /** Build breakdown of the last successful run (null before the first one). */
  lastBuild: FlowBuildStats | null;
  /** Portable attestation of the last successful run (digest-verifiable). */
  lastAttestation: BuildAttestation | null;
  /** Per-node cache hit/recompute decision of the last run. */
  buildSteps: Record<string, FlowBuildStepInfo>;

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
  /** Entries/bytes/persistence of the incremental build cache. */
  buildCacheStats: () => Promise<BuildCacheStats>;
  /** Drop all cached build results (memory + IndexedDB) and reset the report. */
  clearBuildCache: () => Promise<void>;

  toJSON: () => BlockGraphState;
  fromJSON: (state: BlockGraphState) => void;
}

function newId(): string {
  return crypto.randomUUID();
}

/** Emitted whenever the graph data (instances/connections/params) mutates. */
export const BLOCK_GRAPH_CHANGED = 'block:graph:changed';

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * Create an independent block-graph store. Flow mode uses the module-global
 * instance (emitEvents=true → BLOCK_GRAPH_CHANGED + FLOW_RUN_FINISHED events
 * drive the IR hub / experiment tracking); file-editor tabs (design doc P4)
 * create their own instances with emitEvents=false so editing a `.flow.json`
 * buffer never touches the flow-mode graph or the project dirty flag.
 */
export function createBlockGraphStore(emitEvents: boolean) {
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  let runSeq = 0;
  let activeAbort: AbortController | null = null;
  /**
   * One engine per store instance: its cache survives every `run()`, which is
   * the whole point of the build system (the old code constructed a fresh
   * `DagExecutor` per run, so nothing was ever reused across runs).
   */
  let buildEngine: BuildEngine | null = null;

  const getBuildEngine = (): BuildEngine => {
    if (!buildEngine) {
      buildEngine = new BuildEngine({
        cache: createBuildCache({
          // Persist in the real app (browser / desktop renderer) so cache
          // entries survive reloads. Node-based tests have no `window`:
          // IndexedDB shims can hang under fake timers, and a test process
          // gains nothing from persistence.
          persistent: typeof window !== 'undefined',
          limits: { maxEntries: 20_000, maxBytes: 512 * 1024 * 1024, maxEntryBytes: 64 * 1024 * 1024 },
        }),
        environment: createBuildEnvironment(),
      });
    }
    return buildEngine;
  };

  /** Map the engine's decision counters onto the run-record payload. */
  const buildStatsPayload = (stats: BuildStats): FlowBuildStats => {
    const ran = stats.cached + stats.computed;
    return {
      total: stats.total,
      computed: stats.computed,
      cached: stats.cached,
      blocked: stats.blocked,
      failed: stats.failed,
      durationMs: stats.durationMs,
      planHash: stats.planHash,
      environment: stats.environment,
      cacheHitRate: ran > 0 ? stats.cached / ran : 0,
    };
  };

  const notifyChanged = (): void => {
    if (!emitEvents) return;
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      emit(BLOCK_GRAPH_CHANGED, undefined);
    }, 80);
  };

  return create<BlockStore>((set, get) => ({
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
    lastBuild: null,
    lastAttestation: null,
    buildSteps: {},

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
      const startedAt = Date.now();
      const { instances, connections } = get();
      const graph: BlockGraph = { id: 'main', instances, connections };
      const graphHash = JSON.stringify([instances, connections]);
      const result = compile(graph, blockRegistry);
      if (!result.ok || !result.program) {
        set({
          compileDiagnostics: result.diagnostics,
          executionErrors: {},
          nodeStatus: {},
          nodeOutputs: {},
          lastBuild: null,
          lastAttestation: null,
          buildSteps: {},
          isRunning: false,
        });
        return;
      }

      // Keep the previous run's outputs visible until the new results arrive
      // — blanking them here made the preview flash empty during long runs.
      set({
        compileDiagnostics: [],
        executionErrors: {},
        isRunning: true,
        nodeStatus: {},
        // A build summary describes one run; showing the previous one while
        // this run is still in flight would read as if it already finished.
        lastBuild: null,
        lastAttestation: null,
        buildSteps: {},
      });

      const controller = new AbortController();
      activeAbort = controller;
      const engine = getBuildEngine();

      try {
        const run = await runCompiledRegion(
          result.program,
          { storage: createMemoryStorage() },
          engine,
          {
            signal: controller.signal,
            onStepStatus: (nodeId, status) => {
              // A run superseded by stop() or a newer run must not keep painting
              // node status onto the graph.
              if (token !== runSeq) return;
              set((s) => ({ nodeStatus: { ...s.nodeStatus, [nodeId]: status } }));
            },
          },
        );
        if (token !== runSeq) return; // superseded by stop() or a newer run
        const nodeOutputs: Record<string, DataValue> = {};
        for (const [nodeId, value] of run.outputs) nodeOutputs[nodeId] = value;
        const attestation = createBuildAttestation({
          plan: compiledRegionToPlan(result.program),
          stats: run.stats,
          environment: engine.environment,
        });
        const build: FlowBuildStats = {
          ...buildStatsPayload(run.stats),
          attestationDigest: attestation.digest,
        };
        const buildSteps: Record<string, FlowBuildStepInfo> = {};
        for (const decision of run.stats.steps) {
          buildSteps[decision.id] = {
            status: decision.status,
            reason: decision.reason,
            durationMs: decision.durationMs,
            ...(decision.fromPersistence !== undefined
              ? { fromPersistence: decision.fromPersistence }
              : {}),
          };
        }
        set({ isRunning: false, nodeOutputs, lastBuild: build, lastAttestation: attestation, buildSteps });
        if (emitEvents) {
          emit(FLOW_RUN_FINISHED, {
            ok: true,
            durationMs: Date.now() - startedAt,
            graphHash,
            outputs: nodeOutputs,
            build,
          } satisfies FlowRunFinishedPayload);
        }
      } catch (err) {
        if (token !== runSeq) return; // superseded by stop() or a newer run
        const message = err instanceof Error ? err.message : String(err);
        const errors: Record<string, string> = {};
        for (const [nodeId, status] of Object.entries(get().nodeStatus)) {
          if (status === 'error') errors[nodeId] = message;
        }
        // Clear stale outputs so the preview cannot show old data beside an error.
        set({ isRunning: false, executionErrors: errors, nodeOutputs: {} });
        if (emitEvents) {
          emit(FLOW_RUN_FINISHED, {
            ok: false,
            durationMs: Date.now() - startedAt,
            graphHash,
            outputs: {},
          } satisfies FlowRunFinishedPayload);
        }
      } finally {
        if (activeAbort === controller) activeAbort = null;
      }
    },

    stop: () => {
      // Invalidate any in-flight run so its late completion and per-node status
      // writes are discarded...
      runSeq += 1;
      // ...and actually stop the computation, not just its result delivery.
      activeAbort?.abort();
      activeAbort = null;
      set({ isRunning: false });
    },

    clear: () => {
      get().stop();
      set({
        instances: [],
        connections: [],
        selectedIds: [],
        nodeStatus: {},
        executionErrors: {},
        compileDiagnostics: [],
        nodeOutputs: {},
        lastBuild: null,
        lastAttestation: null,
        buildSteps: {},
      });
      notifyChanged();
    },

    buildCacheStats: () => getBuildEngine().cacheStats(),

    clearBuildCache: async () => {
      await getBuildEngine().clearCache();
      set({ lastBuild: null, lastAttestation: null, buildSteps: {} });
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
      get().stop();
      if (notifyTimer) clearTimeout(notifyTimer);
      notifyTimer = null;
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
        lastBuild: null,
        lastAttestation: null,
        buildSteps: {},
      });
    },
  }));
}

/** The full zustand API of a block-graph store (hook + getState/setState). */
export type BlockGraphStoreApi = ReturnType<typeof createBlockGraphStore>;

/** The flow-mode singleton. Canvas graph + run orchestration live here. */
export const useBlockStore = createBlockGraphStore(true);
