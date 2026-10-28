// ==========================================================================
// math-domaincolor — complex function domain coloring — manifest
//
// Manifest-only module: `builtin/index.ts` imports this file statically while
// the implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mathDomaincolorManifest: PluginManifest = {
  id: 'example.math-domaincolor',
  name: 'Domain Coloring',
  nameI18n: { 'zh-CN': '复变函数域着色', 'en-US': 'Domain Coloring' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Per-pixel domain coloring of complex functions f(z) with an embedded recursive-descent complex expression parser, log-magnitude contour bands, zoom/pan, and argument-principle winding counts (zeros − poles) inside the view.',
  descriptionI18n: {
    'zh-CN':
      '复变函数 f(z) 的逐像素域着色：内置递归下降复数表达式解析器，色相编码辐角、对数模长等值线带，支持缩放/平移，并按辐角原理统计当前视野内回路的绕数（零点数 − 极点数）。',
    'en-US':
      'Per-pixel domain coloring of complex functions f(z) with an embedded recursive-descent complex expression parser, log-magnitude contour bands, zoom/pan, and argument-principle winding counts (zeros − poles) inside the view.',
  },
  license: 'MIT',
  entry: 'example.math-domaincolor',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { winding: 'turns', viewSpan: 'units' },
    benchmarks: ['domaincolor-benchmarks'],
    reproducible: true,
    notes:
      'Benchmarks: (1) argument principle (Cauchy) — winding of z³−1 on a circle enclosing its three unit zeros equals 3 (error 0); (2) exp(z)/z has no zeros and one simple pole → winding −1 (error 0); (3) parser correctness f(i) vs closed forms with |err| < 1e-12. Unified error metric |computed − analytic|/|analytic|.',
    notesI18n: {
      'zh-CN':
        '验证基准（统一相对误差口径 |计算−解析|/|解析|）：① 辐角原理（Cauchy）——z³−1 沿包围其三个模 1 零点的回路绕数 = 3（误差 0）；② exp(z)/z 无零点、一个单极点（z=0），绕数 = −1（误差 0）；③ 解析器在 z=i 处与闭式解对照，误差 < 1e-12。',
      'en-US':
        'Benchmarks (unified metric |computed − analytic|/|analytic|): (1) argument principle (Cauchy) — winding of z³−1 on a loop enclosing its three unit-modulus zeros equals 3 (error 0); (2) exp(z)/z has no zeros and one simple pole → winding −1 (error 0); (3) parser checks f(i) against closed forms, |err| < 1e-12.',
    },
  },
};
