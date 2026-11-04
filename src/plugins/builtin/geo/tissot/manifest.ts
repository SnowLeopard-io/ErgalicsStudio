// ==========================================================================
// Map Projection & Tissot Indicatrices — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const tissotManifest: PluginManifest = {
  id: 'example.geo-tissot',
  name: 'Projection Distortion (Tissot)',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Seven world projections with Tissot indicatrices and Natural Earth coastlines.',
  nameI18n: {
    'zh-CN': '投影变形（Tissot 圆）',
    'en-US': 'Projection Distortion (Tissot)',
  },
  descriptionI18n: {
    'zh-CN': '在等距圆柱、墨卡托、正弦、摩尔威德、高尔-彼得斯、方位等积与正射七种投影下绘制世界海岸线与 Tissot 变形圆：圆的面积比表征面积变形，扁率表征角度（形状）变形。',
    'en-US': 'Draws world coastlines and Tissot indicatrices in seven projections (equirectangular, Mercator, sinusoidal, Mollweide, Gall–Peters, Lambert azimuthal equal-area, orthographic): circle area encodes areal distortion, eccentricity encodes angular distortion.',
  },
  license: 'MIT',
  entry: 'example.geo-tissot',
  category: 'scientific',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/geo+json', 'application/json'],
      description: 'GeoJSON (Polygon/MultiPolygon) coastline replacement',
    },
  ],
};
