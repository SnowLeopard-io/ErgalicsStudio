// ==========================================================================
// GPX Track Analysis — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const gpxTrackManifest: PluginManifest = {
  id: 'example.geo-gpx',
  name: 'GPX Track Analysis',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Parse GPX tracks: distance, ascent/descent, duration and an elevation profile.',
  nameI18n: {
    'zh-CN': 'GPX 轨迹分析',
    'en-US': 'GPX Track Analysis',
  },
  descriptionI18n: {
    'zh-CN': '解析 GPX <trkpt> 轨迹点（含海拔/时间），统计总里程、累计爬升/下降（2 m 迟滞滤波）、用时与最高最低点；左图按海拔着色显示轨迹，右图绘制海拔-距离剖面。',
    'en-US': 'Parses GPX <trkpt> points (with ele/time) and reports total distance, accumulated ascent/descent (2 m hysteresis filter), duration and elevation extremes; draws the track colour-coded by elevation on the left and an elevation-distance profile on the right.',
  },
  license: 'MIT',
  entry: 'example.geo-gpx',
  category: 'scientific',
  formats: [
    {
      extension: '.gpx',
      mimeTypes: ['application/gpx+xml', 'application/xml', 'text/xml'],
      description: 'GPX 1.0/1.1 track or route points (<trkpt>/<rtept>)',
    },
  ],
};
