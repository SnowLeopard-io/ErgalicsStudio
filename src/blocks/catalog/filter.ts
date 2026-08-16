// ==========================================================================
// Ergalics Studio — filter block catalog (block system)
// ==========================================================================

import type { DataTable } from '@/types/datatable';
import { filterRows, requireColumn, sortRows } from '../ops';
import { dataTableInOut, defineBlock } from './types';
import type { BlockDefinition } from './types';

const FILTER_COLOR = '#FF9800';

export const rangeFilterBlock: BlockDefinition = defineBlock(
  {
    id: 'filter.range',
    category: 'filter',
    name: '范围过滤',
    nameI18n: { 'en-US': 'Range Filter' },
    description: '按数值区间过滤行（闭区间）',
    descriptionI18n: { 'en-US': 'Filter rows by a numeric range (inclusive)' },
    color: FILTER_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', min: 0, max: 1 },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      min: { label: '最小值', labelI18n: { 'en-US': 'Min' } },
      max: { label: '最大值', labelI18n: { 'en-US': 'Max' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    const min = Number(ctx.getParam('min') ?? 0);
    const max = Number(ctx.getParam('max') ?? 1);
    // A NaN bound (empty/garbage param input) makes every comparison false,
    // silently dropping every row. Surface the misconfiguration instead.
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error('filter.range: min/max must be numbers');
    }
    const values = requireColumn(input, column);
    return filterRows(input, (_row, i) => {
      const v = values[i]!;
      return v >= min && v <= max;
    });
  },
);

export const valueFilterBlock: BlockDefinition = defineBlock(
  {
    id: 'filter.value',
    category: 'filter',
    name: '值过滤',
    nameI18n: { 'en-US': 'Value Filter' },
    description: '按等值过滤行（数值列）',
    descriptionI18n: { 'en-US': 'Filter rows by exact value (numeric column)' },
    color: FILTER_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', value: 0 },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      value: { label: '值', labelI18n: { 'en-US': 'Value' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    const value = Number(ctx.getParam('value') ?? 0);
    if (!Number.isFinite(value)) {
      throw new Error('filter.value: value must be a number');
    }
    const values = requireColumn(input, column);
    return filterRows(input, (_row, i) => values[i] === value);
  },
);

export const topKBlock: BlockDefinition = defineBlock(
  {
    id: 'filter.top_k',
    category: 'filter',
    name: 'Top-K',
    nameI18n: { 'en-US': 'Top-K' },
    description: '按列取最大/最小前 K 行',
    descriptionI18n: { 'en-US': 'Take the top K rows by column (largest/smallest)' },
    color: FILTER_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', k: 10, direction: 'largest' },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      k: { label: '数量 K', labelI18n: { 'en-US': 'Count K' } },
      direction: { label: '方向', labelI18n: { 'en-US': 'Direction' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    const k = Math.max(0, Math.floor(Number(ctx.getParam('k') ?? 10)));
    const direction = ctx.getParam('direction') === 'smallest' ? 'asc' : 'desc';
    requireColumn(input, column);
    const sorted = sortRows(input, column, direction);
    return filterRows(sorted, (_row, i) => i < k);
  },
);

export const filterBlocks: BlockDefinition[] = [rangeFilterBlock, valueFilterBlock, topKBlock];
