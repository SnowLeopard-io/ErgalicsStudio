// ==========================================================================
// Wave Equation manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const waveManifest: PluginManifest = {
  id: 'example.wave',
  name: 'Wave Equation',
  nameI18n: { 'zh-CN': '波动方程', 'en-US': 'Wave Equation' },
  version: '1.0.0',
  author: 'Ergalics',
  description: '2-D wave equation: pulse, interference, double slit.',
  descriptionI18n: {
    'zh-CN': '二维波动方程有限差分模拟：高斯脉冲、双源干涉、双缝衍射三种场景，GPU 逐步计算 + CPU 降级。',
    'en-US': '2-D finite-difference wave equation: gaussian pulse, two-source interference, and double-slit diffraction; GPU stepping with CPU fallback.',
  },
  license: 'MIT',
  entry: 'example.wave',
  category: 'scientific',
  icon: '◎',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'Wave scenario: { u?: grid, drive?: grid }' },
  ],
};
