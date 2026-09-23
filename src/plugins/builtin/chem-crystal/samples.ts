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
import diamondCif from '../../../../examples/data/chem-diamond.cif?raw';
import graphiteCif from '../../../../examples/data/chem-graphite.cif?raw';
import zincblendeCif from '../../../../examples/data/chem-zincblende.cif?raw';
import copperCif from '../../../../examples/data/chem-copper.cif?raw';
import dryiceCif from '../../../../examples/data/chem-dryice.cif?raw';
import perovskiteCif from '../../../../examples/data/chem-perovskite.cif?raw';
import perovskiteStCif from '../../../../examples/data/chem-perovskite-st.cif?raw';

export interface CrystalSample {
  id: string;
  nameZh: string;
  nameEn: string;
  /** Provenance: COD entry number of the bundled CIF. */
  source: string;
  cell: CrystalCell;
}

function fromCif(id: string, nameZh: string, nameEn: string, source: string, text: string): CrystalSample {
  const parsed = parseCif(text);
  return {
    id,
    nameZh,
    nameEn,
    source,
    cell: {
      name: nameEn,
      params: parsed.params,
      sites: parsed.sites,
      note: parsed.spaceGroup ? `Space group ${parsed.spaceGroup}` : undefined,
    },
  };
}

export const CRYSTAL_SAMPLES: CrystalSample[] = [
  fromCif('nacl', '氯化钠', 'Sodium chloride', 'COD 1000041', naclCif),
  fromCif('quartz', 'α-石英', 'α-Quartz', 'COD 1011159', quartzCif),
  fromCif('calcite', '方解石', 'Calcite', 'COD 1010928', calciteCif),
  fromCif('fluorite', '萤石', 'Fluorite', 'COD 1000043', fluoriteCif),
  fromCif('rutile', '金红石', 'Rutile', 'COD 1530150', rutileCif),
  fromCif('pyrite', '黄铁矿', 'Pyrite', 'COD 1544891', pyriteCif),
  fromCif('diamond', '金刚石', 'Diamond', 'COD 2300702', diamondCif),
  fromCif('graphite', '石墨', 'Graphite', 'COD 1200017', graphiteCif),
  fromCif('zincblende', '闪锌矿', 'Zinc blende', 'COD 1100043', zincblendeCif),
  fromCif('copper', '铜', 'Copper', 'COD 5000216', copperCif),
  fromCif('dryice', '干冰', 'Dry ice', 'COD 1010489', dryiceCif),
  fromCif('perovskite', '钙钛矿', 'Perovskite', 'COD 1567488', perovskiteCif),
  fromCif('perovskite-st', '钛酸锶', 'Strontium titanate', 'COD 1574067', perovskiteStCif),
];

export function findSample(id: string): CrystalSample | undefined {
  return CRYSTAL_SAMPLES.find((s) => s.id === id);
}
