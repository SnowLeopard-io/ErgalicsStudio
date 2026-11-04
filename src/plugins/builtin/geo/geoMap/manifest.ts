// ==========================================================================
// GeoJSON Map manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const geoMapManifest: PluginManifest = {
  id: 'example.geomap',
  name: 'GeoJSON Map',
  nameI18n: { 'zh-CN': 'GeoJSON 地图', 'en-US': 'GeoJSON Map' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Local GeoJSON viewer with choropleth coloring.',
  descriptionI18n: {
    'zh-CN': '离线渲染 GeoJSON 矢量数据：多边形/线/点，支持按数值属性分级设色（choropleth）与墨卡托/等距圆柱投影。',
    'en-US': 'Offline GeoJSON rendering: polygons/lines/points with property-driven choropleth shading, Mercator or equirectangular projection.',
  },
  license: 'MIT',
  entry: 'example.geomap',
  category: 'scientific',
  icon: '⬡',
  formats: [
    { extension: '.geojson', mimeTypes: ['application/geo+json'], description: 'GeoJSON vector data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'GeoJSON vector data' },
  ],
};
