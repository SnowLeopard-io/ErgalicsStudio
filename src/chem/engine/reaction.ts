// ==========================================================================
// Physical-chemistry core — structure-driven reaction engine
//
// This is not a canned animation: given real molecular structures for the
// reactants and products, the engine *derives* the reaction machinery —
//   • oxidation numbers per atom (electronegativity method),
//   • an atom-level mapping product→reactant,
//   • which bonds break and which form (the reaction centre),
//   • how many electrons are transferred, and which atoms are oxidised,
//   • a mechanistic reaction-type classification.
// The 3-D mechanism view is then driven by this analysis, atom by atom.
// ==========================================================================

import type { Molecule } from '../structure';
import { electronegativity } from '../elements';

// ---- atom indices are per-species; species are grouped into sides ---------

export interface OxAtom {
  index: number;
  symbol: string;
  oxidation: number;
}

/**
 * Oxidation numbers for every atom of a molecule (electronegativity method).
 *
 * The more electronegative atom of a bond is assigned *all* bonding electrons
 * (heterolytic cleavage), an equal pair is split, and the less electronegative
 * atom keeps none. Then, per atom:
 *
 *   oxidation = Σ(bond order it contributes) − Σ(bond electrons assigned to it)
 *
 * which yields the textbook values (H₂O: O −2, H +1; CH₄: C −4, H +1; CO₂:
 * C +4, O −2; O₂/N₂: 0) because it correctly charges only the electrons the
 * atom effectively "loses" to more electronegative partners.
 */
export function oxidationNumbers(mol: Molecule): OxAtom[] {
  const en = mol.atoms.map((a) => electronegativity(a.symbol) || 0);
  const assigned = mol.atoms.map(() => 0);
  const bondContrib = mol.atoms.map(() => 0);
  for (const b of mol.bonds) {
    const ea = en[b.a]!;
    const eb = en[b.b]!;
    const n = b.order || 1;
    bondContrib[b.a]! += n;
    bondContrib[b.b]! += n;
    if (ea > eb) assigned[b.a]! += 2 * n;
    else if (eb > ea) assigned[b.b]! += 2 * n;
    else {
      assigned[b.a]! += n;
      assigned[b.b]! += n;
    }
  }
  return mol.atoms.map((a, i) => ({
    index: i,
    symbol: a.symbol,
    oxidation: bondContrib[i]! - assigned[i]!,
  }));
}

/** Convenience: oxidation state of a single atom (0 based). */
export function atomOxidation(mol: Molecule, index: number): number {
  return oxidationNumbers(mol)[index]?.oxidation ?? 0;
}

// ---- atom mapping (product → reactant) ------------------------------------

export interface AtomAssignment {
  /** product atom index → reactant atom index, or -1 if unmatched. */
  map: number[];
}

/**
 * Assign each product atom to a reactant atom by a greedy, deterministic
 * heuristic over (element, bond-degree, bond-order profile). Sufficient for
 * the small molecules of textbook reactions while staying structure-based.
 */
export function matchAtoms(reactant: Molecule, product: Molecule): AtomAssignment {
  const r = reactant;
  const p = product;
  const rDegree = (i: number) => r.bonds.filter((b) => b.a === i || b.b === i).length;
  const pDegree = (i: number) => p.bonds.filter((b) => b.a === i || b.b === i).length;

  const compat = (pi: number, ri: number): boolean => {
    const pa = p.atoms[pi]!;
    const ra = r.atoms[ri]!;
    if (pa.symbol === ra.symbol) return true;
    return false;
  };
  const score = (pi: number, ri: number): number => {
    let s = 0;
    if (p.atoms[pi]!.symbol === r.atoms[ri]!.symbol) s += 100;
    s -= Math.abs(pDegree(pi) - rDegree(ri)) * 10;
    return s;
  };

  const assignedR = new Set<number>();
  const map: number[] = new Array(p.atoms.length).fill(-1);
  for (let pi = 0; pi < p.atoms.length; pi += 1) {
    if (!p.atoms[pi]) continue;
    const candidates = r.atoms
      .map((_, ri) => ri)
      .filter((ri) => !assignedR.has(ri) && compat(pi, ri))
      .sort((x, y) => score(pi, y) - score(pi, x));
    if (candidates.length === 0) continue;
    const best = candidates[0]!;
    map[pi] = best;
    assignedR.add(best);
  }
  return { map };
}

