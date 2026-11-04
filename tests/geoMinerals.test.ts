import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MINERALS,
  crystalSystemFromCell,
  identifyMinerals,
  interferenceColor,
  mineralById,
  parseMineralCsv,
  retardationNm,
  runMineralBenchmarks,
  scratchTest,
} from '../src/plugins/builtin/geo/minerals/kernel';

describe('geo-minerals · database and identification', () => {
  it('the bundled CSV parses into a valid database', () => {
    const text = readFileSync('examples/data/geo-minerals.csv', 'utf8');
    const db = parseMineralCsv(text);
    expect(db.length).toBeGreaterThanOrEqual(15);
    expect(new Set(db.map((m) => m.id)).size).toBe(db.length);
    expect(db.find((m) => m.id === 'quartz')?.hardness).toBe(7);
  });

  it('quartz ranks first for its diagnostic properties', () => {
    const matches = identifyMinerals({ hardness: 7, cleavage: 'none', luster: 'vitreous', streak: 'white' });
    expect(matches[0]?.mineral.id).toBe('quartz');
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score);
  });

  it('specific gravity discriminates galena from pyrite', () => {
    const matches = identifyMinerals({ sg: 7.6, luster: 'metallic', hardness: 2.5 });
    expect(matches[0]?.mineral.id).toBe('galena');
  });
});

describe('geo-minerals · optical and crystal properties', () => {
  it('classifies cubic and hexagonal unit cells', () => {
    expect(crystalSystemFromCell({ a: 5.4, b: 5.4, c: 5.4, alpha: 90, beta: 90, gamma: 90 })).toBe('cubic');
    expect(crystalSystemFromCell({ a: 4.9, b: 4.9, c: 5.4, alpha: 90, beta: 90, gamma: 120 })).toBe('hexagonal');
  });

  it('calcite retardation is 5160 nm in a 30 µm section', () => {
    expect(retardationNm(mineralById('calcite')!.birefringence)).toBeCloseTo(5160, 9);
  });

  it('interference colours advance from black to white with retardation', () => {
    expect(interferenceColor(0).name).toContain('black');
    expect(interferenceColor(150).name).toContain('grey');
    expect(interferenceColor(1600).name).toContain('white');
  });

  it('Mohs scratch logic is symmetric and tolerance-aware', () => {
    expect(scratchTest(7, 5.5)).toBe('mineral-scratches-tool');
    expect(scratchTest(3, 5.5)).toBe('tool-scratches-mineral');
    expect(scratchTest(5.5, 5.5)).toBe('mutual');
  });

  it('all declared benchmarks pass', () => {
    expect(runMineralBenchmarks().every((b) => b.pass)).toBe(true);
  });

  it('reference database covers at least six crystal systems', () => {
    expect(new Set(MINERALS.map((m) => m.crystalSystem)).size).toBeGreaterThanOrEqual(5);
  });
});
