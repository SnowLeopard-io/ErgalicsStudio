// ==========================================================================
// CIF (Crystallographic Information File) parser
//
// A pragmatic CIF subset covering unit-cell parameters, symmetry operations
// and atom-site loops — enough to rebuild a full, occupancy-correct unit cell
// from the asymmetric unit for the crystal-preview plugin. Handles:
//   data_ blocks, loop_ tables, quoted / block-string values, fractional or
//   Cartesian coordinates, and _symmetry_equiv_pos_as_xyz expansion.
// ==========================================================================

import type { CellParams, CellSite, Vec3 } from '../structure';
import { cellParamsFromVectors, cartesianToFractional, fractionalWrap } from '../structure';
import { normalizeSymbol } from '../elements';

export interface CifCrystal {
  name: string;
  params: CellParams;
  sites: CellSite[];
  spaceGroup?: string;
}

/** A single crystallographic symmetry operation: f' = R·f + t. */
export interface SymOp {
  R: number[][]; // 3×3, entries 0/±1 (or ±1/2 scaling) in crystallographic ops
  t: number[]; // translation fractions
}

// ---- tokenizer ------------------------------------------------------------

type Tok = string;

function tokenizeCif(text: string): Tok[] {
  const src = text.replace(/\r/g, '');
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i += 1;
      continue;
    }
    // block string: starts ';' at beginning of a line
    if (ch === ';') {
      const end = src.indexOf(';', i + 1);
      const tok = end === -1 ? src.slice(i + 1) : src.slice(i + 1, end);
      toks.push(tok);
      i = end === -1 ? n : end + 1;
      continue;
    }
    // quoted value
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n && src[j] !== ch) j += 1;
      toks.push(src.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    if (ch === '#') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    // capture a token up to whitespace
    let j = i;
    while (j < n && !/[\s]/.test(src[j]!)) j += 1;
    toks.push(src.slice(i, j));
    i = j;
  }
  return toks;
}

// ---- symmetry ops ---------------------------------------------------------

const FRACTION = /^(?:(-?\d+)\/)?(-?\d+(?:\.\d*)?)$/;

function toNumber(s: string): number {
  // Strip standard-uncertainty suffixes, e.g. "5.4170(1)" → "5.4170".
  const m = s.replace(/\(\d+\)$/, '').match(FRACTION);
  if (!m) return NaN;
  if (m[1] !== undefined && m[1] !== '') {
    // "num/den" → numerator / denominator (m[1] is num, m[2] is den).
    const num = Number(m[1]);
    const den = Number(m[2]);
    return den === 0 ? NaN : num / den;
  }
  return Number(m[2]);
}

/** Parse one coordinate expression like "1/2+x", "-y", "z+1/3" → [coeffX, coeffY, coeffZ, const]. */
function parseCoord(expr: string): [number, number, number, number] {
  const coeff: [number, number, number, number] = [0, 0, 0, 0];
  const s = expr.replace(/\s+/g, '');
  let m: RegExpExecArray | null;
  const re = /([+-]?)(?:(\d+)(?:\/(\d+))?)?([xyz])|([+-]?)(\d+)(?:\/(\d+))?/g;
  while ((m = re.exec(s))) {
    const [full, sign1, n1, d1, var1, sign2, n2, d2] = m as unknown as string[];
    if (!full) continue;
    if (var1) {
      const signMul = sign1 === '-' ? -1 : 1;
      const val = signMul * (n1 ? Number(n1) : 1) / (d1 ? Number(d1) : 1);
      coeff['xyz'.indexOf(var1)] = val;
    } else {
      const signMul = sign2 === '-' ? -1 : 1;
      coeff[3] += signMul * (n2 ? Number(n2) : 0) / (d2 ? Number(d2) : 1);
    }
  }
  return coeff;
}

/** Parse a symmetry op string like "x, y, -z+1/2" → SymOp. */
export function parseSymOp(opExpr: string): SymOp {
  const parts = opExpr.split(',').map((s) => s.trim());
  const R: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const t: number[] = [0, 0, 0];
  for (let row = 0; row < 3 && row < parts.length; row += 1) {
    const c = parseCoord(parts[row]!);
    R[row] = [c[0], c[1], c[2]];
    t[row] = c[3];
  }
  return { R, t };
}

