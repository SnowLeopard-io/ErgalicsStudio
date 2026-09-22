// ==========================================================================
// 3-D crystal unit-cell preview plugin — manifest
//
// Loads real crystal cells from the mainstream structural formats (CIF, VASP
// POSCAR, XYZ) and renders them as interactive 3-D ball-and-stick / space-
// filling unit cells with the computed reduced formula, density estimate and
// automatically inferred bonds.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const chemCrystalManifest: PluginManifest = {
  id: 'example.chem-crystal',
  name: 'Crystal · 3D Unit Cell',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Parse CIF / VASP POSCAR / XYZ crystal cells and preview the unit cell in 3-D: atoms, periodic bonds, reduced formula and density estimate.',
  nameI18n: {
    'zh-CN': '晶胞 · 3D 预览',
    'en-US': 'Crystal · 3D Unit Cell',
  },
  descriptionI18n: {
    'zh-CN': '加载 CIF / POSCAR / XYZ 主流晶胞格式，3D 查看原子、周期性化学键、有效组成与密度估算。',
    'en-US': 'Load CIF / POSCAR / XYZ cells and inspect atoms, periodic bonds, reduced formula and density in 3-D.',
  },
  license: 'MIT',
  entry: 'example.chem-crystal',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    { extension: '.cif', mimeTypes: ['chemical/x-cif', 'text/plain'], description: 'Crystallographic Information File' },
    { extension: '.poscar', mimeTypes: ['text/plain'], description: 'VASP POSCAR' },
    { extension: '.vasp', mimeTypes: ['text/plain'], description: 'VASP POSCAR' },
    { extension: '.xyz', mimeTypes: ['chemical/x-xyz', 'text/plain'], description: 'XYZ coordinates' },
  ],
};