// ==========================================================================
// Conway's Game of Life manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const lifeManifest: PluginManifest = {
  id: 'fun.life',
  name: "Conway's Game of Life",
  nameI18n: { 'zh-CN': '生命游戏', 'en-US': "Conway's Game of Life" },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Cellular automaton playground with play / pause / reseed.',
  descriptionI18n: {
    'zh-CN': '经典细胞自动机，支持播放/暂停/重新播种。',
    'en-US': 'Classic cellular automaton with play / pause / reseed.',
  },
  license: 'MIT',
  entry: 'fun.life',
  category: 'fun',
  icon: '▩',
};
