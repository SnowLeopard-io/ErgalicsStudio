// ==========================================================================
// astro-transit — exoplanet transit light-curve fitting — manifest
//
// Loads a stellar light curve (time, flux[, err]), detects the transit
// period with a simplified BLS grid search, refines the trapezoid transit
// parameters (P, T0, δ, T14, T23, baseline) with Levenberg-Marquardt, and
// reports P/T0/δ with 1σ errors plus the uniform-disc radius ratio √δ.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const astroTransitManifest: PluginManifest = {
  id: 'example.astro-transit',
  name: 'Exoplanet Transit Fitting',
  nameI18n: { 'zh-CN': '凌星系外行星光变拟合', 'en-US': 'Exoplanet Transit Fitting' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Transit light-curve workbench: simplified-BLS period detection, Levenberg-Marquardt trapezoid-model fitting (P, T0, depth, T14, T23, baseline) with 1σ errors, phase folding and the uniform-disc radius ratio √δ.',
  descriptionI18n: {
    'zh-CN':
      '凌星光变工作台：简化 BLS 周期检测 + Levenberg-Marquardt 梯形模型拟合（P、T0、深度、T14、T23、基线），输出 1σ 参数误差、相位折叠图与均匀圆盘半径比 √δ。',
    'en-US':
      'Transit light-curve workbench: simplified-BLS period detection + Levenberg-Marquardt trapezoid fit (P, T0, depth, T14, T23, baseline) with 1σ errors, phase folding and the uniform-disc radius ratio √δ.',
  },
  license: 'MIT',
  entry: 'example.astro-transit',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { time: 'd', period: 'd', depth: 'fraction', radiusRatio: 'Rp/Rs' },
    benchmarks: ['trapezoid-recovery-benchmark'],
    reproducible: true,
    notes:
      'Validation: seeded synthetic trapezoid light curve (P=3.0 d, T0=0.5 d, δ=0.01, T14=0.15 d, τ=0.05 d, 300 points over 3 periods, noise = 1% of depth) is recovered blind with relative errors <0.5% (P) and <10% (δ); the trapezoid identity T23 = T14 − 2τ holds to <1e-9. Bundled example data is synthesized at the published HD 209458 b transit parameters (P=3.52474859 d, depth=1.500%, T14=3.072 h, Rp/Rs=0.1209) from the NASA Exoplanet Archive (ps table, queried 2026-10-11). The trapezoid model is approximate (no limb darkening); τ is degenerate for sparse in-transit sampling.',
    notesI18n: {
      'zh-CN':
        '验证基准：固定种子合成梯形光变（P=3.0 d、T0=0.5 d、δ=0.01、T14=0.15 d、τ=0.05 d，300 点覆盖 3 周期，噪声=深度的 1%）盲测回收，统一相对误差 P<0.5%、δ<10%；梯形恒等式 T23=T14−2τ 保持 <1e-9。内置示例数据按 NASA Exoplanet Archive 公开发表的 HD 209458 b 凌星参数（P=3.52474859 d、深度=1.500%、T14=3.072 h、Rp/Rs=0.1209）合成（2026-10-11 查询 ps 表）。梯形模型为近似（无临边昏暗），稀疏采样下入/出射时长 τ 存在简并。',
      'en-US':
        'Validation: seeded synthetic trapezoid light curve (P=3.0 d, T0=0.5 d, δ=0.01, T14=0.15 d, τ=0.05 d, 300 points over 3 periods, noise = 1% of depth) is recovered blind with relative errors <0.5% (P) and <10% (δ); the trapezoid identity T23 = T14 − 2τ holds to <1e-9. Bundled example data is synthesized at the published HD 209458 b transit parameters (P=3.52474859 d, depth=1.500%, T14=3.072 h, Rp/Rs=0.1209) from the NASA Exoplanet Archive (ps table, queried 2026-10-11). The trapezoid model is approximate (no limb darkening); τ is degenerate for sparse in-transit sampling.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'time,flux[,err] light curve' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated time, flux[, err]' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace time, flux[, err] columns' },
  ],
};
