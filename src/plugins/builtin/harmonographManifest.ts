// ==========================================================================
// Harmonograph manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const harmonographManifest: PluginManifest = {
  id: 'fun.harmonograph',
  name: 'Harmonograph',
  nameI18n: { 'zh-CN': '谐振记录仪', 'en-US': 'Harmonograph' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Damped pendulum curve art (sum of decaying sinusoids).',
  descriptionI18n: {
    'zh-CN': '由衰减正弦叠加生成的谐振曲线艺术。',
    'en-US': 'Curve art from summed decaying sinusoids.',
  },
  license: 'MIT',
  entry: 'fun.harmonograph',
  category: 'fun',
  icon: '♪',
};
