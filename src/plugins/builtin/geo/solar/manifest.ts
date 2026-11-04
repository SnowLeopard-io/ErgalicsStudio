// ==========================================================================
// Solar Elevation & Day Length — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const solarManifest: PluginManifest = {
  id: 'example.geo-solar',
  name: 'Solar Elevation & Day Length',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Noon solar elevation, declination and day length across the year for any latitude.',
  nameI18n: {
    'zh-CN': '太阳高度与昼夜长短',
    'en-US': 'Solar Elevation & Day Length',
  },
  descriptionI18n: {
    'zh-CN': '给定纬度与日期，计算太阳赤纬、正午太阳高度、昼长与日出日落地方时；绘制全年昼长与正午太阳高度曲线，直观演示极昼极夜与季节变化。',
    'en-US': 'Given a latitude and date, compute solar declination, noon elevation, day length and sunrise/sunset local times; plot annual day-length and noon-elevation curves to show polar day/night and seasonality.',
  },
  license: 'MIT',
  entry: 'example.geo-solar',
  category: 'scientific',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Location preset { name, lat }',
    },
  ],
};
