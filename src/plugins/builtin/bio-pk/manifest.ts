// ==========================================================================
// bio-pk — pharmacokinetic compartment analysis — manifest
//
// One-/two-compartment PK models (IV bolus & first-order oral) with RK4
// integration validated against closed-form solutions and an AUC mass-
// conservation anchor. Therapeutic-window overlay for MEC/MSC reading.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const bioPkManifest: PluginManifest = {
  id: 'example.bio-pk',
  name: 'Pharmacokinetics',
  nameI18n: { 'zh-CN': '药代动力学室分析', 'en-US': 'Pharmacokinetics' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Compartment pharmacokinetics: one-/two-compartment models with IV bolus and first-order oral dosing, RK4 integration validated against closed-form solutions, therapeutic-window (MEC/MSC) overlay and AUC/Cmax/Tmax/t½ reporting.',
  descriptionI18n: {
    'zh-CN':
      '药代动力学室模型：一室/二室、静脉推注与口服一级吸收，RK4 数值解与解析解对拍验证，治疗窗（MEC/MSC）叠加，输出 Cmax、Tmax、t½ 与 AUC 数值/解析对比。',
    'en-US':
      'Compartment PK models: one-/two-compartment with IV bolus and first-order oral absorption, RK4 numerics cross-checked against closed forms, therapeutic-window overlay, and Cmax/Tmax/t½/AUC reporting with numeric-vs-analytic error.',
  },
  license: 'MIT',
  entry: 'example.bio-pk',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { dose: 'mg', volume: 'L', rate: '1/h', concentration: 'mg/L', time: 'h', auc: 'mg·h/L' },
    benchmarks: ['pk-numeric-vs-analytic', 'pk-auc-conservation'],
    reproducible: true,
    notes:
      'RK4 solver verified against mono-/bi-/tri-exponential closed forms and the D/(ke·Vd) AUC mass-balance anchor. Default parameters are literature-scaled theophylline-like values (Vd≈0.5 L/kg, ke≈0.1 h⁻¹, window 10–20 mg/L) for demonstration only, not clinical advice.',
    notesI18n: {
      'zh-CN':
        'RK4 数值解经单指数/双指数/三指数解析解与 AUC=D/(ke·Vd) 质量守恒基准验证（统一相对误差口径）。默认参数为按文献量级缩放的茶碱类演示值（Vd≈0.5 L/kg、ke≈0.1 h⁻¹、治疗窗 10–20 mg/L），仅作演示，非临床建议。',
      'en-US':
        'RK4 solver verified against mono-/bi-/tri-exponential closed forms and the D/(ke·Vd) AUC mass-balance anchor (unified relative-error metric). Defaults are literature-scaled theophylline-like demo values (Vd≈0.5 L/kg, ke≈0.1 h⁻¹, window 10–20 mg/L); demonstration only, not clinical advice.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'time,concentration sampled profile (optional overlay)' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated time / concentration columns' },
  ],
};
