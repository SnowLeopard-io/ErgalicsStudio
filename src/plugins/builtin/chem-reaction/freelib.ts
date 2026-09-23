// ==========================================================================
// chem-reaction — free-reactant mode ("需求化投料")
//
// Lets the user pick any combination of reagent molecules and give each a feed
// ratio. The engine then either
//   • recognises the element balance as one of the verified catalog reactions
//     and drives it with the real products (the *equivalent* reaction, scaled
//     by how many equivalents the chosen amounts support, with leftover
//     reagents kept as unreacted spectators), or
//   • falls back to a plain high-T thermal-motion / dissociation demo when the
//     chosen set has no known balanced partner.
//
// Combustion gets a real side-reaction check too: with too little O₂ the split
// shifts to CO (partial oxidation) instead of CO₂ — matching actual equilibrium
// behaviour instead of assuming a single balanced equation.
// ==========================================================================

import type { Molecule } from '@/chem/structure';
import { atomicMass, covalentRadius } from '@/chem/elements';
import { bondEnergy } from '@/chem/thermo';
import type { ReactionDef, ReactionSpecies } from './catalog';
import { REACTIONS } from './catalog';
import { buildPhysicsPayload } from './reactmd/payload';
import type { PhysBond, PhysAtom, PhysicsPayload } from './reactmd/types';
import {
  H2, O2, CH4, CO2, H2O, HCl, CuO, CaCO3, CaO, Zn, NaOH, NaCl,
  AgNO3, Cu, Cl2, Na, Br2, C2H4, C2H5OH, CH3COOH, C2H4O, CH3Cl, C6H6, C7H8, KMnO4,
} from './mols';

export interface FreeSpecies {
  formula: string;
  mol: Molecule;
  nameZh: string;
  nameEn: string;
}

/** Reagent molecules offered in the free-reactant drawer. */
export const FREE_REAGENTS: FreeSpecies[] = [
  { formula: 'CH4', mol: CH4, nameZh: '甲烷', nameEn: 'methane' },
  { formula: 'O2', mol: O2, nameZh: '氧气', nameEn: 'oxygen' },
  { formula: 'H2', mol: H2, nameZh: '氢气', nameEn: 'hydrogen' },
  { formula: 'CuO', mol: CuO, nameZh: '氧化铜', nameEn: 'copper(II) oxide' },
  { formula: 'HCl', mol: HCl, nameZh: '氯化氢', nameEn: 'hydrogen chloride' },
  { formula: 'NaOH', mol: NaOH, nameZh: '氢氧化钠', nameEn: 'sodium hydroxide' },
  { formula: 'Zn', mol: Zn, nameZh: '锌', nameEn: 'zinc' },
  { formula: 'CaCO3', mol: CaCO3, nameZh: '碳酸钙', nameEn: 'calcium carbonate' },
  { formula: 'CaO', mol: CaO, nameZh: '氧化钙', nameEn: 'calcium oxide' },
  { formula: 'AgNO3', mol: AgNO3, nameZh: '硝酸银', nameEn: 'silver nitrate' },
  { formula: 'NaCl', mol: NaCl, nameZh: '氯化钠', nameEn: 'sodium chloride' },
  { formula: 'C2H4', mol: C2H4, nameZh: '乙烯', nameEn: 'ethene' },
  { formula: 'Br2', mol: Br2, nameZh: '溴', nameEn: 'bromine' },
  { formula: 'C2H5OH', mol: C2H5OH, nameZh: '乙醇', nameEn: 'ethanol' },
  { formula: 'CH3COOH', mol: CH3COOH, nameZh: '乙酸', nameEn: 'acetic acid' },
  { formula: 'C2H4O', mol: C2H4O, nameZh: '乙醛', nameEn: 'acetaldehyde' },
  { formula: 'CH3Cl', mol: CH3Cl, nameZh: '氯甲烷', nameEn: 'chloromethane' },
  { formula: 'C6H6', mol: C6H6, nameZh: '苯', nameEn: 'benzene' },
  { formula: 'C7H8', mol: C7H8, nameZh: '甲苯', nameEn: 'toluene' },
  { formula: 'KMnO4', mol: KMnO4, nameZh: '高锰酸钾', nameEn: 'potassium permanganate' },
  { formula: 'H2O', mol: H2O, nameZh: '水', nameEn: 'water' },
  { formula: 'CO2', mol: CO2, nameZh: '二氧化碳', nameEn: 'carbon dioxide' },
  { formula: 'Na', mol: Na, nameZh: '钠', nameEn: 'sodium' },
  { formula: 'Cl2', mol: Cl2, nameZh: '氯气', nameEn: 'chlorine' },
  { formula: 'Cu', mol: Cu, nameZh: '铜', nameEn: 'copper' },
];

const BY_FORMULA = new Map(FREE_REAGENTS.map((r) => [r.formula, r]));

/** Element composition of a molecule (atom-symbol counts). */
export function composition(mol: Molecule): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of mol.atoms) m.set(a.symbol, (m.get(a.symbol) ?? 0) + 1);
  return m;
}

