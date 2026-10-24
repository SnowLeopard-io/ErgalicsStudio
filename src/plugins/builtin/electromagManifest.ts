// ==========================================================================
// Electromagnetism manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const electromagManifest: PluginManifest = {
  id: 'example.electromag',
  name: 'Electromagnetism',
  nameI18n: { 'zh-CN': '电磁场', 'en-US': 'Electromagnetism' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Draggable charges under Coulomb + Lorentz forces in a uniform B field.',
  descriptionI18n: {
    'zh-CN': '在画布上拖动电荷并自由释放：电荷受库仑力与均匀磁场的洛伦兹力共同作用运动，磁场可单独设置（强度与方向）。',
    'en-US': 'Drag charges and release them — Coulomb + Lorentz forces in a uniform, independently-set B field.',
  },
  license: 'MIT',
  entry: 'example.electromag',
  category: 'scientific',
  icon: '⚡',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Field config: { B, damping?, charges:[{ x, y, q, vx?, vy? }] } with x/y in 0..1',
    },
  ],
};
