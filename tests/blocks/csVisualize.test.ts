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
  csAlgorithmsBlock,
  csAutomataBlock,
  csComplexityBlock,
  csCryptoBlock,
  csDataStructuresBlock,
  csNeuralVizBlock,
  csNetProtoBlock,
  type VizPayload,
} from '@/blocks/catalog/visualize';
import type { BlockConnection, BlockGraph, BlockInstance } from '@/types/block';

type Cell = number | string;

function makeSource(columns: Array<{ name: string; type: 'f64' | 'string' }>, rows: Cell[][]) {
  return defineBlock(
    {
      id: 'test.cs_table',
      category: 'data_source',
      name: 'CS test table',
      description: 'test fixture',
      color: '#43A047',
      outputs: [{ id: 'out', label: 'data', type: 'data', dataType: 'DataTable', required: false }],
    },
    async () => {
      const specs: ColumnSpec[] = columns.map((col, c) => ({
        name: col.name,
        type: col.type === 'f64' ? 'f64' : 'string',
        data:
          col.type === 'f64'
            ? new Float64Array(rows.map((row) => Number(row[c])))
            : (rows.map((row) => String(row[c] ?? '')) as string[]),
      }));
      return createDataTable('cs-test', specs, { provenance: 'test.cs_table' });
    },
  );
}

function instance(id: string, blockId: string, params: Record<string, unknown> = {}): BlockInstance {
  return { id, blockId, position: { x: 0, y: 0 }, params };
}

function conn(from: string, to: string): BlockConnection {
  return { id: `${from}->${to}`, from: { nodeId: from, portId: 'out' }, to: { nodeId: to, portId: 'data' } };
}

async function runCsViz(
  block: typeof csAlgorithmsBlock,
  params: Record<string, unknown>,
  columns: Array<{ name: string; type: 'f64' | 'string' }>,
  rows: Cell[][],
): Promise<RenderedView> {
  const registry = createBlockRegistry();
  const source = makeSource(columns, rows);
  registry.register(block.meta, block.executor);
  registry.register(source.meta, source.executor);
  const graph: BlockGraph = {
    id: 'g',
    instances: [instance('src', 'test.cs_table'), instance('viz', block.meta.id, params)],
    connections: [conn('src', 'viz')],
  };
  const result = compile(graph, registry);
  expect(result.ok).toBe(true);
  const cache = await new DagExecutor(result.program!, { storage: createMemoryStorage() }).run();
  const view = cache.get('viz');
  expect(isRenderedView(view)).toBe(true);
  return view as RenderedView;
}

describe('cs visualize blocks', () => {
  it('viz.cs_algorithms feeds a numeric column to the algorithms plugin', async () => {
    const view = await runCsViz(csAlgorithmsBlock, { column: 'value' }, [{ name: 'value', type: 'f64' }], [[3], [1], [2]]);
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.algorithms');
    expect(view.viewType).toBe('algorithms-input');
    expect(payload.text).toBe('3\n1\n2');
  });

  it('viz.cs_datastructures feeds op/value rows to the data structure lab', async () => {
    const view = await runCsViz(
      csDataStructuresBlock,
      { opColumn: 'op', valueColumn: 'value' },
      [
        { name: 'op', type: 'string' },
        { name: 'value', type: 'f64' },
      ],
      [
        ['insert', 5],
        ['delete', 5],
      ],
    );
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.datastructures');
    expect(view.viewType).toBe('cs-datastructures');
    expect(payload.text).toBe('op,value\ninsert,5\ndelete,5');
  });

  it('viz.cs_automata feeds regex/test rows to the automata engine', async () => {
    const view = await runCsViz(
      csAutomataBlock,
      { regexColumn: 'regex', testColumn: 'test' },
      [
        { name: 'regex', type: 'string' },
        { name: 'test', type: 'string' },
      ],
      [
        ['a*', 'aaa'],
        ['a*', 'b'],
      ],
    );
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.automata');
    expect(payload.text).toBe('regex: a*\ntest: aaa\ntest: b');
  });

  it('viz.cs_crypto feeds parameter rows to the cryptography lab', async () => {
    const view = await runCsViz(
      csCryptoBlock,
      { pColumn: 'p', qColumn: 'q', eColumn: 'e', messageColumn: 'message' },
      [
        { name: 'p', type: 'f64' },
        { name: 'q', type: 'f64' },
        { name: 'e', type: 'f64' },
        { name: 'message', type: 'string' },
      ],
      [[61, 53, 17, 'hello']],
    );
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.crypto');
    expect(payload.text).toBe('p=61\nq=53\ne=17\nmessage=hello');
  });

  it('viz.cs_neuralviz emits an XOR network JSON payload', async () => {
    const view = await runCsViz(
      csNeuralVizBlock,
      { x1Column: 'x1', x2Column: 'x2', labelColumn: 'label' },
      [
        { name: 'x1', type: 'f64' },
        { name: 'x2', type: 'f64' },
        { name: 'label', type: 'f64' },
      ],
      [
        [0, 0, 0],
        [0, 1, 1],
        [1, 0, 1],
        [1, 1, 0],
      ],
    );
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.neuralviz');
    const network = JSON.parse(payload.text) as { sizes: number[]; dataset: Array<{ y: number }> };
    expect(network.sizes).toEqual([2, 4, 1]);
    expect(network.dataset).toHaveLength(4);
    expect(network.dataset.map((s) => s.y)).toEqual([0, 1, 1, 0]);
  });

  it('viz.cs_complexity feeds n/time measurements to the complexity analyzer', async () => {
    const view = await runCsViz(
      csComplexityBlock,
      { nColumn: 'n', timeColumn: 'time_ms' },
      [
        { name: 'n', type: 'f64' },
        { name: 'time_ms', type: 'f64' },
      ],
      [
        [8, 0.8],
        [16, 1.6],
      ],
    );
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.complexity');
    expect(payload.text).toBe('n,time_ms\n8,0.8\n16,1.6');
  });

  it('viz.cs_netproto emits a Reno scenario JSON payload', async () => {
    const view = await runCsViz(
      csNetProtoBlock,
      {
        protocolColumn: 'protocol',
        cwndColumn: 'initialCwnd',
        ssthreshColumn: 'initialSsthresh',
        roundsColumn: 'rounds',
        lossColumn: 'lossAt',
      },
      [
        { name: 'protocol', type: 'string' },
        { name: 'initialCwnd', type: 'f64' },
        { name: 'initialSsthresh', type: 'f64' },
        { name: 'rounds', type: 'f64' },
        { name: 'lossAt', type: 'string' },
      ],
      [['reno', 2, 16, 8, '4,7']],
    );
    const payload = view.data as VizPayload;
    expect(payload.pluginId).toBe('example.netproto');
    expect(JSON.parse(payload.text)).toEqual({
      protocol: 'reno',
      initialCwnd: 2,
      initialSsthresh: 16,
      rounds: 8,
      lossAt: [4, 7],
    });
  });
});
