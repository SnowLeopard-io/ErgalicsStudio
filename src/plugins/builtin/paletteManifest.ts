// ==========================================================================
// Palette Explorer manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const paletteManifest: PluginManifest = {
  id: 'fun.palette',
  name: 'Palette Explorer',
  nameI18n: { 'zh-CN': '配色探索器', 'en-US': 'Palette Explorer' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Two-stop gradient preview with generated color swatches.',
  descriptionI18n: {
    'zh-CN': '两色渐变预览，并生成可查看的色板样例。',
    'en-US': 'Two-stop gradient preview with generated swatches.',
  },
  license: 'MIT',
  entry: 'fun.palette',
  category: 'utility',
  icon: '❖',
};
