// ==========================================================================
// Ergalics Studio — visualize block catalog (block system)
//
// Visualize blocks convert a DataTable into a RenderedView — a pure-data
// handle that carries the target plugin id plus the serialized payload. The
// render layer (see render.ts) later turns that handle into an actual
// plugin render; the block itself never touches the DOM.
// ==========================================================================

import type { DataTable } from '@/types/datatable';
import type { PortDef } from '@/types/block';
import { requireColumn, toDelimited } from '../ops';
import { defineBlock } from './types';
import type { BlockDefinition } from './types';

const VIZ_COLOR = '#1E88E5';

/** Payload carried by every `viz.*` RenderedView. */
export interface VizPayload {
  /** Target plugin id, e.g. 'example.scatter'. */
  pluginId: string;
  /** Serialized numeric text the plugin's loadData can parse. */
  text: string;
}

function viewInput(): { inputs: PortDef[]; outputs: PortDef[] } {
  return {
    inputs: [{ id: 'data', label: '数据', type: 'data', dataType: 'DataTable', required: true }],
    outputs: [{ id: 'view', label: '渲染', type: 'data', dataType: 'RenderedView', required: false }],
  };
}

function renderedView(viewType: string, pluginId: string, text: string) {
  const payload: VizPayload = { pluginId, text };
  return { kind: 'rendered-view' as const, id: viewType, viewType, data: payload };
}

export const scatterBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.scatter',
    category: 'visualize',
    name: '散点图',
    nameI18n: { 'en-US': 'Scatter Plot' },
    description: '二维散点（x y [颜色]）',
    descriptionI18n: { 'en-US': '2D scatter plot (x y [color])' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { xColumn: '', yColumn: '', colorColumn: '' },
    paramLabels: {
      xColumn: { label: 'X 列', labelI18n: { 'en-US': 'X Column' } },
      yColumn: { label: 'Y 列', labelI18n: { 'en-US': 'Y Column' } },
      colorColumn: { label: '颜色列', labelI18n: { 'en-US': 'Color Column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const x = String(ctx.getParam('xColumn') ?? '');
    const y = String(ctx.getParam('yColumn') ?? '');
    const color = ctx.getParam('colorColumn');
    requireColumn(input, x);
    requireColumn(input, y);
    if (color) requireColumn(input, String(color));
    const columns = color ? [x, y, String(color)] : [x, y];
    return renderedView('scatter', 'example.scatter', toDelimited(input, columns));
  },
);

export const lineBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.line',
    category: 'visualize',
    name: '折线图',
    nameI18n: { 'en-US': 'Line Chart' },
    description: '时间序列折线（x y）',
    descriptionI18n: { 'en-US': 'Time-series line chart (x y)' },
    color: VIZ_COLOR,
    ...viewInput(),
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
    return renderedView('line', 'example.timeseries', toDelimited(input, [x, y], ','));
  },
);

export const histogramViewBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.histogram',
    category: 'visualize',
    name: '直方图',
    nameI18n: { 'en-US': 'Histogram' },
    description: '单列数值直方图',
    descriptionI18n: { 'en-US': 'Histogram of a single numeric column' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { column: '' },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    requireColumn(input, column);
    return renderedView('histogram', 'example.histogram', toDelimited(input, [column], '\n'));
  },
);

export const pointCloud2DBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.point_cloud_2d',
    category: 'visualize',
    name: '2D 点云',
    nameI18n: { 'en-US': '2D Point Cloud' },
    description: '二维点云（x y）',
    descriptionI18n: { 'en-US': '2D point cloud (x y)' },
    color: VIZ_COLOR,
    ...viewInput(),
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
    return renderedView('point-cloud-2d', 'example.point-cloud', toDelimited(input, [x, y]));
  },
);

export const visualizeBlocks: BlockDefinition[] = [
  scatterBlock,
  lineBlock,
  histogramViewBlock,
  pointCloud2DBlock,
];
