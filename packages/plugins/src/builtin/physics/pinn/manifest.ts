// ==========================================================================
// physics-pinn — Physics-Informed Neural Network lab — manifest
//
// Manifest-only module: `builtin/index.ts` imports this statically while the
// implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@ergalics/plugin-sdk';

export const physicsPinnManifest: PluginManifest = {
  id: 'example.physics-pinn',
  name: 'Physics-Informed Neural Network',
  nameI18n: { 'zh-CN': '物理信息神经网络 (PINN)', 'en-US': 'Physics-Informed Neural Network' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Trains a tanh MLP whose loss is the PDE residual itself (heat equation and viscous Burgers), with IC/BC soft constraints, inverse discovery of the diffusivity, and a live comparison against the analytic / finite-difference reference solution.',
  descriptionI18n: {
    'zh-CN':
      '训练一个 tanh 多层感知机，把 PDE 残差直接写进损失函数（热方程与粘性 Burgers 方程），带初值/边值软约束、扩散系数的反演识别，并与解析解 / 有限差分数值解实时对比。',
    'en-US':
      'Trains a tanh MLP whose loss is the PDE residual itself (heat equation and viscous Burgers), with IC/BC soft constraints, inverse discovery of the diffusivity, and a live comparison against the analytic / finite-difference reference solution.',
  },
  license: 'MIT',
  entry: 'example.physics-pinn',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { x: '1', t: '1', u: '1' },
    benchmarks: ['heat-analytic'],
    reproducible: true,
    notes:
      'Spatial/temporal derivatives in the residual use fourth-order central differences (FD-PINN) so the reverse-mode gradient is exact for the discretised residual; the truncation error therefore sets a floor on the attainable L2 error. Heat-equation reference is the closed-form exp(-alpha*pi^2*t)*sin(pi*x); Burgers reference is an explicit finite-difference solve on a 101-point grid. In inverse mode the diffusivity is identifiable only because 16 interior sensor readings are added — residual + IC/BC alone admit a valid solution for every alpha. All randomness is seeded.',
    notesI18n: {
      'zh-CN':
        '残差中的时空导数采用四阶中心差分（FD-PINN），因此反向传播梯度对“离散化后的残差”是精确的；截断误差决定可达 L2 误差的下限。热方程参考解为闭式 exp(-απ²t)·sin(πx)，Burgers 参考解为 101 点网格上的显式有限差分解。反演模式下扩散系数可辨识的前提是加入了 16 个内部传感器观测——仅凭残差与初边值条件，任意 α 都存在一个合法解。全部随机性均带种子、结果可复现。',
      'en-US':
        'Spatial/temporal derivatives in the residual use fourth-order central differences (FD-PINN) so the reverse-mode gradient is exact for the discretised residual; truncation error therefore floors the attainable L2 error. The heat reference is the closed form exp(-alpha*pi^2*t)*sin(pi*x); the Burgers reference is an explicit finite-difference solve on a 101-point grid. In inverse mode the diffusivity is identifiable only because 16 interior sensor readings are added — residual + IC/BC alone admit a valid solution for every alpha. All randomness is seeded.',
    },
  },
};
