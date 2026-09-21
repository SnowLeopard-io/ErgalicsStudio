// ==========================================================================
// Histogram manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const histogramManifest: PluginManifest = {
  id: 'example.histogram',
  name: 'Histogram',
  nameI18n: { 'zh-CN': '直方图', 'en-US': 'Histogram' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Distribution histogram for numeric data.',
  descriptionI18n: {
    'zh-CN': '对一维数值数据绘制分布直方图，可调节分箱数。',
    'en-US': 'Render a distribution histogram for numeric data.',
  },
  license: 'MIT',
  entry: 'example.histogram',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
