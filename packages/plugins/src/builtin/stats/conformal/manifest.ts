// ==========================================================================
// stats-conformal — split conformal prediction lab — manifest
// ==========================================================================

import type { PluginManifest } from '@ergalics/plugin-sdk';

export const statsConformalManifest: PluginManifest = {
  id: 'example.stats-conformal',
  name: 'Conformal Prediction',
  nameI18n: { 'zh-CN': '共形预测 (Conformal)', 'en-US': 'Conformal Prediction' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Split conformal prediction for regression: calibrate absolute or locally normalised nonconformity scores on a held-out split, then compare finite-sample coverage and interval width against a Gaussian ±z·σ̂ interval on heteroscedastic, homoscedastic and skewed noise.',
  descriptionI18n: {
    'zh-CN':
      '回归任务的分裂共形预测：在独立校准集上校准绝对或局部归一化非一致性分数，把有限样本覆盖率与区间宽度同高斯 ±z·σ̂ 区间在异方差、同方差与偏态噪声下直接对比。',
    'en-US':
      'Split conformal prediction for regression: calibrate absolute or locally normalised nonconformity scores on a held-out split, then compare finite-sample coverage and interval width against a Gaussian ±z·σ̂ interval on heteroscedastic, homoscedastic and skewed noise.',
  },
  license: 'MIT',
  entry: 'example.stats-conformal',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    benchmarks: ['conformal-quantile'],
    reproducible: true,
    notes:
      'Split-conformal guarantee is marginal (averaged over the calibration draw), not conditional on x — the interval width adapts to x only in the normalised variant. The 60/20/20 split is deterministic given the seed. The Gaussian baseline uses a single residual standard deviation fitted on the training split, so it keeps roughly nominal marginal coverage but under-covers the high-variance tail of x; the low/high x-tercile coverages make that failure visible.',
    notesI18n: {
      'zh-CN':
        '分裂共形保证是边际的（对校准集抽样平均），并非对给定 x 条件成立——只有归一化变体的区间宽度随 x 自适应。60/20/20 划分在给定种子下是确定的。高斯基线使用训练集上的单一残差标准差，因此边际覆盖率大致正常，但在 x 的高方差一端明显欠覆盖；低/高 x 三分位覆盖率把这一失效直接暴露出来。',
      'en-US':
        'The split-conformal guarantee is marginal (averaged over the calibration draw), not conditional on x — interval width adapts to x only in the normalised variant. The 60/20/20 split is deterministic given the seed. The Gaussian baseline uses a single residual standard deviation fitted on the training split, which is exactly why it under-covers under heteroscedasticity.',
    },
  },
};
