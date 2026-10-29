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

export const tuningTableBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.tuning_table',
    category: 'visualize',
    name: '音律表',
    nameI18n: { 'en-US': 'Tuning Table' },
    description: '音级/比值/音分表 → 音律系统计算器',
    descriptionI18n: { 'en-US': 'Degree/ratio/cent table → Tuning System Calculator' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { degreeColumn: 'degree', nameColumn: 'name', ratioColumn: 'ratio', centsColumn: 'cents' },
    paramLabels: {
      degreeColumn: { label: '音级列', labelI18n: { 'en-US': 'Degree column' } },
      nameColumn: { label: '音名列', labelI18n: { 'en-US': 'Name column' } },
      ratioColumn: { label: '比值列', labelI18n: { 'en-US': 'Ratio column' } },
      centsColumn: { label: '音分列', labelI18n: { 'en-US': 'Cent column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const degree = String(ctx.getParam('degreeColumn') ?? '');
    const name = String(ctx.getParam('nameColumn') ?? '');
    const ratio = String(ctx.getParam('ratioColumn') ?? '');
    const cents = String(ctx.getParam('centsColumn') ?? '');
    requireColumn(input, degree);
    requireColumn(input, ratio);
    const columns = [degree, name, ratio, cents].filter((c) => c && input.columnNames().includes(c));
    return renderedView('tuning-table', 'example.tuning', toCsvTable(input, columns));
  },
);

export const colorPaletteBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.color_palette',
    category: 'visualize',
    name: '调色板',
    nameI18n: { 'en-US': 'Colour Palette' },
    description: '名称/HEX 色表（或 RGB）→ 色彩科学实验室',
    descriptionI18n: { 'en-US': 'Name/HEX table (or RGB) → Colour Science Lab' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { nameColumn: 'name', hexColumn: 'hex', rColumn: '', gColumn: '', bColumn: '' },
    paramLabels: {
      nameColumn: { label: '名称列', labelI18n: { 'en-US': 'Name column' } },
      hexColumn: { label: 'HEX 列（可留空）', labelI18n: { 'en-US': 'HEX column (optional)' } },
      rColumn: { label: 'R 列（无 HEX 时使用）', labelI18n: { 'en-US': 'R column (when no HEX)' } },
      gColumn: { label: 'G 列', labelI18n: { 'en-US': 'G column' } },
      bColumn: { label: 'B 列', labelI18n: { 'en-US': 'B column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const name = String(ctx.getParam('nameColumn') ?? '');
    const hex = String(ctx.getParam('hexColumn') ?? '');
    const r = String(ctx.getParam('rColumn') ?? '');
    const g = String(ctx.getParam('gColumn') ?? '');
    const b = String(ctx.getParam('bColumn') ?? '');
    const columns = [name, hex, r, g, b].filter((c) => c && input.columnNames().includes(c));
    if (columns.length === 0) {
      throw new Error('No usable colour columns selected (need hex, or r/g/b).');
    }
    return renderedView('color-palette', 'example.color-science', toCsvTable(input, columns));
  },
);

export const acousticsWaveformBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.acoustics_waveform',
    category: 'visualize',
    name: '声学波形',
    nameI18n: { 'en-US': 'Acoustic Waveform' },
    description: '时间/幅度数值表 → 声学实验室（仅数值，不播放）',
    descriptionI18n: { 'en-US': 'Time/amplitude table → Acoustics Lab (data only, no playback)' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { timeColumn: 'time_s', amplitudeColumn: 'amplitude' },
    paramLabels: {
      timeColumn: { label: '时间列（秒）', labelI18n: { 'en-US': 'Time column (s)' } },
      amplitudeColumn: { label: '幅度列', labelI18n: { 'en-US': 'Amplitude column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const time = String(ctx.getParam('timeColumn') ?? '');
    const amplitude = String(ctx.getParam('amplitudeColumn') ?? '');
    requireColumn(input, time);
    requireColumn(input, amplitude);
    const lines = [`${time},${amplitude}`];
    const t = input.getColumn(time)!;
    const a = input.getColumn(amplitude)!;
    for (let i = 0; i < input.length; i += 1) lines.push(`${String(t[i])},${String(a[i])}`);
    return renderedView('acoustics-waveform', 'example.acoustics', lines.join('\n'));
  },
);

export const synthPresetsBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.synth_presets',
    category: 'visualize',
    name: '合成器预设',
    nameI18n: { 'en-US': 'Synth Presets' },
    description: '参数表 → 合成器实验室（JSON 预设，仅数值）',
    descriptionI18n: { 'en-US': 'Parameter table → Synthesizer Lab (JSON presets, data only)' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { midiColumn: 'midi', nameColumn: 'name' },
    paramLabels: {
      midiColumn: { label: 'MIDI 音符列', labelI18n: { 'en-US': 'MIDI note column' } },
      nameColumn: { label: '预设名列', labelI18n: { 'en-US': 'Preset name column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const midiCol = String(ctx.getParam('midiColumn') ?? '');
    const nameCol = String(ctx.getParam('nameColumn') ?? '');
    requireColumn(input, midiCol);
    const has = (name: string) => Boolean(name) && input.columnNames().includes(name);
    const text = (row: Record<string, unknown>, key: string): string | undefined =>
      typeof row[key] === 'string' ? (row[key] as string) : undefined;
    const num = (row: Record<string, unknown>, key: string): number | undefined => {
      const v = row[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    };
    const presets = [];
    for (let i = 0; i < input.length; i += 1) {
      const row = input.getRow(i);
      const midi = num(row, midiCol);
      if (midi === undefined) continue;
      const preset: Record<string, unknown> = {
        name: (has(nameCol) ? text(row, nameCol) : undefined) ?? `preset ${i + 1}`,
        wave: text(row, 'wave') ?? 'sine',
        midi: Math.round(midi),
        detune: num(row, 'detune') ?? 0,
        fmRatio: num(row, 'fmRatio') ?? 1,
        fmIndex: num(row, 'fmIndex') ?? 0,
        filter: text(row, 'filter') ?? 'lowpass',
        cutoff: num(row, 'cutoff') ?? 3000,
        q: num(row, 'q') ?? 0.7,
        adsr: {
          attack: num(row, 'attack') ?? 0.02,
          decay: num(row, 'decay') ?? 0.25,
          sustain: num(row, 'sustain') ?? 0.7,
          release: num(row, 'release') ?? 0.3,
        },
        lfoRate: num(row, 'lfoRate') ?? 5,
        lfoDepth: num(row, 'lfoDepth') ?? 0,
        lfoShape: text(row, 'lfoShape') ?? 'sine',
        duration: num(row, 'duration') ?? 2,
      };
      presets.push(preset);
    }
    if (presets.length === 0) throw new Error('No rows with a numeric MIDI note found.');
    return renderedView('synth-presets', 'example.synth', JSON.stringify(presets, null, 2));
  },
);

export const csAlgorithmsBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.cs_algorithms',
    category: 'visualize',
    name: '算法输入',
    nameI18n: { 'en-US': 'Algorithm Input' },
    description: '单列数值 → 算法可视化器',
    descriptionI18n: { 'en-US': 'Numeric column → Algorithm Visualizer' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { column: '' },
    paramLabels: { column: { label: '数值列', labelI18n: { 'en-US': 'Value column' } } },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    requireColumn(input, column);
    return renderedView('algorithms-input', 'example.algorithms', toDelimited(input, [column], '\n'));
  },
);

export const csDataStructuresBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.cs_datastructures',
    category: 'visualize',
    name: '数据结构操作',
    nameI18n: { 'en-US': 'Data Structure Operations' },
    description: 'op/value 表 → 数据结构实验室',
    descriptionI18n: { 'en-US': 'op/value table → Data Structure Lab' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { opColumn: 'op', valueColumn: 'value' },
    paramLabels: {
      opColumn: { label: '操作列', labelI18n: { 'en-US': 'Operation column' } },
      valueColumn: { label: '键值列', labelI18n: { 'en-US': 'Key column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const op = String(ctx.getParam('opColumn') ?? '');
    const value = String(ctx.getParam('valueColumn') ?? '');
    requireColumn(input, value);
    if (!input.columnNames().includes(op)) throw new Error(`missing op column: ${op}`);
    return renderedView('cs-datastructures', 'example.datastructures', toCsvTable(input, [op, value]));
  },
);

export const csAutomataBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.cs_automata',
    category: 'visualize',
    name: '正则自动机',
    nameI18n: { 'en-US': 'Regex Automata' },
    description: 'regex/test 表 → 自动机与正则引擎',
    descriptionI18n: { 'en-US': 'regex/test table → Automata & Regex Engine' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { regexColumn: 'regex', testColumn: 'test' },
    paramLabels: {
      regexColumn: { label: '正则列', labelI18n: { 'en-US': 'Regex column' } },
      testColumn: { label: '测试串列', labelI18n: { 'en-US': 'Test-string column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const regexCol = String(ctx.getParam('regexColumn') ?? '');
    const testCol = String(ctx.getParam('testColumn') ?? '');
    const names = input.columnNames();
    if (!names.includes(regexCol) || !names.includes(testCol)) throw new Error('configure regex and test columns');
    const lines: string[] = [];
    for (let i = 0; i < input.length; i += 1) {
      const row = input.getRow(i);
      const regex = String(row[regexCol] ?? '');
      const test = String(row[testCol] ?? '');
      if (!regex) continue;
      if (!lines.length) lines.push(`regex: ${regex}`);
      lines.push(`test: ${test}`);
    }
    if (!lines.length) throw new Error('no regex rows found');
    return renderedView('cs-automata', 'example.automata', lines.join('\n'));
  },
);

export const csCryptoBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.cs_crypto',
    category: 'visualize',
    name: '密码学参数',
    nameI18n: { 'en-US': 'Cryptography Parameters' },
    description: 'p/q/e/message 表 → 密码学实验室',
    descriptionI18n: { 'en-US': 'p/q/e/message table → Cryptography Lab' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { pColumn: 'p', qColumn: 'q', eColumn: 'e', messageColumn: 'message' },
    paramLabels: {
      pColumn: { label: 'p 列', labelI18n: { 'en-US': 'p column' } },
      qColumn: { label: 'q 列', labelI18n: { 'en-US': 'q column' } },
      eColumn: { label: 'e 列', labelI18n: { 'en-US': 'e column' } },
      messageColumn: { label: '消息列', labelI18n: { 'en-US': 'Message column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    if (input.length === 0) throw new Error('empty input');
    const row = input.getRow(0);
    const keys = ['p', 'q', 'e', 'message', 'aesKey', 'aesPlaintext'] as const;
    const lines: string[] = [];
    for (const key of keys) {
      const value = row[key];
      if (value === undefined || value === null || value === '') continue;
      lines.push(`${key}=${String(value)}`);
    }
    if (!lines.length) throw new Error('no cryptography parameters found');
    return renderedView('cs-crypto', 'example.crypto', lines.join('\n'));
  },
);

export const csNeuralVizBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.cs_neuralviz',
    category: 'visualize',
    name: 'XOR 样本',
    nameI18n: { 'en-US': 'XOR Samples' },
    description: 'x1/x2/label 表 → 神经网络可视化器（JSON）',
    descriptionI18n: { 'en-US': 'x1/x2/label table → Neural Network Visualizer (JSON)' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { x1Column: 'x1', x2Column: 'x2', labelColumn: 'label' },
    paramLabels: {
      x1Column: { label: 'x₁ 列', labelI18n: { 'en-US': 'x₁ column' } },
      x2Column: { label: 'x₂ 列', labelI18n: { 'en-US': 'x₂ column' } },
      labelColumn: { label: '标签列', labelI18n: { 'en-US': 'Label column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const x1 = String(ctx.getParam('x1Column') ?? '');
    const x2 = String(ctx.getParam('x2Column') ?? '');
    const label = String(ctx.getParam('labelColumn') ?? '');
    const names = input.columnNames();
    if (!names.includes(x1) || !names.includes(x2)) throw new Error('configure x₁ and x₂ columns');
    const dataset = [];
    for (let i = 0; i < input.length; i += 1) {
      const row = input.getRow(i);
      const a = Number(row[x1]);
      const b = Number(row[x2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const y = label && names.includes(label) ? (Number(row[label]) ? 1 : 0) : 0;
      dataset.push({ x: [a, b], y });
    }
    const network = {
      kind: 'ergalics-neuralviz',
      version: 1,
      sizes: [2, 4, 1],
      activation: 'tanh',
      weights: [
        [
          [2.1, -2.4],
          [-3.2, 1.8],
          [2.7, 2.9],
          [-1.6, -2.2],
        ],
        [[3.1, 3.4, -3.7, -3.2]],
      ],
      biases: [[-1.2, 0.7, -0.6, 1.1], [0.05]],
      dataset,
    };
    return renderedView('cs-neuralviz', 'example.neuralviz', JSON.stringify(network, null, 2));
  },
);

export const csComplexityBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.cs_complexity',
    category: 'visualize',
    name: '复杂度测量',
    nameI18n: { 'en-US': 'Complexity Measurements' },
    description: 'n/time 表 → 复杂度分析器',
    descriptionI18n: { 'en-US': 'n/time table → Complexity Analyzer' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { nColumn: 'n', timeColumn: 'time_ms' },
    paramLabels: {
      nColumn: { label: 'n 列', labelI18n: { 'en-US': 'n column' } },
      timeColumn: { label: '时间列 (ms)', labelI18n: { 'en-US': 'Time column (ms)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const n = String(ctx.getParam('nColumn') ?? '');
    const time = String(ctx.getParam('timeColumn') ?? '');
    requireColumn(input, n);
    requireColumn(input, time);
    const lines = ['n,time_ms'];
    for (let i = 0; i < input.length; i += 1) {
      const row = input.getRow(i);
      lines.push(`${Number(row[n])},${Number(row[time])}`);
    }
    return renderedView('cs-complexity', 'example.complexity', lines.join('\n'));
  },
);

export const csNetProtoBlock: BlockDefinition = defineBlock(
  {
    id: 'viz.cs_netproto',
    category: 'visualize',
    name: '网络场景',
    nameI18n: { 'en-US': 'Network Scenario' },
    description: '场景参数表 → 网络协议模拟器（JSON）',
    descriptionI18n: { 'en-US': 'Scenario table → Network Protocol Simulator (JSON)' },
    color: VIZ_COLOR,
    ...viewInput(),
    defaultParams: { protocolColumn: 'protocol', cwndColumn: 'initialCwnd', ssthreshColumn: 'initialSsthresh', roundsColumn: 'rounds', lossColumn: 'lossAt' },
    paramLabels: {
      protocolColumn: { label: '协议列', labelI18n: { 'en-US': 'Protocol column' } },
      cwndColumn: { label: 'cwnd 列', labelI18n: { 'en-US': 'cwnd column' } },
      ssthreshColumn: { label: 'ssthresh 列', labelI18n: { 'en-US': 'ssthresh column' } },
      roundsColumn: { label: '轮数列', labelI18n: { 'en-US': 'Rounds column' } },
      lossColumn: { label: '丢包轮次列', labelI18n: { 'en-US': 'Loss-round column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    if (input.length === 0) throw new Error('empty input');
    const row = input.getRow(0);
    const protocol = String(ctx.getParam('protocolColumn') ?? '') ? String(row[String(ctx.getParam('protocolColumn'))] ?? 'reno') : 'reno';
    const scenario: Record<string, unknown> = { protocol };
    const num = (key: string): number | undefined => {
      const col = String(ctx.getParam(key) ?? '');
      const v = Number(row[col]);
      return Number.isFinite(v) ? v : undefined;
    };
    const cwnd = num('cwndColumn');
    const ssthresh = num('ssthreshColumn');
    const rounds = num('roundsColumn');
    if (cwnd !== undefined) scenario.initialCwnd = cwnd;
    if (ssthresh !== undefined) scenario.initialSsthresh = ssthresh;
    if (rounds !== undefined) scenario.rounds = rounds;
    const lossCol = String(ctx.getParam('lossColumn') ?? '');
    if (lossCol && row[lossCol] !== undefined) {
      scenario.lossAt = String(row[lossCol])
        .split(/[,\s;]+/)
        .map(Number)
        .filter((v) => Number.isFinite(v));
    }
    return renderedView('cs-netproto', 'example.netproto', JSON.stringify(scenario, null, 2));
  },
);

/** Shared factory for the seven statistics `viz.*` blocks: the whole input
 * table is serialized as CSV and handed to the target plugin. */
function statsViewBlock(cfg: {
  id: string;
  viewType: string;
  pluginId: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
}): BlockDefinition {
  return defineBlock(
    {
      id: cfg.id,
      category: 'visualize',
      name: cfg.name,
      nameI18n: { 'en-US': cfg.nameEn },
      description: cfg.description,
      descriptionI18n: { 'en-US': cfg.descriptionEn },
      color: VIZ_COLOR,
      ...viewInput(),
    },
    async (ctx) => {
      const input = ctx.getInput('data') as DataTable;
      if (!input || input.length === 0) throw new Error('empty input');
      return renderedView(cfg.viewType, cfg.pluginId, toCsvTable(input));
    },
  );
}

export const statsDoeBlock = statsViewBlock({
  id: 'viz.stats_doe',
  viewType: 'stats-doe',
  pluginId: 'example.stats-doe',
  name: '试验设计',
  nameEn: 'Design of Experiments',
  description: '因子响应表 → DOE 效应与方差分析',
  descriptionEn: 'Factor/response table → DOE effects & ANOVA',
});

export const statsTimeseriesBlock = statsViewBlock({
  id: 'viz.stats_timeseries',
  viewType: 'stats-timeseries',
  pluginId: 'example.stats-timeseries',
  name: '时间序列分析',
  nameEn: 'Time Series Analysis',
  description: '时间/数值表 → 分解、ARIMA 与 GARCH',
  descriptionEn: 'time/value table → decomposition, ARIMA & GARCH',
});

export const statsMultivariateBlock = statsViewBlock({
  id: 'viz.stats_multivariate',
  viewType: 'stats-multivariate',
  pluginId: 'example.stats-multivariate',
  name: '多元统计分析',
  nameEn: 'Multivariate Analysis',
  description: '观测 × 变量表 → PCA 与聚类',
  descriptionEn: 'observations × variables → PCA & clustering',
});

export const statsNonparametricBlock = statsViewBlock({
  id: 'viz.stats_nonparametric',
  viewType: 'stats-nonparametric',
  pluginId: 'example.stats-nonparametric',
  name: '非参数检验',
  nameEn: 'Nonparametric Tests',
  description: '分组表 → 秩和 / 符号 / KS 检验',
  descriptionEn: 'grouped table → rank / sign / KS tests',
});

export const statsSurvivalBlock = statsViewBlock({
  id: 'viz.stats_survival',
  viewType: 'stats-survival',
  pluginId: 'example.stats-survival',
  name: '生存分析',
  nameEn: 'Survival Analysis',
  description: 'time/event 表 → KM 曲线与 Cox 模型',
  descriptionEn: 'time/event table → KM curves & Cox model',
});

export const statsMetaBlock = statsViewBlock({
  id: 'viz.stats_meta',
  viewType: 'stats-meta',
  pluginId: 'example.stats-meta',
  name: '元分析',
  nameEn: 'Meta-Analysis',
  description: 'study/effect/se 表 → 森林图与漏斗图',
  descriptionEn: 'study/effect/se table → forest & funnel plots',
});

export const statsBayesBlock = statsViewBlock({
  id: 'viz.stats_bayes',
  viewType: 'stats-bayes',
  pluginId: 'example.stats-bayes',
  name: '贝叶斯推断',
  nameEn: 'Bayesian Inference',
  description: '数值表 → MCMC 后验与收敛诊断',
  descriptionEn: 'numeric table → MCMC posterior & convergence',
});

export const visualizeBlocks: BlockDefinition[] = [
  scatterBlock,
  lineBlock,
  histogramViewBlock,
  pointCloud2DBlock,
  seismicModelBlock,
  mineralDatabaseBlock,
  pumpingTestBlock,
  tuningTableBlock,
  colorPaletteBlock,
  acousticsWaveformBlock,
  synthPresetsBlock,
  csAlgorithmsBlock,
  csDataStructuresBlock,
  csAutomataBlock,
  csCryptoBlock,
  csNeuralVizBlock,
  csComplexityBlock,
  csNetProtoBlock,
  statsDoeBlock,
  statsTimeseriesBlock,
  statsMultivariateBlock,
  statsNonparametricBlock,
  statsSurvivalBlock,
  statsMetaBlock,
  statsBayesBlock,
];
