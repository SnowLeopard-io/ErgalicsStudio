// ==========================================================================
// reactmd — payload builder: ReactionDef → physics engine input.
//
// Turns a catalog reaction into the global atom/bond/target description the
// NumPy engine integrates. Key idea: a *global* greedy atom assignment maps
// every product atom onto a reactant atom (same element), so a product bond
// whose two endpoints map to two reactant atoms becomes a **form** bond, a
// reactant bond whose pair survives in the product stays a **keep** bond, and
// one that vanishes becomes a **break** bond. Every product atom's position
// (laid out on the right) becomes the steer target its reactant partner glides
// to once radicalised — so the engine, not a script, decides when atoms move
// and whether the reaction completes at the chosen temperature.
//
// The single source of truth for physics constants stays here: bond energies
// (thermo) and element mass/radius, passed straight to the integrator.
// ==========================================================================

import type { Molecule } from '@/chem/structure';
import { atomicMass, covalentRadius } from '@/chem/elements';
import { bondEnergy } from '@/chem/thermo';
import type { ReactionDef, ReactionSpecies } from '../catalog';
import type { PhysAtom, PhysBond, PhysicsPayload } from './types';

const STEP = 3.6; // horizontal gap between molecule copies
const REACT_PRODUCT_GAP = 4.5; // gap between reactant block and product block
const DEFAULT_EA = 350; // kJ/mol fallback when a bond energy is unknown

export const DEFAULT_STEPS = 5000;
export const DEFAULT_FRAMES = 360;

interface Copy {
  mol: Molecule;
  baseX: number;
}

/** Expand every species (× its stoich) into positioned molecule copies. */
function expandCopies(species: ReactionSpecies[], cursor: number): Copy[] {
  const copies: Copy[] = [];
  let x = cursor;
  for (const s of species) {
    for (let k = 0; k < s.stoich; k += 1) {
      let width = 0;
      for (const a of s.molecule.atoms) if (a.x > width) width = a.x;
      copies.push({ mol: s.molecule, baseX: x });
      x += width + STEP;
    }
  }
  return copies;
}

/** Flatten copies into a running atom list: returns positions + symbol list. */
function flatten(
  copies: Copy[],
): { atoms: PhysAtom[]; syms: string[]; extent: number } {
  const atoms: PhysAtom[] = [];
  const syms: string[] = [];
  let extent = 0;
  for (const c of copies) {
    for (const a of c.mol.atoms) {
      atoms.push({ symbol: a.symbol, x: c.baseX + a.x, y: a.y, z: a.z });
      syms.push(a.symbol);
    }
    if (c.baseX > extent) extent = c.baseX;
  }
  extent += STEP;
  return { atoms, syms, extent };
}

