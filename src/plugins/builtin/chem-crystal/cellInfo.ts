// ==========================================================================
// Pure crystal-derived observable helpers (no DOM / three dependency)
//
// From a real `CrystalCell` compute the physically meaningful summary shown
// alongside the 3-D preview: per-element effective atom counts (occupancy-
// weighted), the reduced empirical formula, formula units per cell (Z),
// molar mass and an estimated density. Kept dependency-free for unit tests.
// ==========================================================================

import type { CellParams, CellSite } from '@/chem/structure';
import { atomicMass, electronegativity } from '@/chem/elements';
import { cellDensity } from '@/chem/structure';

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
 * Reduce a (possibly fractional) count map to the smallest integer ratio by
 * scaling to a common thousandth and dividing out the GCD — robust to half /
 * quarter occupancies while staying exact for integer stoichiometries.
 */
export function reduceCounts(counts: Record<string, number>): Array<[string, number]> {
  const entries = Object.entries(counts).filter(([, n]) => n > 1e-6);
  if (entries.length === 0) return [];
  const scale = 1000;
  const scaled = entries.map(([s, n]) => [s, Math.max(1, Math.round(n * scale))] as [string, number]);
  let g = scaled[0]![1];
  for (const [, n] of scaled) g = gcd(g, n);
  if (g === 0) g = 1;
  const reduced = scaled.map(([s, n]) => [s, n / g] as [string, number]);
  reduced.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return reduced;
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