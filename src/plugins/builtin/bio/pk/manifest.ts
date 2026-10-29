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
  version: '1.1.0',
  author: 'Ergalics',
  description:
    'Compartment pharmacokinetics in four workbench modes: standard one-/two-compartment profiles (IV bolus, IV infusion, first-order oral with bioavailability F) validated against closed forms; population PK/PD via seeded lognormal Monte Carlo with P5-P95 bands; drug-interaction AUC-ratio comparison; and dosing/TDM with steady-state trough/peak/AUC, target-driven dose recommendation and one-compartment CL/V least-squares fit to imported time,conc observations. Sigmoid-Emax effect curves and therapeutic-window overlay throughout.',
  descriptionI18n: {
    'zh-CN':
      '四模式药代动力学工作台：标准一室/二室药时曲线（静脉推注/滴注/口服一级吸收，含生物利用度 F，RK4 与解析解对拍）；固定种子对数正态蒙特卡洛群体 PK/PD（P5–P95 分位带）；药物相互作用 AUC 比值对比；剂量优化/TDM（稳态谷峰/AUC、目标浓度反推剂量、time,conc 观测的一室 CL/V 最小二乘拟合）。全程支持 sigmoid-Emax 效应-时间曲线与治疗窗叠加。',
    'en-US':
      'Four-mode PK workbench: standard one-/two-compartment profiles (IV bolus, infusion, oral with bioavailability F; RK4 cross-checked against closed forms); seeded lognormal Monte-Carlo population PK/PD with P5-P95 quantile bands; DDI AUC-ratio comparison; and dosing/TDM with steady-state trough/peak/AUC, target-driven dose recommendation and one-compartment CL/V least-squares fit to imported time,conc observations. Sigmoid-Emax effect curves and therapeutic-window overlay throughout.',
  },
  license: 'MIT',
  entry: 'example.bio-pk',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { dose: 'mg', volume: 'L', rate: '1/h', concentration: 'mg/L', time: 'h', auc: 'mg·h/L' },
    benchmarks: ['pk-numeric-vs-analytic', 'pk-auc-conservation', 'pk-ss-superposition', 'pk-tdm-fit'],
    reproducible: true,
    notes:
      'RK4 solver verified against mono-/bi-/tri-exponential closed forms and the D/(ke·Vd) AUC mass-balance anchor. Steady state uses linear superposition of the closed-form single dose; population sampling is a seeded mulberry32 + Box-Muller lognormal (mean-preserving); TDM fitting is ordinary least squares via Nelder-Mead. Default parameters are literature-scaled theophylline-like values (Vd≈0.5 L/kg, ke≈0.1 h⁻¹, window 10–20 mg/L) for demonstration only, not clinical advice.',
    notesI18n: {
      'zh-CN':
        'RK4 数值解经单指数/双指数/三指数解析解与 AUC=D/(ke·Vd) 质量守恒基准验证（统一相对误差口径）。稳态由单剂量解析解的线性叠加精确给出；群体抽样为固定种子 mulberry32+Box-Muller 均值保持对数正态；TDM 为 Nelder-Mead 普通最小二乘拟合。默认参数为按文献量级缩放的茶碱类演示值（Vd≈0.5 L/kg、ke≈0.1 h⁻¹、治疗窗 10–20 mg/L），仅作演示，非临床建议。',
      'en-US':
        'RK4 solver verified against mono-/bi-/tri-exponential closed forms and the D/(ke·Vd) AUC mass-balance anchor (unified relative-error metric). Steady state is the exact linear superposition of the closed-form single dose; population sampling is a seeded, mean-preserving mulberry32 + Box-Muller lognormal; TDM uses ordinary least squares via Nelder-Mead. Defaults are literature-scaled theophylline-like demo values (Vd≈0.5 L/kg, ke≈0.1 h⁻¹, window 10–20 mg/L); demonstration only, not clinical advice.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'time,conc observation series (TDM fit; optional subject column) or sampled profile (optional overlay)' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated time / concentration columns' },
  ],
};
