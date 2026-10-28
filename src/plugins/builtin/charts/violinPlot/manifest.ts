// ==========================================================================
// Violin Plot manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const violinPlotManifest: PluginManifest = {
  id: 'example.violin',
  name: 'Violin Plot',
  nameI18n: { 'zh-CN': '小提琴图', 'en-US': 'Violin Plot' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Kernel density violin plot for grouped data.',
  descriptionI18n: {
    'zh-CN': '对分组数值数据绘制核密度小提琴图，支持带宽调节与箱线图叠加。',
    'en-US': 'Kernel density violin plot for grouped data; adjustable bandwidth with box overlay.',
  },
  license: 'MIT',
  entry: 'example.violin',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (group,value)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
