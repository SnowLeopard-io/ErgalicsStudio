// ==========================================================================
// Carbon cycle — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const carbonManifest: PluginManifest = {
  id: 'example.env-carbon',
  name: 'Carbon Cycle',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Four-pool box model (atmosphere / vegetation / soil / ocean) with scenario stepping.',
  nameI18n: {
    'zh-CN': '碳循环推演',
    'en-US': 'Carbon Cycle',
  },
  descriptionI18n: {
    'zh-CN': '四碳库 box 模型（大气 / 植被 / 土壤 / 海洋，GtC）：库间以 donor-controlled 年通量相连（光合吸收、呼吸、凋落物、海气交换），人为排放滑块与预设情景（工业时代 / 当前 / 减排）驱动时间步进，输出各库余额曲线与净汇/净源标签；可载入自定义 pool,initial_gtc,flux_in,flux_out CSV 覆盖初始库存。',
    'en-US': 'A four-pool carbon box model (atmosphere / vegetation / soil / ocean, GtC) coupled by donor-controlled annual fluxes (photosynthesis, respiration, litterfall, air–sea exchange). Scenario presets and an emission slider drive the time stepping with per-pool curves and net source/sink labels; a custom pool,initial_gtc,flux_in,flux_out CSV can override initial stocks.',
  },
  license: 'MIT',
  entry: 'example.env-carbon',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { carbon: 'GtC', flux: 'GtC/yr', time: 'yr' },
    reproducible: true,
    notes: 'Linear donor-controlled box model calibrated to a pre-industrial steady state — not an Earth-system model. Monte-Carlo 95% intervals (seeded mulberry32) reflect ±10% uniform perturbations of the six rate constants and the emission only; the mass-balance deviation doubles as a zero-clamping diagnostic.',
    notesI18n: {
      'zh-CN': '线性 donor-controlled 箱模型，速率常数校准至前工业稳态——不是地球系统模式。Monte-Carlo 95% 区间（种子化 mulberry32）仅反映 6 个速率常数与排放的 ±10% 均匀扰动；质量守恒偏差兼作截零诊断。',
      'en-US': 'Linear donor-controlled box model calibrated to a pre-industrial steady state — not an Earth-system model. Monte-Carlo 95% intervals (seeded mulberry32) reflect ±10% uniform perturbations of the six rate constants and the emission only; the mass-balance deviation doubles as a zero-clamping diagnostic.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'pool,initial_gtc,flux_in,flux_out' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'pool,initial_gtc,flux_in,flux_out' },
  ],
};