/** Global greedy atom assignment product→reactant (same element, degree-closest). */
function assignAtoms(
  rSyms: string[],
  rDeg: number[],
  pCount: number,
  pSyms: string[],
  pDeg: number[],
): number[] {
  // assign constrained product atoms first: rarest element, then highest degree
  const freq = new Map<string, number>();
  for (const s of pSyms) freq.set(s, (freq.get(s) ?? 0) + 1);
  const order = pSyms.map((_, i) => i).sort((a, b) => {
    const fa = freq.get(pSyms[a]!) ?? 0;
    const fb = freq.get(pSyms[b]!) ?? 0;
    if (fa !== fb) return fa - fb;
    return (pDeg[b] ?? 0) - (pDeg[a] ?? 0);
  });
  const used = new Set<number>();
  const map = new Array(pCount).fill(-1);
  for (const p of order) {
    const sym = pSyms[p]!;
    let best = -1;
    let bestScore = Infinity;
    for (let r = 0; r < rSyms.length; r += 1) {
      if (used.has(r)) continue;
      if (rSyms[r] !== sym) continue;
      const score = Math.abs((rDeg[r] ?? 0) - (pDeg[p] ?? 0));
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (best >= 0) {
      used.add(best);
      map[p] = best;
    }
  }
  return map;
}

export interface BuiltPayload {
  payload: PhysicsPayload;
  /** frame-time metadata for the UI (nuclei, formulas). */
  atomSymbols: string[];
  reactantExtent: number;
  /** reaction id this payload was built for (cache key). */
  reaction: string;
}

/**
 * Build the physics payload for a reaction. Reactants are laid out on the
 * left, product targets on the right; product atoms are globally assigned to
 * reactant atoms so form/keep/break bonds are recovered from the structures.
 */
export function buildPhysicsPayload(def: ReactionDef): BuiltPayload {
  const reactCopies = expandCopies(def.reactants, 0);
  const rFlat = flatten(reactCopies);
  const reactAtoms = rFlat.atoms;
  const nR = reactAtoms.length;

  // shift the whole reactant cluster so its x-centre sits on the origin: the
  // reaction then evolves in place (near x=0) and the camera frames the origin.
  const xMean = reactAtoms.reduce((s, a) => s + a.x, 0) / Math.max(1, reactAtoms.length);
  for (const a of reactAtoms) a.x -= xMean;

  // reactant bond list (global indices) + recompute degree against those
  const rBondPairs: Array<{ a: number; b: number; order: number; r: number }> = [];
  let gi = 0;
  for (const c of reactCopies) {
    for (const b of c.mol.bonds) {
      rBondPairs.push({ a: gi + b.a, b: gi + b.b, order: b.order ?? 1, r: 0 });
    }
    gi += c.mol.atoms.length;
  }
  // note: use the molecule-local bond model for degrees (identical to flattened)
  const rDeg = degreesCount(def.reactants);
  const pCount = def.products.reduce((s, x) => s + x.stoich * x.molecule.atoms.length, 0);

  // product layout (right of the reactant block)
  const prodCopies = expandCopies(def.products, rFlat.extent + REACT_PRODUCT_GAP);
  const pFlat = flatten(prodCopies);
  const prodAtoms = pFlat.atoms;
  for (const a of prodAtoms) a.x -= xMean; // keep product ghosts right of the centred cluster
  const pSyms = pFlat.syms;
  const pDeg = degreesCount(def.products);

  // global assignment product→reactant
  const assign = assignAtoms(rFlat.syms, rDeg, pCount, pSyms, pDeg);

  // product bond pairs (global) mapped to reactant indices
  let pg = 0;
  const mappedPairs: Array<{ a: number; b: number; order: number }> = [];
  for (const c of prodCopies) {
    for (const b of c.mol.bonds) {
      const ra = assign[pg + b.a];
      const rb = assign[pg + b.b];
      if (ra !== undefined && ra >= 0 && rb !== undefined && rb >= 0) mappedPairs.push({ a: ra, b: rb, order: b.order ?? 1 });
    }
    pg += c.mol.atoms.length;
  }
  const reactPairSet = new Set(rBondPairs.map((p) => key(p.a, p.b)));

  // bonds
  const bonds: PhysBond[] = [];
  // equilibrium length of a freshly formed bond = 1.1 × (covalent radii sum)
  const eqR0 = (a: number, b: number): number =>
    1.1 * (covalentRadius(reactAtoms[a]!.symbol) + covalentRadius(reactAtoms[b]!.symbol));
  const makeBond = (a: number, b: number, order: number, kind: 'keep' | 'break' | 'form', r0: number) => {
    const symA = reactAtoms[a]!.symbol;
    const symB = reactAtoms[b]!.symbol;
    const ea = bondEnergy(symA, symB, order) || DEFAULT_EA;
    bonds.push({ a, b, kind, order, ea, r0 });
  };

  // highest product bond order per surviving pair
  const mappedOrder = new Map<string, number>();
  for (const mp of mappedPairs) {
    const k = key(mp.a, mp.b);
    mappedOrder.set(k, Math.max(mappedOrder.get(k) ?? 0, mp.order));
  }

  for (const rb of rBondPairs) {
    const k = key(rb.a, rb.b);
    const prodOrder = mappedOrder.get(k);
    const r0 = dist3(reactAtoms[rb.a]!, reactAtoms[rb.b]!);
    if (prodOrder === undefined) {
      makeBond(rb.a, rb.b, rb.order, 'break', r0);
      continue;
    }
    if (rb.order > prodOrder) {
      // bond survives but loses bond order (e.g. C=C → C–C): keep the sigma at
      // the reduced order and break the lost pi order so both atoms radicalise
      // and can accept the incoming group (addition/elimination).
      makeBond(rb.a, rb.b, prodOrder, 'keep', eqR0(rb.a, rb.b));
      makeBond(rb.a, rb.b, rb.order - prodOrder, 'break', eqR0(rb.a, rb.b));
    } else {
      makeBond(rb.a, rb.b, rb.order, 'keep', r0);
    }
  }
  for (const mp of mappedPairs) {
    if (reactPairSet.has(key(mp.a, mp.b))) continue; // already present → keep/break
    makeBond(mp.a, mp.b, mp.order, 'form', eqR0(mp.a, mp.b));
  }

  // targets: product site per reactant atom
  const target: (PhysAtom | null)[] = new Array(nR).fill(null);
  for (let p = 0; p < pCount; p += 1) {
    const r = assign[p];
    if (r !== undefined && r >= 0) target[r] = prodAtoms[p]!;
  }

  // mass/radius from the element table
  const mass = reactAtoms.map((a) => atomicMass(a.symbol));
  const radius = reactAtoms.map((a) => covalentRadius(a.symbol));

  return {
    payload: {
      atoms: reactAtoms,
      mass,
      radius,
      bonds,
      target,
      seed: 20260922,
    },
    atomSymbols: rFlat.syms,
    reactantExtent: rFlat.extent,
    reaction: def.id,
  };
}

/** Degree per atom across a species list (stoich-aware, flattened). */
function degreesCount(species: ReactionSpecies[]): number[] {
  const deg: number[] = [];
  let base = 0;
  for (const s of species) {
    for (let k = 0; k < s.stoich; k += 1) {
      const d = new Array(s.molecule.atoms.length).fill(0);
      for (const b of s.molecule.bonds) {
        d[b.a]! += 1;
        d[b.b]! += 1;
      }
      for (let i = 0; i < d.length; i += 1) deg[base + i] = d[i]!;
      base += s.molecule.atoms.length;
    }
  }
  return deg;
}

function key(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function dist3(a: PhysAtom, b: PhysAtom): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}