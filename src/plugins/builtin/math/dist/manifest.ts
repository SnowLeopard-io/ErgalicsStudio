// ==========================================================================
// math-dist — Probability Distribution Lab — manifest
//
// Manifest-only module: `builtin/index.ts` imports this file statically while
// the implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mathDistManifest: PluginManifest = {
  id: 'example.math-dist',
  name: 'Probability Distribution Lab',
  nameI18n: { 'zh-CN': '概率分布实验室', 'en-US': 'Probability Distribution Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Interactive PDF/PMF and CDF panels for ten standard families (Normal, Poisson, Exponential, Beta, Gamma, Student-t, Chi-squared, F, Binomial, Geometric) with parameter sliders, seeded Monte-Carlo sampling overlaid as density histograms, and closed-form MLE fitting of built-in sample datasets.',
  descriptionI18n: {
    'zh-CN':
      '十个标准分布族（正态、泊松、指数、Beta、Gamma、Student-t、卡方、F、二项、几何）的 PDF/PMF 与 CDF 双面板交互实验台：参数滑块实时更新，固定种子蒙特卡洛采样叠加密度直方图，并对内置样本数据集做闭式 MLE 拟合。',
    'en-US':
      'Interactive PDF/PMF and CDF panels for ten standard families (Normal, Poisson, Exponential, Beta, Gamma, Student-t, Chi-squared, F, Binomial, Geometric) with parameter sliders, seeded Monte-Carlo sampling overlaid as density histograms, and closed-form MLE fitting of built-in sample datasets.',
  },
  license: 'MIT',
  entry: 'example.math-dist',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    benchmarks: ['dist-benchmarks'],
    reproducible: true,
    notes:
      'Benchmarks: (1) adaptive-Simpson ∫pdf dx = 1 for seven continuous families (rel. err < 1e-6); (2) Φ⁻¹(0.975) vs 1.959963984540054 (< 1e-9); (3) every CDF monotone inside [0, 1] on 160-point bulk grids (< 1e-12 violation); (4) Σpmf = 1 for Poisson / Binomial / Geometric (< 1e-10); (5) seeded sample means converge to the theoretical means at n = 6000 (< 5 %); (6) χ²₁,0.₉₅ = 3.841459 and t₁₂,0.₉₇₅ = 2.178813 critical CDFs (< 1e-9). Unified error metric |computed − analytic|/|analytic|. Sampling is deterministic for a fixed seed.',
    notesI18n: {
      'zh-CN':
        '验证基准（统一相对误差口径 |计算−解析|/|解析|）：① 七个连续分布的 ∫pdf dx = 1（自适应 Simpson，相对误差 < 1e-6）；② Φ⁻¹(0.975) 对照 1.959963984540054（< 1e-9）；③ 全部 10 个 CDF 在 160 点主体网格上单调且值域 [0,1]（违反量 < 1e-12）；④ 泊松/二项/几何 Σpmf = 1（< 1e-10）；⑤ 固定种子采样均值在 n = 6000 时收敛到理论均值（< 5%）；⑥ χ²₁,0.₉₅ = 3.841459 与 t₁₂,0.₉₇₅ = 2.178813 临界值 CDF（< 1e-9）。采样对固定种子完全可复现。',
      'en-US':
        'Benchmarks (unified metric |computed − analytic|/|analytic|): (1) ∫pdf dx = 1 for seven continuous families, adaptive Simpson (rel. err < 1e-6); (2) Φ⁻¹(0.975) vs 1.959963984540054 (< 1e-9); (3) all 10 CDFs monotone inside [0, 1] on 160-point bulk grids (< 1e-12 violation); (4) Σpmf = 1 for Poisson / Binomial / Geometric (< 1e-10); (5) seeded sample means converge to theory at n = 6000 (< 5 %); (6) χ²₁,0.₉₅ = 3.841459 and t₁₂,0.₉₇₅ = 2.178813 critical CDFs (< 1e-9). Sampling is deterministic for a fixed seed.',
    },
  },
};
