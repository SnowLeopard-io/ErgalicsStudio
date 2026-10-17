// ==========================================================================
// Reaction-order determination & Arrhenius analysis plugin — manifest
//
// Integrated-method order screening (zero/first/second linearisations,
// OLS R² comparison), a successive-half-life cross-check and an Arrhenius
// ln k vs 1/T fit, all from self-implemented least squares on pure kernels.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const chemReactionOrderManifest: PluginManifest = {
  id: 'example.chem-reaction-order',
  name: 'Reaction Order & Arrhenius',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Reaction-order determination by the integrated method ([A], ln[A], 1/[A] linearisations with OLS R² screening), successive-half-life cross-check (t½ ∝ [A]₀^(1−n)), and Arrhenius ln k vs 1/T regression for Ea and A, with slope standard errors.',
  nameI18n: {
    'zh-CN': '反应级数判定与 Arrhenius 分析',
    'en-US': 'Reaction Order & Arrhenius',
  },
  descriptionI18n: {
    'zh-CN':
      '积分法判定反应级数：对 [A]–t 数据分别做零级/一级/二级线性化（自实现最小二乘），按 R² 选出最优级数并给出速率常数 k ± σ；半衰期法（t½ ∝ [A]₀^(1−n)）交叉验证；Arrhenius：ln k–1/T 线性回归回收活化能 Ea ± σ 与指前因子 A。',
    'en-US':
      'Integrated-method order determination: zero/first/second linearisations of [A]–t data (self-implemented OLS), best order selected by R² with rate constant k ± σ; successive-half-life cross-check (t½ ∝ [A]₀^(1−n)); Arrhenius ln k vs 1/T regression recovers Ea ± σ and the pre-exponential factor A.',
  },
  license: 'MIT',
  entry: 'example.chem-reaction-order',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { time: 's', concentration: 'mol/L', rateConstant: 's⁻¹', ea: 'kJ/mol', temperature: 'K' },
    benchmarks: ['reaction-order-first-benchmark', 'reaction-order-second-benchmark', 'arrhenius-ea-recovery'],
    reproducible: true,
    notes:
      'Self-implemented OLS kernels with slope standard errors; order screening by R² over the three integrated rate laws with a successive-half-life cross-check. Embedded benchmarks recover k = 0.0231 min⁻¹ (first order), k = 0.5 L/(mol·min) (second order) and Ea = 50 kJ/mol from seeded synthetic data. The bundled N₂O₅ sample is synthesised from the literature rate constant (first order, k ≈ 3.46×10⁻³ s⁻¹ near 315 °C), not a raw measurement.',
    notesI18n: {
      'zh-CN':
        '自实现最小二乘内核（含斜率标准误）；积分法三级数 R² 筛选 + 逐段半衰期交叉验证。内嵌基准从固定种子合成数据回收 k=0.0231 min⁻¹（一级）、k=0.5 L/(mol·min)（二级）与 Ea=50 kJ/mol。内置 N₂O₅ 样例按文献速率常数合成（一级，315 °C 附近 k≈3.46×10⁻³ s⁻¹），非原始测量数据。',
      'en-US':
        'Self-implemented OLS kernels with slope standard errors; order screening by R² over the three integrated rate laws with a successive-half-life cross-check. Embedded benchmarks recover k = 0.0231 min⁻¹ (first order), k = 0.5 L/(mol·min) (second order) and Ea = 50 kJ/mol from seeded synthetic data. The bundled N₂O₅ sample is synthesised from the literature rate constant (first order, k ≈ 3.46×10⁻³ s⁻¹ near 315 °C), not a raw measurement.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 't,c concentration–time or T,k Arrhenius CSV' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated two-column table' },
    { extension: '.dat', mimeTypes: ['text/plain'], description: 'whitespace-separated two-column table' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'plain two-column text' },
  ],
};
