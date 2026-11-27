// ==========================================================================
// Ergalics Studio — Shared Semantic Data Schema Presets
//
// Pure JSON Schema data (zero Zod import) so builtin manifests and UI panels
// can reference shared presets without pulling Zod into the initial bundle.
// Plugins referencing the same preset automatically share dataset
// compatibility recommendations across the workbench.
// ==========================================================================

import type {
  BinaryDataSchema,
  ErgalicsFieldMeta,
  ErgalicsJsonSchema,
  JsonDataSchema,
  PluginDataSchema,
  PluginDataSchemaSpec,
  TabularDataSchema,
  TextDataSchema,
} from '@ergalics/plugin-sdk/types';
import type { PluginManifest } from '@ergalics/plugin-sdk';
import { isPresetRef } from './schema-guard';
import { BUILTIN_PLUGIN_DATA_SCHEMAS } from './builtin-bindings';

export interface TabularColumnDescriptor {
  key: string;
  required: boolean;
  schema: ErgalicsJsonSchema;
  meta: ErgalicsFieldMeta;
  /** Primary display type inferred from JSON Schema. */
  displayType: 'number' | 'integer' | 'boolean' | 'string' | 'enum' | 'date' | 'any';
  nullable: boolean;
  order: number;
}

const DRAFT_2020 = 'https://json-schema.org/draft/2020-12/schema' as const;

