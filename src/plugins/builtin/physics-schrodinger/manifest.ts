// ==========================================================================
// 1-D quantum mechanics solver plugin — manifest
//
// Stationary states of 1-D potentials (infinite well, harmonic oscillator,
// finite well, double well) via finite differences + a self-implemented
// tridiagonal QL eigensolver, plus Crank-Nicolson wave-packet dynamics.
// Cross-checked against closed-form spectra: E_n = n^2 pi^2 / L^2 (infinite
// well), E_n = (n + 1/2) omega (harmonic), the finite-well transcendental
// parity equations, and the free-Gaussian spreading law sigma(t).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const schrodingerManifest: PluginManifest = {
  id: 'example.physics-schrodinger',
  name: '1-D Schrödinger Solver',
  nameI18n: { 'zh-CN': '一维量子力学求解器', 'en-US': '1-D Schrödinger Solver' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Research-grade 1-D quantum solver: finite-difference + tridiagonal QL eigensolver for infinite-well / harmonic / finite-well / double-well potentials, and unitary Crank-Nicolson time evolution of Gaussian wave packets, benchmarked against analytic spectra and the free-packet spreading law.',
  descriptionI18n: {
    'zh-CN':
      '科研级一维量子求解器：有限差分 + 自实现三对角 QL 本征求解器，支持无限深方势阱 / 谐振子 / 有限方势阱 / 双势阱的能级与本征函数；Crank-Nicolson 幺正时间演化演示高斯波包传播，能级与波包展宽均与解析解对拍。',
    'en-US':
      'Research-grade 1-D quantum solver: finite-difference + self-implemented tridiagonal QL eigensolver for infinite-well / harmonic / finite-well / double-well potentials, and unitary Crank-Nicolson wave-packet dynamics benchmarked against analytic spectra and the free-packet spreading law.',
  },
  license: 'MIT',
  entry: 'example.physics-schrodinger',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    units: { energy: 'a.u. (ħ²/2m = 1)', length: 'a.u.', time: 'a.u.' },
    benchmarks: ['infinite-well-n2-pi2', 'harmonic-half-omega', 'finite-well-parity-equations', 'cn-free-gaussian-spreading'],
    reproducible: true,
    notes:
      'Numerical benchmarks (relative error |calc-analytic|/|analytic|): infinite well E_n = n^2 pi^2 / L^2 with hbar^2/2mL^2 = 1 (E1 = pi^2, E2 = 4 pi^2, < 1e-3); harmonic E_n = (n + 1/2) omega (< 1e-2); finite-well bound states vs the parity transcendental equations solved by bisection; Crank-Nicolson free Gaussian vs sigma(t) = sqrt(s0^2 + t^2/s0^2) with exact norm conservation (< 2%, unitarity < 1e-10). Textbook references: Griffiths, Introduction to Quantum Mechanics; Crank & Nicolson (1947).',
    notesI18n: {
      'zh-CN':
        '数值基准（统一相对误差口径 |计算-解析|/|解析|）：无限深阱 E_n = n²π²/L²（ħ²/2mL²=1 时 E1=π²、E2=4π²，误差 <1e-3）；谐振子 E_n=(n+½)ω（误差 <1e-2）；有限阱束缚态与奇偶宇称超越方程（二分法求解）对照；Crank-Nicolson 自由高斯波包与展宽公式 σ(t)=√(s0²+t²/s0²) 对照（误差 <2%，幺正性 <1e-10）。出处：Griffiths《Introduction to Quantum Mechanics》；Crank & Nicolson (1947)。',
      'en-US':
        'Numerical benchmarks (unified relative error |calc-analytic|/|analytic|): infinite well E_n = n^2 pi^2 / L^2 (E1 = pi^2, E2 = 4 pi^2 at hbar^2/2mL^2 = 1, < 1e-3); harmonic E_n = (n + 1/2) omega (< 1e-2); finite-well bound states vs parity transcendental equations (bisection); Crank-Nicolson free Gaussian vs sigma(t) = sqrt(s0^2 + t^2/s0^2) (< 2%, unitarity < 1e-10). References: Griffiths, Introduction to Quantum Mechanics; Crank & Nicolson (1947).',
    },
  },
};
