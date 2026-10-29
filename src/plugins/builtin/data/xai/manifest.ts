// ==========================================================================
// Model Interpreter (XAI) manifest — pure data, split from the plugin file
// so builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const xaiManifest: PluginManifest = {
  id: 'ai.xai',
  name: 'Model Interpreter',
  nameI18n: { 'zh-CN': '模型解释器', 'en-US': 'Model Interpreter' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  entry: 'ai.xai',
  category: 'scientific',
  sandbox: 'trusted',
  description:
    'Explainable-AI workbench for tabular CSV data: trains a reference logistic-regression / ridge model (z-score standardized, gradient descent) and explains it with permutation importance, partial dependence, LIME local surrogates, KernelSHAP with a local-accuracy additivity check, coordinate counterfactual search and group fairness metrics (demographic parity, equalized odds, disparate impact).',
  descriptionI18n: {
    'zh-CN':
      '面向表格 CSV 数据的可解释 AI 实验台：训练逻辑回归/岭回归参考模型（z-score 标准化、梯度下降），并提供置换重要性、部分依赖、LIME 局部代理、带可加性校验的 KernelSHAP、反事实搜索与群体公平性指标（人口平等差异、均等化几率差距、差别影响比率）。',
    'en-US':
      'Explainable-AI workbench for tabular CSV data: trains a reference logistic-regression / ridge model (z-score standardized, gradient descent) and explains it with permutation importance, partial dependence, LIME local surrogates, KernelSHAP with a local-accuracy additivity check, coordinate counterfactual search and group fairness metrics (demographic parity, equalized odds, disparate impact).',
  },
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['lime-recovery', 'shap-additivity'],
  },
  formats: [{ extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' }],
};
