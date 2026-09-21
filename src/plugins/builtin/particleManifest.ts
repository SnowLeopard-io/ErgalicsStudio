// ==========================================================================
// Particles manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const particleManifest: PluginManifest = {
  id: 'example.particles',
  name: 'Particles',
  nameI18n: { 'zh-CN': '粒子模拟', 'en-US': 'Particles' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Interactive particle simulation with compute progress.',
  descriptionI18n: {
    'zh-CN': '交互式粒子模拟，演示计算进度与性能上报。',
    'en-US': 'Interactive particle simulation demo.',
  },
  license: 'MIT',
  entry: 'example.particles',
  formats: [
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Particle data' },
  ],
};
