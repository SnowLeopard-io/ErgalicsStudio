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
import { entropyGibbsSpec } from '@/plugins/builtin/chem-reaction/figures';
import { renderSVG } from '@/core/plot';
import { templateById } from '@/core/figure/compose';
import type { PlotSpec } from '@/core/plot';
import {
  matchReaction,
  combustionSide,
  buildFreePayload,
  feedElements,
} from '@/plugins/builtin/chem-reaction/freelib';
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
    expect(disciplineOf('example.chem-reaction')).toBe('chem');
    expect((chemReactionManifest.formats ?? [])[0]!.extension).toBe('.json');
  });

  it('exposes reaction/condition params and run actions', async () => {
    const plugin = new ChemReactionPlugin();
    await plugin.init(fakeApi());
    const keys = plugin.getParams().map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['reaction', 'temperature', 'catalyst', 'run', 'fitView', 'reset', 'reloadPlugin', 'exportPng', 'sendToFigure']));
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

describe('figure titles fit narrow IEEE cells (wrap, no overflow, no ellipsis)', () => {
  function titleText(svg: string): { y: number; text: string }[] {
    const out: { y: number; text: string }[] = [];
    for (const m of svg.matchAll(/<text x="[\d.]+" y="(\d+)" font-family="[^"]+" font-size="15" text-anchor="middle"[^>]*>(.*?)<\/text>/g)) {
      out.push({ y: Number(m[1]), text: m[2]! });
    }
    return out;
  }

  it('wraps an over-long title to multiple lines within a 336px cell', () => {
    const tpl = templateById('ieee_single');
    const spec = entropyGibbsSpec(findReaction('ch4-o2')!);
    const long = {
      ...spec,
      title: '一个超长的反应动力学与热力学标题，用于验证在窄的单栏期刊单元格中会自动换行而不会越界或被省略 CH₄+2O₂→CO₂+2H₂O',
    };
    const svg = renderSVG({ ...long, width: tpl.panelWidth, height: tpl.panelHeight } as PlotSpec);
    const lines = titleText(svg);
    expect(lines.length).toBeGreaterThan(1); // wrap actually happened
    const maxW = tpl.panelWidth - 36;
    for (const { text } of lines) {
      let w = 0;
      for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? 15 : ch === ' ' ? 4 : 7;
      expect(w).toBeLessThanOrEqual(maxW + 1); // no line overflows (clears the corner tag)
    }
  });

  it('still renders a concise title on one centred line', () => {
    const tpl = templateById('ieee_single');
    const spec = entropyGibbsSpec(findReaction('ch4-o2')!);
    const svg = renderSVG({ ...spec, width: tpl.panelWidth, height: tpl.panelHeight } as PlotSpec);
    const lines = titleText(svg);
    expect(lines.length).toBe(1);
    expect(lines[0]!.text).toContain('CH₄');
  });
});

describe('free-reactant mode (freelib)', () => {
  it('matches the catalog reaction for a stoichiometric feed', () => {
    const m = matchReaction({ CH4: 1, O2: 2 });
    expect(m?.reaction.id).toBe('ch4-o2');
    expect(m?.equivalents).toBe(1);
    expect(Object.keys(m!.spectators)).toHaveLength(0);
  });

  it('keeps the excess reagent as an unreacted spectator', () => {
    const m = matchReaction({ CH4: 2, O2: 2 })!;
    expect(m.reaction.id).toBe('ch4-o2');
    expect(m.equivalents).toBe(1); // only 1 equivalent of O₂ available
    expect(m.spectators).toEqual({ CH4: 1 });
  });

  it('returns null (dissociation fallback) for an unknown balance', () => {
    expect(matchReaction({ CH4: 1, O2: 1 })).toBeNull();
    expect(matchReaction({ Zn: 1, CuO: 1 })).toBeNull();
    expect(matchReaction({ O2: 3 })).toBeNull();
  });

  it('matches several other curated reactions', () => {
    expect(matchReaction({ CuO: 1, H2: 1 })?.reaction.id).toBe('cuo-h2');
    expect(matchReaction({ Zn: 1, HCl: 2 })?.reaction.id).toBe('zn-hcl');
    expect(matchReaction({ NaCl: 2 })?.reaction.id).toBe('nacl-electrolysis');
  });

  it('combustion honours the real O₂:CH₄ balance (side reactions)', () => {
    expect(combustionSide(1, 2)?.textEn).toContain('Complete');
    expect(combustionSide(1, 3)?.textEn).toContain('left over');
    expect(combustionSide(2, 3)?.textEn).toContain('CO/CO₂'); // partial oxidation
    expect(combustionSide(1, 2)).toEqual(combustionSide(1, 2)); // deterministic
  });

  it('builds a real-product payload for a matched feed', () => {
    const { match, payload } = buildFreePayload({ CH4: 1, O2: 2 });
    expect(match?.reaction.id).toBe('ch4-o2');
    expect(payload.bonds.some((b) => b.kind === 'form')).toBe(true);
    expect(payload.bonds.some((b) => b.kind === 'break')).toBe(true);
    expect(payload.atoms.length).toBeGreaterThan(0);
  });

  it('builds a dissociation payload (all bonds break) when nothing matches', () => {
    const { match, payload } = buildFreePayload({ CH4: 1, O2: 1 });
    expect(match).toBeNull();
    expect(payload.bonds.length).toBeGreaterThan(0);
    expect(payload.bonds.every((b) => b.kind === 'break')).toBe(true);
    expect(payload.target.every((t) => t === null)).toBe(true);
  });

  it('feed element balance is conserved', () => {
    const el = feedElements({ CH4: 1, O2: 2 });
    expect(el.get('C')).toBe(1);
    expect(el.get('H')).toBe(4);
    expect(el.get('O')).toBe(4);
  });
});