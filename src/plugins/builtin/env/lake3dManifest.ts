// ==========================================================================
// 3-D lake stratification — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const lake3dManifest: PluginManifest = {
  id: 'example.env-lake3d',
  name: '3-D Lake Stratification',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Lake basin with thermal stratification, DO profile and algal-bloom shading.',
  nameI18n: {
    'zh-CN': '3D 湖泊水质分层',
    'en-US': '3-D Lake Stratification',
  },
  descriptionI18n: {
    'zh-CN': '三维湖盆热分层示意：表层温水层 / 温跃层 / 深层冷水层与溶解氧垂向分层（表层富氧、深层缺氧），入流温度 / 混合风速 / 营养盐负荷滑块驱动分层结构与剖面曲线，营养盐负荷驱动表层富营养化（藻华）着色。可选 CSV（depth,temp,do）实测剖面覆盖默认分层。教学示意，不用于真实水体预测。',
    'en-US': 'A 3-D lake-basin teaching model: epilimnion / thermocline / hypolimnion with a vertical DO profile (oxygen-rich surface, anoxic deep water). Inflow temperature / wind mixing / nutrient-load sliders drive the stratification and profile curves; nutrient load shades a surface algal bloom. Optional CSV (depth,temp,do) measured profile. Teaching visualisation, not a real-water forecast.',
  },
  license: 'MIT',
  entry: 'example.env-lake3d',
  category: 'scientific',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'depth,temp,do measured profile' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'depth,temp,do measured profile' },
  ],
};
