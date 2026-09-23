// ==========================================================================
// Climatograph — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const climographManifest: PluginManifest = {
  id: 'example.geo-climograph',
  name: 'Climatograph',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Temperature-line / precipitation-bar climate diagram with a Köppen-style summary.',
  nameI18n: {
    'zh-CN': '气候直方图',
    'en-US': 'Climatograph',
  },
  descriptionI18n: {
    'zh-CN': '以「气温折线 + 降水柱状」双轴绘制月度气候图，自动汇总年均温、年降水、气温年较差与降水季节分配，给出简明气候类型判读（以最冷月/最热月气温与雨季位置为据）。',
    'en-US': 'Draws a monthly climate diagram (temperature line + precipitation bars, twin axes) and summarises mean annual temperature/rainfall, annual range and rainfall seasonality with a compact Köppen-style reading.',
  },
  license: 'MIT',
  entry: 'example.geo-climograph',
  category: 'scientific',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'month,temp,precip monthly normals' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'month,temp,precip monthly normals' },
  ],
};
