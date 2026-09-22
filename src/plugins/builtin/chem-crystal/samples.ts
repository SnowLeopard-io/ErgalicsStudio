// ==========================================================================
// Built-in crystal samples for the crystal-preview plugin
//
// Every sample is a real structure from the Crystallography Open Database
// (COD, CC0), bundled as a CIF and expanded through its symmetry operations
// at module load. They give the plugin something to show before the user
// loads a CIF / POSCAR / XYZ file, and double as golden data for the parser
// + renderer unit tests.
// ==========================================================================

import type { CrystalCell } from '@/chem/structure';
import { parseCif } from '@/chem/parse/cif';

import naclCif from '../../../../examples/data/chem-nacl.cif?raw';
import quartzCif from '../../../../examples/data/chem-quartz.cif?raw';
import calciteCif from '../../../../examples/data/chem-calcite.cif?raw';
import fluoriteCif from '../../../../examples/data/chem-fluorite.cif?raw';
import rutileCif from '../../../../examples/data/chem-rutile.cif?raw';
import pyriteCif from '../../../../examples/data/chem-pyrite.cif?raw';

export interface CrystalSample {
  id: string;
  nameZh: string;
  nameEn: string;
  cell: CrystalCell;
}

function fromCif(id: string, nameZh: string, nameEn: string, text: string): CrystalSample {
  const parsed = parseCif(text);
  return {
    id,
    nameZh,
    nameEn,
    cell: {
      name: nameEn,
      params: parsed.params,
      sites: parsed.sites,
      note: parsed.spaceGroup ? `Space group ${parsed.spaceGroup}` : undefined,
    },
  };
}

export const CRYSTAL_SAMPLES: CrystalSample[] = [
  fromCif('nacl', '氯化钠', 'Sodium chloride', naclCif),
  fromCif('quartz', 'α-石英', 'α-Quartz', quartzCif),
  fromCif('calcite', '方解石', 'Calcite', calciteCif),
  fromCif('fluorite', '萤石', 'Fluorite', fluoriteCif),
  fromCif('rutile', '金红石', 'Rutile', rutileCif),
  fromCif('pyrite', '黄铁矿', 'Pyrite', pyriteCif),
];

export function findSample(id: string): CrystalSample | undefined {
  return CRYSTAL_SAMPLES.find((s) => s.id === id);
}
