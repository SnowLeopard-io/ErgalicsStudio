// ==========================================================================
// Central Limit Theorem demonstration bench — manifest
//
// Samples means from selectable population distributions (uniform,
// exponential, Bernoulli, bimodal mixture, truncated heavy-tail Pareto) and
// shows how the sampling distribution of the mean converges to
// N(mu, sigma^2 / n). Verification benchmarks compare the empirical mean /
// variance / skewness / kurtosis of the sample-mean distribution against the
// closed-form population values.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const statsCltManifest: PluginManifest = {
  id: 'example.stats-clt',
  name: 'Central Limit Theorem',
  nameI18n: { 'zh-CN': '中心极限定理演示台', 'en-US': 'Central Limit Theorem Bench' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Central Limit Theorem bench: draws m sample means of size n from uniform / exponential / Bernoulli / bimodal / truncated-Pareto populations, overlays N(mu, sigma^2/n) using the analytic population moments, and reports skewness / kurtosis / Jarque-Bera normality diagnostics with embedded verification benchmarks.',
  descriptionI18n: {
    'zh-CN':
      '中心极限定理演示台：从均匀 / 指数 / 伯努利 / 双峰混合 / 截断重尾 Pareto 母体抽取 n 个样本求均值，重复 m 次得到均值分布，叠加基于母体理论矩的 N(μ, σ²/n) 正态曲线，并给出偏度 / 峰度 / Jarque-Bera 正态性度量与内嵌验证基准。',
    'en-US':
      'Central Limit Theorem bench: draws m sample means of size n from uniform / exponential / Bernoulli / bimodal / truncated-Pareto populations, overlays N(mu, sigma^2/n) using the analytic population moments, and reports skewness / kurtosis / Jarque-Bera normality diagnostics with embedded verification benchmarks.',
  },
  license: 'MIT',
  entry: 'example.stats-clt',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    benchmarks: ['clt-uniform-moments', 'clt-normality', 'clt-exponential-skew'],
    reproducible: true,
    notes:
      'Seeded Monte-Carlo with analytic ground truth: (1) uniform population, n=30, m=50000 — sample-mean distribution mean/variance vs (a+b)/2 and sigma^2/(12n), relative error < 2%; (2) standardized mean distribution skewness < 0.1 and |kurtosis - 3| < 0.2; (3) exponential population, n=1 — skewness of the mean distribution vs the exact value 2, tolerance 10% (finite m). Uniform relative-error convention |computed - analytic| / |analytic|.',
    notesI18n: {
      'zh-CN':
        '固定种子蒙特卡洛 + 解析真值对拍：① 均匀母体 U[0,2]、n=30、m=50000，样本均值分布的均值/方差对 (a+b)/2 与 σ²/(12n) 的相对误差 < 2%；② 标准化均值分布偏度 < 0.1 且峰度偏离 3 < 0.2；③ 指数母体 n=1 时均值分布偏度对照理论值 2，容差 10%（m 有限所致）。统一相对误差口径 |计算−解析|/|解析|。',
      'en-US':
        'Seeded Monte-Carlo with analytic ground truth: (1) uniform population U[0,2], n=30, m=50000 — mean/variance of the sample-mean distribution vs (a+b)/2 and sigma^2/(12n), relative error < 2%; (2) standardized mean-distribution skewness < 0.1 and |kurtosis - 3| < 0.2; (3) exponential population at n=1 — skewness vs the exact value 2 with 10% tolerance (finite m). Uniform relative-error convention |computed - analytic| / |analytic|.',
    },
  },
};
