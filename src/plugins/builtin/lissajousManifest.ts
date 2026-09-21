// ==========================================================================
// Lissajous manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const lissajousManifest: PluginManifest = {
  id: 'fun.lissajous',
  name: 'Lissajous',
  nameI18n: { 'zh-CN': '利萨茹曲线', 'en-US': 'Lissajous' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Animated Lissajous-style parametric curves.',
  descriptionI18n: {
    'zh-CN': '动画利萨茹参数曲线，可调频率与相位。',
    'en-US': 'Animated Lissajous parametric curves with tunable frequency and phase.',
  },
  license: 'MIT',
  entry: 'fun.lissajous',
  category: 'fun',
  icon: '∿',
};
