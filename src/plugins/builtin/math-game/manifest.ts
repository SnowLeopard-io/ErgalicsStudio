// ==========================================================================
// math-game — Game Theory Lab — manifest
//
// Manifest-only module: `builtin/index.ts` imports this file statically while
// the implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mathGameManifest: PluginManifest = {
  id: 'example.math-game',
  name: 'Game Theory Lab',
  nameI18n: { 'zh-CN': '博弈论实验室', 'en-US': 'Game Theory Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Game theory laboratory: n×n payoff-matrix editing with best-response and iterated-dominance analysis, pure Nash by mutual best response plus closed-form 2×2 and support-enumeration mixed equilibria, RK4 replicator dynamics with phase portraits and ESS tests, extensive-form game trees solved by backward induction, and reproducible first-price / second-price / English-clock auction simulations with VCG revenue and incentive-compatibility metrics.',
  descriptionI18n: {
    'zh-CN':
      '博弈论实验室：n×n 收益矩阵编辑与最佳响应/迭代优势剔除分析，纯策略纳什（相互最佳响应枚举）加 2×2 闭式与支持枚举混合均衡，RK4 复制者动态相图与 ESS 判定，扩展式博弈树逆向归纳求子博弈精炼均衡，以及可复现的一价/二价/英式钟表拍卖模拟与 VCG 收益、激励相容指标。',
    'en-US':
      'Game theory laboratory: n×n payoff-matrix editing with best-response and iterated-dominance analysis, pure Nash by mutual best response plus closed-form 2×2 and support-enumeration mixed equilibria, RK4 replicator dynamics with phase portraits and ESS tests, extensive-form game trees solved by backward induction, and reproducible first-price / second-price / English-clock auction simulations with VCG revenue and incentive-compatibility metrics.',
  },
  license: 'MIT',
  entry: 'example.math-game',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'educational',
    benchmarks: ['game-benchmarks'],
    reproducible: true,
    notes:
      'Benchmarks: (1) Prisoner\u2019s Dilemma unique pure equilibrium (Defect, Defect); (2) Matching Pennies mixed equilibrium (1/2, 1/2); (3) Hawk\u2013Dove mixed equilibrium p = V/C = 1/3; (4) single-population replicator dynamics converges to the Hawk\u2013Dove ESS x* = 1/3; (5) second-price auction revenue equals the second-highest valuation (relErr = 0); (6) no-profitable-deviation gap at a computed equilibrium. Auction draws use a seeded mulberry32 RNG (reproducible). Unified error metric |computed \u2212 analytic|/|analytic| (denominator floored at 1 when the analytic target is 0).',
    notesI18n: {
      'zh-CN':
        '验证基准：① 囚徒困境唯一纯策略均衡（背叛, 背叛）；② 匹配硬币混合均衡 (1/2, 1/2)；③ 鹰鸽博弈混合均衡 p = V/C = 1/3；④ 单群体复制者动态收敛到鹰鸽 ESS x* = 1/3；⑤ 二价拍卖收益 = 第二高估值（relErr = 0）；⑥ 计算均衡处的无偏离间隙。拍卖抽样采用带种子的 mulberry32 随机数（可复现）。统一相对误差口径 |计算−解析|/|解析|（解析目标为 0 时分母下限取 1）。',
      'en-US':
        'Benchmarks: (1) Prisoner\u2019s Dilemma unique pure equilibrium (Defect, Defect); (2) Matching Pennies mixed equilibrium (1/2, 1/2); (3) Hawk\u2013Dove mixed equilibrium p = V/C = 1/3; (4) single-population replicator dynamics converges to the Hawk\u2013Dove ESS x* = 1/3; (5) second-price auction revenue = second-highest valuation (relErr = 0); (6) no-profitable-deviation gap at a computed equilibrium. Auction draws use a seeded mulberry32 RNG (reproducible). Unified metric |computed \u2212 analytic|/|analytic| (denominator floored at 1 when the analytic target is 0).',
    },
  },
};
