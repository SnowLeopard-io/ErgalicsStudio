// ==========================================================================
// socio-sna — social network analyzer, manifest
//
// Deterministic social network analysis: centrality (Brandes betweenness),
// community detection (Louvain / label propagation / Girvan-Newman),
// influence cascades (independent cascade, linear threshold) and structural
// holes (Burt constraint, brokerage, bridges) on weighted edge lists.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const snaManifest: PluginManifest = {
  id: 'example.socio-sna',
  name: 'Social Network Analyzer',
  nameI18n: { 'zh-CN': '社会网络分析器', 'en-US': 'Social Network Analyzer' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Deterministic social network analysis on weighted edge lists: degree / betweenness (Brandes) / closeness / eigenvector / PageRank centrality, Louvain, label-propagation and Girvan-Newman communities, independent-cascade and linear-threshold influence spreading, and Burt-constraint structural holes with brokerage scores.',
  descriptionI18n: {
    'zh-CN':
      '确定性社会网络分析：度数 / 中介（Brandes）/ 接近 / 特征向量 / PageRank 中心性，Louvain、标签传播与 Girvan-Newman 社区发现，独立级联与线性阈值影响力传播，以及 Burt 约束结构洞与中介得分；输出网络规模、密度、模度、级联到达率与结构判据。',
    'en-US':
      'Deterministic social network analysis: degree / betweenness (Brandes) / closeness / eigenvector / PageRank centrality, Louvain, label-propagation and Girvan-Newman communities, independent-cascade and linear-threshold influence spreading, and Burt-constraint structural holes with brokerage scores; reports network size, density, modularity, cascade reach and a structural verdict.',
  },
  license: 'MIT',
  entry: 'example.socio-sna',
  category: 'scientific',
  sandbox: 'trusted',
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:93ae587f53fe1e4427b8a52f74e5eef4',
    sig: 'a7911c52b1fee83014ee333c6edd8f67cf513f68172c081d43f5b9994cdd22a24a34f06cb67ca9d708f3084e86db2651b67238b6464cfffac45daa3e458d690e',
    signer: 'Ergalics Studio (socio pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0e9a8aa057857b1cfb49699cac982814e4e9774450958794e8aaad8c1fcec3ec',
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'Edge list CSV (source,target,weight)' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON graph ({nodes, edges})' },
  ],
  research: {
    tier: 'quasi-research',
    benchmarks: ['centrality-exact', 'louvain-known-communities'],
    reproducible: true,
    notes:
      'Kernel validated against hand-computed centralities on small graphs (star-graph betweenness hub = C(n-1,2), path-graph closeness, a 6-node reference graph with hand-derived betweenness), an independent explicit shortest-path-enumeration cross-check of Brandes, PageRank mass conservation (sums to 1), planted-partition recovery by Louvain, cascade reachability bounds (p=0 stays at seeds, p=1 floods the component) and full same-seed determinism. Method references: Freeman (1978) centrality; Blondel et al. (2008) Louvain; Girvan & Newman (2002) community structure. The structural verdict is a qualitative classification of the top-node centrality share, not an analytic result.',
    notesI18n: {
      'zh-CN':
        '基准：①小图手工中心性（星形图中介中心性枢纽 = C(n-1,2)、路径图接近中心性、6 节点参考图手工中介值）；②Brandes 与独立的最短路径显式枚举交叉验证；③PageRank 质量守恒（和为 1）；④Louvain 恢复二块植入分区；⑤级联可达界（p=0 停留在种子，p=1 淹没连通分量）；⑥固定种子完全确定性。出处：Freeman (1978) 中心性；Blondel et al. (2008) Louvain；Girvan & Newman (2002) 社区结构。结构判据为首位中心性占比的定性分类，非解析结果。',
      'en-US':
        'Benchmarks: (1) hand-computed centralities on small graphs (star betweenness hub = C(n-1,2), path closeness, a 6-node reference graph with hand-derived betweenness); (2) Brandes cross-checked against independent explicit shortest-path enumeration; (3) PageRank mass conservation (sums to 1); (4) Louvain recovery of a 2-block planted partition; (5) cascade reachability bounds (p=0 stays at seeds, p=1 floods the component); (6) full same-seed determinism. Sources: Freeman (1978) centrality; Blondel et al. (2008) Louvain; Girvan & Newman (2002) community structure. The structural verdict is a qualitative classification of the top-node centrality share, not an analytic result.',
    },
  },
};
