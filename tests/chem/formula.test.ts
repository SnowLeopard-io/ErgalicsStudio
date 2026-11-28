import { describe, it, expect } from 'vitest';
import { parseFormula } from '@ergalics/sci-kernels/chem/formula';

describe('parseFormula', () => {
  it('counts plain formulas', () => {
    expect(parseFormula('CaCO3')).toEqual({ elements: { Ca: 1, C: 1, O: 3 }, charge: 0 });
  });

  it('expands nested groups with multipliers', () => {
    expect(parseFormula('(NH4)2SO4').elements).toEqual({ N: 2, H: 8, S: 1, O: 4 });
    expect(parseFormula('[Fe(CN)6]^3-')).toEqual({ elements: { Fe: 1, C: 6, N: 6 }, charge: -3 });
  });

  it('reads charges only from the caret form or a bare sign', () => {
    expect(parseFormula('Ca^2+')).toEqual({ elements: { Ca: 1 }, charge: 2 });
    expect(parseFormula('SO4^2-')).toEqual({ elements: { S: 1, O: 4 }, charge: -2 });
    expect(parseFormula('OH-')).toEqual({ elements: { O: 1, H: 1 }, charge: -1 });
    expect(parseFormula('Na+')).toEqual({ elements: { Na: 1 }, charge: 1 });
  });

  it('refuses the ambiguous shorthand instead of guessing', () => {
    // SO42- 可能是 SO₄²⁻ 也可能是 S O₄₂；NH4+ 同理。猜错只会算错，不会报错。
    expect(() => parseFormula('SO42-')).toThrow(/歧义/);
    expect(() => parseFormula('NH4+')).toThrow(/歧义/);
    expect(() => parseFormula('Ca2+')).toThrow(/歧义/);
  });

  it('accepts elements the runtime mass table does not carry', () => {
    // chem/elements.ts 只有 49 个元素；判定表必须完整，否则 Pt/U/Th 会被误判为非法。
    expect(parseFormula('PtCl2').elements).toEqual({ Pt: 1, Cl: 2 });
    expect(parseFormula('UO2^2+')).toEqual({ elements: { U: 1, O: 2 }, charge: 2 });
  });

  it('throws instead of returning a partial parse', () => {
    expect(() => parseFormula('Xx2O3')).toThrow(/未知元素/);
    expect(() => parseFormula('Ca(OH2')).toThrow(/括号/);
    expect(() => parseFormula('2H2O')).toThrow(/系数/);
    expect(() => parseFormula('')).toThrow(/空化学式/);
  });
});
