// ==========================================================================
// eng-heat — heat transfer laboratory — manifest
//
// Five coupled heat-transfer workbenches: steady conduction (composite-wall
// resistance chain, 2-D SOR Laplace solver, explicit FTCS transient with the
// r ≤ 1/2 gate), convection (Dittus–Boelter / Gnielinski forced-turbulent and
// Churchill–Chu natural-convection Nusselt correlations), radiation
// (Stefan–Boltzmann / Wien / Planck spectra, gray two-surface enclosure
// network, combined convection+radiation), heat exchangers (LMTD and ε-NTU
// methods with mutual cross-validation) and 1-D thermal-resistance networks
// (Kirchhoff-balanced nodal solve). Validation documented in
// tests/eng-heat.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engHeatManifest: PluginManifest = {
  id: 'example.eng-heat',
  name: 'Heat Transfer Lab',
  nameI18n: { 'zh-CN': '传热分析实验室', 'en-US': 'Heat Transfer Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Heat-transfer workbench: composite-wall resistance chains, 2-D SOR isotherm fields and FTCS transients (r ≤ 1/2 gate), Dittus–Boelter / Gnielinski / Churchill–Chu Nusselt correlations, blackbody–Planck–Wien radiation with gray two-surface enclosure networks, LMTD ↔ ε-NTU exchanger cross-validation and Kirchhoff-balanced resistance networks.',
  descriptionI18n: {
    'zh-CN':
      '传热分析工作台：复合壁串联热阻、二维 SOR 等温线场与 FTCS 瞬态（r ≤ 1/2 稳定性校验）、Dittus–Boelter / Gnielinski / Churchill–Chu 努塞尔数关联式、黑体 Stefan–Boltzmann / Wien / 普朗克谱与灰体两表面封闭腔辐射网络、换热器 LMTD ↔ ε-NTU 双法互验，以及 Kirchhoff 平衡的一维热阻网络。',
    'en-US':
      'Heat-transfer workbench: composite-wall resistance chains, 2-D SOR isotherm fields and FTCS transients (r ≤ 1/2 gate), Dittus–Boelter / Gnielinski / Churchill–Chu Nusselt correlations, blackbody–Planck–Wien radiation with gray two-surface enclosure networks, LMTD ↔ ε-NTU exchanger cross-validation and Kirchhoff-balanced resistance networks.',
  },
  license: 'MIT',
  entry: 'example.eng-heat',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [{ extension: '.csv', mimeTypes: ['text/csv'], description: 'wall / exchanger parameter rows: L,k,A,T_hot,T_cold or th_in,th_out,tc_in,tc_out,ch,cc,ua' }],
  research: {
    tier: 'research',
    units: { length: 'm', temperature: 'K', power: 'W', resistance: 'K/W', coefficient: 'W/(m2·K)' },
    benchmarks: [
      'eng-heat-composite-wall',
      'eng-heat-sor-separation-of-variables',
      'eng-heat-ftcs-stability-gate',
      'eng-heat-forced-convection',
      'eng-heat-natural-convection',
      'eng-heat-blackbody-wien',
      'eng-heat-view-factor',
      'eng-heat-lmtd-eps-ntu',
      'eng-heat-network-kirchhoff',
    ],
    reproducible: true,
    notes:
      'Fully deterministic, purely analytic/iterative numeric core (no randomness, no I/O). Benchmarks (unified yardstick |computed − reference|/|reference|): composite-wall heat flow vs the series-resistance closed form (machine precision); SOR Laplace field vs the separation-of-variables series T = sin(πx/a)·sinh(πy/a)/sinh(πb/a) (< 0.5 %); FTCS transient vs the Fourier-series slab solution and the classic von Neumann r = α·Δt/Δx² ≤ 1/2 gate (summed over axes in 2-D); Dittus–Boelter Nu = 0.023·Re^0.8·Pr^n and Gnielinski with the Petukhov friction factor cross-checked at Re = 10⁴, Pr = 5 (< 1 %); Churchill–Chu vertical-plate / horizontal-cylinder h in the accepted physical range for air; Stefan–Boltzmann σT⁴ and Wien λmax·T = 2897.77 µm·K; parallel-plate F12 = 1 and coaxial-disk F12 = (3−√5)/2 at R_i = R_j = 1; LMTD ↔ ε-NTU mutual agreement (< 0.1 %) for counter/parallel flow; resistance-network Kirchhoff residuals (< 1e-9). Correlations per Incropera, DeWitt, Bergman & Lavine, "Fundamentals of Heat and Mass Transfer" (Tables 8.4, 11.4, 13.1; Churchill & Chu 1975).',
    notesI18n: {
      'zh-CN':
        '完全确定性的纯解析/迭代数值核（无随机数、无 I/O）。基准（统一相对误差口径 |计算−参考|/|参考|）：复合壁热流对串联热阻闭式解（机器精度）；SOR 拉普拉斯场对分离变量级数 T = sin(πx/a)·sinh(πy/a)/sinh(πb/a)（< 0.5%）；FTCS 瞬态对傅里叶级数平板解，及经典 von Neumann r = α·Δt/Δx² ≤ 1/2 稳定性门槛（二维按轴向求和）；Dittus–Boelter Nu = 0.023·Re^0.8·Pr^n 与带 Petukhov 摩擦因子的 Gnielinski 在 Re = 10⁴、Pr = 5 处互检（< 1%）；Churchill–Chu 竖壁 / 水平圆筒空气 h 落在公认物理区间；Stefan–Boltzmann σT⁴ 与 Wien λmax·T = 2897.77 µm·K；平行板 F12 = 1、同轴圆盘 R_i = R_j = 1 时 F12 = (3−√5)/2；LMTD ↔ ε-NTU 互验（< 0.1%，顺流/逆流）；热阻网络 Kirchhoff 残差（< 1e-9）。关联式出自 Incropera、DeWitt、Bergman & Lavine《Fundamentals of Heat and Mass Transfer》（表 8.4、11.4、13.1；Churchill & Chu 1975）。',
      'en-US':
        'Fully deterministic, purely analytic/iterative numeric core (no randomness, no I/O). Benchmarks (unified yardstick |computed − reference|/|reference|): composite-wall heat flow vs the series-resistance closed form (machine precision); SOR Laplace field vs the separation-of-variables series (< 0.5 %); FTCS transient vs the Fourier-series slab solution and the von Neumann r ≤ 1/2 gate; Dittus–Boelter / Gnielinski cross-check at Re = 10⁴, Pr = 5 (< 1 %); Churchill–Chu h in the accepted physical range for air; Stefan–Boltzmann σT⁴ and Wien λmax·T = 2897.77 µm·K; parallel-plate F12 = 1 and coaxial-disk F12 = (3−√5)/2 at R_i = R_j = 1; LMTD ↔ ε-NTU mutual agreement (< 0.1 %) for counter/parallel flow; resistance-network Kirchhoff residuals (< 1e-9). Correlations per Incropera, DeWitt, Bergman & Lavine (Tables 8.4, 11.4, 13.1; Churchill & Chu 1975).',
    },
  },
};
