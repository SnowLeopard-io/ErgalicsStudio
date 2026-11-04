// ==========================================================================
// Polar Plot manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const polarPlotManifest: PluginManifest = {
  id: 'example.polar',
  name: 'Polar Plot',
  nameI18n: { 'zh-CN': '雷达图', 'en-US': 'Polar Plot' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Multi-series radar/polar chart.',
  descriptionI18n: {
    'zh-CN': '渲染多系列雷达/极坐标图，每列一个维度，每行一个系列。',
    'en-US': 'Multi-series radar/polar chart; each column is an axis, each row a series.',
  },
  license: 'MIT',
  entry: 'example.polar',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
