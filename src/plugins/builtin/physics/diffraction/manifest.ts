// ==========================================================================
// physics-diffraction — Fresnel–Kirchhoff diffraction laboratory — manifest
//
// Numerical Fresnel–Kirchhoff diffraction from single slit / double slit /
// N-slit grating / circular hole with near- and far-field regimes, validated
// against slit minima, fringe spacing, energy conservation (unitarity) and
// the Airy first dark ring.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const physicsDiffractionManifest: PluginManifest = {
  id: 'example.physics-diffraction',
  name: 'Diffraction Lab',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Fresnel–Kirchhoff diffraction integrals (composite-Simpson aperture quadrature, self-implemented complex math and J₀/J₁) for single/double/multi slits and circular holes, with Fraunhofer references, intensity profiles and 2-D maps.',
  nameI18n: {
    'zh-CN': '衍射实验室',
    'en-US': 'Diffraction Lab',
  },
  descriptionI18n: {
    'zh-CN':
      '数值计算菲涅尔-基尔霍夫衍射积分（逐缝复合 Simpson 求积、自实现复数运算与 J₀/J₁ 贝塞尔函数），支持单缝 / 双缝 / N 缝光栅 / 圆孔，近场与远场统一处理；绘制孔径示意、强度分布与二维衍射图样，科研输出给出极小位置、条纹间距、Airy 暗环与能量守恒的定量验证。',
    'en-US':
      'Evaluates the Fresnel–Kirchhoff diffraction integral numerically (per-slit composite-Simpson quadrature, self-implemented complex arithmetic and J₀/J₁ Bessel functions) for single / double / N-slit gratings and circular holes, unified near- and far-field; draws the aperture schematic, intensity profile and 2-D pattern, with science outputs quantifying minima positions, fringe spacing, the Airy dark ring and energy conservation.',
  },
  license: 'MIT',
  entry: 'example.physics-diffraction',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { length: 'λ', wavelength: 'λ', distance: 'λ' },
    benchmarks: ['single-slit-minima', 'double-slit-fringes', 'energy-conservation', 'airy-ring'],
    reproducible: true,
    notes:
      'Benchmarks (relative error |num−theory|/|theory|): (1) single-slit minima at x_m = m·λL/a, a=8λ, L=2·10⁵λ, gate < 1e-3; (2) double-slit fringe spacing Δx = λL/d (dominant spacing of successive minima, which sit exactly at the two-beam zeros and are unbiased by the envelope tilt), a=8λ, d=40λ, L=10⁵λ, gate < 1e-2; (3) near-field energy conservation ∫I dx = N·a (Fresnel-propagator unitarity), a=20λ, L=500λ (F=0.2), gate < 5e-2; (4) Airy first dark ring r₁ = 1.21967·λL/D, R=5λ, L=10⁶λ, gate < 1e-3. Numerics: composite Simpson quadrature per slit segment of the Fresnel–Kirchhoff integral, unitary 1-D prefactor 1/√(iλL), exact Hankel form with J₀ for the circular hole; far-field references per Born & Wolf, Principles of Optics §8, and Goodman, Introduction to Fourier Optics ch. 4.',
    notesI18n: {
      'zh-CN':
        '基准（统一相对误差口径 |数值−理论|/|理论|）：① 单缝极小 x_m = m·λL/a（a=8λ、L=2·10⁵λ），门槛 <1e-3；② 双缝条纹间距 Δx = λL/d（取相邻极小间距的主导聚类中位数——极小严格位于两光束干涉零点，不受包络倾斜偏移；a=8λ、d=40λ、L=10⁵λ），门槛 <1e-2；③ 近场能量守恒 ∫I dx = N·a（菲涅尔传播子幺正性，F=0.2、a=20λ、L=500λ），门槛 <5e-2；④ 圆孔 Airy 第一暗环 r₁ = 1.21967·λL/D（R=5λ、L=10⁶λ），门槛 <1e-3。数值方法：逐缝复合 Simpson 求积计算菲涅尔-基尔霍夫积分，1-D 传播子幺正前因子 1/√(iλL)，圆孔用含 J₀ 的精确 Hankel 形式；远场参考公式出自 Born & Wolf《Principles of Optics》§8 与 Goodman《Introduction to Fourier Optics》第 4 章。',
      'en-US':
        'Benchmarks (relative error |num−theory|/|theory|): (1) single-slit minima at x_m = m·λL/a, a=8λ, L=2·10⁵λ, gate < 1e-3; (2) double-slit fringe spacing Δx = λL/d (dominant-spacing median of successive minima — the minima sit exactly at the two-beam zeros, unbiased by the envelope tilt), a=8λ, d=40λ, L=10⁵λ, gate < 1e-2; (3) near-field energy conservation ∫I dx = N·a (Fresnel-propagator unitarity), a=20λ, L=500λ (F=0.2), gate < 5e-2; (4) Airy first dark ring r₁ = 1.21967·λL/D, R=5λ, L=10⁶λ, gate < 1e-3. Numerics: composite Simpson quadrature per slit segment of the Fresnel–Kirchhoff integral, unitary 1-D prefactor 1/√(iλL), exact Hankel form with J₀ for the circular hole; far-field references per Born & Wolf, Principles of Optics §8, and Goodman, Introduction to Fourier Optics ch. 4.',
    },
  },
};
