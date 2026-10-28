// ==========================================================================
// econ-blackscholes — Black-Scholes-Merton option pricing, manifest
//
// Analytic BSM prices + Greeks cross-checked against a seeded Monte Carlo
// GBM engine; put-call parity certification and a high-accuracy standard
// normal CDF (Abramowitz & Stegun 26.2.17).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const blackscholesManifest: PluginManifest = {
  id: 'example.econ-blackscholes',
  name: 'Black-Scholes Option Lab',
  nameI18n: { 'zh-CN': 'Black-Scholes 期权定价实验室', 'en-US': 'Black-Scholes Option Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Black-Scholes-Merton analytic prices and Greeks (Delta/Gamma/Vega/Theta) validated against a seeded Monte Carlo geometric-Brownian-motion engine, with put-call parity certification and MC convergence bands.',
  descriptionI18n: {
    'zh-CN':
      'Black-Scholes-Merton 解析定价与希腊字母（Delta/Gamma/Vega/Theta），并用固定种子蒙特卡洛几何布朗运动交叉验证：看涨-看跌平价残差认证、MC 收敛带（累计均值 ± 1.96·SE）与内嵌四项数值基准。',
    'en-US':
      'Black-Scholes-Merton analytic prices and Greeks validated against a seeded Monte Carlo GBM engine: put-call parity residual, MC convergence bands (cumulative mean ± 1.96·SE) and four embedded numerical benchmarks.',
  },
  license: 'MIT',
  entry: 'example.econ-blackscholes',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    units: { price: 'currency', rate: '1/year', vol: '1/√year', time: 'year' },
    benchmarks: ['blackscholes-benchmark'],
    reproducible: true,
    notes:
      'Literature algorithm (BSM 1973) with reference-solution cross-check: MC vs analytic within 3·SE, put-call parity residual < 1e-10, N(1.96) accurate to < 1e-7 (A&S 26.2.17), analytic Delta vs central finite difference < 1e-3. Uniform error metric |computed - analytic| / |analytic|.',
    notesI18n: {
      'zh-CN':
        '基准：①蒙特卡洛 vs 解析价差异 < 3·SE（S=100,K=100,r=5%,σ=20%,T=1，10 万路径固定种子）；②看涨-看跌平价 C−P=S·e^{−qT}−K·e^{−rT} 残差 < 1e-10；③N(1.96)=0.9750021 误差 < 1e-7（Abramowitz-Stegun 26.2.17）；④解析 Delta 对照中心有限差分 < 1e-3。统一相对误差口径 |计算−解析|/|解析|。出处：Black & Scholes (1973) JPE 81:637；Merton (1973) BSTJ 52:249；Abramowitz & Stegun (1964) §26.2.17。',
      'en-US':
        'Benchmarks: (1) Monte Carlo vs analytic price within 3·SE (S=100, K=100, r=5%, sigma=20%, T=1; 100k seeded paths); (2) put-call parity C-P = S·e^{-qT} - K·e^{-rT} residual < 1e-10; (3) N(1.96)=0.9750021 accurate to < 1e-7 (Abramowitz-Stegun 26.2.17); (4) analytic Delta vs central finite difference < 1e-3. Uniform relative error metric |computed - analytic| / |analytic|. Sources: Black & Scholes (1973) JPE 81:637; Merton (1973) BSTJ 52:249; Abramowitz & Stegun (1964) §26.2.17.',
    },
  },
};
