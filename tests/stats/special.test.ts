import { describe, it, expect } from 'vitest';
import {
  logGamma,
  erf,
  normalCdf,
  normalInv,
  studentTCdf,
  studentTInv,
  chiSquareCdf,
  chiSquareInv,
  fCdf,
  fInv,
} from '@/core/stats/special';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('stats/special — distributions', () => {
  it('logGamma(5) = ln(24)', () => {
    expect(close(logGamma(5), Math.log(24), 1e-10)).toBe(true);
  });

  it('erf(1) matches the table value', () => {
    expect(close(erf(1), 0.8427007929, 1e-7)).toBe(true);
  });

  it('normalCdf is symmetric and anchored', () => {
    expect(close(normalCdf(0), 0.5, 1e-9)).toBe(true);
    expect(close(normalCdf(1.959963985), 0.975, 1e-7)).toBe(true);
  });

  it('normalInv(0.975) ≈ 1.95996', () => {
    expect(close(normalInv(0.975), 1.9599639845, 1e-7)).toBe(true);
  });

  it('studentT: cdf(0)=0.5 and inv matches the t-table', () => {
    expect(close(studentTCdf(0, 10), 0.5, 1e-9)).toBe(true);
    expect(close(studentTInv(0.975, 10), 2.228138852, 1e-6)).toBe(true);
  });

  it('chiSquare: inv/cdf round-trip at the 0.95 quantile', () => {
    const x = chiSquareInv(0.95, 5);
    expect(close(x, 11.07049775, 1e-4)).toBe(true);
    expect(close(chiSquareCdf(x, 5), 0.95, 1e-6)).toBe(true);
  });

  it('F: inv/cdf round-trip', () => {
    const x = fInv(0.95, 5, 10);
    expect(close(fCdf(x, 5, 10), 0.95, 1e-6)).toBe(true);
  });
});
