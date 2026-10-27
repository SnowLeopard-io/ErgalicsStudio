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
import { requireColumn, toCsvTable, toDelimited } from '../ops';
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

export const seismicModelBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.geo_seismic_model',
    category: 'visualize',
    name: '地震速度模型',
    nameI18n: { 'en-US': 'Seismic Velocity Model' },
    description: '深度-速度剖面 → 地震波传播插件',
    descriptionI18n: { 'en-US': 'Depth/velocity profile → Seismic Wave Propagation plugin' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { depthColumn: 'depth_km', vpColumn: 'vp_km_s', vsColumn: 'vs_km_s' },
    paramLabels: {
      depthColumn: { label: '深度列', labelI18n: { 'en-US': 'Depth column' } },
      vpColumn: { label: 'vP 列', labelI18n: { 'en-US': 'vP column' } },
      vsColumn: { label: 'vS 列', labelI18n: { 'en-US': 'vS column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const depth = String(ctx.getParam('depthColumn') ?? '');
    const vp = String(ctx.getParam('vpColumn') ?? '');
    const vs = String(ctx.getParam('vsColumn') ?? '');
    requireColumn(input, depth);
    requireColumn(input, vp);
    requireColumn(input, vs);
    return renderedView('seismic-model', 'example.geo-seismic', toDelimited(input, [depth, vp, vs]));
  },
);

export const mineralDatabaseBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.geo_mineral_database',
    category: 'visualize',
    name: '矿物物性数据库',
    nameI18n: { 'en-US': 'Mineral Property Database' },
    description: '物性表（含文本列）→ 矿物鉴定实验室',
    descriptionI18n: { 'en-US': 'Property table (text columns included) → Mineral Identification Lab' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { columns: '' },
    paramLabels: {
      columns: { label: '逗号分隔列名（留空=全部）', labelI18n: { 'en-US': 'Comma-separated columns (blank = all)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const raw = String(ctx.getParam('columns') ?? '').trim();
    const columns = raw ? raw.split(',').map((c) => c.trim()).filter(Boolean) : undefined;
    if (columns) columns.forEach((c) => requireColumn(input, c));
    return renderedView('mineral-database', 'example.geo-minerals', toCsvTable(input, columns));
  },
);

export const pumpingTestBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.geo_pumping_test',
    category: 'visualize',
    name: '抽水试验曲线',
    nameI18n: { 'en-US': 'Pumping-Test Curve' },
    description: '时间/降深 → 水文地质模拟工作台',
    descriptionI18n: { 'en-US': 'Time/drawdown → Hydrogeology Workbench' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { timeColumn: 'time_days', drawdownColumn: 'drawdown_m' },
    paramLabels: {
      timeColumn: { label: '时间列', labelI18n: { 'en-US': 'Time column' } },
      drawdownColumn: { label: '降深列', labelI18n: { 'en-US': 'Drawdown column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const time = String(ctx.getParam('timeColumn') ?? '');
    const drawdown = String(ctx.getParam('drawdownColumn') ?? '');
    requireColumn(input, time);
    requireColumn(input, drawdown);
    const lines = ['time_days,drawdown_m'];
    const t = input.getColumn(time)!;
    const s = input.getColumn(drawdown)!;
    for (let i = 0; i < input.length; i += 1) lines.push(`${String(t[i])},${String(s[i])}`);
    return renderedView('pumping-test', 'example.geo-hydrogeology', lines.join('\n'));
  },
);

export const visualizeBlocks: BlockDefinition[] = [
  scatterBlock,
  lineBlock,
  histogramViewBlock,
  pointCloud2DBlock,
  seismicModelBlock,
  mineralDatabaseBlock,
  pumpingTestBlock,
];
