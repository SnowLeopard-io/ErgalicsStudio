// ==========================================================================
// socio-inequality — income inequality analyzer, manifest
//
// Distribution-level inequality analytics on income samples: exact Gini
// (mean-absolute-difference) with a seeded bootstrap interval, the Lorenz
// curve with trapezoid-area closure, Palma / Theil / Atkinson summaries,
// percentile ratios, moment-based distribution identification with
// theoretical-Gini identity checks, Galton-style intergenerational mobility
// and tax-regime counterfactuals.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const inequalityManifest: PluginManifest = {
  id: 'example.socio-inequality',
  name: 'Inequality Analyzer',
  nameI18n: { 'zh-CN': '不平等分析器', 'en-US': 'Inequality Analyzer' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Income inequality workbench: exact Gini (mean-absolute-difference) with a seeded bootstrap interval, Lorenz curve with trapezoid-area closure, Palma ratio, decomposable Theil index, Atkinson index (epsilon parameter), 90/10 and 50/10 percentile ratios, seeded log-normal / Pareto / power-law / exponential sample generation with moment-based identification and theoretical-Gini identity checks, Galton-style intergenerational mobility (rank-rank slope) and progressive / flat / regressive tax counterfactuals with a Reynolds-Smolensky-style redistribution effect.',
  descriptionI18n: {
    'zh-CN':
      '收入不平等工作台：精确基尼系数（平均绝对差公式）+ 固定种子自助置信区间、洛伦兹曲线与梯形面积闭合、Palma 比率、可分解 Theil 指数、Atkinson 指数（epsilon 参数）、90/10 与 50/10 分位比、对数正态/帕累托/幂律/指数分布的固定种子抽样与矩估计识别（含理论基尼恒等式校验）、Galton 式代际流动模拟（秩-秩斜率）与累进/比例/累退税制反事实（Reynolds-Smolensky 式再分配效应）。',
    'en-US':
      'Income inequality workbench: exact Gini (mean-absolute-difference) with a seeded bootstrap interval, Lorenz curve with trapezoid-area closure, Palma ratio, decomposable Theil index, Atkinson index (epsilon parameter), 90/10 and 50/10 percentile ratios, seeded log-normal / Pareto / power-law / exponential sample generation with moment-based identification and theoretical-Gini identity checks, Galton-style intergenerational mobility (rank-rank slope) and progressive / flat / regressive tax counterfactuals with a Reynolds-Smolensky-style redistribution effect.',
  },
  license: 'MIT',
  entry: 'example.socio-inequality',
  category: 'scientific',
  sandbox: 'trusted',
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:93ae587f53fe1e4427b8a52f74e5eef4',
    sig: 'b23adaf326dfb72bc2ca09fee94cabbbae61e6eef11f321b207819e005dcc272b9c7a5995f4b11c206d742ff11bb36ad47d76f057f353a89bd0bc1ce50f8f70a',
    signer: 'Ergalics Studio (socio pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0e9a8aa057857b1cfb49699cac982814e4e9774450958794e8aaad8c1fcec3ec',
  },
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'Income sample: one header-less column of incomes, or income,weight per row.',
    },
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Income sample: { "incomes": number[], "weights"?: number[] }.',
    },
  ],
  research: {
    tier: 'quasi-research',
    benchmarks: ['gini-exact', 'lorenz-closure'],
    reproducible: true,
    notes:
      'Kernel validated against hand-computed Ginis on tiny populations ([1,1,1,1] = 0, [0,0,0,4] = 0.75, [1,2,3,4] = 0.25), Lorenz curve endpoints (0,0)/(1,1) closure, known distribution-moment identities (log-normal Gini = 2*Phi(sigma/sqrt(2)) - 1, Pareto Gini = 1/(2a-1), exponential Gini = 1/2) on large seeded samples, a fixed-seed bootstrap CI sanity check and full seed determinism. The distribution verdict is a qualitative severity classification of the point-estimate Gini, not an inferential test.',
    notesI18n: {
      'zh-CN':
        '基准：①极小总体的手工基尼对照（[1,1,1,1]=0、[0,0,0,4]=0.75、[1,2,3,4]=0.25）；②洛伦兹曲线端点 (0,0)/(1,1) 闭合；③大样本固定种子下的已知分布-矩恒等式（对数正态基尼 = 2Φ(σ/√2)−1，帕累托基尼 = 1/(2a−1)，指数分布基尼 = 1/2）；④固定种子自助区间的合理性校验；⑤完全种子确定性。出处：Gini (1912)「Variabilità e Mutabilità」；Theil (1967)「Economics and Information Theory」；Atkinson (1970) JET 2:244–263；Palma (2011)「Homogeneous Middles vs. Polarized Tails」。分布判据为点估计基尼的定性严重度分级，非推断检验。',
      'en-US':
        'Benchmarks: (1) hand-computed Ginis on tiny populations ([1,1,1,1] = 0, [0,0,0,4] = 0.75, [1,2,3,4] = 0.25); (2) Lorenz curve endpoint closure (0,0)/(1,1); (3) known distribution-moment identities on large seeded samples (log-normal Gini = 2*Phi(sigma/sqrt(2)) - 1, Pareto Gini = 1/(2a-1), exponential Gini = 1/2); (4) fixed-seed bootstrap CI sanity check; (5) full seed determinism. Sources: Gini (1912) "Variabilita e Mutabilita"; Theil (1967) "Economics and Information Theory"; Atkinson (1970) JET 2:244-263; Palma (2011) "Homogeneous Middles vs. Polarized Tails". The distribution verdict is a qualitative severity classification of the point-estimate Gini, not an inferential test.',
    },
  },
};
