// chem-crystal (crystal unit-cell preview) plugin — pure-logic & data tests.
import { describe, it, expect } from 'vitest';
import {
  effectiveCounts,
  reduceCounts,
  reducedFormula,
  formatFormula,
  cellObservables,
} from '@/plugins/builtin/chem-crystal/cellInfo';
import { CRYSTAL_SAMPLES, findSample } from '@/plugins/builtin/chem-crystal/samples';
import {
  detectFormat,
  parseStructure,
  type LoadedCell,
} from '@/plugins/builtin/chem-crystal/parse';
import { ChemCrystalPlugin } from '@/plugins/builtin/chem-crystal/plugin';
import { chemCrystalManifest } from '@/plugins/builtin/chem-crystal/manifest';
import { findBuiltin } from '@/plugins/builtin';
import { disciplineOf } from '@/plugins/categories';
import type { PluginApi } from '@/types/plugin';

const CIF_NACL = `data_nacl
_cell_length_a 5.64
_cell_length_b 5.64
_cell_length_c 5.64
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_symmetry_equiv_pos_as_xyz
  x,y,z
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Cl Cl 0.0 0.0 0.0
Na Na 0.5 0.5 0.5
`;

const POSCAR_CS = `CsCl
1.0
  4.113  0.00  0.00
  0.00  4.113  0.00
  0.00  0.00  4.113
  Cs Cl
   1  1
Direct
  0.0000000  0.0000000  0.0000000
  0.5000000  0.5000000  0.5000000
`;

const XYZ_WATER = `3
water molecule
O 0.000000 0.000000 0.117300
H 0.000000 0.757200 -0.469200
H 0.000000 -0.757200 -0.469200
`;

