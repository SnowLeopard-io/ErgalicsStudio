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
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'model config JSON' }],
};