// ==========================================================================
// Powder XRD pattern analysis plugin — manifest
//
// Loads a powder diffraction pattern (2θ vs. intensity), runs prominence-
// thresholded peak detection, converts each peak to a d-spacing via Bragg's
// law with a selectable anode wavelength, and attempts cubic lattice-
// parameter refinement by matching peaks to allowed hkl reflections.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const matsXrdManifest: PluginManifest = {
  id: 'example.mats-xrd',
  name: 'XRD Pattern Analysis',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Powder XRD pattern analyser: prominence-based peak detection, Bragg d-spacing, cubic lattice-parameter refinement and reference-phase matching.',
  nameI18n: {
    'zh-CN': 'XRD 衍射图谱分析',
    'en-US': 'XRD Pattern Analysis',
  },
  descriptionI18n: {
    'zh-CN':
      '载入粉末衍射谱（2θ–强度），进行基于突出度的峰检出、按布拉格定律换算 d 间距、对立方晶系做最小二乘晶格常数精修，并与常见物相参考卡比对。',
    'en-US':
      'Load a powder diffraction pattern (2θ–intensity) for prominence-based peak detection, Bragg d-spacing conversion, least-squares cubic lattice-parameter refinement, and common reference-phase comparison.',
  },
  license: 'MIT',
  entry: 'example.mats-xrd',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { angle: '°', wavelength: 'Å', dSpacing: 'Å', lattice: 'Å' },
    reproducible: true,
    notes:
      'Real Bragg/Bragg-Brentano geometry numerics with prominence peak detection and least-squares cubic a-refinement; reference phases are coarse identification hints, not Rietveld quantification.',
    notesI18n: {
      'zh-CN':
        '基于真实布拉格-布伦塔诺几何：突出度峰检出 + 最小二乘立方 a 精修；参考物相比对仅为粗识别提示，非 Rietveld 定量。',
      'en-US':
        'Real Bragg/Bragg-Brentano geometry numerics with prominence peak detection and least-squares cubic a-refinement; reference phases are coarse identification hints, not Rietveld quantification.',
    },
  },
  formats: [
    { extension: '.xy', mimeTypes: ['text/plain', 'application/octet-stream'], description: 'GSAS / FullProf 2-column 2θ, I' },
    { extension: '.xye', mimeTypes: ['text/plain'], description: '2θ, I, σ 3-column pattern' },
    { extension: '.csv', mimeTypes: ['text/csv'], description: '2θ,intensity CSV' },
    { extension: '.dat', mimeTypes: ['text/plain'], description: 'whitespace 2θ, I columns' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: '2θ, intensity text' },
  ],
};
