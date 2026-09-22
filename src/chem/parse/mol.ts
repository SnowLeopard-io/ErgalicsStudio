// ==========================================================================
// MOL / SDF (molfile) parser
//
// Reads an MDL molfile into a Molecule (atoms + bonds + 3-D coordinates).
// Used by the reaction plugin to turn real stored molecular geometries into a
// structure-driven reaction computation. Bond orders come straight from the
// molecule block (single/double/triple/aromatic).
// ==========================================================================

import type { Atom, BondRecord, Molecule } from '../structure';
import { normalizeSymbol } from '../elements';

export interface MolDoc {
  name: string;
  molecules: Molecule[];
}

/** Parse a MOL/SDF (single or multi-record) text into molecules. */
export function parseMol(text: string): MolDoc {
  const raw = text.replace(/\r/g, '');
  const records = raw.split(/\$\$\$\$/);
  const molecules: Molecule[] = [];
  for (const rec of records) {
    const mol = parseMolRecord(rec);
    if (mol) molecules.push(mol);
  }
  return { name: molecules[0]?.name ?? '', molecules };
}

function parseMolRecord(rec: string): Molecule | null {
  const lines = rec.split('\n');
  let idx = 0;
  // header (3 lines)
  const name = (lines[idx] ?? '').trim();
  idx = Math.min(3, lines.length);
  // counts line
  const countsLine = lines[idx];
  if (!countsLine) return null;
  idx += 1;
  const counts = countsLine.trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
  const nAtoms = counts[0] ?? 0;
  const nBonds = counts[1] ?? 0;
  if (nAtoms <= 0) return null;

  const atoms: Atom[] = [];
  for (let a = 0; a < nAtoms && idx < lines.length; a += 1, idx += 1) {
    const line = lines[idx]!.trim();
    const parts = line.split(/\s+/);
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    const symbol = normalizeSymbol(parts[3] ?? 'X');
    atoms.push({ symbol, x, y, z, label: parts.length > 4 ? parts.slice(4).join(' ') : undefined });
  }

  const bonds: BondRecord[] = [];
  for (let b = 0; b < nBonds && idx < lines.length; b += 1, idx += 1) {
    const parts = lines[idx]!.trim().split(/\s+/).map(Number);
    if (parts.length < 3) continue;
    const [a1, a2, order] = parts as number[];
    if (!Number.isFinite(a1) || !Number.isFinite(a2)) continue;
    bonds.push({ a: a1! - 1, b: a2! - 1, order: Number.isFinite(order) ? order! : 1 });
  }

  if (atoms.length === 0) return null;
  return { name, atoms, bonds };
}

/** Single-molecule helper. */
export function parseMolSingle(text: string): Molecule | null {
  return parseMol(text).molecules[0] ?? null;
}