// ==========================================================================
// physics-diffusion — heat / diffusion equation solver — manifest
//
// FTCS + Crank–Nicolson solvers for ∂u/∂t = D∇²u with Dirichlet/Neumann
// boundaries. Validation: Fourier-mode decay exp(−Dk²t), Gaussian heat
// kernel width σ²+2Dt, and a 2-D grid-refinement convergence study.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const physicsDiffusionManifest: PluginManifest = {
  id: 'example.physics-diffusion',
  name: 'Diffusion Equation Lab',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    '1-D/2-D diffusion solver (FTCS with von Neumann stability gate, Crank–Nicolson with Thomas solver), Dirichlet/Neumann boundaries, animated field with analytic-reference error telemetry.',
  nameI18n: {
    'zh-CN': '热传导 / 扩散方程实验室',
    'en-US': 'Diffusion Equation Lab',
  },
  descriptionI18n: {
    'zh-CN':
      '求解 ∂u/∂t = D∇²u：FTCS 显式格式（运行前执行 D·Δt/Δx²≤0.5 稳定性校验）与 Crank–Nicolson 隐式格式（Thomas 算法），支持 Dirichlet / Neumann 边界与高斯脉冲、方波、正弦初始条件；动画渲染浓度/温度场并实时输出与解析解的最大相对误差。',
    'en-US':
      'Solves ∂u/∂t = D∇²u with FTCS explicit stepping (pre-run D·Δt/Δx² ≤ 0.5 stability gate) and Crank–Nicolson (Thomas algorithm), Dirichlet / Neumann boundaries and Gaussian / square / sine initial conditions; animated concentration/temperature field with live max-relative-error telemetry against the analytic reference.',
  },
  license: 'MIT',
  entry: 'example.physics-diffusion',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { diffusivity: 'm²/s', length: 'm', time: 's' },
    benchmarks: ['sine-mode-decay', 'gaussian-kernel', '2d-convergence'],
    reproducible: true,
    notes:
      'Benchmarks (relative error |num−ana|/|ana|): (1) sine mode decays as exp(−Dk²t), CN N=200 Δt=1e-3, gate < 1e-3; (2) Gaussian width σ²+2Dt and amplitude σ₀/σ_t on a wide Neumann domain, gate < 1%; (3) 2-D FTCS grid refinement 32→64 at fixed courant 0.2 must cut RMS error ≈4× (band 3–5). Schemes per Crank & Nicolson (1947) and von Neumann stability analysis (Press et al., Numerical Recipes §19.2). CN is 1-D only; 2-D falls back to FTCS.',
    notesI18n: {
      'zh-CN':
        '基准（统一相对误差口径 |数值−解析|/|解析|）：① 正弦模按 exp(−Dk²t) 衰减，CN、N=200、Δt=1e-3，门槛 <1e-3；② 高斯脉冲宽度 σ²+2Dt、幅值 σ₀/σ_t（宽域 Neumann），门槛 <1%；③ 2-D FTCS 固定库朗数 0.2 网格 32→64 加密，RMS 误差应降约 4 倍（容差 3–5）。格式出自 Crank & Nicolson (1947) 与 von Neumann 稳定性分析（Press 等《Numerical Recipes》§19.2）。CN 仅支持 1-D，2-D 自动回退 FTCS。',
      'en-US':
        'Benchmarks (relative error |num−ana|/|ana|): (1) sine mode decays as exp(−Dk²t), CN N=200 Δt=1e-3, gate < 1e-3; (2) Gaussian width σ²+2Dt and amplitude σ₀/σ_t on a wide Neumann domain, gate < 1%; (3) 2-D FTCS grid refinement 32→64 at fixed courant 0.2 must cut RMS error ≈4× (band 3–5). Schemes per Crank & Nicolson (1947) and von Neumann stability analysis (Press et al., Numerical Recipes §19.2). CN is 1-D only; 2-D falls back to FTCS.',
    },
  },
};
