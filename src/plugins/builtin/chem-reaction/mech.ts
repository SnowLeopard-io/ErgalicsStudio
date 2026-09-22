// ==========================================================================
// chem-reaction — computed-mechanism layer
//
// Runs the real reaction engine and thermodynamics on a catalog reaction and
// assembles everything the 3-D + info UI needs: the engine's broken/formed
// bonds (with atom symbols resolved), electron flow, and — when standard data
// is available — ΔH°, ΔS°, ΔG°(298) and K. No canned animation; every number
// is recomputed from the species structures.
// ==========================================================================

import { analyseReaction, electronsTransferred, type ReactionCentre } from '@/chem/engine/reaction';
import { formationEnthalpy, reactionEntropy, gibbsEnergy, equilibriumConstant, T0 } from '@/chem/thermo';
import type { ReactionDef, ReactionSpecies } from './catalog';

export interface RenderedBond {
  speciesId: string;
  speciesFormula: string;
  atomA: number;
  atomB: number;
  symbolA: string;
  symbolB: string;
  order: number;
  /** "H–H", "C=O" style label. */
  label: string;
}

export interface RenderedRedox {
  symbol: string;
  from: number;
  to: number;
  delta: number;
}

export interface SideSpecies {
  id: string;
  formula: string;
  stoich: number;
  molecule: ReactionSpecies['molecule'];
}

export interface Mechanism {
  def: ReactionDef;
  /** Balanced equation, e.g. "CH4 + 2 O2 → CO2 + 2 H2O". */
  equation: string;
  centre: ReactionCentre;
  electrons: number;
  broken: RenderedBond[];
  formed: RenderedBond[];
  redox: RenderedRedox[];
  thermo: { dh: number; ds: number; dg: number; k: number } | null;
  reactants: SideSpecies[];
  products: SideSpecies[];
}

const ORDER_GLYPH: Record<number, string> = { 1: '–', 2: '=', 3: '≡' };

export function buildMechanism(def: ReactionDef): Mechanism {
  const centre = analyseReaction(def);
  const electrons = electronsTransferred(centre.redoxChanges);

  const formulaOf: Record<string, string> = {};
  const moleculeOf: Record<string, ReactionSpecies['molecule']> = {};
  for (const s of [...def.reactants, ...def.products]) {
    formulaOf[s.id] = s.formula;
    moleculeOf[s.id] = s.molecule;
  }
  const atomSym = (mol: ReactionSpecies['molecule'], i: number) => mol.atoms[i]?.symbol ?? '?';

  const renderBond = (x: { species: string; atomA: number; atomB: number; order: number }): RenderedBond => {
    const mol = moleculeOf[x.species]!;
    const symbolA = atomSym(mol, x.atomA);
    const symbolB = atomSym(mol, x.atomB);
    return {
      speciesId: x.species,
      speciesFormula: formulaOf[x.species] ?? '',
      atomA: x.atomA,
      atomB: x.atomB,
      symbolA,
      symbolB,
      order: x.order,
      label: `${symbolA}${ORDER_GLYPH[x.order] ?? '–'}${symbolB}`,
    };
  };

  const broken = centre.broken.map(renderBond);
  const formed = centre.formed.map(renderBond);
  const redox: RenderedRedox[] = centre.redoxChanges.map((r) => ({
    symbol: r.symbol,
    from: r.from,
    to: r.to,
    delta: r.delta,
  }));

  return {
    def,
    equation: formatEquation(def),
    centre,
    electrons,
    broken,
    formed,
    redox,
    thermo: computeThermo(def),
    reactants: def.reactants.map((s) => side(s)),
    products: def.products.map((s) => side(s)),
  };
}

function side(s: ReactionSpecies): SideSpecies {
  return { id: s.id, formula: s.formula, stoich: s.stoich, molecule: s.molecule };
}

/** Render a balanced equation with coefficients for stoich > 1. */
function formatEquation(def: ReactionDef): string {
  const side = (items: ReactionSpecies[]) =>
    items.map((s) => `${s.stoich > 1 ? `${s.stoich} ` : ''}${s.formula}`).join(' + ');
  return `${side(def.reactants)}  →  ${side(def.products)}`;
}

/** ΔH° / ΔS° / ΔG°(298) / K when every species maps to a thermo key. */
function computeThermo(def: ReactionDef): Mechanism['thermo'] {
  const prodTerms = def.products.map((s) => ({ stoich: s.stoich, species: s.thermoKey ?? '' }));
  const reactTerms = def.reactants.map((s) => ({ stoich: -s.stoich, species: s.thermoKey ?? '' }));
  if (!prodTerms.length || !reactTerms.length) return null;
  const dh = formationEnthalpy([...prodTerms, ...reactTerms]);
  const ds = reactionEntropy([...prodTerms, ...reactTerms]);
  if (dh === null || ds === null) return null;
  const dg = gibbsEnergy(dh, ds, T0);
  return { dh, ds, dg, k: equilibriumConstant(dg, T0) };
}