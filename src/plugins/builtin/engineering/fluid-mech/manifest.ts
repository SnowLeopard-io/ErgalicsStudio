// ==========================================================================
// eng-fluid — fluid mechanics laboratory — manifest
//
// Analytic fluid mechanics workbench: pipe flow (Darcy–Weisbach with
// Colebrook–White friction factor), ideal Bernoulli ducts, the Blasius
// flat-plate boundary layer (shooting solution of the similarity ODE) and a
// dependency-free projected-streamline viewer for potential flow past a
// sphere / cylinder. Validation: closed-form benchmarks documented in
// tests/eng-fluid-mech.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engFluidManifest: PluginManifest = {
  id: 'example.eng-fluid',
  name: 'Fluid Mechanics Lab',
  nameI18n: { 'zh-CN': '流体力学实验室', 'en-US': 'Fluid Mechanics Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Fluid mechanics workbench: pipe flow via Darcy–Weisbach with a Newton-iterated Colebrook–White friction factor (Moody chart with the operating point), ideal Bernoulli converging/diverging/venturi ducts with continuity and energy lines, the Blasius flat-plate boundary layer from a shooting solution of the similarity ODE (delta, delta*, theta, cf) with a Pohlhausen separation indicator, and a projected-streamline viewer for potential flow past a sphere / rotating cylinder with Stokes/Schiller–Naumann drag and Kutta–Joukowski lift.',
  descriptionI18n: {
    'zh-CN':
      '流体力学实验台：管流采用 Darcy–Weisbach 公式与 Newton 迭代求解的 Colebrook–White 摩阻系数（Moody 图标注工作点），理想 Bernoulli 收缩/扩张/文丘里管道沿程连续性、压强与能量线，Blasius 平板边界层相似 ODE 打靶解（δ、δ*、θ、Cf）与 Pohlhausen 分离指示，以及势流球/旋转圆柱绕流的投影流线视图与 Stokes/Schiller–Naumann 阻力、Kutta–Joukowski 升力。',
    'en-US':
      'Fluid mechanics workbench: pipe flow via Darcy–Weisbach with a Newton-iterated Colebrook–White friction factor (Moody chart with the operating point), ideal Bernoulli converging/diverging/venturi ducts with continuity and energy lines, the Blasius flat-plate boundary layer from a shooting solution of the similarity ODE (delta, delta*, theta, cf) with a Pohlhausen separation indicator, and a projected-streamline viewer for potential flow past a sphere / rotating cylinder with Stokes/Schiller–Naumann drag and Kutta–Joukowski lift.',
  },
  license: 'MIT',
  entry: 'example.eng-fluid',
  category: 'scientific',
  sandbox: 'trusted',
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:01aa50c0080b0becf17b99809b338c04',
    sig: '12465a678c084fa38badd9c277923ff61ec02663c9a33ce4b563e185abc1af186edae1d5060e2ce372648ea623e4af7a464346a02c312728b4fcbccf5cedf308',
    signer: 'Ergalics Studio (engineering suite pack)',
    signedAt: '2026-11-01T00:00:00.000Z',
    pub: '30bb575dc5976b695a64a51200067f2a3ae4939ec038f0eb3e543ccf6e31ad1c',
  },
  research: {
    tier: 'research',
    units: { length: 'm', velocity: 'm/s', viscosity: 'Pa·s', density: 'kg/m³', pressure: 'Pa', head: 'm' },
    benchmarks: [
      'fluid-laminar-64-over-re',
      'fluid-colebrook-vs-haaland',
      'fluid-pipe-blasius-correlation',
      'fluid-bernoulli-continuity-energy',
      'fluid-blasius-shooting-solution',
      'fluid-pohlhausen-shape-factor',
      'fluid-stokes-drag-closed-form',
      'fluid-kutta-joukowski-lift',
    ],
    reproducible: true,
    notes:
      'All numerics are pure TypeScript with no DOM: Colebrook–White solved by Newton iteration on x = 1/√f (seeded by the Haaland explicit form, residual < 1e-12); the Blasius similarity ODE f\'\'\' + ½·f·f\'\' = 0 is integrated with fixed-step RK4 under bisection shooting on f\'\'(0) (target f\'(∞) = 1); the Pohlhausen quartic moments are evaluated by composite Simpson integration. Benchmarks (unified yardstick |computed − analytic|/|analytic|): laminar f = 64/Re (exact); Colebrook vs Haaland < 2% across the turbulent overlap Re ∈ [4e3, 1e7], ε/d ∈ [0, 0.05]; smooth-pipe Colebrook vs the Blasius correlation 0.3164/Re^0.25 < 2% on its stated range; duct continuity A·v = const and the Bernoulli invariant p + ½ρv² = const (< 1e-12); Blasius shooting f\'\'(0) = 0.332057, η₉₉ = 5.0, δ*/√(νx/U) = 1.7208, θ/√(νx/U) = 0.6641 (< 1e-3); Pohlhausen H(0) = 2.554 and separation shape factor H(−12) = 3.5 with wall shear 2 + λ/6; Stokes drag F = 6πμaU reproduced exactly from Cd = 24/Re; cylinder lift Cl = Γ/(U·a) (Kutta–Joukowski) with surface stagnation points at sinθ = Γ/(4πUa).',
    notesI18n: {
      'zh-CN':
        '全部数值部分为无 DOM 的纯 TypeScript：Colebrook–White 以 Newton 迭代求解 x = 1/√f（Haaland 显式式作初值，残差 < 1e-12）；Blasius 相似 ODE f\'\'\' + ½·f·f\'\' = 0 用定步长 RK4 配合对 f\'\'(0) 的二分打靶（目标 f\'(∞) = 1）；Pohlhausen 四次式矩量用复合 Simpson 积分。基准（统一相对误差口径 |计算−解析|/|解析|）：层流 f = 64/Re（精确）；湍流重叠区 Re ∈ [4e3, 1e7]、ε/d ∈ [0, 0.05] 内 Colebrook 与 Haaland < 2%；光滑管 Colebrook 与 Blasius 式 0.3164/Re^0.25 在其适用范围内 < 2%；管道连续性 A·v = 常数与 Bernoulli 不变量 p + ½ρv² = 常数（< 1e-12）；Blasius 打靶 f\'\'(0) = 0.332057、η₉₉ = 5.0、δ*/√(νx/U) = 1.7208、θ/√(νx/U) = 0.6641（< 1e-3）；Pohlhausen H(0) = 2.554、分离形状因子 H(−12) = 3.5、壁面剪切 2 + λ/6；Stokes 阻力由 Cd = 24/Re 精确复现 F = 6πμaU；圆柱升力 Cl = Γ/(U·a)（Kutta–Joukowski），表面驻点满足 sinθ = Γ/(4πUa)。',
      'en-US':
        'All numerics are pure TypeScript with no DOM: Colebrook–White solved by Newton iteration on x = 1/√f (seeded by Haaland, residual < 1e-12); the Blasius similarity ODE is integrated with fixed-step RK4 under bisection shooting on f\'\'(0); Pohlhausen quartic moments by composite Simpson. Benchmarks (|computed − analytic|/|analytic|): laminar f = 64/Re (exact); Colebrook vs Haaland < 2% for Re ∈ [4e3, 1e7], ε/d ∈ [0, 0.05]; smooth-pipe Colebrook vs Blasius 0.3164/Re^0.25 < 2% on its range; duct continuity and the Bernoulli invariant (< 1e-12); Blasius shooting f\'\'(0) = 0.332057, η₉₉ = 5.0, δ* = 1.7208√(νx/U), θ = 0.6641√(νx/U) (< 1e-3); Pohlhausen H(0) = 2.554, H(−12) = 3.5, wall shear 2 + λ/6; Stokes drag F = 6πμaU exact from Cd = 24/Re; cylinder lift Cl = Γ/(U·a) with surface stagnation sinθ = Γ/(4πUa).',
    },
  },
};
