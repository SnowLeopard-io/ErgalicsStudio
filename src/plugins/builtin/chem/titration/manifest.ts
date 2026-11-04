// ==========================================================================
// Acid–base titration curve laboratory plugin — manifest
//
// Solves the full ionic balance (charge balance + mass balance + Ka + Kw)
// by bracketed Newton–Raphson at every titrant volume, producing a
// research-grade pH(V) curve with the equivalence point, buffer zone and
// optional indicator ranges validated against analytic oracles.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const chemTitrationManifest: PluginManifest = {
  id: 'example.chem-titration',
  name: 'Titration Curve Lab',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Acid–base titration curves from the full ionic balance: charge + mass balance solved with bracketed Newton–Raphson including water auto-ionisation (Kw), equivalence point and buffer zone marked, indicator ranges overlaid, analytic-oracle validation built in.',
  nameI18n: {
    'zh-CN': '酸碱滴定曲线实验室',
    'en-US': 'Titration Curve Lab',
  },
  descriptionI18n: {
    'zh-CN':
      '基于全离子平衡（电荷平衡 + 物料平衡 + Ka + Kw）的酸碱滴定曲线：用带二分保护的 Newton–Raphson 逐体积求解 [H+]，标注等当点与缓冲区，可叠加甲基橙/酚酞变色区间，并内嵌解析式对拍基准（强酸等当点 pH=7.00、弱酸 ½(pKw+pKa+lg c盐) 公式、稀释定律初始 pH）。',
    'en-US':
      'Acid–base titration curves from the full ionic balance (charge + mass balance, Ka and Kw): bracketed Newton–Raphson solves [H+] at every volume, equivalence point and buffer zone are marked, methyl-orange/phenolphthalein ranges can be overlaid, and analytic oracles (pH=7.00 strong-acid equivalence, ½(pKw+pKa+lg c) weak-acid formula, dilution-law initial pH) validate the solver.',
  },
  license: 'MIT',
  entry: 'example.chem-titration',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { concentration: 'mol/L', volume: 'mL', ph: 'pH' },
    benchmarks: ['titration-strong-acid-ph7', 'titration-weak-acid-hydrolysis', 'titration-dilution-law'],
    reproducible: true,
    notes:
      'Real ionic-balance numerics (charge + mass balance with Ka and Kw, bracketed Newton–Raphson); cross-checked against analytic oracles — strong/strong equivalence pH = 7.00 ± 0.02, weak-acid hydrolysis pH = ½(pKw + pKa + lg c_salt) within 0.5% relative error, initial pH vs the exact dilution-law quadratic. Monoprotic acid / monohydroxide base scope only.',
    notesI18n: {
      'zh-CN':
        '真实离子平衡数值（电荷+物料平衡、含 Ka 与 Kw 的带保护 Newton 迭代）；解析对拍：强酸强碱等当点 pH=7.00±0.02，弱酸水解公式 ½(pKw+pKa+lg c盐) 相对误差<0.5%，初始 pH 对照稀释定律精确二次式。仅限一元酸与一元强碱体系。',
      'en-US':
        'Real ionic-balance numerics (charge + mass balance with Ka and Kw, safeguarded Newton iteration); analytic oracles: strong/strong equivalence pH = 7.00 ± 0.02, weak-acid hydrolysis ½(pKw+pKa+lg c_salt) within 0.5% relative error, initial pH vs the exact dilution-law quadratic. Monoprotic acid / monohydroxide base scope only.',
    },
  },
  formats: [],
};
