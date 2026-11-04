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
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:2a25152a65d7f89544cb5c9cd503b456',
    sig: 'fbb81e61cdc62d37ad9b464989450d829adf664278014fd71e73ccb1da4bb56112cd0a9aa60209c1f64be9a334bc85cdee1c8b0d390b35e97ba69c13fe0e9e04',
    signer: 'Ergalics Studio (AI suite pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: 'f0f5c97eedd922c9bb7dc31a874b82fdfb7e6d58f58fbe2987de9c9f27ecd63e',
  },
};
