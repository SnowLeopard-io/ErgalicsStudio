// ==========================================================================
// Optics Lab manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const opticsManifest: PluginManifest = {
  id: 'example.optics',
  name: 'Optics Lab',
  nameI18n: { 'zh-CN': '光学实验', 'en-US': 'Optics Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Ray tracing: convex/concave lenses, prism dispersion, light screen.',
  descriptionI18n: {
    'zh-CN': '几何光学光线追踪：凸透镜/凹透镜（薄透镜）、三棱镜（斯涅尔折射 + 色散）、光屏成像。所有元件可在画布上拖动。',
    'en-US': 'Geometric ray tracer: thin convex/concave lenses, triangular prism (Snell + dispersion), and a screen.',
  },
  license: 'MIT',
  entry: 'example.optics',
  category: 'scientific',
  icon: '🔆',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Optics layout: { source, lens?, prism?, screen, focal } with x/y in 0..1',
    },
  ],
};
