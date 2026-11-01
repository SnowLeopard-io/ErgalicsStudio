// ==========================================================================
// Synthetic Data Generator manifest — pure data, split from the plugin file
// so a registry can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const synthManifest: PluginManifest = {
  id: 'data.synth',
  name: 'Synthetic Data Generator',
  nameI18n: { 'zh-CN': '合成数据生成器', 'en-US': 'Synthetic Data Generator' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  entry: 'data.synth',
  category: 'scientific',
  sandbox: 'trusted',
  description:
    'Seeded synthetic tabular data: univariate distribution fitting, Gaussian-copula correlation preservation, AR(1) time-series mode, Laplace epsilon-DP and k-anonymity, with statistical quality metrics.',
  descriptionI18n: {
    'zh-CN':
      '种子化表格合成数据：单变量分布拟合、高斯 Copula 保相关、AR(1) 时序模式、Laplace ε-差分隐私与 k-匿名，并给出统计质量指标。',
    'en-US':
      'Seeded synthetic tabular data: univariate distribution fitting, Gaussian-copula correlation preservation, AR(1) time-series mode, Laplace epsilon-DP and k-anonymity, with statistical quality metrics.',
  },
  research: {
    tier: 'quasi-research',
    reproducible: true,
    benchmarks: ['quality-metrics'],
    notes: 'Pure-TS deterministic kernel (seeded); no Python runtime required.',
    notesI18n: {
      'zh-CN': '纯 TypeScript 确定性内核（种子化）；无需 Python 运行时。',
      'en-US': 'Pure-TS deterministic kernel (seeded); no Python runtime required.',
    },
  },
  formats: [{ extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' }],
};