export const SHARED_DATA_PRESETS: Readonly<Record<string, PluginDataSchema>> = {
  'ergalics:tabular/xy-series': {
    id: 'primary',
    presetId: 'ergalics:tabular/xy-series',
    kind: 'tabular',
    title: 'XY Numeric Series',
    titleI18n: { 'zh-CN': 'XY 二维数值序列', 'en-US': 'XY Numeric Series' },
    description: 'Two numeric coordinate columns (x, y) with an optional 3rd value/color channel.',
    descriptionI18n: {
      'zh-CN': '两列必填数值坐标 (x, y)，可选第三列数值作为颜色或权重通道。',
      'en-US': 'Two required numeric columns (x, y) with an optional 3rd numeric value/color channel.',
    },
    extensions: ['.csv', '.tsv', '.dat', '.xyz', '.txt'],
    allowExtraColumns: true,
    allowHeaderless: true,
    liveSync: true,
    minRows: 2,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        x: {
          type: 'number',
          title: 'X',
          'x-ergalics': {
            labelI18n: { 'zh-CN': 'X 值', 'en-US': 'X' },
            aliases: ['x', 'x_val', 't', 'time', 'freq', 'wavelength', '横坐标'],
            role: 'x',
            editorHint: 'number',
            order: 1,
          },
        },
        y: {
          type: 'number',
          title: 'Y',
          'x-ergalics': {
            labelI18n: { 'zh-CN': 'Y 值', 'en-US': 'Y' },
            aliases: ['y', 'y_val', 'signal', 'intensity', 'amplitude', 'response', '纵坐标'],
            role: 'y',
            editorHint: 'number',
            order: 2,
          },
        },
        value: {
          type: 'number',
          title: 'Value / Color',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '值 / 颜色通道', 'en-US': 'Value / Color' },
            aliases: ['c', 'z', 'color', 'val', 'weight', 'intensity', '颜色', '值'],
            role: 'color',
            editorHint: 'number',
            order: 3,
          },
        },
      },
      required: ['x', 'y'],
      additionalProperties: true,
    },
    sampleRows: [
      { x: 0.0, y: 1.2, value: 0.1 },
      { x: 1.0, y: 2.8, value: 0.35 },
      { x: 2.0, y: 4.1, value: 0.55 },
      { x: 3.0, y: 5.9, value: 0.8 },
      { x: 4.0, y: 7.4, value: 0.95 },
    ],
  },

  'ergalics:tabular/xyz-points': {
    id: 'primary',
    presetId: 'ergalics:tabular/xyz-points',
    kind: 'tabular',
    title: 'XYZ 3D Coordinates',
    titleI18n: { 'zh-CN': 'XYZ 三维坐标表', 'en-US': 'XYZ 3D Coordinates' },
    description: 'Three numeric spatial coordinates (x, y, z) with an optional scalar field value.',
    descriptionI18n: {
      'zh-CN': '三列空间数值坐标 (x, y, z)，可选第四列标量场值。',
      'en-US': 'Three numeric spatial coordinates (x, y, z) with an optional scalar field value.',
    },
    extensions: ['.csv', '.tsv', '.dat', '.xyz'],
    allowExtraColumns: true,
    allowHeaderless: true,
    liveSync: true,
    minRows: 3,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        x: {
          type: 'number',
          title: 'X',
          'x-ergalics': {
            labelI18n: { 'zh-CN': 'X 坐标', 'en-US': 'X' },
            aliases: ['x', 'lon', 'east'],
            role: 'x',
            editorHint: 'number',
            order: 1,
          },
        },
        y: {
          type: 'number',
          title: 'Y',
          'x-ergalics': {
            labelI18n: { 'zh-CN': 'Y 坐标', 'en-US': 'Y' },
            aliases: ['y', 'lat', 'north'],
            role: 'y',
            editorHint: 'number',
            order: 2,
          },
        },
        z: {
          type: 'number',
          title: 'Z',
          'x-ergalics': {
            labelI18n: { 'zh-CN': 'Z 坐标', 'en-US': 'Z' },
            aliases: ['z', 'height', 'elevation', 'depth', 'value'],
            role: 'z',
            editorHint: 'number',
            order: 3,
          },
        },
        value: {
          type: 'number',
          title: 'Scalar Value',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '标量值', 'en-US': 'Scalar Value' },
            aliases: ['c', 'v', 'intensity', 'color', 'temp', '值'],
            role: 'color',
            editorHint: 'number',
            order: 4,
          },
        },
      },
      required: ['x', 'y', 'z'],
      additionalProperties: true,
    },
    sampleRows: [
      { x: 0, y: 0, z: 0.0, value: 0.2 },
      { x: 1, y: 0, z: 0.8, value: 0.5 },
      { x: 0, y: 1, z: 0.6, value: 0.4 },
      { x: 1, y: 1, z: 1.4, value: 0.9 },
    ],
  },

  'ergalics:tabular/category-value': {
    id: 'primary',
    presetId: 'ergalics:tabular/category-value',
    kind: 'tabular',
    title: 'Category & Value Table',
    titleI18n: { 'zh-CN': '分类-数值表', 'en-US': 'Category & Value Table' },
    description: 'Categorical label paired with numeric values and optional grouping/error bars.',
    descriptionI18n: {
      'zh-CN': '分类标签与数值列，可选分组列和误差列。',
      'en-US': 'Categorical label paired with numeric values and optional group/error columns.',
    },
    extensions: ['.csv', '.tsv', '.dat'],
    allowExtraColumns: true,
    allowHeaderless: false,
    liveSync: true,
    minRows: 1,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        category: {
          type: 'string',
          minLength: 1,
          title: 'Category',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '分类', 'en-US': 'Category' },
            aliases: ['label', 'name', 'group', 'class', 'item', '类别', '名称'],
            role: 'category',
            editorHint: 'text',
            order: 1,
          },
        },
        value: {
          type: 'number',
          title: 'Value',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '数值', 'en-US': 'Value' },
            aliases: ['val', 'y', 'count', 'score', 'amount', 'mean', '值', '数量'],
            role: 'value',
            editorHint: 'number',
            order: 2,
          },
        },
        group: {
          type: 'string',
          title: 'Group',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '分组', 'en-US': 'Group' },
            aliases: ['series', 'cohort', 'arm', '分组', '系列'],
            role: 'group',
            editorHint: 'text',
            order: 3,
          },
        },
        error: {
          type: 'number',
          minimum: 0,
          title: 'Error / SD',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '误差 / 标准差', 'en-US': 'Error / SD' },
            aliases: ['sd', 'se', 'err', 'std', 'uncertainty', '误差'],
            role: 'error',
            editorHint: 'number',
            order: 4,
          },
        },
      },
      required: ['category', 'value'],
      additionalProperties: true,
    },
    sampleRows: [
      { category: 'Control', value: 12.4, group: 'Batch A', error: 1.1 },
      { category: 'Low Dose', value: 18.7, group: 'Batch A', error: 1.5 },
      { category: 'High Dose', value: 26.2, group: 'Batch A', error: 2.0 },
    ],
  },

  'ergalics:tabular/univariate': {
    id: 'primary',
    presetId: 'ergalics:tabular/univariate',
    kind: 'tabular',
    title: 'Univariate Sample Table',
    titleI18n: { 'zh-CN': '单变量样本表', 'en-US': 'Univariate Sample Table' },
    description: 'Numeric sample observations with an optional grouping column.',
    descriptionI18n: {
      'zh-CN': '单列数值观测样本，可选分组列用于多组分布对比。',
      'en-US': 'Numeric observations with an optional grouping column for comparison.',
    },
    extensions: ['.csv', '.tsv', '.dat', '.txt'],
    allowExtraColumns: true,
    allowHeaderless: true,
    liveSync: true,
    minRows: 3,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        value: {
          type: 'number',
          title: 'Value',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '观测值', 'en-US': 'Value' },
            aliases: ['x', 'y', 'val', 'sample', 'obs', 'measurement', '数值', '样本'],
            role: 'value',
            editorHint: 'number',
            order: 1,
          },
        },
        group: {
          type: 'string',
          title: 'Group',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '分组', 'en-US': 'Group' },
            aliases: ['category', 'class', 'arm', 'treatment', '组别'],
            role: 'group',
            editorHint: 'text',
            order: 2,
          },
        },
      },
      required: ['value'],
      additionalProperties: true,
    },
    sampleRows: [
      { value: 10.2, group: 'A' },
      { value: 11.5, group: 'A' },
      { value: 9.8, group: 'A' },
      { value: 10.9, group: 'A' },
      { value: 14.1, group: 'B' },
      { value: 13.6, group: 'B' },
      { value: 15.0, group: 'B' },
      { value: 12.9, group: 'B' },
    ],
  },

  'ergalics:tabular/time-series': {
    id: 'primary',
    presetId: 'ergalics:tabular/time-series',
    kind: 'tabular',
    title: 'Time Series Table',
    titleI18n: { 'zh-CN': '时间序列数据表', 'en-US': 'Time Series Table' },
    description: 'Ordered time index (numeric or ISO date) paired with numeric measurements.',
    descriptionI18n: {
      'zh-CN': '时间索引列（数值或 ISO 日期）与测量数值列，可包含额外多通道数值列。',
      'en-US': 'Time index column (numeric or ISO date) with numeric measurements.',
    },
    extensions: ['.csv', '.tsv', '.dat'],
    allowExtraColumns: true,
    allowHeaderless: true,
    liveSync: true,
    minRows: 3,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        time: {
          anyOf: [{ type: 'number' }, { type: 'string', minLength: 1 }],
          title: 'Time',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '时间', 'en-US': 'Time' },
            aliases: ['t', 'date', 'timestamp', 'step', 'index', 'year', '时间', '日期'],
            role: 'time',
            editorHint: 'text',
            order: 1,
          },
        },
        value: {
          type: 'number',
          title: 'Value',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '观测值', 'en-US': 'Value' },
            aliases: ['y', 'val', 'signal', 'series', 'temp', 'price', '值'],
            role: 'value',
            editorHint: 'number',
            order: 2,
          },
        },
      },
      required: ['time', 'value'],
      additionalProperties: true,
    },
    sampleRows: [
      { time: '2026-01-01', value: 102.4 },
      { time: '2026-01-02', value: 105.1 },
      { time: '2026-01-03', value: 103.8 },
      { time: '2026-01-04', value: 109.2 },
    ],
  },

  'ergalics:tabular/edge-list': {
    id: 'primary',
    presetId: 'ergalics:tabular/edge-list',
    kind: 'tabular',
    title: 'Directed Edge / Flow List',
    titleI18n: { 'zh-CN': '有向边 / 流量表', 'en-US': 'Directed Edge / Flow List' },
    description: 'Source node, target node, and positive flow/weight value (shared by Sankey, Network Graph, SNA).',
    descriptionI18n: {
      'zh-CN': '源节点、目标节点与正数值流量/权重（桑基图、网络图、社会网络分析共用）。',
      'en-US': 'Source node, target node, and positive flow/weight (shared by Sankey, Network Graph, SNA).',
    },
    extensions: ['.csv', '.tsv', '.dat'],
    allowExtraColumns: true,
    allowHeaderless: false,
    liveSync: true,
    minRows: 1,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        source: {
          type: 'string',
          minLength: 1,
          title: 'Source',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '源节点', 'en-US': 'Source' },
            aliases: ['from', 'src', 'u', 'origin', '源', '起点'],
            role: 'source',
            editorHint: 'text',
            order: 1,
          },
        },
        target: {
          type: 'string',
          minLength: 1,
          title: 'Target',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '目标节点', 'en-US': 'Target' },
            aliases: ['to', 'dst', 'dest', 'v', 'destination', '目标', '终点'],
            role: 'target',
            editorHint: 'text',
            order: 2,
          },
        },
        value: {
          type: 'number',
          exclusiveMinimum: 0,
          title: 'Value / Weight',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '流量 / 权重', 'en-US': 'Value / Weight' },
            aliases: ['weight', 'w', 'flow', 'count', 'strength', '权重', '流量', '值'],
            role: 'weight',
            editorHint: 'number',
            order: 3,
          },
        },
      },
      required: ['source', 'target', 'value'],
      additionalProperties: true,
    },
    sampleRows: [
      { source: 'Solar', target: 'Grid', value: 45 },
      { source: 'Wind', target: 'Grid', value: 30 },
      { source: 'Grid', target: 'Industry', value: 42 },
      { source: 'Grid', target: 'Residential', value: 33 },
    ],
  },

  'ergalics:tabular/survival-table': {
    id: 'primary',
    presetId: 'ergalics:tabular/survival-table',
    kind: 'tabular',
    title: 'Right-Censored Survival Table',
    titleI18n: { 'zh-CN': '右删失生存分析表', 'en-US': 'Right-Censored Survival Table' },
    description: 'Time-to-event (> 0), binary event indicator (0 = censored, 1 = event), optional group and numeric covariates.',
    descriptionI18n: {
      'zh-CN': '生存时间 (> 0)、事件指示 (0=删失, 1=发生)，可选分组与协变量列。',
      'en-US': 'Survival time (> 0), event indicator (0 = censored, 1 = event), optional group and covariates.',
    },
    extensions: ['.csv', '.tsv'],
    allowExtraColumns: true,
    allowHeaderless: false,
    liveSync: true,
    minRows: 2,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        time: {
          type: 'number',
          exclusiveMinimum: 0,
          title: 'Time',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '生存时间', 'en-US': 'Time' },
            aliases: ['t', 'duration', 'days', 'months', 'os_time', '时间'],
            role: 'time',
            unit: 'd',
            editorHint: 'number',
            order: 1,
          },
        },
        event: {
          type: 'integer',
          enum: [0, 1],
          title: 'Event (0/1)',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '事件 (0=删失, 1=事件)', 'en-US': 'Event (0/1)' },
            aliases: ['status', 'censored', 'death', 'outcome', '事件', '状态'],
            role: 'event',
            editorHint: 'select',
            order: 2,
          },
        },
        group: {
          type: 'string',
          minLength: 1,
          title: 'Group',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '分组', 'en-US': 'Group' },
            aliases: ['arm', 'cohort', 'treatment', 'stratum', '组别', '分组'],
            role: 'group',
            editorHint: 'text',
            order: 3,
          },
        },
      },
      required: ['time', 'event'],
      additionalProperties: true,
    },
    sampleRows: [
      { time: 12, event: 1, group: 'Treatment' },
      { time: 18, event: 0, group: 'Treatment' },
      { time: 24, event: 1, group: 'Treatment' },
      { time: 8, event: 1, group: 'Control' },
      { time: 11, event: 1, group: 'Control' },
      { time: 15, event: 0, group: 'Control' },
    ],
  },

  'ergalics:tabular/geo-points': {
    id: 'primary',
    presetId: 'ergalics:tabular/geo-points',
    kind: 'tabular',
    title: 'Geographic Points Table',
    titleI18n: { 'zh-CN': '地理坐标点表', 'en-US': 'Geographic Points Table' },
    description: 'Latitude (-90..90) and Longitude (-180..180) with optional value and label.',
    descriptionI18n: {
      'zh-CN': '纬度 (-90..90) 与经度 (-180..180)，可选测量值和地名标签。',
      'en-US': 'Latitude (-90..90) and Longitude (-180..180) with optional value and label.',
    },
    extensions: ['.csv', '.tsv'],
    allowExtraColumns: true,
    allowHeaderless: false,
    liveSync: true,
    minRows: 1,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        lat: {
          type: 'number',
          minimum: -90,
          maximum: 90,
          title: 'Latitude',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '纬度', 'en-US': 'Latitude' },
            aliases: ['latitude', 'y', '纬度'],
            role: 'lat',
            unit: '°',
            editorHint: 'number',
            order: 1,
          },
        },
        lon: {
          type: 'number',
          minimum: -180,
          maximum: 180,
          title: 'Longitude',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '经度', 'en-US': 'Longitude' },
            aliases: ['lng', 'long', 'longitude', 'x', '经度'],
            role: 'lon',
            unit: '°',
            editorHint: 'number',
            order: 2,
          },
        },
        value: {
          type: 'number',
          title: 'Value',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '数值', 'en-US': 'Value' },
            aliases: ['val', 'mag', 'magnitude', 'elevation', '值'],
            role: 'value',
            editorHint: 'number',
            order: 3,
          },
        },
        label: {
          type: 'string',
          title: 'Label',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '名称', 'en-US': 'Label' },
            aliases: ['name', 'city', 'station', '名称', '站点'],
            role: 'label',
            editorHint: 'text',
            order: 4,
          },
        },
      },
      required: ['lat', 'lon'],
      additionalProperties: true,
    },
    sampleRows: [
      { lat: 39.9042, lon: 116.4074, value: 21.5, label: 'Beijing' },
      { lat: 31.2304, lon: 121.4737, value: 24.9, label: 'Shanghai' },
      { lat: 22.5431, lon: 114.0579, value: 17.6, label: 'Shenzhen' },
    ],
  },

  'ergalics:json/node-link-graph': {
    id: 'graph-json',
    presetId: 'ergalics:json/node-link-graph',
    kind: 'json',
    title: 'Node-Link Graph JSON',
    titleI18n: { 'zh-CN': '节点-连线图谱 JSON', 'en-US': 'Node-Link Graph JSON' },
    description: 'JSON object with `nodes` and `links` arrays.',
    descriptionI18n: {
      'zh-CN': '包含 `nodes` 节点数组与 `links` 连线数组的 JSON 图结构。',
      'en-US': 'JSON graph object containing `nodes` and `links` arrays.',
    },
    extensions: ['.json'],
    liveSync: true,
    schema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          minItems: 1,
          title: 'Nodes',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '节点列表', 'en-US': 'Nodes' },
          },
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1 },
              label: { type: 'string' },
              group: { anyOf: [{ type: 'string' }, { type: 'number' }] },
            },
            required: ['id'],
            additionalProperties: true,
          },
        },
        links: {
          type: 'array',
          minItems: 1,
          title: 'Links',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '连线列表', 'en-US': 'Links' },
          },
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', minLength: 1 },
              target: { type: 'string', minLength: 1 },
              weight: { type: 'number', exclusiveMinimum: 0 },
              value: { type: 'number', exclusiveMinimum: 0 },
            },
            required: ['source', 'target'],
            additionalProperties: true,
          },
        },
      },
      required: ['links'],
      additionalProperties: true,
    },
    sample: {
      nodes: [
        { id: 'A', label: 'Hub A' },
        { id: 'B', label: 'Node B' },
        { id: 'C', label: 'Node C' },
      ],
      links: [
        { source: 'A', target: 'B', weight: 2 },
        { source: 'B', target: 'C', weight: 1.5 },
        { source: 'C', target: 'A', weight: 1 },
      ],
    },
  } satisfies JsonDataSchema,

  'ergalics:tabular/xy-error': {
    id: 'primary',
    presetId: 'ergalics:tabular/xy-error',
    kind: 'tabular',
    title: 'XY Series with Error',
    titleI18n: { 'zh-CN': 'XY 含误差数值表', 'en-US': 'XY Series with Error' },
    description: 'Ordered x, y measurements with symmetric error bar (`err >= 0`).',
    descriptionI18n: {
      'zh-CN': '包含 x、y 坐标与非负误差棒 `err` 的数值表（误差带、光变曲线等共用）。',
      'en-US': 'Numeric x, y series with non-negative uncertainty column `err`.',
    },
    extensions: ['.csv', '.tsv', '.dat', '.txt'],
    allowExtraColumns: true,
    allowHeaderless: true,
    liveSync: true,
    minRows: 2,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        x: {
          type: 'number',
          title: 'X',
          'x-ergalics': {
            labelI18n: { 'zh-CN': 'X / 时间', 'en-US': 'X / Time' },
            aliases: ['time', 't', 'phase', 'wavelength', '横坐标'],
            role: 'x',
            editorHint: 'number',
            order: 1,
          },
        },
        y: {
          type: 'number',
          title: 'Y',
          'x-ergalics': {
            labelI18n: { 'zh-CN': 'Y / 测量值', 'en-US': 'Y / Value' },
            aliases: ['flux', 'signal', 'mean', 'value', 'intensity', '纵坐标'],
            role: 'y',
            editorHint: 'number',
            order: 2,
          },
        },
        err: {
          type: 'number',
          minimum: 0,
          title: 'Error',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '误差 / 不确定度', 'en-US': 'Error' },
            aliases: ['sd', 'se', 'sigma', 'std', 'uncertainty', 'error', '误差'],
            role: 'error',
            editorHint: 'number',
            order: 3,
          },
        },
      },
      required: ['x', 'y', 'err'],
      additionalProperties: true,
    },
    sampleRows: [
      { x: 0, y: 1.0, err: 0.08 },
      { x: 1, y: 1.9, err: 0.12 },
      { x: 2, y: 3.1, err: 0.15 },
      { x: 3, y: 3.8, err: 0.11 },
      { x: 4, y: 5.2, err: 0.18 },
    ],
  },

  'ergalics:tabular/bubble-xyz': {
    id: 'primary',
    presetId: 'ergalics:tabular/bubble-xyz',
    kind: 'tabular',
    title: 'Bubble Chart Table',
    titleI18n: { 'zh-CN': '气泡图数据表 (x, y, size)', 'en-US': 'Bubble Chart Table' },
    description: 'Numeric x, y coordinates with positive bubble size and optional color value.',
    descriptionI18n: {
      'zh-CN': '二维坐标 (x, y) 与正数值气泡大小 (size)，可选第 4 列颜色通道。',
      'en-US': 'Numeric x, y coordinates with positive bubble size and optional color channel.',
    },
    extensions: ['.csv', '.tsv', '.dat', '.xyz'],
    allowExtraColumns: true,
    allowHeaderless: true,
    liveSync: true,
    minRows: 2,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        x: {
          type: 'number',
          title: 'X',
          'x-ergalics': { labelI18n: { 'zh-CN': 'X 坐标', 'en-US': 'X' }, role: 'x', order: 1 },
        },
        y: {
          type: 'number',
          title: 'Y',
          'x-ergalics': { labelI18n: { 'zh-CN': 'Y 坐标', 'en-US': 'Y' }, role: 'y', order: 2 },
        },
        size: {
          type: 'number',
          exclusiveMinimum: 0,
          title: 'Size',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '气泡大小', 'en-US': 'Size' },
            aliases: ['r', 'radius', 'z', 'weight', 'mass', '大小'],
            role: 'size',
            order: 3,
          },
        },
        color: {
          type: 'number',
          title: 'Color Value',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '颜色值', 'en-US': 'Color' },
            aliases: ['c', 'value', 'score', '颜色'],
            role: 'color',
            order: 4,
          },
        },
      },
      required: ['x', 'y', 'size'],
      additionalProperties: true,
    },
    sampleRows: [
      { x: 10, y: 20, size: 12, color: 0.2 },
      { x: 25, y: 40, size: 28, color: 0.6 },
      { x: 42, y: 31, size: 18, color: 0.45 },
      { x: 58, y: 55, size: 36, color: 0.9 },
    ],
  },

  'ergalics:tabular/grouped-values': {
    id: 'primary',
    presetId: 'ergalics:tabular/grouped-values',
    kind: 'tabular',
    title: 'Grouped Observations (group, value)',
    titleI18n: { 'zh-CN': '分组观测表 (group, value)', 'en-US': 'Grouped Observations' },
    description: 'Long-format grouped measurements (`group`, `value`), shared by Box Plot, Violin Plot, Nonparametric Tests, and Reaction Time.',
    descriptionI18n: {
      'zh-CN': '长表格式分组观测数据（`group, value`），箱线图、小提琴图、非参数检验与反应时分析共用。',
      'en-US': 'Long-format `group, value` observations shared by Box Plot, Violin Plot, and Nonparametric Tests.',
    },
    extensions: ['.csv', '.tsv', '.dat', '.txt'],
    allowExtraColumns: true,
    allowHeaderless: false,
    liveSync: true,
    minRows: 4,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        group: {
          type: 'string',
          minLength: 1,
          title: 'Group',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '分组 / 条件', 'en-US': 'Group / Condition' },
            aliases: ['condition', 'arm', 'category', 'label', 'treatment', 'class', '分组', '条件'],
            role: 'group',
            order: 1,
          },
        },
        value: {
          type: 'number',
          title: 'Value',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '观测值', 'en-US': 'Value' },
            aliases: ['val', 'y', 'rt', 'score', 'obs', 'measurement', '数值', '反应时'],
            role: 'value',
            order: 2,
          },
        },
      },
      required: ['group', 'value'],
      additionalProperties: true,
    },
    sampleRows: [
      { group: 'Control', value: 11.2 },
      { group: 'Control', value: 12.6 },
      { group: 'Control', value: 10.8 },
      { group: 'Control', value: 13.1 },
      { group: 'Treated', value: 15.4 },
      { group: 'Treated', value: 16.9 },
      { group: 'Treated', value: 14.8 },
      { group: 'Treated', value: 17.2 },
    ],
  },

  'ergalics:tabular/label-size': {
    id: 'primary',
    presetId: 'ergalics:tabular/label-size',
    kind: 'tabular',
    title: 'Hierarchy / Size Table',
    titleI18n: { 'zh-CN': '层级/占比数据表 (label, parent, size)', 'en-US': 'Hierarchy / Size Table' },
    description: 'Item label, optional parent group (blank for top-level), and non-negative size (`label, parent, size`).',
    descriptionI18n: {
      'zh-CN': '节点名称（label）、父级分类（parent，顶层留空）与非负面积/权重（size），用于矩形树图。',
      'en-US': 'Node label, optional parent (blank for root), and non-negative size (`label, parent, size`).',
    },
    extensions: ['.csv', '.tsv', '.dat', '.txt'],
    allowExtraColumns: true,
    allowHeaderless: false,
    liveSync: true,
    minRows: 2,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        label: {
          type: 'string',
          minLength: 1,
          title: 'Label',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '名称', 'en-US': 'Label' },
            aliases: ['name', 'category', 'item', 'node', '名称'],
            role: 'label',
            order: 1,
          },
        },
        parent: {
          type: 'string',
          title: 'Parent',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '父分类（顶层留空）', 'en-US': 'Parent' },
            aliases: ['group', 'category', '父级'],
            role: 'group',
            order: 2,
          },
        },
        size: {
          type: 'number',
          minimum: 0,
          title: 'Size',
          'x-ergalics': {
            labelI18n: { 'zh-CN': '面积 / 数值', 'en-US': 'Size' },
            aliases: ['value', 'val', 'weight', 'count', 'amount', '数值'],
            role: 'size',
            order: 3,
          },
        },
      },
      required: ['label', 'size'],
      additionalProperties: true,
    },
    sampleRows: [
      { label: 'Hardware', parent: '', size: 0 },
      { label: 'Compute', parent: 'Hardware', size: 42 },
      { label: 'Storage', parent: 'Hardware', size: 26 },
      { label: 'Software', parent: '', size: 0 },
      { label: 'Models', parent: 'Software', size: 35 },
      { label: 'Viz', parent: 'Software', size: 19 },
    ],
  },

  'ergalics:tabular/multi-numeric': {
    id: 'primary',
    presetId: 'ergalics:tabular/multi-numeric',
    kind: 'tabular',
    title: 'Multivariate Numeric Matrix',
    titleI18n: { 'zh-CN': '多维数值矩阵', 'en-US': 'Multivariate Numeric Matrix' },
    description: 'Observations across multiple numeric dimensions (x1, x2, x3, …) with optional group label.',
    descriptionI18n: {
      'zh-CN': '多列数值特征矩阵（允许自由添加更多数值列），可选分组标签（平行坐标、主成分/聚类、雷达图共用）。',
      'en-US': 'Multi-column numeric observations with optional group label (Parallel Coordinates, Multivariate PCA/Clustering).',
    },
    extensions: ['.csv', '.tsv', '.dat', '.txt'],
    allowExtraColumns: true,
    allowHeaderless: false,
    liveSync: true,
    minRows: 4,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        x1: {
          type: 'number',
          title: 'Dim 1',
          'x-ergalics': { labelI18n: { 'zh-CN': '特征 1', 'en-US': 'Dim 1' }, aliases: ['f1', 'v1', 'a', 'col1'], order: 1 },
        },
        x2: {
          type: 'number',
          title: 'Dim 2',
          'x-ergalics': { labelI18n: { 'zh-CN': '特征 2', 'en-US': 'Dim 2' }, aliases: ['f2', 'v2', 'b', 'col2'], order: 2 },
        },
        x3: {
          type: 'number',
          title: 'Dim 3',
          'x-ergalics': { labelI18n: { 'zh-CN': '特征 3', 'en-US': 'Dim 3' }, aliases: ['f3', 'v3', 'c', 'col3'], order: 3 },
        },
        group: {
          type: 'string',
          title: 'Group',
          'x-ergalics': { labelI18n: { 'zh-CN': '分组 / 类别', 'en-US': 'Group' }, aliases: ['label', 'class', 'species', 'cluster'], role: 'group', order: 4 },
        },
      },
      required: ['x1', 'x2'],
      additionalProperties: true,
    },
    sampleRows: [
      { x1: 5.1, x2: 3.5, x3: 1.4, group: 'A' },
      { x1: 4.9, x2: 3.0, x3: 1.5, group: 'A' },
      { x1: 6.4, x2: 3.2, x3: 4.5, group: 'B' },
      { x1: 6.9, x2: 3.1, x3: 4.9, group: 'B' },
      { x1: 7.2, x2: 3.6, x3: 6.1, group: 'C' },
      { x1: 6.7, x2: 3.3, x3: 5.7, group: 'C' },
    ],
  },

  'ergalics:tabular/meta-analysis': {
    id: 'primary',
    presetId: 'ergalics:tabular/meta-analysis',
    kind: 'tabular',
    title: 'Meta-Analysis Effect Table',
    titleI18n: { 'zh-CN': '元分析效应量表', 'en-US': 'Meta-Analysis Effect Table' },
    description: 'Per-study label, effect size, and positive standard error (`study, effect, se[, group]`).',
    descriptionI18n: {
      'zh-CN': '各研究名称（study）、效应量（effect）与正标准误（se > 0），可选亚组列。',
      'en-US': 'Study name, effect size, positive standard error (`se > 0`), and optional subgroup.',
    },
    extensions: ['.csv', '.tsv'],
    allowExtraColumns: true,
    allowHeaderless: false,
    liveSync: true,
    minRows: 2,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        study: {
          type: 'string',
          minLength: 1,
          title: 'Study',
          'x-ergalics': { labelI18n: { 'zh-CN': '研究名称', 'en-US': 'Study' }, aliases: ['name', 'author', 'trial', 'id', '研究'], role: 'label', order: 1 },
        },
        effect: {
          type: 'number',
          title: 'Effect Size',
          'x-ergalics': { labelI18n: { 'zh-CN': '效应量', 'en-US': 'Effect' }, aliases: ['yi', 'es', 'theta', 'logor', 'smd', '效应量'], role: 'value', order: 2 },
        },
        se: {
          type: 'number',
          exclusiveMinimum: 0,
          title: 'Std. Error',
          'x-ergalics': { labelI18n: { 'zh-CN': '标准误', 'en-US': 'SE' }, aliases: ['sei', 'stderr', 'error', 'sd', '标准误'], role: 'error', order: 3 },
        },
        group: {
          type: 'string',
          title: 'Subgroup',
          'x-ergalics': { labelI18n: { 'zh-CN': '亚组', 'en-US': 'Subgroup' }, aliases: ['subgroup', 'arm', '亚组'], role: 'group', order: 4 },
        },
      },
      required: ['study', 'effect', 'se'],
      additionalProperties: true,
    },
    sampleRows: [
      { study: 'Trial 2021', effect: 0.42, se: 0.14, group: 'Phase III' },
      { study: 'Trial 2022', effect: 0.28, se: 0.18, group: 'Phase III' },
      { study: 'Trial 2023', effect: 0.55, se: 0.12, group: 'Phase II' },
      { study: 'Trial 2024', effect: 0.36, se: 0.16, group: 'Phase II' },
    ],
  },

  'ergalics:tabular/doe-table': {
    id: 'primary',
    presetId: 'ergalics:tabular/doe-table',
    kind: 'tabular',
    title: 'DOE Factorial Design Table',
    titleI18n: { 'zh-CN': '实验设计 (DOE) 因子响应表', 'en-US': 'DOE Factorial Table' },
    description: 'Run index, numeric factor columns (`A`, `B`, …), and numeric `response` column.',
    descriptionI18n: {
      'zh-CN': '试验序号（run）、因子水平列（A, B, …）与目标响应值（response），支持追加更多因子列。',
      'en-US': 'Run id, numeric factors (A, B, …), and numeric response column.',
    },
    extensions: ['.csv', '.tsv'],
    allowExtraColumns: true,
    allowHeaderless: false,
    liveSync: true,
    minRows: 4,
    rowSchema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        run: {
          type: 'integer',
          minimum: 1,
          title: 'Run',
          'x-ergalics': { labelI18n: { 'zh-CN': '试验序号', 'en-US': 'Run' }, aliases: ['id', 'trial', 'index'], role: 'id', order: 1 },
        },
        A: {
          type: 'number',
          title: 'Factor A',
          'x-ergalics': { labelI18n: { 'zh-CN': '因子 A', 'en-US': 'Factor A' }, aliases: ['x1', 'factor_a', 'temp'], order: 2 },
        },
        B: {
          type: 'number',
          title: 'Factor B',
          'x-ergalics': { labelI18n: { 'zh-CN': '因子 B', 'en-US': 'Factor B' }, aliases: ['x2', 'factor_b', 'pressure'], order: 3 },
        },
        response: {
          type: 'number',
          title: 'Response',
          'x-ergalics': { labelI18n: { 'zh-CN': '响应值', 'en-US': 'Response' }, aliases: ['y', 'yield', 'output', '响应'], role: 'y', order: 4 },
        },
      },
      required: ['run', 'A', 'B', 'response'],
      additionalProperties: true,
    },
    sampleRows: [
      { run: 1, A: -1, B: -1, response: 28.4 },
      { run: 2, A: 1, B: -1, response: 36.1 },
      { run: 3, A: -1, B: 1, response: 31.2 },
      { run: 4, A: 1, B: 1, response: 45.8 },
    ],
  },

  'ergalics:json/grid-2d': {
    id: 'grid-json',
    presetId: 'ergalics:json/grid-2d',
    kind: 'json',
    title: '2D Numeric Grid JSON',
    titleI18n: { 'zh-CN': '二维数值网格 JSON', 'en-US': '2D Numeric Grid JSON' },
    description: '2-D numeric matrix (`number[][]`) or `{ values: number[][], rowLabels?, colLabels? }` for Heatmap, Contour, and 3D Surface.',
    descriptionI18n: {
      'zh-CN': '二维数值矩阵或 `{ values, rowLabels?, colLabels? }`（热力图、等值线、3D 曲面共用）。',
      'en-US': '2-D numeric matrix or `{ values, rowLabels?, colLabels? }` (Heatmap, Contour, 3D Surface).',
    },
    extensions: ['.json'],
    liveSync: true,
    schema: {
      $schema: DRAFT_2020,
      anyOf: [
        {
          type: 'array',
          minItems: 2,
          items: { type: 'array', minItems: 2, items: { type: 'number' } },
        },
        {
          type: 'object',
          properties: {
            values: {
              type: 'array',
              minItems: 2,
              items: { type: 'array', minItems: 2, items: { type: 'number' } },
            },
            rowLabels: { type: 'array', items: { type: 'string' } },
            colLabels: { type: 'array', items: { type: 'string' } },
          },
          required: ['values'],
          additionalProperties: true,
        },
        {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              minItems: 2,
              items: { type: 'array', minItems: 2, items: { type: 'number' } },
            },
            rowLabels: { type: 'array', items: { type: 'string' } },
            colLabels: { type: 'array', items: { type: 'string' } },
          },
          required: ['data'],
          additionalProperties: true,
        },
      ],
    },
    sample: {
      rowLabels: ['R1', 'R2', 'R3', 'R4'],
      colLabels: ['C1', 'C2', 'C3', 'C4'],
      values: [
        [0.1, 0.4, 0.7, 0.3],
        [0.4, 0.9, 1.0, 0.5],
        [0.6, 0.8, 0.6, 0.2],
        [0.2, 0.3, 0.4, 0.1],
      ],
    },
  } satisfies JsonDataSchema,

  'ergalics:json/voxel-3d': {
    id: 'voxel-json',
    presetId: 'ergalics:json/voxel-3d',
    kind: 'json',
    title: '3D Scalar Voxel Field JSON',
    titleI18n: { 'zh-CN': '三维体素标量场 JSON', 'en-US': '3D Scalar Voxel Field JSON' },
    description: '3-D scalar field (`number[][][]` or `{ nx, ny, nz, values }`).',
    descriptionI18n: {
      'zh-CN': '三维标量场数组或 `{ nx, ny, nz, values }` 对象。',
      'en-US': '3-D numeric tensor or `{ nx, ny, nz, values }` object.',
    },
    extensions: ['.json'],
    liveSync: false,
    schema: {
      $schema: DRAFT_2020,
      anyOf: [
        {
          type: 'array',
          minItems: 2,
          items: {
            type: 'array',
            minItems: 2,
            items: { type: 'array', minItems: 2, items: { type: 'number' } },
          },
        },
        {
          type: 'object',
          properties: {
            nx: { type: 'integer', minimum: 2 },
            ny: { type: 'integer', minimum: 2 },
            nz: { type: 'integer', minimum: 2 },
            values: { type: 'array', minItems: 8, items: { type: 'number' } },
          },
          required: ['nx', 'ny', 'nz', 'values'],
          additionalProperties: true,
        },
      ],
    },
    sample: {
      nx: 2,
      ny: 2,
      nz: 2,
      values: [0.1, 0.5, 0.4, 0.9, 0.3, 0.8, 0.6, 1.0],
    },
  } satisfies JsonDataSchema,

  'ergalics:json/geojson': {
    id: 'geojson',
    presetId: 'ergalics:json/geojson',
    kind: 'json',
    title: 'GeoJSON Vector Data',
    titleI18n: { 'zh-CN': 'GeoJSON 地理矢量数据', 'en-US': 'GeoJSON Vector Data' },
    description: 'Standard GeoJSON FeatureCollection or Geometry object.',
    descriptionI18n: {
      'zh-CN': '标准 GeoJSON FeatureCollection 或 Geometry 对象（地图、地球 3D、底图共用）。',
      'en-US': 'Standard GeoJSON FeatureCollection or Geometry object.',
    },
    extensions: ['.geojson', '.json'],
    liveSync: true,
    schema: {
      $schema: DRAFT_2020,
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['FeatureCollection', 'Feature', 'Polygon', 'MultiPolygon', 'LineString', 'Point'],
        },
        features: { type: 'array' },
      },
      required: ['type'],
      additionalProperties: true,
    },
    sample: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Sample Region' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[115, 39], [118, 39], [118, 41], [115, 41], [115, 39]]],
          },
        },
      ],
    },
  } satisfies JsonDataSchema,

  'ergalics:text/fasta': {
    id: 'fasta',
    presetId: 'ergalics:text/fasta',
    kind: 'text',
    title: 'FASTA Biological Sequences',
    titleI18n: { 'zh-CN': 'FASTA 生物序列', 'en-US': 'FASTA Biological Sequences' },
    description: 'One or more nucleotide/protein sequences starting with `>header` lines.',
    descriptionI18n: {
      'zh-CN': '以 `>序列名` 开头的核酸或蛋白质 FASTA 序列文本。',
      'en-US': 'Nucleotide or protein sequences formatted with `>header` lines.',
    },
    extensions: ['.fasta', '.fa', '.txt'],
    language: 'plaintext',
    grammarSummary: 'Each sequence starts with `>name` followed by A/C/G/T/U or amino acid letters.',
    grammarSummaryI18n: {
      'zh-CN': '每条序列以 `>名称` 开头，下行接碱基（ACGTU）或氨基酸字母。',
      'en-US': 'Each sequence begins with `>name` followed by sequence letters.',
    },
    sampleText: '>Seq1\nACGTACGTAGCTAG\n>Seq2\nACGTTCGTAGCGAG',
  } satisfies TextDataSchema,

  'ergalics:text/gpx': {
    id: 'gpx',
    presetId: 'ergalics:text/gpx',
    kind: 'text',
    title: 'GPX Track / Route XML',
    titleI18n: { 'zh-CN': 'GPX 轨迹 XML', 'en-US': 'GPX Track XML' },
    description: 'GPX 1.0/1.1 XML containing `<trkpt lat="..." lon="...">` points.',
    descriptionI18n: {
      'zh-CN': '包含 `<trkpt lat="..." lon="...">` 轨迹点的 GPX 1.0/1.1 XML 文件。',
      'en-US': 'GPX 1.0/1.1 XML containing `<trkpt>` or `<rtept>` coordinates.',
    },
    extensions: ['.gpx'],
    language: 'xml',
    grammarSummary: 'GPX XML with `<trkpt lat="..." lon="...">` and optional `<ele>`.',
    grammarSummaryI18n: {
      'zh-CN': '标准 GPX XML，需包含 `<trkpt lat="..." lon="...">` 坐标点（可选 `<ele>` 海拔）。',
      'en-US': 'Standard GPX XML with `<trkpt>` lat/lon points.',
    },
    sampleText:
      '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1">\n  <trk><name>Demo</name><trkseg>\n    <trkpt lat="39.904" lon="116.407"><ele>45</ele></trkpt>\n    <trkpt lat="39.914" lon="116.417"><ele>52</ele></trkpt>\n  </trkseg></trk>\n</gpx>',
  } satisfies TextDataSchema,

  'ergalics:binary/image': {
    id: 'image',
    presetId: 'ergalics:binary/image',
    kind: 'binary',
    title: 'Raster Image File',
    titleI18n: { 'zh-CN': '栅格图像文件', 'en-US': 'Raster Image File' },
    description: 'PNG, JPEG, WebP, GIF, or BMP raster image.',
    descriptionI18n: {
      'zh-CN': '支持 PNG、JPEG、WebP、GIF、BMP 格式的栅格图像文件。',
      'en-US': 'PNG, JPEG, WebP, GIF, or BMP image.',
    },
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'],
  } satisfies BinaryDataSchema,

  'ergalics:binary/model-3d': {
    id: 'model-3d',
    presetId: 'ergalics:binary/model-3d',
    kind: 'binary',
    title: '3D Mesh / CAD Model',
    titleI18n: { 'zh-CN': '三维网格 / 模型文件', 'en-US': '3D Mesh Model' },
    description: 'glTF / GLB / STL / OBJ / PLY 3D geometry.',
    descriptionI18n: {
      'zh-CN': '支持 GLB、glTF、STL、OBJ、PLY 三维网格模型。',
      'en-US': 'GLB, glTF, STL, OBJ, or PLY 3D mesh.',
    },
    extensions: ['.glb', '.gltf', '.stl', '.obj', '.ply'],
    mimeTypes: ['model/gltf-binary', 'model/gltf+json', 'model/stl', 'text/plain'],
  } satisfies BinaryDataSchema,
};

