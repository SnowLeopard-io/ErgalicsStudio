// ==========================================================================
// math-numerics — Numerical Analysis Lab — manifest
//
// Manifest-only module: `builtin/index.ts` imports this file statically while
// the implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mathNumericsManifest: PluginManifest = {
  id: 'example.math-numerics',
  name: 'Numerical Analysis Lab',
  nameI18n: { 'zh-CN': '数值分析实验室', 'en-US': 'Numerical Analysis Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Root finding (bisection, Newton–Raphson, secant) with iteration traces and convergence-order fits, quadrature (trapezoidal, Simpson, Gauss–Legendre) with Richardson error estimates, forward/backward/central finite differences with truncation-error comparison, Lagrange / Newton divided-difference / natural & clamped cubic-spline interpolation, and log-log error-vs-step charts reporting measured against theoretical convergence rates.',
  descriptionI18n: {
    'zh-CN':
      '求根（二分法、Newton–Raphson、割线法）迭代轨迹与收敛阶拟合，数值积分（梯形法、Simpson、Gauss–Legendre）及 Richardson 误差估计，前向/后向/中心差分截断误差对比，Lagrange / Newton 均差 / 自然与夹持三次样条插值，以及 log-log 误差–步长图给出实测收敛阶与理论阶对照。',
    'en-US':
      'Root finding (bisection, Newton–Raphson, secant) with iteration traces and convergence-order fits, quadrature (trapezoidal, Simpson, Gauss–Legendre) with Richardson error estimates, forward/backward/central finite differences with truncation-error comparison, Lagrange / Newton divided-difference / natural & clamped cubic-spline interpolation, and log-log error-vs-step charts reporting measured against theoretical convergence rates.',
  },
  license: 'MIT',
  entry: 'example.math-numerics',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    benchmarks: ['numerics-benchmarks'],
    reproducible: true,
    notes:
      'Validation benchmarks run against closed-form references on the built-in sample functions: bisection order from a log2-error regression (≈ 1), composite Simpson exact for cubics and its quintic error matched against the closed-form −(b−a)h⁴f⁗/180 term, 2-point Gauss–Legendre exact for cubics, Newton residuals on √2, central differences beating forward differences, and spline reproduction of its nodes. Unified error metric |computed − analytic|/|analytic| (absolute error with an explicit note when the analytic value is 0).',
    notesI18n: {
      'zh-CN':
        '验证基准（统一相对误差口径 |计算−解析|/|解析|，解析值为 0 时改用绝对误差并在说明中注明）：在内置样本函数上对照闭式结果——二分法 log₂ 误差回归阶 ≈ 1；复合 Simpson 对三次多项式精确、其五次多项式误差与闭式项 −(b−a)h⁴f⁗/180 对照；2 点 Gauss–Legendre 对三次多项式精确；√2 的 Newton 残差；中心差分相对误差优于前向差分；样条在插值节点处复现数据。',
      'en-US':
        'Benchmarks (unified metric |computed − analytic|/|analytic|; absolute error with an explicit note when the analytic value is 0): bisection order from a log2-error regression ≈ 1; composite Simpson exact for cubics with its quintic error matched against the closed-form −(b−a)h⁴f⁗/180 term; 2-point Gauss–Legendre exact for cubics; Newton residual on √2; central differences outperforming forward differences; spline nodes reproduced by construction.',
    },
  },
};
