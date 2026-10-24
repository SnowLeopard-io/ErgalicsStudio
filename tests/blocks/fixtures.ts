// Shared test fixtures for the block system. Not a test suite itself.
import { createBlockRegistry } from '@/blocks/registry';
import { createDataTable } from '@/types/datatable';
import type { BlockCategory, BlockMeta, GpuMode, PortDef } from '@/types/block';

interface BlockBase {
  id: string;
  category: BlockCategory;
  inputs: PortDef[];
  outputs: PortDef[];
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  defaultParams?: Record<string, unknown>;
  gpuMode?: GpuMode;
}

export function block(base: BlockBase): BlockMeta {
  return {
    name: base.name ?? base.id,
    description: base.description ?? '',
    icon: base.icon ?? '',
    color: base.color ?? '#000000',
    defaultParams: base.defaultParams ?? {},
    gpuMode: base.gpuMode ?? 'cpu-only',
    id: base.id,
    category: base.category,
    inputs: base.inputs,
    outputs: base.outputs,
  };
}

/** Registry with source / passthrough / join / scalar-conversion blocks. */
export function makeTestRegistry() {
  const registry = createBlockRegistry();

  registry.register(
    block({
      id: 'test.source',
      category: 'data_source',
      inputs: [],
      outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
    }),
    async () =>
      createDataTable('src', [{ name: 'x', type: 'f64', data: new Float64Array([1, 2, 3]) }]),
  );

  registry.register(
    block({
      id: 'test.passthrough',
      category: 'transform',
      inputs: [{ id: 'in', label: 'in', type: 'data', dataType: 'DataTable', required: true }],
      outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
    }),
    async (ctx) => ctx.getInput('in'),
  );

  registry.register(
    block({
      id: 'test.join',
      category: 'transform',
      inputs: [
        { id: 'l', label: 'l', type: 'data', dataType: 'DataTable', required: true },
        { id: 'r', label: 'r', type: 'data', dataType: 'DataTable', required: true },
      ],
      outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
    }),
    async (ctx) => ctx.getInput('l'),
  );

  registry.register(
    block({
      id: 'test.param',
      category: 'transform',
      inputs: [{ id: 'in', label: 'in', type: 'data', dataType: 'DataTable', required: true }],
      outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
      defaultParams: { scale: 1, label: 'a' },
    }),
    async (ctx) => ctx.getInput('in'),
  );

  registry.register(
    block({
      id: 'test.to_scalar',
      category: 'math',
      inputs: [{ id: 'in', label: 'in', type: 'data', dataType: 'DataTable', required: true }],
      outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'Scalar', required: false }],
    }),
    async () => ({ kind: 'scalar' as const, value: 42 }),
  );

  registry.register(
    block({
      id: 'test.from_scalar',
      category: 'math',
      inputs: [{ id: 'in', label: 'in', type: 'data', dataType: 'Scalar', required: true }],
      outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
    }),
    async () => createDataTable('dst', [{ name: 'y', type: 'f64', data: new Float64Array([9]) }]),
  );

  return registry;
}

/** Registry where `test.counter` counts its own executions (keyed by node id). */
export function makeCountingRegistry() {
  const registry = createBlockRegistry();
  const counts = new Map<string, number>();

  registry.register(
    block({
      id: 'test.source',
      category: 'data_source',
      inputs: [],
      outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
    }),
    async () =>
      createDataTable('src', [{ name: 'x', type: 'f64', data: new Float64Array([1, 2, 3]) }]),
  );

  registry.register(
    block({
      id: 'test.counter',
      category: 'transform',
      inputs: [{ id: 'in', label: 'in', type: 'data', dataType: 'DataTable', required: true }],
      outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
    }),
    async (ctx) => {
      counts.set(ctx.nodeId, (counts.get(ctx.nodeId) ?? 0) + 1);
      return ctx.getInput('in');
    },
  );

  return { registry, counts };
}
