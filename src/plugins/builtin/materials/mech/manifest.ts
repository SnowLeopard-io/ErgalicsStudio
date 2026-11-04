// ==========================================================================
// Tensile stress-strain analysis plugin — manifest
//
// Loads an engineering stress-strain curve and computes the full set of
// tensile mechanical-property indices: Young's modulus (elastic-region
// regression), 0.2 % offset yield strength, ultimate tensile strength,
// uniform / fracture elongation, Hollomon strain-hardening exponent, and
// resilience / toughness (trapezoidal area under the curve).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const matsMechManifest: PluginManifest = {
  id: 'example.mats-mech',
  name: 'Stress-Strain Analysis',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    "Tensile curve analyser: Young's modulus (elastic regression), 0.2 % offset yield, UTS, elongation, Hollomon n, resilience and toughness.",
  nameI18n: {
    'zh-CN': '应力-应变分析',
    'en-US': 'Stress-Strain Analysis',
  },
  descriptionI18n: {
    'zh-CN':
      '载入工程应力-应变曲线，计算完整拉伸力学指标：杨氏模量（弹性段回归）、0.2% 偏置屈服强度、抗拉强度、伸长率、Hollomon 应变硬化指数、弹性比能与断裂韧性（曲线下面积）。',
    'en-US':
      "Load an engineering stress-strain curve to compute Young's modulus (elastic-region regression), 0.2 % offset yield strength, UTS, elongation, Hollomon strain-hardening exponent, resilience and toughness (area under the curve).",
  },
  license: 'MIT',
  entry: 'example.mats-mech',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { strain: 'mm/mm', stress: 'MPa', modulus: 'GPa', energy: 'MJ/m³' },
    reproducible: true,
    notes:
      'Standard ASTM E8 / GB/T 228 tensile-property extraction with elastic-region regression and 0.2 % offset yield; engineering (not true) stress-strain, so toughness is the engineering area under the curve.',
    notesI18n: {
      'zh-CN':
        '依据 ASTM E8 / GB/T 228 的标准拉伸性能提取：弹性段回归 + 0.2% 偏置屈服；使用工程应力-应变，韧性为曲线下工程面积。',
      'en-US':
        'Standard ASTM E8 / GB/T 228 tensile-property extraction with elastic-region regression and 0.2 % offset yield; engineering (not true) stress-strain, so toughness is the engineering area under the curve.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'strain,stress CSV' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'strain,stress TSV' },
    { extension: '.dat', mimeTypes: ['text/plain'], description: 'whitespace strain, stress columns' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'strain, stress text' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON array of {strain,stress} points' },
  ],
};
