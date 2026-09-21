// ==========================================================================
// AI Trainer manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const aiTrainingManifest: PluginManifest = {
  id: 'example.ai-training',
  name: 'AI Trainer',
  nameI18n: { 'zh-CN': 'AI 训练', 'en-US': 'AI Trainer' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Train regression / classification models (TF.js) with live loss curves.',
  descriptionI18n: {
    'zh-CN': '基于 TF.js 训练回归/分类模型，实时显示损失曲线与可视化。',
    'en-US': 'Train regression / classification models with TF.js; live loss curve & visualizations.',
  },
  license: 'MIT',
  entry: 'example.ai-training',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON (MNIST)' },
  ],
};
