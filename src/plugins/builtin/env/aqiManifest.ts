// ==========================================================================
// Air quality (AQI) — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const aqiManifest: PluginManifest = {
  id: 'example.env-aqi',
  name: 'Air Quality (AQI)',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Computes AQI and primary pollutant from air monitoring data per HJ 633-2012 / GB 3095-2012.',
  nameI18n: {
    'zh-CN': '空气质量评价（AQI）',
    'en-US': 'Air Quality (AQI)',
  },
  descriptionI18n: {
    'zh-CN': '载入空气监测表（SO₂、NO₂、PM2.5、PM10、CO、O₃），按《环境空气质量指数（AQI）技术规定（试行）》（HJ 633-2012）分段线性插值计算各污染物 IAQI 与当日 AQI，输出级别（优～严重污染）、首要污染物与健康提示；可切换 US EPA 断点作对照。',
    'en-US': 'Load an air-monitoring sheet (SO₂, NO₂, PM2.5, PM10, CO, O₃) to compute per-pollutant IAQI and the daily AQI via HJ 633-2012 piecewise-linear interpolation, with level, primary pollutant and health advice; US EPA breakpoints available as a comparison.',
  },
  license: 'MIT',
  entry: 'example.env-aqi',
  category: 'scientific',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'so2,no2,pm25,pm10,co,o3 rows' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'so2,no2,pm25,pm10,co,o3 rows' },
  ],
};
