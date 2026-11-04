import type { PluginManifest } from '@/types/plugin';

export const simAbmManifest: PluginManifest = {
  id: 'example.sim-abm',
  name: 'Agent-Based Modeling',
  nameI18n: { 'zh-CN': '智能体建模框架', 'en-US': 'Agent-Based Modeling' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Agent-based modeling framework with grid and continuous-space worlds: agent attributes, declarative transition/move rules, proximity interactions, batch runs and aggregate time series. Built-in templates: Schelling segregation, predator-prey, opinion dynamics (Deffuant) and Nagel-Schreckenberg traffic.',
  descriptionI18n: {
    'zh-CN':
      '智能体建模框架，支持网格与连续空间环境：智能体属性、声明式转移/移动规则、邻近交互、批量仿真与聚合时间序列。内置模板：Schelling 隔离模型、捕食者-猎物、意见动力学（Deffuant）与 Nagel-Schreckenberg 交通流。',
    'en-US':
      'Agent-based modeling framework with grid and continuous-space worlds: agent attributes, declarative transition/move rules, proximity interactions, batch runs and aggregate time series. Built-in templates: Schelling segregation, predator-prey, opinion dynamics (Deffuant) and Nagel-Schreckenberg traffic.',
  },
  license: 'MIT',
  entry: 'example.sim-abm',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { agents: 'count', steps: 'time step' },
    reproducible: true,
    notes:
      'Worlds are toroidal. Grid neighborhoods use von Neumann or Moore shells of radius r; continuous-space proximity queries use a uniform spatial binning. All stochasticity flows through a seeded mulberry32 PRNG, so batch runs are bit-reproducible for a fixed seed. Schelling agents relocate to a uniformly random empty cell drawn from a seeded shuffle; the predator-prey template follows the wolf-sheep-grass formulation (grass regrowth, energy bookkeeping, binary fission); opinion dynamics uses Deffuant bounded-confidence pairwise averaging; traffic uses the Nagel-Schreckenberg four-step update on a one-lane ring.',
    notesI18n: {
      'zh-CN':
        '世界为环形（torus）。网格邻域采用半径 r 的 von Neumann / Moore 壳层；连续空间邻近查询使用均匀空间分桶。所有随机性均由带种子的 mulberry32 随机数发生器驱动，固定种子下批量结果逐位可复现。Schelling 中不满智能体迁移至种子洗牌后的随机空格；捕食者-猎物采用 wolf-sheep-grass 形式（草再生、能量记账、二分裂繁殖）；意见动力学采用 Deffuant 有界信任对更新；交通流采用单车道环形路面上的 Nagel-Schreckenberg 四步更新。',
      'en-US':
        'Worlds are toroidal. Grid neighborhoods use von Neumann or Moore shells of radius r; continuous-space proximity queries use a uniform spatial binning. All stochasticity flows through a seeded mulberry32 PRNG, so batch runs are bit-reproducible for a fixed seed. Schelling agents relocate to a uniformly random empty cell drawn from a seeded shuffle; the predator-prey template follows the wolf-sheep-grass formulation (grass regrowth, energy bookkeeping, binary fission); opinion dynamics uses Deffuant bounded-confidence pairwise averaging; traffic uses the Nagel-Schreckenberg four-step update on a one-lane ring.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'simulation config JSON' }],
};
