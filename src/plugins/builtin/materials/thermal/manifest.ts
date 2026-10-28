// ==========================================================================
// Thermal analysis (DSC / TGA) plugin — manifest
//
// Loads a DSC (temperature / heat flow) or TGA (temperature / mass) curve,
// performs baseline-corrected peak detection, computes the extrapolated
// onset and peak temperatures, integrates the transition enthalpy (DSC),
// and steps off mass-loss segments with their onset / residual (TGA).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const matsThermalManifest: PluginManifest = {
  id: 'example.mats-thermal',
  name: 'Thermal Analysis (DSC/TGA)',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'DSC / TGA curve analyser: baseline-corrected onset & peak temperature, transition enthalpy integration (DSC) and mass-loss step decomposition (TGA).',
  nameI18n: {
    'zh-CN': '热分析（DSC/TGA）',
    'en-US': 'Thermal Analysis (DSC/TGA)',
  },
  descriptionI18n: {
    'zh-CN':
      '载入 DSC（温度-热流）或 TGA（温度-质量）曲线，进行基线校正后的峰检出、外推起始温度与峰值温度计算；DSC 积分相变焓变，TGA 分解失重台阶并输出起始温度与残重。',
    'en-US':
      'Load a DSC (temperature / heat flow) or TGA (temperature / mass) curve for baseline-corrected peak detection, extrapolated onset & peak temperatures, transition enthalpy integration (DSC) and mass-loss step decomposition (TGA).',
  },
  license: 'MIT',
  entry: 'example.mats-thermal',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { temperature: '°C', heatFlow: 'mW', enthalpy: 'mW·°C', mass: '%', rate: '°C/min' },
    reproducible: true,
    notes:
      'Standard thermal-analysis extraction (onset by tangent intersection, enthalpy by trapezoidal baseline integration); assumes linear heating and a polynomial baseline — not a full kinetics fit.',
    notesI18n: {
      'zh-CN':
        '标准热分析提取（切线交点法起始温度、梯形基线积分焓变）；假设线性升温与多项式基线，非完整动力学拟合。',
      'en-US':
        'Standard thermal-analysis extraction (onset by tangent intersection, enthalpy by trapezoidal baseline integration); assumes linear heating and a polynomial baseline — not a full kinetics fit.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'temperature,signal CSV' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'temperature,signal TSV' },
    { extension: '.dat', mimeTypes: ['text/plain'], description: 'whitespace temperature, signal columns' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'temperature, signal text' },
  ],
};
