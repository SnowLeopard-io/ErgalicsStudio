// ==========================================================================
// Pure crystal-derived observable helpers (no DOM / three dependency)
//
// From a real `CrystalCell` compute the physically meaningful summary shown
// alongside the 3-D preview: per-element effective atom counts (occupancy-
// weighted), the reduced empirical formula, formula units per cell (Z),
// molar mass and an estimated density. Kept dependency-free for unit tests.
// ==========================================================================

import type { CellParams, CellSite } from '@/core/chem/structure';
import { atomicMass, electronegativity } from '@/core/chem/elements';
import { cellDensity, cellVolume } from '@/core/chem/structure';

export interface CellObservables {
  /** Effective atom counts per element (sum of occupancies). */
  counts: Record<string, number>;
  /** Elements sorted by descending count. */
  symbols: string[];
  /** Reduced integer ratio, largest-count first. */
  reduced: Array<[string, number]>;
  /** Reduced empirical formula string, e.g. "NaCl". */
  formula: string;
  /** Molar mass of the reduced formula (g/mol). */
  molarMass: number;
  /** Formula units per unit cell. */
  z: number;
  /** Density estimate (g/cm³). */
  density: number;
}

/** Effective per-element atom count from a site list (occupancy weighted). */
export function effectiveCounts(sites: readonly CellSite[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sites) out[s.symbol] = (out[s.symbol] ?? 0) + s.occupancy;
  return out;
}

/**
 * Reduce a (possibly fractional) count map to the smallest integer ratio.
 * Instead of scaling by a fixed thousandth (which fails for occupancies whose
 * denominator exceeds 1000, e.g. 1/3, 2/3, 1/16), each count is normalised to
 * the smallest count and approximated by a continued-fraction rational with a
 * bounded denominator; the denominators are then combined via LCM and the
 * result divided by the GCD. Exact for integer stoichiometries and robust to
 * common fractional occupancies.
 */
export function reduceCounts(counts: Record<string, number>): Array<[string, number]> {
  const entries = Object.entries(counts).filter(([, n]) => n > 1e-6);
  if (entries.length === 0) return [];
  // Normalise to the smallest count: ratios of the form A : B = 1 : r.
  const min = Math.min(...entries.map(([, n]) => n));
  const ratios = entries.map(([s, n]) => [s, n / min] as [string, number]);
  // Approximate each ratio by a rational p/q with q ≤ MAX_DENOM.
  const fracs = ratios.map(([s, r]) => [s, rationalApprox(r)] as [string, [number, number]]);
  // Common denominator = LCM of all denominators.
  let denom = 1;
  for (const [, [, q]] of fracs) denom = lcm(denom, q);
  const scaled = fracs.map(([s, [p, q]]) => [s, Math.round((p * denom) / q)] as [string, number]);
  let g = scaled[0]![1];
  for (const [, n] of scaled) g = gcd(g, n);
  if (g === 0) g = 1;
  const reduced = scaled.map(([s, n]) => [s, n / g] as [string, number]);
  reduced.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return reduced;
}

/** Largest denominator allowed when approximating an occupancy ratio. */
const MAX_DENOM = 100;

/**
 * Approximate a positive float by a rational p/q (q ≤ MAX_DENOM) using the
 * Stern-Brocot / continued-fraction walk. Returns [p, q] in lowest terms.
 */
function rationalApprox(x: number): [number, number] {
  if (!Number.isFinite(x) || x <= 0) return [1, 1];
  // Exact integers short-circuit.
  const rounded = Math.round(x);
  if (Math.abs(x - rounded) < 1e-9) return [rounded, 1];
  let loN = 0;
  let loD = 1;
  let hiN = 1;
  let hiD = 0;
  for (;;) {
    const mN = loN + hiN;
    const mD = loD + hiD;
    if (mD > MAX_DENOM) break;
    const mid = mN / mD;
    if (mid < x) {
      loN = mN;
      loD = mD;
    } else if (mid > x) {
      hiN = mN;
      hiD = mD;
    } else {
      return [mN, mD];
    }
  }
  // Return whichever bound is closer.
  const lo = loN / loD;
  const hi = hiD > 0 ? hiN / hiD : Infinity;
  return Math.abs(lo - x) <= Math.abs(hi - x) ? [loN, loD] : [hiN, hiD];
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** Reduced empirical formula string like "NaCl", "SiO2". */
export function reducedFormula(counts: Record<string, number>): string {
  return formatFormula(reduceCounts(counts));
}

/**
 * Render a reduced ratio as a formula string ordered by textbook convention:
 * the more electropositive (lower electronegativity) element first — matches
 * NaCl, CaF₂, TiO₂ and H₂O — with alphabetical order as a tie-break.
 */
export function formatFormula(reduced: Array<[string, number]>): string {
  return [...reduced]
    .sort((a, b) => electronegativity(a[0]) - electronegativity(b[0]) || a[0].localeCompare(b[0]))
    .map(([s, n]) => `${s}${n > 1 ? n : ''}`)
    .join('');
}

export function cellObservables(params: CellParams, sites: readonly CellSite[]): CellObservables {
  const counts = effectiveCounts(sites);
  const reduced = reduceCounts(counts);
  const reducedMass = reduced.reduce((m, [s, n]) => m + atomicMass(s) * n, 0);
  const cellMass = Object.entries(counts).reduce((m, [s, n]) => m + atomicMass(s) * n, 0);
  const z = reducedMass > 0 ? Math.max(1, Math.round(cellMass / reducedMass)) : 1;
  return {
    counts,
    symbols: Object.keys(counts).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0)),
    reduced,
    formula: formatFormula(reduced),
    molarMass: reducedMass,
    z,
    density: cellDensity(params, counts),
  };
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