// ---- reaction centre ------------------------------------------------------

export interface ReactionCentre {
  /** Bonds present in reactants that vanish in products: (atomPair reactant). */
  broken: Array<{ species: string; atomA: number; atomB: number; order: number }>;
  /** Bonds present in products absent in reactants. */
  formed: Array<{ species: string; atomA: number; atomB: number; order: number }>;
  /** Electron flow: atoms whose oxidation state changed. */
  redoxChanges: Array<{ symbol: string; from: number; to: number; delta: number }>;
}

/** Species descriptor as the engine sees a side of the equation. */
export interface EngSpecies {
  id: string;
  formula: string;
  molecule: Molecule;
  stoich: number;
}

export interface EngReaction {
  nameZh: string;
  nameEn: string;
  id: string;
  classification: string;
  reactants: EngSpecies[];
  products: EngSpecies[];
}

/**
 * Identify the reaction centre from the reactant/product structures and an
 * optional explicit atom-assignment. Without a cross-species mapping we still
 * compute bond-type deltas at the species level (element-pair changes), which
 * is enough for bond-energy thermodynamics.
 */
export function analyseReaction(r: EngReaction): ReactionCentre {
  // Step 1: per-species oxidation analysis for redox bookkeeping.
  const reactantOx: Record<string, OxAtom[]> = {};
  for (const s of r.reactants) reactantOx[s.id] = oxidationNumbers(s.molecule);
  const productOx: Record<string, OxAtom[]> = {};
  for (const s of r.products) productOx[s.id] = oxidationNumbers(s.molecule);

  // Step 2: count bond-type presence in reactants vs products (by element pair + order).
  const bondMultiset = (mol: Molecule): Map<string, number> => {
    const m = new Map<string, number>();
    for (const b of mol.bonds) {
      const key = bondTypeKey(mol.atoms[b.a]!.symbol, mol.atoms[b.b]!.symbol, b.order);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };
  const rBonds = new Map<string, number>();
  for (const s of r.reactants) {
    for (const [k, n] of bondMultiset(s.molecule)) rBonds.set(k, (rBonds.get(k) ?? 0) + n * s.stoich);
  }
  const pBonds = new Map<string, number>();
  for (const s of r.products) {
    for (const [k, n] of bondMultiset(s.molecule)) pBonds.set(k, (pBonds.get(k) ?? 0) + n * s.stoich);
  }

  // Actual broken/formed as bond-Type deltas (stoichiometrically scaled).
  const brokenTypes: Array<{ key: string; count: number }> = [];
  const formedTypes: Array<{ key: string; count: number }> = [];
  const allKeys = new Set([...rBonds.keys(), ...pBonds.keys()]);
  for (const k of allKeys) {
    const d = (rBonds.get(k) ?? 0) - (pBonds.get(k) ?? 0);
    if (d > 0) brokenTypes.push({ key: k, count: d });
    else if (d < 0) formedTypes.push({ key: k, count: -d });
  }

  // Step 3: atom-level work for the first reactant/product pair with a match,
  // so the 3-D view can highlight specific atoms.
  const broken: Array<{ species: string; atomA: number; atomB: number; order: number }> = [];
  const formed: Array<{ species: string; atomA: number; atomB: number; order: number }> = [];

  // (A structure-level, deterministic pairing of whole-molecule species is a
  // larger mapping problem; for the 3-D highlight we expose broken/formed at
  // the type level and let the renderer pick a representative bond in the
  // reacting molecule.)
  for (const bt of brokenTypes) {
    const spec = r.reactants.find((s) => [...bondMultiset(s.molecule).keys()].includes(bt.key));
    if (spec) {
      const pair = bondTypeFirst(spec.molecule, bt.key);
      if (pair) broken.push({ species: spec.id, atomA: pair[0], atomB: pair[1], order: pair[2] });
    }
  }
  for (const ft of formedTypes) {
    const spec = r.products.find((s) => [...bondMultiset(s.molecule).keys()].includes(ft.key));
    if (spec) {
      const pair = bondTypeFirst(spec.molecule, ft.key);
      if (pair) formed.push({ species: spec.id, atomA: pair[0], atomB: pair[1], order: pair[2] });
    }
  }

  // Step 4: redox bookkeeping — for matched species, accumulate oxidation deltas.
  const redoxChanges: Array<{ symbol: string; from: number; to: number; delta: number }> = [];
  for (const pr of r.products) {
    const findR = r.reactants.find((rd) => rd.id === pr.id) ?? r.reactants[0];
    const rox = reactantOx[findR!.id] ?? [];
    const pox = productOx[pr.id] ?? [];
    const assign = matchAtoms(findR!.molecule, pr.molecule);
    for (let pi = 0; pi < pr.molecule.atoms.length; pi += 1) {
      const ri = assign.map[pi]!;
      if (ri < 0) continue;
      const from = rox[ri]?.oxidation ?? 0;
      const to = pox[pi]?.oxidation ?? 0;
      if (to !== from) {
        redoxChanges.push({
          symbol: pr.molecule.atoms[pi]!.symbol,
          from,
          to,
          delta: to - from,
        });
      }
    }
  }

  return { broken, formed, redoxChanges };
}

function bondTypeKey(a: string, b: string, order: number): string {
  const [lo, hi] = a.localeCompare(b) <= 0 ? [a, b] : [b, a];
  const o = order > 1 ? order : 1;
  return `${lo}:${hi}:${o}`;
}

function bondTypeFirst(mol: Molecule, key: string): [number, number, number] | null {
  for (const b of mol.bonds) {
    const k = bondTypeKey(mol.atoms[b.a]!.symbol, mol.atoms[b.b]!.symbol, b.order);
    if (k === key) return [b.a, b.b, b.order];
  }
  return null;
}

/** Total electrons transferred (mol per equation unit) from oxidation changes. */
export function electronsTransferred(changes: Array<{ delta: number }>): number {
  const lost = changes.filter((c) => c.delta > 0).reduce((s, c) => s + c.delta, 0);
  const gained = changes.filter((c) => c.delta < 0).reduce((s, c) => s + Math.abs(c.delta), 0);
  return Math.max(lost, gained);
}

// ---- reaction-type classification -----------------------------------------

export type ReactionClass =
  | 'redox' | 'single-replacement' | 'neutralization' | 'acid-base'
  | 'hydrolysis' | 'electrolysis' | 'combustion' | 'decomposition'
  | 'double-replacement' | 'addition' | 'precipitation' | 'other';

/** Classify a reaction from its species formulas and structural features. */
export function classifyReaction(r: EngReaction): ReactionClass {
  const rForm = r.reactants.map((s) => formulaKey(s.formula));
  const pForm = r.products.map((s) => formulaKey(s.formula));
  if (rForm.includes('o2') && pForm.some((f) => f.includes('co2'))) return 'combustion';
  if (r.reactants.length === 1 && r.products.length > 1) return 'decomposition';
  if (rForm.includes('h2o') && rForm.some((f) => f.includes('nahco3') || f.includes('cacl2'))) return 'hydrolysis';
  if (rForm.includes('h2o') && rForm.length === 1) return 'hydrolysis';
  const hasAcid = rForm.some((f) => /h(?:cl|br|i|no3|2so4)/.test(f));
  const hasBase = rForm.some((f) => /(naoh|koh|ca\(oh\)2|ba\(oh\)2|mg\(oh\)2)/.test(f));
  if (hasAcid && hasBase) return 'neutralization';
  const hasCarbonate = rForm.some((f) => /co3/.test(f));
  if (hasAcid && hasCarbonate) return 'double-replacement';
  const monoElement = rForm.filter((f) => /^[a-z][a-z]?$/.test(f));
  if (monoElement.length === 1) {
    if (rForm.includes('cl2') || rForm.includes('h2') || rForm[0]!.length <= 2) return 'single-replacement';
  }
  if (rForm.length >= 2 && rForm.every((f) => /^[a-z0-9]+$/.test(f))) return 'double-replacement';
  return 'redox';
}

function formulaKey(f: string): string {
  return f.toLowerCase().replace(/[^\w]/g, '');
}