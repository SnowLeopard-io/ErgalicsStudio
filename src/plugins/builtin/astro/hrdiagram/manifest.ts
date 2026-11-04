// ==========================================================================
// astro-hrdiagram — Hertzsprung–Russell diagram — manifest
//
// Loads a star catalogue (name, B−V, V[, parallax]), plots colour index
// against apparent or absolute magnitude, annotates the empirical
// main-sequence reference and the solar anchor, and cross-checks the
// distance-modulus conversion against analytic anchors.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const astroHrdiagramManifest: PluginManifest = {
  id: 'example.astro-hrdiagram',
  name: 'Hertzsprung–Russell Diagram',
  nameI18n: { 'zh-CN': '赫罗图（HR 图）', 'en-US': 'Hertzsprung–Russell Diagram' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Colour–magnitude workbench: plots a star catalogue (B−V vs V, or absolute M_V via Hipparcos parallaxes), overlays the empirical main-sequence reference and the solar anchor, and fits the observed main-sequence slope.',
  descriptionI18n: {
    'zh-CN':
      '色-星等工作台：绘制星表散点（B−V 对 V，或按 Hipparcos 视差换算绝对星等 M_V），叠加经验主序参考线与太阳锚点，并可对主序段做线性拟合与经验值对照。',
    'en-US':
      'Colour–magnitude workbench: plots a star catalogue (B−V vs V, or absolute M_V via Hipparcos parallaxes), overlays the empirical main-sequence reference and the solar anchor, and fits the observed main-sequence slope.',
  },
  license: 'MIT',
  entry: 'example.astro-hrdiagram',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { colour: 'B−V (mag)', magnitude: 'mag', parallax: 'arcsec' },
    benchmarks: ['distance-modulus-anchor'],
    reproducible: true,
    notes:
      'Validation: distance-modulus anchors M_V = V + 5 + 5·log10(π″) reproduce M_V = 4.83 at 10 pc and M_V = 9.83 at 1 pc exactly, and M_V = 4.8301 for V = 0.401 at the Proxima-Centauri parallax 0.7687″ (err < 1e-3); the solar anchor (B−V = 0.65, M_V = 4.83) sits on the class-V reference within 0.05 mag; the reference interpolation is strictly monotonic and C0-continuous. The main-sequence line uses standard MK class-V textbook knots (linear interpolation, approximate to ~0.1–0.2 mag — guidance, not calibration). Bundled example: Yale Bright Star Catalog 5th ed. (public domain), V ≤ 3.0 and B−V ≤ 1.6, with Hipparcos parallaxes.',
    notesI18n: {
      'zh-CN':
        '验证基准：距离模数 M_V = V + 5 + 5·log10(π″) 在 10 pc 处精确给出 M_V = 4.83、1 pc 处给出 9.83，且 V = 0.401、比邻星视差 0.7687″ 时给出 4.8301（误差 <1e-3）；太阳锚点（B−V=0.65、M_V=4.83）落在光度型 V 参考线上 0.05 mag 内；参考线插值严格单调且 C0 连续。主序参考线采用标准 MK 光度型 V 教科书节点（线性插值，近似度 ~0.1–0.2 mag，仅为视觉参考而非定标）。内置示例：Yale 亮星星表第 5 版（公版），V≤3.0 且 B−V≤1.6，附 Hipparcos 视差。',
      'en-US':
        'Validation: distance-modulus anchors M_V = V + 5 + 5·log10(π″) reproduce M_V = 4.83 at 10 pc and M_V = 9.83 at 1 pc exactly, and M_V = 4.8301 for V = 0.401 at the Proxima-Centauri parallax 0.7687″ (err < 1e-3); the solar anchor (B−V = 0.65, M_V = 4.83) sits on the class-V reference within 0.05 mag; the reference interpolation is strictly monotonic and C0-continuous. The main-sequence line uses standard MK class-V textbook knots (linear interpolation, approximate to ~0.1–0.2 mag — guidance, not calibration). Bundled example: Yale Bright Star Catalog 5th ed. (public domain), V ≤ 3.0 and B−V ≤ 1.6, with Hipparcos parallaxes.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'name,bv,v[,parallax] star table (parallax in arcsec)' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated star table' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace-separated star table' },
  ],
};
