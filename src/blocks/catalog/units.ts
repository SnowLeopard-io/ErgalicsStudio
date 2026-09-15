// ==========================================================================
// Ergalics Studio — units block catalog (block system)
//
// Physical-unit blocks backed by the core unit algebra: convert a numeric
// column between units (annotating the result column with its unit) and
// check dimension compatibility of two unit expressions.
// ==========================================================================

import { createDataTable } from '@/types/datatable';
import type { ColumnSpec, DataTable } from '@/types/datatable';
import { requireColumn, uniqueName } from '../ops';
import { conversionFactor, parseUnitExpr, dimsMatch } from '@/core/units/quantity';
import { dataTableInOut, defineBlock } from './types';
import type { BlockDefinition } from './types';

const UNITS_COLOR = '#00897B';

/** Build a two-column (metric / value) result table from key/value rows. */
function resultTable(id: string, rows: Array<[string, number]>): DataTable {
  return createDataTable(
    id,
    [
      { name: 'metric', type: 'string', data: rows.map((r) => r[0]) },
      { name: 'value', type: 'f64', data: new Float64Array(rows.map((r) => r[1])) },
    ],
    { provenance: id },
  );
}

/** Sanitize a unit expression for use inside a derived column name. */
function unitSlug(unit: string): string {
  return unit.replace(/\//g, '_per_').replace(/[*·×^()\s]/g, '');
}

/** Copy of `table` plus a new f64 column carrying a unit annotation. */
function addUnitColumn(
  table: DataTable,
  name: string,
  unit: string,
  data: Float64Array,
): DataTable {
  if (data.length !== table.length) {
    throw new Error(`column length ${data.length} != table length ${table.length}`);
  }
  const specs: ColumnSpec[] = table.columns.map((meta) => ({
    name: meta.name,
    type: meta.type,
    data: table.getColumn(meta.name)!,
    unit: meta.unit,
    range: meta.range,
  }));
  specs.push({ name, type: 'f64', data, unit });
  return createDataTable(table.id, specs, {
    tags: table.tags,
    provenance: table.provenance ? `${table.provenance}|units.convert:${unit}` : `units.convert:${unit}`,
  });
}

export const unitConvertBlock: BlockDefinition = defineBlock(
  {
    id: 'units.convert',
    category: 'math',
    name: '单位换算',
    nameI18n: { 'en-US': 'Unit Convert' },
    description: '将数值列从一个单位换算到另一个单位（SI 前缀与常用导出单位）',
    descriptionI18n: {
      'en-US': 'Convert a numeric column between units (SI prefixes & common derived units)',
    },
    color: UNITS_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', from: '', to: '' },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      from: { label: '源单位', labelI18n: { 'en-US': 'From unit' } },
      to: { label: '目标单位', labelI18n: { 'en-US': 'To unit' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    const from = String(ctx.getParam('from') ?? '').trim();
    const to = String(ctx.getParam('to') ?? '').trim();
    if (!from) throw new Error('this block is not configured — specify the source unit');
    if (!to) throw new Error('this block is not configured — specify the target unit');
    const values = requireColumn(input, column);
    const factor = conversionFactor(from, to); // throws on dimension mismatch
    const out = new Float64Array(values.length);
    for (let i = 0; i < values.length; i += 1) out[i] = values[i]! * factor;
    return addUnitColumn(
      input,
      uniqueName(input, `${column}_${unitSlug(to)}`),
      to,
      out,
    );
  },
);

export const unitCheckBlock: BlockDefinition = defineBlock(
  {
    id: 'units.check',
    category: 'math',
    name: '量纲检查',
    nameI18n: { 'en-US': 'Dimension Check' },
    description: '比较两个单位表达式的量纲是否相容（输出 SI 换算系数）',
    descriptionI18n: {
      'en-US': 'Check whether two unit expressions are dimension-compatible (with SI factors)',
    },
    color: UNITS_COLOR,
    inputs: [],
    outputs: dataTableInOut().outputs,
    defaultParams: { unitA: 'm', unitB: 'cm' },
    paramLabels: {
      unitA: { label: '单位 A', labelI18n: { 'en-US': 'Unit A' } },
      unitB: { label: '单位 B', labelI18n: { 'en-US': 'Unit B' } },
    },
  },
  async (ctx) => {
    const a = String(ctx.getParam('unitA') ?? '').trim();
    const b = String(ctx.getParam('unitB') ?? '').trim();
    if (!a || !b) throw new Error('this block is not configured — specify two units to compare');
    const pa = parseUnitExpr(a);
    const pb = parseUnitExpr(b);
    return resultTable('units.check', [
      ['compatible', dimsMatch(pa.dims, pb.dims) ? 1 : 0],
      ['si_factor_a', pa.scale],
      ['si_factor_b', pb.scale],
      ['si_ratio', pa.scale / pb.scale],
    ]);
  },
);

export const unitsBlocks: BlockDefinition[] = [unitConvertBlock, unitCheckBlock];