/** Feed selection = reagent formula → amount (molecules). */
export type Feed = Record<string, number>;

/** Element totals over the whole feed. */
export function feedElements(feed: Feed): Map<string, number> {
  const m = new Map<string, number>();
  for (const formula of Object.keys(feed)) {
    const n = feed[formula] ?? 0;
    if (n <= 0) continue;
    const r = BY_FORMULA.get(formula);
    if (!r) continue;
    for (const [el, c] of composition(r.mol)) m.set(el, (m.get(el) ?? 0) + n * c);
  }
  return m;
}

function multiset(species: ReactionSpecies[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of species) {
    for (const [el, c] of composition(s.molecule)) m.set(el, (m.get(el) ?? 0) + s.stoich * c);
  }
  return m;
}

/** Formula → stoich needed by a reaction's reagent side. */
function reagentNeed(def: ReactionDef): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of def.reactants) m.set(s.formula, (m.get(s.formula) ?? 0) + s.stoich);
  return m;
}

export interface MatchResult {
  reaction: ReactionDef;
  /** how many whole equivalents of the reaction the feed supports */
  equivalents: number;
  /** leftover reagent amounts (formula → count) kept as unreacted spectators */
  spectators: Feed;
  consumed: Feed;
}

/**
 * Find the catalog reaction best supported by the feed (by element conservation)
 * and the number of whole equivalents it supports. Returns null when no known
 * balanced partner exists for the chosen set (>0 reagents only).
 */
export function matchReaction(feed: Feed): MatchResult | null {
  const avail = feedElements(feed);
  const anyFeed = Object.keys(feed).some((f) => (feed[f] ?? 0) > 0);
  if (!anyFeed) return null;

  let best: MatchResult | null = null;
  for (const r of REACTIONS) {
    const need = multiset(r.reactants);
    let k = Infinity;
    for (const [el, c] of need) {
      k = Math.min(k, Math.floor((avail.get(el) ?? 0) / c));
    }
    if (k < 1) continue;
    if (best && k < best.equivalents) continue;
    // tie-break: prefer the reaction that consumes more distinct reagents
    if (best && k === best.equivalents && reagentNeed(r).size < reagentNeed(best.reaction).size) continue;

    const consumed: Feed = {};
    const needForm = reagentNeed(r);
    for (const [f, needC] of needForm) {
      const have = feed[f] ?? 0;
      if (have >= k * needC) consumed[f] = k * needC;
    }
    // a valid match must consume at least the reaction's own reagent formulas
    const hasFormulaMatch = Object.keys(needForm).every((f) => (feed[f] ?? 0) >= k * (needForm.get(f) ?? 0));
    if (!hasFormulaMatch) continue;

    const spectators: Feed = {};
    for (const f of Object.keys(feed)) {
      const left = (feed[f] ?? 0) - (consumed[f] ?? 0);
      if (left > 0) spectators[f] = left;
    }
    const cand: MatchResult = { reaction: r, equivalents: k, spectators, consumed };
    best = best && best.equivalents === k && reagentNeed(best.reaction).size < needForm.size ? best : cand;
  }
  return best;
}

/** Spread a feed into ordered ReactionSpecies (dropping zero amounts). */
export function feedToSpecies(feed: Feed): ReactionSpecies[] {
  const out: ReactionSpecies[] = [];
  for (const f of Object.keys(feed)) {
    const n = feed[f] ?? 0;
    if (n <= 0) continue;
    const r = BY_FORMULA.get(f);
    if (!r) continue;
    out.push({ id: f, formula: f, stoich: n, molecule: r.mol });
  }
  return out;
}

export interface SideNote {
  textZh: string;
  textEn: string;
}

/**
 * Combustion side-reaction analysis for a CH₄ / O₂ feed. Returns the split that
 * matches the actual O:C feed ratio instead of assuming complete combustion:
 *   O₂ ≥ 2·CH₄  → CO₂ + 2H₂O (+ leftover O₂)
 *   1.5·CH₄ ≤ O₂ < 2·CH₄ → partial oxidation with both CO₂ and CO
 *   O₂ < 1.5·CH₄ → severely oxygen-poor (CO/H₂/C/CH₄), split only described.
 */
