import type { PluginManifest } from '@/types/plugin';

export const chemReactionManifest: PluginManifest = {
  id: 'example.chem-reaction',
  name: 'Reaction · Mechanism 3D',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Reaction molecular dynamics in 3-D: an embedded NumPy/Langevin engine integrates a real trajectory at the chosen temperature and catalyst, so bonds fracture over their Arrhenius barrier and reform — atoms move from real physics, not a scripted animation.',
  nameI18n: { 'zh-CN': '反应 · 自由反应动力学 3D', 'en-US': 'Reaction · MD 3D' },
  descriptionI18n: {
    'zh-CN':
      '反应分子动力学 3D：内置 NumPy/Langevin 引擎在所选温度与催化剂条件下积分真实轨迹——键越过其 Arrhenius 势垒而断裂、自由基重组而成键，原子运动来自真实物理而非脚本动画。',
    'en-US':
      'Reaction molecular dynamics in 3-D: an embedded NumPy/Langevin engine integrates a real trajectory at the chosen temperature and catalyst — bonds fracture past their Arrhenius barrier and reform, driven by real physics, not a scripted animation.',
  },
  license: 'MIT',
  entry: 'example.chem-reaction',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'Reaction scene ({"reaction": "<id>"})' },
  ],
};