/** Resolve a single `PluginDataSchemaSpec` (inline or preset ref) to concrete schema. */
export function resolveDataSchemaSpec(spec: PluginDataSchemaSpec): PluginDataSchema | null {
  if (!isPresetRef(spec)) return spec;
  const base = SHARED_DATA_PRESETS[spec.preset];
  if (!base) return null;
  if (!spec.overrides) return base;
  return {
    ...base,
    ...spec.overrides,
    // Keep presetId traceable unless explicitly overridden.
    presetId: spec.overrides.presetId ?? base.presetId ?? spec.preset,
  } as PluginDataSchema;
}

/** Resolve all declared `PluginDataSchema` entries for a plugin manifest. */
export function resolvePluginDataSchemas(
  manifest: Pick<PluginManifest, 'dataSchema'> & { id?: string } | null | undefined,
): PluginDataSchema[] {
  const specSource =
    manifest?.dataSchema ??
    (manifest?.id ? BUILTIN_PLUGIN_DATA_SCHEMAS[manifest.id] : undefined);
  if (!specSource) return [];
  const raw = Array.isArray(specSource) ? specSource : [specSource];
  const resolved: PluginDataSchema[] = [];
  for (const spec of raw) {
    const concrete = resolveDataSchemaSpec(spec);
    if (concrete) resolved.push(concrete);
  }
  return resolved;
}

