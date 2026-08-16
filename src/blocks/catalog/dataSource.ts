// ==========================================================================
// Ergalics Studio — data-source block catalog (block system)
//
// Every source block emits a DataTable with no inputs. Deterministic (LCG)
// generation keeps outputs reproducible and testable.
// ==========================================================================

import { createDataTable } from '@/types/datatable';
import { defineBlock } from './types';
import type { BlockDefinition } from './types';

const DATA_SOURCE_COLOR = '#43A047';

/** Small deterministic LCG (Numerical Recipes) → [0,1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export const exampleData: BlockDefinition = defineBlock(
  {
    id: 'source.example_data',
    category: 'data_source',
    name: '示例数据',
    nameI18n: { 'en-US': 'Example Data' },
    description: '生成正弦信号 + 噪声的示例数据集',
    descriptionI18n: { 'en-US': 'Generate a sample dataset of a sine signal plus noise' },
    color: DATA_SOURCE_COLOR,
    outputs: [{ id: 'out', label: '数据', type: 'data', dataType: 'DataTable', required: false }],
    defaultParams: { count: 100, seed: 1 },
  },
  async (ctx) => {
    const count = Math.max(1, Math.floor(Number(ctx.getParam('count') ?? 100)));
    const seed = Number(ctx.getParam('seed') ?? 1);
    const rand = lcg(seed);
    const t = new Float64Array(count);
    const x = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      t[i] = (i / count) * Math.PI * 2;
      x[i] = Math.sin(t[i]!) + (rand() - 0.5) * 0.2;
    }
    return createDataTable(
      'example',
      [
        { name: 't', type: 'f64', data: t },
        { name: 'x', type: 'f64', data: x },
      ],
      { provenance: 'source.example_data' },
    );
  },
);

export const generateRandom: BlockDefinition = defineBlock(
  {
    id: 'source.generate_random',
    category: 'data_source',
    name: '随机数据',
    nameI18n: { 'en-US': 'Random Data' },
    description: '生成均匀分布随机数',
    descriptionI18n: { 'en-US': 'Generate uniformly distributed random numbers' },
    color: DATA_SOURCE_COLOR,
    outputs: [{ id: 'out', label: '数据', type: 'data', dataType: 'DataTable', required: false }],
    defaultParams: { count: 100, seed: 0 },
  },
  async (ctx) => {
    const count = Math.max(1, Math.floor(Number(ctx.getParam('count') ?? 100)));
    const seed = Number(ctx.getParam('seed') ?? 0);
    const rand = lcg(seed);
    const x = new Float64Array(count);
    for (let i = 0; i < count; i += 1) x[i] = rand();
    return createDataTable('random', [{ name: 'x', type: 'f64', data: x }], {
      provenance: 'source.generate_random',
    });
  },
);

export const generateGrid: BlockDefinition = defineBlock(
  {
    id: 'source.generate_grid',
    category: 'data_source',
    name: '网格数据',
    nameI18n: { 'en-US': 'Grid Data' },
    description: '生成 size×size 均匀网格坐标',
    descriptionI18n: { 'en-US': 'Generate a size×size uniform grid of coordinates' },
    color: DATA_SOURCE_COLOR,
    outputs: [{ id: 'out', label: '数据', type: 'data', dataType: 'DataTable', required: false }],
    defaultParams: { size: 10 },
  },
  async (ctx) => {
    const size = Math.max(1, Math.floor(Number(ctx.getParam('size') ?? 10)));
    const n = size * size;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        x[i * size + j] = i;
        y[i * size + j] = j;
      }
    }
    return createDataTable(
      'grid',
      [
        { name: 'x', type: 'f64', data: x },
        { name: 'y', type: 'f64', data: y },
      ],
      { provenance: 'source.generate_grid' },
    );
  },
);

export const dataSourceBlocks: BlockDefinition[] = [exampleData, generateRandom, generateGrid];
