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
};
