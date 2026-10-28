// ==========================================================================
// Markov chain & stationary analysis — manifest
//
// Row-stochastic transition matrix in, steady-state distribution (power
// iteration to L1 residual < 1e-12), irreducibility / periodicity checks,
// absorbing-chain analysis ((I-Q)^-1 via Gaussian elimination) and chain
// trajectory simulation out. Ships a teaching PageRank web-graph CSV
// (Page & Brin 1998 reference) as sample data.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const statsMarkovManifest: PluginManifest = {
  id: 'example.stats-markov',
  name: 'Markov Chains & Stationary Analysis',
  nameI18n: { 'zh-CN': '马尔可夫链与稳态分析', 'en-US': 'Markov Chains & Stationary Analysis' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Markov-chain laboratory: power iteration for the stationary distribution (L1 residual < 1e-12), irreducibility & period detection, absorbing-chain analysis via (I-Q)^-1 (expected absorption times and probabilities), trajectory simulation and a PageRank mode (damping 0.85) on a directed transition graph.',
  descriptionI18n: {
    'zh-CN':
      '马尔可夫链实验室：幂法求稳态分布（L1 残差 < 1e-12）、遍历性与周期检查、吸收链分析（(I-Q)⁻¹ 高斯消元求期望吸收时间与吸收概率）、轨迹模拟，以及阻尼 0.85 的 PageRank 模式；支持上传 CSV/TSV 转移矩阵。',
    'en-US':
      'Markov-chain laboratory: power iteration for the stationary distribution (L1 residual < 1e-12), irreducibility & period detection, absorbing-chain analysis via (I-Q)^-1 (expected absorption times and probabilities), trajectory simulation, and a PageRank mode with damping 0.85; CSV/TSV transition matrices accepted.',
  },
  license: 'MIT',
  entry: 'example.stats-markov',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    benchmarks: [
      'markov-weather-steady',
      'markov-doubly-stochastic',
      'markov-absorbing-ruin',
      'markov-pagerank-fixedpoint',
    ],
    reproducible: true,
    notes:
      'Benchmarks vs analytic ground truth: (1) weather P=[[0.9,0.1],[0.45,0.55]] steady state (9/11, 2/11), error < 1e-10; (2) doubly stochastic matrix -> uniform stationary distribution; (3) gambler\'s ruin with $1/$2 transient states: expected absorption time 2 and ruin probability 2/3, error < 1e-9; (4) PageRank fixed-point residual < 1e-12 with damping 0.85 (Page & Brin 1998). Uniform relative-error convention for the scale benchmarks, absolute error for the linear solves.',
    notesI18n: {
      'zh-CN':
        '基准对照解析真值：① 天气模型 P=[[0.9,0.1],[0.45,0.55]] 稳态 = (9/11, 2/11)，误差 < 1e-10；② 双随机矩阵稳态 = 均匀分布；③ 赌徒破产链（$1/$2 瞬态）：期望吸收步数 2、破产概率 2/3，误差 < 1e-9；④ 阻尼 0.85 的 PageRank 不动点残差 < 1e-12（Page & Brin 1998）。线性求解采用绝对误差口径。',
      'en-US':
        "Benchmarks vs analytic ground truth: (1) weather P=[[0.9,0.1],[0.45,0.55]] steady state (9/11, 2/11), error < 1e-10; (2) doubly stochastic matrix -> uniform stationary distribution; (3) gambler's ruin with $1/$2 transient states: expected absorption time 2 and ruin probability 2/3, error < 1e-9; (4) PageRank fixed-point residual < 1e-12 with damping 0.85 (Page & Brin 1998). Uniform relative-error convention for the scale benchmarks, absolute error for the linear solves.",
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'row-stochastic transition matrix, one row per line (supports "# labels:" and comment lines)' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated transition matrix' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace / comma separated transition matrix' },
  ],
};
