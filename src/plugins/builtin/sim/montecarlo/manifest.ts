import type { PluginManifest } from '@/types/plugin';

export const simMontecarloManifest: PluginManifest = {
  id: 'example.sim-montecarlo',
  name: 'Monte Carlo Simulation',
  nameI18n: { 'zh-CN': '蒙特卡洛仿真平台', 'en-US': 'Monte Carlo Simulation' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'General-purpose Monte Carlo platform: distribution library (uniform, normal, triangular, PERT, beta, empirical), correlation via Gaussian copula, simple/Latin-hypercube/Sobol samplers, convergence diagnostics and tornado sensitivity.',
  descriptionI18n: {
    'zh-CN':
      '通用蒙特卡洛仿真平台：内置均匀、正态、三角、PERT、Beta 与经验分布，支持高斯 copula 相关结构、简单随机/拉丁超立方/Sobol 三种抽样、收敛诊断（滑动均值与 Gelman-Rubin R-hat）与龙卷风敏感性分析。',
    'en-US':
      'General-purpose Monte Carlo platform: uniform, normal, triangular, PERT, beta and empirical distributions; Gaussian-copula correlation; simple random, Latin hypercube and Sobol sampling; convergence diagnostics (running mean, Gelman-Rubin) and tornado sensitivity.',
  },
  license: 'MIT',
  entry: 'example.sim-montecarlo',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { samples: 'count' },
    reproducible: true,
    notes:
      'All sampling is driven by a seeded mulberry32 PRNG; runs are bit-reproducible for a fixed seed. The Sobol implementation uses the Bratley-Fox Gray-code construction with simple odd initial direction numbers (the (t,m,s)-net property is preserved for any odd m_i < 2^i). The Gaussian copula maps target correlations through a Cholesky factorization with diagonal-jitter fallback. Sensitivity uses Spearman rank correlation and a one-at-a-time P10/P90 tornado sweep about the input medians.',
    notesI18n: {
      'zh-CN':
        '全部抽样由带种子的 mulberry32 随机数发生器驱动，固定种子下结果逐位可复现。Sobol 采用 Bratley-Fox 灰码构造与简单奇数初始方向数（任意奇数 m_i < 2^i 均保持 (t,m,s)-net 性质）。高斯 copula 经 Cholesky 分解映射目标相关结构（对角抖动兜底）。敏感性分析采用 Spearman 秩相关与单变量 P10/P90 龙卷风扫描（其余变量取中位数）。',
      'en-US':
        'All sampling is driven by a seeded mulberry32 PRNG; runs are bit-reproducible for a fixed seed. The Sobol implementation uses the Bratley-Fox Gray-code construction with simple odd initial direction numbers (the (t,m,s)-net property is preserved for any odd m_i < 2^i). The Gaussian copula maps target correlations through a Cholesky factorization with diagonal-jitter fallback. Sensitivity uses Spearman rank correlation and a one-at-a-time P10/P90 tornado sweep about the input medians.',
    },
  },
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'simulation config JSON' },
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'input variable table (name,dist,p1,p2,p3)' },
  ],
};
