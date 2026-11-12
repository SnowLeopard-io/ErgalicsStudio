// ==========================================================================
// Regression tests for the chemical-formula parser (molar mass core).
//
// Two defects lived here:
//   * A leading multiplier scaled only the FIRST element of the unit, so
//     `CuSO4·5H2O` lost the hydrate's oxygen (185.68 instead of 249.68 g/mol)
//     and `2H2O` became H4O.
//   * The charge-stripping regex ate the stoichiometric subscript, so
//     `NO3-` parsed as NO (30.01 instead of 62.00 g/mol).
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { analyzeFormula, parseFormula } from '@/core/chem/molar';

describe('chemical formula parsing', () => {
  it('counts the elements of a simple formula', () => {
    expect(Object.fromEntries(parseFormula('NaCl'))).toEqual({ Na: 1, Cl: 1 });
    expect(Object.fromEntries(parseFormula('C6H12O6'))).toEqual({ C: 6, H: 12, O: 6 });
  });

  it('handles nested groups', () => {
    expect(Object.fromEntries(parseFormula('Ca(OH)2'))).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(Object.fromEntries(parseFormula('(NH4)2SO4'))).toEqual({ N: 2, H: 8, S: 1, O: 4 });
  });

  it('a leading multiplier scales the WHOLE unit', () => {
    // 2H2O = 2 × H2O = H4O2 (not H4O1).
    expect(Object.fromEntries(parseFormula('2H2O'))).toEqual({ H: 4, O: 2 });
  });

  it('a hydrate multiplier scales the whole hydrate unit', () => {
    // CuSO4 + 5 × H2O = Cu1 S1 O9 H10.
    const counts = Object.fromEntries(parseFormula('CuSO4·5H2O'));
    expect(counts).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
  });

  it('the molar mass of a hydrate is correct', () => {
    const { total } = analyzeFormula('CuSO4·5H2O');
    // Cu 63.546 + S 32.06 + O9 143.991 + H10 10.08 ≈ 249.68
    expect(total).toBeCloseTo(249.68, 1);
  });

  it('a trailing charge keeps the stoichiometric subscript', () => {
    expect(Object.fromEntries(parseFormula('NO3-'))).toEqual({ N: 1, O: 3 });
    expect(Object.fromEntries(parseFormula('NH4+'))).toEqual({ N: 1, H: 4 });
    expect(Object.fromEntries(parseFormula('CH3COO-'))).toEqual({ C: 2, H: 3, O: 2 });
  });

  it('an explicit caret charge is stripped with its number', () => {
    expect(Object.fromEntries(parseFormula('SO4^2-'))).toEqual({ S: 1, O: 4 });
    expect(Object.fromEntries(parseFormula('Fe^3+'))).toEqual({ Fe: 1 });
  });

  it('a bare charge without a subscript is stripped', () => {
    expect(Object.fromEntries(parseFormula('Na+'))).toEqual({ Na: 1 });
    expect(Object.fromEntries(parseFormula('Cl-'))).toEqual({ Cl: 1 });
  });

  it('reports the mass fractions of the elements', () => {
    const { total, items } = analyzeFormula('H2O');
    expect(total).toBeCloseTo(18.015, 3);
    const sum = items.reduce((acc, i) => acc + i.share, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('rejects an unknown element', () => {
    expect(() => analyzeFormula('Xx2')).toThrow(/unknown/);
  });
});
