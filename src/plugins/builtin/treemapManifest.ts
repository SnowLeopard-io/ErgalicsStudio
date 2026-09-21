// ==========================================================================
// Treemap manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const treemapManifest: PluginManifest = {
  id: 'example.treemap',
  name: 'Treemap',
  nameI18n: { 'zh-CN': '矩形树图', 'en-US': 'Treemap' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Hierarchical rectangle layout sized by value.',
  descriptionI18n: {
    'zh-CN': '用嵌套矩形展示层级数据，矩形面积与数值成正比。',
    'en-US': 'Nested rectangles whose area is proportional to value; hierarchical data.',
  },
  license: 'MIT',
  entry: 'example.treemap',
  category: 'scientific',
  icon: '▦',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (label,size | label,parent,size)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
