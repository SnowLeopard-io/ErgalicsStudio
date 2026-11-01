// ==========================================================================
// eng-vibration — structural vibration analysis laboratory — manifest
//
// SDOF/MDOF vibration laboratory. Free decay (fixed-step RK4 vs the exact
// closed form), analytic harmonic amplitude/phase response with half-power
// identification of zeta and wn, generalized Jacobi eigenanalysis of spring
// chains and simply supported beams (mass-normalized modes, Rayleigh damping,
// modal-superposition harmonic response), base-isolation transmissibility and
// rotating-unbalance orbits. Validation documented in tests/eng-vibration.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engVibrationManifest: PluginManifest = {
  id: 'example.eng-vib',
  name: 'Vibration Analysis Lab',
  nameI18n: { 'zh-CN': '振动分析实验室', 'en-US': 'Vibration Analysis Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'SDOF/MDOF vibration laboratory: RK4 free-decay vs the exact closed form, analytic amplitude/phase response with half-power identification of zeta and wn, generalized Jacobi eigenanalysis of spring chains and simply supported beams (mass-normalized modes, Rayleigh damping, modal-superposition FRF), base-isolation transmissibility (T(sqrt2) = 1 boundary, T_max ~ 1/(2*zeta)) and rotating-unbalance orbits (exact 1/(2*zeta) peak, exact 90 deg resonance phase).',
  descriptionI18n: {
    'zh-CN':
      '单/多自由度振动实验室：RK4 自由衰减与精确闭式解对照，解析幅频/相频与半功率法识别 ζ、ωn；广义 Jacobi 特征值求解弹簧链与简支梁的固有频率与振型（质量归一），Rayleigh 阻尼与模态叠加频响；隔振传递率（T(√2)=1 分界、峰值 ≈ 1/(2ζ)）与旋转不平衡轴心轨迹（峰值精确 1/(2ζ)、共振相位精确 90°）。',
    'en-US':
      'SDOF/MDOF vibration laboratory: RK4 free-decay vs the exact closed form, analytic amplitude/phase response with half-power identification of zeta and wn, generalized Jacobi eigenanalysis of spring chains and simply supported beams (mass-normalized modes, Rayleigh damping, modal-superposition FRF), base-isolation transmissibility (T(sqrt2) = 1 boundary, T_max ~ 1/(2*zeta)) and rotating-unbalance orbits (exact 1/(2*zeta) peak, exact 90 deg resonance phase).',
  },
  license: 'MIT',
  entry: 'example.eng-vib',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'Parameter table (columns m,k[,c]) or frequency-sweep data (w/frequency + amp/magnitude[, phase])',
    },
  ],
  research: {
    tier: 'research',
    units: { time: 's', frequency: 'rad/s', mass: 'kg', stiffness: 'N/m', damping: 'N*s/m', displacement: 'm' },
    benchmarks: [
      'eng-vib-sdof-rk4-vs-exact',
      'eng-vib-sdof-half-power',
      'eng-vib-chain-eigen',
      'eng-vib-beam-eigen',
      'eng-vib-transmissibility-peak',
      'eng-vib-isolation-sqrt2-boundary',
      'eng-vib-unbalance-resonance',
      'eng-vib-determinism',
    ],
    reproducible: true,
    notes:
      'Pure numeric core with self-implemented cyclic Jacobi eigensolver, RK4 integration and complex arithmetic (no external numerics dependency). Benchmarks (unified yardstick |computed - analytic|/|analytic| unless stated): RK4 free decay (dt = tEnd/4800) vs the exact underdamped closed form, max relative deviation < 1e-3 (observed ~1e-8); half-power (-3 dB) identification of zeta and wn from the analytic receptance sweep, zeta error < 1% (the method itself carries an O(zeta^2) bias: ~0.5% at zeta = 0.05, ~0.08% at zeta = 0.02) and wn error < 0.1%; 3-DOF fixed-fixed chain eigenfrequencies vs 2*sqrt(k/m)*sin(n*pi/8) < 1e-9 with mass-normalized sin modes; 60-node lumped simply supported beam vs the exact discrete spectrum 4*sin^2(n*pi/(2(N+1)))*sqrt(EI/rhoA)/h^2 < 1e-9 and vs continuous beam theory (n*pi/L)^2*sqrt(EI/rhoA) < 0.5% for modes 1-3 (discretization bias 0.20% at mode 3); transmissibility peak vs 1/(2*zeta) < 1% at zeta = 0.05 (exact closed-form peak used as reference) and T(sqrt2) = 1 EXACTLY for every zeta (algebraic identity); unbalance normalized amplitude peaks at exactly 1/(2*zeta) on r = 1 with exactly 90 deg phase lag (algebraic identities).',
    notesI18n: {
      'zh-CN':
        '纯数值核：自实现循环 Jacobi 特征值求解、RK4 积分与复数运算，不依赖外部数值库。基准（统一相对误差口径 |计算−解析|/|解析|，另注明者除外）：RK4 自由衰减（dt = tEnd/4800）对比欠阻尼精确闭式解，最大相对偏差 < 1e-3（实测约 1e-8）；解析频响扫频的半功率（−3 dB）识别 ζ 与 ωn，ζ 误差 < 1%（方法自身带 O(ζ²) 偏差：ζ=0.05 时约 0.5%、ζ=0.02 时约 0.08%），ωn 误差 < 0.1%；3 自由度固支链特征频率对照 2√(k/m)·sin(nπ/8) < 1e-9，振型为质量归一 sin 型；60 节点集中刚度简支梁对照精确离散谱 4·sin²(nπ/(2(N+1)))·√(EI/ρA)/h² < 1e-9，对照连续梁理论 (nπ/L)²√(EI/ρA) 前 3 阶 < 0.5%（第 3 阶离散偏差 0.20%）；隔振传递率峰值对照 1/(2ζ) < 1%（ζ=0.05，以精确闭式峰为基准），且 T(√2) = 1 对一切 ζ 精确成立（代数恒等式）；不平衡归一化幅值峰恰为 1/(2ζ)（r=1）、相位恰为 90°（代数恒等式）。',
      'en-US':
        'Pure numeric core with self-implemented cyclic Jacobi eigensolver, RK4 integration and complex arithmetic (no external numerics dependency). Benchmarks (unified yardstick |computed - analytic|/|analytic| unless stated): RK4 free decay (dt = tEnd/4800) vs the exact underdamped closed form, max relative deviation < 1e-3 (observed ~1e-8); half-power (-3 dB) identification of zeta and wn from the analytic receptance sweep, zeta error < 1% (the method itself carries an O(zeta^2) bias: ~0.5% at zeta = 0.05, ~0.08% at zeta = 0.02) and wn error < 0.1%; 3-DOF fixed-fixed chain eigenfrequencies vs 2*sqrt(k/m)*sin(n*pi/8) < 1e-9 with mass-normalized sin modes; 60-node lumped simply supported beam vs the exact discrete spectrum < 1e-9 and vs continuous beam theory < 0.5% for modes 1-3 (discretization bias 0.20% at mode 3); transmissibility peak vs 1/(2*zeta) < 1% at zeta = 0.05 and T(sqrt2) = 1 EXACTLY for every zeta; unbalance normalized amplitude peaks at exactly 1/(2*zeta) on r = 1 with exactly 90 deg phase lag.',
    },
  },
};
