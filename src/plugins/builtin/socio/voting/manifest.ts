// ==========================================================================
// socio-voting — voting systems simulator, manifest
//
// Social-choice laboratory on full-preference profiles: plurality, IRV,
// Borda, approval and D'Hondt PR tallies, Condorcet analysis, spoiler and
// strategic-voting diagnostics and a pack-and-crack gerrymandering demo.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const votingManifest: PluginManifest = {
  id: 'example.socio-voting',
  name: 'Voting System Simulator',
  nameI18n: { 'zh-CN': '投票制度模拟器', 'en-US': 'Voting System Simulator' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Social-choice laboratory over full-preference profiles: plurality, instant-runoff, Borda count, approval voting (issue-space distance threshold) and D\'Hondt proportional representation tallies; pairwise Condorcet matrix and criterion checks, spoiler-effect detection via candidate addition, basic strategic misrepresentation under plurality, and a 1-D pack-and-crack gerrymandering demo reporting the seat-vote gap.',
  descriptionI18n: {
    'zh-CN':
      '社会选择实验室：在完整偏好剖面（选民 × 全排序）上计算多数制、即时复选（IRV）、博达计分、赞成投票（议题空间距离阈值）与 D\'Hondt 比例代表制票数/席位；输出两两孔多塞矩阵与准则检验、插入候选人导致的分票效应、多数制下的策略性投票影响，以及一维「集中-分割」杰利蝾螈选区划分的议席-得票落差。',
    'en-US':
      'Social-choice laboratory: tallies over full-preference profiles (voters x full rankings) under plurality, instant-runoff, Borda count, approval voting (issue-space distance threshold) and D\'Hondt proportional representation; pairwise Condorcet matrix and criterion checks, spoiler-effect detection via candidate addition, basic strategic misrepresentation under plurality, and a 1-D pack-and-crack gerrymandering demo reporting the seat-vote gap.',
  },
  license: 'MIT',
  entry: 'example.socio-voting',
  category: 'scientific',
  sandbox: 'trusted',
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:93ae587f53fe1e4427b8a52f74e5eef4',
    sig: 'fb53b4a72adbe5164f5a59eb00cf4f0eee19ddb9a506be49c368be7239e96d82a87db9014f6d7d67a2aa9fd4a5be89d122fcca77be29880397b41a629f517004',
    signer: 'Ergalics Studio (socio pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0e9a8aa057857b1cfb49699cac982814e4e9774450958794e8aaad8c1fcec3ec',
  },
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'preference profile: one rank row per voter (candidate indices, most preferred first)',
    },
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'preference profile: { rankings, voterPos?, candidatePos? }',
    },
  ],
  research: {
    tier: 'quasi-research',
    benchmarks: ['condorcet-criterion', 'plurality-exact'],
    reproducible: true,
    notes:
      'Kernel validated against hand-computed election counts (a 9-voter 3-candidate profile whose plurality, Borda, IRV and pairwise tallies are worked out by hand), Condorcet-criterion tests (a profile where a Condorcet winner exists and plurality fails to elect them; the classic 3-cycle paradox profile with no Condorcet winner), a classic spoiler scenario, D\'Hondt seat allocation on a known example, and seed determinism of profile generation. Criterion outcomes are exact combinatorial facts of the given profiles, not statistical estimates. References: Condorcet (1785) "Essai sur l\'application de l\'analyse a la probabilite des decisions rendues a la pluralite des voix"; Arrow (1951) "Social Choice and Individual Values".',
    notesI18n: {
      'zh-CN':
        '基准：①9 位选民、3 位候选人的手工算例——多数制、博达、IRV 与两两比较票数全部手工核算（多数制选出 A，孔多塞赢家为 B，准则违背被精确检出）；②孔多塞准则测试（存在孔多塞赢家而多数制未选出的算例；经典的 3 候选人循环悖论剖面无孔多塞赢家）；③经典分票（spoiler）场景；④D\'Hondt 议席分配已知算例（[100,80,30] 票 8 席 → [4,3,1]）；⑤固定种子生成剖面完全确定。准则结论是给定剖面的精确组合事实，非统计估计。出处：Condorcet (1785)《论按多数裁决作出决策的概率分析的应用》；Arrow (1951)《社会选择与个人价值》。',
      'en-US':
        'Benchmarks: (1) a hand-computed 9-voter, 3-candidate election whose plurality, Borda, IRV and pairwise counts are verified by hand (plurality elects A while the Condorcet winner is B, so the criterion violation is detected exactly); (2) Condorcet-criterion tests (a profile with an existing Condorcet winner that plurality fails to elect; the classic 3-candidate cyclic-paradox profile with no Condorcet winner); (3) a classic spoiler scenario; (4) D\'Hondt seat allocation on a known example ([100,80,30] votes, 8 seats -> [4,3,1]); (5) full seed determinism of profile generation. Criterion outcomes are exact combinatorial facts of the given profiles, not statistical estimates. References: Condorcet (1785), "Essai sur l\'application de l\'analyse a la probabilite des decisions rendues a la pluralite des voix"; Arrow (1951), "Social Choice and Individual Values".',
    },
  },
};
