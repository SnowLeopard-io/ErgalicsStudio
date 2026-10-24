import { describe, it, expect, vi } from 'vitest';
import { createBlockRegistry } from '@/blocks/registry';
import { registerBuiltinBlocks } from '@/blocks/catalog';
import { compile } from '@/blocks/compiler';
import { DagExecutor } from '@/blocks/executor';
import { createMemoryStorage } from '@/blocks/context';
import { renderView } from '@/blocks/render';
import type { VizPayload } from '@/blocks/catalog/visualize';
import { isRenderedView } from '@/types/datatable';
import type { RenderedView } from '@/types/datatable';
import type { Plugin } from '@/types/plugin';
import type { BlockConnection, BlockGraph, BlockInstance } from '@/types/block';

function instance(id: string, blockId: string, params: Record<string, unknown> = {}): BlockInstance {
  return { id, blockId, position: { x: 0, y: 0 }, params };
}

function conn(from: string, to: string): BlockConnection {
  return { id: `${from}->${to}`, from: { nodeId: from, portId: 'out' }, to: { nodeId: to, portId: 'data' } };
}

async function runViz(blockId: string, params: Record<string, unknown>): Promise<RenderedView> {
  const registry = createBlockRegistry();
  registerBuiltinBlocks(registry);
  const graph: BlockGraph = {
    id: 'g',
    instances: [
      instance('src', 'source.generate_grid', { size: 4 }),
      instance('viz', blockId, params),
    ],
    connections: [conn('src', 'viz')],
  };
  const result = compile(graph, registry);
  expect(result.ok).toBe(true);
  const cache = await new DagExecutor(result.program!, {
    storage: createMemoryStorage(),
  }).run();
  const view = cache.get('viz');
  expect(isRenderedView(view)).toBe(true);
  return view as RenderedView;
}

describe('visualize blocks', () => {
  it('viz.scatter serializes x/y into a scatter RenderedView', async () => {
    const view = await runViz('viz.scatter', { xColumn: 'x', yColumn: 'y' });
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.scatter');
    const lines = payload.text.split('\n');
    expect(lines).toHaveLength(16);
    expect(lines[0]).toBe('0 0');
  });

  it('viz.histogram emits a single-column payload', async () => {
    const view = await runViz('viz.histogram', { column: 'x' });
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.histogram');
    const lines = payload.text.split('\n');
    expect(lines).toHaveLength(16);
    // each line is exactly one value
    expect(lines[0]!.split(' ')).toHaveLength(1);
  });

  it('viz.line uses comma delimiter for the timeseries plugin', async () => {
    const view = await runViz('viz.line', { xColumn: 'x', yColumn: 'y' });
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.timeseries');
    expect(payload.text.split('\n')[0]).toBe('0,0');
  });
});

describe('renderView bridge', () => {
  it('activates the target plugin and feeds it a File', async () => {
    const loadData = vi.fn(async (_file: File) => {});
    const fakePlugin = { manifest: { id: 'example.scatter' }, loadData } as unknown as Plugin;
    const activate = vi.fn(async () => fakePlugin);

    const view: RenderedView = {
      kind: 'rendered-view',
      id: 'scatter',
      viewType: 'scatter',
      data: { pluginId: 'example.scatter', text: '0 0\n1 1' } satisfies VizPayload,
    };
    await renderView(view, { activate });

    expect(activate).toHaveBeenCalledWith('example.scatter');
    expect(loadData).toHaveBeenCalledTimes(1);
    const file = loadData.mock.calls[0]![0] as File;
    expect(await file.text()).toBe('0 0\n1 1');
  });

  it('no-ops when the plugin cannot be activated', async () => {
    const activate = vi.fn(async () => null);
    const view: RenderedView = {
      kind: 'rendered-view',
      id: 'scatter',
      viewType: 'scatter',
      data: { pluginId: 'example.missing', text: '' } satisfies VizPayload,
    };
    await expect(renderView(view, { activate })).resolves.toBeUndefined();
  });

  it('no-ops when the view carries no payload', async () => {
    const activate = vi.fn(async () => null);
    const view: RenderedView = { kind: 'rendered-view', id: 'x', viewType: 'x' };
    await expect(renderView(view, { activate })).resolves.toBeUndefined();
    expect(activate).not.toHaveBeenCalled();
  });
});
