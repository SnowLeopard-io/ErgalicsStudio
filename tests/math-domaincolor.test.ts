// math-domaincolor kernel tests — complex arithmetic, parser, winding, shading
import { describe, it, expect } from 'vitest';
import {
  cAdd,
  cDiv,
  cExp,
  cMul,
  cPow,
  cSqrt,
  compileComplex,
  cx,
  hsvToRgb,
  runDomaincolorBenchmarks,
  shadePixel,
  windingCount,
  windingNumber,
  type Complex,
} from '../src/plugins/builtin/math-domaincolor/kernel';

function closeTo(a: Complex, re: number, im: number, tol = 1e-12): void {
  expect(Math.hypot(a.re - re, a.im - im)).toBeLessThan(tol);
}

function mustCompile(expr: string): (z: Complex) => Complex {
  const c = compileComplex(expr);
  if (!c.ok) throw new Error(`compile failed for '${expr}': ${c.error}`);
  return c.fn;
}

function evalAt(expr: string, z: Complex): Complex {
  return mustCompile(expr)(z);
}

describe('complex arithmetic', () => {
  it('adds, multiplies and divides (Smith algorithm)', () => {
    closeTo(cAdd(cx(1, 2), cx(3, -1)), 4, 1);
    closeTo(cMul(cx(1, 2), cx(3, -1)), 5, 5);
    closeTo(cDiv(cx(1, 2), cx(3, 4)), 0.44, 0.08);
  });

  it('uses exact binary exponentiation for integer powers', () => {
    closeTo(cPow(cx(1, 1), cx(10, 0)), 0, 32); // (1+i)^10 = 32i
    closeTo(cPow(cx(2, 0), cx(0, 0)), 1, 0);
    closeTo(cPow(cx(2, 0), cx(-1, 0)), 0.5, 0);
  });

  it('computes exp and sqrt on principal branches', () => {
    closeTo(cExp(cx(0, Math.PI)), -1, 0, 1e-12);
    closeTo(cSqrt(cx(-4, 0)), 0, 2, 1e-12);
    closeTo(cSqrt(cx(0, 1)), Math.SQRT1_2, Math.SQRT1_2, 1e-12);
  });
});

describe('compileComplex parser', () => {
  it('evaluates z^3 - 1 at 1+i as −3 + 2i', () => {
    closeTo(evalAt('z^3 - 1', cx(1, 1)), -3, 2);
  });

  it('supports implicit multiplication (2i, 3z(z+1), (z+1)(z-1), 2pi i)', () => {
    closeTo(evalAt('2i + 1', cx(9, 9)), 1, 2);
    closeTo(evalAt('3z(z+1)', cx(2, 0)), 18, 0);
    closeTo(evalAt('(z+1)(z-1)', cx(2, 0)), 3, 0);
    closeTo(evalAt('2pi i', cx(0, 0)), 0, 2 * Math.PI);
  });

  it('handles functions, constants and right-associative power', () => {
    closeTo(evalAt('exp(pi*i)', cx(0, 0)), -1, 0, 1e-12);
    closeTo(evalAt('sin(z)/z', cx(0, 1)), Math.sinh(1), 0, 1e-12);
    closeTo(evalAt('ln(e)', cx(0, 0)), 1, 0, 1e-12);
    closeTo(evalAt('abs(3+4i)', cx(0, 0)), 5, 0);
    closeTo(evalAt('re(2+3i) + im(2+3i)', cx(0, 0)), 5, 0);
    closeTo(evalAt('conj(1+2i)', cx(0, 0)), 1, -2);
    closeTo(evalAt('2^2^3', cx(0, 0)), 256, 0); // right-assoc: 2^(2^3) = 256
    closeTo(evalAt('-z^2', cx(1, 0)), -1, 0); // unary binds looser than ^
    closeTo(evalAt('EXP( Z )', cx(0, 0)), 1, 0); // case-insensitive identifiers
  });

  it('rejects malformed input with an error message', () => {
    expect(compileComplex('').ok).toBe(false);
    expect(compileComplex('z +').ok).toBe(false);
    expect(compileComplex('foo(z)').ok).toBe(false);
    expect(compileComplex('z)').ok).toBe(false);
    expect(compileComplex('(z+1').ok).toBe(false);
    expect(compileComplex('z # 1').ok).toBe(false);
  });
});

describe('winding number (argument principle)', () => {
  it('counts 3 zeros of z³−1 inside |z|=1.2 and 0 when none inside', () => {
    const f = mustCompile('z^3 - 1');
    const w = windingNumber(f, cx(0, 0), 1.2, 1024);
    expect(Math.abs(w - 3)).toBeLessThan(1e-4);
    expect(windingCount(f, cx(0, 0), 0.5, 512)).toBe(0);
  });

  it('counts poles: 1/z → −1, exp(z)/z → −1 (no zeros, one pole)', () => {
    expect(windingCount(mustCompile('z^2'), cx(0, 0), 1, 512)).toBe(2);
    expect(windingCount(mustCompile('1/z'), cx(0, 0), 1, 512)).toBe(-1);
    expect(windingCount(mustCompile('exp(z)/z'), cx(0, 0), 1, 1024)).toBe(-1);
  });

  it('gives 0 for a zero-free entire function', () => {
    expect(windingCount(mustCompile('exp(z)'), cx(0, 0), 1, 512)).toBe(0);
  });

  it('returns NaN when the loop hits a zero or a pole', () => {
    expect(Number.isNaN(windingNumber(mustCompile('z - 1'), cx(0, 0), 1, 512))).toBe(true);
    expect(Number.isNaN(windingNumber(mustCompile('1/z'), cx(0.5, 0), 0.5, 512))).toBe(true);
  });
});

describe('domain coloring shading', () => {
  it('maps HSV primaries and wraps negative hues', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]);
    expect(hsvToRgb(1 / 3, 1, 1)).toEqual([0, 255, 0]);
    expect(hsvToRgb(2 / 3, 1, 1)).toEqual([0, 0, 255]);
    expect(hsvToRgb(-0.25, 1, 1)).toEqual([128, 0, 255]);
  });

  it('renders poles white and zeros black', () => {
    expect(shadePixel(cx(NaN, 1), false)).toEqual([255, 255, 255]);
    expect(shadePixel(cx(Infinity, 0), false)).toEqual([255, 255, 255]);
    expect(shadePixel(cx(0, 0), false)).toEqual([0, 0, 0]);
  });

  it('encodes the argument as hue (f=1 → cyan wheel point, f=i → violet)', () => {
    expect(shadePixel(cx(1, 0), false)).toEqual([21, 140, 140]);
    expect(shadePixel(cx(0, 1), false)).toEqual([81, 21, 140]);
  });

  it('darkens contour lines where |f| = 2^k', () => {
    const off = shadePixel(cx(1, 0), false);
    const on = shadePixel(cx(1, 0), true);
    expect(on[2]).toBeLessThan(off[2]);
  });
});

describe('embedded validation benchmarks', () => {
  it('passes all four benchmarks (argument principle ×3 + parser)', () => {
    const bench = runDomaincolorBenchmarks();
    expect(bench.map((b) => b.id)).toEqual([
      'winding-z3m1',
      'winding-expz',
      'winding-rational',
      'parser-closed-form',
    ]);
    for (const b of bench) expect(b.passed, b.id).toBe(true);
    const parser = bench.find((b) => b.id === 'parser-closed-form')!;
    expect(parser.relErr).toBeLessThan(1e-12);
  });
});
