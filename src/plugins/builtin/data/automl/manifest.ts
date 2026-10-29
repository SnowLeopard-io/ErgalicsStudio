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
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:2a25152a65d7f89544cb5c9cd503b456',
    sig: 'e819e943ba5a47a7ae96c964a5fc6bb87dcae5bfbd446554d8d72a57665447a030393061e75c2743c7d6c2be796a49fd300ef14bb29334cdb5aa23928b64c106',
    signer: 'Ergalics Studio (AI suite pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: 'f0f5c97eedd922c9bb7dc31a874b82fdfb7e6d58f58fbe2987de9c9f27ecd63e',
  },
};
