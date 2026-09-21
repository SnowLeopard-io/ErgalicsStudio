// Manifest-only module (keeps the heavy worker + render graph out of the
// startup graph). `builtin/index.ts` imports this file statically; the
// implementation in `plugin.ts` (which reaches the Pyodide worker client) is
// loaded dynamically.
import type { PluginManifest } from '@/types/plugin';

export const emCfdCouplerManifest: PluginManifest = {
  id: 'example.em-cfd-coupler',
  name: 'EM-CFD Coupler',
  nameI18n: {
    'zh-CN': '1D-3D 双向耦合求解器',
    'en-US': '1D-3D Coupled Solver',
  },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Multi-rate time coordination + bidirectional boundary coupling between a coarse-time 1-D pipe/nozzle network and a fine-time 3-D field solver, with millisecond-scale control logic, conservation auditing and precision-vs-efficiency trade-offs.',
  descriptionI18n: {
    'zh-CN':
      '1D 管网-3D 场双向耦合：多速率时间步协调、粗-细时间子循环、正反向边界耦合、毫秒级阀门控制、守恒性审计与精度-效率权衡曲线。',
    'en-US':
      'Join a coarse-time 1-D pipe network with a fine-time 3-D field solver: multi-rate sub-cycling, bidirectional boundary coupling, millisecond valve control, conservation auditing and precision-vs-efficiency trade-offs.',
  },
  license: 'MIT',
  entry: 'example.em-cfd-coupler',
  category: 'scientific',
  sandbox: 'trusted',
};