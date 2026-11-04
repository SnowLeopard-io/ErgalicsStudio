// ==========================================================================
// Gaussian plume (2-D) — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const plumeManifest: PluginManifest = {
  id: 'example.env-plume',
  name: 'Pollutant Dispersion',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Gaussian-plume ground-level concentration heatmap under Pasquill stability classes.',
  nameI18n: {
    'zh-CN': '污染物扩散模拟（高斯烟羽）',
    'en-US': 'Pollutant Dispersion',
  },
  descriptionI18n: {
    'zh-CN': '高斯烟羽模型：按 Pasquill–Gifford 扩散参数（Turner 1970 开阔乡村公式）与地面反射项计算连续点源下风向地面浓度场，以热力云图呈现羽流形态；源强、风速、稳定度（A–F）滑块即时重绘，顶部标注最大落地浓度位置。静风（u=0）不适用。',
    'en-US': 'The Gaussian plume model: ground-level concentration from a continuous point source using Pasquill–Gifford dispersion parameters (Turner 1970 open-country) with ground reflection, drawn as a heatmap. Source strength / wind speed / stability (A–F) sliders redraw instantly; the peak ground-level concentration is annotated. Not valid in calm winds (u=0).',
  },
  license: 'MIT',
  entry: 'example.env-plume',
  category: 'scientific',
};
