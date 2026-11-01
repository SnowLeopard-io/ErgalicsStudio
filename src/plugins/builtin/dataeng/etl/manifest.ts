// ==========================================================================
// ETL Pipeline Builder manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const etlManifest: PluginManifest = {
  id: 'data.etl',
  name: 'ETL Pipeline Builder',
  nameI18n: { 'zh-CN': 'ETL 流水线', 'en-US': 'ETL Pipeline Builder' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  entry: 'data.etl',
  category: 'scientific',
  sandbox: 'trusted',
  description:
    'Visual extract-transform-load editor over tabular CSV/JSON data: filter, map, aggregate, join, pivot and melt steps with pandas / R / SQL code export.',
  descriptionI18n: {
    'zh-CN':
      '面向表格 CSV/JSON 数据的可视化 ETL 编辑器：筛选、映射、聚合、连接、透视、长表变换等步骤链，支持导出 pandas / R / SQL 代码。',
    'en-US':
      'Visual extract-transform-load editor over tabular CSV/JSON data: filter, map, aggregate, join, pivot and melt steps with pandas / R / SQL code export.',
  },
  research: {
    tier: 'quasi-research',
    reproducible: true,
    notes:
      'Deterministic kernel over in-memory tables; exports are best-effort reference code for pandas / dplyr / SQL.',
  },
  // xlsx intentionally not declared: the kernel reads CSV and JSON only.
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON records' },
  ],
};
