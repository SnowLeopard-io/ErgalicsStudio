// ==========================================================================
// Truchet Tiles manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const truchetManifest: PluginManifest = {
  id: 'fun.truchet',
  name: 'Truchet Tiles',
  nameI18n: { 'zh-CN': '特鲁谢瓷砖', 'en-US': 'Truchet Tiles' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Random quarter-circle arcs tiled into flowing patterns.',
  descriptionI18n: {
    'zh-CN': '用随机朝向的圆弧瓷砖拼出流动图案，支持密度与配色调节。',
    'en-US': 'Randomly oriented quarter-circle tiles forming flowing patterns.',
  },
  license: 'MIT',
  entry: 'fun.truchet',
  category: 'fun',
  icon: '⌗',
};
