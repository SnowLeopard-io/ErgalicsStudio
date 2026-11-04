// ==========================================================================
// Fractal Explorer (Mandelbrot / Julia) manifest — pure data, split from the
// plugin file so builtin/index.ts can import it statically without dragging
// the plugin implementation (and its dependency graph) into the first-screen
// bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mandelbrotManifest: PluginManifest = {
  id: 'fun.mandelbrot',
  name: 'Fractal Explorer',
  nameI18n: { 'zh-CN': '分形浏览器', 'en-US': 'Fractal Explorer' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Mandelbrot & Julia set explorer with color palettes.',
  descriptionI18n: {
    'zh-CN': '曼德博集与茱莉亚集浏览器，支持多种配色方案与缩放。',
    'en-US': 'Explore the Mandelbrot and Julia sets with several color palettes and zoom.',
  },
  license: 'MIT',
  entry: 'fun.mandelbrot',
  category: 'fun',
  icon: '◉',
};
