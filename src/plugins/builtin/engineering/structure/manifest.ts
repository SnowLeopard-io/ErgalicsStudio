// ==========================================================================
// Structural Mechanics manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const structureManifest: PluginManifest = {
  id: 'example.structure',
  name: 'Structural Mechanics',
  nameI18n: { 'zh-CN': '结构力学', 'en-US': 'Structural Mechanics' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Pin-jointed truss demo: press Run and watch a structure carry its load — or collapse under gravity.',
  descriptionI18n: {
    'zh-CN':
      '桁架承重演示：点击「运行」，观察结构在自重与重物作用下杆件轴力增长、材料超限断裂，直至整体垮塌。',
    'en-US':
      'Press Run and watch a truss carry its load — members heat up with axial force and snap once overloaded, until the frame collapses.',
  },
  license: 'MIT',
  entry: 'example.structure',
  category: 'scientific',
  icon: '⌂',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description:
        'Structure config: { gravity?, damping?, nodes:[{x,y,m?,fixed?}], members:[{a,b,material?,k?}], weights:[{x,y,m?}] } — x/y normalized 0..1',
    },
  ],
};
