// ==========================================================================
// DEM Terrain Analysis — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const terrainManifest: PluginManifest = {
  id: 'example.geo-terrain',
  name: 'DEM Terrain Analysis',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'ESRI ASCII Grid DEM viewer: hillshade, elevation, slope, aspect and contours.',
  nameI18n: {
    'zh-CN': 'DEM 地形分析',
    'en-US': 'DEM Terrain Analysis',
  },
  descriptionI18n: {
    'zh-CN': '解析 ESRI ASCII Grid（.asc）高程数据，提供高程设色、山体阴影（方位 315°、太阳高度 45°）、Horn 法坡度/坡向与等高线叠加四种视图。',
    'en-US': 'Reads ESRI ASCII Grid (.asc) elevation and renders four views — colour-ramped elevation, hillshade (azimuth 315°, sun 45°), Horn slope/aspect and contour overlay.',
  },
  license: 'MIT',
  entry: 'example.geo-terrain',
  category: 'scientific',
  formats: [
    {
      extension: '.asc',
      mimeTypes: ['text/plain'],
      description: 'ESRI ASCII Grid (ncols/nrows/xllcorner/yllcorner/cellsize/NODATA_value)',
    },
  ],
};
