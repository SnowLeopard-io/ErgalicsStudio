// ==========================================================================
// Spirograph manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const spirographManifest: PluginManifest = {
  id: 'fun.spirograph',
  name: 'Spirograph',
  nameI18n: { 'zh-CN': '万花尺', 'en-US': 'Spirograph' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Hypotrochoid / epitrochoid spiral art generator.',
  descriptionI18n: {
    'zh-CN': '生成内旋轮线（万花尺）曲线艺术。',
    'en-US': 'Generate hypotrochoid / epitrochoid spiral art.',
  },
  license: 'MIT',
  entry: 'fun.spirograph',
  category: 'fun',
  icon: '✺',
};
