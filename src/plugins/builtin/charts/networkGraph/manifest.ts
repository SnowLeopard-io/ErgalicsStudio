// ==========================================================================
// Network Graph manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const networkGraphManifest: PluginManifest = {
  id: 'example.network',
  name: 'Network Graph',
  nameI18n: { 'zh-CN': '网络图', 'en-US': 'Network Graph' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Force-directed network graph from edge lists.',
  descriptionI18n: {
    'zh-CN': '从边列表数据渲染力导向网络图，支持节点大小、颜色与动画。',
    'en-US': 'Force-directed network graph from edge lists; animated layout with node sizing.',
  },
  license: 'MIT',
  entry: 'example.network',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (source,target,weight)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Edge list' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON graph' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text edge list' },
  ],
};
