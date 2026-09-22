// chem-reaction — engine-driven mechanism & catalog tests.
import { describe, it, expect } from 'vitest';
import {
  oxidationNumbers,
  matchAtoms,
  analyseReaction,
  electronsTransferred,
  classifyReaction,
} from '@/chem/engine/reaction';
import { H2O, CH4, CO2, O2, HCl, NaCl } from '@/plugins/builtin/chem-reaction/mols';
import { REACTIONS, findReaction } from '@/plugins/builtin/chem-reaction/catalog';
import { buildMechanism } from '@/plugins/builtin/chem-reaction/mech';
import { ChemReactionPlugin, equationOf, renderFormula } from '@/plugins/builtin/chem-reaction/plugin';
import { buildPhysicsPayload } from '@/plugins/builtin/chem-reaction/reactmd/payload';
import { chemReactionManifest } from '@/plugins/builtin/chem-reaction/manifest';
import { findBuiltin } from '@/plugins/builtin';
import { disciplineOf } from '@/plugins/categories';
import type { PluginApi } from '@/types/plugin';
import type { EngReaction, EngSpecies } from '@/chem/engine/reaction';

function oxMap(mol: { atoms: Array<{ symbol: string }> }): Record<number, number> {
  const ox = oxidationNumbers(mol as never);
  return Object.fromEntries(ox.map((a) => [a.index, a.oxidation]));
}

describe('oxidationNumbers — electronegativity method, textbook values', () => {
  it('H2O: O −2, H +1', () => {
    const o = oxMap(H2O);
    expect(o[0]).toBe(-2);
    expect(o[1]).toBe(1);
    expect(o[2]).toBe(1);
  });
  it('CH4: C −4, H +1', () => {
    const o = oxMap(CH4);
    expect(o[0]).toBe(-4);
    for (let i = 1; i <= 4; i += 1) expect(o[i]).toBe(1);
  });
  it('CO2: C +4, O −2', () => {
    const o = oxMap(CO2);
    expect(o[0]).toBe(4);
    expect(o[1]).toBe(-2);
    expect(o[2]).toBe(-2);
  });
  it('O2 / NaCl: homonuclear zero; Na +1, Cl −1', () => {
    expect(oxMap(O2)[0]).toBe(0);
    expect(oxMap(NaCl)[0]).toBe(1);
    expect(oxMap(NaCl)[1]).toBe(-1);
  });
  it('electrons neutrality: oxidation states sum to zero for neutral species', () => {
    const m = oxMap(H2O);
    expect(m[0]! + m[1]! + m[2]!).toBe(0);
  });
});

describe('matchAtoms & analyseReaction', () => {
  it('maps the shared Cl to the reactant, leaves Na unmatched', () => {
    const mapped = matchAtoms(HCl, NaCl).map;
    expect(mapped[0]).toBe(-1); // product Na has no reactant partner
    expect(mapped[1]).toBe(1); // product Cl → reactant Cl (index 1)
  });

  it('redox: electrons transferred out of CuO + H2 → Cu + H2O', () => {
    const center = analyseReaction(buildEng(findReaction('cuo-h2')!));
    expect(center.broken.some((b) => b.atomA === 0 || b.atomB === 0)).toBe(true); // Cu–O breaks
    expect(electronsTransferred(center.redoxChanges)).toBeGreaterThanOrEqual(1);
  });

  it('neutralization HCl + NaOH → NaCl + H2O transfers no electrons', () => {
    const center = analyseReaction(buildEng(findReaction('hcl-naoh')!));
    expect(electronsTransferred(center.redoxChanges)).toBe(0);
  });

  it('methane oxidation: carbon −4 → +4 (8 electrons)', () => {
    const center = analyseReaction(buildEng(findReaction('ch4-o2')!));
    expect(electronsTransferred(center.redoxChanges)).toBe(8);
  });
});

describe('classifyReaction', () => {
  it('covers the headline families', () => {
    expect(classifyReaction(buildEng(findReaction('ch4-o2')!))).toBe('combustion');
    expect(classifyReaction(buildEng(findReaction('caco3-cao')!))).toBe('decomposition');
    expect(classifyReaction(buildEng(findReaction('hcl-naoh')!))).toBe('neutralization');
    expect(classifyReaction(buildEng(findReaction('zn-hcl')!))).toBe('single-replacement');
  });
});

describe('buildMechanism', () => {
  it('produces a balanced equation and thermochemistry for CH4 combustion', () => {
    const m = buildMechanism(findReaction('ch4-o2')!);
    expect(m.equation.replace(/\s/g, '')).toBe('CH4+2O2→CO2+2H2O');
    expect(m.thermo).not.toBeNull();
    expect(m.thermo!.dh).toBeLessThan(0); // exothermic
    expect(m.thermo!.dg).toBeLessThan(0);
    expect(m.thermo!.k).toBeGreaterThan(1);
    expect(m.electrons).toBe(8);
  });

  it('electrolysis of NaCl is endothermic (ΔH > 0) with electron flow', () => {
    const m = buildMechanism(findReaction('nacl-electrolysis')!);
    expect(m.thermo).not.toBeNull();
    expect(m.thermo!.dh).toBeGreaterThan(0);
    expect(m.electrons).toBeGreaterThan(0);
  });

  it('every catalog reaction resolves an equation and centre without throwing', () => {
    for (const r of REACTIONS) {
      const m = buildMechanism(r);
      expect(m.equation.length).toBeGreaterThan(0);
      expect(m.centre).toBeTruthy();
      expect(m.reactants.length).toBeGreaterThan(0);
      expect(m.products.length).toBeGreaterThan(0);
    }
  });

  it('forms the addition product C2H4 + Br2 → C2H4Br2', () => {
    const m = buildMechanism(findReaction('c2h4-br2')!);
    expect(m.equation.replace(/\s/g, '')).toBe('C2H4+Br2→C2H4Br2');
    expect(m.formed.length).toBeGreaterThan(0); // C–Br bonds formed
  });
});

