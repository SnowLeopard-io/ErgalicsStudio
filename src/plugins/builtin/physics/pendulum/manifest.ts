// ==========================================================================
// Double Pendulum manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const pendulumManifest: PluginManifest = {
  id: 'example.pendulum',
  name: 'Double Pendulum',
  nameI18n: { 'zh-CN': '双摆（混沌）', 'en-US': 'Double Pendulum' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Chaotic double pendulum with an initial-condition twin.',
  descriptionI18n: {
    'zh-CN': 'RK4 积分的经典双摆：主摆与初始角仅差 0.001 rad（≈0.057°）的“幽灵摆”并行演化，直观展示混沌对初值的敏感依赖。',
    'en-US': 'Classic double pendulum integrated with RK4: a ghost pendulum offset by 0.001 rad (≈0.057°) diverges exponentially — chaos made visible.',
  },
  license: 'MIT',
  entry: 'example.pendulum',
  category: 'scientific',
  icon: '⚧',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Initial conditions: { th1, th2, w1?, w2? } (degrees, deg/s)',
    },
  ],
};
