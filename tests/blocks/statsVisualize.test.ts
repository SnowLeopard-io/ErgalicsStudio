import { describe, expect, it } from 'vitest';
import { createDataTable } from '@/types/datatable';
import type { ColumnSpec, RenderedView } from '@/types/datatable';
import { isRenderedView } from '@/types/datatable';
import { createBlockRegistry } from '@/blocks/registry';
import { defineBlock } from '@/blocks/catalog/types';
import { compile } from '@/blocks/compiler';
import { DagExecutor } from '@/blocks/executor';
import { createMemoryStorage } from '@/blocks/context';
import {
  statsBayesBlock,
  statsDoeBlock,
  statsMetaBlock,
  statsMultivariateBlock,
  statsNonparametricBlock,
  statsSurvivalBlock,
  statsTimeseriesBlock,
  type VizPayload,
} from '@/blocks/catalog/visualize';
import type { BlockConnection, BlockGraph, BlockInstance } from '@/types/block';

function makeSource() {
  return defineBlock(
    {
      id: 'test.stats_table',
      category: 'data_source',
      name: 'Statistics test table',
      description: 'test fixture',
      color: '#43A047',
      outputs: [{ id: 'out', label: 'data', type: 'data', dataType: 'DataTable', required: false }],
    },
    async () => {
      const specs: ColumnSpec[] = [
        { name: 'time', type: 'f64', data: new Float64Array([1, 2, 3, 4]) },
        { name: 'event', type: 'f64', data: new Float64Array([1, 1, 0, 1]) },
        { name: 'group', type: 'string', data: ['a', 'a', 'b', 'b'] },
      ];
      return createDataTable('stats-test', specs, { provenance: 'test.stats_table' });
    },
  );
}

function instance(id: string, blockId: string): BlockInstance {
  return { id, blockId, position: { x: 0, y: 0 }, params: {} };
}

function conn(from: string, to: string): BlockConnection {
  return { id: `${from}->${to}`, from: { nodeId: from, portId: 'out' }, to: { nodeId: to, portId: 'data' } };
}

async function runStatsViz(block: typeof statsDoeBlock): Promise<VizPayload> {
  const registry = createBlockRegistry();
  const source = makeSource();
  registry.register(block.meta, block.executor);
  registry.register(source.meta, source.executor);
  const graph: BlockGraph = {
    id: 'g',
    instances: [instance('src', 'test.stats_table'), instance('viz', block.meta.id)],
    connections: [conn('src', 'viz')],
  };
  const result = compile(graph, registry);
  expect(result.ok).toBe(true);
  const cache = await new DagExecutor(result.program!, { storage: createMemoryStorage() }).run();
  const view = cache.get('viz');
  expect(isRenderedView(view)).toBe(true);
  return (view as RenderedView).data as VizPayload;
}

const blocks = [
  ['viz.stats_doe', statsDoeBlock, 'example.stats-doe'],
  ['viz.stats_timeseries', statsTimeseriesBlock, 'example.stats-timeseries'],
  ['viz.stats_multivariate', statsMultivariateBlock, 'example.stats-multivariate'],
  ['viz.stats_nonparametric', statsNonparametricBlock, 'example.stats-nonparametric'],
  ['viz.stats_survival', statsSurvivalBlock, 'example.stats-survival'],
  ['viz.stats_meta', statsMetaBlock, 'example.stats-meta'],
  ['viz.stats_bayes', statsBayesBlock, 'example.stats-bayes'],
] as const;

describe('statistics visualize blocks', () => {
  for (const [blockId, block, pluginId] of blocks) {
    it(`${blockId} feeds the full CSV table to ${pluginId}`, async () => {
      expect(block.meta.id).toBe(blockId);
      const payload = await runStatsViz(block);
      expect(payload.pluginId).toBe(pluginId);
      expect(payload.text.split('\n')[0]).toBe('time,event,group');
      expect(payload.text.split('\n')[2]).toBe('2,1,a');
      expect(payload.text.split('\n')[4]).toBe('4,1,b');
    });
  }
});
