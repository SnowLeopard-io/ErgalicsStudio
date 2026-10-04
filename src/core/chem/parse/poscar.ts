// ==========================================================================
// POSCAR (VASP) parser
//
// VASP5 format:
//   <comment / system name>
//   <scale factor>
//   <a vector> | <b vector> | <c vector>    (3x3)   OR  a 0 0 / 0 b 0 / 0 0 c
//   [<element symbols>]                     (VASP5, optional in VASP4)
//   <counts per species>  (may be on the same line as symbols)
//   [Selective dynamics]
//   Direct | Fractional | Cartesian | Cartesian+z
//   <coordinate lines>  (fractional or cartesian, exclusive to Direct/Cart)
// ==========================================================================

import type { CellParams, CellSite, Vec3 } from '../structure';
import { cellParamsFromVectors, cartesianToFractional, fractionalWrap } from '../structure';
import { normalizeSymbol } from '../elements';

export interface PoscarParseResult {
  name: string;
  params: CellParams;
  sites: CellSite[];
}

const isNum = (s: string): boolean => s !== '' && !Number.isNaN(Number(s));

function parseNumbers(line: string): number[] {
  return line
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** Parse POSCAR text → cell + sites. Throws a descriptive Error on malformed input. */
export function parsePoscar(text: string): PoscarParseResult {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const toks: string[] = [];
  for (const l of lines) if (l) toks.push(l);

  if (toks.length < 5) throw new Error('POSCAR too short (need lattice + coordinate block).');

  const name = toks[0]!;
  const scale = Number(toks[1]);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('POSCAR scale factor must be a positive number.');

  const parseVec = (s: string): Vec3 => {
    const n = parseNumbers(s);
    if (n.length < 3) throw new Error(`POSCAR lattice vector malformed: "${s}"`);
    return { x: n[0]! * scale, y: n[1]! * scale, z: n[2]! * scale };
  };
  const a1 = parseVec(toks[2]!);
  const a2 = parseVec(toks[3]!);
  const a3 = parseVec(toks[4]!);
  const params = cellParamsFromVectors(a1, a2, a3);

  let idx = 5;
  // VASP5 optional element-symbols line (only if it is *not* purely numeric).
  let species: string[] = [];
  {
    const head = toks[idx]!.split(/\s+/).filter(Boolean);
    if (head.length > 0 && head.every((t) => !isNum(t))) {
      species = head.map(normalizeSymbol);
      idx += 1;
    } else if (head.some((t) => isNum(t))) {
      // Possibly "Na4 Cl4" inline form → rebuild species + counts from it.
      const rebuilt: string[] = [];
      const countsFrom = head.map((t) => {
        const m = t.match(/^([A-Za-z]+)(\d+)$/);
        if (m) {
          rebuilt.push(m[1]!);
          return Number(m[2]);
        }
        return isNum(t) ? Number(t) : NaN;
      });
      if (countsFrom.every((n) => Number.isFinite(n)) && rebuilt.length === countsFrom.length) {
        const pairs: Array<{ sym: string; n: number }> = [];
        for (let p = 0; p < countsFrom.length; p += 1) {
          const n = countsFrom[p]!;
          pairs.push({ sym: rebuilt[p] ?? 'X', n });
        }
        return finishPoscar(name, params, toks, idx + 1, pairs, species.length === 0);
      }
    }
  }

  // Species-count line.
  const countTokens = toks[idx]!.split(/\s+/).filter(Boolean);
  const counts = countTokens.map(Number).filter((n) => Number.isFinite(n));
  if (counts.length === 0) throw new Error('POSCAR missing species counts line.');
  const pairs = counts.map((n, s) => ({ sym: species[s] ?? 'X', n }));
  idx += 1;

  return finishPoscar(name, params, toks, idx, pairs, false);
}

function finishPoscar(
  name: string,
  params: CellParams,
  toks: string[],
  start: number,
  pairs: Array<{ sym: string; n: number }>,
  anonymous: boolean,
): PoscarParseResult {
  let idx = start;
  let cart = false;
  if (/selective/i.test(toks[idx] ?? '')) idx += 1;
  if (idx < toks.length) {
    const mode = (toks[idx] ?? '').toLowerCase();
    if (mode === 'direct' || mode.startsWith('direc') || mode.startsWith('frac')) idx += 1;
    else if (mode.startsWith('cart') || mode === 'kpoints') {
      cart = true;
      idx += 1;
    }
  }

  const allNames = pairs.flatMap((p) => Array(p.n).fill(p.sym));
  const sites: CellSite[] = [];
  let cursor = 0;
  for (let k = idx; k < toks.length; k += 1) {
    const nums = parseNumbers(toks[k]!);
    if (nums.length < 3) continue;
    const symbol = anonymous ? 'X' : allNames[Math.min(cursor, allNames.length - 1)] ?? 'X';
    const raw: Vec3 = { x: nums[0]!, y: nums[1]!, z: nums[2]! };
    const frac = cart ? cartesianToFractional(params, raw) : fractionalWrap(raw);
    sites.push({ symbol, fx: frac.x, fy: frac.y, fz: frac.z, occupancy: 1 });
    cursor += 1;
  }
  if (sites.length === 0) throw new Error('POSCAR contains no coordinate rows.');
  return { name, params, sites };
}