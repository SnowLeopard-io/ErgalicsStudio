// ==========================================================================
// Contour Plot manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const contourManifest: PluginManifest = {
  id: 'example.contour',
  name: 'Contour',
  nameI18n: { 'zh-CN': '等值线图', 'en-US': 'Contour' },
  version: '1.0.0',
  author: 'Ergalics',
  description: '2-D field contour plot with color ramp.',
  descriptionI18n: {
    'zh-CN': '渲染二维标量场（JSON 网格）为色带 + 等值线，适合涡旋场、地形等数据。',
    'en-US': '2-D scalar fields as color ramp + contour lines; great for vortex/topography data.',
  },
  license: 'MIT',
  entry: 'example.contour',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: '2-D field grid' },
  ],
};
