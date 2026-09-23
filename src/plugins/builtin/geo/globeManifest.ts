// ==========================================================================
// Interactive Globe (3D) — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const globeManifest: PluginManifest = {
  id: 'example.geo-globe',
  name: 'Interactive Globe (3D)',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'A drag-to-spin 3D globe: coastlines, graticule, spherical Tissot circles and auto-rotation.',
  nameI18n: {
    'zh-CN': '交互地球仪（3D）',
    'en-US': 'Interactive Globe (3D)',
  },
  descriptionI18n: {
    'zh-CN':
      '可拖拽旋转、滚轮缩放的真三维地球仪：Natural Earth 110m 海岸线与经纬网贴在球面上，叠加球面 Tissot 变形圆，支持自动自转。每张平面地图的变形，都能在球面上找到它未经扭曲的原型。',
    'en-US':
      'A true 3D globe — drag to spin, scroll to zoom. Natural Earth 110m coastlines and a graticule are draped on the sphere with spherical Tissot indicatrices and optional auto-rotation: the undistorted source geometry behind every flat map.',
  },
  license: 'MIT',
  entry: 'example.geo-globe',
  category: 'scientific',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/geo+json', 'application/json'],
      description: 'GeoJSON Polygon/MultiPolygon coastlines to drape on the sphere',
    },
  ],
};
