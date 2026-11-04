// ==========================================================================
// physics-trajectory — trajectory kinematics & energy decomposition — manifest
//
// Data-driven plugin: loads (t, x[, y]) tables and differentiates,
// decomposes mechanical energy and linearly fits projectile parameters.
// Validation: seeded 0.5 %-noise projectile recovery (< 1 %), exact
// non-uniform-grid differentiation (< 1e-2) and noiseless energy drift
// (< 0.5 %).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const physicsTrajectoryManifest: PluginManifest = {
  id: 'example.physics-trajectory',
  name: 'Trajectory Kinematics Lab',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Trajectory (t, x[, y]) analysis: non-uniform 3-point Lagrange differentiation, optional Savitzky–Golay smoothing, KE/PE mechanical-energy decomposition and linearized projectile least-squares fit (v0, θ), with seeded synthetic validation benchmarks.',
  nameI18n: {
    'zh-CN': '轨迹运动学与能量分解实验室',
    'en-US': 'Trajectory Kinematics Lab',
  },
  descriptionI18n: {
    'zh-CN':
      '分析轨迹数据（t, x[, y]）：非均匀时间网格的三点 Lagrange 数值微分（对二次多项式精确）、可选 Savitzky-Golay 局部二次平滑、动能/势能机械能分解，以及线性化最小二乘抛体拟合（反解初速率 v₀ 与发射角 θ）；内置固定种子合成数据验证基准，支持上传 CSV/TSV/DAT/TXT。',
    'en-US':
      'Analyses trajectory tables (t, x[, y]): 3-point Lagrange differentiation on non-uniform time grids (exact for quadratics), optional local-quadratic Savitzky–Golay smoothing, KE/PE mechanical-energy decomposition and a linearized least-squares projectile fit recovering launch speed v0 and angle θ; seeded synthetic validation benchmarks included, CSV/TSV/DAT/TXT upload supported.',
  },
  license: 'MIT',
  entry: 'example.physics-trajectory',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 't,x[,y] trajectory table' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 't,x[,y] trajectory table' },
    { extension: '.dat', mimeTypes: ['text/plain'], description: 't,x[,y] comma/whitespace delimited' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 't,x[,y] comma/whitespace delimited' },
  ],
  research: {
    tier: 'quasi-research',
    units: { time: 's', length: 'm', velocity: 'm/s', angle: '°', mass: 'kg', energy: 'J' },
    benchmarks: ['projectile-recovery', 'derivative-accuracy', 'energy-drift'],
    reproducible: true,
    notes:
      'Benchmarks (relative error |num−theory|/|theory|): (1) projectile recovery — synthetic v0 = 20 m/s, θ = 45°, g = 9.81 m/s² parabola, 50 samples with 0.5 % multiplicative Gaussian noise (mulberry32 seed 20251011, Box–Muller), refitted through the linearized least squares x(t) = vx·t + x0, y(t) + ½g·t² = vy·t + y0; recovered v0 and θ must stay within 1 %; (2) the 3-point Lagrange stencils (non-uniform grid, one-sided at the ends) are exact for quadratics — on a power-law stretched time grid of the exact parabola, vx/vy/ay match the analytic values below 1e-2 relative (machine-level) and ax vanishes absolutely; (3) noiseless total mechanical energy KE = ½m|v|², PE = m·g·(y−y₀) drifts (max−min)/|mean| below 0.5 % (machine-level). Differentiation per standard non-uniform finite-difference formulas (e.g. Sauer, Numerical Analysis, §4.1); Savitzky–Golay smoothing per the original 1964 algorithm generalized to non-uniform abscissae.',
    notesI18n: {
      'zh-CN':
        '基准（统一相对误差口径 |数值−理论|/|理论|）：① 抛体回收——合成抛体 v0 = 20 m/s、θ = 45°、g = 9.81 m/s²，50 个采样点叠加 0.5% 乘性高斯噪声（mulberry32 种子 20251011，Box–Muller），经线性化最小二乘 x(t) = vx·t + x0、y(t) + ½g·t² = vy·t + y0 重拟合，回收 v0 与 θ 门槛 <1%；② 三点 Lagrange 微分模板（非均匀网格、端点单侧）对二次多项式精确——在幂律拉伸的非均匀时间网格上，vx/vy/ay 与解析值相对误差 <1e-2（实际达机器精度），ax 绝对误差趋零；③ 无噪声总机械能 KE = ½m|v|²、PE = m·g·(y−y₀) 漂移 (max−min)/|mean| <0.5%（实际达机器精度）。微分公式出自标准非均匀有限差分（如 Sauer《Numerical Analysis》§4.1）；Savitzky-Golay 平滑按 1964 年原始算法推广到非均匀横坐标。',
      'en-US':
        'Benchmarks (relative error |num−theory|/|theory|): (1) projectile recovery — synthetic v0 = 20 m/s, θ = 45°, g = 9.81 m/s² parabola, 50 samples with 0.5 % multiplicative Gaussian noise (mulberry32 seed 20251011, Box–Muller), refitted through the linearized least squares x(t) = vx·t + x0, y(t) + ½g·t² = vy·t + y0; recovered v0 and θ must stay within 1 %; (2) the 3-point Lagrange stencils (non-uniform grid, one-sided at the ends) are exact for quadratics — on a power-law stretched time grid of the exact parabola, vx/vy/ay match the analytic values below 1e-2 relative (machine-level) and ax vanishes absolutely; (3) noiseless total mechanical energy drifts (max−min)/|mean| below 0.5 % (machine-level). Differentiation per standard non-uniform finite-difference formulas (e.g. Sauer, Numerical Analysis, §4.1); Savitzky–Golay smoothing per the original 1964 algorithm generalized to non-uniform abscissae.',
    },
  },
};
