// Survival Analysis — Kaplan-Meier, log-rank and Cox proportional hazards.
import type { PluginManifest } from '@/types/plugin';

export const statsSurvivalManifest: PluginManifest = {
  id: 'example.stats-survival',
  name: 'Survival Analysis',
  nameI18n: { 'zh-CN': '生存分析', 'en-US': 'Survival Analysis' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Right-censored survival analysis: Kaplan-Meier curves with Greenwood variance and log-log confidence bands, the k-sample log-rank test, and a Cox proportional-hazards fit (Breslow ties, Newton-Raphson) with hazard ratios and Harrell concordance.',
  descriptionI18n: {
    'zh-CN':
      '右删失生存分析：Kaplan-Meier 曲线（Greenwood 方差与 log-log 置信带）、k 样本 log-rank 检验，以及 Cox 比例风险模型（Breslow 结处理、Newton-Raphson）并给出风险比与 Harrell 一致性指数。',
    'en-US':
      'Right-censored survival analysis: Kaplan-Meier curves with Greenwood variance and log-log confidence bands, the k-sample log-rank test, and a Cox proportional-hazards fit (Breslow ties, Newton-Raphson) with hazard ratios and Harrell concordance.',
  },
  license: 'MIT',
  entry: 'example.stats-survival',
  category: 'scientific',
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['km-hand-product', 'logrank-computable', 'cox-hr-recovery'],
    notes:
      'Cox fits assume proportional hazards and independent censoring; no time-varying covariates or stratified baselines are modelled. Ties use the Breslow approximation.',
    notesI18n: {
      'zh-CN': 'Cox 模型假设比例风险与独立删失；未建模时变协变量或分层基线。结值采用 Breslow 近似。',
      'en-US':
        'Cox fits assume proportional hazards and independent censoring; no time-varying covariates or stratified baselines are modelled. Ties use the Breslow approximation.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'time,event[,group][,covariates] table' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'same table, tab separated' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '0e16fabc4bbd424cf5e3f237f148da563f68359c1c34945265a0fad771fee6834217d3e1bd33772ee4cd0f72375a3749264445dd8b71f368d1cd2a2bd3283b09',
    signer: 'Ergalics Studio (stats pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
