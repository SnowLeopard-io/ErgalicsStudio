// ==========================================================================
// Ergalics Studio — transform block catalog (block system)
//
// Column/row transforms. Every executor reads a DataTable input and returns
// a new DataTable via the shared ops helpers.
// ==========================================================================

import type { DataTable } from '@/types/datatable';
import {
  addColumn,
  normalize,
  renameColumn,
  requireColumn,
  selectColumns,
  sortRows,
  uniqueName,
} from '../ops';
import { dataTableInOut, defineBlock } from './types';
import type { BlockDefinition } from './types';

const TRANSFORM_COLOR = '#FB8C00';

export const selectColumnsBlock: BlockDefinition = defineBlock(
  {
    id: 'transform.select_columns',
    category: 'transform',
    name: '列选择',
    nameI18n: { 'en-US': 'Select Columns' },
    description: '保留指定的列',
    descriptionI18n: { 'en-US': 'Keep only the specified columns' },
    color: TRANSFORM_COLOR,
    ...dataTableInOut(),
    defaultParams: { columns: [] },
    paramLabels: {
      columns: { label: '列', labelI18n: { 'en-US': 'Columns' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const columns = (ctx.getParam('columns') as string[]) ?? [];
    // Dropping the block unconfigured (columns: []) previously crashed the
    // executor inside MemoryDataTable ("requires at least one column").
    if (columns.length === 0) {
      throw new Error('this block is not configured — select at least one column');
    }
    return selectColumns(input, columns);
  },
);

export const renameColumnBlock: BlockDefinition = defineBlock(
  {
    id: 'transform.rename_column',
    category: 'transform',
    name: '列重命名',
    nameI18n: { 'en-US': 'Rename Column' },
    description: '重命名一个列',
    descriptionI18n: { 'en-US': 'Rename a column' },
    color: TRANSFORM_COLOR,
    ...dataTableInOut(),
    defaultParams: { from: '', to: '' },
    paramLabels: {
      from: { label: '原列名', labelI18n: { 'en-US': 'From' } },
      to: { label: '新列名', labelI18n: { 'en-US': 'To' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const from = String(ctx.getParam('from') ?? '');
    const to = String(ctx.getParam('to') ?? '');
    if (!from) {
      throw new Error('this block is not configured — pick the column to rename');
    }
    if (!to) {
      throw new Error('this block is not configured — set the new column name');
    }
    return renameColumn(input, from, to);
  },
);

export const addColumnBlock: BlockDefinition = defineBlock(
  {
    id: 'transform.add_column',
    category: 'transform',
    name: '添加列',
    nameI18n: { 'en-US': 'Add Column' },
    description: '添加一个常量数值列',
    descriptionI18n: { 'en-US': 'Add a constant numeric column' },
    color: TRANSFORM_COLOR,
    ...dataTableInOut(),
    defaultParams: { name: 'col', value: 0 },
    paramLabels: {
      name: { label: '列名', labelI18n: { 'en-US': 'Name' } },
      value: { label: '常量值', labelI18n: { 'en-US': 'Value' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const name = String(ctx.getParam('name') ?? 'col');
    const value = Number(ctx.getParam('value') ?? 0);
    if (!Number.isFinite(value)) {
      throw new Error('transform.add_column: value must be a number');
    }
    const data = new Float64Array(input.length).fill(value);
    return addColumn(input, uniqueName(input, name), 'f64', data);
  },
);

export const normalizeBlock: BlockDefinition = defineBlock(
  {
    id: 'transform.normalize',
    category: 'transform',
    name: '归一化',
    nameI18n: { 'en-US': 'Normalize' },
    description: 'Min-Max 或 Z-score 归一化数值列',
    descriptionI18n: { 'en-US': 'Normalize a numeric column (min-max or z-score)' },
    color: TRANSFORM_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', mode: 'minmax' },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      mode: { label: '方式', labelI18n: { 'en-US': 'Mode' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    const mode = ctx.getParam('mode') === 'zscore' ? 'zscore' : 'minmax';
    const values = normalize(requireColumn(input, column), mode);
    return addColumn(input, uniqueName(input, `${column}_${mode}`), 'f64', values);
  },
);

export const sortBlock: BlockDefinition = defineBlock(
  {
    id: 'transform.sort',
    category: 'transform',
    name: '排序',
    nameI18n: { 'en-US': 'Sort' },
    description: '按数值列升序/降序排序',
    descriptionI18n: { 'en-US': 'Sort rows by a numeric column (asc/desc)' },
    color: TRANSFORM_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', direction: 'asc' },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      direction: { label: '方向', labelI18n: { 'en-US': 'Direction' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    const direction = ctx.getParam('direction') === 'desc' ? 'desc' : 'asc';
    requireColumn(input, column);
    return sortRows(input, column, direction);
  },
);

export const transformBlocks: BlockDefinition[] = [
  selectColumnsBlock,
  renameColumnBlock,
  addColumnBlock,
  normalizeBlock,
  sortBlock,
];
