import type { PluginManifest } from '@/types/plugin';

export const medBiostatManifest: PluginManifest = {
  id: 'example.med-biostat',
  name: 'Biostatistics Toolkit',
  nameI18n: { 'zh-CN': '生物统计工具箱', 'en-US': 'Biostatistics Toolkit' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    "Five-mode biostatistics workbench: sample-size and power design (superiority, non-inferiority, equivalence TOST; means and proportions), seeded randomization plans (fixed/random-length blocks, stratified blocks, Pocock-Simon minimization) with a balance chi-square, two-arm endpoint analysis (Welch t / risk difference with Fisher exact, effect sizes), O'Brien-Fleming and Pocock alpha-spending boundaries for interim monitoring, and PRR adverse-event signal screening, with CSV export and per-mode statistical readouts.",
  descriptionI18n: {
    'zh-CN':
      '五种模式的生物统计工作台：样本量与检验效能设计（优效、非劣效、等效性 TOST；均值与比例）、固定种子随机化方案（固定/随机长度区组、分层区组、Pocock-Simon 最小化）与组间均衡性卡方、两组终点分析（Welch t 检验/率差与 Fisher 精确检验、效应量）、O\'Brien-Fleming 与 Pocock α 消耗函数期中分析边界、不良事件 PRR 信号筛查；支持按模式导出 CSV 与统计指标输出。',
    'en-US':
      'Five-mode biostatistics workbench: sample-size and power design (superiority, non-inferiority, equivalence TOST; means and proportions), seeded randomization plans (fixed/random-length blocks, stratified blocks, Pocock-Simon minimization) with a balance chi-square, two-arm endpoint analysis (Welch t / risk difference with Fisher exact, effect sizes), O\'Brien-Fleming and Pocock alpha-spending boundaries for interim monitoring, and PRR adverse-event signal screening, with per-mode CSV export and statistical readouts.',
  },
  license: 'MIT',
  entry: 'example.med-biostat',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    reproducible: true,
    notes:
      'Hypothesis tests and designs are implemented with standard distributions and large-sample approximations (normal/Wald, Welch t, Pearson chi-square, Fisher exact, Lan-DeMets alpha spending); intended for teaching and trial-protocol drafting, not as a basis for clinical decisions.',
    notesI18n: {
      'zh-CN':
        '检验与设计基于标准分布/大样本近似实现（正态/Wald 近似、Welch t、Pearson 卡方、Fisher 精确检验、Lan-DeMets α 消耗函数），供教学与试验方案设计使用，非临床决策依据。',
      'en-US':
        'Hypothesis tests and designs are based on standard distributions and large-sample approximations (normal/Wald, Welch t, Pearson chi-square, Fisher exact, Lan-DeMets alpha spending); for teaching and trial-protocol design only, not a basis for clinical decisions.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:b4c5b02139f0dd386dde3b8fe91cf966',
    sig: '6a6958831280b125bec62287e5a1a30b024fa918221c255f1376d4b39d2d549ef7afa9b10b34d54aba9691f471a454f374be2f5822d80a0e5a9eb9c20edc8203',
    signer: 'Ergalics Studio (med pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '25f660c62a9e6bb7d3108bb59667b99d49f7fa2a60df6308361226303a751e55',
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'arm,endpoint[,endpoint_secondary,event,age] trial table / treatment,event,cases,n AE counts' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated tables with the same columns' },
  ],
};
