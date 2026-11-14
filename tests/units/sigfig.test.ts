// ==========================================================================
// Regression tests for the significant-figure rounding core.
//
// The digit string is re-aligned to n digits (padded, or n+1 after a carry),
// but the exponent used to stay at the ORIGINAL value — so every result that
// was not already "full width" was wrong by a power of ten.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { roundToDecimals, roundToSigFigs, sigCount, decompose } from '@/core/units/sigfig';

describe('significant figures', () => {
  it('rounds to the requested number of significant figures', () => {
    expect(roundToSigFigs('1.5', 3)?.decimal).toBe('1.50');
    expect(roundToSigFigs('1.2345', 3)?.decimal).toBe('1.23');
    expect(roundToSigFigs('1234', 3)?.decimal).toBe('1230');
  });

  it('handles a carry (the digit count grows by one)', () => {
    // 9.99 to 1 significant figure is 10, not 0.10.
    const r = roundToSigFigs('9.99', 1);
    expect(r?.decimal).toBe('10');
    expect(r?.sci).toContain('10^1');
  });

  it('handles a value below one', () => {
    const r = roundToSigFigs('0.0999', 1);
    expect(r?.decimal).toBe('0.10');
    expect(r?.sci).toContain('10^-1');
  });

  it('reports the scientific notation with the shifted exponent', () => {
    expect(roundToSigFigs('1.5', 3)?.sci).toContain('10^0');
    expect(roundToSigFigs('1234', 3)?.sci).toContain('10^3');
  });

  it('counts the significant digits of the input', () => {
    expect(roundToSigFigs('1.5', 3)?.inputSf).toBe(2);
    expect(roundToSigFigs('1200', 3)?.inputSf).toBe(2);
    expect(roundToSigFigs('1200.', 3)?.inputSf).toBe(4);
    expect(roundToSigFigs('1.200e3', 3)?.inputSf).toBe(4);
  });

  it('rounds to decimal places', () => {
    expect(roundToDecimals('1.2345', 2)?.decimal).toBe('1.23');
    expect(roundToDecimals('1.5', 0)?.decimal).toBe('2');
    expect(roundToDecimals('9.99', 1)?.decimal).toBe('10.0');
  });

  it('rejects a non-numeric input', () => {
    expect(roundToSigFigs('abc', 3)).toBeNull();
    expect(roundToSigFigs('', 3)).toBeNull();
  });

  it('decomposes a literal into digits and exponent', () => {
    expect(decompose('1.5')).toMatchObject({ neg: false, digits: '15', exp: -1 });
    expect(decompose('-2.50')).toMatchObject({ neg: true, digits: '250', exp: -2 });
    expect(sigCount(decompose('0')!)).toBe(1);
  });
});
