import { describe, expect, it } from 'vitest';
import { fmt } from '@/pages/research/researchUi';

describe('fmt', () => {
  it('formats with the default significant digits', () => {
    expect(fmt(123.456789)).toBe('123.457');
    expect(fmt(0.000123456)).toBe('0.000123456');
  });

  it('honours an explicit significant-digit count', () => {
    expect(fmt(Math.PI, 4)).toBe('3.142');
    expect(fmt(1234.5678, 4)).toBe('1235');
  });

  it('rounds to a whole number for digits <= 0 without toPrecision(0)', () => {
    expect(fmt(912.4, 0)).toBe('912');
    expect(fmt(912.6, 0)).toBe('913');
    expect(fmt(0, 0)).toBe('0');
    // regression: toPrecision(0) throws RangeError; must not throw
    expect(() => fmt(1, 0)).not.toThrow();
  });

  it('caps digits at 100 so toPrecision never overflows', () => {
    expect(fmt(1.5, 200)).toBe('1.5');
    expect(() => fmt(1, 150)).not.toThrow();
  });

  it('renders non-finite values as an em dash', () => {
    expect(fmt(NaN)).toBe('—');
    expect(fmt(Infinity)).toBe('—');
  });
});