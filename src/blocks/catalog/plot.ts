// ==========================================================================
// Ergalics Studio — plot block catalog (block system)
//
// Plot blocks convert a DataTable into a *vector* RenderedView: the payload
// carries a standalone SVG string (SvgPlotPayload) which the preview renders
// inline and offers SVG/PDF export on. Unlike the legacy `viz.*` blocks, no
// plugin/canvas is involved, so the output is publication-grade and exportable.
// ==========================================================================

import type { DataTable } from '@/types/datatable';
import type { RenderedView } from '@/types/datatable';
import type { PortDef } from '@/types/block';
import { requireColumn } from '../ops';
import { defineBlock } from './types';
import type { BlockDefinition } from './types';
import {
  dataTableToBar,
  dataTableToHistogram,
  dataTableToLine,
  dataTableToScatter,
} from '@/core/plot/charts';
import { renderSVG, type SvgPlotPayload } from '@/core/plot';

const PLOT_COLOR = '#00897B';

function svgView(spec: Parameters<typeof renderSVG>[0], title?: string): RenderedView {
  const markup = renderSVG(spec);
  const payload: SvgPlotPayload = { svg: true, markup, title };
  return { kind: 'rendered-view', id: 'svg-plot', viewType: 'svg-plot', data: payload };
}

function plotInput(): { inputs: PortDef[]; outputs: PortDef[] } {
  return {
    inputs: [{ id: 'data', label: '数据', type: 'data', dataType: 'DataTable', required: true }],
    outputs: [
      { id: 'view', label: '图表', type: 'data', dataType: 'RenderedView', required: false },
    ],
  };
}

export const plotLineBlock: BlockDefinition = defineBlock(
  {
    id: 'plot.line',
    category: 'visualize',
    name: '折线图',
    nameI18n: { 'en-US': 'Line Chart' },
    description: '出版级折线图（x y）',
    descriptionI18n: { 'en-US': 'Publication line chart (x y)' },
    color: PLOT_COLOR,
    ...plotInput(),
    defaultParams: { xColumn: '', yColumn: '' },
    paramLabels: {
      xColumn: { label: 'X 列', labelI18n: { 'en-US': 'X Column' } },
      yColumn: { label: 'Y 列', labelI18n: { 'en-US': 'Y Column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const x = String(ctx.getParam('xColumn') ?? '');
    const y = String(ctx.getParam('yColumn') ?? '');
    requireColumn(input, x);
    requireColumn(input, y);
    return svgView(dataTableToLine(input, x, y));
  },
);

export const plotScatterBlock: BlockDefinition = defineBlock(
  {
    id: 'plot.scatter',
    category: 'visualize',
    name: '散点图',
    nameI18n: { 'en-US': 'Scatter Plot' },
    description: '出版级散点图（x y）',
    descriptionI18n: { 'en-US': 'Publication scatter plot (x y)' },
    color: PLOT_COLOR,
    ...plotInput(),
    defaultParams: { xColumn: '', yColumn: '' },
    paramLabels: {
      xColumn: { label: 'X 列', labelI18n: { 'en-US': 'X Column' } },
      yColumn: { label: 'Y 列', labelI18n: { 'en-US': 'Y Column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const x = String(ctx.getParam('xColumn') ?? '');
    const y = String(ctx.getParam('yColumn') ?? '');
    requireColumn(input, x);
    requireColumn(input, y);
    return svgView(dataTableToScatter(input, x, y));
  },
);

export const plotHistogramBlock: BlockDefinition = defineBlock(
  {
    id: 'plot.histogram',
    category: 'visualize',
    name: '直方图',
    nameI18n: { 'en-US': 'Histogram' },
    description: '出版级直方图（单列）',
    descriptionI18n: { 'en-US': 'Publication histogram (single column)' },
    color: PLOT_COLOR,
    ...plotInput(),
    defaultParams: { column: '' },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    requireColumn(input, column);
    return svgView(dataTableToHistogram(input, column));
  },
);

export const plotBarBlock: BlockDefinition = defineBlock(
  {
    id: 'plot.bar',
    category: 'visualize',
    name: '柱状图',
    nameI18n: { 'en-US': 'Bar Chart' },
    description: '按取值计数的柱状图（单列）',
    descriptionI18n: { 'en-US': 'Bar chart counting unique values (single column)' },
    color: PLOT_COLOR,
    ...plotInput(),
    defaultParams: { column: '' },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    requireColumn(input, column);
    return svgView(dataTableToBar(input, column));
  },
);

export const plotBlocks: BlockDefinition[] = [
  plotLineBlock,
  plotScatterBlock,
  plotHistogramBlock,
  plotBarBlock,
];
