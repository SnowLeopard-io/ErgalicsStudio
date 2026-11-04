// ==========================================================================
// Plane truss FEA plugin — manifest
//
// 2-D bar-element finite element analysis: global stiffness assembly,
// constraint condensation, partial-pivot Gaussian elimination, axial
// force/stress/reaction recovery. Validation: method-of-joints tripod,
// statically-indeterminate three-member symmetry solution, cantilever
// beam-theory magnitude screen — all in tests/eng-truss.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engTrussManifest: PluginManifest = {
  id: 'example.eng-truss',
  name: 'Plane Truss FEA',
  nameI18n: { 'zh-CN': '平面桁架有限元分析', 'en-US': 'Plane Truss FEA' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Finite element analysis of plane trusses: 2-DOF-per-node bar elements, global stiffness assembly, constraint condensation and partial-pivot Gaussian solve; recovers nodal displacements, axial forces (tension + / compression −), stresses and support reactions with a deformed-shape overlay.',
  descriptionI18n: {
    'zh-CN':
      '平面桁架有限元分析：每节点 2 自由度的杆单元、整体刚度矩阵组装、约束处理（划行法）与部分主元高斯消元；输出节点位移、单元轴力（拉正压负）、应力与支座反力，并叠加可调放大系数的变形图。',
    'en-US':
      'Finite element analysis of plane trusses: 2-DOF-per-node bar elements, global stiffness assembly, constraint condensation and partial-pivot Gaussian solve; recovers nodal displacements, axial forces (tension + / compression −), stresses and support reactions with a deformed-shape overlay.',
  },
  license: 'MIT',
  entry: 'example.eng-truss',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'research',
    units: { length: 'm', displacement: 'mm', force: 'N', stress: 'MPa', modulus: 'Pa' },
    benchmarks: [
      'eng-truss-two-bar-tripod',
      'eng-truss-three-member-indeterminate',
      'eng-truss-cantilever-magnitude',
    ],
    reproducible: true,
    notes:
      'Standard plane bar-element FEM (Bathe, Finite Element Procedures, §4.2) with exact constraint condensation; tests cross-check a two-bar tripod against the method of joints and a three-member indeterminate truss against the compatibility solution (rel. err < 1e-9), plus an order-of-magnitude screen vs Euler–Bernoulli beam theory; equilibrium residual is published as a self-check.',
    notesI18n: {
      'zh-CN':
        '标准平面杆单元有限元（Bathe《Finite Element Procedures》§4.2），约束凝聚精确处理零位移支座；测试中两杆三角架与节点法、三杆超静定桁架与变形协调解析解对照（统一相对误差 < 1e-9），悬臂桁架端部位移与材料力学梁理论做量级校验；平衡残差作为自检输出。',
      'en-US':
        'Standard plane bar-element FEM (Bathe, Finite Element Procedures, §4.2) with exact constraint condensation; tests cross-check a two-bar tripod against the method of joints and a three-member indeterminate truss against the compatibility solution (rel. err < 1e-9), plus an order-of-magnitude screen vs Euler–Bernoulli beam theory; equilibrium residual is published as a self-check.',
    },
  },
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON model: nodes / elements / constraints / loads' },
  ],
};