/** Infer primary display type + nullability of a JSON Schema column node. */
export function inspectSchemaFieldType(schema: ErgalicsJsonSchema): {
  displayType: TabularColumnDescriptor['displayType'];
  nullable: boolean;
} {
  if (schema.enum && schema.enum.length > 0) {
    return {
      displayType: 'enum',
      nullable: schema.enum.includes(null),
    };
  }
  const rawType = schema.type;
  const types = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];
  const nullable = types.includes('null');
  const nonNull = types.filter((t) => t !== 'null');
  if (nonNull.length === 1) {
    const t = nonNull[0]!;
    if (t === 'string' && (schema.format === 'date' || schema.format === 'date-time')) {
      return { displayType: 'date', nullable };
    }
    if (t === 'number' || t === 'integer' || t === 'boolean' || t === 'string') {
      return { displayType: t, nullable };
    }
  }
  return { displayType: 'any', nullable };
}

/** Extract ordered column descriptors from a `TabularDataSchema` for GUI & mapping. */
export function extractTabularColumns(schema: TabularDataSchema): TabularColumnDescriptor[] {
  const props = schema.rowSchema.properties ?? {};
  const requiredSet = new Set(schema.rowSchema.required ?? []);
  const entries = Object.entries(props).map(([key, colSchema], idx): TabularColumnDescriptor => {
    const meta = colSchema['x-ergalics'] ?? {};
    const { displayType, nullable } = inspectSchemaFieldType(colSchema);
    return {
      key,
      required: requiredSet.has(key),
      schema: colSchema,
      meta,
      displayType,
      nullable,
      order: meta.order ?? idx + 100,
    };
  });
  return entries.sort((a, b) => a.order - b.order);
}

/** Resolve localized label for a tabular column descriptor. */
export function columnLabel(col: TabularColumnDescriptor, locale: string): string {
  return col.meta.labelI18n?.[locale] ?? col.schema.title ?? col.key;
}
