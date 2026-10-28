// ==========================================================================
// 3-D global environment — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const earth3dManifest: PluginManifest = {
  id: 'example.env-earth3d',
  name: '3-D Global Environment',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Globe with teaching-approximate CO₂ / albedo / ocean-current layers and a season slider.',
  nameI18n: {
    'zh-CN': '3D 全球环境',
    'en-US': '3-D Global Environment',
  },
  descriptionI18n: {
    'zh-CN': '三维地球环境要素示意：全球 CO₂ 浓度分布色带（含季节呼吸循环）、地表反照率图层与主要洋流方向箭头，图层切换与月份滑块浏览季节变化；相机姿态在切换图层时保持。数据为内置教学近似分布，非观测数据产品。',
    'en-US': 'Global environmental layers on a 3-D globe: a teaching-approximate CO₂ distribution (with the seasonal biosphere cycle), surface albedo and major surface-current arrows, switchable layers browsed by a month slider. Camera pose is preserved across layer switches. Built-in approximations — not an observational data product.',
  },
  license: 'MIT',
  entry: 'example.env-earth3d',
  category: 'scientific',
};
