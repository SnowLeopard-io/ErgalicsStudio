// ==========================================================================
// Recommender Lab manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const recsysManifest: PluginManifest = {
  id: 'ai.recsys',
  name: 'Recommender Lab',
  nameI18n: { 'zh-CN': '推荐系统模拟器', 'en-US': 'Recommender System Simulator' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  entry: 'ai.recsys',
  category: 'scientific',
  sandbox: 'trusted',
  description:
    'Recommender-system laboratory for long-format rating data: user-based and item-based collaborative filtering, content-based ridge regression, ALS matrix factorization and a hybrid blend, with seeded holdout evaluation (Precision/Recall/NDCG@K, MAP, RMSE), cold-start fallback accounting and top-N generation.',
  descriptionI18n: {
    'zh-CN':
      '面向长格式评分数据的推荐系统实验台：基于用户/物品的协同过滤、内容岭回归、ALS 矩阵分解与混合推荐，提供固定种子的保留集评估（Precision/Recall/NDCG@K、MAP、RMSE）、冷启动回退统计与 Top-N 推荐。',
    'en-US':
      'Recommender-system laboratory for long-format rating data: user/item collaborative filtering, content-based ridge regression, ALS matrix factorization and a hybrid blend, with seeded holdout evaluation (Precision/Recall/NDCG@K, MAP, RMSE), cold-start fallback accounting and top-N generation.',
  },
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['ndcg-sanity', 'als-convergence'],
  },
  formats: [{ extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' }],
};
