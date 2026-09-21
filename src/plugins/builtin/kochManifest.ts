// ==========================================================================
// Koch Snowflake manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const kochManifest: PluginManifest = {
  id: 'fun.koch',
  name: 'Koch Snowflake',
  nameI18n: { 'zh-CN': '科赫雪花', 'en-US': 'Koch Snowflake' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Fractal snowflake built from recursive segments.',
  descriptionI18n: {
    'zh-CN': '用递归折线构造的科赫雪花分形，支持迭代深度调节。',
    'en-US': 'The Koch snowflake fractal, built from recursive segments.',
  },
  license: 'MIT',
  entry: 'fun.koch',
  category: 'fun',
  icon: '❋',
};
