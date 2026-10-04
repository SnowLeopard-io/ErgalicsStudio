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
  research: {
    tier: 'quasi-research',
    units: { temperature: '°C', do: 'mg/L', depth: 'm', energy: 'solver units' },
    reproducible: false,
    notes: 'WCSPH diagnostics (particle count, mean KE, energy drift vs post-seed baseline) are published live. Particle seeding carries unseeded jitter (shared SPH module), so trajectories differ run-to-run — read statistics ensemble-level. The DO profile is an empirical saturation formula with a linear consumption term (0–40 °C freshwater), a teaching approximation.',
    notesI18n: {
      'zh-CN': '实时发布 WCSPH 诊断量（粒子数、平均动能、相对播种基线的能量漂移）。粒子播种含未种子化抖动（共享 SPH 模块），轨迹逐次不同——统计量请按系综解读。DO 剖面为经验饱和公式 + 线性消耗项（0–40 °C 淡水），属教学近似。',
      'en-US': 'WCSPH diagnostics (particle count, mean KE, energy drift vs post-seed baseline) are published live. Particle seeding carries unseeded jitter (shared SPH module), so trajectories differ run-to-run — read statistics ensemble-level. The DO profile is an empirical saturation formula with a linear consumption term (0–40 °C freshwater), a teaching approximation.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'depth,temp,do measured profile' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'depth,temp,do measured profile' },
  ],
};
