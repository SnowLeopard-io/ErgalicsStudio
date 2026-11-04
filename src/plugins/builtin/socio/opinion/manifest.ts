// ==========================================================================
// socio-opinion — public opinion diffusion, manifest
//
// Deterministic opinion-diffusion workbench: random / small-world /
// echo-chamber networks, independent-cascade and linear-threshold spreading
// (Granovetter 1978; Kempe-Kleinberg-Terman 2003), a rumour-vs-fact-checker
// competing-cascade mode, CELF greedy influence maximization and echo-chamber
// (filter-bubble) diagnostics.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const opinionManifest: PluginManifest = {
  id: 'example.socio-opinion',
  name: 'Public Opinion Diffusion',
  nameI18n: { 'zh-CN': '舆论传播模型', 'en-US': 'Public Opinion Diffusion' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Opinion diffusion on social networks: independent-cascade and linear-threshold spreading with per-edge probabilities, a rumour-vs-fact-checker competing-cascade mode, CELF greedy influence maximization, and echo-chamber diagnostics (opinion homophily index, cross-cutting exposure diversity, mean-opinion time series).',
  descriptionI18n: {
    'zh-CN':
      '社交网络上的舆论传播工作台：独立级联与线性阈值传播模型（逐边概率、邻居加权激活）、谣言-事实核查竞争级联模式、CELF 贪心影响最大化种子搜索，以及回音室诊断（观点同质化指数、跨阵营曝光多样性、观点均值时间序列）；网络支持随机图、小世界与同质化回音室结构，全程固定种子可复现。',
    'en-US':
      'Opinion-diffusion workbench for social networks: independent-cascade and linear-threshold spreading (per-edge probabilities, neighbour-weighted activation), a rumour-vs-fact-checker competing-cascade mode, CELF greedy influence-maximization seed search, and echo-chamber diagnostics (opinion homophily index, cross-cutting exposure diversity, mean-opinion time series); random, small-world and homophilous echo-chamber network structures, fully reproducible under a fixed seed.',
  },
  license: 'MIT',
  entry: 'example.socio-opinion',
  category: 'scientific',
  sandbox: 'trusted',
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:93ae587f53fe1e4427b8a52f74e5eef4',
    sig: '1ee192420fb28e271cebb49c21907083a9033ced000e3ee2581bbadbcc08934951442be8f813c26d3a8986a188d0720b06afb2e2c81c425f34b9ae11cb6db509',
    signer: 'Ergalics Studio (socio pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0e9a8aa057857b1cfb49699cac982814e4e9774450958794e8aaad8c1fcec3ec',
  },
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'Edge list CSV (source,target,weight)',
    },
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Network JSON ({nodes,edges})',
    },
  ],
  research: {
    tier: 'quasi-research',
    benchmarks: ['cascade-exact-small'],
    reproducible: true,
    notes:
      'Kernel validated on a hand-built 4-node chain with exact cascade outcomes for given edge probabilities (including a zero-probability cut edge) and a 5-sigma Monte Carlo bound on the analytic chain mean reach 1 + p + p^2 + p^3, linear-threshold fixed-point stability of the terminal active set, greedy (CELF) matching exhaustive seed search on a small graph, echo-chamber index bounds, and seed determinism. Threshold adoption follows Granovetter (1978) and greedy influence maximization follows Kempe-Kleinberg-Terman (2003); the echo-chamber metrics paraphrase the filter-bubble literature. All cascade outputs are stochastic simulations, not analytic results.',
    notesI18n: {
      'zh-CN':
        '基准：①手工构造的 4 节点链式网络在给定逐边概率下的级联结果精确可验（含概率为 0 的断边），p=0.5 链的期望到达规模 1+p+p²+p³ 以 4000 次模拟的 5σ 蒙特卡洛界核验；②线性阈值模型终态活跃集为精确不动点（再无新激活）；③小图上 CELF 贪心种子选择与穷举搜索一致；④回音室同质化指数与曝光多样性有界且结构方向正确；⑤固定种子全程确定性。出处：Granovetter (1978) 阈值模型（"Threshold models of collective behavior" AJJS 84:1420–1443）、Kempe-Kleinberg-Terman (2003) 影响最大化（"Maximizing the spread of influence through a social network" KDD\'03），回音室/过滤气泡判据为该文献观点的改述。级联输出为随机模拟而非解析结果。',
      'en-US':
        'Benchmarks: (1) hand-built 4-node chain with exact cascade outcomes for given edge probabilities (including a zero-probability cut edge) and the analytic chain mean reach 1 + p + p^2 + p^3 checked within a 5-sigma Monte Carlo bound at 4000 simulations; (2) the terminal linear-threshold active set is an exact fixed point (no further activation); (3) CELF greedy seed selection matches exhaustive search on a small graph; (4) echo-chamber homophily index and exposure diversity are bounded and structurally correct; (5) full determinism under a fixed seed. Sources: Granovetter (1978) threshold models, "Threshold models of collective behavior" AJJS 84:1420-1443; Kempe-Kleinberg-Terman (2003) influence maximization, "Maximizing the spread of influence through a social network" KDD\'03; echo-chamber metrics paraphrase the filter-bubble literature. Cascade outputs are stochastic simulations, not analytic results.',
    },
  },
};
