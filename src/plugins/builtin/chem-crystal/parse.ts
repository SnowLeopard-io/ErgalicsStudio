// ==========================================================================
// chem-crystal — structural-format dispatch (pure, testable)
//
// Routes a loaded text file to the right chem-core parser and normalises the
// result to a `CrystalCell`. XYZ files without an embedded lattice are still
// accepted but carry a unit box synthesized for display.
// ==========================================================================

import type { CrystalCell, CellParams } from '@/chem/structure';
import { parseCif, type CifCrystal } from '@/chem/parse/cif';
import { parsePoscar, type PoscarParseResult } from '@/chem/parse/poscar';
import { parseXyz, type XyzFrame } from '@/chem/parse/xyz';

export type StructuralFormat = 'cif' | 'poscar' | 'xyz';

export type LoadedCell = {
  cell: CrystalCell;
  format: StructuralFormat;
  hasLattice: boolean;
};

const DEFAULT_CUBE: CellParams = { a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 90 };

function cellFromCif(x: CifCrystal): CrystalCell {
  return { name: x.name, params: x.params, sites: x.sites, note: x.spaceGroup ? `Space group ${x.spaceGroup}` : undefined };
}

function cellFromPoscar(x: PoscarParseResult): CrystalCell {
  return { name: x.name, params: x.params, sites: x.sites };
}

function cellFromXyz(frame: XyzFrame): CrystalCell {
  const params = frame.cell ?? DEFAULT_CUBE;
  return {
    name: frame.name,
    params,
    sites: frame.atoms.map((a) => ({ symbol: a.symbol, fx: a.x, fy: a.y, fz: a.z, occupancy: 1 })),
  };
}

/** Detect format from the file extension, falling back on content probes. */
export function detectFormat(text: string, fileName: string): StructuralFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'cif') return 'cif';
  if (ext === 'poscar' || ext === 'vasp') return 'poscar';
  if (ext === 'xyz') return 'xyz';
  // Content probes for unknown extensions.
  if (/\b_cell_\w+\b/.test(text.slice(0, 2000))) return 'cif';
  if (/^\s*[\w.-]+\s*\n\s*-?[0-9]/.test(text)) return 'poscar';
  if (/^\s*\d+\s*\n/.test(text)) return 'xyz';
  return 'cif';
}

/**
 * Parse structural text into a crystal cell + metadata. Throws a descriptive
 * Error when the content cannot be interpreted as a supported structure.
 */
export function parseStructure(text: string, fileName: string): LoadedCell {
  const format = detectFormat(text, fileName);

  if (format === 'cif') {
    const cif = parseCif(text);
    return { cell: cellFromCif(cif), format, hasLattice: true };
  }
  if (format === 'poscar') {
    const pos = parsePoscar(text);
    return { cell: cellFromPoscar(pos), format, hasLattice: true };
  }
  const frames = parseXyz(text);
  if (frames.length === 0) throw new Error('XYZ 文件未包含有效原子数据。');
  const frame = frames[0]!;
  return { cell: cellFromXyz(frame), format, hasLattice: Boolean(frame.cell) };
}