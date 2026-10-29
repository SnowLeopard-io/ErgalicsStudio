// Nonparametric Tests — rank-based hypothesis tests.
import type { PluginManifest } from '@/types/plugin';

export const statsNonparametricManifest: PluginManifest = {
  id: 'example.stats-nonparametric',
  name: 'Nonparametric Tests',
  nameI18n: { 'zh-CN': '非参数检验', 'en-US': 'Nonparametric Tests' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Distribution-free inference: Mann-Whitney U, Wilcoxon signed-rank, Kruskal-Wallis, Friedman, exact sign test, one- and two-sample Kolmogorov-Smirnov, Spearman rho and Kendall tau-b, each with effect sizes and p-values.',
  descriptionI18n: {
    'zh-CN':
      '无分布假设的统计推断：Mann-Whitney U、Wilcoxon 符号秩、Kruskal-Wallis、Friedman、精确符号检验、单/双样本 Kolmogorov-Smirnov、Spearman rho 与 Kendall tau-b，并给出效应量与 p 值。',
    'en-US':
      'Distribution-free inference: Mann-Whitney U, Wilcoxon signed-rank, Kruskal-Wallis, Friedman, exact sign test, one- and two-sample Kolmogorov-Smirnov, Spearman rho and Kendall tau-b, each with effect sizes and p-values.',
  },
  license: 'MIT',
  entry: 'example.stats-nonparametric',
  category: 'scientific',
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['mann-whitney-separated', 'kruskal-wallis-separated', 'wilcoxon-symmetric', 'kendall-known'],
    notes:
      'Tests use the asymptotic normal / chi-square approximation with tie corrections (scipy method="asymptotic"); the sign test is exact binomial. Small-sample exact rank tests are not implemented.',
    notesI18n: {
      'zh-CN':
        '检验采用带结校正的渐近正态 / 卡方近似（对应 scipy 的 asymptotic 方法）；符号检验为精确二项检验。未实现小样本精确秩检验。',
      'en-US':
        'Tests use the asymptotic normal / chi-square approximation with tie corrections (scipy method="asymptotic"); the sign test is exact binomial. Small-sample exact rank tests are not implemented.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'grouped long table or wide numeric columns' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'same table, tab separated' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '2ace241a53a94172b14f9369e60fb07e675d5459555ac72515c9c992eaff4ad34850a1e5d03773b9c34647b07ad0bc19599370ca5d335bad4b459247ebc0fa08',
    signer: 'Ergalics Studio (stats pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
