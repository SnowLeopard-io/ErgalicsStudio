// ==========================================================================
// Built-in crystal samples for the crystal-preview plugin
//
// Real unit cells constructed from fractional coordinates (no symmetry magic
// needed for these classic structures). They give the plugin something to show
// before the user loads a CIF / POSCAR / XYZ file, and double as golden data
// for the parser + renderer unit tests.
// ==========================================================================

import type { CellParams, CellSite, CrystalCell } from '@/chem/structure';

export interface CrystalSample {
  id: string;
  nameZh: string;
  nameEn: string;
  cell: CrystalCell;
}

function cubicCell(a: number): CellParams {
  return { a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 };
}

function site(symbol: string, fx: number, fy: number, fz: number): CellSite {
  return { symbol, fx, fy, fz, occupancy: 1 };
}

const NaCl: CrystalCell = {
  name: 'NaCl',
  params: cubicCell(5.64),
  sites: [
    // Cl on a face-centred lattice (corners + face centres).
    site('Cl', 0, 0, 0),
    site('Cl', 0.5, 0.5, 0),
    site('Cl', 0.5, 0, 0.5),
    site('Cl', 0, 0.5, 0.5),
    // Na in the octahedral holes (edge centres + body centre).
    site('Na', 0.5, 0.5, 0.5),
    site('Na', 0, 0, 0.5),
    site('Na', 0, 0.5, 0),
    site('Na', 0.5, 0, 0),
  ],
  note: 'Rock salt / 岩盐',
};

const CsCl: CrystalCell = {
  name: 'CsCl',
  params: cubicCell(4.113),
  sites: [site('Cs', 0, 0, 0), site('Cl', 0.5, 0.5, 0.5)],
  note: 'Caesium chloride / 氯化铯',
};

const Diamond: CrystalCell = {
  name: 'C',
  params: cubicCell(3.567),
  sites: [
    site('C', 0, 0, 0),
    site('C', 0, 0.5, 0.5),
    site('C', 0.5, 0, 0.5),
    site('C', 0.5, 0.5, 0),
    site('C', 0.25, 0.25, 0.25),
    site('C', 0.25, 0.75, 0.75),
    site('C', 0.75, 0.25, 0.75),
    site('C', 0.75, 0.75, 0.25),
  ],
  note: 'Diamond / 金刚石',
};

export const CRYSTAL_SAMPLES: CrystalSample[] = [
  { id: 'nacl', nameZh: '氯化钠', nameEn: 'Sodium chloride', cell: NaCl },
  { id: 'cscl', nameZh: '氯化铯', nameEn: 'Caesium chloride', cell: CsCl },
  { id: 'diamond', nameZh: '金刚石', nameEn: 'Diamond', cell: Diamond },
];

export function findSample(id: string): CrystalSample | undefined {
  return CRYSTAL_SAMPLES.find((s) => s.id === id);
}