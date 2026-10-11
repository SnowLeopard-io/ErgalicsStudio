import type { PluginManifest } from '@/types/plugin';

export const envPredatorPreyManifest: PluginManifest = {
  id: 'example.env-predator-prey',
  name: 'Predator–Prey (Lotka–Volterra)',
  nameI18n: { 'zh-CN': '捕食者-猎物（Lotka–Volterra）', 'en-US': 'Predator–Prey (Lotka–Volterra)' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Lotka–Volterra predator–prey model with RK4 integration, phase portrait and time series. Validates numerics against the conserved orbit invariant V = δx − γln x + βy − αln y and the linearized frequency √(αγ), and estimates α/β/γ/δ from observed series (e.g. Hudson Bay hare & lynx) by log-space linear regression.',
  descriptionI18n: {
    'zh-CN':
      'Lotka–Volterra 捕食者-猎物模型：RK4 积分、相图与时间序列。用守恒量 V = δx − γln x + βy − αln y 的漂移与线性化频率 √(αγ) 校验数值精度，并通过对数空间线性回归从观测序列（如哈德逊湾野兔-猞猁数据）估计 α/β/γ/δ。',
    'en-US':
      'Lotka–Volterra predator–prey model with RK4 integration, phase portrait and time series. Validates numerics against the conserved orbit invariant V = δx − γln x + βy − αln y and the linearized frequency √(αγ), and estimates α/β/γ/δ from observed series (e.g. Hudson Bay hare & lynx) by log-space linear regression.',
  },
  license: 'MIT',
  entry: 'example.env-predator-prey',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { population: 'individuals', rate: '1/year' },
    benchmarks: ['lv-conservation-drift', 'lv-orbit-closure', 'lv-linearized-frequency', 'lv-fit-recovery'],
    reproducible: true,
    notes:
      'Embedded validation battery: conserved-quantity drift over 10 periods < 1e-3; one-period orbit closure < 1e-3; small-orbit (1% perturbation) frequency vs √(αγ) < 5%; regression fit recovery of all four parameters < 5%. Sample data: matched Hudson\'s Bay Company annual returns of lynx and snowshoe hare, 1849-1890 (Elton & Nicholson 1942; MacLulich 1937), pre-1950 numerical data.',
    notesI18n: {
      'zh-CN':
        '内嵌验证：10 周期守恒量漂移 < 1e-3；单周期轨道闭合 < 1e-3；平衡点 1% 小扰动频率对照 √(αγ) < 5%；回归拟合四参数恢复 < 5%。示例数据：哈德逊湾公司 1849-1890 年猞猁与野兔配对年回报（Elton & Nicholson 1942；MacLulich 1937），1950 年前公开数值数据。',
      'en-US':
        'Embedded validation battery: conserved-quantity drift over 10 periods < 1e-3; one-period orbit closure < 1e-3; small-orbit (1% perturbation) frequency vs √(αγ) < 5%; regression fit recovery of all four parameters < 5%. Sample data: matched Hudson\'s Bay Company annual returns of lynx and snowshoe hare, 1849-1890 (Elton & Nicholson 1942; MacLulich 1937), pre-1950 numerical data.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'year,time + hare/prey/x + lynx/predator/y columns' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated time / prey / predator columns' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'comma/semicolon/tab-separated time, prey, predator' },
  ],
};
