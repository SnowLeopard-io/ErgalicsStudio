// ==========================================================================
// Ergalics Studio — unit algebra tests (core)
//
// Dimensional parsing, SI-prefix handling, algebra (mul/div/add), conversion
// and formatting. Reference factors cross-checked against NIST SI values.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  parseUnitExpr,
  quantity,
  mulQty,
  divQty,
  addQty,
  checkCompatible,
  convert,
  conversionFactor,
  formatQty,
} from '@/core/units/quantity';

const dimOf = (expr: string): number[] => Array.from(parseUnitExpr(expr).dims);
const scaleOf = (expr: string): number => parseUnitExpr(expr).scale;

describe('parseUnitExpr — base and prefixed units', () => {
  it('dimensionless empty expression has zero dims and unit scale', () => {
    const u = parseUnitExpr('');
    expect(u.scale).toBe(1);
    expect(Array.from(u.dims)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('parses SI base units into the right dimension slot', () => {
    expect(dimOf('m')).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(dimOf('kg')).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(dimOf('s')).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(dimOf('A')).toEqual([0, 0, 0, 1, 0, 0, 0]);
    expect(dimOf('K')).toEqual([0, 0, 0, 0, 1, 0, 0]);
    expect(dimOf('mol')).toEqual([0, 0, 0, 0, 0, 1, 0]);
    expect(dimOf('cd')).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it('applies SI prefixes multiplicatively', () => {
    expect(scaleOf('km')).toBe(1000);
    expect(scaleOf('mm')).toBe(1e-3);
    expect(scaleOf('nm')).toBe(1e-9);
    expect(scaleOf('MPa')).toBe(1e6);
    expect(scaleOf('kg')).toBe(1); // kilo·gram ≡ base kilogram
    expect(scaleOf('mg')).toBeCloseTo(1e-6, 15);
    expect(scaleOf('µm')).toBeCloseTo(1e-6, 15);
  });

  it('handles compound expressions with division and exponents', () => {
    expect(dimOf('m/s')).toEqual([1, 0, -1, 0, 0, 0, 0]);
    expect(dimOf('m/s^2')).toEqual([1, 0, -2, 0, 0, 0, 0]);
    expect(scaleOf('km/h')).toBeCloseTo(1000 / 3600, 12);
    expect(dimOf('N')).toEqual([1, 1, -2, 0, 0, 0, 0]);
    expect(dimOf('J')).toEqual([2, 1, -2, 0, 0, 0, 0]);
  });

  it('supports parentheses and unicode multiplication signs', () => {
    expect(dimOf('J/(mol·K)')).toEqual([2, 1, -2, 0, -1, -1, 0]);
    expect(scaleOf('m×s')).toBe(1);
    expect(dimOf('(m/s)^2')).toEqual([2, 0, -2, 0, 0, 0, 0]);
  });

  it('normalizes the expression (whitespace stripped, · folded to *)', () => {
    expect(parseUnitExpr(' J / ( mol * K ) ').expr).toBe('J/(mol*K)');
  });

  it('accepts common non-SI units with correct SI factors', () => {
    expect(scaleOf('min')).toBe(60);
    expect(scaleOf('h')).toBe(3600);
    expect(scaleOf('bar')).toBeCloseTo(1e5, 6);
    expect(scaleOf('atm')).toBeCloseTo(101325, 6);
    expect(scaleOf('cal')).toBeCloseTo(4.184, 9);
    expect(scaleOf('L')).toBeCloseTo(1e-3, 15);
    expect(scaleOf('%')).toBeCloseTo(1e-2, 15);
    expect(dimOf('°C')).toEqual(dimOf('K')); // temperature difference
  });

  it('rejects unknown units and malformed expressions', () => {
    expect(() => parseUnitExpr('zz')).toThrow(/unknown unit/);
    expect(() => parseUnitExpr('m^')).toThrow(/exponent/);
    expect(() => parseUnitExpr('m/(s')).toThrow(/\)/);
    expect(() => parseUnitExpr('m?s')).toThrow(/unexpected character/);
    expect(() => parseUnitExpr('4m')).toThrow(/unexpected character/);
  });
});

describe('quantity algebra', () => {
  it('mulQty adds dimensions and multiplies scales', () => {
    const q = mulQty(quantity(2, 'km'), quantity(3, 'h'));
    expect(q.value).toBe(6);
    expect(q.dims).toEqual(new Float64Array([1, 0, 1, 0, 0, 0, 0])); // length × time
    expect(q.scale).toBeCloseTo(1000 * 3600, 6);
  });

  it('divQty subtracts dimensions and divides scales', () => {
    const q = divQty(quantity(10, 'm'), quantity(2, 's'));
    expect(q.value).toBe(5);
    expect(q.dims).toEqual(new Float64Array([1, 0, -1, 0, 0, 0, 0]));
  });

  it('addQty sums values in the same unit', () => {
    const q = addQty(quantity(3, 'm'), quantity(4, 'm'));
    expect(q.value).toBe(7);
    expect(q.expr).toBe('m');
  });

  it('addQty converts the second operand into the first unit', () => {
    const q = addQty(quantity(1, 'm'), quantity(1, 'cm'));
    expect(q.value).toBeCloseTo(1.01, 12);
    expect(q.expr).toBe('m');
  });

  it('addQty rejects incompatible dimensions', () => {
    expect(() => addQty(quantity(1, 'm'), quantity(1, 's'))).toThrow(/incompatible/);
  });

  it('checkCompatible mirrors dimsMatch', () => {
    expect(checkCompatible(parseUnitExpr('km'), parseUnitExpr('cm'))).toBe(true);
    expect(checkCompatible(parseUnitExpr('N'), parseUnitExpr('J'))).toBe(false);
  });
});

describe('convert / conversionFactor', () => {
  it('converts lengths and speeds', () => {
    expect(convert(quantity(1, 'km'), 'm').value).toBe(1000);
    expect(convert(quantity(90, 'km/h'), 'm/s').value).toBeCloseTo(25, 10);
    expect(convert(quantity(1, 'MPa'), 'Pa').value).toBeCloseTo(1e6, 6);
  });

  it('keeps target unit metadata on the result', () => {
    const out = convert(quantity(5, 'km'), 'm');
    expect(out.expr).toBe('m');
    expect(out.scale).toBe(1);
  });

  it('throws on dimension mismatch with both units named', () => {
    expect(() => convert(quantity(1, 'm'), 's')).toThrow(/"m".*"s"/);
  });

  it('conversionFactor matches convert scaling', () => {
    expect(conversionFactor('km', 'm')).toBe(1000);
    expect(conversionFactor('km/h', 'm/s')).toBeCloseTo(1 / 3.6, 12);
    expect(() => conversionFactor('kg', 'm')).toThrow(/incompatible/);
  });
});

describe('formatQty', () => {
  it('renders value + unit', () => {
    expect(formatQty(quantity(9.81, 'm/s^2'))).toBe('9.81 m/s^2');
  });

  it('trims precision noise', () => {
    expect(formatQty(quantity(0.1 + 0.2, 'm'))).toBe('0.3 m');
  });

  it('falls back to exponential notation for extreme magnitudes', () => {
    expect(formatQty(quantity(3.2e-19, 'J'))).toBe('3.2e-19 J');
    expect(formatQty(quantity(6.0e23, ''))).toBe('6e+23');
  });

  it('omits the unit for dimensionless quantities', () => {
    expect(formatQty(quantity(42, ''))).toBe('42');
  });
});
