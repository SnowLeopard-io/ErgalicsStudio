// ==========================================================================
// chem-reaction — verified reaction catalog
//
// A curated set of textbook reactions across the main high-school reaction
// families. Every species carries a real molecular geometry (from `mols.ts`)
// and — where standard data exists — a thermodynamic species key, so the
// mechanism layer can compute actual ΔH° / ΔS° / ΔG° / K, not illustrations.
// The "classification" label is authoritative for display; the structural
// mechanism itself is still recomputed by the engine on demand.
// ==========================================================================

import type { Molecule } from '@/chem/structure';
import type { EngSpecies } from '@/chem/engine/reaction';
import { H2, O2, CH4, CO2, H2O, HCl, CuO, Cu, CaCO3, CaO, Zn, ZnCl2, NaOH, NaCl, AgNO3, AgCl, NaNO3, Na, Cl2, Br2, C2H4, C2H4Br2 } from './mols';

export interface ReactionSpecies extends EngSpecies {
  /** Thermochemical species key if tabulated (e.g. "H2(g)"). */
  thermoKey?: string;
}

export interface ReactionDef {
  id: string;
  nameZh: string;
  nameEn: string;
  classification: string;
  reactants: ReactionSpecies[];
  products: ReactionSpecies[];
}

function sp(id: string, formula: string, stoich: number, molecule: Molecule, thermoKey?: string): ReactionSpecies {
  return { id, formula, stoich, molecule, thermoKey };
}

export const REACTIONS: ReactionDef[] = [
  {
    id: 'cuo-h2',
    nameZh: '氢气还原氧化铜',
    nameEn: 'Hydrogen reduces copper(II) oxide',
    classification: 'redox',
    reactants: [sp('cuo', 'CuO', 1, CuO, 'CuO(s)'), sp('h2', 'H2', 1, H2, 'H2(g)')],
    products: [sp('cu', 'Cu', 1, Cu, 'Cu(s)'), sp('h2o', 'H2O', 1, H2O, 'H2O(g)')],
  },
  {
    id: 'ch4-o2',
    nameZh: '甲烷燃烧',
    nameEn: 'Methane combustion',
    classification: 'combustion',
    reactants: [sp('ch4', 'CH4', 1, CH4, 'CH4(g)'), sp('o2', 'O2', 2, O2, 'O2(g)')],
    products: [sp('co2', 'CO2', 1, CO2, 'CO2(g)'), sp('h2o', 'H2O', 2, H2O, 'H2O(g)')],
  },
  {
    id: 'caco3-cao',
    nameZh: '碳酸钙高温分解',
    nameEn: 'CaCO₃ thermal decomposition',
    classification: 'decomposition',
    reactants: [sp('caco3', 'CaCO3', 1, CaCO3, 'CaCO3(s)')],
    products: [sp('cao', 'CaO', 1, CaO, 'CaO(s)'), sp('co2', 'CO2', 1, CO2, 'CO2(g)')],
  },
  {
    id: 'zn-hcl',
    nameZh: '锌与稀盐酸（置换）',
    nameEn: 'Zinc displaces hydrogen from HCl',
    classification: 'single-replacement',
    reactants: [sp('zn', 'Zn', 1, Zn), sp('hcl', 'HCl', 2, HCl, 'HCl(g)')],
    products: [sp('zncl2', 'ZnCl2', 1, ZnCl2), sp('h2', 'H2', 1, H2, 'H2(g)')],
  },
  {
    id: 'hcl-naoh',
    nameZh: '盐酸中和氢氧化钠',
    nameEn: 'HCl neutralises NaOH',
    classification: 'neutralization',
    reactants: [sp('hcl', 'HCl', 1, HCl, 'HCl(g)'), sp('naoh', 'NaOH', 1, NaOH, 'NaOH(s)')],
    products: [sp('nacl', 'NaCl', 1, NaCl, 'NaCl(s)'), sp('h2o', 'H2O', 1, H2O, 'H2O(l)')],
  },
  {
    id: 'agno3-nacl',
    nameZh: '硝酸银与氯化钠（沉淀）',
    nameEn: 'AgNO₃ + NaCl → AgCl↓',
    classification: 'precipitation',
    reactants: [sp('agno3', 'AgNO3', 1, AgNO3, 'AgNO3(s)'), sp('nacl', 'NaCl', 1, NaCl, 'NaCl(s)')],
    products: [sp('agcl', 'AgCl', 1, AgCl, 'AgCl(s)'), sp('nano3', 'NaNO3', 1, NaNO3)],
  },
  {
    id: 'nacl-electrolysis',
    nameZh: '熔融氯化钠电解',
    nameEn: 'Molten NaCl electrolysis',
    classification: 'electrolysis',
    reactants: [sp('nacl', 'NaCl', 2, NaCl, 'NaCl(s)')],
    products: [sp('na', 'Na', 2, Na, 'Na(s)'), sp('cl2', 'Cl2', 1, Cl2, 'Cl2(g)')],
  },
  {
    id: 'c2h4-br2',
    nameZh: '乙烯与溴的加成',
    nameEn: 'Alkene addition: C₂H₄ + Br₂',
    classification: 'addition',
    reactants: [sp('c2h4', 'C2H4', 1, C2H4), sp('br2', 'Br2', 1, Br2)],
    products: [sp('c2h4br2', 'C2H4Br2', 1, C2H4Br2)],
  },
];

export function findReaction(id: string): ReactionDef | undefined {
  return REACTIONS.find((r) => r.id === id);
}

export function totalUsedSpecies(): number {
  return new Set(REACTIONS.flatMap((r) => [...r.reactants, ...r.products].map((s) => s.formula))).size;
}