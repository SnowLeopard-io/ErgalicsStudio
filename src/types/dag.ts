// ==========================================================================
// Ergalics Studio — compiled DAG & execution context types (block system)
//
// The compiler emits a pure-data CompiledRegion (serializable, testable).
// The executor (DagExecutor) owns cache/dirty state and runs it. This file
// only holds the *types* shared by both sides.
// ==========================================================================

import type { DataValue } from './datatable';
import type { ComputeProgress, GpuComputeApi } from './plugin';

/** Minimal storage surface the executor hands to blocks. */
export interface StorageApi {
  save(key: string, value: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
}

/**
 * Execution context scoped to a single node. Block executors read inputs,
 * read params, and optionally mark themselves dirty via this object.
 */
export interface DagExecutionContext {
  readonly nodeId: string;
  /** Upstream output for one of this node's input ports. */
  getInput(portId: string): DataValue | undefined;
  /** Value of a merged param (instance params over default params). */
  getParam(name: string): unknown;
  /** Mark this node (and its transitive downstream) dirty for recompute. */
  markDirty(): void;
  /** GPU compute surface; undefined when WebGPU is unavailable. */
  readonly gpu?: GpuComputeApi;
  readonly storage: StorageApi;
  onProgress(progress: ComputeProgress): void;
}

/** A block's execution implementation: inputs → output value. */
export type BlockExecutor = (ctx: DagExecutionContext) => Promise<DataValue | void>;

/** Control-flow kind, reserved for a future extension (see appendix A.1). */
export type ControlKind = 'if' | 'switch' | 'repeat' | 'parallel';

export interface CompiledNode {
  id: string;
  blockId: string;
  label: string;
  params: Record<string, unknown>;
  /** input port id → upstream node id */
  inputs: Record<string, string>;
  /** output port id → downstream node ids */
  outputs: Record<string, string[]>;
  execute?: BlockExecutor;
  control?: ControlKind;
}

/**
 * A compiled region: nodes plus a topological execution order. The whole
 * graph is one region today; control flow will nest more regions later.
 */
export interface CompiledRegion {
  id: string;
  nodes: CompiledNode[];
  executionOrder: string[];
}
