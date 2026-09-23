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
    'zh-CN': '解析 ESRI ASCII Grid（.asc）高程数据：高程设色、山体阴影（方位 315°、太阳高度 45°）、Horn 法坡度/坡向、等高线叠加，以及可拖拽旋转的三维建模视图（垂直夸张系数可调）。',
    'en-US': 'Reads ESRI ASCII Grid (.asc) elevation: colour-ramped elevation, hillshade (azimuth 315°, sun 45°), Horn slope/aspect, contour overlay — plus an orbitable 3D mesh view with adjustable vertical exaggeration.',
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
