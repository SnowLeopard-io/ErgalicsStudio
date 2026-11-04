// ==========================================================================
// NLP Workbench manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const nlpManifest: PluginManifest = {
  id: 'ai.nlp',
  name: 'NLP Workbench',
  nameI18n: { 'zh-CN': '自然语言处理工作台', 'en-US': 'NLP Workbench' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  entry: 'ai.nlp',
  category: 'scientific',
  sandbox: 'trusted',
  description:
    'Deterministic text-analysis pipeline over a line-per-document corpus: TF-IDF indexing, LDA topic modelling, lexicon + naive-Bayes sentiment, cosine similarity with k-means clustering and 2-D PCA, and heuristic named-entity recognition.',
  descriptionI18n: {
    'zh-CN':
      '面向每行一篇文档语料的确定性文本分析流水线：TF-IDF 索引、LDA 主题模型、词典与朴素贝叶斯情感分析、余弦相似度与 K 均值聚类及二维 PCA 投影，以及启发式命名实体识别。',
    'en-US':
      'Deterministic text-analysis pipeline over a line-per-document corpus: TF-IDF indexing, LDA topic modelling, lexicon + naive-Bayes sentiment, cosine similarity with k-means clustering and 2-D PCA, and heuristic named-entity recognition.',
  },
  research: {
    tier: 'quasi-research',
    reproducible: true,
    benchmarks: ['tfidf-sanity', 'lda-topics'],
  },
  formats: [
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text corpus' },
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV corpus' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:2a25152a65d7f89544cb5c9cd503b456',
    sig: '72416ae8f7be801ee7e6cfe3138a782555c9b7de880c46d940eeb5ea12e8df11dae3819bc193e611dcf43c519252731dd8ae968d58ba5ad20bab40f335614308',
    signer: 'Ergalics Studio (AI suite pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: 'f0f5c97eedd922c9bb7dc31a874b82fdfb7e6d58f58fbe2987de9c9f27ecd63e',
  },
};
