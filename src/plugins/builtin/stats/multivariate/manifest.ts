// Multivariate Analysis — PCA, factor analysis, clustering, LDA/QDA, CCA.
import type { PluginManifest } from '@/types/plugin';

export const statsMultivariateManifest: PluginManifest = {
  id: 'example.stats-multivariate',
  name: 'Multivariate Analysis',
  nameI18n: { 'zh-CN': '多元统计分析', 'en-US': 'Multivariate Analysis' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'PCA biplots, varimax factor analysis, Ward hierarchical and k-means / DBSCAN clustering with silhouette scores, LDA / QDA classification, canonical correlation, and Mahalanobis outlier detection.',
  descriptionI18n: {
    'zh-CN':
      'PCA 双标图、varimax 因子分析、Ward 层次聚类与 k-means / DBSCAN（含轮廓系数）、LDA / QDA 分类、典型相关分析以及马氏距离异常检测。',
    'en-US':
      'PCA biplots, varimax factor analysis, Ward hierarchical and k-means / DBSCAN clustering with silhouette scores, LDA / QDA classification, canonical correlation, and Mahalanobis outlier detection.',
  },
  license: 'MIT',
  entry: 'example.stats-multivariate',
  category: 'scientific',
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['pca-pc1', 'kmeans-separation', 'lda-accuracy'],
    notes:
      'Eigen-decompositions use the cyclic Jacobi method; k-means seeding is deterministic. Factor analysis uses principal-axis extraction with varimax rotation.',
    notesI18n: {
      'zh-CN': '特征分解采用循环 Jacobi 法；k-means 使用确定性初始化。因子分析采用主轴提取与 varimax 旋转。',
      'en-US':
        'Eigen-decompositions use the cyclic Jacobi method; k-means seeding is deterministic. Factor analysis uses principal-axis extraction with varimax rotation.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'observations × numeric variables (optional group)' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'same table, tab separated' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: 'e17888d425e60cfa4d16724fb7e2d0bed4a613ce0d4214ad3e32dd49ff5a859547a1c754c3a7c5fb277d4e5e88abe23e0bcd88a0abffdd11d6db7553559c2409',
    signer: 'Ergalics Studio (stats pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