/** Human-readable density with sensible units. */
export function formatDensity(value: number): string {
  return `${value.toFixed(2)} g/cm³`;
}

// ---- literature lattice references ----------------------------------------

/** Room-temperature literature cell parameters (Å) for common compounds. */
export interface LatticeReference {
  /** Reduced empirical formula in `formatFormula` order (electronegativity). */
  formula: string;
  a: number;
  /** undefined when equal to a (cubic) or not part of the check. */
  b?: number;
  c?: number;
  /** phase / setting note. */
  phase: string;
}

export const LATTICE_REFERENCES: readonly LatticeReference[] = [
  { formula: 'NaCl', a: 5.64, phase: 'halite, Fm-3m' },
  { formula: 'KCl', a: 6.291, phase: 'sylvite, Fm-3m' },
  { formula: 'CsCl', a: 4.123, phase: 'CsCl type, Pm-3m' },
  { formula: 'SiO2', a: 4.913, c: 5.405, phase: 'α-quartz, P3₁21' },
  { formula: 'CaCO3', a: 4.989, c: 17.061, phase: 'calcite, R-3c (hex. setting)' },
  { formula: 'CaF2', a: 5.464, phase: 'fluorite, Fm-3m' },
  { formula: 'TiO2', a: 4.594, c: 2.959, phase: 'rutile, P4₂/mnm' },
  { formula: 'FeS2', a: 5.417, phase: 'pyrite, Pa-3' },
  { formula: 'C', a: 3.567, phase: 'diamond, Fd-3m' },
  { formula: 'C', a: 2.461, c: 6.708, phase: 'graphite, P6₃/mmc' },
  { formula: 'ZnS', a: 5.409, phase: 'zinc blende, F-43m' },
  { formula: 'Cu', a: 3.615, phase: 'copper, Fm-3m' },
  { formula: 'CO2', a: 5.572, phase: 'dry ice (solid CO₂), Pa-3' },
  { formula: 'SrTiO3', a: 3.905, phase: 'perovskite, Pm-3m' },
  { formula: 'CaTiO3', a: 5.44, b: 7.644, c: 5.382, phase: 'perovskite, Pnma (RT)' },
  { formula: 'MgO', a: 4.212, phase: 'periclase, Fm-3m' },
  { formula: 'Al2O3', a: 4.759, c: 12.99, phase: 'corundum, R-3c (hex. setting)' },
];

export interface LatticeMatch {
  reference: LatticeReference;
  /** mean signed relative deviation (%) over the axes the reference defines. */
  devPct: number;
  /** per-axis relative deviations (%) in a, b, c order (defined axes only). */
  axes: number[];
}

/**
 * Match a cell against the literature table by reduced formula. When several
 * references share a formula (e.g. C = diamond vs graphite) the candidate
 * with the smallest mean |relative deviation| over the defined axes wins,
 * which also disambiguates the phase from the cell geometry itself.
 */
export function matchLatticeReference(params: CellParams, formula: string): LatticeMatch | null {
  const candidates = LATTICE_REFERENCES.filter((r) => r.formula === formula);
  if (candidates.length === 0) return null;
  const cellAxes = [params.a, params.b, params.c];
  const refAxes: Array<(r: LatticeReference) => number | undefined> = [(r) => r.a, (r) => r.b, (r) => r.c];
  let best: LatticeMatch | null = null;
  for (const ref of candidates) {
    const axes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const rv = refAxes[i]!(ref);
      const cv = cellAxes[i]!;
      if (rv === undefined || !(rv > 0) || !(cv > 0)) continue;
      axes.push(((cv - rv) / rv) * 100);
    }
    if (axes.length === 0) continue;
    const dev = axes.reduce((s, x) => s + x, 0) / axes.length;
    if (!best || Math.abs(dev) < Math.abs(best.devPct)) best = { reference: ref, devPct: dev, axes };
  }
  return best;
}

export interface DensityCheck {
  /** occupancy-weighted density from the site list (g/cm³). */
  occupancy: number;
  /** ideal stoichiometric density Z·M/(N_A·V) (g/cm³). */
  stoichiometric: number;
  /** relative deviation of occupancy vs stoichiometric density (%). */
  relDevPct: number;
}

/**
 * Self-consistency check between the occupancy-weighted density (what the
 * site list physically contains) and the ideal stoichiometric density
 * Z·M/(N_A·V) built from the reduced formula. Partial occupancies make the
 * former smaller — the relative deviation quantifies that gap.
 */
export function densityDeviation(params: CellParams, sites: readonly CellSite[]): DensityCheck | null {
  const v = cellVolume(params);
  if (!(v > 0)) return null;
  const counts = effectiveCounts(sites);
  const occupancy = cellDensity(params, counts);
  const reduced = reduceCounts(counts);
  const molarMass = reduced.reduce((m, [s, n]) => m + atomicMass(s) * n, 0);
  const cellMass = Object.entries(counts).reduce((m, [s, n]) => m + atomicMass(s) * n, 0);
  const z = molarMass > 0 ? Math.max(1, Math.round(cellMass / molarMass)) : 1;
  const stoichiometric = (z * molarMass / v) * (1e24 / 6.02214076e23);
  if (!(stoichiometric > 1e-9)) return null;
  return { occupancy, stoichiometric, relDevPct: ((occupancy - stoichiometric) / stoichiometric) * 100 };
}