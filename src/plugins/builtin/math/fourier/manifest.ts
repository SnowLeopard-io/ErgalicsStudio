// ==========================================================================
// math-fourier — Fourier series approximation laboratory — manifest
//
// Manifest-only module: `builtin/index.ts` imports this file statically while
// the implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mathFourierManifest: PluginManifest = {
  id: 'example.math-fourier',
  name: 'Fourier Series Lab',
  nameI18n: { 'zh-CN': '傅里叶级数逼近实验室', 'en-US': 'Fourier Series Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Numerical Fourier coefficients via jump-split Simpson quadrature, partial sums vs Fejér means, L2 error against the Parseval tail, and Gibbs overshoot measured against the classic constant 2·Si(π)/π ≈ 1.17898.',
  descriptionI18n: {
    'zh-CN':
      '以间断点分段 Simpson 求积数值计算傅里叶系数，对比普通部分和与 Fejér 平均；L2 误差与 Parseval 尾项理论界对拍，Gibbs 过冲比例对照经典常数 2·Si(π)/π ≈ 1.17898（约 8.95% 过冲）。',
    'en-US':
      'Numerical Fourier coefficients via jump-split Simpson quadrature, partial sums vs Fejér means, L2 error against the Parseval tail, and Gibbs overshoot measured against the classic constant 2·Si(π)/π ≈ 1.17898.',
  },
  license: 'MIT',
  entry: 'example.math-fourier',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { phase: 'rad', amplitude: 'dimensionless', error: '%' },
    benchmarks: ['fourier-series-benchmarks'],
    reproducible: true,
    notes:
      'Benchmarks: (1) square-wave b_n = 4/(nπ) (odd n, textbook Fourier series); (2) triangle-wave a_n = 8/(π²n²) analytic; (3) Gibbs overshoot ratio vs 2·Si(π)/π ≈ 1.17898 (Bôcher 1906); (4) Fejér means overshoot-free (positive-kernel argument); (5) Parseval identity residual < 1%. Unified error metric |computed − analytic|/|analytic|.',
    notesI18n: {
      'zh-CN':
        '验证基准（统一相对误差口径 |计算−解析|/|解析|）：① 方波系数 b_n = 4/(nπ)（奇数 n，标准傅里叶级数结果）；② 三角波系数 a_n = 8/(π²n²) 解析对照；③ Gibbs 过冲比例对照 2·Si(π)/π ≈ 1.17898（Bôcher, 1906）；④ Fejér 平均由正核卷积论证一致收敛无过冲；⑤ Parseval 等式残差 < 1%。',
      'en-US':
        'Benchmarks (unified metric |computed − analytic|/|analytic|): (1) square-wave b_n = 4/(nπ) for odd n; (2) triangle-wave a_n = 8/(π²n²) analytic; (3) Gibbs overshoot vs 2·Si(π)/π ≈ 1.17898 (Bôcher 1906); (4) Fejér means overshoot-free (positive kernel); (5) Parseval residual < 1%.',
    },
  },
};
