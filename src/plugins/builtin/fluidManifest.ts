// ==========================================================================
// LBM Fluid manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const fluidManifest: PluginManifest = {
  id: 'example.fluid',
  name: 'LBM Fluid',
  nameI18n: { 'zh-CN': '流体模拟（LBM）', 'en-US': 'LBM Fluid' },
  version: '1.0.0',
  author: 'Ergalics',
  description: '2-D lattice-Boltzmann channel flow with GPU compute.',
  descriptionI18n: {
    'zh-CN': '二维格子 Boltzmann 通道流（D2Q9），绕流涡街演示，GPU 双内核逐步计算 + CPU 降级。',
    'en-US': '2-D lattice-Boltzmann channel flow (D2Q9) around an obstacle; GPU collide+stream kernels with CPU fallback.',
  },
  license: 'MIT',
  entry: 'example.fluid',
  category: 'scientific',
  icon: '≋',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'Obstacle mask grid (1 = solid)' },
  ],
};
