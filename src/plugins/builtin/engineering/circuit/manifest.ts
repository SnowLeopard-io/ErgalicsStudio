// ==========================================================================
// DC circuit node-analysis plugin — manifest
//
// Modified Nodal Analysis (MNA) of DC resistive networks (R / V / I
// elements) with partial-pivot Gaussian elimination. Validation: analytic
// divider & ladder solutions, hand-derived KCL on a mixed source circuit,
// and a Tellegen power-balance residual; all documented in tests/eng-circuit.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engCircuitManifest: PluginManifest = {
  id: 'example.eng-circuit',
  name: 'DC Circuit Node Analysis',
  nameI18n: { 'zh-CN': '直流电路节点分析', 'en-US': 'DC Circuit Node Analysis' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Modified Nodal Analysis (MNA) of DC resistive circuits: JSON netlists with resistors and independent voltage/current sources, partial-pivot Gaussian elimination, node-voltage topology view and Tellegen power-balance diagnostics.',
  descriptionI18n: {
    'zh-CN':
      '改进节点分析法（MNA）求解直流电阻电路：JSON 网表描述电阻与独立电压源/电流源，部分主元高斯消元求节点电压，绘制节点-支路拓扑图并给出 Tellegen 功率平衡诊断。',
    'en-US':
      'Modified Nodal Analysis (MNA) of DC resistive circuits: JSON netlists with resistors and independent voltage/current sources, partial-pivot Gaussian elimination, node-voltage topology view and Tellegen power-balance diagnostics.',
  },
  license: 'MIT',
  entry: 'example.eng-circuit',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    units: { voltage: 'V', current: 'A', resistance: 'Ω', power: 'W' },
    benchmarks: [
      'eng-circuit-divider',
      'eng-circuit-t-ladder',
      'eng-circuit-mixed-kcl',
      'eng-circuit-floating-source',
    ],
    reproducible: true,
    notes:
      'MNA per Ho–Ruehli–Brennan (IEEE Trans. CAS, 1975) with partial-pivot Gaussian elimination; validated against analytic voltage-divider / T-ladder / mixed-source KCL solutions (relative error < 1e-9) and a Tellegen power-balance residual; singular systems (floating sources) raise errors instead of returning numbers.',
    notesI18n: {
      'zh-CN':
        '按 Ho–Ruehli–Brennan 改进节点法（IEEE Trans. CAS, 1975）+ 部分主元高斯消元；测试以分压器 / T 型梯形网络 / 混合源 KCL 手工解对照（统一相对误差 |计算−解析|/|解析| < 1e-9），并以 Tellegen 功率平衡残差自检；浮地电压源等病态系统直接报错而非输出数值。',
      'en-US':
        'MNA per Ho–Ruehli–Brennan (IEEE Trans. CAS, 1975) with partial-pivot Gaussian elimination; validated against analytic voltage-divider / T-ladder / mixed-source KCL solutions (relative error < 1e-9) and a Tellegen power-balance residual; singular systems (floating sources) raise errors instead of returning numbers.',
    },
  },
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON netlist: nodes + R/V/I elements' },
  ],
};
