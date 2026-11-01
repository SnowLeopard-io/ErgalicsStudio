// ==========================================================================
// Schema Inference & Validator manifest — pure data, split from the plugin
// file so a future builtin/index.ts registration can import it statically
// without dragging the plugin implementation into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const schemaManifest: PluginManifest = {
  id: 'data.schema',
  name: 'Schema Inference & Validator',
  nameI18n: { 'zh-CN': 'Schema 推断与校验', 'en-US': 'Schema Inference & Validator' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  entry: 'data.schema',
  category: 'scientific',
  sandbox: 'trusted',
  description:
    'Infer a column schema (types, ranges, categories, patterns, primary-key candidates and functional dependencies) from CSV/JSON tables, emit a draft-07 JSON Schema, validate a second dataset against it and report schema drift.',
  descriptionI18n: {
    'zh-CN':
      '从 CSV/JSON 表格推断列级 Schema（类型、范围、类别域、模式指纹、主键候选与函数依赖），生成 JSON Schema（draft-07），对第二份数据执行校验并报告 Schema 漂移。',
    'en-US':
      'Infer a column schema (types, ranges, categories, patterns, primary-key candidates and functional dependencies) from CSV/JSON tables, emit a draft-07 JSON Schema, validate a second dataset against it and report schema drift.',
  },
  research: {
    tier: 'quasi-research',
    reproducible: true,
    notes:
      'Deterministic inference and validation over the parsed table; no sampling randomness. FD detection is skipped above 40 columns for quadratic-cost reasons.',
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON records' },
  ],
};
