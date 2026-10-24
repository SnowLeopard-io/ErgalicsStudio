// ==========================================================================
// Sankey Diagram manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const sankeyManifest: PluginManifest = {
  id: 'example.sankey',
  name: 'Sankey Diagram',
  nameI18n: { 'zh-CN': '桑基图', 'en-US': 'Sankey Diagram' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Flow diagram with proportional ribbons.',
  descriptionI18n: {
    'zh-CN': '从源→目标→值的边数据渲染桑基流图，带按比例缩放的流量带。',
    'en-US': 'Flow diagram from source→target→value edges; ribbons sized proportionally.',
  },
  license: 'MIT',
  entry: 'example.sankey',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (source,target,value)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Edge list' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text edge list' },
  ],
};
