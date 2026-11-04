// ==========================================================================
// Water-waves plugin — manifest
//
// Two real-computation modes: a GPU FDTD solver of the linear wave equation
// (click-to-drop, rain, two-source interference, sponge boundaries, caustics)
// and a deep-water Gerstner ocean on the exact ω² = g·k dispersion with
// Pierson–Moskowitz sea scaling and Jacobian-based foam.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const waterManifest: PluginManifest = {
  id: 'fx.water',
  name: 'Water · 3D Fluid Waves',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'GPU fluid waves: FDTD solver of the 2-D wave equation (interactive drops, rain, double-source interference, caustics) plus a Gerstner deep-water ocean on the exact ω² = g·k dispersion with Pierson–Moskowitz scaling.',
  nameI18n: {
    'zh-CN': '水波 · 3D 流体',
    'en-US': 'Water · 3D Fluid Waves',
  },
  descriptionI18n: {
    'zh-CN':
      'GPU 流体水波：波动方程 FDTD 求解器（点击滴落、雨滴、双源干涉、吸收边界、池底焦散）+ 精确深水色散 ω²=g·k 的 Gerstner 海面（Pierson–Moskowitz 海况标度、雅可比白沫）。',
    'en-US':
      'GPU fluid waves: an FDTD solver of the 2-D wave equation (interactive drops, rain, double-source interference, sponge boundaries, floor caustics) plus a Gerstner deep-water ocean on the exact ω² = g·k dispersion with Pierson–Moskowitz scaling and Jacobian foam.',
  },
  license: 'MIT',
  entry: 'fx.water',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'demonstration',
    units: { length: 'm', time: 's', speed: 'm/s' },
    reproducible: true,
    notes:
      'Ripples: linear wave equation (FDTD, CFL-stability enforced, shallow-water speed c=√(gh)). Ocean: Gerstner trains — an industry-standard kinematic model with the exact deep-water dispersion, not a Navier–Stokes solve.',
    notesI18n: {
      'zh-CN':
        '涟漪：线性波动方程（FDTD，满足 CFL 稳定性，浅水波速 c=√(gh)）。海面：Gerstner 波列——工业界标准运动学模型、精确深水色散关系，并非 Navier–Stokes 求解。',
      'en-US':
        'Ripples: linear wave equation (FDTD, CFL-stability enforced, shallow-water speed c=√(gh)). Ocean: Gerstner trains — an industry-standard kinematic model with the exact deep-water dispersion, not a Navier–Stokes solve.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'Scene preset (mode, drops, sea state)' }],
};
