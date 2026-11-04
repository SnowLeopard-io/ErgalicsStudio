// Design of Experiments (DOE) — factorial designs, ANOVA and Taguchi S/N.
import type { PluginManifest } from '@/types/plugin';

export const statsDoeManifest: PluginManifest = {
  id: 'example.stats-doe',
  name: 'Design of Experiments',
  nameI18n: { 'zh-CN': '试验设计（DOE）', 'en-US': 'Design of Experiments (DOE)' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Full / fractional factorial and response-surface analysis: coded design matrix, least-squares main effects and two-way interactions, a real ANOVA table with partial eta-squared, orthogonality diagnostics and Taguchi signal-to-noise ratios.',
  descriptionI18n: {
    'zh-CN':
      '全因子 / 部分因子与响应面分析：编码设计矩阵、主效应与二阶交互的最小二乘估计、含偏 eta² 的方差分析表、正交性诊断与田口信噪比。',
    'en-US':
      'Full / fractional factorial and response-surface analysis: coded design matrix, least-squares main effects and two-way interactions, a real ANOVA table with partial eta-squared, orthogonality diagnostics and Taguchi signal-to-noise ratios.',
  },
  license: 'MIT',
  entry: 'example.stats-doe',
  category: 'scientific',
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['doe-full-factorial-recovery', 'doe-orthogonality'],
    notes:
      'Continuous responses are modelled by ordinary least squares; categorical factors must be numeric-coded in the input table. Effect screening assumes independent, homoscedastic residuals.',
    notesI18n: {
      'zh-CN': '连续响应采用普通最小二乘；分类因子需在输入表中编码为数值。效应筛选假设残差独立且同方差。',
      'en-US':
        'Continuous responses are modelled by ordinary least squares; categorical factors must be numeric-coded in the input table. Effect screening assumes independent, homoscedastic residuals.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'run × factors × response table' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'same table, tab separated' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '5ee5fce285ca284be5a13429a0222be468c6e64dc2305a309e332472ad811b74d1566bec4e1c44d8f0e44e292fc7908f1d1718c29b869de210a297070202260b',
    signer: 'Ergalics Studio (stats pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