function applySym(sym: SymOp, f: Vec3): Vec3 {
  const R0 = sym.R[0]!;
  const R1 = sym.R[1]!;
  const R2 = sym.R[2]!;
  return {
    x: R0[0]! * f.x + R0[1]! * f.y + R0[2]! * f.z + sym.t[0]!,
    y: R1[0]! * f.x + R1[1]! * f.y + R1[2]! * f.z + sym.t[1]!,
    z: R2[0]! * f.x + R2[1]! * f.y + R2[2]! * f.z + sym.t[2]!,
  };
}

// ---- assembler ------------------------------------------------------------

interface RawSite {
  symbol: string;
  label: string;
  fract?: Vec3;
  cartn?: Vec3;
  occupancy: number;
}

/**
 * Expand the asymmetric unit through the symmetry operations, wrapping into
 * the unit cell. Coincident images merge into one atom with a small
 * tolerance — special positions reproduce the same site from several ops, and
 * real refined coordinates can differ in their last decimals. Occupancy only
 * accumulates when DIFFERENT elements share a position (disorder).
 */
function wrapSites(raw: RawSite[], params: CellParams, syms: SymOp[]): CellSite[] {
  const TOL2 = 1e-6; // (1e-3 fractional units)²
  const folded = (d: number): number => d - Math.round(d); // PBC-aware delta
  const acc: Array<{ symbol: string; f: Vec3; occ: number }> = [];
  for (const site of raw) {
    const base = site.fract ? { ...site.fract } : cartesianToFractional(params, site.cartn!);
    const ops = syms.length > 0 ? syms : [{ R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] }];
    for (const op of ops) {
      const f = fractionalWrap(applySym(op, base));
      const hit = acc.find((s) => {
        const dx = folded(s.f.x - f.x);
        const dy = folded(s.f.y - f.y);
        const dz = folded(s.f.z - f.z);
        return dx * dx + dy * dy + dz * dz < TOL2;
      });
      if (hit) {
        if (hit.symbol !== site.symbol) hit.occ += site.occupancy;
      } else {
        acc.push({ symbol: site.symbol, f, occ: site.occupancy });
      }
    }
  }
  return acc
    .filter((s) => s.occ > 0)
    .map(({ symbol, f, occ }) => ({ symbol, fx: f.x, fy: f.y, fz: f.z, occupancy: occ }));
}

