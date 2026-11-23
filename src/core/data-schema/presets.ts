// ==========================================================================
// Ergalics Studio — Shared Semantic Data Schema Presets
//
// Pure JSON Schema data (zero Zod import) so builtin manifests and UI panels
// can reference shared presets without pulling Zod into the initial bundle.
// Plugins referencing the same preset automatically share dataset
// compatibility recommendations across the workbench.
// ==========================================================================

import type {
  ErgalicsFieldMeta,
  ErgalicsJsonSchema,
  JsonDataSchema,
  PluginDataSchema,
  PluginDataSchemaSpec,
  TabularDataSchema,
} from '@/types/dataSchema';
import type { PluginManifest } from '@/types/plugin';
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
      { value: 14.1, group: 'B' },
      { value: 13.6, group: 'B' },
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
