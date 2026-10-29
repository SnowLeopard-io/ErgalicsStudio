// ==========================================================================
// Vector Store manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const vectordbManifest: PluginManifest = {
  id: 'ai.vectordb',
  name: 'Vector Store',
  nameI18n: { 'zh-CN': '向量数据库', 'en-US': 'Vector Database' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  entry: 'ai.vectordb',
  category: 'scientific',
  sandbox: 'trusted',
  description:
    'In-browser vector store: hashing-trick text embeddings and L2-normalized numeric vectors, exact brute-force search beside a simplified HNSW approximate index (multi-layer graph with M, efConstruction and efSearch), cosine / Euclidean / inner-product metrics, Recall@K evaluation against brute force, and seeded PCA or exact t-SNE 2-D projection.',
  descriptionI18n: {
    'zh-CN':
      '浏览器内向量数据库：哈希技巧文本嵌入与 L2 归一化数值向量，精确暴力检索与简化版 HNSW 近似索引（多层图，支持 M、efConstruction、efSearch），余弦/欧氏/内积度量，相对暴力检索的 Recall@K 评估，以及固定种子的 PCA 或精确 t-SNE 二维投影。',
    'en-US':
      'In-browser vector store: hashing-trick text embeddings and L2-normalized numeric vectors, exact brute-force search beside a simplified HNSW approximate index (multi-layer graph with M, efConstruction and efSearch), cosine / Euclidean / inner-product metrics, Recall@K evaluation against brute force, and seeded PCA or exact t-SNE 2-D projection.',
  },
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['hnsw-recall', 'search-throughput'],
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (numeric vectors)' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON {documents:[...]}' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:2a25152a65d7f89544cb5c9cd503b456',
    sig: '97ff25ad07b55ecc28e591064b8f992f0a5c9255678dcbb6d6761e929cc400d68a289d5b0cce6d986c028efa598ececaa7b637b3cd6b0e65d8b7b2e6b9560b01',
    signer: 'Ergalics Studio (AI suite pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: 'f0f5c97eedd922c9bb7dc31a874b82fdfb7e6d58f58fbe2987de9c9f27ecd63e',
  },
};
