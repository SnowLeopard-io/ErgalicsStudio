// ==========================================================================
// math-linalg — Linear Algebra Lab — manifest
//
// Manifest-only module: `builtin/index.ts` imports this file statically while
// the implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mathLinalgManifest: PluginManifest = {
  id: 'example.math-linalg',
  name: 'Linear Algebra Lab',
  nameI18n: { 'zh-CN': '线性代数实验室', 'en-US': 'Linear Algebra Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    '2×2 linear algebra bench: matrix action on the unit grid (rotation / scaling / shear presets plus a custom matrix), eigenvector geometry with stretch factors, the SVD chain A = UΣVᵀ visualized as unit circle → Vᵀ → Σ → U, span and projection of 2D/3D vector sets, and |det| read off as the area scaling factor.',
  descriptionI18n: {
    'zh-CN':
      '2×2 线性代数实验台：矩阵作用于单位网格的可视化（旋转/缩放/剪切预设与自定义矩阵），特征向量几何与拉伸因子，SVD 链 A = UΣVᵀ（单位圆 → Vᵀ → Σ → U 三步映射），2D/3D 向量张成的子空间与正交投影，并以 |det| 对照面积缩放因子。',
    'en-US':
      '2×2 linear algebra bench: matrix action on the unit grid (rotation / scaling / shear presets plus a custom matrix), eigenvector geometry with stretch factors, the SVD chain A = UΣVᵀ visualized as unit circle → Vᵀ → Σ → U, span and projection of 2D/3D vector sets, and |det| read off as the area scaling factor.',
  },
  license: 'MIT',
  entry: 'example.math-linalg',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    benchmarks: ['linalg-benchmarks'],
    reproducible: true,
    notes:
      'Benchmarks: (1) closed-form 2×2 eigenvalues vs analytic spectra with relative error < 1e-9; (2) Hessenberg + shifted-QR eigenvalues vs analytic spectra < 1e-8; (3) eigen residual ‖Av−λv‖/(‖A‖·‖v‖) < 1e-12; (4) Jacobi SVD reconstruction ‖A−UΣVᵀ‖/‖A‖ < 1e-12; (5) SVD orthogonality ‖UᵀU−I‖, ‖VVᵀ−I‖ < 1e-12; (6) LU determinant vs closed form < 1e-12; (7) Householder QR reconstruction ‖A−QR‖/‖A‖ < 1e-12; (8) span projections vs analytic projections < 1e-12. Unified error metric |computed − analytic|/|analytic|.',
    notesI18n: {
      'zh-CN':
        '验证基准（统一相对误差口径 |计算−解析|/|解析|）：① 2×2 闭式特征值对照解析谱，相对误差 < 1e-9；② Hessenberg + 移位 QR 迭代特征值对照解析谱 < 1e-8；③ 特征方程残差 ‖Av−λv‖/(‖A‖·‖v‖) < 1e-12；④ Jacobi SVD 重构 ‖A−UΣVᵀ‖/‖A‖ < 1e-12；⑤ SVD 正交性 ‖UᵀU−I‖、‖VVᵀ−I‖ < 1e-12；⑥ LU 行列式对照闭式 ad−bc < 1e-12；⑦ Householder QR 重构 ‖A−QR‖/‖A‖ < 1e-12；⑧ 子空间投影对照解析投影 < 1e-12。',
      'en-US':
        'Benchmarks (unified metric |computed − analytic|/|analytic|): (1) closed-form 2×2 eigenvalues vs analytic spectra, rel. err < 1e-9; (2) Hessenberg + shifted-QR eigenvalues vs analytic spectra < 1e-8; (3) eigen residual ‖Av−λv‖/(‖A‖·‖v‖) < 1e-12; (4) Jacobi SVD reconstruction ‖A−UΣVᵀ‖/‖A‖ < 1e-12; (5) SVD orthogonality ‖UᵀU−I‖, ‖VVᵀ−I‖ < 1e-12; (6) LU determinant vs closed form < 1e-12; (7) Householder QR reconstruction ‖A−QR‖/‖A‖ < 1e-12; (8) span projections vs analytic projections < 1e-12.',
    },
  },
};
