import { describe, it, expect } from 'vitest';
import { createBlockRegistry } from '@/blocks/registry';
import { registerBuiltinBlocks } from '@/blocks/catalog';
import { compile } from '@/blocks/compiler';
import { DagExecutor } from '@/blocks/executor';
import { createMemoryStorage } from '@/blocks/context';
import type { DataValue, DataTable } from '@/types/datatable';
import type { BlockConnection, BlockGraph, BlockInstance } from '@/types/block';

function registry() {
  const r = createBlockRegistry();
  registerBuiltinBlocks(r);
  return r;
}

function instance(id: string, blockId: string, params: Record<string, unknown> = {}): BlockInstance {
  return { id, blockId, position: { x: 0, y: 0 }, params };
}

function conn(from: string, to: string): BlockConnection {
  return { id: `${from}->${to}`, from: { nodeId: from, portId: 'out' }, to: { nodeId: to, portId: 'data' } };
}

async function run(instances: BlockInstance[], connections: BlockConnection[]) {
  const graph: BlockGraph = { id: 'g', instances, connections };
  const result = compile(graph, registry());
  expect(result.ok).toBe(true);
  return new DagExecutor(result.program!, { storage: createMemoryStorage() }).run();
}

function tableOf(cache: ReadonlyMap<string, DataValue>, id: string): DataTable {
  const value = cache.get(id);
  expect(value).toBeDefined();
  expect(value).not.toHaveProperty('kind');
  return value as DataTable;
}

describe('data source blocks', () => {
  it('example_data produces a deterministic sine signal', async () => {
    const cache = await run([instance('a', 'source.example_data', { count: 10, seed: 1 })], []);
    const table = tableOf(cache, 'a');
    expect(table.length).toBe(10);
    expect(table.columnNames()).toEqual(['t', 'x']);
    const t = table.getColumn('t') as Float64Array;
    expect(t[0]).toBe(0);
  });

  it('generate_random is reproducible for a fixed seed', async () => {
    const cache1 = await run([instance('a', 'source.generate_random', { count: 5, seed: 7 })], []);
    const cache2 = await run([instance('a', 'source.generate_random', { count: 5, seed: 7 })], []);
    const x1 = tableOf(cache1, 'a').getColumn('x') as Float64Array;
    const x2 = tableOf(cache2, 'a').getColumn('x') as Float64Array;
    expect(Array.from(x1)).toEqual(Array.from(x2));
  });

  it('generate_grid emits size×size coordinates', async () => {
    const cache = await run([instance('a', 'source.generate_grid', { size: 4 })], []);
    expect(tableOf(cache, 'a').length).toBe(16);
  });
});

describe('transform blocks', () => {
  it('select_columns keeps only requested columns', async () => {
    const cache = await run(
      [
        instance('s', 'source.example_data', { count: 5, seed: 1 }),
        instance('sel', 'transform.select_columns', { columns: ['x'] }),
      ],
      [conn('s', 'sel')],
    );
    expect(tableOf(cache, 'sel').columnNames()).toEqual(['x']);
  });

  it('normalize minmax maps values into [0,1]', async () => {
    const cache = await run(
      [
        instance('s', 'source.example_data', { count: 20, seed: 1 }),
        instance('n', 'transform.normalize', { column: 'x', mode: 'minmax' }),
      ],
      [conn('s', 'n')],
    );
    const col = tableOf(cache, 'n').getColumn('x_minmax') as Float64Array;
    const min = Math.min(...Array.from(col));
    const max = Math.max(...Array.from(col));
    expect(min).toBeCloseTo(0, 10);
    expect(max).toBeCloseTo(1, 10);
  });

  it('normalize zscore centers at zero', async () => {
    const cache = await run(
      [
        instance('s', 'source.example_data', { count: 50, seed: 1 }),
        instance('n', 'transform.normalize', { column: 'x', mode: 'zscore' }),
      ],
      [conn('s', 'n')],
    );
    const col = tableOf(cache, 'n').getColumn('x_zscore') as Float64Array;
    const mean = Array.from(col).reduce((a, b) => a + b, 0) / col.length;
    expect(mean).toBeCloseTo(0, 10);
  });

  it('sort orders rows descending', async () => {
    const cache = await run(
      [
        instance('s', 'source.generate_random', { count: 5, seed: 3 }),
        instance('sort', 'transform.sort', { column: 'x', direction: 'desc' }),
      ],
      [conn('s', 'sort')],
    );
    const col = tableOf(cache, 'sort').getColumn('x') as Float64Array;
    const values = Array.from(col);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i - 1]!).toBeGreaterThanOrEqual(values[i]!);
    }
  });
});

