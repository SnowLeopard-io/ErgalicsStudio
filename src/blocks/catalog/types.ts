// ==========================================================================
// Ergalics Studio — block catalog shared types & factory (block system)
//
// A BlockDefinition pairs a block's metadata with its executor. The
// `defineBlock` factory fills in the verbose defaults so individual catalog
// files stay terse and consistent.
// ==========================================================================

import type { BlockCategory, BlockMeta, GpuMode, PortDef } from '@/types/block';
import type { BlockExecutor } from '@/types/dag';

export interface BlockDefinition {
  meta: BlockMeta;
  executor?: BlockExecutor;
}

export interface DefineBlockArgs {
  id: string;
  category: BlockCategory;
  name: string;
  nameI18n?: Record<string, string>;
  description?: string;
  descriptionI18n?: Record<string, string>;
  icon?: string;
  color?: string;
  inputs?: PortDef[];
  outputs?: PortDef[];
  defaultParams?: Record<string, unknown>;
  gpuMode?: GpuMode;
}

export function defineBlock(args: DefineBlockArgs, executor?: BlockExecutor): BlockDefinition {
  return {
    meta: {
      id: args.id,
      category: args.category,
      name: args.name,
      nameI18n: args.nameI18n,
      description: args.description ?? '',
      descriptionI18n: args.descriptionI18n,
      icon: args.icon ?? '▪',
      color: args.color ?? '#616161',
      inputs: args.inputs ?? [],
      outputs: args.outputs ?? [],
      defaultParams: args.defaultParams ?? {},
      gpuMode: args.gpuMode ?? 'cpu-only',
    },
    executor,
  };
}

/** Standard "data in → data out" ports, used by most transform blocks. */
export function dataTableInOut(): {
  inputs: PortDef[];
  outputs: PortDef[];
} {
  return {
    inputs: [{ id: 'data', label: '数据', type: 'data', dataType: 'DataTable', required: true }],
    outputs: [{ id: 'out', label: '数据', type: 'data', dataType: 'DataTable', required: false }],
  };
}
