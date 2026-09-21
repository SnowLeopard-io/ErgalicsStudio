// ==========================================================================
// Scatter Plot manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const scatterManifest: PluginManifest = {
  id: 'example.scatter',
  name: 'Scatter Plot',
  nameI18n: { 'zh-CN': '散点图', 'en-US': 'Scatter Plot' },
  version: '1.0.0',
  author: 'Ergalics',
  description: '2-D scatter with color-by-value.',
  descriptionI18n: {
    'zh-CN': '渲染数值列（x y [值]）为二维散点，第三列可作为颜色通道。',
    'en-US': 'Render numeric columns (x y [value]) as a 2-D scatter; 3rd column optional color ramp.',
  },
  license: 'MIT',
  entry: 'example.scatter',
  formats: [
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Scatter data' },
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'Scatter data' },
    { extension: '.xyz', mimeTypes: ['text/plain', 'chemical/x-xyz'], description: 'Scatter data' },
  ],
};
