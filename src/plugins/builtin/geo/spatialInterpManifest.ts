// ==========================================================================
// Spatial Interpolation — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const spatialInterpManifest: PluginManifest = {
  id: 'example.geo-interp',
  name: 'Spatial Interpolation',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'IDW and ordinary-kriging gridding of scattered station values with contours.',
  nameI18n: {
    'zh-CN': '空间插值',
    'en-US': 'Spatial Interpolation',
  },
  descriptionI18n: {
    'zh-CN': '将离散站点观测值网格化：反距离加权（IDW，幂次可调）与普通克里金（经验变差函数自动拟合球状/指数模型 + 克里金方程组求解），输出热力面、等值线与站点标注。',
    'en-US': 'Grid scattered station observations with Inverse Distance Weighting (adjustable power) or Ordinary Kriging (auto-fitted spherical/exponential variogram + OK system solve); render a heat surface, contours and station dots.',
  },
  license: 'MIT',
  entry: 'example.geo-interp',
  category: 'scientific',
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'CSV: lon, lat, value [, name] (header optional)',
    },
  ],
};
