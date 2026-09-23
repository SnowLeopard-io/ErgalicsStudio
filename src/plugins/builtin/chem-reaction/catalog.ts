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
import { H2, O2, CH4, CO2, H2O, HCl, CuO, Cu, CaCO3, CaO, Zn, ZnCl2, NaOH, NaCl, AgNO3, AgCl, NaNO3, Na, Cl2, Br2, C2H4, C2H4Br2, C2H5OH, CH3COOH, CH3COOC2H5, C2H4O, CH3Cl, C6H6, C6H12, C7H8, KMnO4, C6H5COOK, MnO2, KOH } from './mols';

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

  // ---- organic reactions --------------------------------------------------
  {
    id: 'esterification',
    nameZh: '乙醇与乙酸的酯化反应',
    nameEn: 'Esterification: C₂H₅OH + CH₃COOH',
    classification: 'esterification',
    reactants: [sp('ch3cooh', 'CH3COOH', 1, CH3COOH, 'CH3COOH(l)'), sp('c2h5oh', 'C2H5OH', 1, C2H5OH, 'C2H5OH(l)')],
    products: [sp('ch3cooc2h5', 'CH3COOC2H5', 1, CH3COOC2H5, 'CH3COOC2H5(l)'), sp('h2o', 'H2O', 1, H2O, 'H2O(l)')],
  },
  {
    id: 'c2h5oh-o2',
    nameZh: '乙醇的催化氧化（生成乙醛）',
    nameEn: 'Ethanol oxidation to acetaldehyde',
    classification: 'oxidation',
    reactants: [sp('c2h5oh', 'C2H5OH', 2, C2H5OH, 'C2H5OH(l)'), sp('o2', 'O2', 1, O2, 'O2(g)')],
    products: [sp('c2h4o', 'C2H4O', 2, C2H4O, 'CH3CHO(l)'), sp('h2o', 'H2O', 2, H2O, 'H2O(l)')],
  },
  {
    id: 'c2h5oh-c2h4',
    nameZh: '乙醇脱水制乙烯',
    nameEn: 'Ethanol dehydration to ethene',
    classification: 'dehydration',
    reactants: [sp('c2h5oh', 'C2H5OH', 1, C2H5OH, 'C2H5OH(l)')],
    products: [sp('c2h4', 'C2H4', 1, C2H4, 'C2H4(g)'), sp('h2o', 'H2O', 1, H2O, 'H2O(l)')],
  },
  {
    id: 'ch4-cl2',
    nameZh: '甲烷与氯气的取代反应',
    nameEn: 'Methane chlorination (substitution)',
    classification: 'substitution',
    reactants: [sp('ch4', 'CH4', 1, CH4, 'CH4(g)'), sp('cl2', 'Cl2', 1, Cl2, 'Cl2(g)')],
    products: [sp('ch3cl', 'CH3Cl', 1, CH3Cl, 'CH3Cl(g)'), sp('hcl', 'HCl', 1, HCl, 'HCl(g)')],
  },
  {
    id: 'c6h6-h2',
    nameZh: '苯与氢气的加成（制环己烷）',
    nameEn: 'Benzene hydrogenation to cyclohexane',
    classification: 'addition',
    reactants: [sp('c6h6', 'C6H6', 1, C6H6, 'C6H6(l)'), sp('h2', 'H2', 3, H2, 'H2(g)')],
    products: [sp('c6h12', 'C6H12', 1, C6H12, 'C6H12(l)')],
  },
  {
    id: 'c7h8-kmno4',
    nameZh: '甲苯被高锰酸钾氧化（成苯甲酸）',
    nameEn: 'Toluene oxidation by KMnO₄ → benzoate',
    classification: 'oxidation',
    reactants: [sp('c7h8', 'C7H8', 1, C7H8, 'C7H8(l)'), sp('kmno4', 'KMnO4', 2, KMnO4)],
    products: [
      sp('c6h5cook', 'C6H5COOK', 1, C6H5COOK),
      sp('mno2', 'MnO2', 2, MnO2),
      sp('koh', 'KOH', 1, KOH),
      sp('h2o', 'H2O', 1, H2O, 'H2O(l)'),
    ],
  },
];

export function findReaction(id: string): ReactionDef | undefined {
  return REACTIONS.find((r) => r.id === id);
}

export function totalUsedSpecies(): number {
  return new Set(REACTIONS.flatMap((r) => [...r.reactants, ...r.products].map((s) => s.formula))).size;
}