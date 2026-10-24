// ==========================================================================
// Ergalics Studio — block metadata & graph types (block system)
//
// A "block" is a typed compute node; connections form a data-flow DAG.
// See block-system-design.md §1.2 and appendix A for the finalized model.
// ==========================================================================

import type { BlockExecutor, ControlKind } from './dag';

export type PortType = 'data' | 'param' | 'render' | 'control';

/** Data types that may flow through a `data` port. */
export type DataType = 'DataTable' | 'RenderedView' | 'Scalar';

export interface PortDef {
  id: string;
  label: string;
  type: PortType;
  /** Present only on `data` ports. */
  dataType?: DataType;
  required: boolean;
}

export type BlockCategory =
  | 'data_source'
  | 'transform'
  | 'filter'
  | 'math'
  | 'statistics'
  | 'signal'
  | 'visualize'
  | 'output'
  | 'utility';

export type GpuMode = 'always' | 'auto' | 'cpu-only';

export interface BlockMeta {
  /** Globally unique id, e.g. 'source.load_csv'. */
  id: string;
  category: BlockCategory;
  name: string;
  nameI18n?: Record<string, string>;
  description: string;
  descriptionI18n?: Record<string, string>;
  /** Icon glyph or asset path. */
  icon: string;
  /** Category color. */
  color: string;
  inputs: PortDef[];
  outputs: PortDef[];
  defaultParams: Record<string, unknown>;
  gpuMode: GpuMode;
  /** Localized labels for parameters, keyed by param name. */
  paramLabels?: Record<string, { label: string; labelI18n?: Record<string, string> }>;
  /** Reserved control-flow kind (appendix A.1); unused in phase 1. */
  control?: { kind: ControlKind };
}

export interface BlockPosition {
  x: number;
  y: number;
}

/** A block placed on the canvas. */
export interface BlockInstance {
  id: string;
  blockId: string;
  position: BlockPosition;
  params: Record<string, unknown>;
  /** Reserved child regions for future control-flow (appendix A.1). */
  regions?: Record<string, BlockRegion>;
}

/** A canvas edge connecting an output port to an input port. */
export interface BlockConnection {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
}

/** A named sub-graph. Reserved for control-flow nesting (appendix A.1). */
export interface BlockRegion {
  id: string;
  instances: BlockInstance[];
  connections: BlockConnection[];
}

/** The top-level graph — instances plus the single source of truth for edges. */
export interface BlockGraph {
  id: string;
  instances: BlockInstance[];
  connections: BlockConnection[];
}

/** Serializable snapshot of the block canvas (persisted into a project). */
export interface BlockGraphState {
  instances: BlockInstance[];
  connections: BlockConnection[];
  viewport: { x: number; y: number; zoom: number };
}

export interface BlockRegistry {
  blocks: Map<string, BlockMeta>;
  executors: Map<string, BlockExecutor>;
  categories: Record<BlockCategory, BlockMeta[]>;
  register(meta: BlockMeta, executor?: BlockExecutor): void;
  get(id: string): BlockMeta | undefined;
  getExecutor(id: string): BlockExecutor | undefined;
  listByCategory(category: BlockCategory): BlockMeta[];
  list(): BlockMeta[];
}
