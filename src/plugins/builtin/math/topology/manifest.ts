// ==========================================================================
// math-topology — parametric surfaces, homotopy & surface classification —
// manifest
//
// Manifest-only module: `builtin/index.ts` imports this file statically while
// the implementation in `plugin.ts` is loaded dynamically.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const mathTopologyManifest: PluginManifest = {
  id: 'example.math-topology',
  name: 'Topology Visualizer',
  nameI18n: { 'zh-CN': '拓扑可视化', 'en-US': 'Topology Visualizer' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Interactive 3D embeddings of the torus, Möbius band and Klein bottle (figure-8 immersion) with fundamental-group loop demos, continuous deformation retraction, homeomorphism morphs (superellipse family) and numerical Euler-characteristic verification χ = V − E + F = 2 − 2g on triangulated surfaces.',
  descriptionI18n: {
    'zh-CN':
      '环面、Möbius 带与 Klein 瓶（figure-8 浸入）的三维嵌入交互演示：基本群彩色环路与形变收缩动画、同胚连续形变预设（超椭圆族），并在三角网格上数值验证欧拉示性数 χ = V − E + F = 2 − 2g。',
    'en-US':
      'Interactive 3D embeddings of the torus, Möbius band and Klein bottle (figure-8 immersion) with fundamental-group loop demos, continuous deformation retraction, homeomorphism morphs (superellipse family) and numerical Euler-characteristic verification χ = V − E + F = 2 − 2g on triangulated surfaces.',
  },
  license: 'MIT',
  entry: 'example.math-topology',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'demonstration',
    units: { chi: 'dimensionless', genus: 'dimensionless', loopLength: 'units' },
    benchmarks: ['topology-benchmarks'],
    reproducible: true,
    notes:
      'Benchmarks: (1) torus grid V − E + F = 0 (χ = 0, genus 1); (2) sphere grid V − E + F = 2 (χ = 2, genus 0); (3) Möbius centre-circle normal reverses after one full turn (dot ≈ −1 vs orientable reference +1 → relErr ≈ 2); (4) every sample surface is finite-valued with a closed seam (max gap/extent < 1e-12). Unified error metric |computed − analytic|/|analytic| (unit denominator when the analytic value is zero).',
    notesI18n: {
      'zh-CN':
        '验证基准（统一相对误差口径 |计算−解析|/|解析|，解析值为 0 时取单位分母）：① 环面网格 V − E + F = 0（χ = 0，亏格 1）；② 球面网格 V − E + F = 2（χ = 2，亏格 0）；③ Möbius 中心圈法向量绕一周反向（dot ≈ −1，对照可定向参考值 +1 → relErr ≈ 2）；④ 全部样本曲面顶点有限且缝隙闭合（最大缝隙/尺度 < 1e-12）。',
      'en-US':
        'Benchmarks (unified metric |computed − analytic|/|analytic|, unit denominator when the analytic value is zero): (1) torus grid V − E + F = 0 (χ = 0, genus 1); (2) sphere grid V − E + F = 2 (χ = 2, genus 0); (3) Möbius centre-circle normal reverses after one turn (dot ≈ −1 vs +1 → relErr ≈ 2); (4) sample surfaces finite-valued with closed seams (max gap/extent < 1e-12).',
    },
  },
};
