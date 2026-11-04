// Manifest-only module (B1: keeps `three` out of the startup graph).
// `builtin/index.ts` imports this file statically to advertise the plugin,
// while the implementation in `nbody.ts` (which statically imports three) is
// reached exclusively through the dynamic `load()` below.
import type { PluginManifest } from '@/types/plugin';

export const nbodyManifest: PluginManifest = {
  id: 'example.nbody',
  name: 'N-Body Gravity',
  nameI18n: { 'zh-CN': '引力 N 体模拟', 'en-US': 'N-Body Gravity' },
  version: '1.1.0',
  author: 'Ergalics',
  description: '3-D direct-summation gravity simulation with GPU compute.',
  descriptionI18n: {
    'zh-CN': '三维天体物理 N 体引力直接求和模拟，支持 GPU 全配对计算与 CPU 降级。',
    'en-US': '3-D astrophysics direct-summation gravity with GPU all-pairs compute + CPU fallback.',
  },
  license: 'MIT',
  entry: 'example.nbody',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'N-body initial conditions' },
  ],
};
