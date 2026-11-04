// ==========================================================================
// Bar Chart manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const barChartManifest: PluginManifest = {
  id: 'example.bar_chart',
  name: 'Bar Chart',
  nameI18n: { 'zh-CN': '柱状图', 'en-US': 'Bar Chart' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Vertical/horizontal bar chart for categorical data.',
  descriptionI18n: {
    'zh-CN': '渲染分类数据为柱状图，支持水平/垂直方向与配色选择。',
    'en-US': 'Render categorical data as bars; horizontal/vertical orientation with palettes.',
  },
  license: 'MIT',
  entry: 'example.bar_chart',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (label,value)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