export function combustionSide(ch4: number, o2: number): SideNote | null {
  const c = ch4;
  const o = o2;
  if (c <= 0 || o <= 0) return null;
  if (o >= 2 * c) {
    const leftover = o - 2 * c;
    return leftover > 0
      ? { textZh: `完全燃烧 CH₄+2O₂→CO₂+2H₂O，剩余 ${leftover} O₂（过量氧）。`, textEn: `Complete combustion CH₄+2O₂→CO₂+2H₂O; ${leftover} O₂ left over (excess).` }
      : { textZh: '完全燃烧 CH₄+2O₂→CO₂+2H₂O（氧正好）。', textEn: 'Complete combustion CH₄+2O₂→CO₂+2H₂O (exact O₂).' };
  }
  if (o >= 1.5 * c) {
    // x CO₂ + y CO + 2c H₂O, x=2o−3c, y=4c−2o
    const x = 2 * o - 3 * c;
    const y = 4 * c - 2 * o;
    return {
      textZh: `氧不足 → 不完全燃烧 ${x}CH₄+${2 * o}…产物 ${y ? `${y}CO + ` : ''}${x ? `${x}CO₂ + ` : ''}${2 * c}H₂O（CO/CO₂ 并存，符合欠氧平衡）。`,
      textEn: `O₂-limited → partial oxidation producing ${y ? `${y} CO + ` : ''}${x ? `${x} CO₂ + ` : ''}${2 * c} H₂O (CO/CO₂ mix, real O-deficient balance).`,
    };
  }
  return o < c
    ? { textZh: '严重缺氧：仅部分 CH₄ 着火，产物含 CO/H₂/C 与未燃 CH₄（可燃气体系，此处不作定量）。', textEn: 'Severe O₂ deficit: only some CH₄ ignites; CO/H₂/C plus unburnt CH₄ (flammable mix, not quantified here).' }
    : { textZh: '明显缺氧：产物以 CO 与 H₂ 为主，混有 CO₂ 与未燃 CH₄（复杂可燃平衡，此处不作定量）。', textEn: 'Notably O₂-poor: CO and H₂ dominate with some CO₂ and unburnt CH₄ (complex flammable balance, not quantified).' };
}

/** Build a physics payload for a feed + match (matched → synthesised def). */
export function buildFreePayload(
  feed: Feed,
): { payload: PhysicsPayload; atomSymbols: string[]; match: MatchResult | null } {
  const match = matchReaction(feed);

  if (match) {
    // synthesize a def: matched reaction × equivalents + spectators on both sides
    const mk = (side: ReactionSpecies[], mult: number, spectators: Feed): ReactionSpecies[] => {
      const scaled = side.map((s) => ({ ...s, stoich: s.stoich * mult }));
      return scaled.concat(feedToSpecies(spectators));
    };
    const def: ReactionDef = {
      id: `free::${match.reaction.id}`,
      nameZh: match.reaction.nameZh,
      nameEn: match.reaction.nameEn,
      classification: match.reaction.classification,
      reactants: mk(match.reaction.reactants, match.equivalents, match.spectators),
      products: mk(match.reaction.products, match.equivalents, match.spectators),
    };
    const built = buildPhysicsPayload(def);
    return { payload: built.payload, atomSymbols: built.atomSymbols, match };
  }

  // no known partner → thermal dissociation / free-motion demo
  const payload = buildDissociationPayload(feed);
  const syms: string[] = [];
  for (const s of feedToSpecies(feed)) {
    for (let k = 0; k < s.stoich; k += 1) {
      for (const a of s.molecule.atoms) syms.push(a.symbol);
    }
  }
  return { payload, atomSymbols: syms, match: null };
}

/**
 * High-T dissociation demo payload: the reagents' own bonds are all marked
 * break (no products), so with enough thermal energy they fracture and the
 * fragment radicals drift freely — a genuine free-reaction fallback rather than
 * a scripted shake.
 */
function buildDissociationPayload(feed: Feed): PhysicsPayload {
  const species = feedToSpecies(feed);
  const atoms: PhysAtom[] = [];
  let xCursor = 0;
  const copyStarts: number[] = [];
  const molecules: Molecule[] = [];
  for (const s of species) {
    for (let k = 0; k < s.stoich; k += 1) {
      let width = 0;
      for (const a of s.molecule.atoms) if (a.x > width) width = a.x;
      copyStarts.push(atoms.length);
      molecules.push(s.molecule);
      for (const a of s.molecule.atoms) atoms.push({ symbol: a.symbol, x: xCursor + a.x, y: a.y, z: a.z });
      xCursor += width + 3.6;
    }
  }
  const xMean = atoms.reduce((s, a) => s + a.x, 0) / Math.max(1, atoms.length);
  for (const a of atoms) a.x -= xMean;

  const bonds: PhysBond[] = [];
  for (let c = 0; c < molecules.length; c += 1) {
    const mol = molecules[c]!;
    const base = copyStarts[c]!;
    for (const b of mol.bonds) {
      const ai = base + b.a;
      const bi = base + b.b;
      const symA = atoms[ai]!.symbol;
      const symB = atoms[bi]!.symbol;
      const ea = bondEnergy(symA, symB, b.order ?? 1) || 350;
      bonds.push({ a: ai, b: bi, kind: 'break', order: b.order ?? 1, ea, r0: Math.hypot(atoms[ai]!.x - atoms[bi]!.x, atoms[ai]!.y - atoms[bi]!.y, atoms[ai]!.z - atoms[bi]!.z) });
    }
  }

  return {
    atoms,
    mass: atoms.map((a) => atomicMass(a.symbol)),
    radius: atoms.map((a) => covalentRadius(a.symbol)),
    bonds,
    target: new Array(atoms.length).fill(null),
    seed: 20260922,
  };
}