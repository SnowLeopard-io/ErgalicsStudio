// ==========================================================================
// Error Band manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const errorbandManifest: PluginManifest = {
  id: 'example.errorband',
  name: 'Error Band',
  nameI18n: { 'zh-CN': '误差带图', 'en-US': 'Error Band' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Line chart with a shaded confidence / error band.',
  descriptionI18n: {
    'zh-CN': '折线 + 半透明误差带（置信区间）图，适合带不确定性的测量数据。',
    'en-US': 'Line chart with a shaded confidence/error band for noisy measurements.',
  },
  license: 'MIT',
  entry: 'example.errorband',
  category: 'scientific',
  icon: '∾',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (x,y,err | x,y,ymin,ymax)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
