// ==========================================================================
// Heatmap manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const heatmapManifest: PluginManifest = {
  id: 'example.heatmap',
  name: 'Heatmap',
  nameI18n: { 'zh-CN': '热力图', 'en-US': 'Heatmap' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Visualize a 2-D numeric field as a heatmap.',
  descriptionI18n: {
    'zh-CN': '将二维数值网格（JSON 矩阵）渲染为热力图。',
    'en-US': 'Visualize a 2-D numeric field as a heatmap.',
  },
  license: 'MIT',
  entry: 'example.heatmap',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: '2-D numeric grid' },
  ],
};