function buildEng(def: { reactants: EngSpecies[]; products: EngSpecies[] }): EngReaction {
  return {
    id: 'x',
    nameZh: '',
    nameEn: '',
    classification: '',
    reactants: def.reactants as EngSpecies[],
    products: def.products as EngSpecies[],
  };
}

describe('chem-reaction plugin', () => {
  function fakeApi(readText = ''): PluginApi {
    return {
      locale: 'zh-CN',
      t: (k) => k,
      onLocaleChange: () => () => {},
      setStatus: () => {},
      reportGpuTime: () => {},
      reportDataScale: () => {},
      notify: () => {},
      log: () => {},
      exportFile: () => {},
      cache: {} as PluginApi['cache'],
      openFile: async () => null,
      readText: async () => readText,
      readBinary: async () => new ArrayBuffer(0),
      getParam: () => undefined,
      setParam: () => {},
    };
  }

  it('is registered under the new id with formats', () => {
    expect(chemReactionManifest.id).toBe('example.chem-reaction');
    expect(findBuiltin('example.chem-reaction')?.manifest.id).toBe('example.chem-reaction');
    expect(disciplineOf('example.chem-reaction')).toBe('physics');
    expect((chemReactionManifest.formats ?? [])[0]!.extension).toBe('.json');
  });

  it('exposes reaction/condition params and run actions', async () => {
    const plugin = new ChemReactionPlugin();
    await plugin.init(fakeApi());
    const keys = plugin.getParams().map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['reaction', 'temperature', 'catalyst', 'showCard', 'run', 'exportPng']));
  });

  it('switches reaction and renders without a three handle safely', async () => {
    const plugin = new ChemReactionPlugin();
    await plugin.init(fakeApi());
    const state = (plugin as unknown as { state: { reaction: string } }).state;
    expect(state.reaction).toBe('cuo-h2');
    plugin.updateParams({ reaction: 'ch4-o2' });
    expect(state.reaction).toBe('ch4-o2');
    expect(() => plugin.render({} as never)).not.toThrow();
  });

  it('loads a JSON reaction scene by id', async () => {
    const plugin = new ChemReactionPlugin();
    await plugin.init(fakeApi('{"reaction":"nacl-electrolysis"}'));
    await plugin.loadData({ name: 'electro.json' } as File);
    const state = (plugin as unknown as { state: { reaction: string } }).state;
    expect(state.reaction).toBe('nacl-electrolysis');
  });
});

describe('equation helpers', () => {
  it('renderFormula subscript-substitutes digits', () => {
    expect(renderFormula('H2O')).toBe('H₂O');
    expect(renderFormula('CuO')).toBe('CuO');
    expect(renderFormula('CH4')).toBe('CH₄');
  });

  it('equationOf renders a stoichiometric arrow equation', () => {
    const def = findReaction('cuo-h2')!;
    expect(equationOf(def).replace(/\s/g, '')).toBe('CuO+H₂→Cu+H₂O');
    const combustion = findReaction('ch4-o2')!;
    expect(equationOf(combustion).replace(/\s/g, '')).toBe('CH₄+2O₂→CO₂+2H₂O');
  });
});

describe('reactmd payload builder', () => {
  it('lay out reactants on the left with global atoms, mass and radius', () => {
    const built = buildPhysicsPayload(findReaction('cuo-h2')!);
    const { payload } = built;
    expect(payload.atoms.length).toBe(4); // Cu O H H
    expect(payload.mass).toHaveLength(payload.atoms.length);
    expect(payload.radius).toHaveLength(payload.atoms.length);
    // Cu–O reactant bond is flagged to break; Cu target present
    expect(payload.bonds.some((b) => b.kind === 'break')).toBe(true);
    expect(payload.bonds.some((b) => b.kind === 'form')).toBe(true);
    // every reactant atom has a non-null product target (or is a spectator)
    expect(payload.target.filter((t) => t !== null).length).toBeGreaterThan(0);
  });

  it('assign each product atom a target position on the right of the reactant block', () => {
    const built = buildPhysicsPayload(findReaction('cuo-h2')!);
    const { payload, reactantExtent } = built;
    for (const t of payload.target) {
      if (!t) continue;
      expect(t.x).toBeGreaterThan(reactantExtent / 2 + 1);
    }
  });

  it('build a payload for every catalog reaction without throwing', () => {
    for (const r of REACTIONS) {
      const built = buildPhysicsPayload(r);
      expect(built.payload.atoms.length).toBeGreaterThan(0);
      expect(built.payload.bonds.length).toBeGreaterThan(0);
    }
  });
});