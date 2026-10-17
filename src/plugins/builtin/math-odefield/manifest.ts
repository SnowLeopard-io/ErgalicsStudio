// ==========================================================================
// math-odefield — 2D autonomous ODE vector field & streamlines — manifest
//
// Manifest-only module: `builtin/index.ts` imports this file statically while
// the implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mathOdefieldManifest: PluginManifest = {
  id: 'example.math-odefield',
  name: 'ODE Vector Field',
  nameI18n: { 'zh-CN': 'ODE 向量场与流线', 'en-US': 'ODE Vector Field & Streamlines' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Phase plane of 2D autonomous systems x\u2032 = f(x,y), y\u2032 = g(x,y): embedded recursive-descent real expression parser, RK4 bidirectional streamline integration colored by speed, Newton localization of equilibria and Jacobian eigenvalue classification (saddle / node / spiral / center).',
  descriptionI18n: {
    'zh-CN':
      '二维自治系统 x\u2032 = f(x,y), y\u2032 = g(x,y) 的相平面实验台：内置递归下降实数表达式解析器，RK4 双向流线积分（按速度着色），牛顿法定位平衡点，并按雅可比特征值分类（鞍点/结点/螺旋/中心）。',
    'en-US':
      'Phase plane of 2D autonomous systems x\u2032 = f(x,y), y\u2032 = g(x,y): embedded recursive-descent real expression parser, RK4 bidirectional streamline integration colored by speed, Newton localization of equilibria and Jacobian eigenvalue classification (saddle / node / spiral / center).',
  },
  license: 'MIT',
  entry: 'example.math-odefield',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { state: 'dimensionless', time: 's' },
    benchmarks: ['odefield-benchmarks'],
    reproducible: true,
    notes:
      'Benchmarks: (1) RK4 orbit of y\u2032 = y matches e^t with relative error < 1e-3; (2) Newton on Lotka\u2013Volterra converges to the closed-form equilibrium (\u03b3/\u03b4, \u03b1/\u03b2) with relative error < 1e-6; (3) closed-form 2\u00d72 eigenvalues vs analytic references with relative error < 1e-9; (4) saddle invariant manifolds: trajectories seeded on eigenvector directions keep |sin \u0394\u03b8| < 1e-6. Unified error metric |computed \u2212 analytic|/|analytic|.',
    notesI18n: {
      'zh-CN':
        '验证基准（统一相对误差口径 |计算−解析|/|解析|）：① y\u2032 = y 的 RK4 轨道与 e^t 对照，相对误差 < 1e-3；② Lotka–Volterra 牛顿法收敛到闭式平衡点 (\u03b3/\u03b4, \u03b1/\u03b2)，相对误差 < 1e-6；③ 2×2 闭式特征值与解析值对照，相对误差 < 1e-9；④ 鞍点不变流形：沿特征向量方向播种的轨道保持 |sin \u0394\u03b8| < 1e-6。',
      'en-US':
        'Benchmarks (unified metric |computed \u2212 analytic|/|analytic|): (1) RK4 orbit of y\u2032 = y matches e^t, rel. err < 1e-3; (2) Newton on Lotka\u2013Volterra reaches (\u03b3/\u03b4, \u03b1/\u03b2), rel. err < 1e-6; (3) closed-form 2\u00d72 eigenvalues vs analytic, rel. err < 1e-9; (4) saddle manifolds seeded on eigenvectors keep |sin \u0394\u03b8| < 1e-6.',
    },
  },
};
