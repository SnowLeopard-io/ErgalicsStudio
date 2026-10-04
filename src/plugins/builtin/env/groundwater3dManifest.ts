// ==========================================================================
// 3-D groundwater transport — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const groundwater3dManifest: PluginManifest = {
  id: 'example.env-groundwater3d',
  name: '3-D Groundwater Transport',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Voxel advection–dispersion plume in an aquifer with Darcy arrows and a pumping well.',
  nameI18n: {
    'zh-CN': '3D 地下水运移',
    'en-US': '3-D Groundwater Transport',
  },
  descriptionI18n: {
    'zh-CN': '三维含水层污染物运移教学模拟：对流-弥散方程显式步进求解（时间步长受数值稳定约束），体素浓度云呈现污染羽扩展，叠加 Darcy 流方向箭头、污染源与抽水井；时间步进动画播放/暂停，顶部标注污染羽前锋到达抽水井的模拟时刻。示意性模拟，不用于实际场地评估。',
    'en-US': 'A teaching aquifer-transport simulation: the advection–dispersion equation stepped explicitly (time step constrained by numerical stability), with the contaminant plume drawn as a voxel cloud plus Darcy-flow arrows, a source and a pumping well; play/pause time animation and a first-arrival readout. Illustrative only, not for real-site assessment.',
  },
  license: 'MIT',
  entry: 'example.env-groundwater3d',
  category: 'scientific',
};
