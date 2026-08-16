// ==========================================================================
// Ergalics Studio — statistics block catalog (block system)
// ==========================================================================

import { createDataTable } from '@/types/datatable';
import type { ColumnType, DataTable } from '@/types/datatable';
import { asFloat64, histogram, isNumericType, summarize } from '../ops';
import { dataTableInOut, defineBlock } from './types';
import type { BlockDefinition } from './types';

const STAT_COLOR = '#8E24AA';

export const summaryBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.summary',
    category: 'statistics',
    name: '统计摘要',
    nameI18n: { 'en-US': 'Summary' },
    description: '每个数值列的均值/标准差/最值/中位数',
    descriptionI18n: { 'en-US': 'Mean / std / min / max / median per numeric column' },
    color: STAT_COLOR,
    ...dataTableInOut(),
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const numeric = input.columns.filter((c) => isNumericType(c.type));
    const statLabels = ['mean', 'std', 'min', 'max', 'median'];
    const specs: { name: string; type: ColumnType; data: Float64Array }[] = numeric.map((c) => {
      const s = summarize(asFloat64(input, c.name));
      return {
        name: c.name,
        type: 'f64',
        data: new Float64Array([s.mean, s.std, s.min, s.max, s.median]),
      };
    });
    return createDataTable(
      'summary',
      [{ name: 'stat', type: 'string', data: statLabels }, ...specs],
      { provenance: 'stats.summary' },
    );
  },
);

export const histogramBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.histogram',
    category: 'statistics',
    name: '直方图',
    nameI18n: { 'en-US': 'Histogram' },
    description: '数值列分箱计数（bin center / count）',
    descriptionI18n: { 'en-US': 'Bin a numeric column into counts (bin center / count)' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', bins: 10 },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    const bins = Math.max(1, Math.floor(Number(ctx.getParam('bins') ?? 10)));
    const h = histogram(asFloat64(input, column), bins);
    return createDataTable(
      'hist',
      [
        { name: 'center', type: 'f64', data: h.centers },
        { name: 'count', type: 'f64', data: h.counts },
      ],
      { provenance: 'stats.histogram' },
    );
  },
);

export const statisticsBlocks: BlockDefinition[] = [summaryBlock, histogramBlock];
