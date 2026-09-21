// ==========================================================================
// Protein Interactions manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const proteinManifest: PluginManifest = {
  id: 'example.protein',
  name: 'Protein Interactions',
  nameI18n: { 'zh-CN': '蛋白质交互网络', 'en-US': 'Protein Interactions' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Protein-protein interaction network + force-directed layout.',
  descriptionI18n: {
    'zh-CN': '蛋白质-蛋白质交互网络与力导向布局计算，输出度分布与连通分量等生物学指标。',
    'en-US': 'PPI network with force-directed layout; reports degree, components, modules.',
  },
  license: 'MIT',
  entry: 'example.protein',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'Protein interaction network' },
  ],
};
