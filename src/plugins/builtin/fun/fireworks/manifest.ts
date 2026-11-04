// ==========================================================================
// Fireworks manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const fireworksManifest: PluginManifest = {
  id: 'fun.fireworks',
  name: 'Fireworks',
  nameI18n: { 'zh-CN': '烟花', 'en-US': 'Fireworks' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Particle fireworks with gravity and trails.',
  descriptionI18n: {
    'zh-CN': '带重力与拖尾的粒子烟花，支持自动连发与手动引爆。',
    'en-US': 'Particle fireworks with gravity and trails; auto-launch or manual bursts.',
  },
  license: 'MIT',
  entry: 'fun.fireworks',
  category: 'fun',
  icon: '✹',
};
