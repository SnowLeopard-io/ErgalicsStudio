// ==========================================================================
// math-graph — Graph Theory Visualizer — manifest
//
// Manifest-only module: `builtin/index.ts` imports this file statically while
// the implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mathGraphManifest: PluginManifest = {
  id: 'example.math-graph',
  name: 'Graph Theory Visualizer',
  nameI18n: { 'zh-CN': '图论算法可视化', 'en-US': 'Graph Theory Visualizer' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Graph algorithms workbench: adjacency-matrix / edge-list input with built-in weighted directed and undirected sample graphs, Dijkstra / Bellman-Ford / Floyd-Warshall shortest paths, Prim / Kruskal minimum spanning trees, Ford-Fulkerson / Edmonds-Karp maximum flow with the residual min-cut, greedy coloring, bipartite maximum matching with the König vertex cover, Euler / Hamiltonian trail detection, and a step-by-step algorithm animation over a deterministic seeded layout.',
  descriptionI18n: {
    'zh-CN':
      '图算法实验台：支持邻接矩阵 / 边列表文本输入并内置带权有向与无向样本图；提供 Dijkstra、Bellman-Ford、Floyd-Warshall 最短路（结果对比），Prim、Kruskal 最小生成树，Ford-Fulkerson、Edmonds-Karp 最大流（显示最小割与流量），贪心图着色，二部图最大匹配与 König 最小点覆盖，欧拉 / 哈密顿路径检测；基于固定种子确定性布局提供逐步算法动画。',
    'en-US':
      'Graph algorithms workbench: adjacency-matrix / edge-list input with built-in weighted directed and undirected sample graphs, Dijkstra / Bellman-Ford / Floyd-Warshall shortest paths, Prim / Kruskal minimum spanning trees, Ford-Fulkerson / Edmonds-Karp maximum flow with the residual min-cut, greedy coloring, bipartite maximum matching with the König vertex cover, Euler / Hamiltonian trail detection, and a step-by-step algorithm animation over a deterministic seeded layout.',
  },
  license: 'MIT',
  entry: 'example.math-graph',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    benchmarks: ['graph-benchmarks'],
    reproducible: true,
    notes:
      'Benchmarks: (1) Dijkstra vs Floyd-Warshall all-pairs distances on the weighted sample agree exactly (rel. err = 0); (2) Prim and Kruskal MST totals both equal the known reference 37 (rel. err = 0); (3) Edmonds-Karp / Ford-Fulkerson max flow equals the known network value 7 and matches the residual min-cut capacity (rel. err = 0); (4) Bellman-Ford distances on the negative-weight digraph match [0, 4, 1, 3, 1] (rel. err = 0); (5) König theorem: maximum matching = minimum vertex cover = 3 on the sample bipartite graph (rel. err = 0). Unified error metric |computed \u2212 analytic|/|analytic|. Layout and iteration orders are deterministic (fixed RNG seed), so identical inputs reproduce identical panels.',
    notesI18n: {
      'zh-CN':
        '验证基准（统一相对误差口径 |计算−解析|/|解析|）：① Dijkstra 与 Floyd-Warshall 在带权样本图上的全对最短路完全一致（relErr = 0）；② Prim 与 Kruskal 的最小生成树总权均等于已知参考值 37（relErr = 0）；③ Edmonds-Karp / Ford-Fulkerson 最大流等于网络已知值 7，并与残差最小割容量一致（relErr = 0）；④ Bellman-Ford 在负权有向图上的距离对照已知值 [0, 4, 1, 3, 1]（relErr = 0）；⑤ König 定理：样本二部图最大匹配 = 最小点覆盖 = 3（relErr = 0）。布局与迭代顺序使用固定随机种子，输入相同即可复现相同面板。',
      'en-US':
        'Benchmarks (unified metric |computed \u2212 analytic|/|analytic|): (1) Dijkstra vs Floyd-Warshall all-pairs distances on the weighted sample agree exactly, rel. err = 0; (2) Prim and Kruskal MST totals both equal the known reference 37, rel. err = 0; (3) Edmonds-Karp / Ford-Fulkerson max flow equals the known network value 7 and the residual min-cut capacity, rel. err = 0; (4) Bellman-Ford distances on the negative-weight digraph match [0, 4, 1, 3, 1], rel. err = 0; (5) König theorem: maximum matching = minimum vertex cover = 3 on the sample bipartite graph, rel. err = 0. Layout and iteration orders are deterministic (fixed RNG seed), so identical inputs reproduce identical panels.',
    },
  },
};
