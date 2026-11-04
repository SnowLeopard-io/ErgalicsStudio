// ==========================================================================
// 2-D Ising model plugin — manifest
//
// Metropolis and Wolff single-cluster Monte Carlo for the square-lattice
// Ising model with periodic boundaries (k_B = 1). Benchmarked against the
// exact 2x2 partition function, Onsager's spontaneous magnetisation, and
// the susceptibility-peak estimate of the critical temperature on 64x64.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const isingManifest: PluginManifest = {
  id: 'example.physics-ising',
  name: '2-D Ising Model',
  nameI18n: { 'zh-CN': '二维伊辛模型', 'en-US': '2-D Ising Model' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Research-grade Monte Carlo laboratory for the 2-D Ising model: Metropolis and Wolff single-cluster updates on periodic square lattices (L <= 128, Int8 state), susceptibility / heat-capacity / Binder-cumulant observables, and an async chunked temperature sweep whose chi peak locates the Onsager critical temperature.',
  descriptionI18n: {
    'zh-CN':
      '科研级二维伊辛模型蒙特卡罗实验台：周期方格子上运行 Metropolis 与 Wolff 单团簇算法（L ≤ 128、Int8 自旋态），观测磁化率 χ、比热 C 与 Binder 累积量；异步分片扫温绘制 χ(T) 曲线，峰位拟合给出 Onsager 临界温度 Tc = 2/ln(1+√2)。',
    'en-US':
      'Research-grade Monte Carlo laboratory for the 2-D Ising model: Metropolis and Wolff single-cluster updates on periodic square lattices (L <= 128, Int8 state), susceptibility / heat-capacity / Binder-cumulant observables, and an async chunked temperature sweep whose chi peak locates the Onsager critical temperature.',
  },
  license: 'MIT',
  entry: 'example.physics-ising',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    units: { temperature: 'J/k_B', energy: 'J' },
    benchmarks: ['2x2-exact-partition-function', 'tc-susceptibility-peak-64', 'onsager-magnetisation', 'binder-cumulant-universality'],
    reproducible: true,
    notes:
      'Numerical benchmarks (unified relative error |calc-analytic|/|analytic|): the 2x2 periodic lattice reproduces the closed-form partition function Z = 2e^{8K} + 12 + 2e^{-8K} and every moment to < 1e-9, cross-checked against brute-force enumeration of all 2^N states; the 64x64 chi-peak fit locates Tc = 2/ln(1+sqrt 2) = 2.269185 J/k_B within +-0.05 for fixed seeds; <|m|> follows Onsager m(T) = (1 - sinh^{-4}(2J/T))^{1/8} within 2% below Tc; the Binder cumulant at Tc sits in the universal window (0.55, 0.67). Wolff bond probability p_add = 1 - exp(-2 beta J); measurements are taken on a state-independent schedule of cluster flips (inspection-paradox safe) and the algorithm falls back to Metropolis whenever H != 0. References: L. Onsager, Phys. Rev. 65, 117 (1944); U. Wolff, Phys. Rev. Lett. 62, 361 (1989); K. Binder, Z. Phys. B 43, 119 (1981).',
    notesI18n: {
      'zh-CN':
        '数值基准（统一相对误差口径 |计算-解析|/|解析|）：2×2 周期格子复现闭式配分函数 Z = 2e^{8K}+12+2e^{-8K} 及全部矩（误差 <1e-9，并与 2^N 态暴力枚举交叉验证）；64×64 磁化率 χ 峰拟合定位 Tc = 2/ln(1+√2) = 2.269185 J/k_B（固定种子，±0.05）；Tc 以下 ⟨|m|⟩ 与 Onsager 公式 m(T) = (1−sinh⁻⁴(2J/T))^{1/8} 对照（误差 <2%）；Tc 处 Binder 累积量落在普适窗口 (0.55, 0.67)。Wolff 键概率 p_add = 1−exp(−2βJ)；测量采用状态无关的团簇翻转采样时刻（避免检查悖论）；H≠0 时自动退回 Metropolis。出处：L. Onsager, Phys. Rev. 65, 117 (1944)；U. Wolff, Phys. Rev. Lett. 62, 361 (1989)；K. Binder, Z. Phys. B 43, 119 (1981)。',
      'en-US':
        'Numerical benchmarks (unified relative error |calc-analytic|/|analytic|): the 2x2 periodic lattice reproduces the closed-form partition function Z = 2e^{8K} + 12 + 2e^{-8K} and every moment to < 1e-9, cross-checked against brute-force enumeration of all 2^N states; the 64x64 chi-peak fit locates Tc = 2/ln(1+sqrt 2) = 2.269185 J/k_B within +-0.05 for fixed seeds; <|m|> follows Onsager m(T) = (1 - sinh^{-4}(2J/T))^{1/8} within 2% below Tc; the Binder cumulant at Tc sits in the universal window (0.55, 0.67). Wolff bond probability p_add = 1 - exp(-2 beta J); measurements are taken on a state-independent schedule of cluster flips (inspection-paradox safe) and the algorithm falls back to Metropolis whenever H != 0. References: L. Onsager, Phys. Rev. 65, 117 (1944); U. Wolff, Phys. Rev. Lett. 62, 361 (1989); K. Binder, Z. Phys. B 43, 119 (1981).',
    },
  },
};
