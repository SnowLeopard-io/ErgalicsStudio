// Meta-Analysis — fixed / random-effects pooling and publication bias.
import type { PluginManifest } from '@/types/plugin';

export const statsMetaManifest: PluginManifest = {
  id: 'example.stats-meta',
  name: 'Meta-Analysis',
  nameI18n: { 'zh-CN': '元分析', 'en-US': 'Meta-Analysis' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Inverse-variance fixed-effect pooling, DerSimonian-Laird random effects, Cochran Q, I², tau², forest and funnel data, Egger regression for small-study effects, trim-and-fill and subgroup pooling.',
  descriptionI18n: {
    'zh-CN':
      '逆方差固定效应合并、DerSimonian-Laird 随机效应、Cochran Q、I²、tau²、森林图与漏斗图数据、用于小样本效应的 Egger 回归、剪补法以及亚组合并。',
    'en-US':
      'Inverse-variance fixed-effect pooling, DerSimonian-Laird random effects, Cochran Q, I², tau², forest and funnel data, Egger regression for small-study effects, trim-and-fill and subgroup pooling.',
  },
  license: 'MIT',
  entry: 'example.stats-meta',
  category: 'scientific',
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['fixed-effect-hand', 'heterogeneity-bounds', 'random-effect-ci'],
    notes:
      'Expects one effect size and its standard error per study. Egger p-values use a normal approximation; trim-and-fill is the Duval-Tweedie L0 variant.',
    notesI18n: {
      'zh-CN': '要求每项研究提供效应量及其标准误。Egger p 值采用正态近似；剪补法为 Duval-Tweedie L0 变体。',
      'en-US':
        'Expects one effect size and its standard error per study. Egger p-values use a normal approximation; trim-and-fill is the Duval-Tweedie L0 variant.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'study,effect,se[,group] table' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'same table, tab separated' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '750f31a46c6fad7a9d05ce0d4763001e65e10486159a3379124ca15b0db95ab470bb19fe79a40e856fef5cdd754d40002df2c5a1c2e5f997d7e0a8da84514d0a',
    signer: 'Ergalics Studio (stats pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
