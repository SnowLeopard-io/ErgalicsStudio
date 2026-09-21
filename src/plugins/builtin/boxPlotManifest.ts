// ==========================================================================
// Box Plot manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const boxPlotManifest: PluginManifest = {
  id: 'example.boxplot',
  name: 'Box Plot',
  nameI18n: { 'zh-CN': '箱线图', 'en-US': 'Box Plot' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Box-and-whisker plot for grouped data.',
  descriptionI18n: {
    'zh-CN': '对分组数值数据绘制箱线图（四分位箱体 + 须线 + 离群点）。',
    'en-US': 'Box-and-whisker plot (quartile box + whiskers + outliers) for grouped data.',
  },
  license: 'MIT',
  entry: 'example.boxplot',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (group,value)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