/** Parse CIF text → cell + full unit cell. Throws descriptive Error if no atoms found. */
export function parseCif(text: string): CifCrystal {
  const toks = tokenizeCif(text);
  // sequential tag→value pairs + loop_ blocks
  const singles = new Map<string, string>();
  const loops: Array<{ cols: string[]; rows: Tok[][] }> = [];
  let i = 0;
  let name = '';
  while (i < toks.length) {
    const t = toks[i]!;
    if (t.startsWith('data_')) {
      name = t.slice(5);
      i += 1;
      continue;
    }
    if (t === 'loop_' || t === 'loop') {
      i += 1;
      const cols: string[] = [];
      while (i < toks.length && toks[i]!.startsWith('_')) {
        cols.push(toks[i]!.toLowerCase());
        i += 1;
      }
      const rows: Tok[][] = [];
      while (i < toks.length && !toks[i]!.startsWith('_') && !toks[i]!.startsWith('data_') && toks[i] !== 'loop_') {
        const row = toks.slice(i, i + cols.length);
        rows.push(row);
        i += cols.length;
      }
      loops.push({ cols, rows });
      continue;
    }
    if (t.startsWith('_')) {
      const key = t.toLowerCase();
      const val = i + 1 < toks.length ? (toks[i + 1] ?? '') : '';
      // avoid consuming a data_/loop_ mark as a value
      if (val.startsWith('_') || val.startsWith('data_') || val === 'loop_') {
        singles.set(key, '');
        i += 1;
      } else {
        singles.set(key, val || '');
        i += 2;
      }
      continue;
    }
    i += 1;
  }

  // Unit cell
  const num = (k: string, d: number): number => {
    const v = singles.get(k);
    const x = v === undefined ? NaN : toNumber(v);
    return Number.isFinite(x) ? x : d;
  };
  const cellOrigin: CellParams | undefined = (() => {
    const a = num('_cell_length_a', NaN);
    const b = num('_cell_length_b', NaN);
    const c = num('_cell_length_c', NaN);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return undefined;
    return {
      a,
      b,
      c,
      alpha: num('_cell_angle_alpha', 90),
      beta: num('_cell_angle_beta', 90),
      gamma: num('_cell_angle_gamma', 90),
    };
  })();
  // Alternative direct-lattice-vector form
  let params: CellParams | undefined = cellOrigin;
  if (!params) {
    const vecs = ['_space_group_transform_p_xyz_to_a_b_c', '_cell_vector_a', '_cell_vector_b', '_cell_vector_c'];
    const got = vecs.filter((k) => singles.has(k));
    if (got.length >= 3) {
      const parseVec = (k: string): Vec3 => {
        const v = singles.get(k)!.replace(/[[\]]/g, '').trim().split(/[\s,]+/).map(toNumber);
        const p = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
        return { x: p[0]!, y: p[1]!, z: p[2]! };
      };
      params = cellParamsFromVectors(
        parseVec('_cell_vector_a'),
        parseVec('_cell_vector_b'),
        parseVec('_cell_vector_c'),
      );
    }
  }
  if (!params) throw new Error('CIF missing valid unit-cell parameters (_cell_length_*).');

  // symmetry ops — old `_symmetry_equiv_pos_as_xyz` or CIF-core
  // `_space_group_symop_operation_xyz` tag
  const SYM_OP_TAGS = ['_symmetry_equiv_pos_as_xyz', '_space_group_symop_operation_xyz'];
  const symLoop = loops.find((l) => l.cols.some((c) => SYM_OP_TAGS.includes(c)));
  const syms: SymOp[] = [];
  if (symLoop) {
    const ci = symLoop.cols.findIndex((c) => SYM_OP_TAGS.includes(c));
    for (const row of symLoop.rows) {
      const expr: string = (row[ci] ?? '').toString();
      if (expr.trim()) syms.push(parseSymOp(expr));
    }
  } else {
    const s = singles.get('_symmetry_equiv_pos_as_xyz') ?? singles.get('_space_group_symop_operation_xyz');
    if (s) syms.push(parseSymOp(s));
  }

  // atom sites
  const atomLoop = loops.find((l) => l.cols.some((c) => c.includes('_atom_site_')));
  const raw: RawSite[] = [];
  if (atomLoop) {
    const cols = atomLoop.cols;
    const idxOf = (k: string): number => cols.indexOf(k);
    const isFract = idxOf('_atom_site_fract_x') >= 0;
    const typeCol = idxOf('_atom_site_type_symbol') >= 0 ? idxOf('_atom_site_type_symbol') : idxOf('_atom_site_label');
    const occCol = idxOf('_atom_site_occupancy');
    const fx = idxOf('_atom_site_fract_x');
    const cx = idxOf('_atom_site_cartn_x');
    for (const row of atomLoop.rows) {
      const symbol = (row[typeCol] ?? '?').toString().trim();
      if (!symbol || symbol === '?') continue;
      let fract: Vec3 | undefined;
      let cartn: Vec3 | undefined;
      if (isFract && fx >= 0) {
        fract = {
          x: toNumber(row[fx]!.toString()),
          y: toNumber(row[idxOf('_atom_site_fract_y')]!.toString()),
          z: toNumber(row[idxOf('_atom_site_fract_z')]!.toString()),
        };
      } else if (cx >= 0) {
        cartn = {
          x: toNumber(row[cx]!.toString()),
          y: toNumber(row[idxOf('_atom_site_cartn_y')]!.toString()),
          z: toNumber(row[idxOf('_atom_site_cartn_z')]!.toString()),
        };
      }
      const occ = occCol >= 0 ? toNumber(row[occCol]!.toString()) : 1;
      raw.push({
        symbol: normalizeSymbol(symbol),
        label: symbol,
        fract,
        cartn,
        occupancy: Number.isFinite(occ) ? occ : 1,
      });
    }
  }

  const sites = wrapSites(raw, params, syms);
  if (sites.length === 0) throw new Error('CIF contains no atom-site data.');

  const spaceGroup =
    singles.get('_symmetry_space_group_name_h-m')?.replace(/['"]/g, '').trim() ||
    singles.get('_space_group_name_h-m')?.replace(/['"]/g, '').trim();

  return { name: name || 'crystal', params, sites, spaceGroup };
}