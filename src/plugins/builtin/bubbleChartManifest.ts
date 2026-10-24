// ==========================================================================
// Bubble Chart manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const bubbleChartManifest: PluginManifest = {
  id: 'example.bubble',
  name: 'Bubble Chart',
  nameI18n: { 'zh-CN': '气泡图', 'en-US': 'Bubble Chart' },
  version: '1.0.0',
  author: 'Ergalics',
  description: '3-D scatter with bubble size encoding.',
  descriptionI18n: {
    'zh-CN': '渲染三维数值数据（x y 大小 [颜色]）为气泡图，第四列可作颜色通道。',
    'en-US': 'Render (x, y, size, [color]) as bubbles; 4th column optional color channel.',
  },
  license: 'MIT',
  entry: 'example.bubble',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.xyz', mimeTypes: ['text/plain'], description: 'XYZ data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
  ],
};
