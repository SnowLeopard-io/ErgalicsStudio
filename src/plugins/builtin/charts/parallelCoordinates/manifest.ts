// ==========================================================================
// Parallel Coordinates manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const parallelCoordinatesManifest: PluginManifest = {
  id: 'example.parallel',
  name: 'Parallel Coordinates',
  nameI18n: { 'zh-CN': '平行坐标图', 'en-US': 'Parallel Coordinates' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Multi-variate parallel axes plot.',
  descriptionI18n: {
    'zh-CN': '将多变量数据绘制为平行坐标轴，每行一条折线，可用类别列着色。',
    'en-US': 'Render multi-variate data as parallel axes; one polyline per row, optional color column.',
  },
  license: 'MIT',
  entry: 'example.parallel',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
