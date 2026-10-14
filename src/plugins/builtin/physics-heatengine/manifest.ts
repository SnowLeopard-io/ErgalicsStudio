// ==========================================================================
// Heat-engine p-V laboratory plugin — manifest
//
// Quasi-static ideal-gas cycles (Otto, Diesel, Carnot, Stirling) evaluated
// by trapezoid integration of the closed p dV path, with the thermal
// efficiency cross-checked against the closed forms for each cycle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const heatEngineManifest: PluginManifest = {
  id: 'example.physics-heatengine',
  name: 'Heat Engine Cycles',
  nameI18n: { 'zh-CN': '热机循环 p-V 分析台', 'en-US': 'Heat Engine Cycles' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Research-grade p-V laboratory for ideal-gas heat engines: Otto, Diesel, Carnot and (regenerative) Stirling cycles integrated quasi-statically with the trapezoid rule (1500 samples per branch, uniform in ln V), branch-by-branch heat Q = dU + W, thermal efficiency cross-checked against the closed forms, and a first-law closure diagnostic.',
  descriptionI18n: {
    'zh-CN':
      '科研级理想气体热机 p-V 实验台：奥托、迪塞尔、卡诺与（回热）斯特林循环按准静态路径用梯形法积分 ∮p dV（每支 1500 个 ln V 均匀采样），逐支按 Q = ΔU + W 记账，热效率 η = W/Q_in 与闭式公式对拍，并给出第一定律闭合残差诊断。',
    'en-US':
      'Research-grade p-V laboratory for ideal-gas heat engines: Otto, Diesel, Carnot and (regenerative) Stirling cycles integrated quasi-statically with the trapezoid rule (1500 samples per branch, uniform in ln V), branch-by-branch heat Q = dU + W, thermal efficiency cross-checked against the closed forms, and a first-law closure diagnostic.',
  },
  license: 'MIT',
  entry: 'example.physics-heatengine',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    units: { pressure: 'Pa', volume: 'm^3', temperature: 'K', work: 'J', heat: 'J' },
    benchmarks: ['otto-efficiency-1-r-1-gamma', 'diesel-cutoff-formula', 'carnot-1-tc-over-th', 'stirling-regenerator', 'first-law-closure'],
    reproducible: true,
    notes:
      'Numerical benchmarks (unified relative error |calc-analytic|/|analytic|): Otto r = 8, gamma = 1.4 gives eta = 1 - r^(1-gamma) = 0.56473 within 1e-4; Diesel r = 8, rc = 2, gamma = 1.4 gives eta = 1 - r^(1-gamma) (rc^gamma - 1)/(gamma(rc-1)) = 0.49043 within 1e-4; Carnot reproduces eta = 1 - Tc/Th with W = nR(Th - Tc) ln r and Q_in = nR Th ln r within 1e-6; Stirling with a perfect regenerator reaches eta = 1 - Tc/Th within 1e-6 and without regeneration matches W / (nR Th ln r + n c_v (Th - Tc)); the first-law closure W - sum(Q) over every branch stays at machine-precision level. Integration: composite trapezoid on p dV with 1500 samples per branch uniform in ln V (adiabatic branches exchange no heat by definition; their quadrature residual is excluded from Q_in/Qout). Textbook reference: Cengel & Boles, Thermodynamics: An Engineering Approach; S. Carnot (1824).',
    notesI18n: {
      'zh-CN':
        '数值基准（统一相对误差口径 |计算-解析|/|解析|）：奥托循环 r=8、γ=1.4 时 η = 1−r^(1−γ) = 0.56473（误差 <1e-4）；迪塞尔循环 r=8、rc=2、γ=1.4 时 η = 1−r^(1−γ)·(rc^γ−1)/(γ(rc−1)) = 0.49043（误差 <1e-4）；卡诺循环复现 η = 1−Tc/Th，且 W = nR(Th−Tc)ln r、Q_in = nR·Th·ln r（误差 <1e-6）；斯特林循环完全回热时 η = 1−Tc/Th（误差 <1e-6），无回热时与 W/(nR·Th·ln r + n·cv·(Th−Tc)) 对拍；第一定律闭合残差 W−ΣQ 保持机器精度量级。积分方法：p dV 复合梯形公式，每支 1500 个 ln V 均匀采样（绝热支按定义不换热，其求积残差不计入 Q_in/Q_out）。出处：Çengel & Boles《Thermodynamics: An Engineering Approach》；S. Carnot (1824)。',
      'en-US':
        'Numerical benchmarks (unified relative error |calc-analytic|/|analytic|): Otto r = 8, gamma = 1.4 gives eta = 1 - r^(1-gamma) = 0.56473 within 1e-4; Diesel r = 8, rc = 2, gamma = 1.4 gives eta = 1 - r^(1-gamma) (rc^gamma - 1)/(gamma(rc-1)) = 0.49043 within 1e-4; Carnot reproduces eta = 1 - Tc/Th with W = nR(Th - Tc) ln r and Q_in = nR Th ln r within 1e-6; Stirling with a perfect regenerator reaches eta = 1 - Tc/Th within 1e-6 and without regeneration matches W / (nR Th ln r + n c_v (Th - Tc)); the first-law closure W - sum(Q) over every branch stays at machine-precision level. Integration: composite trapezoid on p dV with 1500 samples per branch uniform in ln V (adiabatic branches exchange no heat by definition; their quadrature residual is excluded from Q_in/Qout). Textbook reference: Cengel & Boles, Thermodynamics: An Engineering Approach; S. Carnot (1824).',
    },
  },
};
