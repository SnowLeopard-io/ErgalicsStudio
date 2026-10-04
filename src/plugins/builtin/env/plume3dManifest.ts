// ==========================================================================
// 3-D pollutant plume — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const plume3dManifest: PluginManifest = {
  id: 'example.env-plume3d',
  name: '3-D Plume Dispersion',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Voxel concentration cloud of a Gaussian plume in 3-D with terrain and cross-sections.',
  nameI18n: {
    'zh-CN': '3D 污染羽流扩散',
    'en-US': '3-D Plume Dispersion',
  },
  descriptionI18n: {
    'zh-CN': '三维高斯烟羽：按稳定度等级计算含有效源高 H 的三维浓度场，以体素浓度云呈现，叠加教学地形下垫面，支持下风向横切面开关与色标图例；OrbitControls 拖拽旋转 / 滚轮缩放，快照导出透明 PNG。可选 CSV（x,y,z,conc）导入外部浓度场。教学示意。',
    'en-US': 'A 3-D Gaussian plume: the concentration field (with effective stack height H) is drawn as a translucent voxel cloud over a teaching terrain, with a downwind cross-section toggle and a colour legend. Orbit-drag / scroll-zoom, transparent PNG snapshot. Optional CSV (x,y,z,conc) import for external fields. Teaching visualisation.',
  },
  license: 'MIT',
  entry: 'example.env-plume3d',
  category: 'scientific',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'x,y,z,conc voxel field' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'x,y,z,conc voxel field' },
  ],
};
