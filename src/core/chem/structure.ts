// ==========================================================================
// Physical-chemistry core — molecular & crystal structure model + geometry
//
// Framework-free types and arithmetic shared by the format parsers (CIF,
// POSCAR, XYZ, MOL), the crystal preview plugin, and the reaction engine.
// Periodic-box distance handling uses the minimum-image convention.
// ==========================================================================

import { atomicMass, covalentRadius } from './elements';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Atom {
  symbol: string;
  x: number;
  y: number;
  z: number;
  /** Optional atom label (e.g. from MOL/POSCAR column). */
  label?: string;
}

export interface BondRecord {
  a: number;
  b: number;
  /** Bond order: 1 single, 2 double, 3 triple, etc. */
  order: number;
  /** Fractional delta from atom `a` to the bonded periodic image of `b`
   *  (periodic cells only; several records may exist for one atom pair). */
  image?: Vec3;
}

/** A finite molecular structure (not necessarily periodic). */
export interface Molecule {
  name: string;
  atoms: Atom[];
  bonds: BondRecord[];
}

/** Unit-cell lengths (Å) and angles (deg). */
export interface CellParams {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

/** An atom inside a crystal, in fractional coordinates of one unit cell. */
export interface CellSite {
  symbol: string;
  fx: number;
  fy: number;
  fz: number;
  /** Occupancy (0..1); default 1. */
  occupancy: number;
  label?: string;
}

export interface CrystalCell {
  name: string;
  params: CellParams;
  sites: CellSite[];
  /** Optional remark (e.g. space group / source). */
  note?: string;
}

// ---- scalar helpers -------------------------------------------------------

export const HALF_TURN = Math.PI * 2;
export const DEG = Math.PI / 180;

export function vecDist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function fractionalWrap(f: Vec3): Vec3 {
  const w = (v: number) => v - Math.floor(v);
  return { x: w(f.x), y: w(f.y), z: w(f.z) };
}

/** Fractional coordinates reduced to the range (-0.5, 0.5] for min-image use. */
export function reducedImage(f: Vec3): Vec3 {
  const w = (v: number): number => {
    let r = v - Math.round(v);
    if (r <= -0.5) r += 1;
    return r;
  };
  return { x: w(f.x), y: w(f.y), z: w(f.z) };
}

/**
 * Cartesian lattice matrix from cell parameters. Rows a, b, c are Cartesian
 * basis vectors with a along x and b in the x–y plane (a #1 convention).
 */
export function latticeMatrix(p: CellParams): [Vec3, Vec3, Vec3] {
  const al = p.alpha * DEG;
  const be = p.beta * DEG;
  const ga = p.gamma * DEG;
  const ca = Math.cos(al);
  const cb = Math.cos(be);
  const cg = Math.cos(ga);
  const sg = Math.sin(ga);
  const cy = Math.sqrt(Math.max(0, 1 - cb * cb - ((ca - cb * cg) / sg) ** 2));
  const ax = p.a;
  const bx = p.b * cg;
  const by = p.b * sg;
  const cx = p.c * cb;
  const cy_ = p.c * (ca - cb * cg) / sg;
  const cz = p.c * cy;
  return [
    { x: ax, y: 0, z: 0 },
    { x: bx, y: by, z: 0 },
    { x: cx, y: cy_, z: cz },
  ];
}

/** Unit-cell volume (Å³). */
export function cellVolume(p: CellParams): number {
  const [a, b, c] = latticeMatrix(p);
  // scalar triple product a·(b×c)
  const bx_c = {
    x: b.y * c.z - b.z * c.y,
    y: b.z * c.x - b.x * c.z,
    z: b.x * c.y - b.y * c.x,
  };
  return Math.abs(a.x * bx_c.x + a.y * bx_c.y + a.z * bx_c.z);
}

/** Derive unit-cell parameters from three Cartesian lattice vectors. */
export function cellParamsFromVectors(a: Vec3, b: Vec3, c: Vec3): CellParams {
  const la = vecDist({ x: 0, y: 0, z: 0 }, { x: a.x, y: a.y, z: a.z });
  const lb = vecDist({ x: 0, y: 0, z: 0 }, { x: b.x, y: b.y, z: b.z });
  const lc = vecDist({ x: 0, y: 0, z: 0 }, { x: c.x, y: c.y, z: c.z });
  const angle = (x: Vec3, y: Vec3) => {
    const cosv = dot(x, y) / (vecDist({ x: 0, y: 0, z: 0 }, x) * vecDist({ x: 0, y: 0, z: 0 }, y));
    return Math.acos(Math.max(-1, Math.min(1, cosv))) / DEG;
  };
  return {
    a: la,
    b: lb,
    c: lc,
    alpha: angle(b, c),
    beta: angle(a, c),
    gamma: angle(a, b),
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Fractional → Cartesian (precompute matrix once with `latticeMatrix`). */
export function fractionalToCartesian(p: CellParams, f: Vec3): Vec3 {
  const [a, b, c] = latticeMatrix(p);
  return {
    x: a.x * f.x + b.x * f.y + c.x * f.z,
    y: a.y * f.x + b.y * f.y + c.y * f.z,
    z: a.z * f.x + b.z * f.y + c.z * f.z,
  };
}

const _inv3 = (p: CellParams): Vec3[] => {
  const [a, b, c] = latticeMatrix(p);
  const det =
    a.x * (b.y * c.z - b.z * c.y) -
    a.y * (b.x * c.z - b.z * c.x) +
    a.z * (b.x * c.y - b.y * c.x);
  const inv = 1 / det;
  return [
    {
      x: (b.y * c.z - b.z * c.y) * inv,
      y: (b.z * c.x - b.x * c.z) * inv,
      z: (b.x * c.y - b.y * c.x) * inv,
    },
    {
      x: (c.y * a.z - c.z * a.y) * inv,
      y: (c.z * a.x - c.x * a.z) * inv,
      z: (c.x * a.y - c.y * a.x) * inv,
    },
    {
      x: (a.y * b.z - a.z * b.y) * inv,
      y: (a.z * b.x - a.x * b.z) * inv,
      z: (a.x * b.y - a.y * b.x) * inv,
    },
  ];
};

/** Cartesian → fractional. */
export function cartesianToFractional(p: CellParams, c: Vec3): Vec3 {
  const inv = _inv3(p);
  const ra = inv[0]!;
  const rb = inv[1]!;
  const rc = inv[2]!;
  return {
    x: ra.x * c.x + ra.y * c.y + ra.z * c.z,
    y: rb.x * c.x + rb.y * c.y + rb.z * c.z,
    z: rc.x * c.x + rc.y * c.y + rc.z * c.z,
  };
}

/**
 * True minimum-image fractional delta from `a` to the nearest periodic image
 * of `b` (add it to `a` in fractional space to reach that image). Component-
 * wise wrapping (`reducedImage`) is not the true minimum for strongly
 * non-orthogonal lattices (hexagonal γ=120°, rhombohedral α≈46°), so images
 * within ±2 neighbouring cells are compared explicitly.
 */
export function minImageDelta(p: CellParams, a: Vec3, b: Vec3): Vec3 {
  const [A, B, C] = latticeMatrix(p);
  const lenSq = (f: Vec3): number => {
    const x = A.x * f.x + B.x * f.y + C.x * f.z;
    const y = A.y * f.x + B.y * f.y + C.y * f.z;
    const z = A.z * f.x + B.z * f.y + C.z * f.z;
    return x * x + y * y + z * z;
  };
  const base = reducedImage({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
  let best: Vec3 = base;
  let bestLen = lenSq(base);
  for (let i = -2; i <= 2; i += 1) {
    for (let j = -2; j <= 2; j += 1) {
      for (let k = -2; k <= 2; k += 1) {
        if (i === 0 && j === 0 && k === 0) continue;
        const cand: Vec3 = { x: base.x + i, y: base.y + j, z: base.z + k };
        const len = lenSq(cand);
        if (len < bestLen) {
          bestLen = len;
          best = cand;
        }
      }
    }
  }
  return best;
}

/**
 * Minimum-image distance between two fractional positions in a periodic cell.
 * Infinity when no cell is supplied (caller should use vecDist).
 */
export function minImageDistance(p: CellParams, a: Vec3, b: Vec3): number {
  const d = minImageDelta(p, a, b);
  return vecDist({ x: 0, y: 0, z: 0 }, fractionalToCartesian(p, d));
}

// ---- bonds ----------------------------------------------------------------

export interface BondInferOptions {
  /** Multiplicative tolerance on the sum of covalent radii. */
  tolerance?: number;
  /** Periodic boundary for infinite crystals (enables min-image bonding). */
  cell?: CellParams;
}

const DEFAULT_BOND_TOLERANCE = 1.18;

/**
 * Elements whose same-element contacts are genuine covalent bonds (C–C
 * skeletons, S–S disulfide dimers, Si–Si, peroxides, halogens). Same-element
 * contacts between metals or metal–nonmetal partners within the radius cutoff
 * are lattice packing distances, not bonds, and must not be drawn.
 */
const COVALENT_SAME_ELEMENT = new Set([
  'H', 'B', 'C', 'N', 'O', 'F', 'Si', 'P', 'S', 'Cl', 'Se', 'Br', 'Te', 'I',
]);

/**
 * Metallic elements (post-transition, transition, alkali/alkaline-earth,
 * lanthanides). Contacts between two metals — same or different element —
 * are lattice packing / alloy skeleton distances (e.g. Cu–Cu in fcc copper,
 * Ca–Ti or Sr–Ti in perovskites), not localised covalent bonds, and must not
 * be drawn.
 */
const METALLIC = new Set([
  'Li', 'Be', 'Na', 'Mg', 'Al', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe',
  'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru',
  'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm',
  'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W',
  'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'Ra',
]);

/**
 * Every lattice-image deltas from `a` to periodic images of `b` whose
 * cartesian length is below `cutoff` (bonding to several images of the same
 * site is what completes e.g. the 6-coordination of rock-salt Na).
 */
function imagesWithinCutoff(p: CellParams, a: Vec3, b: Vec3, cutoff: number): Vec3[] {
  const [A, B, C] = latticeMatrix(p);
  const lenOf = (f: Vec3): number => {
    const x = A.x * f.x + B.x * f.y + C.x * f.z;
    const y = A.y * f.x + B.y * f.y + C.y * f.z;
    const z = A.z * f.x + B.z * f.y + C.z * f.z;
    return Math.sqrt(x * x + y * y + z * z);
  };
  const base = reducedImage({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
  const out: Vec3[] = [];
  for (let u = -2; u <= 2; u += 1) {
    for (let v = -2; v <= 2; v += 1) {
      for (let w = -2; w <= 2; w += 1) {
        const d: Vec3 = { x: base.x + u, y: base.y + v, z: base.z + w };
        const len = lenOf(d);
        if (len < cutoff && len > 1e-6) out.push(d);
      }
    }
  }
  return out;
}

/**
 * Infer a covalent-bond graph from 3-D coordinates using the covalent-radius
 * rule: a bond exists when the distance is within `tolerance`× the sum of the
 * two covalent radii. Supports a periodic cell (min-image) for crystals.
 */
export function inferBonds(atoms: Atom[], opts: BondInferOptions = {}): BondRecord[] {
  const tol = opts.tolerance ?? DEFAULT_BOND_TOLERANCE;
  const out: BondRecord[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      const ra = covalentRadius(atoms[i]!.symbol);
      const rb = covalentRadius(atoms[j]!.symbol);
      if (ra <= 0 || rb <= 0) continue;
      const symA = atoms[i]!.symbol;
      const symB = atoms[j]!.symbol;
      if (symA === symB && !COVALENT_SAME_ELEMENT.has(symA)) continue;
      if (symA !== symB && METALLIC.has(symA) && METALLIC.has(symB)) continue;
      const cutoff = (ra + rb) * tol;
      if (opts.cell) {
        for (const image of imagesWithinCutoff(opts.cell, atoms[i]!, atoms[j]!, cutoff)) {
          out.push({ a: i, b: j, order: 1, image });
        }
      } else if (vecDist(atoms[i]!, atoms[j]!) < cutoff) {
        out.push({ a: i, b: j, order: 1 });
      }
    }
  }
  return out;
}

// ---- composition / formula ------------------------------------------------

/** Count atoms per element across a structure or composition. */
export function atomCounts(atomicSymbols: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of atomicSymbols) out[s] = (out[s] ?? 0) + 1;
  return out;
}

/** Composition of a written formula (e.g. "Na2Cl2" → {Na:2, Cl:2}) in Hill order. */
export function compositionFormula(comp: Record<string, number>): string {
  const vals = Object.entries(comp).filter(([, n]) => n > 0);
  if (vals.length === 0) return '';
  const g = gcdOfCounts(comp);
  const ordered = stableFormulaOrder(vals);
  return ordered
    .map(([sym, n]) => {
      const q = n / g;
      return `${sym}${q > 1 ? q : ''}`;
    })
    .join('');
}

/** Sort formula fragments: C first, H next, then alphabetical for the rest. */
function stableFormulaOrder(entries: Array<[string, number]>): Array<[string, number]> {
  const rank = (sym: string): number => (sym === 'C' ? 0 : sym === 'H' ? 1 : 2);
  return [...entries].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

function gcdOfCounts(c: Record<string, number>): number {
  const vals = Object.values(c);
  if (vals.length === 0) return 1;
  return vals.reduce((x, y) => (y === 0 ? x : gcd(x, y)), Math.abs(vals[0]!));
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

/** Molar mass (g/mol) of a composition map. */
export function molarMass(comp: Record<string, number>): number {
  let m = 0;
  for (const [sym, n] of Object.entries(comp)) m += atomicMass(sym) * n;
  return m;
}

/** Density estimate (g/cm³) from a formula, cell + sites. */
export function cellDensity(params: CellParams, composition: Record<string, number>): number {
  const volume = cellVolume(params); // Å³
  if (volume <= 0) return 0;
  const mass = molarMass(composition); // g/mol
  // g/cm³ = (mass g/mol) / volume(Å³) / N_A(dimensionless conversion to cm³)
  // 1 Å³ = 1e-24 cm³, and N_A = 6.022e23 → mass/vol/volume  * (1e24/6.022e23)
  return (mass / volume) * (1e24 / 6.02214076e23);
}