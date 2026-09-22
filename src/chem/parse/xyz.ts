// ==========================================================================
// .xyz parser (multi-frame)
//
// Standard XYZ:
//   <natoms>
//   <comment>                       — may hold "Lattice=\"...\"" (ASE) or "cell"
//   <symbol> <x> <y> <z>
//   ...
//
// Multiple frames can be concatenated. The comment line is scanned for a cell
// embedding so periodic XYZ files (e.g. from ASE) keep their lattice.
// ==========================================================================

import type { Atom, CellParams, Vec3 } from '../structure';
import { cellParamsFromVectors } from '../structure';

export interface XyzFrame {
  name: string;
  atoms: Atom[];
  cell?: CellParams;
}

/** Extract lattice from an XYZ comment line (ASE "Lattice=\"...\"" / "cell"). */
export function latticeFromComment(line: string): CellParams | undefined {
  const m = line.match(/Lattice\s*=\s*"([^"]+)"/i) ?? line.match(/\bcell\s*[:=]\s*([^;,\n]+)/i);
  if (!m) return undefined;
  const nums = m[1]!.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length === 9) {
    const a: Vec3 = { x: nums[0]!, y: nums[1]!, z: nums[2]! };
    const b: Vec3 = { x: nums[3]!, y: nums[4]!, z: nums[5]! };
    const c: Vec3 = { x: nums[6]!, y: nums[7]!, z: nums[8]! };
    return cellParamsFromVectors(a, b, c);
  }
  if (nums.length === 6) {
    return { a: nums[0]!, b: nums[1]!, c: nums[2]!, alpha: nums[3]!, beta: nums[4]!, gamma: nums[5]! };
  }
  // VMD/older style: three distances, 90° angles.
  if (nums.length >= 3) {
    return { a: nums[0]!, b: nums[1]!, c: nums[2]!, alpha: 90, beta: 90, gamma: 90 };
  }
  return undefined;
}

function sanitizeAtom(line: string): Atom | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const symbol = parts[0]!;
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  const z = Number(parts[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { symbol, x, y, z, label: parts.length > 4 ? parts.slice(4).join(' ') : undefined };
}

/** Parse an XYZ text into one or more frames. Empty input → []. */
export function parseXyz(text: string): XyzFrame[] {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const frames: XyzFrame[] = [];
  let i = 0;
  while (i < lines.length) {
    const countLine = lines[i]!;
    const n = Number(countLine);
    if (!Number.isFinite(n) || n <= 0) {
      i += 1;
      continue;
    }
    const comment = lines[i + 1]?.trim() ?? '';
    const cell = latticeFromComment(comment);
    const atoms: Atom[] = [];
    let j = i + 2;
    const end = Math.min(lines.length, i + 2 + n);
    for (; j < end; j += 1) {
      const atom = sanitizeAtom(lines[j] ?? '');
      if (atom) atoms.push(atom);
    }
    frames.push({ name: `${frames.length + 1}`, atoms, cell });
    i = end;
  }
  return frames;
}

/** Convenience: first frame as a bare atom list (no cell). */
export function parseXyzAtoms(text: string): Atom[] {
  const f = parseXyz(text)[0];
  return f ? f.atoms : [];
}