function fakeApi(readText: string = ''): PluginApi {
  return {
    locale: 'zh-CN',
    t: (k: string) => k,
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

describe('chem-crystal manifest & registration', () => {
  it('declares the new id and drops the old mixed chem-cell plugin', () => {
    expect(chemCrystalManifest.id).toBe('example.chem-crystal');
    expect(chemCrystalManifest.sandbox).toBe('trusted');
    expect((chemCrystalManifest.formats ?? []).map((f) => f.extension)).toContain('.cif');
    expect((chemCrystalManifest.formats ?? []).map((f) => f.extension)).toContain('.poscar');
    expect((chemCrystalManifest.formats ?? []).map((f) => f.extension)).toContain('.xyz');
    expect(findBuiltin('example.chem-crystal')?.manifest.id).toBe('example.chem-crystal');
    expect(findBuiltin('example.chem-cell')).toBeUndefined();
  });

  it('sits in the physics sidebar discipline', () => {
    expect(disciplineOf('example.chem-crystal')).toBe('physics');
  });

  it('every built-in sample is a valid, non-empty cell', () => {
    for (const s of CRYSTAL_SAMPLES) {
      expect(s.cell.params.a).toBeGreaterThan(0);
      expect(s.cell.params.b).toBeGreaterThan(0);
      expect(s.cell.params.c).toBeGreaterThan(0);
      expect(s.cell.sites.length).toBeGreaterThan(0);
      for (const site of s.cell.sites) {
        expect(site.occupancy).toBeGreaterThan(0);
        expect(site.fx).toBeGreaterThanOrEqual(0);
        expect(site.fy).toBeGreaterThanOrEqual(0);
        expect(site.fz).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('effective counts & reduced formula (有效原子与化学式)', () => {
  it('NaCl: 4 Na + 4 Cl, formula NaCl, Z 4 (formula units per cell)', () => {
    const cell = findSample('nacl')!.cell;
    const info = cellObservables(cell.params, cell.sites);
    expect(info.counts.Na).toBeCloseTo(4);
    expect(info.counts.Cl).toBeCloseTo(4);
    expect(info.formula).toBe('NaCl');
    expect(info.z).toBe(4);
  });

  it('CsCl: 1+1, formula CsCl', () => {
    const cell = findSample('cscl')!.cell;
    const info = cellObservables(cell.params, cell.sites);
    expect(info.counts.Cs).toBeCloseTo(1);
    expect(info.counts.Cl).toBeCloseTo(1);
    expect(info.formula).toBe('CsCl');
    expect(info.z).toBe(1);
  });

  it('diamond: 8 C, formula C, Z 8, density ~3.5 g/cm³', () => {
    const cell = findSample('diamond')!.cell;
    const info = cellObservables(cell.params, cell.sites);
    expect(info.counts.C).toBeCloseTo(8);
    expect(info.formula).toBe('C');
    expect(info.z).toBe(8);
    expect(info.density).toBeCloseTo(3.5, 0);
  });

  it('NaCl density matches the rock-salt value (~2.16)', () => {
    const cell = findSample('nacl')!.cell;
    expect(cellObservables(cell.params, cell.sites).density).toBeCloseTo(2.16, 1);
  });

  it('effectiveCounts is occupancy weighted', () => {
    const counts = effectiveCounts([
      { symbol: 'O', fx: 0, fy: 0, fz: 0, occupancy: 2 },
      { symbol: 'O', fx: 0.5, fy: 0.5, fz: 0.5, occupancy: 0.5 },
    ]);
    expect(counts.O).toBeCloseTo(2.5);
  });

  it('reduceCounts reduces integer and half-occupancy ratios', () => {
    expect(reducedFormula({ Ca: 4, F: 8 })).toBe('CaF2');
    expect(formatFormula([['C', 1], ['O', 2]])).toBe('CO2');
    expect(reduceCounts({ a: 2, b: 4 }).sort((x, y) => x[0].localeCompare(y[0]))).toEqual([['a', 1], ['b', 2]]);
  });
});

describe('structural format dispatch (parseStructure)', () => {
  it('recognises extensions across the supported set', () => {
    expect(detectFormat(CIF_NACL, 'a.cif')).toBe('cif');
    expect(detectFormat(POSCAR_CS, 'CsCl.vasp')).toBe('poscar');
    expect(detectFormat(POSCAR_CS, 'POSCAR')).toBe('poscar');
    expect(detectFormat(XYZ_WATER, 'water.xyz')).toBe('xyz');
  });

  it('parses a CIF into a lattice + sites', () => {
    const loaded: LoadedCell = parseStructure(CIF_NACL, 'nacl.cif');
    expect(loaded.format).toBe('cif');
    expect(loaded.hasLattice).toBe(true);
    expect(loaded.cell.params.a).toBeCloseTo(5.64);
    expect(loaded.cell.sites.length).toBeGreaterThanOrEqual(2);
    // Cl + Na present after symmetry expansion (identity here).
    const syms = loaded.cell.sites.map((s) => s.symbol);
    expect(syms).toContain('Cl');
    expect(syms).toContain('Na');
  });

  it('parses a VASP POSCAR (CsCl) into cubic parameters', () => {
    const loaded = parseStructure(POSCAR_CS, 'CsCl.vasp');
    expect(loaded.format).toBe('poscar');
    expect(loaded.hasLattice).toBe(true);
    expect(loaded.cell.params.a).toBeCloseTo(4.113, 3);
    expect(Math.abs(loaded.cell.params.alpha - 90)).toBeLessThan(1e-6);
    expect(loaded.cell.sites.length).toBe(2);
  });

  it('parses an XYZ frame; without an embedded lattice hasLattice=false', () => {
    const loaded = parseStructure(XYZ_WATER, 'water.xyz');
    expect(loaded.format).toBe('xyz');
    expect(loaded.hasLattice).toBe(false);
    expect(loaded.cell.sites).toHaveLength(3);
    expect(loaded.cell.sites[0]!.symbol).toBe('O');
  });
});

describe('ChemCrystalPlugin', () => {
  it('exposes sample/representation/toggles and export actions', async () => {
    const plugin = new ChemCrystalPlugin();
    await plugin.init(fakeApi());
    const keys = plugin.getParams().map((d) => d.key);
    expect(keys).toContain('sample');
    expect(keys).toContain('representation');
    expect(keys).toContain('showBonds');
    expect(keys).toContain('showCell');
    expect(keys).toContain('reset');
    expect(keys).toContain('exportPng');
  });

  it('switches built-in samples and ignores unknown ids', async () => {
    const plugin = new ChemCrystalPlugin();
    await plugin.init(fakeApi());
    const state = (plugin as unknown as { state: { source: string; sampleId: string } }).state;
    expect(state.sampleId).toBe('nacl');
    plugin.updateParams({ sample: 'diamond' });
    expect(state.sampleId).toBe('diamond');
    plugin.updateParams({ sample: 'does-not-exist' });
    expect(state.sampleId).toBe('diamond');
  });

  it('renders without a three handle without throwing', async () => {
    const plugin = new ChemCrystalPlugin();
    await plugin.init(fakeApi());
    expect(() => plugin.render({} as never)).not.toThrow();
    plugin.updateParams({ representation: 'spacefill' });
    expect(() => plugin.render({} as never)).not.toThrow();
  });

  it('loads a legacy JSON crystal scene to a built-in sample', async () => {
    const plugin = new ChemCrystalPlugin();
    await plugin.init(fakeApi('{"crystal":"cscl"}'));
    const file = { name: 'chem-cscl.json' } as File;
    await plugin.loadData(file);
    const state = (plugin as unknown as { state: { source: string; sampleId: string } }).state;
    expect(state.source).toBe('sample');
    expect(state.sampleId).toBe('cscl');
  });
});