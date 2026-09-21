// ==========================================================================
// QQ Plot manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const qqplotManifest: PluginManifest = {
  id: 'example.qqplot',
  name: 'QQ Plot',
  nameI18n: { 'zh-CN': 'QQ 图（正态检验）', 'en-US': 'QQ Plot' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Sample quantiles vs normal quantiles with reference line.',
  descriptionI18n: {
    'zh-CN': '样本分位数与标准正态分位数对比，偏离对角线表示非正态。',
    'en-US': 'Sample quantiles vs standard-normal quantiles; deviation from the diagonal signals non-normality.',
  },
  license: 'MIT',
  entry: 'example.qqplot',
  category: 'scientific',
  icon: '↗',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (single numeric column)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
