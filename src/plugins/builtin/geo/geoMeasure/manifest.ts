// ==========================================================================
// Distance & Area Measurement — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const geoMeasureManifest: PluginManifest = {
  id: 'example.geo-measure',
  name: 'Distance & Area Measure',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Click-to-measure great-circle distances and spherical polygon areas on a canvas.',
  nameI18n: {
    'zh-CN': '距离与面积量算',
    'en-US': 'Distance & Area Measure',
  },
  descriptionI18n: {
    'zh-CN': '在画布上点击加点：测距模式逐段给出大圆距离与累计里程；测面模式用球面多边形公式计算围合面积与周长。支持撤销、清空、视图复位与 JSON/CSV 点位导入。',
    'en-US': 'Click to add points: distance mode reports per-segment great-circle lengths and a running total; area mode computes the enclosed spherical polygon area and perimeter. Undo, clear, re-fit view and JSON/CSV point import included.',
  },
  license: 'MIT',
  entry: 'example.geo-measure',
  category: 'scientific',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Waypoints { points: [{ name, lat, lon }] } or a plain array',
    },
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'CSV: lon, lat [, name] (header optional)',
    },
  ],
};
