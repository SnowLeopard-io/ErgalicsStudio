// ==========================================================================
// econ-evogame — spatial prisoner's dilemma (Nowak-May), manifest
//
// Deterministic 2-D lattice evolution: cooperation/defection strategies,
// payoffs against the 8-neighbourhood plus self, best-neighbour adoption,
// optional mutation, periodic/absorbing boundaries and sync/async updates.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const evogameManifest: PluginManifest = {
  id: 'example.econ-evogame',
  name: 'Spatial Prisoner\'s Dilemma',
  nameI18n: { 'zh-CN': '空间囚徒困境演化博弈', 'en-US': 'Spatial Prisoner\'s Dilemma' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Nowak-May spatial evolution of cooperation: a 2-D lattice of C/D players scoring against the 8-neighbourhood plus self (R=1, S=0, T=b, P=0), best-neighbour strategy adoption with optional mutation, periodic/absorbing boundaries and sync/async sweeps.',
  descriptionI18n: {
    'zh-CN':
      'Nowak-May 空间演化博弈：二维格子上 C/D 策略与 8 邻域+自身进行囚徒困境博弈（R=1, S=0, T=b, P=0），下一代采纳邻域最高分策略，支持策略突变、周期/吸收边界与同步/异步更新；输出合作率时间序列与空间斑图定性判据。',
    'en-US':
      'Nowak-May spatial evolutionary game: a 2-D lattice where C/D strategies play the prisoner\'s dilemma against the 8-neighbourhood plus self (R=1, S=0, T=b, P=0), the next generation adopting the highest-scoring neighbourhood strategy, with optional mutation, periodic/absorbing boundaries and sync/async sweeps; reports the cooperation-fraction time series and a qualitative spatial-pattern verdict.',
  },
  license: 'MIT',
  entry: 'example.econ-evogame',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    benchmarks: ['nowak-may-spatial-pd'],
    reproducible: true,
    notes:
      'Kernel validated against fixed points (all-C and all-D lattices are exact invariants), a hand-computed 3x3 score reference (b=1.8) and seed determinism for both update modes. Regime verdict is a qualitative classification of the final cooperation fraction, not an analytic result.',
    notesI18n: {
      'zh-CN':
        '基准：①全 C / 全 D 格子在无突变下为精确不动点（1 代后不变）；②5×5 中心 C、其余 D、b=1.8 的手工算分对照（中心=1，8 邻域=1.8，远格=0，误差 0）；③同步/异步更新固定种子完全确定性。出处：Nowak & May (1992) Nature 359:826–829「Evolutionary games and spatial chaos」。斑图判据为末代合作率的定性分类，非解析结果。',
      'en-US':
        'Benchmarks: (1) all-C and all-D lattices are exact fixed points without mutation (invariance after 1 generation); (2) hand-computed 5x5 reference with a central C among D at b=1.8 (centre scores 1, its 8 neighbours 1.8, far cells 0, zero error); (3) full determinism of sync/async sweeps under a fixed seed. Source: Nowak & May (1992) Nature 359:826-829, "Evolutionary games and spatial chaos". The pattern verdict is a qualitative classification of the final cooperation fraction, not an analytic result.',
    },
  },
};