describe('filter blocks', () => {
  it('range filter keeps rows within [min,max]', async () => {
    const cache = await run(
      [
        instance('s', 'source.generate_random', { count: 100, seed: 1 }),
        instance('f', 'filter.range', { column: 'x', min: 0.25, max: 0.75 }),
      ],
      [conn('s', 'f')],
    );
    const col = tableOf(cache, 'f').getColumn('x') as Float64Array;
    for (const v of col) {
      expect(v).toBeGreaterThanOrEqual(0.25);
      expect(v).toBeLessThanOrEqual(0.75);
    }
  });

  it('top_k returns exactly k rows', async () => {
    const cache = await run(
      [
        instance('s', 'source.generate_random', { count: 100, seed: 1 }),
        instance('k', 'filter.top_k', { column: 'x', k: 7, direction: 'largest' }),
      ],
      [conn('s', 'k')],
    );
    expect(tableOf(cache, 'k').length).toBe(7);
  });
});

describe('math blocks', () => {
  it('add with a scalar offsets a column', async () => {
    const cache = await run(
      [
        instance('s', 'source.example_data', { count: 5, seed: 1 }),
        instance('m', 'math.add', { column: 't', value: 10 }),
      ],
      [conn('s', 'm')],
    );
    const col = tableOf(cache, 'm').getColumn('t_add') as Float64Array;
    expect(col[0]).toBeCloseTo(10, 10);
  });

  it('add with two columns sums element-wise', async () => {
    const cache = await run(
      [
        instance('g', 'source.generate_grid', { size: 3 }),
        instance('m', 'math.add', { column: 'x', otherColumn: 'y' }),
      ],
      [conn('g', 'm')],
    );
    const col = tableOf(cache, 'm').getColumn('x_add') as Float64Array;
    expect(Array.from(col)).toEqual([0, 1, 2, 1, 2, 3, 2, 3, 4]);
  });

  it('sqrt and abs produce a new column', async () => {
    const cache = await run(
      [
        instance('s', 'source.example_data', { count: 5, seed: 1 }),
        instance('m', 'math.abs', { column: 'x' }),
      ],
      [conn('s', 'm')],
    );
    expect(tableOf(cache, 'm').getColumn('x_abs')).toBeDefined();
  });
});

describe('statistics blocks', () => {
  it('summary reports mean/std/min/max/median per numeric column', async () => {
    const cache = await run(
      [
        instance('s', 'source.example_data', { count: 10, seed: 1 }),
        instance('sum', 'stats.summary', {}),
      ],
      [conn('s', 'sum')],
    );
    const summary = tableOf(cache, 'sum');
    expect(summary.getColumn('stat')).toEqual(['mean', 'std', 'min', 'max', 'median']);
    expect(summary.length).toBe(5);
    expect(summary.getColumn('x')).toBeDefined();
  });

  it('histogram counts sum to the input length', async () => {
    const cache = await run(
      [
        instance('s', 'source.example_data', { count: 50, seed: 1 }),
        instance('h', 'stats.histogram', { column: 'x', bins: 5 }),
      ],
      [conn('s', 'h')],
    );
    const hist = tableOf(cache, 'h');
    expect(hist.columnNames()).toEqual(['center', 'count']);
    const counts = hist.getColumn('count') as Float64Array;
    expect(Array.from(counts).reduce((a, b) => a + b, 0)).toBe(50);
  });
});

describe('end-to-end pipeline', () => {
  it('example_data → normalize → histogram flows cleanly', async () => {
    const cache = await run(
      [
        instance('src', 'source.example_data', { count: 50, seed: 1 }),
        instance('norm', 'transform.normalize', { column: 'x', mode: 'minmax' }),
        instance('hist', 'stats.histogram', { column: 'x_minmax', bins: 5 }),
      ],
      [conn('src', 'norm'), conn('norm', 'hist')],
    );
    const hist = tableOf(cache, 'hist');
    expect(hist.length).toBe(5);
    const counts = hist.getColumn('count') as Float64Array;
    expect(Array.from(counts).reduce((a, b) => a + b, 0)).toBe(50);
  });
});
