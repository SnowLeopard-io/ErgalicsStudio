import type { PluginManifest } from '@/types/plugin';

export const bioEpidemicManifest: PluginManifest = {
  id: 'example.bio-epidemic',
  name: 'Epidemic Modeling',
  nameI18n: { 'zh-CN': '传染病分室模型', 'en-US': 'Epidemic Modeling' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Deterministic SIR / SEIR compartment epidemics integrated by classical RK4, with R₀, herd-immunity threshold, peak timing and attack-rate reporting.',
  descriptionI18n: {
    'zh-CN':
      '确定性 SIR / SEIR 分室传染病模型，用经典 RK4 积分，输出 R₀、群体免疫阈值、感染峰值时刻与总感染率等流行病学指标，可对比 SIR 与 SEIR、改变 R₀/潜伏期/接触模式。',
    'en-US':
      'Deterministic SIR / SEIR compartment epidemics integrated by classical RK4, reporting R₀, the herd-immunity threshold, peak timing, and the cumulative attack rate — compare SIR vs SEIR and vary R₀, latent/ infectious periods and population.',
  },
  license: 'MIT',
  entry: 'example.bio-epidemic',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { time: 'd', population: 'persons' },
    reproducible: true,
    notes:
      'Deterministic compartment simulator with conservation / final-size diagnostics; the early-growth R_t uses the SIR log-slope approximation and is model-based, not a statistical fit to incidence data. The multi-region mode integrates coupled per-region SEIR with symmetric migration (gravity or manual matrix) and optional age structure; Rt from data uses the Cori et al. (2013) Bayesian sliding window with a Gamma(1,5) prior and a discretized Gamma serial interval.',
    notesI18n: {
      'zh-CN':
        '确定性分室模型模拟器，含守恒与终局关系诊断；早期增长 R_t 采用 SIR 对数斜率近似，输出为模型推导量而非对疫情数据的统计拟合。多区域模式以对称迁移（重力模型或手动矩阵）耦合各区独立 SEIR 方程并支持年龄结构；数据 Rt 估计采用 Cori et al. (2013) 贝叶斯滑窗（Γ(1,5) 先验、Γ 世代间隔按天离散化）。',
      'en-US':
        'Deterministic compartment simulator with conservation / final-size diagnostics; the early-growth R_t uses the SIR log-slope approximation and is model-based, not a statistical fit to incidence data. The multi-region mode couples per-region SEIR systems through symmetric migration (gravity or manual matrix) with optional age structure; Rt from data uses the Cori et al. (2013) Bayesian sliding window (Gamma(1,5) prior, discretized Gamma serial interval).',
    },
  },
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'model config JSON' },
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'daily new / cumulative case counts (day, cases)' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'daily case counts (day \\t cases)' },
    { extension: '.dat', mimeTypes: ['text/plain'], description: 'daily case counts (whitespace columns)' },
  ],
};