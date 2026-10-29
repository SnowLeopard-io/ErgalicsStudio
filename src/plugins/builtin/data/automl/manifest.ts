// ==========================================================================
// AutoML Pipeline manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const automlManifest: PluginManifest = {
  id: 'ai.automl',
  name: 'AutoML Pipeline',
  nameI18n: { 'zh-CN': 'AutoML 流水线', 'en-US': 'AutoML Pipeline' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  entry: 'ai.automl',
  category: 'scientific',
  sandbox: 'trusted',
  description:
    'Automated model selection over tabular CSV data: preprocessing, hyperparameter search and K-fold cross-validated model comparison.',
  descriptionI18n: {
    'zh-CN': '对表格 CSV 数据执行自动化建模：数据预处理、超参数搜索与 K 折交叉验证的模型比较。',
    'en-US':
      'Automated modelling over tabular CSV data: preprocessing, hyperparameter search and K-fold cross-validated model comparison.',
  },
  research: {
    tier: 'quasi-research',
    reproducible: true,
    benchmarks: ['cv-accuracy', 'pipeline-export'],
  },
  formats: [{ extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' }],
};
